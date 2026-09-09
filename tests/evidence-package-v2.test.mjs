import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { constants, createHash, generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { cryptoProvider, X509CertificateGenerator } from '@peculiar/x509';

cryptoProvider.set(webcrypto);

mkdirSync('.tmp/evidence-v2-tests', { recursive: true });
writeFileSync('.tmp/evidence-v2-tests/package.json', '{"type":"module"}\n');
execSync(
  'npx esbuild src/lib/evidence-v2/generator.ts src/lib/evidence-v2/verifier.ts src/lib/evidence-v2/xml.ts --bundle --platform=node --format=esm --outdir=.tmp/evidence-v2-tests --alias:@=./src --external:xmllint-wasm',
  { stdio: 'pipe' }
);

const generator = await import('../.tmp/evidence-v2-tests/generator.js');
const verifier = await import('../.tmp/evidence-v2-tests/verifier.js');
const xmlModule = await import('../.tmp/evidence-v2-tests/xml.js');
const goldenDocumentBytes = readFileSync('tests/fixtures/evidence-v2/document.pdf');
const goldenDocumentHash = createHash('sha256').update(goldenDocumentBytes).digest('hex');

function recomputeXmlHash(xml) {
  const withoutDigest = xml.replace(/(<HashXML[^>]*>)[^<]*(<\/HashXML>)/, '$1$2');
  const digest = createHash('sha256').update(withoutDigest).digest('hex');
  return withoutDigest.replace(/(<HashXML[^>]*>)(<\/HashXML>)/, `$1${digest}$2`);
}

function createTestSigner() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
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
}

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
  const signer = createTestSigner();
  const built = await generator.createEvidenceV2Package(fixture, signer);
  const result = verifier.verifyEvidenceV2Xml(built.xml);
  assert.equal(result.docuboxSignature, 'valid');
  assert.equal(result.overall, 'valid_with_pending_certifications');
  assert.equal(result.valid, true);
});

test('the independent verifier binds the uploaded PDF to HashFinal', async () => {
  const built = await generator.createEvidenceV2Package(fixture, createTestSigner());
  const valid = await verifier.verifyEvidenceV2Package({
    xml: built.xml,
    pdfBytes: goldenDocumentBytes,
  });
  assert.equal(valid.documentIntegrity, 'valid');
  assert.equal(valid.schema, 'valid');
  const tampered = Buffer.concat([goldenDocumentBytes, Buffer.from('tampered')]);
  const invalid = await verifier.verifyEvidenceV2Package({ xml: built.xml, pdfBytes: tampered });
  assert.equal(invalid.documentIntegrity, 'invalid');
  assert.equal(invalid.overall, 'invalid');
  const invalidPades = await verifier.verifyEvidenceV2Package({
    xml: built.xml,
    pdfBytes: goldenDocumentBytes,
    padesVerifier: async () => ({ valid: false, profile: null, timestamp: null }),
  });
  assert.equal(invalidPades.pades, 'invalid');
  assert.equal(invalidPades.overall, 'invalid');
});

