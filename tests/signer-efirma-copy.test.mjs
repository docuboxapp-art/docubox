import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const signerPath = path.join(process.cwd(), 'src', 'app', 'firmar-documento', '[id]', 'page.tsx');
const source = fs.readFileSync(signerPath, 'utf8');
const evidenceHook = fs.readFileSync(
  path.join(process.cwd(), 'src', 'hooks', 'useEfirmaEvidence.ts'),
  'utf8'
);
const efirmaFunction = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'functions', 'sign-efirma', 'index.ts'),
  'utf8'
);
const efirmaGateway = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'functions', 'efirma-gateway', 'index.ts'),
  'utf8'
);
const autographFlow = fs.readFileSync(
  path.join(process.cwd(), 'src', 'app', 'firmar-documento', '[id]', 'AutographSignatureFlow.tsx'),
  'utf8'
);
const profileSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'app', 'mi-perfil', 'page.tsx'),
  'utf8'
);
const clientVault = fs.readFileSync(
  path.join(process.cwd(), 'src', 'lib', 'efirma', 'client-vault.ts'),
  'utf8'
);
const vaultMigration = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260921080518_encrypted_efirma_key_vault.sql'
  ),
  'utf8'
);

test('offers the saved encrypted e.firma and a fresh upload', () => {
  assert.match(source, /Preparar firma con e\.firma SAT/i);
  assert.match(source, /Utilizar mi e\.firma guardada/);
  assert.match(source, /Cargar de nuevo mi e\.firma/);
  assert.match(source, /La contraseña no sale de este dispositivo/i);
});

test('shows the signature method assigned to the participant in the terms card', () => {
  const termsCard = source.slice(
    source.indexOf('Signature type indicator for firmante'),
    source.indexOf('Términos de participación')
  );

  assert.match(
    source,
    /const configured = myParticipantData\?\.tipoFirma \?\? myParticipantData\?\.tipo_firma/
  );
  assert.match(source, /const signatureTypeLabel =\s*isEfirmaSAT\s*\? 'e\.firma SAT'/);
  assert.match(termsCard, /\{signatureTypeLabel\}/);
  assert.doesNotMatch(termsCard, /savedSignatureType/);
});

test('encrypts and signs with the private key in the browser', () => {
  assert.match(clientVault, /AES-GCM/);
  assert.match(clientVault, /PBKDF2/);
  assert.match(clientVault, /privateKey\.sign\(digest\)/);
  assert.match(source, /signEfirmaPayloadLocally/);
  assert.match(source, /PREPARE_CLIENT_SIGNATURE/);
  assert.match(source, /COMPLETE_CLIENT_SIGNATURE/);
});

test('the profile persists public metadata and an opaque encrypted key', () => {
  const profileUpdate = profileSource.slice(
    profileSource.indexOf('const handleSaveEfirma'),
    profileSource.indexOf('const handleUnlinkEfirma')
  );
  assert.match(profileUpdate, /efirma_rfc:/);
  assert.match(profileUpdate, /efirma_serial:/);
  assert.match(profileUpdate, /saveStoredEfirmaKey/);
  assert.doesNotMatch(vaultMigration, /^\s*(?:password|plaintext_key)\s+/im);
  assert.match(vaultMigration, /encrypted_key_ciphertext TEXT NOT NULL/);
  assert.match(vaultMigration, /auth\.uid\(\)\) = user_id/);
});

test('the signing endpoint cannot receive a private key or password', () => {
  assert.doesNotMatch(efirmaFunction, /key_b64|private_key_password|encrypted_private_key_base64/);
  assert.doesNotMatch(efirmaFunction, /body\.password/);
  assert.match(efirmaFunction, /operation: 'VERIFY_EFIRMA'/);
});

test('the e.firma gateway verifies the local signature and checks SAT status', () => {
  assert.match(efirmaGateway, /RSASSA-PKCS1-v1_5/);
  assert.match(efirmaGateway, /crypto\.subtle\.verify/);
  assert.match(efirmaGateway, /api\.nubarium\.com\/sat\/v1\/validar-serial/);
  assert.match(efirmaGateway, /DOCUBOX_EFIRMA_GATEWAY_TOKEN/);
  assert.doesNotMatch(efirmaGateway, /key_b64|private_key_password|body\.password/);
});

test('the completed e.firma summary presents normalized certificate identity and validation', () => {
  assert.match(source, /function extractEfirmaHolderName/);
  assert.match(source, /efirma_nombre: holderName \|\| null/);
  assert.match(source, /e\.firma SAT validada con Nubarium/);
  assert.match(source, /Fecha y hora de firma \(servidor\)/);
  assert.match(source, /formatEfirmaEvidenceDate\(ev\.serverTimestamp\)/);
  assert.doesNotMatch(source, /Estampa de tiempo del servidor \(ISO 8601\)/);
});

test('the persisted evidence excludes the private key and its password', () => {
  const persistedEvidence = efirmaFunction.slice(
    efirmaFunction.indexOf('const evidenceBundle = JSON.stringify'),
    efirmaFunction.indexOf("await supabase.rpc('append_legal_evidence_event'")
  );

  assert.match(persistedEvidence, /certificate_der_base64: cerBase64/);
  assert.doesNotMatch(
    persistedEvidence,
    /encrypted_private_key_base64|private_key_password|keyBase64|password/
  );
});

test('final evidence uses the certificate selected for this signing attempt', () => {
  assert.match(source, /efirmaCertInfo\?\.cert_serial \|\| profileEfirma\?\.serial/);
  assert.match(source, /efirmaCertInfo\?\.cert_rfc \|\| profileEfirma\?\.rfc/);
  assert.match(source, /certificate_serial: isEfirmaSAT \? activeEfirmaSerial \|\| null/);
  assert.match(source, /efirmaVigenciaFin: isEfirmaSAT \? activeEfirmaValidUntil \|\| null/);
});

test('e.firma carries the common session and device evidence into final signing', () => {
  assert.match(source, /session_evidence: activeEfirmaSessionEvidence/);
  assert.match(source, /device_fingerprint: activeEfirmaDeviceFingerprint/);
  assert.match(source, /functions\/v1\/upload-session-frames/);
  assert.match(evidenceHook, /frameBytes = await fetch\(dataUrl\)/);
  assert.match(autographFlow, /hashVal = await sha256Bytes\(frameBytes\)/);
  assert.match(evidenceHook, /country_code:/);
  assert.match(efirmaFunction, /screen_resolution:/);
  assert.match(efirmaFunction, /participant_name:/);
  assert.match(efirmaFunction, /document_pages:/);
});
