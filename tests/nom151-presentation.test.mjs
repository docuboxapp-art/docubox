import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const outputDirectory = 'node_modules/.cache/docubox-nom151-presentation-tests';
const outputFile = `${outputDirectory}/presentation.mjs`;
await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: ['src/lib/nom151/presentation.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: outputFile,
  logLevel: 'silent',
});
const { getNom151Presentation } = await import(`${pathToFileURL(outputFile).href}?v=${Date.now()}`);

for (const environment of ['development', 'production', 'sandbox', 'unknown', null]) {
  test(`verified NOM-151 remains verified in ${environment ?? 'unconfirmed'} environment`, () => {
    const result = getNom151Presentation({
      verificationStatus: 'verified',
      environment,
      productionTrusted: false,
      failed: true,
      processing: true,
    });
    assert.equal(result.verificationStatus, 'verified');
    assert.equal(result.statusLabel, 'Verificada');
    assert.equal(result.integrityLabel, 'Verificada criptográficamente');
  });
}

test('provider environment is presented independently from verification', () => {
  const development = getNom151Presentation({
    verificationStatus: 'verified',
    environment: 'development',
    productionTrusted: false,
  });
  assert.equal(development.providerEnvironment, 'development');
  assert.match(development.providerEnvironmentLabel, /pendiente de confirmación productiva/i);
  assert.doesNotMatch(development.providerEnvironmentLabel, /desarrollo/i);

  const production = getNom151Presentation({
    verificationStatus: 'verified',
    environment: 'production',
    productionTrusted: true,
  });
  assert.equal(production.providerEnvironment, 'production');
  assert.equal(production.providerEnvironmentLabel, 'Producción confirmada');
});

test('pending and failed states do not depend on provider environment', () => {
  assert.equal(getNom151Presentation({ processing: true, environment: 'production' }).verificationStatus, 'pending');
  assert.equal(getNom151Presentation({ failed: true, environment: 'development' }).verificationStatus, 'failed');
  assert.equal(getNom151Presentation({ environment: 'development' }).verificationStatus, 'not_requested');
});
