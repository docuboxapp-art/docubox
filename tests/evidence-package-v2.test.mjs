import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { constants, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

mkdirSync('.tmp/evidence-v2-tests', { recursive: true });
execSync(
  'npx esbuild src/lib/evidence-v2/generator.ts src/lib/evidence-v2/verifier.ts src/lib/evidence-v2/xml.ts --bundle --platform=node --format=esm --outdir=.tmp/evidence-v2-tests --alias:@=./src',
  { stdio: 'pipe' }
);

const generator = await import('../.tmp/evidence-v2-tests/generator.js');
const verifier = await import('../.tmp/evidence-v2-tests/verifier.js');
const xmlModule = await import('../.tmp/evidence-v2-tests/xml.js');
const goldenDocumentBytes = readFileSync('tests/fixtures/evidence-v2/document.pdf');
const goldenDocumentHash = createHash('sha256').update(goldenDocumentBytes).digest('hex');

const fixture = {
  evidenceId: '11111111-1111-4111-8111-111111111111',
  packageId: '22222222-2222-4222-8222-222222222222',
  version: '2.0',
  schemaVersion: '2.0',
  generatedAt: '2026-09-09T12:00:00.000Z',
  closedAt: '2026-09-09T11:59:00.000Z',
  environment: 'TEST',
  platform: 'Docubox',
  platformVersion: 'test',
  jurisdiction: 'MX',
  workspaceId: '33333333-3333-4333-8333-333333333333',
  organizationId: null,
  status: 'closed',
  document: {
    documentId: '44444444-4444-4444-8444-444444444444',
    externalId: 'DBX-GOLDEN-1',
    name: 'Documento golden',
    fileName: 'document.pdf',
    mimeType: 'application/pdf',
    sizeBytes: goldenDocumentBytes.length,
    versionId: '55555555-5555-4555-8555-555555555555',
    version: 1,
    createdAt: '2026-09-09T11:00:00.000Z',
    finalHash: goldenDocumentHash,
    metadata: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        key: 'folio',
        name: 'Folio',
        type: 'text',
        value: 'DBX-GOLDEN-1',
        source: 'user',
        recordedAt: '2026-09-09T11:01:00.000Z',
        snapshotHash: 'b'.repeat(64),
      },
    ],
  },
  participants: [
    {
      participantRef: 'participant:77777777-7777-4777-8777-777777777777',
      role: 'Firmante',
      participantType: 'signer',
      order: 1,
      required: true,
    },
  ],
  signatures: [
    {
      signatureRef: 'signature:88888888-8888-4888-8888-888888888888',
      participantRef: 'participant:77777777-7777-4777-8777-777777777777',
      method: 'autografa_digital',
      signedObjectHash: goldenDocumentHash,
      capturedAt: '2026-09-09T11:58:00.000Z',
      autograph: {
        strokesHash: 'c'.repeat(64),
        imageHash: 'd'.repeat(64),
        evidenceObjectId: 'signature:88888888-8888-4888-8888-888888888888',
      },
    },
  ],
  events: [
    {
      eventId: '99999999-9999-4999-8999-999999999999',
      sequence: 1,
      type: 'DOCUMENT_CREATED',
      result: 'SUCCESS',
      occurredAt: '2026-09-09T11:00:00.000Z',
      objectRef: 'document:44444444-4444-4444-8444-444444444444',
      sourceEventHash: 'e'.repeat(64),
    },
    {
      eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sequence: 2,
      type: 'SIGNATURE_COMPLETED',
      result: 'SUCCESS',
      occurredAt: '2026-09-09T11:58:00.000Z',
      objectRef: 'document:44444444-4444-4444-8444-444444444444',
      sourceEventHash: 'f'.repeat(64),
    },
  ],
  timestamps: [
    {
      type: 'opentimestamps',
      status: 'pending_bitcoin',
      objectType: 'evidence_root',
      objectHash: goldenDocumentHash,
      provider: 'OpenTimestamps',
      validationStatus: 'pending',
    },
  ],
  nom151: { status: 'pending', requestId: 'nom151-test', requestedAt: '2026-09-09T11:59:00.000Z' },
};

test('Evidence Package v2 is deterministic and does not serialize participant PII', async () => {
  assert.equal(
    goldenDocumentHash,
    '68d3dbe223d4659eb030429ecc280a437eb6e9b042a59797cbbd9e16f56c1d56'
  );
  const first = await generator.createEvidenceV2Package(fixture);
  const second = await generator.createEvidenceV2Package(fixture);
  assert.equal(first.xml, second.xml);
  assert.equal(first.xmlSha256, second.xmlSha256);
  assert.match(first.xml, /DocuboxEvidencePackage/);
  assert.match(first.xml, /docubox-evidence-chain-v1/);
  assert.doesNotMatch(first.xml, /@|192\.168|latitude|longitude/i);
  assert.equal(xmlModule.validateEvidenceV2Xml(first.xml).valid, true);
});

