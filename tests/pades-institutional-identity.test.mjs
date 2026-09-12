import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [pades, engine, certificates, bootstrap, environment] = await Promise.all([
  readFile('src/lib/certification/pades.ts', 'utf8'),
  readFile('src/lib/certification/engine.ts', 'utf8'),
  readFile('src/lib/certification/certificates.ts', 'utf8'),
  readFile('scripts/bootstrap-google-hsm-production-certificate.ts', 'utf8'),
  readFile('.env.example', 'utf8'),
]);

test('new institutional PAdES signatures use the normalized external identity', () => {
  assert.match(pades, /DOCUBOX_INSTITUTIONAL_SIGNER_NAME = 'Docubox'/);
  assert.match(
    pades,
    /DOCUBOX_INSTITUTIONAL_SIGNATURE_REASON\s*=\s*\n?\s*'Certificación de integridad del documento'/
  );
  assert.match(engine, /reason: DOCUBOX_INSTITUTIONAL_SIGNATURE_REASON/);
  assert.match(engine, /signerName: DOCUBOX_INSTITUTIONAL_SIGNER_NAME/);
  assert.match(certificates, /PRODUCTION_CERTIFICATE_VISIBLE_IDENTITY_INVALID/);
  assert.match(bootstrap, /EXPECTED_EXTERNAL_COMMON_NAME = 'Docubox'/);
  assert.match(environment, /^DOCUBOX_PRODUCTION_CERTIFICATE_COMMON_NAME=Docubox$/m);
});

test('the retired certificate display name is not hardcoded in the signing runtime', () => {
  assert.doesNotMatch(pades, /Docubox Production Document Signing/);
  assert.doesNotMatch(engine, /Docubox Production Document Signing/);
});
