import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import test from 'node:test';

const cacheDirectory = join(
  process.cwd(),
  'node_modules',
  '.cache',
  'docubox-final-deliverable-test'
);
const bundlePath = join(cacheDirectory, 'final-deliverable.cjs');
await mkdir(cacheDirectory, { recursive: true });
await build({
  entryPoints: [join(process.cwd(), 'src', 'lib', 'nom151', 'final-deliverable.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: bundlePath,
  logLevel: 'silent',
});
const { finalDeliverableReady } = createRequire(import.meta.url)(bundlePath);

const digest = 'a'.repeat(64);
const certification = {
  id: 'cert-1',
  certification_uuid: 'uuid-1',
  document_id: 'doc-1',
  document_version_id: 'version-1',
  certified_pdf_sha256: digest,
  pades_pdf_hash_after_signature: digest,
  status: 'COMPLETED',
  execution_status: 'completed',
  pades_profile: 'PAdES-B-T',
  integrity_status: 'valid',
  pdf_signature_status: 'valid',
  certificate_status: 'valid',
  timestamp_status: 'valid',
  verification_status: 'valid',
  provider_metadata: { product_integration: { pades_bt: { final_pdf_path: 'final.pdf' } } },
};

function serviceFor({
  nomStatus = 'issued',
  nomVerification = 'verified',
  nomDigest = digest,
  documentDigest = digest,
} = {}) {
  const rows = {
    documentos: [{ id: 'doc-1', sealed_pdf_path: 'final.pdf', sealed_pdf_hash: documentDigest }],
    document_certifications: [certification],
    nom151_constancias_doc: [
      {
        id: 'nom-1',
        documento_id: 'doc-1',
        document_certification_id: 'cert-1',
        document_version_id: 'version-1',
        document_digest: nomDigest,
        status: nomStatus,
        verification_status: nomVerification,
      },
    ],
  };
  return {
    from(table) {
      let selected = rows[table] || [];
      const query = {
        select() {
          return query;
        },
        eq(field, value) {
          selected = selected.filter((row) => row[field] === value);
          return query;
        },
        order() {
          return query;
        },
        limit(count) {
          selected = selected.slice(0, count);
          return query;
        },
        async single() {
          return { data: selected[0] || null, error: null };
        },
        async maybeSingle() {
          return { data: selected[0] || null, error: null };
        },
      };
      return query;
    },
  };
}

test('releases only the matching issued and verified NOM-151 final artifact', async () => {
  assert.equal(await finalDeliverableReady(serviceFor(), 'doc-1'), true);
  assert.equal(
    await finalDeliverableReady(serviceFor({ nomStatus: 'processing' }), 'doc-1'),
    false
  );
  assert.equal(
    await finalDeliverableReady(serviceFor({ nomVerification: 'pending' }), 'doc-1'),
    false
  );
  assert.equal(
    await finalDeliverableReady(serviceFor({ nomDigest: 'b'.repeat(64) }), 'doc-1'),
    false
  );
  assert.equal(
    await finalDeliverableReady(serviceFor({ documentDigest: 'b'.repeat(64) }), 'doc-1'),
    false
  );
  assert.equal(await finalDeliverableReady(serviceFor(), 'doc-1', 'wrong-certification'), false);
  assert.equal(await finalDeliverableReady(serviceFor(), 'doc-1', 'uuid-1'), true);
});
