-- Set docubox.example_workspace before this script. Deliberately opt-in and idempotent.
-- Creates examples in one organization, never users, invitations or role assignments.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '45s';
DO $examples$
DECLARE ws uuid := nullif(current_setting('docubox.example_workspace', true), '')::uuid;
  owner_user uuid; owner_member uuid; center uuid; parent_unit uuid; unit_id uuid;
  role_id uuid; permission_ids uuid[]; item record;
BEGIN
  SELECT w.owner_id, m.id INTO owner_user, owner_member
    FROM public.workspaces w JOIN public.workspace_members m
      ON m.workspace_id=w.id AND m.user_id=w.owner_id AND m.role='owner' AND m.status='active'
    WHERE w.id=ws AND w.workspace_type='business';
  IF owner_member IS NULL THEN RAISE EXCEPTION 'Select an organization with an active owner'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('docubox:organization-examples:'||ws::text, 0));
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',owner_user,'role','authenticated')::text, true);
  SELECT id INTO center FROM public.organization_cost_centers WHERE workspace_id=ws AND code='EJ-OP';
  IF center IS NULL THEN
    INSERT INTO public.organization_cost_centers(workspace_id,code,name,description,currency,owner_member_id)
      VALUES(ws,'EJ-OP','Operación · Ejemplo','Centro de costo de ejemplo para los equipos de operación.','MXN',owner_member)
      RETURNING id INTO center;
    INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,module)
      VALUES(ws,owner_user,'organization.example.created','organization_cost_center',center::text,'Centro de costo de ejemplo creado','teams');
  END IF;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT id INTO parent_unit FROM public.organization_units WHERE workspace_id=ws AND internal_key='EJ-OPERACIONES';
  IF parent_unit IS NULL THEN
    parent_unit := public.save_organization_unit_bundle(ws,jsonb_build_object(
      'name','Operaciones · Ejemplo','internal_key','EJ-OPERACIONES','unit_type','area',
      'description','Área de ejemplo. Puedes editarla para adaptarla a tu organización.',
      'leader_member_id',owner_member,'cost_center_id',center),ARRAY[owner_member]);
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('Legal · Ejemplo','EJ-LEGAL','Revisión de contratos y documentación legal.'),
    ('Administración · Ejemplo','EJ-ADMIN','Coordinación de documentación y seguimiento interno.'),
    ('Compras · Ejemplo','EJ-COMPRAS','Integración y seguimiento de expedientes de proveedores.')
  ) AS examples(name,internal_key,description) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.organization_units WHERE workspace_id=ws AND internal_key=item.internal_key) THEN
      unit_id := public.save_organization_unit_bundle(ws,jsonb_build_object(
        'name',item.name,'internal_key',item.internal_key,'unit_type','team','description',item.description,
        'parent_id',parent_unit,'leader_member_id',owner_member,'cost_center_id',center),ARRAY[owner_member]);
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM (VALUES
    ('Gestión de equipos · Ejemplo','Permite organizar equipos y consultar miembros. No administra roles ni seguridad.',
      ARRAY['teams.read','teams.manage','members.read']::text[]),
    ('Consulta organizacional · Ejemplo','Consulta de la organización, miembros, equipos, roles y directorio. Sin permisos de modificación.',
      ARRAY['organization.read','members.read','teams.read','roles.read','directory.read']::text[])
  ) AS examples(name,description,permission_keys) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.organization_roles WHERE workspace_id=ws AND name=item.name) THEN
      SELECT array_agg(id) INTO permission_ids FROM public.organization_permissions WHERE permission_key=ANY(item.permission_keys);
      IF cardinality(permission_ids)<>cardinality(item.permission_keys) THEN RAISE EXCEPTION 'Example permission catalog is incomplete'; END IF;
      role_id := public.save_organization_role_bundle(ws,jsonb_build_object(
        'name',item.name,'description',item.description,'scope_type','organization','scope_config','{}'::jsonb),permission_ids);
    END IF;
  END LOOP;
END $examples$;
COMMIT;
