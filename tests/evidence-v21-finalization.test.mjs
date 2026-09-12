import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { constants, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

mkdirSync('.tmp/evidence-v21-tests', { recursive: true });
writeFileSync('.tmp/evidence-v21-tests/package.json', '{"type":"module"}\n');
execSync(
  'npx esbuild src/lib/evidence-v2/generator.ts src/lib/evidence-v2/verifier.ts src/lib/evidence-v2/readiness.ts src/lib/evidence-v2/canonical.ts src/lib/evidence-v2/consent.ts src/lib/evidence-v2/package-manifest.ts src/lib/evidence-v2/parser.ts --bundle --platform=node --format=esm --outdir=.tmp/evidence-v21-tests --alias:@=./src --external:xmllint-wasm',
  { stdio: 'pipe' }
);

const generator = await import('../.tmp/evidence-v21-tests/generator.js');
const verifier = await import('../.tmp/evidence-v21-tests/verifier.js');
const readiness = await import('../.tmp/evidence-v21-tests/readiness.js');
const canonical = await import('../.tmp/evidence-v21-tests/canonical.js');
const parser = await import('../.tmp/evidence-v21-tests/parser.js');
const consent = await import('../.tmp/evidence-v21-tests/consent.js');
const manifests = await import('../.tmp/evidence-v21-tests/package-manifest.js');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const pdfBytes = Buffer.from('%PDF-1.7\nDocubox Evidence V2.1 deterministic fixture\n%%EOF\n');
const pdfHash = hash(pdfBytes);
const metadata = [{
  id: 'meta-1', key: 'contract_type', name: 'Tipo de contrato', type: 'text',
  value: 'NDA', source: 'user', recordedAt: '2026-09-11T10:00:00.000Z',
  snapshotHash: hash('meta-1:NDA'),
}];
const metadataSnapshotHash = canonical.metadataSnapshotDigest(metadata);
const eventOneMaterial = '1|DOCUMENT_CREATED|SUCCESS|2026-09-11T10:00:00.000Z';
const eventOneHash = hash(eventOneMaterial);
const eventTwoMaterial = `2|SIGNATURE_COMPLETED|SUCCESS|${eventOneHash}`;
const eventTwoHash = hash(eventTwoMaterial);

function testSigner() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprint = hash(publicKey.export({ type: 'spki', format: 'der' }));
  return {
    async signDigest(input) {
      assert.equal(input.purpose, 'EVIDENCE_SEAL');
      const signature = sign('sha256', input.canonicalBytes, {
        key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
      });
      return {
        status: 'VALID', algorithm: 'RSA-PSS-SHA256', keyId: 'kms-evidence-test',
        keyVersion: '7', keySizeBits: 2048, publicKeyPem,
        publicKeyFingerprintSha256: fingerprint, signatureBase64: signature.toString('base64'),
        signatureSha256: hash(signature), certificatePem: null,
        certificateFingerprintSha256: null, signedAt: '2026-09-11T10:05:01.000Z',
      };
    },
  };
}

