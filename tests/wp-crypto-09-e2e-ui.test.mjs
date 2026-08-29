import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const featureFlagPath = new URL('../src/lib/certification/feature-flags.ts', import.meta.url);
const accessPath = new URL('../src/lib/certification/access.ts', import.meta.url);
const enginePath = new URL('../src/lib/certification/engine.ts', import.meta.url);
const certificationRoutePath = new URL('../src/app/api/documents/[documentId]/certifications/route.ts', import.meta.url);
const artifactRoutePath = new URL('../src/app/api/documents/[documentId]/certifications/[certificationUuid]/artifacts/[artifact]/route.ts', import.meta.url);
const viewerPath = new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url);
const authConfirmPath = new URL('../src/app/auth/confirm/route.ts', import.meta.url);
const middlewarePath = new URL('../src/middleware.ts', import.meta.url);

test('WP-09 keeps certification execution disabled unless the backend flag explicitly enables it', async () => {
  const [flag, route, viewer] = await Promise.all([
    readFile(featureFlagPath, 'utf8'),
    readFile(certificationRoutePath, 'utf8'),
    readFile(viewerPath, 'utf8'),
  ]);
  assert.match(flag, /CRYPTO_CERTIFICATION_E2E_ENABLED/);
  assert.match(flag, /value === '1' \|\| value === 'true' \|\| value === 'enabled'/);
  assert.match(route, /CRYPTO_CERTIFICATION_E2E_DISABLED/);
  assert.match(route, /e2eEnabled: isCryptoCertificationE2eEnabled\(\)/);
  assert.match(viewer, /certificationE2eEnabled/);
  assert.match(viewer, /Ejecucion integral deshabilitada/);
});

test('WP-09 exposes individual technical artifacts only through authenticated backend routes', async () => {
  const [route, engine] = await Promise.all([
    readFile(artifactRoutePath, 'utf8'),
    readFile(enginePath, 'utf8'),
  ]);
  assert.match(route, /requireApiUser\(request\)/);
  assert.match(route, /verification-report/);
  assert.match(route, /timestamp-token/);
  assert.match(route, /signing-certificate/);
  assert.match(route, /certificate-chain/);
  assert.match(route, /evidence-manifest/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
  assert.match(route, /Referrer-Policy': 'no-referrer'/);
  assert.match(engine, /technical\/verification-report\.json/);
  assert.match(engine, /technical\/signing-certificate\.pem/);
  assert.match(engine, /technical\/certificate-chain\.pem/);
  assert.match(engine, /technical\/evidence-manifest\.json/);
});

test('WP-09 authorizes technical certification artifacts for the owner or workspace manager', async () => {
  const [access, engine] = await Promise.all([
    readFile(accessPath, 'utf8'),
    readFile(enginePath, 'utf8'),
  ]);
  assert.match(access, /\.eq\('status', 'active'\)/);
  assert.match(access, /\.in\('role', \['owner', 'admin'\]\)/);
  assert.match(access, /CERTIFICATION_ACCESS_DENIED/);
  assert.match(engine, /requireCertificationManagerAccess\(supabase, documentId, userId\)/);
});

test('WP-09 only presents verified PAdES and RFC 3161 artifacts after provider verification', async () => {
  const engine = await readFile(enginePath, 'utf8');
  assert.match(engine, /providers\.pdfSignature\.verifyPdf/);
  assert.match(engine, /PADES_VERIFICATION_FAILED/);
  assert.match(engine, /PADES_TIMESTAMP_VERIFICATION_FAILED/);
  assert.match(engine, /status: 'VALID'/);
  assert.match(engine, /timestamp_status: \(signedPdf\.profile === 'PAdES-B-T'/);
});

test('authenticated crypto viewer exchanges a token hash without bypassing Auth or RLS', async () => {
  const [callback, middleware, route] = await Promise.all([
    readFile(authConfirmPath, 'utf8'),
    readFile(middlewarePath, 'utf8'),
    readFile(certificationRoutePath, 'utf8'),
  ]);
  assert.match(callback, /supabase\.auth\.verifyOtp\(\{ token_hash: tokenHash, type \}\)/);
  assert.match(callback, /Cache-Control', 'private, no-store'/);
  assert.match(callback, /value\.startsWith\('\/\/'\)/);
  assert.match(middleware, /'\/auth\/confirm'/);
  assert.match(route, /requireApiUser\(request\)/);
  assert.match(route, /orchestrator\.getStatus\(documentId, user\.id\)/);
});

test('production crypto labels come only from persisted viewer evidence', async () => {
  const [route, viewer] = await Promise.all([
    readFile(certificationRoutePath, 'utf8'),
    readFile(viewerPath, 'utf8'),
  ]);
  assert.match(route, /\.from\('cryptographic_keys'\)/);
  assert.match(route, /createPublicKey\(key\.data\.public_key_pem\)/);
  assert.match(route, /certificateKeyMatches = certificate\?\.key_matches === true/);
  assert.match(route, /timestampTrustBundleId/);
  assert.match(route, /certification\?\.status === 'COMPLETED'/);
  assert.match(viewer, /Google Cloud HSM/);
  assert.match(viewer, /RSA \$\{cryptographicCertification\.kmsKeySizeBits\} \/ \$\{cryptographicCertification\.padesDigestAlgorithm\}/);
  assert.match(viewer, /Certificado X\.509/);
  assert.match(viewer, /Vínculo SPKI/);
  assert.match(viewer, /Sello RFC 3161/);
  assert.match(viewer, /Constancia NOM-151 verificada/);
  assert.match(viewer, /getNom151Presentation/);
  assert.doesNotMatch(viewer, /NOM-151 no productiva/);
});
