import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const middleware = await read('../src/middleware.ts');
const participationsRoute = await read('../src/app/api/documentos/mis-participaciones/route.ts');
const ownerRoute = await read('../src/app/api/documentos/listar/route.ts');
const documentsPage = await read('../src/app/mis-documentos/page.tsx');
const documentSettingsStep = await read(
  '../src/app/crear-documento/components/StepAjustes.tsx'
);
const migration = await read(
  '../supabase/migrations/20260908181739_optimize_documentos_rls_and_plantillas_index.sql'
);
const sessionLockMigration = await read(
  '../supabase/migrations/20260908182213_optimize_session_policy_locking.sql'
);

test('middleware performs no remote authentication without session material', () => {
  assert.match(middleware, /if \(!hasSessionMaterial\(request\)\)/);
  assert.doesNotMatch(middleware, /supabase\.auth\.getUser\(\)/);
  assert.equal(middleware.match(/supabase\.rpc\('enforce_docubox_session_policy'/g)?.length, 1);
});

test('invalid refresh material is cleared instead of retried', () => {
  assert.match(middleware, /refresh_token_not_found/);
  assert.match(middleware, /hasMalformedSessionCookie/);
  assert.match(middleware, /error\.code === '42501'/);
  assert.match(middleware, /unauthenticatedResponse/);
  assert.doesNotMatch(middleware, /retry/i);
});

test('participant listing applies authenticated RLS before transferring documents', () => {
  assert.match(participationsRoute, /const supabase = userClient/);
  assert.match(participationsRoute, /createAnonClient\(bearerToken\)/);
  assert.doesNotMatch(
    participationsRoute,
    /createServiceClient\(\)[\s\S]{0,160}\.from\('documentos'\)/
  );
  assert.doesNotMatch(participationsRoute, /documentIds[\s\S]*document_user_visibility/);
});

test('owner listing uses the authenticated RLS client instead of service role', () => {
  assert.match(ownerRoute, /createAnonClient\(token\)/);
  assert.match(ownerRoute, /anonClient\.from\('documentos'\)/);
  assert.doesNotMatch(ownerRoute, /createServiceClient/);
  assert.doesNotMatch(ownerRoute, /user=\$\{user\.id\}/);
});

test('independent owner and participant document requests start in parallel', () => {
  assert.match(
    documentsPage,
    /const \[res, partRes\] = await Promise\.all\(\[[\s\S]*\/api\/documentos\/listar[\s\S]*\/api\/documentos\/mis-participaciones/
  );
});

test('view customization code loads only when its modal opens', () => {
  assert.match(
    documentsPage,
    /dynamic\(\s*\(\) => import\('\.\/components\/PersonalizarVistaModal'\)/
  );
  assert.match(documentsPage, /\{personalizarOpen && \(\s*<PersonalizarVistaModal/);
});

test('document settings renders PDF pages on demand', () => {
  assert.match(documentSettingsStep, /renderPdfPage\(currentPage\)/);
  assert.match(documentSettingsStep, /pdfDocumentRef\.current/);
  assert.match(documentSettingsStep, /pdfDocument\?\.destroy\?\.\(\)/);
  assert.doesNotMatch(documentSettingsStep, /for \(let i = 1; i <= maxPages; i\+\+\)/);
});

test('database optimization preserves owner semantics and removes only the duplicate index', () => {
  assert.match(migration, /USING \(\(SELECT auth\.uid\(\)\) = owner_id\)/);
  assert.match(migration, /WITH CHECK \(\(SELECT auth\.uid\(\)\) = owner_id\)/);
  assert.match(migration, /DROP INDEX IF EXISTS public\.idx_plantillas_status/);
  assert.doesNotMatch(migration, /DISABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(migration, /SECURITY DEFINER/i);
});

test('ordinary session checks do not serialize on a row lock', () => {
  assert.match(sessionLockMigration, /IF p_record_user_activity THEN[\s\S]*FOR UPDATE/);
  assert.match(
    sessionLockMigration,
    /ELSE\s+SELECT activity\.last_user_activity_at[\s\S]*activity\.user_id = v_user_id;\s+END IF;/
  );
  assert.match(sessionLockMigration, /IF NOT p_record_user_activity THEN[\s\S]*FOR UPDATE/);
  assert.match(sessionLockMigration, /session_timeout_inactivity/);
  assert.match(sessionLockMigration, /session_timeout_absolute/);
});