test('an e.firma bundle is verified with its public certificate and rejects tampering', async () => {
  const keys = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const certificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Docubox Evidence Test',
    notBefore: new Date('2025-01-01T00:00:00.000Z'),
    notAfter: new Date('2030-01-01T00:00:00.000Z'),
    signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5' },
    keys,
  });
  const certificateBytes = Buffer.from(certificate.rawData);
  const certificateHash = createHash('sha256').update(certificateBytes).digest('hex');
  const payload = Buffer.from('{"schema":"DOCUBOX_EFIRMA_ACT","version":"1.0"}');
  const signatureBytes = Buffer.from(
    await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, payload)
  );
  const payloadHash = createHash('sha256').update(payload).digest('hex');
  const signatureHash = createHash('sha256').update(signatureBytes).digest('hex');
  const bundle = {
    schema: 'docubox-efirma-evidence-bundle-v1',
    payload_utf8_base64: payload.toString('base64'),
    payload_sha256: payloadHash,
    signature_base64: signatureBytes.toString('base64'),
    signature_sha256: signatureHash,
    signature_algorithm: 'RSA-SHA256',
    certificate_der_base64: certificateBytes.toString('base64'),
    certificate_fingerprint_sha256: certificateHash,
    certificate_chain_valid: true,
    signature_verified: true,
    revocation_status: 'GOOD',
    validation_provider: 'TEST',
    validated_at: '2026-09-09T11:58:00.000Z',
  };
  const bundleBytes = Buffer.from(JSON.stringify(bundle));
  const bundleHash = createHash('sha256').update(bundleBytes).digest('hex');
  const efirmaFixture = structuredClone(fixture);
  efirmaFixture.signatures[0] = {
    signatureRef: fixture.signatures[0].signatureRef,
    participantRef: fixture.signatures[0].participantRef,
    method: 'efirma_sat',
    signedObjectHash: goldenDocumentHash,
    capturedAt: '2026-09-09T11:58:00.000Z',
    certificate: {
      fingerprintSha256: certificateHash,
      validFrom: '2025-01-01T00:00:00.000Z',
      validTo: '2030-01-01T00:00:00.000Z',
      validationStatus: 'valid',
    },
    cryptographicEvidence: {
      signedPayloadHash: payloadHash,
      signatureHash,
      signatureAlgorithm: 'RSA-SHA256',
      artifactRef: `artifact:efirma-bundle:${fixture.signatures[0].signatureRef}`,
      artifactHash: bundleHash,
      validationStatus: 'valid',
      validationProvider: 'TEST',
      validatedAt: '2026-09-09T11:58:00.000Z',
    },
  };
  const built = await generator.createEvidenceV2Package(efirmaFixture, createTestSigner());
  const baseInput = {
    xml: built.xml,
    pdfBytes: goldenDocumentBytes,
    padesVerifier: async () => ({ valid: true, profile: 'PAdES-B-T', timestamp: { valid: true } }),
  };
  const metadata = {
    signature_ref: fixture.signatures[0].signatureRef,
    signature_sha256: signatureHash,
  };
  const valid = await verifier.verifyEvidenceV2Package({
    ...baseInput,
    artifacts: [
      { type: 'efirma_signature_bundle', bytes: bundleBytes, expectedSha256: bundleHash, metadata },
    ],
  });
  assert.equal(valid.pades, 'valid');
  assert.equal(valid.efirma, 'valid', JSON.stringify(valid));
  assert.equal(valid.valid, true);

  const corruptBundle = Buffer.from(
    JSON.stringify({ ...bundle, signature_base64: Buffer.from('altered').toString('base64') })
  );
  const invalid = await verifier.verifyEvidenceV2Package({
    ...baseInput,
    artifacts: [
      {
        type: 'efirma_signature_bundle',
        bytes: corruptBundle,
        expectedSha256: createHash('sha256').update(corruptBundle).digest('hex'),
        metadata,
      },
    ],
  });
  assert.equal(invalid.efirma, 'invalid');
  assert.equal(invalid.overall, 'invalid');
});

test('participant, signature, certificate and document metadata tampering is detected', async () => {
  const efirmaFixture = structuredClone(fixture);
  efirmaFixture.signatures[0] = {
    ...efirmaFixture.signatures[0],
    method: 'efirma_sat',
    certificate: {
      serialNumber: 'TEST-SERIAL',
      fingerprintSha256: 'a'.repeat(64),
      validFrom: '2025-01-01T00:00:00.000Z',
      validTo: '2026-01-01T00:00:00.000Z',
      validationStatus: 'valid',
    },
  };
  const built = await generator.createEvidenceV2Package(efirmaFixture, createTestSigner());
  for (const changed of [
    built.xml.replace('Firmante', 'Revisor'),
    built.xml.replace('TEST-SERIAL', 'ALTERED-SERIAL'),
    built.xml.replace('Folio', 'Referencia alterada'),
    built.xml.replace(/<SignatureValue>([^<])/, '<SignatureValue>X'),
  ]) {
    assert.equal(verifier.verifyEvidenceV2Xml(changed).overall, 'invalid');
  }
});

test('management metadata remains outside the immutable evidence digest', async () => {
  const first = await generator.createEvidenceV2Package({
    ...fixture,
    managementSnapshot: { priority: 'normal' },
  });
  const second = await generator.createEvidenceV2Package({
    ...fixture,
    managementSnapshot: { priority: 'urgent' },
  });
  assert.equal(first.xml, second.xml);
  assert.equal(first.package.packageDigest, second.package.packageDigest);
});

