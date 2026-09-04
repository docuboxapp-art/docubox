import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-pades-readiness');
const bundlePath = join(cacheDirectory, 'pades-readiness.cjs');

function result(health: { ready: boolean; missing: string[]; detail?: string }) {
  return { ready: health.ready, failureCodes: health.missing, detail: health.detail || null };
}

try {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    stdin: {
      contents: [
        "export { createCertificationProviderSet } from './src/lib/certification/providers';",
        "export { getRequiredPadesLevel } from './src/lib/certification/product-integration';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'pades-readiness-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    external: ['@google-cloud/kms', '@supabase/supabase-js'],
    logLevel: 'silent',
  });
  const runtime = createRequire(import.meta.url)(bundlePath);
  const providers = runtime.createCertificationProviderSet();
  const [kms, x509, pades, tsa, independent] = await Promise.all([
    providers.keyManagement.healthCheck(),
    providers.certificate.healthCheck(),
    providers.pdfSignature.healthCheck(),
    providers.timestampAuthority.healthCheck(),
    providers.independentVerification.healthCheck(),
  ]);
  const metadata = kms.ready && kms.keyId
    ? await providers.keyManagement.getKeyMetadata(kms.keyId)
    : null;
  const requiredLevel = runtime.getRequiredPadesLevel();
  const productionEnabled = providers.mode !== 'production' || providers.productionEnabled;
  const hsmReady = providers.mode !== 'production' || metadata?.protectionLevel === 'hsm';
  const ready = requiredLevel === 'B-T'
    && productionEnabled
    && hsmReady
    && kms.ready
    && x509.ready
    && pades.ready
    && tsa.ready
    && independent.ready;

  console.info(JSON.stringify({
    runtimeEnvironment: process.env.NODE_ENV || 'development',
    cryptoProfile: providers.mode === 'production' ? 'production-hsm' : 'development',
    requiredLevel,
    kms: { ...result(kms), protectionLevel: metadata?.protectionLevel || null },
    x509: result(x509),
    tsa: result(tsa),
    pades: result(pades),
    independent: result(independent),
    padesBtReady: ready,
  }, null, 2));
  if (!ready) process.exitCode = 1;
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : error instanceof Error
      ? error.message
      : 'PADES_READINESS_UNKNOWN_ERROR';
  console.error(JSON.stringify({ padesBtReady: false, failureCode: code }));
  process.exitCode = 1;
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
