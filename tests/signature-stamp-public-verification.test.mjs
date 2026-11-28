import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: {
    contents: `
      export * from './src/lib/signatures/verification-link';
      export * from './src/lib/public-verification/signature-stamp';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const {
  findPublicSignatureStamp,
  getSignatureVerificationUrl,
  parseSignatureVerificationReference,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

const firstId = '0636aa8d-88c3-4af7-a924-107c9ff6d102';
const secondId = '028c5504-13c0-4f97-bdc1-04b56d6cc167';
const documentId = '0033ac34-1948-4620-b952-78b21a401cd2';
const signedAt = '2026-11-27T04:30:00.000Z';

function makeClient({ linked = true, liveDocument = true, activeEvidence = true } = {}) {
  return createClient('https://test.invalid', 'test-key', {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(input);
        const filters = url.searchParams;
        const table = url.pathname.split('/').at(-1);
        switch (table) {
          case 'signature_evidence': {
            const first = filters.get('id') === `eq.${firstId}`;
            assert.equal(filters.get('evidence_role'), 'eq.FINAL_SIGNATURE');
            assert.equal(filters.get('is_voided'), 'eq.false');
            assert.doesNotMatch(filters.get('select'), /email|rfc|curp|certificate|ip_address/);
            return Response.json(
              activeEvidence
                ? [
                    {
                      document_id: documentId,
                      evidence_type: first ? 'click_sign' : 'efirma_sat',
                      signed_at: signedAt,
                      participant_name: first ? 'Ángela Ruiz' : 'persona@example.test',
                      efirma_nombre: first ? null : 'María Pérez',
                      signature_hash: first ? 'a'.repeat(64) : null,
                      digital_seal_sha256: first ? null : 'b'.repeat(64),
                    },
                  ]
                : []
            );
          }
          case 'participation_responses': {
            assert.equal(filters.get('documento_id'), `eq.${documentId}`);
            assert.equal(filters.get('firma_completada'), 'eq.true');
            assert.equal(filters.get('operational_committed_at'), 'not.is.null');
            const expectedEvidence =
              filters.get('signature_method') === 'eq.clicksign' ? firstId : secondId;
            assert.equal(filters.get('signature_evidence_id'), `eq.${expectedEvidence}`);
            return Response.json(
              linked
                ? [{ participante_nombre: 'Nombre registrado', firma_completada_at: signedAt }]
                : []
            );
          }
          case 'documentos':
            assert.equal(filters.get('id'), `eq.${documentId}`);
            assert.equal(filters.get('deleted_at'), 'is.null');
            assert.equal(filters.get('trashed_at'), 'is.null');
            assert.equal(filters.get('select'), 'id');
            return Response.json(liveDocument ? [{ id: documentId }] : []);
          default:
            throw new Error(`Tabla inesperada ${table}`);
        }
      },
    },
  });
}

test('cada QR identifica una evidencia y la consulta solo publica un resumen del firmante', async () => {
  const firstUrl = getSignatureVerificationUrl(firstId);
  const secondUrl = getSignatureVerificationUrl(secondId);
  assert.notEqual(firstUrl, secondUrl);
  const first = parseSignatureVerificationReference(new URL(firstUrl).pathname.split('/').at(-1));
  const second = parseSignatureVerificationReference(new URL(secondUrl).pathname.split('/').at(-1));
  assert.equal(first, firstId);
  assert.equal(second, secondId);
  assert.equal(getSignatureVerificationUrl(null), null);
  assert.equal(parseSignatureVerificationReference(documentId), null);

  const supabase = makeClient();
  assert.deepEqual(await findPublicSignatureStamp(supabase, first), {
    signerInitials: 'Á. R.',
    method: 'Click & Sign',
    signedAt,
    fingerprintPrefix: 'A'.repeat(16),
  });
  assert.deepEqual(await findPublicSignatureStamp(supabase, second), {
    signerInitials: 'M. P.',
    method: 'e.firma SAT',
    signedAt,
    fingerprintPrefix: 'B'.repeat(16),
  });
});

test('la consulta omite evidencia anulada, sin firma confirmada o de documentos en papelera', async () => {
  for (const options of [{ linked: false }, { liveDocument: false }, { activeEvidence: false }]) {
    assert.equal(await findPublicSignatureStamp(makeClient(options), firstId), null);
  }
});
