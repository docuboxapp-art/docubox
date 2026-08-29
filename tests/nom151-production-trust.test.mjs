import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import test from 'node:test';

const bundleDirectory = await mkdtemp(join(tmpdir(), 'docubox-nom151-trust-'));
const bundlePath = join(bundleDirectory, 'nom151-trust.cjs');
await build({
  stdin: {
    contents: [
      "export { NubariumNom151Provider } from './src/lib/nom151/provider';",
      "export { loadNom151TrustBundle, resolveNom151Environment } from './src/lib/nom151/trust';",
    ].join('\n'),
    resolveDir: process.cwd(),
    sourcefile: 'nom151-trust-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  plugins: [
    {
      name: 'server-only-test-shim',
      setup(context) {
        context.onResolve({ filter: /^server-only$/ }, () => ({
          path: 'server-only',
          namespace: 'docubox-test-shim',
        }));
        context.onLoad({ filter: /.*/, namespace: 'docubox-test-shim' }, () => ({
          contents: 'export {};',
          loader: 'js',
        }));
      },
    },
  ],
  logLevel: 'silent',
});
const { NubariumNom151Provider, loadNom151TrustBundle, resolveNom151Environment } = createRequire(
  import.meta.url
)(bundlePath);

const endpoint = 'https://firma.nubarium.com/nom151/v1/obtener-nom151';
const rootFingerprint = 'b2f258c42c3066c54c3d9bbcb9a4c16bed4e7b74f302643a11af26961e09c720';
const baseEnvironment = {
  NOM151_PSC_TRUST_MANIFEST_PATH: 'infra/nom151/trust/manifest.json',
  NOM151_PSC_TRUST_ROOT_PATH: 'infra/nom151/trust/roots/ACR2_SE.pem',
  NOM151_PSC_TRUST_ROOT_SHA256: rootFingerprint,
  NOM151_PSC_TRUST_BUNDLE_VERSION: '1',
};

function provider(environment, overrides = {}) {
  return new NubariumNom151Provider({
    endpoint,
    username: 'configured',
    password: 'configured',
    environment,
    environmentExplicit: true,
    productionEndpoint: '',
    timeoutMs: 1_000,
    maxRetries: 1,
    fetchImpl: async () => {
      throw new Error('health check must not consume a provider folio');
    },
    ...overrides,
  });
}

async function withEnvironment(values, callback) {
  const keys = Object.keys(values);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await callback();
  } finally {
    for (const key of keys) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('versioned PSC root is explicitly loaded and pinned', async () => {
  await withEnvironment(baseEnvironment, async () => {
    const trust = await loadNom151TrustBundle();
    assert.equal(trust.loaded, true);
    assert.equal(trust.rootTrusted, true);
    assert.equal(trust.version, '1');
    assert.equal(trust.roots[0].fingerprintSha256, rootFingerprint);
    assert.equal(trust.roots[0].ca, true);
  });
});

test('development health is ready but never productively trusted', async () => {
  await withEnvironment(baseEnvironment, async () => {
    const health = await provider('development').healthCheck();
    assert.equal(health.ready, true);
    assert.equal(health.productionReady, false);
    assert.equal(health.rootTrusted, true);
  });
});

test('production fails closed when its expected endpoint is absent or different', async () => {
  await withEnvironment(baseEnvironment, async () => {
    const health = await provider('production').healthCheck();
    assert.equal(health.ready, false);
    assert.equal(health.productionReady, false);
    assert.equal(health.environmentMismatch, true);
    assert.equal(health.failureCode, 'NOM151_PROVIDER_ENVIRONMENT_MISMATCH');
  });
});

test('production becomes eligible only with exact endpoint and complete pinned trust', async () => {
  await withEnvironment(baseEnvironment, async () => {
    const health = await provider('production', { productionEndpoint: endpoint }).healthCheck();
    assert.equal(health.ready, true);
    assert.equal(health.productionReady, true);
  });
});

test('a mismatched root pin is rejected', async () => {
  await withEnvironment(
    { ...baseEnvironment, NOM151_PSC_TRUST_ROOT_SHA256: '0'.repeat(64) },
    async () => {
      const health = await provider('development').healthCheck();
      assert.equal(health.ready, false);
      assert.equal(health.rootTrusted, false);
      assert.ok(health.errors.includes('NOM151_UNTRUSTED_ROOT'));
    }
  );
});

test('environment resolution never treats legacy or invalid values as explicit production', async () => {
  await withEnvironment(
    { NOM151_ENVIRONMENT: 'invalid', NOM151_PROVIDER_ENVIRONMENT: 'production' },
    async () => {
      const result = resolveNom151Environment();
      assert.equal(result.environment, 'unknown');
      assert.equal(result.explicit, false);
    }
  );
});

test.after(async () => {
  await rm(bundleDirectory, { recursive: true, force: true });
});