const fixture = {
  evidenceId: '11111111-1111-4111-8111-111111111111',
  packageId: '22222222-2222-4222-8222-222222222222',
  version: '2.1', schemaVersion: '2.1',
  generatedAt: '2026-09-11T10:05:00.000Z', closedAt: '2026-09-11T10:04:59.000Z',
  environment: 'PREVIEW', platform: 'Docubox', platformVersion: 'test', jurisdiction: 'MX',
  workspaceId: '33333333-3333-4333-8333-333333333333', organizationId: null,
  status: 'partially_certified',
  document: {
    documentId: '44444444-4444-4444-8444-444444444444', externalId: 'DBX-V21-1',
    name: 'Contrato V2.1', fileName: 'contrato.pdf', mimeType: 'application/pdf',
    sizeBytes: pdfBytes.length, pageCount: 1,
    originType: 'upload', createdByRef: 'user:owner', createdAt: '2026-09-11T10:00:00.000Z',
    versionId: '55555555-5555-4555-8555-555555555555', version: 1,
    originalHash: hash('original'), preparedHash: hash('prepared'), finalHash: pdfHash,
    preparedAt: '2026-09-11T10:01:00.000Z', flowStartedAt: '2026-09-11T10:02:00.000Z',
    metadata, metadataSnapshotHash, extract: null,
    workflow: { status: 'COMPLETED', completedAt: '2026-09-11T10:04:59.000Z' },
    relations: [{ type: 'document_version', ref: '55555555-5555-4555-8555-555555555555' }],
  },
  participants: [{
    participantRef: 'participant:66666666-6666-4666-8666-666666666666',
    firmanteId: '66666666-6666-4666-8666-666666666666', name: 'Firmante Prueba',
    email: 'firmante@example.test', role: 'Firmante', participantType: 'signer', order: 1,
    required: true, expectedMethod: 'autografa_digital', participationStatus: 'firmado',
    invitationAt: '2026-09-11T10:02:00.000Z', firstAccessAt: '2026-09-11T10:03:00.000Z',
    signedAt: '2026-09-11T10:04:00.000Z',
  }],
  signatures: [{
    signatureRef: 'signature:77777777-7777-4777-8777-777777777777',
    participantRef: 'participant:66666666-6666-4666-8666-666666666666',
    participantId: '66666666-6666-4666-8666-666666666666',
    documentVersionRef: '55555555-5555-4555-8555-555555555555',
    method: 'autografa_digital', signedObjectHash: pdfHash,
    capturedAt: '2026-09-11T10:03:59.000Z', signedAt: '2026-09-11T10:04:00.000Z',
    evidenceRole: 'FINAL_SIGNATURE',
    context: {
      ipStatus: 'available', ipAddress: '192.0.2.10', geolocationStatus: 'denied',
      latitude: null, longitude: null, accuracyMeters: null, city: null, region: null,
      country: null, countryCode: null, userAgentStatus: 'available',
      userAgent: 'Docubox Test Agent', deviceInfo: 'desktop; 1920x1080',
    },
    consent: {
      textVersion: consent.SIGNATURE_CONSENT_VERSION,
      textHash: consent.SIGNATURE_CONSENT_SHA256,
      accepted: true, acceptedAt: '2026-09-11T10:03:58.000Z',
    },
    autograph: {
      captureId: '88888888-8888-4888-8888-888888888888', strokesHash: hash('strokes'),
      imageHash: hash('image'), combinedHash: hash(`${hash('image')}${hash('strokes')}`),
      evidenceObjectId: 'signature:77777777-7777-4777-8777-777777777777',
      imageArtifactRef: 'storage:signatures/image.png',
      strokesArtifactRef: 'storage:evidence/strokes.json',
    },
  }],
  events: [
    {
      eventId: '99999999-9999-4999-8999-999999999999', sequence: 1,
      type: 'DOCUMENT_CREATED', result: 'SUCCESS', occurredAt: '2026-09-11T10:00:00.000Z',
      actorRef: 'user:owner', objectRef: 'document:44444444-4444-4444-8444-444444444444',
      eventCategory: 'DOCUMENT', actorType: 'OWNER', documentHash: hash('original'),
      payloadHash: hash('{}'), chainMaterial: eventOneMaterial,
      previousSourceHash: '0'.repeat(64), sourceEventHash: eventOneHash,
    },
    {
      eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sequence: 2,
      type: 'SIGNATURE_COMPLETED', result: 'SUCCESS', occurredAt: '2026-09-11T10:04:00.000Z',
      actorRef: 'user:signer', objectRef: 'document:44444444-4444-4444-8444-444444444444',
      eventCategory: 'SIGNATURE', actorType: 'PARTICIPANT', documentHash: pdfHash,
      payloadHash: hash('{"signed":true}'), chainMaterial: eventTwoMaterial,
      previousSourceHash: eventOneHash, sourceEventHash: eventTwoHash,
    },
  ],
  timestamps: [
    {
      type: 'rfc3161', status: 'verified', objectType: 'final_pdf', objectHash: pdfHash,
      provider: 'TSA TEST', issuedAt: '2026-09-11T10:04:30.000Z',
      messageImprint: pdfHash, artifactRef: 'storage:certification-artifacts/timestamp.tst',
      artifactHash: hash('rfc3161-token'), validationStatus: 'valid',
      validatedAt: '2026-09-11T10:04:31.000Z',
    },
    {
      type: 'opentimestamps', status: 'pending_bitcoin', objectType: 'evidence_root',
      objectHash: pdfHash, provider: 'OpenTimestamps', issuedAt: '2026-09-11T10:04:40.000Z',
      artifactRef: 'storage:blockchain-evidence/proof.ots', artifactHash: hash('ots-proof'),
      manifestHash: hash('ots-manifest'), validationStatus: 'pending',
    },
  ],
  nom151: { status: 'pending', requestId: 'nom-request-1', requestedAt: '2026-09-11T10:04:45.000Z', hashSubmitted: pdfHash },
};

