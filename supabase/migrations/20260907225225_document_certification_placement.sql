alter table public.documentos
  add column if not exists sello_ubicacion text not null default 'calce';

alter table public.documentos
  drop constraint if exists documentos_sello_ubicacion_check;

alter table public.documentos
  add constraint documentos_sello_ubicacion_check
  check (sello_ubicacion in ('calce', 'libre'));

comment on column public.documentos.sello_ubicacion is
  'Ubicacion visible de la Cadena Original y el Sello Digital Docubox: al calce o mediante campos libres.';
