import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const helperPath = new URL('../src/lib/documents/participant-evidence-access.ts', import.meta.url);
const routePath = new URL('../src/app/api/documentos/[documentId]/participant-details/route.ts', import.meta.url);
const viewerPath = new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url);

const helperSource = await readFile(helperPath, 'utf8');
const transformed = await transform(helperSource, { loader: 'ts', format: 'esm' });
const { participantEvidenceScope } = await import(
  `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`
);

test('own evidence is full, including a verified email match', () => {
  assert.equal(participantEvidenceScope({ viewerId: 'u1', viewerEmail: 'A@EXAMPLE.COM', participantId: 'u1', participantEmail: 'a@example.com', role: 'AUTHORIZED' }), 'full');
  assert.equal(participantEvidenceScope({ viewerId: 'u1', viewerEmail: 'A@EXAMPLE.COM', participantId: 'external', participantEmail: 'a@example.com', role: 'AUTHORIZED' }), 'full');
});

test('owner and workspace administrator can inspect other participants', () => {
  for (const role of ['OWNER', 'WORKSPACE_ADMIN']) {
    assert.equal(participantEvidenceScope({ viewerId: 'u1', viewerEmail: 'a@example.com', participantId: 'u2', participantEmail: 'b@example.com', role }), 'full');
  }
});

test('ordinary document viewers only receive other participants summary', () => {
  assert.equal(participantEvidenceScope({ viewerId: 'u1', viewerEmail: 'a@example.com', participantId: 'u2', participantEmail: 'b@example.com', role: 'AUTHORIZED' }), 'summary');
});

test('participant detail endpoint gates technical queries and the UI keeps certificates personal', async () => {
  const [route, viewer] = await Promise.all([
    readFile(routePath, 'utf8'),
    readFile(viewerPath, 'utf8'),
  ]);
  assert.match(route, /requireDocumentContentAccess\(\s*request,\s*documentId,\s*'evidence'\s*\)/);
  assert.ok(route.indexOf("scope === 'summary'") < route.indexOf("from('signature_evidence')"));
  assert.match(route, /'Cache-Control': 'private, no-store'/);
  assert.match(viewer, /isAuthenticatedParticipant && ownSignedResponse/);
  assert.match(viewer, /participant-details\?participantIndex=/);
});
