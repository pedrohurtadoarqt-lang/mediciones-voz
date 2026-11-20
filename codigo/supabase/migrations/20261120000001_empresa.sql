-- Datos de empresa en el registro y una cuenta por NIF/CIF (freno a registros automáticos y cuentas duplicadas)
alter table public.perfiles add column if not exists direccion text;
alter table public.perfiles add column if not exists telefono_contacto text;
grant update (direccion, telefono_contacto) on public.perfiles to authenticated;

-- Un NIF/CIF solo puede tener una cuenta (se crea el índice solo si no hay duplicados ya)
do $$
begin
  if not exists (
    select 1 from public.perfiles where coalesce(nif, '') <> ''
    group by upper(regexp_replace(nif, '[\s.-]', '', 'g')) having count(*) > 1
  ) then
    create unique index if not exists perfiles_nif_unico on public.perfiles (upper(regexp_replace(nif, '[\s.-]', '', 'g'))) where coalesce(nif, '') <> '';
  else
    raise notice 'Hay NIF repetidos: revisa la tabla perfiles antes de crear el índice único.';
  end if;
end $$;

-- Alta: se guardan dirección y teléfono, y se rechaza un NIF/CIF ya registrado
create or replace function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nif text := upper(regexp_replace(coalesce(new.raw_user_meta_data->>'nif', ''), '[\s.-]', '', 'g'));
begin
  if v_nif <> '' and exists (select 1 from public.perfiles where upper(regexp_replace(coalesce(nif, ''), '[\s.-]', '', 'g')) = v_nif) then
    raise exception 'NIF_DUPLICADO' using errcode = 'unique_violation';
  end if;
  insert into public.perfiles (id, nombre, empresa, nif, direccion, telefono_contacto)
  values (new.id, new.raw_user_meta_data->>'nombre', new.raw_user_meta_data->>'empresa', nullif(v_nif, ''),
          new.raw_user_meta_data->>'direccion', new.raw_user_meta_data->>'telefono_contacto')
  on conflict (id) do nothing;
  return new;
end $$;
