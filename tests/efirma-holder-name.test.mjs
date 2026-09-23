import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const { normalizeEfirmaHolderName } = await import(
  pathToFileURL(
    path.join(process.cwd(), 'src', 'lib', 'efirma', 'certificate-holder.ts')
  ).href
);

test('extracts the holder name from a legacy flattened SAT certificate subject', () => {
  const subject =
    'LUIS ALBERTO HERNANDEZ BELTRAN, LUIS ALBERTO HERNANDEZ BELTRAN, ' +
    'LUIS ALBERTO HERNANDEZ BELTRAN, MX, luishb.mzt@gmail.com, ' +
    'HEBL861015326, HEBL861015HSLRLS02';

  assert.equal(normalizeEfirmaHolderName(subject), 'LUIS ALBERTO HERNANDEZ BELTRAN');
});

test('prefers the common name in a labeled distinguished name', () => {
  const subject =
    'C=MX, O=SAT, CN=LUIS ALBERTO HERNANDEZ BELTRAN, serialNumber=HEBL861015326';

  assert.equal(normalizeEfirmaHolderName(subject), 'LUIS ALBERTO HERNANDEZ BELTRAN');
});

test('uses the profile holder name when the certificate subject has no usable name', () => {
  assert.equal(
    normalizeEfirmaHolderName('MX, HEBL861015326, HEBL861015HSLRLS02', 'LUIS ALBERTO HERNANDEZ BELTRAN'),
    'LUIS ALBERTO HERNANDEZ BELTRAN'
  );
});
