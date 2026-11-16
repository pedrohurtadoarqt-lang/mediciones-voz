-- ============================================================
-- Mediciona · coste de la IA por medición (obra) y totales
-- ============================================================
alter table public.ia_uso add column if not exists obra_id text;
alter table public.ia_uso add column if not exists coste_usd numeric(14,8);
create index if not exists ia_uso_obra_idx on public.ia_uso(obra_id);

-- Precio por modelo (USD por millón de tokens), lo mantiene el administrador
create table if not exists public.ia_precios (
  modelo text primary key,
  entrada_usd_millon numeric(12,6) not null check (entrada_usd_millon >= 0),
  salida_usd_millon numeric(12,6) not null check (salida_usd_millon >= 0),
  actualizado timestamptz not null default now()
);
alter table public.ia_precios enable row level security;
drop policy if exists precios_admin on public.ia_precios;
create policy precios_admin on public.ia_precios for all using (public.es_admin()) with check (public.es_admin());

-- Coste de una consulta: el guardado en el momento o, si no había precio, el precio actual
create or replace function public.coste_consulta(u public.ia_uso) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(u.coste_usd,
    (select (coalesce(u.tokens_entrada,0) * p.entrada_usd_millon + coalesce(u.tokens_salida,0) * p.salida_usd_millon) / 1000000.0
     from public.ia_precios p where p.modelo = u.modelo));
$$;

-- Coste por medición (obra)
create or replace function public.admin_ia_obras()
returns table (obra_id text, titulo text, email text, empresa text, consultas bigint, tokens_entrada bigint, tokens_salida bigint, coste_usd numeric, primera timestamptz, ultima timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo administradores'; end if;
  return query
  select i.obra_id, max(o.titulo), max(u.email::text), max(p.empresa), count(*), sum(i.tokens_entrada)::bigint, sum(i.tokens_salida)::bigint,
         sum(public.coste_consulta(i)), min(i.creado), max(i.creado)
  from public.ia_uso i
  left join public.obras o on o.id = i.obra_id
  left join auth.users u on u.id = i.user_id
  left join public.perfiles p on p.id = i.user_id
  group by i.obra_id
  order by max(i.creado) desc;
end $$;

-- Totales por periodo
create or replace function public.admin_ia_totales()
returns table (periodo text, consultas bigint, obras bigint, tokens_entrada bigint, tokens_salida bigint, coste_usd numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo administradores'; end if;
  return query
  with b as (select i.*, public.coste_consulta(i) as c from public.ia_uso i)
  select 'hoy', count(*), count(distinct b.obra_id), sum(b.tokens_entrada)::bigint, sum(b.tokens_salida)::bigint, sum(b.c) from b where b.creado >= date_trunc('day', now())
  union all
  select 'mes', count(*), count(distinct b.obra_id), sum(b.tokens_entrada)::bigint, sum(b.tokens_salida)::bigint, sum(b.c) from b where b.creado >= date_trunc('month', now())
  union all
  select 'total', count(*), count(distinct b.obra_id), sum(b.tokens_entrada)::bigint, sum(b.tokens_salida)::bigint, sum(b.c) from b;
end $$;

revoke all on function public.admin_ia_obras() from anon;
revoke all on function public.admin_ia_totales() from anon;
revoke all on function public.coste_consulta(public.ia_uso) from anon;
grant execute on function public.admin_ia_obras() to authenticated;
grant execute on function public.admin_ia_totales() to authenticated;
