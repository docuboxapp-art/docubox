import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selectorPaths = [
  'src/app/mi-perfil/components/AutografaStampSelector.tsx',
  'src/app/mi-perfil/components/EfirmaStampSelector.tsx',
  'src/app/mi-perfil/components/ClickSignStampSelector.tsx',
];

const stampFamilies = [
  {
    selectorPath: selectorPaths[0],
    ids: [
      'AC0',
      'AC1',
      'AC2',
      'AC3',
      'AC4',
      'AC5',
      'AM1',
      'AM2',
      'AM3',
      'AM4',
      'AM5',
      'AL1',
      'AL2',
      'AL3',
      'AL4',
    ],
  },
  {
    selectorPath: selectorPaths[1],
    ids: [
      'EC1',
      'EC2',
      'EC3',
      'EC4',
      'EC5',
      'EM1',
      'EM2',
      'EM3',
      'EM4',
      'EM5',
      'EL1',
      'EL2',
      'EL3',
      'EL4',
    ],
  },
  {
    selectorPath: selectorPaths[2],
    ids: [
      'CC1',
      'CC2',
      'CC3',
      'CC4',
      'CC5',
      'CM1',
      'CM2',
      'CM3',
      'CM4',
      'CM5',
      'CL1',
      'CL2',
      'CL3',
      'CL4',
    ],
  },
];