test('V2.1 generates XSD-valid XML with no XMLDSig claim and round-trips', async () => {
  const built = await generator.createEvidenceV2Package(fixture, testSigner());
  const parsed = parser.parseEvidenceV2Xml(built.xml);
  const rebuiltRoot = canonical.buildEvidenceRoot(parsed);
  assert.equal(rebuiltRoot.metadataSnapshotHash, built.package.evidenceRoot.metadataSnapshotHash, JSON.stringify({ rebuiltRoot, stored: built.package.evidenceRoot }));
  assert.equal(rebuiltRoot.evidenceEventRootHash, built.package.evidenceRoot.evidenceEventRootHash, JSON.stringify({ rebuiltRoot, stored: built.package.evidenceRoot }));
  assert.equal(rebuiltRoot.signaturesDigest, built.package.evidenceRoot.signaturesDigest, JSON.stringify({ rebuiltRoot, stored: built.package.evidenceRoot }));
  assert.equal(rebuiltRoot.packageCoreDigest, built.package.evidenceRoot.packageCoreDigest, JSON.stringify({ rebuiltRoot, stored: built.package.evidenceRoot }));
  const verified = await verifier.verifyEvidenceV2Package({ xml: built.xml, pdfBytes });
  assert.equal(verified.schema, 'valid', JSON.stringify(verified));
  assert.equal(verified.documentIntegrity, 'valid');
  assert.equal(verified.docuboxSignature, 'valid', JSON.stringify(verified));
  assert.equal(verified.overall, 'valid_with_pending_certifications');
  assert.doesNotMatch(built.xml, /xmlns:ds|XMLDSig/);
  for (const block of ['ExtractoDocumento', 'ContenidoCanonico', 'Workflow', 'Relaciones', 'EvidenceRoot']) {
    assert.match(built.xml, new RegExp(`<${block}`));
  }
});

test('EvidenceRoot has a stable golden vector and covers every required digest', async () => {
  const first = await generator.createEvidenceV2Package(fixture, testSigner());
  const second = await generator.createEvidenceV2Package(fixture, testSigner());
  assert.equal(first.package.evidenceRoot.value, second.package.evidenceRoot.value);
  assert.equal(first.package.evidenceRoot.value, 'f5e2c145dac525e69b9ad8a5da2c00443d65b3e68ea26250867ed8c80c81d35e');
  assert.equal(first.package.evidenceRoot.metadataSnapshotHash, metadataSnapshotHash);
  assert.equal(first.package.evidenceRoot.evidenceEventRootHash, eventTwoHash);
  for (const value of Object.values(first.package.evidenceRoot)) {
    if (typeof value === 'string' && value.length === 64) assert.match(value, /^[a-f0-9]{64}$/);
  }
});

test('readiness enforces stable autograph identity, consent and technical evidence', async () => {
  const built = await generator.createEvidenceV2Package(fixture, testSigner());
  assert.deepEqual(readiness.validateEvidenceV21Readiness(built.package), {
    status: 'READY', codes: [], pendingSupplements: ['OPENTIMESTAMPS', 'NOM151'],
  });
  const missingConsent = structuredClone(built.package);
  missingConsent.signatures[0].consent = undefined;
  assert.match(readiness.validateEvidenceV21Readiness(missingConsent).codes.join(','), /CONSENT/);
  const splitCapture = structuredClone(built.package);
  splitCapture.signatures[0].autograph.combinedHash = null;
  assert.match(readiness.validateEvidenceV21Readiness(splitCapture).codes.join(','), /AUTOGRAPH/);
});

