-- System definitions are shared by all registered users. User definitions remain in
-- their workspace and store their chosen fields, conditions and presentation.
create table public.report_system_presets (
  id text primary key check (id ~ '^docubox-[a-z0-9-]+$'),
  name text not null check (char_length(btrim(name)) between 3 and 120),
  description text not null default '',
  dataset text not null check (dataset in (
    'documentos','plantillas','formularios','respuestas','expedientes','tareas',
    'participantes','actividad','usuarios','contactos','certificaciones','notificaciones',
    'colaboracion','firmas_masivas'
  )),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  listed boolean not null default true,
  sort_order smallint not null
);

alter table public.report_system_presets enable row level security;
revoke all on public.report_system_presets from public, anon, authenticated;
grant select on public.report_system_presets to authenticated, service_role;

create policy registered_users_read_report_presets on public.report_system_presets
  for select to authenticated using (
    (select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false'
  );

alter table public.report_definitions
  drop constraint report_definitions_dataset_check,
  add constraint report_definitions_dataset_check check (dataset in (
    'documentos','plantillas','formularios','respuestas','expedientes','tareas',
    'participantes','actividad','usuarios','contactos','certificaciones','notificaciones',
    'colaboracion','firmas_masivas'
  ));

-- Require a current membership for reads and writes without altering legacy report rows.
create policy report_definitions_current_membership on public.report_definitions
  as restrictive for all to authenticated using (
    coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false'
    and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = report_definitions.workspace_id and m.user_id = (select auth.uid())
        and m.status = 'active' and (m.access_expires_at is null or m.access_expires_at > now())
    )
  );

-- The existing update policy cannot be used to reassign a report to another owner or workspace.
revoke update on public.report_definitions from authenticated;
grant update (name, description, dataset, config) on public.report_definitions to authenticated;

alter table public.report_definitions
  add constraint report_definitions_config_object check (jsonb_typeof(config) = 'object') not valid;


