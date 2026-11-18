import { readFile } from 'node:fs/promises';
import { initializeColaboraFixture } from './colabora-postgres-fixture.mjs';
export async function initializeOrganizationScopesFixture(db) {
  await initializeColaboraFixture(db);
  await db.exec(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text,ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
 ALTER TABLE organization_roles ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'organization',ADD COLUMN IF NOT EXISTS scope_config jsonb NOT NULL DEFAULT '{}';
 ALTER TABLE organization_units ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',ADD COLUMN IF NOT EXISTS unit_type text DEFAULT 'team';
 CREATE TABLE organization_unit_members(unit_id uuid,member_id uuid,PRIMARY KEY(unit_id,member_id));
 ALTER TABLE tareas ADD COLUMN IF NOT EXISTS created_by uuid,ADD COLUMN IF NOT EXISTS assigned_to uuid;
 ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS workspace_id uuid,ADD COLUMN IF NOT EXISTS tarea_id uuid,ADD COLUMN IF NOT EXISTS author_id uuid;
 CREATE TABLE task_checklist_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,tarea_id uuid);
 CREATE TABLE task_attachments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,tarea_id uuid,uploaded_by uuid);
 CREATE TABLE task_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,tarea_id uuid,actor_id uuid);
 CREATE TABLE task_dependencies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,tarea_id uuid,depends_on_id uuid);`);
  const external = await readFile(
    'supabase/migrations/20260816140000_colabora_external_and_automation.sql',
    'utf8'
  );
  await db.exec(
    external.slice(0, external.indexOf('ALTER TABLE public.collaboration_rooms ENABLE'))
  );
  await db.exec(`GRANT USAGE ON SCHEMA auth TO authenticated;GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
 DO $$DECLARE t text;BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'collaboration_%' OR tablename LIKE 'task_%' OR tablename='tareas') LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY fixture_existing_read ON public.%I FOR SELECT TO authenticated USING(true)',t);END LOOP;END$$;`);
  await db.exec(
    await readFile(
      'supabase/migrations/20261118041214_organization_scoped_resource_access.sql',
      'utf8'
    )
  );
  await db.exec(`ALTER TABLE task_checklist_items ADD COLUMN IF NOT EXISTS created_by uuid;
    CREATE TABLE organization_approval_workflows(id uuid PRIMARY KEY,workspace_id uuid,created_by uuid,status text);
    CREATE TABLE organization_member_offboarding_jobs(id uuid PRIMARY KEY,workspace_id uuid,requested_by uuid,status text);`);
  await db.exec(
    await readFile(
      'supabase/migrations/20261118054913_organization_worker_permissions_and_task_details.sql',
      'utf8'
    )
  );
  const taskModule = await readFile(
    'supabase/migrations/20260524030000_pending_tasks_module.sql',
    'utf8'
  );
  for (const name of ['tarea_estado', 'tarea_prioridad']) {
    const definition = taskModule.match(
      new RegExp(`CREATE TYPE public\\.${name} AS ENUM \\([\\s\\S]*?\\);`)
    );
    if (!definition) throw new Error('Missing canonical task enum');
    await db.exec(definition[0]);
  }
  await db.exec(`ALTER TABLE tareas ALTER COLUMN estado TYPE public.tarea_estado USING estado::public.tarea_estado;
    ALTER TABLE tareas ADD COLUMN IF NOT EXISTS title text DEFAULT 'Synthetic',ADD COLUMN IF NOT EXISTS is_blocked boolean DEFAULT false,ADD COLUMN IF NOT EXISTS blocked_reason text,ADD COLUMN IF NOT EXISTS due_date timestamptz,ADD COLUMN IF NOT EXISTS prioridad public.tarea_prioridad DEFAULT 'media',ADD COLUMN IF NOT EXISTS completed_at timestamptz,ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
    ALTER TABLE tareas ADD COLUMN IF NOT EXISTS responsible_name text,ADD COLUMN IF NOT EXISTS is_critical boolean DEFAULT false;
    ALTER TABLE tareas ADD COLUMN IF NOT EXISTS origin text DEFAULT 'manual',ADD COLUMN IF NOT EXISTS tipo text DEFAULT 'revisar_documento',ADD COLUMN IF NOT EXISTS source_type text,ADD COLUMN IF NOT EXISTS source_id uuid,ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,ADD COLUMN IF NOT EXISTS resolution_note text;
    ALTER TABLE task_checklist_items ADD COLUMN IF NOT EXISTS done boolean DEFAULT false;
    ALTER TABLE task_history ADD COLUMN IF NOT EXISTS action text,ADD COLUMN IF NOT EXISTS actor_name text,ADD COLUMN IF NOT EXISTS metadata jsonb;`);
  await db.exec(
    await readFile('supabase/migrations/20261118055514_colabora_atomic_task_actions.sql', 'utf8')
  );
  await db.exec(
    await readFile(
      'supabase/migrations/20261118063411_organization_permission_query_optimization.sql',
      'utf8'
    )
  );
  await db.exec(`CREATE TABLE organization_directory_people(id uuid PRIMARY KEY,workspace_id uuid);
    CREATE TABLE organization_directory_evidence(id uuid PRIMARY KEY,workspace_id uuid,person_id uuid,evidence_type text,display_name text,storage_bucket text,storage_path text,mime_type text,size_bytes bigint,sha256_hash text,valid_from date,valid_until date,status text,metadata jsonb,version integer,created_by uuid,UNIQUE(person_id,evidence_type,version));
    ALTER TABLE organization_audit_events ADD COLUMN severity text;`);
  await db.exec(
    await readFile(
      'supabase/migrations/20261118063916_organization_directory_upload_finalize.sql',
      'utf8'
    )
  );
}
