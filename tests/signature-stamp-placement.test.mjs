import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stampPath = new URL('../src/lib/signatures/pdf-stamp.ts', import.meta.url);
const routePath = new URL(
  '../src/app/api/documentos/[documentId]/seal-signatures/route.ts',
  import.meta.url
);
const viewerPath = new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url);
const nom151RoutePath = new URL('../src/app/api/nom151/generate/route.ts', import.meta.url);
const nom151ServicePath = new URL('../src/lib/nom151/service.ts', import.meta.url);
const signingPagePath = new URL('../src/app/firmar-documento/[id]/page.tsx', import.meta.url);
const evidenceOrchestratorPath = new URL('../src/lib/evidence-v2/orchestrator.ts', import.meta.url);
const autographSelectorPath = new URL(
  '../src/app/mi-perfil/components/AutografaStampSelector.tsx',
  import.meta.url
);
const stampSizingPath = new URL('../src/lib/signatures/stamp-sizing.ts', import.meta.url);
const documentSettingsPath = new URL(
  '../src/app/crear-documento/components/StepAjustes.tsx',
  import.meta.url
);

test('signature stamps fit the exact user field and only use recommended sizes as presets', async () => {
  const [stampSource, sizingSource, settingsSource, signingSource] = await Promise.all([
    readFile(stampPath, 'utf8'),
    readFile(stampSizingPath, 'utf8'),
    readFile(documentSettingsPath, 'utf8'),
    readFile(signingPagePath, 'utf8'),
  ]);

  assert.match(stampSource, /function resolveSignatureStampBox/);
  assert.match(stampSource, /function getAdaptiveStampRenderBox/);
  assert.match(stampSource, /const embeddedStamp = await pdf\.embedPage\(normalizedPage\)/);
  assert.match(stampSource, /width: stampWidth,\s*height: stampHeight/);
  assert.doesNotMatch(stampSource, /Math\.max\(24, \(pageWidth/);
  assert.doesNotMatch(stampSource, /pageHeight - stampHeight - 12/);

  for (const dimensions of [
    ['short', 24, 8],
    ['medium', 34, 12],
    ['large', 44, 16],
  ]) {
    const [id, width, height] = dimensions;
    assert.match(
      sizingSource,
      new RegExp(`id: '${id}'[\\s\\S]*?widthPercent: ${width}[\\s\\S]*?heightPercent: ${height}`)
    );
  }

  assert.match(settingsSource, /aria-label="Aplicar tamaño sugerido para la estampa"/);
  assert.match(settingsSource, /applySuggestedStampSize/);
  assert.doesNotMatch(settingsSource, /isFirma\s*\? \{ width: 24, height: 8 \}/);
  assert.match(signingSource, /tipo === 'firma' \? shortStampPreset\.widthPercent : 16/);
  assert.match(signingSource, /tipo === 'firma' \? shortStampPreset\.heightPercent : 4/);
});

test('signature renderer never invents a fallback evidence page', async () => {
  const source = await readFile(stampPath, 'utf8');
  assert.doesNotMatch(source, /EVIDENCIA DE FIRMAS/);
  assert.doesNotMatch(source, /pdf\.addPage/);
  assert.match(source, /stampsApplied \+= 1/);
});

test('signature endpoint rejects documents without configured signature fields', async () => {
  const source = await readFile(routePath, 'utf8');
  assert.match(source, /signatureFields\.length === 0/);
  assert.match(source, /no tiene campos de firma configurados para estampar/);
  assert.match(source, /stampsApplied === 0/);
});

test('signature endpoint resolves the historic current-user field to the owner UUID', async () => {
  const source = await readFile(routePath, 'utf8');
  assert.match(source, /normalize\(field\.participantId\) === 'current-user'/);
  assert.match(source, /participantId: document\.owner_id/);
  assert.match(source, /fields: resolvedSignatureFields/);
});

test('signature stamps require an explicit field type or an exact legacy signature label', async () => {
  const [stampSource, viewerSource] = await Promise.all([
    readFile(stampPath, 'utf8'),
    readFile(viewerPath, 'utf8'),
  ]);

  assert.match(stampSource, /legacySignatureLabels/);
  assert.match(stampSource, /type === 'firma' \|\| type === 'signature'/);
  assert.match(stampSource, /return !type && legacySignatureLabels\.has/);
  assert.doesNotMatch(stampSource, /\/firma\/i/);
  assert.match(viewerSource, /type === 'firma' \|\| type === 'signature'/);
  assert.match(viewerSource, /!type &&\s*\['firma', 'firma digital'/);
  assert.doesNotMatch(viewerSource, /\/firma\/i\.test/);
});

test('the final PDF renders the e.firma style saved with the participation', async () => {
  const [stampSource, signingSource] = await Promise.all([
    readFile(stampPath, 'utf8'),
    readFile(signingPagePath, 'utf8'),
  ]);

  assert.match(
    signingSource,
    /signature_stamp_style:\s*myRole === 'firmante' \? selectedStampStyle/
  );
  assert.match(stampSource, /const style = responseStyle\(response\)/);
  assert.match(stampSource, /style === 'EC3' \|\| style === 'EM3' \|\| style === 'EL3'/);
  assert.match(stampSource, /function drawCompactLateralEfirmaStamp/);
  assert.match(
    stampSource,
    /if \(style === 'EC3'\) \{[\s\S]*?drawCompactLateralEfirmaStamp\([\s\S]*?return;/
  );
  assert.match(stampSource, /style === 'EM4'/);
  assert.match(stampSource, /const medium = style\.startsWith\('EM'\)/);
  for (const style of ['EM1', 'EM2', 'EM3', 'EM4', 'EM5', 'EL1', 'EL3', 'EL4']) {
    assert.match(stampSource, new RegExp(`'${style}'`));
  }
  assert.match(stampSource, /\['FECHA Y HORA', signedAt\]/);
  assert.match(stampSource, /\['SERIE DEL CERTIFICADO', serial\]/);
  assert.match(stampSource, /\['VALIDACIÓN', 'Certificado verificado'\]/);
  assert.match(
    stampSource,
    /if \(method === 'efirma'\) \{[\s\S]*?await drawEfirmaStamp\([\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(stampSource, /QRCode\.toDataURL\(value/);
});

test('short click and sign stamps preserve the selected CC1-CC5 layout and complete hash', async () => {
  const stampSource = await readFile(stampPath, 'utf8');
  assert.match(stampSource, /async function drawClickSignShortStamp/);
  assert.match(stampSource, /method === 'clicksign' && \/\^CC\[1-5\]\$\//);
  const rendererStart = stampSource.indexOf('async function drawClickSignShortStamp');
  const rendererEnd = stampSource.indexOf('async function drawStamp', rendererStart);
  const renderer = stampSource.slice(rendererStart, rendererEnd);
  assert.match(renderer, /style === 'CC2'/);
  assert.match(renderer, /style === 'CC3'/);
  assert.match(renderer, /style === 'CC4'/);
  assert.match(renderer, /style === 'CC5'/);
  assert.match(renderer, /drawClickSignHashPanel/);
  assert.doesNotMatch(renderer, /shortHash\(/);
  assert.match(renderer, /embedQrCode/);
});

test('medium click and sign stamps preserve the selected CM1-CM5 layout and complete hash', async () => {
  const stampSource = await readFile(stampPath, 'utf8');
  assert.match(stampSource, /async function drawClickSignMediumStamp/);
  assert.match(stampSource, /method === 'clicksign' && \/\^CM\[1-5\]\$\//);
  const rendererStart = stampSource.indexOf('async function drawClickSignMediumStamp');
  const rendererEnd = stampSource.indexOf('async function drawStamp', rendererStart);
  const renderer = stampSource.slice(rendererStart, rendererEnd);
  assert.match(renderer, /style === 'CM2'/);
  assert.match(renderer, /style === 'CM3'/);
  assert.match(renderer, /style === 'CM4'/);
  assert.match(renderer, /style === 'CM5'/);
  assert.match(renderer, /drawClickSignHashPanel/);
  assert.doesNotMatch(renderer, /shortHash\(/);
  assert.match(renderer, /drawCornerMarks/);
  assert.match(renderer, /embedQrCode/);
});

test('long click and sign stamps preserve the selected CL1-CL4 layout and complete hash', async () => {
  const stampSource = await readFile(stampPath, 'utf8');
  assert.match(stampSource, /async function drawClickSignLongStamp/);
  assert.match(stampSource, /method === 'clicksign' && \/\^CL\[1-4\]\$\//);
  const rendererStart = stampSource.indexOf('async function drawClickSignLongStamp');
  const rendererEnd = stampSource.indexOf('async function drawStamp', rendererStart);
  const renderer = stampSource.slice(rendererStart, rendererEnd);
  assert.match(renderer, /style === 'CL1'/);
  assert.match(renderer, /style === 'CL2'/);
  assert.match(renderer, /style === 'CL3'/);
  assert.match(renderer, /style === 'CL4'/);
  assert.match(renderer, /drawClickSignHashPanel/);
  assert.doesNotMatch(renderer, /shortHash\(/);
  assert.match(renderer, /drawCornerMarks/);
  assert.match(renderer, /embedQrCode/);
});

test('short autograph stamps preserve the selected AC0-AC5 layout and complete hash', async () => {
  const [stampSource, selectorSource] = await Promise.all([
    readFile(stampPath, 'utf8'),
    readFile(autographSelectorPath, 'utf8'),
  ]);

  assert.match(stampSource, /async function drawAutografaStamp/);
  assert.match(stampSource, /method === 'autografa' && \/\^AC\[0-5\]\$\/.test\(style\)/);
  const rendererStart = stampSource.indexOf('async function drawAutografaStamp');
  const rendererEnd = stampSource.indexOf('function drawCompactLateralEfirmaStamp', rendererStart);
  const renderer = stampSource.slice(rendererStart, rendererEnd);
  assert.match(renderer, /drawClickSignHashPanel/);
  assert.doesNotMatch(renderer, /shortHash\(/);
  assert.match(renderer, /showName: style !== 'AC0'/);
  assert.match(renderer, /style === 'AC3'/);
  assert.match(renderer, /style === 'AC4'/);
  assert.match(renderer, /style === 'AC5'/);
  assert.match(renderer, /Firmado:/);
  assert.match(renderer, /embedQrCode/);
  assert.match(renderer, /const withQr = style !== 'AC0' && style !== 'AC1'/);
  assert.match(renderer, /color: blue/);

  for (const label of [
    'AC0 · Firma mínima sin nombre',
    'AC1 · Firma mínima con nombre',
    'AC2 · Base compacta con QR',
    'AC3 · Marco compacto',
    'AC4 · Franja lateral',
    'AC5 · Ticket vertical',
  ]) {
    assert.ok(selectorSource.includes(label), `Missing selector model: ${label}`);
  }
  const shortPreviewStart = selectorSource.indexOf('// ── AC0 Firma mínima sin nombre');
  const shortPreviewEnd = selectorSource.indexOf("variant.id === 'AM1'", shortPreviewStart);
  const shortPreviews = selectorSource.slice(shortPreviewStart, shortPreviewEnd);
  assert.doesNotMatch(shortPreviews, /hashShort/);
  assert.match(shortPreviews, /shortHashBlock/);
  assert.doesNotMatch(shortPreviews, /hashBlock\(true\)/);
  const ac2Start = shortPreviews.indexOf("variant.id === 'AC2'");
  const ac3Start = shortPreviews.indexOf("variant.id === 'AC3'", ac2Start);
  assert.match(shortPreviews.slice(ac2Start, ac3Start), /qrBlock/);
  const ac0Start = shortPreviews.indexOf("variant.id === 'AC0'");
  const ac1Start = shortPreviews.indexOf("variant.id === 'AC1'", ac0Start);
  assert.match(shortPreviews.slice(ac0Start, ac1Start), /roleActBlock/);
  assert.doesNotMatch(shortPreviews.slice(ac0Start, ac1Start), /identityBlock/);
});

test('medium autograph stamps preserve AM1-AM5 fields, authentication and complete hash', async () => {
  const [stampSource, selectorSource, signingSource] = await Promise.all([
    readFile(stampPath, 'utf8'),
    readFile(autographSelectorPath, 'utf8'),
    readFile(signingPagePath, 'utf8'),
  ]);

  assert.match(stampSource, /async function drawAutografaMediumStamp/);
  assert.match(stampSource, /method === 'autografa' && \/\^AM\[1-5\]\$\/.test\(style\)/);
  const rendererStart = stampSource.indexOf('async function drawAutografaMediumStamp');
  const rendererEnd = stampSource.indexOf('function drawCompactLateralEfirmaStamp', rendererStart);
  const renderer = stampSource.slice(rendererStart, rendererEnd);
  assert.match(renderer, /metadata\.participant_role/);
  assert.match(renderer, /metadata\.participant_act/);
  assert.match(renderer, /metadata\.participant_capacity/);
  assert.match(renderer, /metadata\.authentication_status/);
  assert.match(renderer, /metadata\.otp_verified === true/);
  assert.match(renderer, /drawClickSignHashPanel/);
  assert.doesNotMatch(renderer, /shortHash\(/);
  assert.match(renderer, /style === 'AM1'/);
  assert.match(renderer, /style === 'AM2'/);
  assert.match(renderer, /style === 'AM3'/);
  assert.match(renderer, /style === 'AM4'/);
  assert.match(renderer, /style === 'AM5'/);
  assert.match(renderer, /embedQrCode/);
  assert.match(renderer, /color: blue/);

  for (const label of [
    'AM1 · Estándar mediana',
    'AM2 · Marco mediano',
    'AM3 · Franja 3 columnas',
    'AM4 · Encabezado sobrio',
    'AM5 · Ticket QR grande',
  ]) {
    assert.ok(selectorSource.includes(label), `Missing selector model: ${label}`);
  }
  const mediumPreviewStart = selectorSource.indexOf('// ── AM1 Estándar mediana');
  const mediumPreviewEnd = selectorSource.indexOf('// ── AL1 Estándar larga');
  const mediumPreviews = selectorSource.slice(mediumPreviewStart, mediumPreviewEnd);
  assert.doesNotMatch(mediumPreviews, /hashBlock\(\)/);
  assert.match(mediumPreviews, /shortHashBlock/);
  assert.match(mediumPreviews, /bg-blue-600/);
  assert.match(selectorSource, /autógrafa · información intermedia/);
  assert.match(selectorSource, /const authentication = 'OTP verificado'/);
  assert.match(signingSource, /participant_role: myRole/);
  assert.match(signingSource, /participant_capacity:/);
  assert.match(signingSource, /otp_verified:/);
  assert.match(signingSource, /authentication_status:/);
});

test('long autograph stamps preserve AL1-AL4 structured data and complete hash', async () => {
  const [stampSource, selectorSource, signingSource] = await Promise.all([
    readFile(stampPath, 'utf8'),
    readFile(autographSelectorPath, 'utf8'),
    readFile(signingPagePath, 'utf8'),
  ]);

  assert.match(stampSource, /async function drawAutografaLongStamp/);
  assert.match(stampSource, /method === 'autografa' && \/\^AL\[1-4\]\$\/.test\(style\)/);
  const rendererStart = stampSource.indexOf('async function drawAutografaLongStamp');
  const rendererEnd = stampSource.indexOf('function drawCompactLateralEfirmaStamp', rendererStart);
  const renderer = stampSource.slice(rendererStart, rendererEnd);
  assert.match(renderer, /metadata\.participant_role/);
  assert.match(renderer, /metadata\.participant_act/);
  assert.doesNotMatch(renderer, /metadata\.document_reference|REFERENCIA/);
  assert.match(renderer, /maskIdentityValue\(metadata\.rfc\)/);
  assert.match(renderer, /maskIdentityValue\(metadata\.curp\)/);
  assert.match(renderer, /drawClickSignHashPanel/);
  assert.doesNotMatch(renderer, /shortHash\(/);
  assert.match(renderer, /style === 'AL1'/);
  assert.match(renderer, /style === 'AL2'/);
  assert.match(renderer, /style === 'AL3'/);
  assert.match(renderer, /style === 'AL4'/);
  assert.match(renderer, /embedQrCode/);
  assert.match(renderer, /color: blue/);

  for (const label of [
    'AL1 · Estándar larga',
    'AL2 · Marco formal',
    'AL3 · Franja analítica',
    'AL4 · Ficha estructurada',
  ]) {
    assert.ok(selectorSource.includes(label), `Missing selector model: ${label}`);
  }
  const longPreviewStart = selectorSource.indexOf('// ── AL1 Estándar larga');
  const longPreviewEnd = selectorSource.indexOf('// ─── Detail Modal', longPreviewStart);
  const longPreviews = selectorSource.slice(longPreviewStart, longPreviewEnd);
  assert.doesNotMatch(longPreviews, /hashBlock\(\)/);
  assert.match(longPreviews, /shortHashBlock/);
  assert.doesNotMatch(longPreviews, /REFERENCIA|DOC-2025-001/);
  assert.match(longPreviews, /bg-blue-600/);
  assert.match(selectorSource, /autógrafa · información completa visible/);
  assert.match(longPreviews, /RFC \(OPCIONAL\)/);
  assert.match(longPreviews, /CURP \(OPCIONAL\)/);
  assert.match(signingSource, /participant_act:/);
  assert.match(signingSource, /document_reference:/);
  assert.match(signingSource, /curp: userProfile\.curp/);
  assert.match(signingSource, /userCurp\?: string/);
  assert.match(signingSource, /participantRole\?: string/);
  assert.match(signingSource, /participantAct\?: string/);
  assert.doesNotMatch(signingSource, /documentReference\?: string/);
  const signingAutographStart = signingSource.indexOf("if (signatureType === 'autografa')");
  const signingLongStart = signingSource.indexOf('// Largas', signingAutographStart);
  const signingLongEnd = signingSource.indexOf('// ── Click & Sign stamps', signingLongStart);
  const signingLongPreviews = signingSource.slice(signingLongStart, signingLongEnd);
  assert.match(signingLongPreviews, /evidenceHashBlock/);
  assert.match(signingLongPreviews, /RFC \(OPCIONAL\)/);
  assert.match(signingLongPreviews, /CURP \(OPCIONAL\)/);
  assert.doesNotMatch(signingLongPreviews, /REFERENCIA|documentReference/);
  assert.doesNotMatch(signingLongPreviews, /BIOMETRÍA|PRECISIÓN GPS|SELLO RFC 3161/);
});

test('viewer downloads are proxied through the authorized document endpoint', async () => {
  const source = await readFile(viewerPath, 'utf8');
  assert.match(source, /viewer-file\?variant=original/);
  assert.match(source, /viewer-file\?variant=\$\{requestedFileVariant\}/);
  assert.doesNotMatch(source, /functions\/v1\/seal-pdf/);
});

test('viewer only requests a derived stamped PDF when a signature field exists', async () => {
  const source = await readFile(viewerPath, 'utf8');
  assert.match(source, /hasConfiguredSignatureFields/);
  assert.match(source, /!hasConfiguredSignatureFields/);
  assert.match(source, /document\?\.estado !== 'completado'/);
  assert.match(source, /hasConfiguredSignatureFields &&[\s\S]*?!document\.sealed_pdf_path/);
});

test('NOM-151 waits for the exact final PDF when signature fields are configured', async () => {
  const [viewerSource, serviceSource, sealSource, orchestratorSource] = await Promise.all([
    readFile(viewerPath, 'utf8'),
    readFile(nom151ServicePath, 'utf8'),
    readFile(routePath, 'utf8'),
    readFile(evidenceOrchestratorPath, 'utf8'),
  ]);

  // Automatic issuance is backend-owned. The viewer only refreshes evidence
  // after seal-signatures has completed the ordered certification chain.
  assert.doesNotMatch(
    viewerSource.slice(
      viewerSource.indexOf('const stampGenPromise'),
      viewerSource.indexOf(
        '// ──────────────────────────────────────────────────────────────────',
        viewerSource.indexOf('const stampGenPromise')
      )
    ),
    /fetch\('\/api\/nom151\/generate'/
  );
  assert.match(sealSource, /await integratePadesFinalDocument/);
  assert.match(sealSource, /pades\.profile !== 'PAdES-B-T' \|\| !pades\.timestamp/);
  assert.match(sealSource, /await finalizeAfterVerifiedPadesBt/);
  assert.match(orchestratorSource, /issueNom151ForVerifiedPadesBt/);
  assert.match(orchestratorSource, /WAITING_FOR_PADES[\s\S]*WAITING_FOR_NOM151/);
  assert.match(
    viewerSource,
    /hasConfiguredSignatureFields &&[\s\S]*?!document\.sealed_pdf_path[\s\S]*?void ensureFinalSignedPdf\(\);[\s\S]*?return;/
  );
  assert.match(
    viewerSource,
    /padesBtVerified &&[\s\S]*?nom151Ready &&[\s\S]*?nom151LookupComplete &&[\s\S]*?void generateNom151\(\{ silent: true \}\)/
  );
  assert.match(serviceSource, /async function verifiedPadesBt/);
  assert.match(serviceSource, /\.eq\('pades_profile', 'PAdES-B-T'\)/);
  assert.match(serviceSource, /\.eq\('pdf_signature_status', 'valid'\)/);
  assert.match(serviceSource, /\.eq\('timestamp_status', 'valid'\)/);
  assert.match(serviceSource, /\.eq\('verification_status', 'valid'\)/);
  assert.match(
    serviceSource,
    /row\.certified_pdf_sha256\.toLowerCase\(\) !==[\s\S]*?row\.pades_pdf_hash_after_signature/
  );
});

test('the final participant automatically requests NOM-151 after PDF sealing', async () => {
  const [signingSource, routeSource, sealSource, orchestratorSource] = await Promise.all([
    readFile(signingPagePath, 'utf8'),
    readFile(nom151RoutePath, 'utf8'),
    readFile(routePath, 'utf8'),
    readFile(evidenceOrchestratorPath, 'utf8'),
  ]);

  const sealPosition = signingSource.indexOf('/seal-signatures');
  assert.ok(sealPosition >= 0);
  assert.doesNotMatch(signingSource, /fetch\('\/api\/nom151\/generate'/);
  assert.match(signingSource, /if \(documentoEstado === 'completado'\)/);
  const padesPosition = sealSource.indexOf('await integratePadesFinalDocument');
  const finalizationPosition = sealSource.indexOf(
    'await finalizeAfterVerifiedPadesBt',
    padesPosition
  );
  assert.ok(padesPosition >= 0 && finalizationPosition > padesPosition);
  const nom151Position = orchestratorSource.indexOf('issueNom151ForVerifiedPadesBt');
  const emailPosition = orchestratorSource.indexOf(
    'queueVerifiedDocumentCompletionEmails',
    nom151Position
  );
  assert.ok(nom151Position >= 0 && emailPosition > nom151Position);
  assert.match(routeSource, /access\.role === 'AUTHORIZED'/);
  assert.match(routeSource, /PARTICIPATION_NOT_COMPLETED/);
});

test('NOM-151 generation is automatic and does not require opening downloads', async () => {
  const viewerSource = await readFile(viewerPath, 'utf8');
  const nom151Card = viewerSource.slice(
    viewerSource.indexOf('Constancia NOM-151'),
    viewerSource.indexOf('XML de Evidencia')
  );

  assert.doesNotMatch(viewerSource, /activeTab !== 'descargas'/);
  assert.match(viewerSource, /void generateNom151\(\{ silent: true \}\)/);
  assert.match(viewerSource, /void ensureFinalSignedPdf\(\)/);
  assert.doesNotMatch(nom151Card, /Generar ahora|Reintentar generaci[oó]n/);
});

test('a PAdES finalization error is not presented as a NOM-151 verification failure', async () => {
  const viewerSource = await readFile(viewerPath, 'utf8');
  const start = viewerSource.indexOf('const ensureFinalSignedPdf');
  const end = viewerSource.indexOf('// Regulariza documentos completados', start);
  const finalizationBlock = viewerSource.slice(start, end);

  assert.match(finalizationBlock, /setSignedPdfError\(message\)/);
  assert.doesNotMatch(finalizationBlock, /setNom151Error\(message\)/);
  assert.match(viewerSource, /cryptoEvidenceStatusLabel/);
  assert.match(viewerSource, /Evidencia de integridad sin certificación PAdES/);
});

test('viewer separates audit evidence from ordinary downloads', async () => {
  const viewerSource = await readFile(viewerPath, 'utf8');
  const auditTabPosition = viewerSource.indexOf("key: 'auditoria'");
  const metadataTabPosition = viewerSource.indexOf("key: 'metadata'");

  assert.ok(auditTabPosition >= 0 && auditTabPosition < metadataTabPosition);
  assert.match(viewerSource, /title: 'Auditoría',\s*label: 'Auditoría'/);
  assert.match(viewerSource, /activeTab === 'descargas' \|\| activeTab === 'auditoria'/);

  const auditGuardPosition = viewerSource.indexOf("{activeTab === 'auditoria' && (");
  const downloadsGuardPosition = viewerSource.indexOf("{activeTab === 'descargas' && (");
  assert.ok(auditGuardPosition >= 0 && downloadsGuardPosition > auditGuardPosition);

  const integrityHeading = viewerSource.indexOf(
    'Integridad y Evidencia Digital',
    auditGuardPosition
  );
  const auditCertificateHeading = viewerSource.indexOf(
    'Constancia de auditoría hasta el cierre',
    auditGuardPosition
  );
  assert.ok(integrityHeading > auditGuardPosition && integrityHeading < downloadsGuardPosition);
  assert.ok(
    auditCertificateHeading > auditGuardPosition && auditCertificateHeading < downloadsGuardPosition
  );

  const xmlHeading = viewerSource.indexOf('XML de Evidencia');
  const xmlAuditGuard = viewerSource.lastIndexOf("{activeTab === 'auditoria' && (", xmlHeading);
  const xmlDownloadsGuard = viewerSource.lastIndexOf("{activeTab === 'descargas' && (", xmlHeading);
  assert.ok(xmlAuditGuard > xmlDownloadsGuard);

  assert.match(viewerSource, /\{activeTab === 'descargas' && \(\s*<>/);
});

test('viewer presents document downloads in the expected operational order', async () => {
  const viewerSource = await readFile(viewerPath, 'utf8');
  const signedPosition = viewerSource.indexOf('Documento derivado del proceso de firma');
  const originalPosition = viewerSource.indexOf('Documento Original', signedPosition);
  const generalPosition = viewerSource.indexOf('Constancia General de Firma', originalPosition);
  const nom151Position = viewerSource.indexOf('Constancia NOM-151', generalPosition);

  assert.ok(signedPosition >= 0);
  assert.ok(originalPosition > signedPosition);
  assert.ok(generalPosition > originalPosition);
  assert.ok(nom151Position > generalPosition);
});

test('NOM-151 status keeps polling until issuance or a terminal failure', async () => {
  const source = await readFile(viewerPath, 'utf8');

  assert.match(source, /cache: 'no-store'/);
  assert.match(source, /const maxPollAttempts = 24/);
  // A persisted but unverified row is not terminal; polling stops only after
  // verified evidence or an explicit terminal failure.
  assert.match(source, /return Boolean\(\(json\.data && json\.verified\) \|\| json\.failed\)/);
  assert.match(source, /pollAttempts < maxPollAttempts/);
  assert.doesNotMatch(source, /if \(nom151Generating\) fetchNom151\(\)/);
});
