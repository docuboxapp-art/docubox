import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260831195059_platform_control_plane_access.sql');
const access = read('src/lib/platform-admin/access.ts');
const layout = read('src/app/superadmin/layout.tsx');
const legacyPage = read('src/app/superadmin/[[...section]]/page.tsx');
const adminPage = read('src/app/admin/[[...section]]/page.tsx');
const panelPage = read('src/app/panel/[[...section]]/page.tsx');
const page = read('src/components/platform-admin/PlatformAdminPage.tsx');
const dataTable = read('src/components/platform-admin/PlatformDataTable.tsx');
const navigation = read('src/lib/platform-admin/navigation.ts');
const authorization = read('src/lib/platform-admin/authorization.ts');
const foundation = read('supabase/migrations/20260831214500_platform_control_plane_foundation.sql');
const core = read('supabase/migrations/20260901013553_core_superadmin_permissions_and_actions.sql');
const middleware = read('src/middleware.ts');

test('platform staff and permissions are separate from tenant roles', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.platform_staff/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.platform_roles/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.platform_permissions/);
  assert.doesNotMatch(access, /workspace_members|organization_roles|user_metadata|app_metadata/);
});

test('platform tables are service-only with RLS enabled', () => {
  for (const table of [
    'platform_permissions',
    'platform_roles',
    'platform_role_permissions',
    'platform_staff',
    'platform_support_access_requests',
    'platform_audit_events',
    'platform_support_tickets',
    'platform_incidents',
    'platform_provider_registry',
    'platform_feature_flags',
    'platform_feature_flag_tenant_overrides',
  ]) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON public\\.${table} FROM PUBLIC, anon, authenticated`)
    );
  }
});

test('audit events are append-only', () => {
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.platform_audit_events/);
  assert.match(migration, /platform_audit_events is append-only/);
});

test('support access requires ticket, reason, approval and bounded duration', () => {
  assert.match(migration, /ticket_reference TEXT NOT NULL/);
  assert.match(migration, /length\(trim\(reason\)\) >= 20/);
  assert.match(migration, /approved_by IS NOT NULL AND approved_at IS NOT NULL/);
  assert.match(migration, /starts_at IS NOT NULL AND expires_at IS NOT NULL/);
});

test('canonical admin shell is independent from tenant AppLayout', () => {
  assert.doesNotMatch(layout, /AppLayout|TopNav|OrganizationShell/);
  assert.match(panelPage, /SuperadminShell/);
  assert.match(panelPage, /redirect\('\/login\?redirect=\/panel'\)/);
  assert.match(adminPage, /redirect\(`\/panel\$\{suffix\}`\)/);
  assert.match(legacyPage, /redirect\(`\/panel\$\{suffix\}`\)/);
  assert.match(middleware, /isLegacyAdminPath/);
  assert.match(middleware, /panelUrl\.pathname = `\/panel/);
  assert.match(middleware, /admin\/security\/crypto-e2e/);
});

test('every module route is protected by its own permission', () => {
  assert.match(page, /hasPlatformPermission\(access, navItem\.permission\)/);
  assert.match(authorization, /permissions\.includes\('\*'\)/);
  assert.match(access, /get_platform_staff_access/);
});

test('platform identity reports confirmed TOTP enrollment without hiding the internal role', () => {
  assert.match(migration, /user_totp_settings totp/);
  assert.match(migration, /totp\.confirmed_at IS NOT NULL/);
  assert.match(migration, /'totp_enrolled', totp_enrolled/);
  assert.match(core, /'passkey_enrolled', passkey_enrolled/);
  assert.match(core, /'passkey_required', true/);
  assert.match(access, /hasConfirmedTotp/);
  assert.match(access, /hasActivePasskey/);
});

test('document operations expose metadata but no customer content action', () => {
  assert.match(dataTable, /Contenido protegido/);
  assert.match(dataTable, /Esta vista no permite abrir ni descargar archivos de clientes/);
  assert.doesNotMatch(page, /viewer-file|visor-documento|signed_url|createSignedUrl/);
});

test('Control Plane navigation includes all operational areas', () => {
  for (const label of [
    'Clientes',
    'Producto',
    'Finanzas',
    'Consumos',
    'Operación',
    'Firma y certificación',
    'Identidad',
    'Notificaciones',
    'Soporte',
    'Integraciones',
    'Seguridad',
    'Infraestructura',
    'Auditoría',
    'Administración',
  ]) {
    assert.match(navigation, new RegExp(label));
  }
});

test('core lifecycle controls remain backend-only and deny tenant sessions', () => {
  for (const table of [
    'platform_organization_controls',
    'platform_user_controls',
    'platform_alerts',
  ]) {
    assert.match(core, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(
      core,
      new RegExp(`REVOKE ALL ON public\\.${table} FROM PUBLIC, anon, authenticated`)
    );
  }
});

test('core uses granular permissions and never grants document content access', () => {
  for (const permission of [
    'organization.read',
    'document.metadata.read',
    'document.integrity.read',
    'kms.read',
    'approval.approve',
  ]) {
    assert.match(core, new RegExp(`'${permission.replaceAll('.', '\\.')}'`));
  }
  assert.doesNotMatch(core, /'document\.content\.read'/);
});

test('central authorization combines RBAC, step-up, approval and tenant-bound support scope', () => {
  assert.match(authorization, /authorizePlatformAction/);
  assert.match(authorization, /STEP_UP_REQUIRED/);
  assert.match(authorization, /APPROVAL_REQUIRED/);
  assert.match(authorization, /SUPPORT_SCOPE_REQUIRED/);
  assert.match(authorization, /TENANT_SCOPE_MISMATCH/);
  assert.match(authorization, /ADMIN_CONTENT_ACCESS_DENIED/);
  assert.doesNotMatch(authorization, /workspace_members|organization_roles/);
});

test('critical actions use four-eyes approvals and bounded privileged sessions', () => {
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS public\.platform_admin_approvals/);
  assert.match(foundation, /approved_by <> requested_by/);
  assert.match(
    foundation,
    /CREATE TABLE IF NOT EXISTS public\.platform_privileged_access_sessions/
  );
  assert.match(foundation, /expires_at <= starts_at \+ INTERVAL '4 hours'/);
  assert.match(foundation, /sessions\.workspace_id = p_workspace_id/);
  assert.match(foundation, /p_permission = ANY\(sessions\.permissions\)/);
});

test('security events are append-only and operational sources never expose secrets', () => {
  assert.match(foundation, /platform_security_events is append-only/);
  assert.match(foundation, /platform_provider_credentials_metadata/);
  assert.match(foundation, /masked_identifier/);
  assert.match(foundation, /secret_store_reference/);
  assert.doesNotMatch(foundation, /secret_value|private_key_pem|access_token TEXT/);
});

test('provider and crypto views never render secret values', () => {
  assert.doesNotMatch(
    page,
    /process\.env|authorization|access_token|refresh_token|private_key|service_role/i
  );
});

test('feature flags support global, plan and tenant scopes', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.platform_feature_flags/);
  assert.match(migration, /rollout_percentage SMALLINT/);
  assert.match(migration, /allowed_plans TEXT\[\]/);
  assert.match(migration, /platform_feature_flag_tenant_overrides/);
});
