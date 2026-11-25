-- Caché compartida de la voz natural: frases ya generadas (solo la función «voz», con la clave de servicio)
insert into storage.buckets (id, name, public)
values ('voz', 'voz', false)
on conflict (id) do nothing;
