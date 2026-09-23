import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/app/firmar-documento/[id]/page.tsx', import.meta.url),
  'utf8'
);

test('signing distinguishes participation persistence from PDF preparation and certification', () => {
  const commit = source.indexOf("action: 'commit'");
  const prepare = source.indexOf("setSubmissionPhase('preparando_pdf')", commit);
  const materialize = source.indexOf(
    'createPdfFromPublishedTemplate(materializedTemplate',
    prepare
  );
  const certify = source.indexOf("setSubmissionPhase('certificando_pdf')", prepare);
  const seal = source.indexOf('/seal-signatures', certify);

  assert.ok(commit >= 0 && prepare > commit);
  assert.ok(materialize > prepare && certify > materialize);
  assert.ok(seal > certify);
  assert.match(source, /Tu firma ya quedó registrada\. Estamos preparando el PDF final/);
  assert.match(source, /Tu firma ya quedó registrada\. Estamos certificando el PDF final/);
  assert.match(source, /role="status"\s+aria-live="polite"/);
});