test('e.firma validity records the validation-at-signing result without inventing certificate state', async () => {
  const expiredAfterSigning = structuredClone(fixture);
  expiredAfterSigning.signatures[0] = {
    signatureRef: 'signature:efirma',
    participantRef: fixture.signatures[0].participantRef,
    method: 'efirma_sat',
    signedObjectHash: goldenDocumentHash,
    capturedAt: '2025-06-01T00:00:00.000Z',
    certificate: {
      validFrom: '2025-01-01T00:00:00.000Z',
      validTo: '2025-12-31T23:59:59.000Z',
      validationStatus: 'valid',
    },
  };
  const valid = await generator.createEvidenceV2Package(expiredAfterSigning, createTestSigner());
  assert.equal(valid.package.verification.certificates, 'valid');
  const invalidFixture = structuredClone(expiredAfterSigning);
  invalidFixture.signatures[0].certificate.validationStatus = 'invalid';
  const invalid = await generator.createEvidenceV2Package(invalidFixture, createTestSigner());
  assert.equal(invalid.package.verification.certificates, 'invalid');
  assert.equal(invalid.package.verification.overall, 'invalid');
});

test('TSA, OpenTimestamps and NOM-151 preserve pending, valid and invalid states', async () => {
  const pending = await generator.createEvidenceV2Package(fixture, createTestSigner());
  assert.equal(pending.package.verification.openTimestamps, 'pending');
  assert.equal(pending.package.verification.nom151, 'pending');
  const verifiedFixture = structuredClone(fixture);
  verifiedFixture.timestamps = [
    {
      type: 'rfc3161',
      status: 'verified',
      objectType: 'final_pdf',
      objectHash: goldenDocumentHash,
      artifactHash: '1'.repeat(64),
      validationStatus: 'valid',
    },
    {
      type: 'opentimestamps',
      status: 'verified_bitcoin',
      objectType: 'evidence_root',
      objectHash: goldenDocumentHash,
      artifactHash: '2'.repeat(64),
      validationStatus: 'valid',
    },
  ];
  verifiedFixture.nom151 = {
    status: 'verified',
    constanciaHash: 'a'.repeat(64),
    artifactRef: 'artifact:nom151',
  };
  const verified = await generator.createEvidenceV2Package(verifiedFixture, createTestSigner());
  assert.equal(verified.package.verification.timestamp, 'valid');
  assert.equal(verified.package.verification.openTimestamps, 'valid');
  assert.equal(verified.package.verification.nom151, 'valid');
  assert.equal(verified.package.verification.overall, 'valid');
  verifiedFixture.timestamps[0].validationStatus = 'invalid';
  const invalid = await generator.createEvidenceV2Package(verifiedFixture, createTestSigner());
  assert.equal(invalid.package.verification.overall, 'invalid');
});