test('Evidence Package v2 reports pending external evidence without declaring it valid', async () => {
  const built = await generator.createEvidenceV2Package(fixture);
  assert.equal(built.package.verification.openTimestamps, 'pending');
  assert.equal(built.package.verification.nom151, 'pending');
  assert.equal(built.package.verification.overall, 'incomplete');
  const result = verifier.verifyEvidenceV2Xml(built.xml);
  assert.equal(result.xmlIntegrity, 'valid');
  assert.equal(result.chainIntegrity, 'valid', JSON.stringify(result));
  assert.equal(result.docuboxSignature, 'not_applied');
  assert.equal(result.overall, 'incomplete');
});

test('an asymmetric Evidence Seal binds the final PDF, evidence root and package digest', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signer = {
    async signDigest(input) {
      const signature = sign('sha256', input.canonicalBytes, {
        key: privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      });
      return {
        status: 'VALID',
        algorithm: 'RSA-PSS-SHA256',
        keyId: 'test-evidence-key',
        keyVersion: '1',
        keySizeBits: 2048,
        publicKeyPem,
        publicKeyFingerprintSha256: createHash('sha256').update(publicKeyPem).digest('hex'),
        signatureBase64: signature.toString('base64'),
        signatureSha256: createHash('sha256').update(signature).digest('hex'),
        certificatePem: null,
        certificateFingerprintSha256: null,
        signedAt: '2026-09-09T12:00:01.000Z',
      };
    },
  };
  const built = await generator.createEvidenceV2Package(fixture, signer);
  const result = verifier.verifyEvidenceV2Xml(built.xml);
  assert.equal(result.docuboxSignature, 'valid');
  assert.equal(result.overall, 'valid_with_pending_certifications');
  assert.equal(result.valid, true);
});

test('tampering with either XML data or the chain invalidates verification', async () => {
  const built = await generator.createEvidenceV2Package(fixture);
  const changedDocument = built.xml.replace('Documento golden', 'Documento alterado');
  assert.equal(verifier.verifyEvidenceV2Xml(changedDocument).xmlIntegrity, 'invalid');
  const changedChain = built.xml.replace(
    /<ChainedHash[^>]*>[a-f0-9]{64}/,
    `<ChainedHash algoritmo="SHA-256">${'0'.repeat(64)}`
  );
  assert.equal(verifier.verifyEvidenceV2Xml(changedChain).chainIntegrity, 'invalid');
});

test('v2 migration keeps packages private, append-only and independent from XML v1', () => {
  const migration = readFileSync(
    'supabase/migrations/20260909110000_docubox_evidence_package_v2.sql',
    'utf8'
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.evidence_packages/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.evidence_package_artifacts/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(migration, /EVIDENCE_PACKAGE_IMMUTABLE/);
  assert.match(migration, /EVIDENCE_PACKAGE_ARTIFACT_IMMUTABLE/);
  assert.match(migration, /can_access_documento\(document_id\)/);
  assert.match(migration, /evidence-v2-artifacts/);
  assert.match(migration, /evidence_v2_artifacts_service_only/);
  assert.doesNotMatch(migration, /xml_evidencia_path/);
  assert.doesNotMatch(migration, /ON CONFLICT.*DO UPDATE/s);
});

test('the published XSD declares the v2 namespace and required top-level blocks', () => {
  const xsd = readFileSync('src/lib/evidence-v2/schema/docubox-evidence-v2.xsd', 'utf8');
  assert.match(xsd, /https:\/\/docubox\.com\.mx\/schema\/evidence\/v2/);
  for (const block of [
    'Paquete',
    'Documento',
    'Firmantes',
    'Firmas',
    'BitacoraProbatoria',
    'CadenaEvidencia',
    'Verificacion',
  ]) {
    assert.match(xsd, new RegExp(`name="${block}"`));
  }
});

test('the permanent golden fixture verifies to its documented incomplete state', () => {
  const xml = readFileSync('tests/fixtures/evidence-v2/evidence.xml', 'utf8');
  const expected = JSON.parse(
    readFileSync('tests/fixtures/evidence-v2/expected-verification.json', 'utf8')
  );
  const result = verifier.verifyEvidenceV2Xml(xml);
  assert.equal(result.xmlIntegrity, expected.xmlIntegrity);
  assert.equal(result.chainIntegrity, expected.chainIntegrity);
  assert.equal(result.docuboxSignature, expected.docuboxSignature);
  assert.equal(result.overall, expected.overall);
});
