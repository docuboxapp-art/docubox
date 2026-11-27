import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(
  new URL('../supabase/functions/validate-case-file/handler.ts', import.meta.url),
  'utf8'
);
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { createCaseVerificationHandler } = await import(
  'data:text/javascript,' + encodeURIComponent(code)
);

const caseId = 'aaaaaaaa-0000-4000-8000-000000000001';
const certificate = {
  certificate_number: 'CONST-TEST',
  root_hash: 'f'.repeat(64),
  hash_algorithm: 'SHA-256',
  closed_at: '2026-11-24T00:00:00Z',
  workspace_id: 'workspace-a',
  case_files: {
    workspace_id: 'workspace-a',
    folio: 'EXP-TEST',
    title: 'Expediente sintético',
    case_type: 'acuerdo',
    status: 'sealed',
  },
};

function request({ token = 'fixture-token', id = caseId } = {}) {
  return new Request('http://localhost/functions/v1/validate-case-file', {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: JSON.stringify({ case_file_id: id }),
  });
}

function fixture({ data = certificate, authStatus, dataError = null } = {}) {
  const scopes = [];
  const query = {
    select(columns) {
      assert.match(columns, /case_files!inner/);
      assert.doesNotMatch(columns, /pdf_path|verification_url|manifest_id/);
      return this;
    },
    eq(column, id) {
      scopes.push([column, id]);
      return this;
    },
    async maybeSingle() {
      return { data, error: dataError };
    },
  };
  const handle = createCaseVerificationHandler((token) => ({
    auth: {
      async getUser(value) {
        assert.equal(value, token);
        return authStatus
          ? { data: { user: null }, error: { status: authStatus } }
          : { data: { user: { id: 'fixture-user' } }, error: null };
      },
    },
    from(table) {
      scopes.push(table);
      return query;
    },
  }));
  return { handle, scopes };
}

test('closure verification checks the caller before reading any certificate', async () => {
  for (const scenario of [
    { token: null, expected: 401 },
    { authStatus: 401, expected: 401 },
    { authStatus: 503, expected: 503 },
    { id: 'invalid', expected: 400 },
  ]) {
    const { handle, scopes } = fixture(scenario);
    const response = await handle(request(scenario));
    assert.equal(response.status, scenario.expected);
    assert.equal((await response.json()).valid, false);
    assert.deepEqual(scopes, []);
  }
});

test('closure verification returns a private projection for the authorized case', async () => {
  const { handle, scopes } = fixture();
  const response = await handle(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json();
  assert.equal(body.certificate_number, certificate.certificate_number);
  assert.equal(body.root_hash, certificate.root_hash);
  assert.equal(body.case_file.folio, certificate.case_files.folio);
  assert.equal(body.case_file.workspace_id, undefined);
  assert.deepEqual(scopes, ['case_file_closure_certificates', ['case_file_id', caseId]]);
});

test('inaccessible and mismatched certificate rows yield the same unavailable result', async () => {
  const hidden = await fixture({ data: null }).handle(request());
  const mismatched = await fixture({
    data: { ...certificate, workspace_id: 'workspace-b' },
  }).handle(request());
  assert.equal(hidden.status, 404);
  assert.equal(mismatched.status, 404);
  assert.deepEqual(await hidden.json(), await mismatched.json());
});

const require = createRequire(import.meta.url);
const postgres = '../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite';
test(
  'the certificate projection respects restrictive case membership in PostgreSQL',
  { skip: !existsSync(new URL(`${postgres}/package.json`, import.meta.url)) },
  async (t) => {
    const { PGlite } = require(postgres);
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      grant usage on schema auth to authenticated;
      create function auth.uid() returns text language sql stable
        as $$ select current_setting('request.jwt.claim.sub', true) $$;
      create table public.workspace_members (
        workspace_id text, user_id text, status text, access_expires_at timestamptz
      );
      create table public.case_files (id uuid primary key, workspace_id text not null, title text);
      create table public.case_file_closure_certificates (
        case_file_id uuid references public.case_files, workspace_id text not null, root_hash text
      );
      alter table public.workspace_members enable row level security;
      grant select on public.workspace_members to authenticated;
      create policy users_view_own_memberships on public.workspace_members
        for select to authenticated using (user_id = auth.uid());
    `);
    for (const table of ['case_files', 'case_file_closure_certificates']) {
      await db.exec(`
        alter table public.${table} enable row level security;
        grant select on public.${table} to authenticated, anon;
        create policy case_workspace_isolation on public.${table} for all to authenticated
          using (workspace_id in (select workspace_id from public.workspace_members
            where user_id = auth.uid()));
        create policy case_active_membership on public.${table} as restrictive for all to authenticated
          using (
            exists (select 1 from public.workspace_members member
              where member.workspace_id = ${table}.workspace_id and member.user_id = (select auth.uid())
                and member.status = 'active'
                and (member.access_expires_at is null or member.access_expires_at > now()))
          );
      `);
    }
    await db.query(
      "insert into public.case_files values ($1,'workspace-a','Expediente de prueba')",
      [caseId]
    );
    await db.query(
      "insert into public.case_file_closure_certificates values ($1,'workspace-a',$2)",
      [caseId, certificate.root_hash]
    );
    await db.exec(`
      insert into public.workspace_members values
        ('workspace-a','active-member','active',null),
        ('workspace-a','suspended-member','suspended',null),
        ('workspace-a','expired-member','active',now()-interval '1 day'),
        ('workspace-b','other-tenant','active',null);
    `);
    const read = () =>
      db.query(
        'select certificate.root_hash from public.case_file_closure_certificates certificate ' +
          'join public.case_files file on file.id = certificate.case_file_id where file.id = $1',
        [caseId]
      );
    await db.exec('set role anon');
    assert.deepEqual((await read()).rows, []);
    await db.exec('reset role; set role authenticated');
    for (const user of ['other-tenant', 'suspended-member', 'expired-member', 'active-member']) {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
      assert.deepEqual(
        (await read()).rows,
        user === 'active-member' ? [{ root_hash: certificate.root_hash }] : []
      );
    }
  }
);
