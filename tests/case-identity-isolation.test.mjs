import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['src/lib/case-files/identity-client.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { createCaseIdentitySession, getCaseIdentityStatus } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const token = 'a'.repeat(64);
const session = { token, expiresAt: '2026-11-11T00:00:00Z', hasStoredId: true };

test('case identity starts only through its invitation endpoint and deployment', async () => {
  const calls = [];
  const result = await createCaseIdentitySession(
    'invitation-only',
    'https://preview.example.test',
    async (...args) => {
      calls.push(args);
      return Response.json(session);
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/public/case-entry');
  assert.equal(calls[0][1].headers['x-case-invitation'], 'invitation-only');
  assert.deepEqual(JSON.parse(calls[0][1].body), { action: 'mobile' });
  assert.equal(result.url, `https://preview.example.test/captura-id-movil/${token}`);
});

test('a completed form or document capture cannot authorize the case client', async () => {
  for (const mode of ['public_form_liveness', 'id_capture', undefined]) {
    await assert.rejects(
      getCaseIdentityStatus(token, async () => Response.json({ mode, status: 'completed' })),
      /no corresponde a este expediente/
    );
  }
  assert.deepEqual(
    await getCaseIdentityStatus(token, async () =>
      Response.json({ mode: 'case_portal_liveness', status: 'completed' })
    ),
    { status: 'completed' }
  );
});

test('failed or malformed session creation does not produce a QR capability', async () => {
  for (const data of [
    { ...session, token: 'invalid' },
    { ...session, expiresAt: 'invalid' },
  ]) {
    await assert.rejects(
      createCaseIdentitySession('invitation', 'https://example.test', async () =>
        Response.json(data)
      ),
      /no es válida/
    );
  }
  await assert.rejects(
    createCaseIdentitySession('invitation', 'https://example.test', async () =>
      Response.json({ error: 'Invitación revocada' }, { status: 403 })
    ),
    /Invitación revocada/
  );
  await assert.rejects(
    getCaseIdentityStatus(token, async () =>
      Response.json({ error: 'Acceso vencido' }, { status: 403 })
    ),
    /Acceso vencido/
  );
});

test('case entry and form verification have separate component dependency graphs', async () => {
  for (const [entry, forbidden, required] of [
    [
      'src/app/expediente/[token]/CaseEntryGate.tsx',
      /src\/components\/forms\//,
      /src\/components\/case-files\/CaseIdentityModal.tsx$/,
    ],
    [
      'src/components/forms/PublicFormMobileBiometricModal.tsx',
      /src\/(components|lib)\/case-files\//,
      /src\/components\/forms\/PublicFormMobileBiometricModal.tsx$/,
    ],
  ]) {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: 'browser',
      packages: 'external',
      metafile: true,
    });
    const paths = Object.keys(result.metafile.inputs).map((p) => p.replaceAll('\\', '/'));
    assert.ok(paths.some((p) => required.test(p)));
    assert.equal(
      paths.some((p) => forbidden.test(p)),
      false
    );
  }
});