test('all 43 standardized stamp variants are wired through selector, detail and signing preview', async () => {
  const signingPage = await readFile(
    path.join(repoRoot, 'src/app/firmar-documento/[id]/page.tsx'),
    'utf8'
  );

  for (const family of stampFamilies) {
    const selector = await readFile(path.join(repoRoot, family.selectorPath), 'utf8');
    const catalogIds = [...selector.matchAll(/id: '([A-Z]{2}\d)'/g)].map((match) => match[1]);
    const detailIds = [...selector.matchAll(/^ {2}([A-Z]{2}\d): \{/gm)].map((match) => match[1]);

    assert.deepEqual(catalogIds, family.ids);
    assert.deepEqual(detailIds, family.ids);
    assert.doesNotMatch(selector, /Campos:/);

    for (const id of family.ids) {
      assert.match(signingPage, new RegExp(`stampStyle === '${id}'`));
    }
  }
});

test('all three standardized stamp families have dedicated PDF renderers', async () => {
  const pdfStamp = await readFile(path.join(repoRoot, 'src/lib/signatures/pdf-stamp.ts'), 'utf8');

  assert.match(pdfStamp, /method === 'efirma'[\s\S]*?await drawEfirmaStamp/);
  assert.match(pdfStamp, /method === 'autografa' && \/\^AC\[0-5\]\$\//);
  assert.match(pdfStamp, /method === 'autografa' && \/\^AM\[1-5\]\$\//);
  assert.match(pdfStamp, /method === 'autografa' && \/\^AL\[1-4\]\$\//);
  assert.match(pdfStamp, /method === 'clicksign' && \/\^CC\[1-5\]\$\//);
  assert.match(pdfStamp, /method === 'clicksign' && \/\^CM\[1-5\]\$\//);
  assert.match(pdfStamp, /method === 'clicksign' && \/\^CL\[1-4\]\$\//);
});

test('all signature stamp selectors keep technical contents inside an expanded detail modal', async () => {
  const sources = await Promise.all(
    selectorPaths.map((relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8'))
  );

  for (const source of sources) {
    assert.doesNotMatch(source, /subtitle\s*:/);
    assert.doesNotMatch(source, /\.subtitle/);
    assert.match(source, /Vista ampliada/);
    assert.match(source, /Elementos incluidos en esta estampa/);
    assert.match(source, /max-w-5xl/);
    assert.match(source, /lg:grid-cols-\[minmax\(0,1\.35fr\)_minmax\(260px,0\.65fr\)\]/);

    const modalStart = source.indexOf('function StampDetailModal');
    const componentStart = source.indexOf('// ─── Main Component', modalStart);
    const modalSource = source.slice(modalStart, componentStart);
    assert.match(modalSource, /<StampPreview/);
    assert.match(modalSource, /detail\.elements\.map/);
    assert.match(source, /aria-label=\{`Seleccionar \$\{variant\.label\}`\}/);
    assert.match(source, /focus-visible:ring-2 focus-visible:ring-primary/);
    assert.match(source, /relative z-20 flex items-center gap-1/);
  }
});

test('stamp cards describe their visual composition instead of enumerating technical fields', async () => {
  const [autograph, efirma, clickSign] = await Promise.all(
    selectorPaths.map((relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8'))
  );

  assert.match(autograph, /description: 'Barra lateral con lectura vertical\.'/);
  assert.match(autograph, /description: 'Formato vertical tipo ticket\.'/);
  assert.match(efirma, /description: 'Composición centrada con QR al pie\.'/);
  assert.match(efirma, /description: 'Diseño estructurado con evidencia esencial\.'/);
  assert.match(clickSign, /description: 'Lectura compacta con barra lateral sutil\.'/);
  assert.match(clickSign, /description: 'Formato vertical tipo ticket\.'/);
});

test('short autograph stamps use the standardized AC0-AC5 layouts', async () => {
  const [selector, signingPage, pdfStamp] = await Promise.all([
    readFile(path.join(repoRoot, selectorPaths[0]), 'utf8'),
    readFile(path.join(repoRoot, 'src/app/firmar-documento/[id]/page.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/lib/signatures/pdf-stamp.ts'), 'utf8'),
  ]);

  for (const label of [
    'AC0 · Solo firma',
    'AC1 · Firma mínima sin nombre',
    'AC2 · Firma mínima con nombre',
    'AC3 · Marco compacto',
    'AC4 · Franja lateral',
    'AC5 · Ticket vertical',
  ]) {
    assert.match(selector, new RegExp(label.replace(/[+·]/g, '\\$&')));
  }

  assert.match(selector, /autógrafa · información mínima/);
  assert.match(selector, /const shortHashBlock/);
  const ac2Start = selector.indexOf("variant.id === 'AC2'");
  const ac3Start = selector.indexOf("variant.id === 'AC3'", ac2Start);
  assert.doesNotMatch(selector.slice(ac2Start, ac3Start), /qrBlock/);
  const ac0Start = selector.indexOf("variant.id === 'AC0'");
  const ac1Start = selector.indexOf("variant.id === 'AC1'", ac0Start);
  const ac0Preview = selector.slice(ac0Start, ac1Start);
  assert.match(ac0Preview, /signatureImg/);
  assert.doesNotMatch(ac0Preview, /roleActBlock|identityBlock|shortHashBlock|qrBlock/);
  assert.match(selector.slice(ac1Start, ac2Start), /roleActBlock/);
  assert.match(selector, /if \(variant\.id === 'AC4'\)[\s\S]*?bg-blue-600/);
  assert.match(signingPage, /if \(stampStyle === 'AC5'\)[\s\S]*?evidenceHashBlock/);
  assert.match(pdfStamp, /async function drawAutografaStamp/);
  assert.match(pdfStamp, /const withQr = style !== 'AC1' && style !== 'AC2'/);
});

test('medium autograph stamps use the standardized AM1-AM5 layouts', async () => {
  const [selector, signingPage, pdfStamp] = await Promise.all([
    readFile(path.join(repoRoot, selectorPaths[0]), 'utf8'),
    readFile(path.join(repoRoot, 'src/app/firmar-documento/[id]/page.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/lib/signatures/pdf-stamp.ts'), 'utf8'),
  ]);

  for (const label of [
    'AM1 · Estándar mediana',
    'AM2 · Marco mediano',
    'AM3 · Franja 3 columnas',
    'AM4 · Encabezado sobrio',
    'AM5 · Ticket QR grande',
  ]) {
    assert.match(selector, new RegExp(label.replace(/[+·]/g, '\\$&')));
  }

  assert.match(selector, /autógrafa · información intermedia/);
  assert.match(selector, /if \(variant\.id === 'AM3'\)[\s\S]*?bg-blue-600/);
  assert.match(selector, /if \(variant\.id === 'AM4'\)[\s\S]*?bg-slate-800/);
  assert.match(signingPage, /if \(stampStyle === 'AM5'\)[\s\S]*?evidenceHashBlock/);
  assert.match(pdfStamp, /async function drawAutografaMediumStamp/);
  assert.match(pdfStamp, /drawClickSignHashPanel/);
});

test('long autograph stamps use the standardized AL1-AL4 layouts without a printed reference', async () => {
  const [selector, signingPage, pdfStamp] = await Promise.all([
    readFile(path.join(repoRoot, selectorPaths[0]), 'utf8'),
    readFile(path.join(repoRoot, 'src/app/firmar-documento/[id]/page.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/lib/signatures/pdf-stamp.ts'), 'utf8'),
  ]);

  assert.match(selector, /autógrafa · información completa visible/);
  assert.match(selector, /if \(variant\.id === 'AL3'\)[\s\S]*?bg-blue-600/);
  const selectorStart = selector.indexOf("variant.id === 'AL1'");
  const selectorEnd = selector.indexOf('// ─── Detail Modal', selectorStart);
  assert.doesNotMatch(selector.slice(selectorStart, selectorEnd), /REFERENCIA|DOC-2025-001/);

  const signingStart = signingPage.indexOf("stampStyle === 'AL1'");
  const signingEnd = signingPage.indexOf('// ── Click & Sign stamps', signingStart);
  assert.doesNotMatch(signingPage.slice(signingStart, signingEnd), /REFERENCIA|documentReference/);

  const rendererStart = pdfStamp.indexOf('async function drawAutografaLongStamp');
  const rendererEnd = pdfStamp.indexOf('function drawCompactLateralEfirmaStamp', rendererStart);
  const renderer = pdfStamp.slice(rendererStart, rendererEnd);
  assert.match(renderer, /drawClickSignHashPanel/);
  assert.doesNotMatch(renderer, /REFERENCIA|document_reference/);
});

test('e.firma proposes distinct standardized layouts with real certificate data', async () => {
  const [selector, profile, signingPage, pdfStamp] = await Promise.all([
    readFile(path.join(repoRoot, selectorPaths[1]), 'utf8'),
    readFile(path.join(repoRoot, 'src/app/mi-perfil/page.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/app/firmar-documento/[id]/page.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/lib/signatures/pdf-stamp.ts'), 'utf8'),
  ]);

  for (const label of [
    'EC1 · Mínima e.firma',
    'EC2 · Check + QR',
    'EC3 · Franja lateral',
    'EC4 · Centrada + QR',
    'EC5 · Hash + QR lateral',
    'EM1 · Estándar certificado',
    'EM2 · Base compacta',
    'EM3 · Franja lateral',
    'EM4 · Encabezado sobrio',
    'EM5 · Ticket de validación',
    'EL1 · Resumen integral',
    'EL2 · Constancia de certificado',
    'EL3 · Franja analítica',
    'EL4 · Formato formal',
  ]) {
    assert.match(selector, new RegExp(label.replace(/[+·]/g, '\\$&')));
  }

  assert.match(selector, /numeroSerie\?: string \| null/);
  assert.match(profile, /numeroSerie: efirmaData\.serial/);
  assert.match(selector, /grid grid-cols-2 gap-2 rounded bg-slate-50/);
  assert.match(selector, /validationPill\('Certificado válido'\)/);
  assert.match(selector, /SERIE DEL CERTIFICADO/);
  assert.match(selector, /e\.firma · información intermedia/);
  assert.match(selector, /e\.firma · evidencia completa visible/);
  assert.match(selector, /const evidenceHashBlock/);
  assert.match(signingPage, /if \(stampStyle === 'EC5'\)[\s\S]*?qrVerificationBlock/);
  assert.match(signingPage, /if \(stampStyle === 'EM5'\)[\s\S]*?evidenceHashBlock/);
  assert.match(signingPage, /if \(stampStyle === 'EL4'\)[\s\S]*?evidenceHashBlock/);
  assert.match(
    pdfStamp,
    /const fullHash = style\.startsWith\('EM'\) \|\| style\.startsWith\('EL'\)/
  );
  assert.match(pdfStamp, /'HUELLA SHA-256'/);
});

test('click and sign short stamps use the standardized CC1-CC5 layouts', async () => {
  const [selector, signingPage, pdfStamp] = await Promise.all([
    readFile(path.join(repoRoot, selectorPaths[2]), 'utf8'),
    readFile(path.join(repoRoot, 'src/app/firmar-documento/[id]/page.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/lib/signatures/pdf-stamp.ts'), 'utf8'),
  ]);

  for (const label of [
    'CC1 · Mínima',
    'CC2 · Check + QR',
    'CC3 · Franja lateral',
    'CC4 · Centrada + QR',
    'CC5 · Ticket vertical',
  ]) {
    assert.match(selector, new RegExp(label.replace(/[+·]/g, '\\$&')));
  }

  assert.match(selector, /click & sign · información mínima/);
  assert.match(selector, /const shortHashBlock/);
  assert.match(selector, /const acceptancePill/);
  assert.match(signingPage, /if \(stampStyle === 'CC5'\)[\s\S]*?evidenceHashBlock/);
  assert.match(pdfStamp, /async function drawClickSignShortStamp/);
  assert.match(pdfStamp, /function drawClickSignHashPanel/);
  assert.match(pdfStamp, /method === 'clicksign' && \/\^CC\[1-5\]\$\//);
  assert.match(pdfStamp, /Aceptación confirmada/);
});

test('click and sign medium stamps use the standardized CM1-CM5 layouts', async () => {
  const [selector, signingPage, pdfStamp] = await Promise.all([
    readFile(path.join(repoRoot, selectorPaths[2]), 'utf8'),
    readFile(path.join(repoRoot, 'src/app/firmar-documento/[id]/page.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/lib/signatures/pdf-stamp.ts'), 'utf8'),
  ]);

  for (const label of [
    'CM1 · Estándar mediana',
    'CM2 · Franja 3 columnas',
    'CM3 · Encabezado sobrio',
    'CM4 · Marco centrado',
    'CM5 · Ticket QR grande',
  ]) {
    assert.match(selector, new RegExp(label.replace(/[+·]/g, '\\$&')));
  }

  assert.match(selector, /click & sign · información intermedia/);
  assert.match(selector, /if \(variant\.id === 'CM2'\)[\s\S]*?grid grid-cols-3/);
  assert.match(selector, /if \(variant\.id === 'CM3'\)[\s\S]*?bg-slate-800/);
  assert.match(selector, /if \(variant\.id === 'CM5'\)[\s\S]*?qrLarge/);
  assert.match(signingPage, /if \(stampStyle === 'CM5'\)[\s\S]*?evidenceHashBlock/);
  assert.match(pdfStamp, /async function drawClickSignMediumStamp/);
  assert.match(pdfStamp, /method === 'clicksign' && \/\^CM\[1-5\]\$\//);
});

test('click and sign long stamps use the standardized CL1-CL4 layouts', async () => {
  const [selector, signingPage, pdfStamp] = await Promise.all([
    readFile(path.join(repoRoot, selectorPaths[2]), 'utf8'),
    readFile(path.join(repoRoot, 'src/app/firmar-documento/[id]/page.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/lib/signatures/pdf-stamp.ts'), 'utf8'),
  ]);

  for (const label of [
    'CL1 · Resumen integral',
    'CL2 · Constancia estructurada',
    'CL3 · Franja analítica',
    'CL4 · Marco formal',
  ]) {
    assert.match(selector, new RegExp(label.replace(/[+·]/g, '\\$&')));
  }

  assert.match(selector, /click & sign · información completa visible/);
  assert.match(selector, /if \(variant\.id === 'CL3'\)[\s\S]*?bg-blue-600/);
  assert.match(selector, /if \(variant\.id === 'CL4'\)[\s\S]*?border-blue-500/);
  assert.match(signingPage, /if \(stampStyle === 'CL1'\)[\s\S]*?evidenceHashBlock/);
  assert.match(
    signingPage,
    /if \(stampStyle === 'CL2'\)[\s\S]*?Documento aceptado electrónicamente/
  );
  assert.match(pdfStamp, /async function drawClickSignLongStamp/);
  assert.match(pdfStamp, /method === 'clicksign' && \/\^CL\[1-4\]\$\//);
});
