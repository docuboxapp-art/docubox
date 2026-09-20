import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/plantillas/nueva/page.tsx', 'utf8');
const gallery = readFileSync('src/app/plantillas/page.tsx', 'utf8');
const collectionApi = readFileSync('src/app/api/plantillas/route.ts', 'utf8');
const itemApi = readFileSync('src/app/api/plantillas/[id]/route.ts', 'utf8');
const contextApi = readFileSync('src/app/api/plantillas/publication-context/route.ts', 'utf8');
const server = readFileSync('src/lib/templates/publication-server.ts', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20260913055126_template_publication_context.sql',
  'utf8'
);
const approvalMigration = readFileSync(
  'supabase/migrations/20260913060728_template_approval_workflow_instance.sql',
  'utf8'
);

test('step 3 derives personal and business experiences from the active workspace', () => {
  assert.match(page, /workspaceType === 'personal'/);
  assert.match(page, /workspaceId: activeWorkspace\?\.id/);
  assert.match(contextApi, /workspaceType: context\.workspace\.workspace_type/);
  assert.doesNotMatch(server, /workspaceName.*toLowerCase|name.*personal/i);
});

test('personal mode hides area and approval while retaining draft and direct publish', () => {
  assert.match(page, /permissions\.canSaveDraft/);
  assert.match(page, /permissions\.canPublish/);
  assert.match(page, /permissions\.canSubmitApproval/);
  assert.match(server, /const personalOwner = !isBusiness/);
  assert.match(server, /const canSubmitApproval = isBusiness && approvalRequired/);
});

test('classification reuses organization units and document type catalogs', () => {
  assert.match(contextApi, /from\('organization_units'\)/);
  assert.match(contextApi, /from\('tipo_documento'\)/);
  assert.doesNotMatch(page, /const AREAS =/);
  assert.doesNotMatch(page, /const TIPOS_PLANTILLA =/);
});

test('step 3 does not repeat classification captured in general information', () => {
  const publicationStep = page.slice(
    page.indexOf('function StepPublicacion'),
    page.indexOf('// ─── Wizard Shell')
  );

  assert.doesNotMatch(publicationStep, />Clasificación</);
  assert.doesNotMatch(publicationStep, /Categoría \(opcional\)/);
  assert.match(page, /3: 'Elige cómo guardar o publicar la plantilla\.'/);
});

test('approval policy reuses the published organization default workflow', () => {
  assert.match(server, /settings\.default_workflow_id/);
  assert.match(server, /from\('organization_approval_workflows'\)/);
  assert.match(server, /\.eq\('status', 'published'\)/);
  assert.match(contextApi, /APPROVAL_REQUIRED/);
  assert.match(contextApi, /DIRECT_PUBLISH/);
});

test('approval submission starts and links the existing workflow runtime atomically', () => {
  assert.match(server, /submit_template_for_approval/);
  assert.match(collectionApi, /startTemplateApprovalWorkflow/);
  assert.match(itemApi, /startTemplateApprovalWorkflow/);
  assert.match(approvalMigration, /public\.start_organization_workflow_instance/);
  assert.match(approvalMigration, /approval_workflow_instance_id = instance_id/);
  assert.match(approvalMigration, /template_record\.created_by <> auth\.uid\(\)/);
});

test('publication permission is enforced in the backend', () => {
  assert.match(server, /requested_permission: 'resources\.manage'/);
  assert.match(server, /template_publish_forbidden/);
  assert.match(server, /template_approval_unavailable/);
  assert.match(server, /template_review_in_progress/);
  assert.match(collectionApi, /assertTemplateActionAllowed\(context, action, true\)/);
  assert.match(itemApi, /assertTemplateActionAllowed\(context, action, false\)/);
});

test('template status is derived server-side from the selected action', () => {
  assert.match(server, /deriveTemplateState/);
  assert.match(server, /estado: 'draft'/);
  assert.match(server, /estado: 'in_review'/);
  assert.match(server, /estado: 'published'/);
  assert.doesNotMatch(collectionApi, /body\.estado\b/);
});

test('initial creation cannot invoke versioning', () => {
  assert.match(server, /if \(creating \|\| !context\.canCreateVersion\)/);
  assert.match(page, /if \(isPublishedTemplate\)/);
  assert.match(page, /title: 'Actualizar la versión actual'/);
  assert.match(page, /title: 'Crear una nueva versión'/);
  assert.doesNotMatch(page, /Duplicar como nueva versión/);
});

test('published templates are immutable and create related policy-aware versions', () => {
  assert.match(itemApi, /published_template_is_immutable/);
  assert.match(itemApi, /source_template_id: source\.id/);
  assert.match(itemApi, /root_template_id: rootTemplateId/);
  assert.match(itemApi, /resolveTemplateVersionTarget\(context, body\.versionTargetAction\)/);
  assert.match(server, /if \(context\.canPublish\) return 'publicar'/);
  assert.match(server, /if \(context\.canSubmitApproval\) return 'aprobacion'/);
  assert.match(migration, /source_template_id UUID REFERENCES public\.plantillas/);
  assert.match(migration, /root_template_id UUID REFERENCES public\.plantillas/);
});

test('new versions publish by default without bypassing draft and approval intents', () => {
  assert.match(page, /versionTargetAction:/);
  assert.match(page, /Guardar nueva versión como borrador/);
  assert.match(page, /Publicar nueva versión/);
  assert.match(page, /Enviar nueva versión a aprobación/);
  assert.match(itemApi, /versionTarget === 'aprobacion'/);
  assert.match(itemApi, /startTemplateApprovalWorkflow/);
});

test('published templates can replace the visible revision or increment the version number', () => {
  assert.match(page, /'actualizar', 'version'/);
  assert.match(itemApi, /action === 'actualizar'/);
  assert.match(itemApi, /source\.version_publicada \|\| '1\.0'/);
  assert.match(itemApi, /nextTemplateVersion/);
  assert.match(itemApi, /version_mode: action === 'actualizar' \? 'replace' : 'increment'/);
});

test('selecting publish on a draft does not misclassify it as an existing published template', () => {
  const publishedDetection = page.slice(
    page.indexOf('const isExistingPublishedTemplate = Boolean'),
    page.indexOf('useEffect(() =>', page.indexOf('const isExistingPublishedTemplate = Boolean'))
  );
  assert.match(publishedDetection, /publicationContext\?\.template\?\.status === 'published'/);
  assert.doesNotMatch(publishedDetection, /pubData\.estadoPlantilla/);
  assert.match(page, /!text-xs !font-normal/);
});

test('version numbers are assigned automatically and cannot be edited in the UI', () => {
  assert.match(server, /nextTemplateVersion/);
  assert.match(page, /La versión se asigna automáticamente/);
  assert.match(page, /value=\{versionValue\}[\s\S]*?readOnly[\s\S]*?disabled/);
});

test('template API requests are bound to the selected workspace', () => {
  assert.match(server, /workspace_access_denied/);
  assert.match(server, /\.eq\('workspace_id', workspaceId\)/);
  assert.match(gallery, /workspace_id: activeWorkspaceId/);
  assert.match(collectionApi, /workspace_id: workspaceId/);
});

test('organization publication actions append events to the existing audit system', () => {
  assert.match(server, /from\('organization_audit_events'\)/);
  assert.match(server, /template\.draft\.saved/);
  assert.match(server, /template\.submitted_for_approval/);
  assert.match(server, /template\.published/);
  assert.match(itemApi, /template\.version\.created/);
  assert.match(itemApi, /template\.classification\.changed/);
});
