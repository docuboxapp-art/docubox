// Isolated schema fixture, assembled from the project's existing migrations.
// No connection to Supabase, emails, storage providers or real user accounts.
import { readFile } from 'node:fs/promises';
export async function initializeColaboraFixture(db) {
  await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION public.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql AS $$SELECT substring(decode(string_agg(md5(random()::text),''),'hex') FROM 1 FOR n) FROM generate_series(1,(n+15)/16)$$;
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,email text,full_name text);
 CREATE TABLE public.workspaces(id uuid PRIMARY KEY,owner_id uuid,name text,workspace_type text,organization_enabled boolean DEFAULT true);
 CREATE TABLE public.workspace_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,user_id uuid,role text,status text,access_expires_at timestamptz);
 CREATE TABLE public.organization_units(id uuid PRIMARY KEY,workspace_id uuid);
 CREATE TABLE public.organization_roles(id uuid PRIMARY KEY,workspace_id uuid,status text);
 CREATE TABLE public.organization_member_roles(workspace_id uuid,member_id uuid,role_id uuid);
 CREATE TABLE public.organization_role_permissions(role_id uuid,permission_id uuid);
 CREATE TABLE public.organization_permissions(id uuid PRIMARY KEY,permission_key text);
 CREATE TABLE public.case_files(id uuid PRIMARY KEY,workspace_id uuid);
 CREATE TABLE public.tareas(id uuid PRIMARY KEY,workspace_id uuid,estado text,optimistic_version integer DEFAULT 1,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.task_comments(id uuid PRIMARY KEY);
 CREATE TABLE public.documentos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),documento_id text NOT NULL,owner_id uuid NOT NULL,workspace_id uuid,nombre text NOT NULL,descripcion text,file_name text NOT NULL,file_size bigint,file_type text,file_hash_sha256 text NOT NULL,file_url text,ruta_guardado text,estado text DEFAULT 'borrador',es_publico boolean DEFAULT false,participantes jsonb DEFAULT '[]',deleted_at timestamptz);
 CREATE TABLE public.organization_audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,actor_user_id uuid,event_type text,resource_type text,resource_id uuid,summary text,payload jsonb DEFAULT '{}',module text);
 `);
  const formSql = await readFile(
    'supabase/migrations/20260511200000_form_builder_module.sql',
    'utf8'
  );
  await db.exec(formSql.slice(0, formSql.indexOf('-- Indexes')));
  await db.exec(`ALTER TABLE form_templates ADD COLUMN version_number integer DEFAULT 1,ADD COLUMN revision_number integer DEFAULT 1,ADD COLUMN allowed_signature_types text[] DEFAULT ARRAY['click_sign'];
 ALTER TABLE form_tokens ADD COLUMN recipient_user_id uuid,ADD COLUMN access_mode text DEFAULT 'private',ADD COLUMN signature_type text,ADD COLUMN require_liveness boolean DEFAULT false,ADD COLUMN launched_by_user_id uuid,ADD COLUMN launcher_name text,ADD COLUMN sent_to_self boolean DEFAULT false;
 ALTER TABLE form_responses ADD COLUMN status text DEFAULT 'submitted';`);
  const reviews = await readFile(
    'supabase/migrations/20260816120000_colabora_tasks_and_reviews.sql',
    'utf8'
  );
  await db.exec(
    reviews.slice(
      0,
      reviews.indexOf('ALTER TABLE public.task_collaborators ENABLE ROW LEVEL SECURITY')
    )
  );
  const spaces = await readFile(
    'supabase/migrations/20260816130000_colabora_spaces_and_requests.sql',
    'utf8'
  );
  await db.exec(spaces.slice(0, spaces.indexOf('CREATE OR REPLACE FUNCTION')));
  const external = await readFile(
    'supabase/migrations/20260816150000_colabora_request_external_access.sql',
    'utf8'
  );
  await db.exec(
    external.slice(
      0,
      external.indexOf('ALTER TABLE public.collaboration_request_external_sessions ENABLE')
    )
  );
  await db.exec(
    await readFile(
      'supabase/migrations/20260816180000_colabora_request_file_incorporation.sql',
      'utf8'
    )
  );
  await db.exec(
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;'
  );
  await db.exec(
    await readFile(
      'supabase/migrations/20261118005751_colabora_request_forms_and_delivery.sql',
      'utf8'
    )
  );
}
