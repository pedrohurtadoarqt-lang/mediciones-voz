-- ============================================================
-- Mediciona · esquema inicial
-- Usuarios (perfil profesional + teléfono verificado), obras en la nube,
-- sugerencias, registro de uso de IA y administradores.
-- Seguridad: Row Level Security en todas las tablas.
-- ============================================================

-- Perfil del usuario (1:1 con auth.users)
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  empresa text,                -- razón social (clientes profesionales)
  nif text,                    -- NIF/CIF para la factura completa
  telefono text unique,        -- un teléfono = una cuenta (control de la medición gratuita)
  telefono_verificado boolean not null default false,
  gratis_usada boolean not null default false,
  plan text not null default 'gratis' check (plan in ('gratis', 'pro')),
  pro_hasta timestamptz,
  stripe_customer_id text unique,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

-- Administradores (ven todo desde el panel)
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creado timestamptz not null default now()
);
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Obras (el documento completo de la obra en JSON, como en la app)
create table if not exists public.obras (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null default '',
  datos jsonb not null,
  desbloqueada boolean not null default false,   -- pagada (o la gratuita)
  borrada boolean not null default false,
  creada timestamptz not null default now(),
  actualizada timestamptz not null default now()
);
create index if not exists obras_user_idx on public.obras(user_id, actualizada desc);

-- Partidas propias de cada usuario (su biblioteca, disponible en todas sus obras)
create table if not exists public.partidas_propias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  codigo text not null,
  unidad text not null,
  resumen text not null,
  texto text,
  capitulo text,
  creada timestamptz not null default now(),
  unique (user_id, codigo)
);

-- Buzón de sugerencias
create table if not exists public.sugerencias (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  tipo text not null check (char_length(tipo) <= 40),
  mensaje text not null check (char_length(mensaje) between 1 and 4000),
  conversacion jsonb,
  dispositivo text check (char_length(dispositivo) <= 300),
  estado text not null default 'nueva' check (estado in ('nueva', 'leida', 'hecha', 'descartada')),
  creada timestamptz not null default now()
);

-- Uso de la IA (límites por usuario y control de coste)
create table if not exists public.ia_uso (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  modelo text,
  tokens_entrada int,
  tokens_salida int,
  ms int,
  intent text,
  creado timestamptz not null default now()
);
create index if not exists ia_uso_user_idx on public.ia_uso(user_id, creado desc);

-- ---------- Row Level Security ----------
alter table public.perfiles enable row level security;
alter table public.admins enable row level security;
alter table public.obras enable row level security;
alter table public.partidas_propias enable row level security;
alter table public.sugerencias enable row level security;
alter table public.ia_uso enable row level security;

-- Perfiles: cada uno ve y edita el suyo (salvo campos de plan/pago, que solo cambia el servidor)
create policy perfiles_select on public.perfiles for select using (id = auth.uid() or public.es_admin());
create policy perfiles_update on public.perfiles for update using (id = auth.uid()) with check (id = auth.uid());
-- Permisos por columna: el usuario solo puede cambiar sus datos de contacto/facturación
revoke insert, update, delete on public.perfiles from anon, authenticated;
grant update (nombre, empresa, nif, actualizado) on public.perfiles to authenticated;

-- Admins: solo los admins se ven a sí mismos
create policy admins_select on public.admins for select using (public.es_admin());

-- Obras: cada uno las suyas; el desbloqueo solo lo cambia el servidor
create policy obras_select on public.obras for select using (user_id = auth.uid() or public.es_admin());
create policy obras_insert on public.obras for insert with check (user_id = auth.uid() and desbloqueada = false);
create policy obras_update on public.obras for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy obras_delete on public.obras for delete using (user_id = auth.uid());
revoke update on public.obras from anon, authenticated;
grant update (titulo, datos, borrada, actualizada) on public.obras to authenticated;

-- Partidas propias
create policy pp_all on public.partidas_propias for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy pp_admin on public.partidas_propias for select using (public.es_admin());

-- Sugerencias: cualquiera con sesión puede enviar; solo admins leen y cambian el estado
create policy sug_insert on public.sugerencias for insert to authenticated with check (user_id = auth.uid());
create policy sug_select on public.sugerencias for select using (public.es_admin());
create policy sug_update on public.sugerencias for update using (public.es_admin());

-- Uso de IA: el usuario ve el suyo; lo escribe el servidor
create policy ia_select on public.ia_uso for select using (user_id = auth.uid() or public.es_admin());

-- ---------- Altas: crear el perfil al registrarse ----------
create or replace function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, empresa, nif)
  values (new.id, new.raw_user_meta_data->>'nombre', new.raw_user_meta_data->>'empresa', new.raw_user_meta_data->>'nif')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists al_registrarse on auth.users;
create trigger al_registrarse after insert on auth.users for each row execute function public.nuevo_usuario();

-- Teléfono verificado (Supabase Auth guarda phone_confirmed_at al verificar el SMS)
create or replace function public.telefono_confirmado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.phone_confirmed_at is not null and (old.phone_confirmed_at is null or old.phone is distinct from new.phone) then
    update public.perfiles set telefono = new.phone, telefono_verificado = true, actualizado = now() where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists al_verificar_telefono on auth.users;
create trigger al_verificar_telefono after update of phone_confirmed_at, phone on auth.users for each row execute function public.telefono_confirmado();

-- Panel de administración: resumen de usuarios (solo para admins)
create or replace function public.admin_usuarios()
returns table (id uuid, email text, nombre text, empresa text, nif text, telefono text, telefono_verificado boolean,
  plan text, pro_hasta timestamptz, gratis_usada boolean, creado timestamptz, obras bigint, obras_pagadas bigint,
  consultas_ia bigint, ultima_actividad timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo administradores'; end if;
  return query
  select p.id, u.email::text, p.nombre, p.empresa, p.nif, p.telefono, p.telefono_verificado, p.plan, p.pro_hasta, p.gratis_usada, p.creado,
    (select count(*) from public.obras o where o.user_id = p.id and not o.borrada),
    (select count(*) from public.obras o where o.user_id = p.id and o.desbloqueada),
    (select count(*) from public.ia_uso i where i.user_id = p.id),
    (select max(o.actualizada) from public.obras o where o.user_id = p.id)
  from public.perfiles p join auth.users u on u.id = p.id
  order by p.creado desc;
end $$;
revoke all on function public.admin_usuarios() from anon;
grant execute on function public.admin_usuarios() to authenticated;
