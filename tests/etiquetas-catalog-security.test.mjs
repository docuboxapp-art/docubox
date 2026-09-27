import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const seed = await read('../supabase/migrations/20260326040000_etiquetas_table.sql');
const restriction = await read(
  '../supabase/migrations/20260924174932_restrict_system_etiquetas_writes.sql'
);

test('the shared label catalog remains readable but not directly writable by app users', () => {
  assert.equal((seed.match(/^  \('/gm) ?? []).length, 91);
  assert.match(restriction, /DROP POLICY IF EXISTS "authenticated_manage_etiquetas" ON public\.etiquetas/);
  assert.match(restriction, /REVOKE ALL ON TABLE public\.etiquetas/);
  assert.match(restriction, /FROM PUBLIC, anon, authenticated/);
  assert.match(restriction, /GRANT SELECT ON TABLE public\.etiquetas TO authenticated/);
  assert.doesNotMatch(restriction, /REVOKE[^;]*service_role/);
  assert.doesNotMatch(restriction, /DROP POLICY.*read_etiquetas/);
});