test('tampering PDF, XML metadata, event chain or signature is rejected', async () => {
  const built = await generator.createEvidenceV2Package(fixture, testSigner());
  const badPdf = await verifier.verifyEvidenceV2Package({ xml: built.xml, pdfBytes: Buffer.concat([pdfBytes, Buffer.from('x')]) });
  assert.equal(badPdf.documentIntegrity, 'invalid');
  for (const changed of [
    built.xml.replace('NDA', 'ALTERED'),
    built.xml.replace(eventTwoHash, 'f'.repeat(64)),
    built.xml.replace(/<SignatureValue>([^<])/, '<SignatureValue>X'),
  ]) {
    assert.equal(verifier.verifyEvidenceV2Xml(changed).overall, 'invalid');
  }
});

test('manifest is deterministic and reports pending and non-applicable items', () => {
  const input = {
    documentId: fixture.document.documentId,
    packageRow: {
      package_id: fixture.packageId, evidence_version: '2.1', schema_version: '2.1',
      generated_at: fixture.generatedAt, evidence_root_sha256: 'a'.repeat(64),
      package_digest_sha256: 'b'.repeat(64),
      verification_summary: { nom151: 'pending', certificates: 'not_applicable' },
    },
    files: [{ path: '02-evidencia/evidencia.xml', mediaType: 'application/xml', size: 321, sha256: 'c'.repeat(64), relation: 'base_evidence_xml' }],
    supplements: [{ supplement_sha256: 'd'.repeat(64) }],
  };
  const first = manifests.createEvidenceManifest(input);
  const second = manifests.createEvidenceManifest(structuredClone(input));
  assert.deepEqual(first, second);
  assert.deepEqual(first.pendingItems, ['nom151']);
  assert.deepEqual(first.notApplicableItems, ['certificates']);
  assert.match(manifests.evidenceReadme(), /XML inmutable|OpenTimestamps|SHA-256/);
});

test('finalization contracts cover idempotency, concurrency, retry, storage and supplements', () => {
  const migration = readFileSync('supabase/migrations/20260911013223_evidence_v21_finalization.sql', 'utf8');
  const orchestrator = readFileSync('src/lib/evidence-v2/orchestrator.ts', 'utf8');
  const service = readFileSync('src/lib/evidence-v2/service.ts', 'utf8');
  const supplements = readFileSync('src/lib/evidence-v2/supplements.ts', 'utf8');
  const zip = readFileSync('src/lib/evidence-v2/evidence-package.ts', 'utf8');
  const unified = readFileSync('src/app/api/documentos/[documentId]/evidence/route.ts', 'utf8');
  const ui = readFileSync('src/app/visor-documento/[id]/page.tsx', 'utf8');
  assert.match(migration, /idempotency_key text NOT NULL UNIQUE/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /fencing_token/);
  assert.match(migration, /heartbeat_evidence_finalization/);
  assert.ok(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.prevent_frozen_document_version_mutation') <
      migration.indexOf('UPDATE public.document_versions version'),
    'the frozen-version exception must exist before historical evidence backfill'
  );
  assert.match(migration, /v_valid_encrypted_storage_switch/);
  assert.match(orchestrator, /FINALIZATION_RETRY_SCHEDULED/);
  assert.match(service, /upsert: false/);
  assert.match(service, /EVIDENCE_XML_READBACK_HASH_MISMATCH/);
  assert.match(service, /nom151-constancias/);
  assert.match(service, /blockchain-evidence/);
  assert.match(service, /signatures/);
  assert.match(supplements, /appendEvidenceSupplement/);
  assert.match(supplements, /previous_supplement_sha256/);
  assert.match(zip, /archiver\('zip'/);
  assert.doesNotMatch(zip, /JSZip/);
  assert.match(unified, /evidenceVersion: 1/);
  assert.doesNotMatch(ui, /Evidence Package v2|Generar ahora|nom151\/generate-xml/);
  assert.match(ui, /XML de Evidencia/);
  assert.match(ui, /Paquete de Evidencia/);
});