test('offline verification binds and validates TSA, OTS and NOM-151 artifacts', async () => {
  const rfc = Buffer.from('synthetic-rfc3161-token');
  const ots = Buffer.from('synthetic-ots-proof');
  const nom = Buffer.from('synthetic-nom151-constancia');
  const verifiedFixture = structuredClone(fixture);
  verifiedFixture.timestamps = [
    {
      type: 'rfc3161',
      status: 'verified',
      objectType: 'final_pdf',
      objectHash: goldenDocumentHash,
      messageImprint: goldenDocumentHash,
      artifactRef: 'artifact:rfc3161',
      artifactHash: createHash('sha256').update(rfc).digest('hex'),
      validationStatus: 'valid',
    },
    {
      type: 'opentimestamps',
      status: 'verified_bitcoin',
      objectType: 'evidence_root',
      objectHash: goldenDocumentHash,
      artifactRef: 'artifact:ots',
      artifactHash: createHash('sha256').update(ots).digest('hex'),
      manifestHash: '9'.repeat(64),
      validationStatus: 'valid',
    },
  ];
  verifiedFixture.nom151 = {
    status: 'verified',
    constanciaHash: createHash('sha256').update(nom).digest('hex'),
    artifactRef: 'artifact:nom151',
  };
  const built = await generator.createEvidenceV2Package(verifiedFixture, createTestSigner());
  const artifacts = [
    {
      type: 'rfc3161_token',
      bytes: rfc,
      expectedSha256: verifiedFixture.timestamps[0].artifactHash,
    },
    {
      type: 'opentimestamps_proof',
      bytes: ots,
      expectedSha256: verifiedFixture.timestamps[1].artifactHash,
    },
    {
      type: 'nom151_constancia',
      bytes: nom,
      expectedSha256: verifiedFixture.nom151.constanciaHash,
    },
  ];
  const externalVerifiers = {
    rfc3161: async (bytes, digest) =>
      bytes.equals(rfc) && digest === goldenDocumentHash ? 'valid' : 'invalid',
    openTimestamps: async (bytes, manifestHash) =>
      bytes.equals(ots) && manifestHash === '9'.repeat(64) ? 'valid' : 'invalid',
    nom151: async (bytes, pdf, hash) =>
      bytes.equals(nom) && pdf.equals(goldenDocumentBytes) && hash === goldenDocumentHash
        ? 'valid'
        : 'invalid',
  };
  const valid = await verifier.verifyEvidenceV2Package({
    xml: built.xml,
    pdfBytes: goldenDocumentBytes,
    artifacts,
    externalVerifiers,
    padesVerifier: async () => ({ valid: true, profile: 'PAdES-B-T', timestamp: { valid: true } }),
  });
  assert.equal(valid.overall, 'valid', JSON.stringify(valid));
  assert.equal(valid.valid, true);

  const altered = await verifier.verifyEvidenceV2Package({
    xml: built.xml,
    pdfBytes: goldenDocumentBytes,
    artifacts: artifacts.map((artifact, index) =>
      index === 1 ? { ...artifact, bytes: Buffer.from('corrupt') } : artifact
    ),
    externalVerifiers,
    padesVerifier: async () => ({ valid: true, profile: 'PAdES-B-T', timestamp: { valid: true } }),
  });
  assert.equal(altered.certifications.openTimestamps, 'invalid');
  assert.equal(altered.overall, 'invalid');
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

test('semantic tampering remains invalid after an attacker recomputes HashXML', async () => {
  const built = await generator.createEvidenceV2Package(fixture, createTestSigner());
  const changedDocument = recomputeXmlHash(
    built.xml.replace('Documento golden', 'Documento alterado')
  );
  const documentResult = verifier.verifyEvidenceV2Xml(changedDocument);
  assert.equal(documentResult.xmlIntegrity, 'valid');
  assert.equal(documentResult.packageIntegrity, 'invalid');
  assert.equal(documentResult.overall, 'invalid');

  const forgedSummary = recomputeXmlHash(built.xml.replace('status="pending"', 'status="valid"'));
  const summaryResult = verifier.verifyEvidenceV2Xml(forgedSummary);
  assert.equal(summaryResult.xmlIntegrity, 'valid');
  assert.equal(summaryResult.overall, 'invalid');
  assert.match(summaryResult.errors.join(' '), /Declared verification summary/);
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

  const closingMigration = readFileSync(
    'supabase/migrations/20260909120000_close_evidence_package_v2_integration.sql',
    'utf8'
  );
  assert.match(closingMigration, /public_verification_token/);
  assert.match(closingMigration, /source_table/);
  assert.match(closingMigration, /source_record_id/);
  assert.match(closingMigration, /efirma_bundle_path/);
  assert.match(closingMigration, /efirma_bundle_sha256/);
  assert.match(closingMigration, /protect_document_additional_metadata/);
  assert.match(closingMigration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(closingMigration, /efirma_signature_bundle/);

  const grantsMigration = readFileSync(
    'supabase/migrations/20260909170121_lock_down_evidence_v2_table_grants.sql',
    'utf8'
  );
  assert.match(
    grantsMigration,
    /REVOKE ALL PRIVILEGES ON TABLE public\.evidence_packages[\s\S]*PUBLIC, anon, authenticated/
  );
  assert.match(
    grantsMigration,
    /REVOKE ALL PRIVILEGES ON TABLE public\.evidence_package_artifacts[\s\S]*PUBLIC, anon, authenticated/
  );
  assert.match(grantsMigration, /GRANT SELECT ON TABLE public\.evidence_packages TO authenticated/);
  assert.match(
    grantsMigration,
    /GRANT SELECT ON TABLE public\.evidence_package_artifacts TO authenticated/
  );
});

test('v1 routes remain present and the v2 integration never rewrites legacy XML columns', () => {
  const v1Route = readFileSync('src/app/api/nom151/xml-evidence/download/route.ts', 'utf8');
  const v2Route = readFileSync('src/app/api/documentos/[documentId]/evidence-v2/route.ts', 'utf8');
  assert.match(v1Route, /xml_evidencia_path/);
  assert.doesNotMatch(v2Route, /update\([\s\S]*xml_evidencia_path/);
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
