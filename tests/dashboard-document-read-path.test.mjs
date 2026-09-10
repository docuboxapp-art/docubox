import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const [participationsRoute, documentsPage, migration] = await Promise.all([
  read('../src/app/api/documentos/mis-participaciones/route.ts'),
  read('../src/app/mis-documentos/page.tsx'),
  read('../supabase/migrations/20260910205339_optimize_document_list_read_path.sql'),
]);

test('dashboard participation summary keeps RLS and avoids profile work', () => {
  assert.match(participationsRoute, /const supabase = userClient/);
  assert.match(participationsRoute, /DASHBOARD_PARTICIPATION_SELECT/);
  assert.match(participationsRoute, /dashboardSummary\s*\?\s*\[\]/);
  assert.match(participationsRoute, /query = query\.neq\('owner_id', userId\)/);
  assert.doesNotMatch(
    participationsRoute,
    /createServiceClient\(\)[\s\S]{0,160}\.from\('documentos'\)/
  );
});

test('my documents does not request owned documents twice', () => {
  assert.match(documentsPage, /mis-participaciones\?exclude_owned=true/);
});

test('default workspace list has an active-owner recency index', () => {
  assert.match(migration, /ON public\.documentos \(owner_id, updated_at DESC\)/);
  assert.match(migration, /WHERE deleted_at IS NULL/);
  assert.doesNotMatch(migration, /DISABLE ROW LEVEL SECURITY/i);
});
