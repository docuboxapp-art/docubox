import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const pdfRoute = await readFile('src/app/api/nom151/pdf/route.ts', 'utf8');
const viewer = await readFile('src/app/visor-documento/[id]/page.tsx', 'utf8');
const certificateRenderer = await readFile('src/lib/documents/nom151-certificate.ts', 'utf8');

test('NOM-151 customer-facing certificates do not expose the technical provider', () => {
  assert.match(pdfRoute, /Servicio de certificación integrado con Docubox/);
  assert.doesNotMatch(pdfRoute, /Integración backend Docubox con Nubarium/);

  const certificateTemplate = viewer.slice(
    viewer.indexOf('const downloadNom151InfoPdf'),
    viewer.indexOf('// ── Download Constancia General')
  );
  assert.match(certificateTemplate, /Solicitud enviada al PSC/);
  assert.match(certificateTemplate, /Respuesta recibida del PSC/);
  assert.doesNotMatch(certificateTemplate, /Nubarium/);
  assert.doesNotMatch(certificateTemplate, /Número de Firmantes/);
  assert.doesNotMatch(certificateRenderer, /N\u00famero de firmantes/);
  assert.doesNotMatch(pdfRoute, /requestPayload\.firmantes/);
});
