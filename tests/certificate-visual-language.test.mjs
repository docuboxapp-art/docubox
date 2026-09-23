import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = {
  technical: await readFile('src/lib/certification/pdf.ts', 'utf8'),
  general: await readFile('src/lib/documents/general-signature-certificate.ts', 'utf8'),
  audit: await readFile('src/lib/documents/audit-closure-certificate.ts', 'utf8'),
  individual: await readFile('src/lib/documents/individual-participation-certificate.ts', 'utf8'),
  nom151: await readFile('src/lib/documents/nom151-certificate.ts', 'utf8'),
  individualRoute: await readFile('src/app/api/documentos/[documentId]/mi-constancia/route.ts', 'utf8'),
  nom151Route: await readFile('src/app/api/nom151/pdf/route.ts', 'utf8'),
  efirmaGateway: await readFile('supabase/functions/efirma-gateway/index.ts', 'utf8'),
  signEfirma: await readFile('supabase/functions/sign-efirma/index.ts', 'utf8'),
};

test('all customer-facing certificates use the 2026 Docubox brand asset', () => {
  assert.match(files.technical, /docubox-logo-2026\.png/);
  assert.doesNotMatch(files.technical, /logo-D-1775350208982\.png/);
  assert.match(files.general, /docubox-logo-2026\.png/);
  assert.match(files.audit, /docubox-logo-2026\.png/);
  assert.match(files.individualRoute, /docubox-logo-2026\.png/);
  assert.match(files.nom151Route, /docubox-logo-2026\.png/);
});

test('certificate generators share the current visual hierarchy', () => {
  for (const source of [files.technical, files.general, files.audit, files.individual, files.nom151]) {
    assert.match(source, /drawHeader|drawPageHeader/);
    assert.match(source, /softBlue|paleBlue|accentSoft/);
    assert.match(source, /drawFooter|footerLogo/);
  }
});

test('individual e.firma certificate distinguishes Nubarium, OCSP, PAdES and TSA evidence', () => {
  assert.match(files.individualRoute, /validation_provider/);
  assert.match(files.individualRoute, /nubarium_estado/);
  assert.match(files.individualRoute, /timestamp_records/);
  assert.match(files.individualRoute, /pades_profile/);
  assert.match(files.individual, /Proveedor de validación SAT/);
  assert.match(files.individual, /Estado de revocación \(OCSP\)/);
  assert.match(files.individual, /wrapCompleteLines/);
  assert.doesNotMatch(files.individual, /return parsed\.toISOString\(\)/);
  assert.match(files.efirmaGateway, /nubarium_validation/);
  assert.match(files.signEfirma, /nubarium_codigo_validacion/);
  assert.match(files.signEfirma, /efirma_nubarium_resp/);
});