insert into public.report_system_presets (id, name, description, dataset, config, listed, sort_order) values
  ('docubox-documentos', 'Estado de documentos', 'Volumen y situación de documentos del espacio.', 'documentos', '{"fields":["nombre","folio","descripcion","estado","tipo"],"conditions":[],"match":"all","period":"all","dateField":"creado","visualization":"bar","groupBy":"estado","metric":"__count","sortBy":"creado","sortDirection":"desc"}'::jsonb, true, 1),
  ('docubox-vencimientos', 'Documentos con vencimiento', 'Consulta los documentos con fecha de vencimiento, ordenados por el plazo más próximo.', 'documentos', '{"fields":["nombre","estado","propietario","vence"],"conditions":[{"field":"vence","operator":"not_empty","value":""}],"match":"all","period":"all","dateField":"creado","visualization":"table","groupBy":"","metric":"__count","sortBy":"vence","sortDirection":"asc"}'::jsonb, true, 2),
  ('docubox-firmas', 'Participación y firmas', 'Estado de las personas invitadas a documentos.', 'participantes', '{"fields":["nombre","correo","rol","estado","recurso"],"conditions":[{"field":"modulo","operator":"eq","value":"Documentos"}],"match":"all","period":"all","dateField":"creado","visualization":"table","groupBy":"estado","metric":"__count","sortBy":"creado","sortDirection":"desc"}'::jsonb, true, 3),
  ('docubox-formularios', 'Formularios y respuestas', 'Número de respuestas recibidas por formulario.', 'formularios', '{"fields":["nombre","estado","respuestas","creador","publicado"],"conditions":[],"match":"all","period":"all","dateField":"creado","visualization":"bar","groupBy":"nombre","metric":"respuestas","sortBy":"creado","sortDirection":"desc"}'::jsonb, true, 4),
  ('docubox-respuestas', 'Respuestas capturadas', 'Registro de respuestas recibidas y documentos generados.', 'respuestas', '{"fields":["formulario","participante","correo","documento","enviado","estado"],"conditions":[],"match":"all","period":"all","dateField":"enviado","visualization":"table","groupBy":"formulario","metric":"__count","sortBy":"enviado","sortDirection":"desc"}'::jsonb, true, 5),
  ('docubox-expedientes', 'Avance de expedientes', 'Estado y progreso de los expedientes.', 'expedientes', '{"fields":["folio","nombre","estado","progreso","objetivo"],"conditions":[],"match":"all","period":"all","dateField":"creado","visualization":"table","groupBy":"estado","metric":"__count","sortBy":"creado","sortDirection":"desc"}'::jsonb, true, 6),
  ('docubox-tareas', 'Tareas y plazos', 'Acciones y actividades pendientes o concluidas.', 'tareas', '{"fields":["nombre","estado","prioridad","responsable","vence"],"conditions":[],"match":"all","period":"all","dateField":"creado","visualization":"table","groupBy":"","metric":"__count","sortBy":"creado","sortDirection":"desc"}'::jsonb, false, 7),
  ('docubox-tareas-abiertas', 'Tareas abiertas', 'Trabajo pendiente, en curso o vencido del espacio.', 'tareas', '{"fields":["nombre","tipo","estado","prioridad","responsable","vence"],"conditions":[{"field":"estado","operator":"neq","value":"completada"},{"field":"estado","operator":"neq","value":"cancelada"},{"field":"estado","operator":"neq","value":"rechazada"}],"match":"all","period":"all","dateField":"creado","visualization":"table","groupBy":"","metric":"__count","sortBy":"vence","sortDirection":"asc"}'::jsonb, true, 8),
  ('docubox-actividad', 'Actividad y auditoría', 'Eventos de documentos, formularios, expedientes y tareas del espacio.', 'actividad', '{"fields":["accion","modulo","actor","documento","fecha"],"conditions":[{"field":"modulo","operator":"neq","value":"Acceso"}],"match":"all","period":"all","dateField":"fecha","visualization":"table","groupBy":"","metric":"__count","sortBy":"fecha","sortDirection":"desc"}'::jsonb, true, 9),
  ('docubox-plantillas', 'Plantillas documentales', 'Inventario y configuración de plantillas.', 'plantillas', '{"fields":["nombre","categoria","estado","creador","actualizado"],"conditions":[],"match":"all","period":"all","dateField":"creado","visualization":"table","groupBy":"estado","metric":"__count","sortBy":"creado","sortDirection":"desc"}'::jsonb, true, 10),
  ('docubox-certificaciones', 'Estado de certificaciones', 'Seguimiento de los casos de certificación.', 'certificaciones', '{"fields":["folio","nombre","servicio","estado","creado","emitido"],"conditions":[],"match":"all","period":"all","dateField":"creado","visualization":"table","groupBy":"estado","metric":"__count","sortBy":"creado","sortDirection":"desc"}'::jsonb, true, 11),
  ('docubox-notificaciones', 'Avisos recibidos', 'Notificaciones y recordatorios del usuario.', 'notificaciones', '{"fields":["titulo","categoria","prioridad","leida","creado"],"conditions":[],"match":"all","period":"all","dateField":"creado","visualization":"table","groupBy":"","metric":"__count","sortBy":"creado","sortDirection":"desc"}'::jsonb, false, 12),
  ('docubox-contactos', 'Directorio de contactos', 'Contactos registrados por el usuario.', 'contactos', '{"fields":["nombre","correo","telefono","tipo","creado"],"conditions":[],"match":"all","period":"all","dateField":"creado","visualization":"table","groupBy":"","metric":"__count","sortBy":"nombre","sortDirection":"asc"}'::jsonb, true, 13),
  ('docubox-firmas-masivas', 'Campañas de firma', 'Documentos completados, pendientes y fallidos por campaña.', 'firmas_masivas', '{"fields":["nombre","estado","total","completados","pendientes","fallidos","creado"],"conditions":[],"match":"all","period":"all","dateField":"creado","visualization":"table","groupBy":"","metric":"__count","sortBy":"creado","sortDirection":"desc"}'::jsonb, true, 14);
