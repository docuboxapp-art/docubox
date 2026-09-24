import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sizingPath = new URL('../src/lib/signatures/stamp-sizing.ts', import.meta.url);
const stampPath = new URL('../src/lib/signatures/pdf-stamp.ts', import.meta.url);
const profilePath = new URL('../src/app/mi-perfil/page.tsx', import.meta.url);
const signingPath = new URL('../src/app/firmar-documento/[id]/page.tsx', import.meta.url);
const repositoryPath = new URL('../src/lib/public-verification/repository.ts', import.meta.url);
const verificationTypesPath = new URL('../src/lib/public-verification/types.ts', import.meta.url);
const verificationViewPath = new URL(
  '../src/app/verificar-documento/components/VerificationResultView.tsx',
  import.meta.url
);
const qrComponentPath = new URL(
  '../src/components/signatures/SignatureQrCode.tsx',
  import.meta.url
);
const middlewarePath = new URL('../src/middleware.ts', import.meta.url);
const selectorPaths = [
  '../src/app/mi-perfil/components/AutografaStampSelector.tsx',
  '../src/app/mi-perfil/components/EfirmaStampSelector.tsx',
  '../src/app/mi-perfil/components/ClickSignStampSelector.tsx',
].map((path) => new URL(path, import.meta.url));
const migrationPath = new URL(
  '../supabase/migrations/20260922161610_default_signature_stamps_and_public_qr.sql',
  import.meta.url
);
const autographMigrationPath = new URL(
  '../supabase/migrations/20260922213514_default_autograph_ac0.sql',
  import.meta.url
);
const currentAutographMigrationPath = new URL(
  '../supabase/migrations/20260924073852_default_autograph_ac1_after_layout_shift.sql',
  import.meta.url
);

test('all signature methods share the requested default stamp styles', async () => {
  const [sizing, stamp, profile, signing, migration, autographMigration, currentAutographMigration] = await Promise.all([
    readFile(sizingPath, 'utf8'),
    readFile(stampPath, 'utf8'),
    readFile(profilePath, 'utf8'),
    readFile(signingPath, 'utf8'),
    readFile(migrationPath, 'utf8'),
    readFile(autographMigrationPath, 'utf8'),
    readFile(currentAutographMigrationPath, 'utf8'),
  ]);

  assert.match(sizing, /autografa: 'AC1'/);
  assert.match(sizing, /efirma: 'EC2'/);
  assert.match(sizing, /clicksign: 'CC2'/);
  assert.match(stamp, /getDefaultSignatureStampStyle\(method\)/);
  assert.match(profile, /DEFAULT_SIGNATURE_STAMP_STYLES\.autografa/);
  assert.match(profile, /DEFAULT_SIGNATURE_STAMP_STYLES\.efirma/);
  assert.match(profile, /DEFAULT_SIGNATURE_STAMP_STYLES\.clicksign/);
  assert.match(signing, /DEFAULT_SIGNATURE_STAMP_STYLES\.autografa/);
  assert.match(signing, /DEFAULT_SIGNATURE_STAMP_STYLES\.efirma/);
  assert.match(signing, /DEFAULT_SIGNATURE_STAMP_STYLES\.clicksign/);

  for (const [column, style] of [
    ['autografa_stamp_style', 'AC1'],
    ['efirma_stamp_style', 'EC2'],
    ['click_sign_stamp_style', 'CC2'],
  ]) {
    assert.match(migration, new RegExp(`ALTER COLUMN ${column} SET DEFAULT '${style}'`));
    assert.match(migration, new RegExp(`${column} = '${style}'`));
  }
  assert.match(autographMigration, /ALTER COLUMN autografa_stamp_style SET DEFAULT 'AC0'/);
  assert.match(autographMigration, /SET autografa_stamp_style = 'AC0'/);
  assert.match(currentAutographMigration, /ALTER COLUMN autografa_stamp_style SET DEFAULT 'AC1'/);
  assert.match(currentAutographMigration, /WHEN autografa_stamp_style = 'AC1' THEN 'AC2'/);
  assert.match(currentAutographMigration, /autografa_stamp_style IN \('AC0', 'AC1'\)/);
});

test('stamp QR opens the direct public validator and exposes only essential signature data', async () => {
  const [signing, repository, types, view] = await Promise.all([
    readFile(signingPath, 'utf8'),
    readFile(repositoryPath, 'utf8'),
    readFile(verificationTypesPath, 'utf8'),
    readFile(verificationViewPath, 'utf8'),
  ]);

  assert.match(
    signing,
    /verification_url: `\$\{getPublicAppUrl\(\)\}\/v\/\$\{encodeURIComponent\(document\.id\)\}`/
  );
  assert.doesNotMatch(signing, /verificar-documento\?documento=/);
  assert.match(repository, /email: maskEmail\(rawEmail \|\| evidenceEmail\)/);
  assert.match(repository, /signature_hash,digital_seal_sha256/);
  assert.match(repository, /signatureHash:/);
  assert.match(types, /signatureHash\?: string \| null/);
  assert.match(view, /Huella de firma/);
  assert.match(view, /participant\.signatureHash/);
  assert.doesNotMatch(repository, /geo_latitude|geo_longitude|ip_address|user_agent/);
});

test('all stamp previews use encoded QR modules and the public validator bypasses session checks', async () => {
  const [qr, stamp, signing, middleware, ...selectors] = await Promise.all(
    [qrComponentPath, stampPath, signingPath, middlewarePath, ...selectorPaths].map((path) =>
      readFile(path, 'utf8')
    )
  );

  assert.match(qr, /QRCode\.create\(value/);
  assert.match(qr, /size \+ 8/);
  assert.match(qr, /shapeRendering="crispEdges"/);
  assert.match(stamp, /margin: 4/);
  assert.match(stamp, /width: 512/);
  assert.match(middleware, /'\/api\/public\/v1\/verifications\/'/);
  for (const source of [signing, ...selectors]) {
    assert.match(source, /<SignatureQrCode/);
    assert.doesNotMatch(source, /viewBox="0 0 20 20"/);
  }
});
