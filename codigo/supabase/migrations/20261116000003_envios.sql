-- Mediciona · registro de envíos de archivos por correo
create table if not exists public.envios (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  obra_id text,
  archivos text[] not null default '{}',
  bytes int,
  estado text not null default 'enviado',
  creado timestamptz not null default now()
);
create index if not exists envios_user_idx on public.envios(user_id, creado desc);
alter table public.envios enable row level security;
drop policy if exists envios_select on public.envios;
create policy envios_select on public.envios for select using (user_id = auth.uid() or public.es_admin());
