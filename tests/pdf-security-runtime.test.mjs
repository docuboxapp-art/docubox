import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const bundleDirectory = await mkdtemp(join(tmpdir(), 'docubox-pdf-security-runtime-'));
const bundlePath = join(bundleDirectory, 'pdf-security.cjs');

await build({
  entryPoints: [join(process.cwd(), 'src', 'lib', 'certification', 'pdf-security.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
});

const { PyHankoProtectedPdfSignatureProvider, resolvePdfSecurityRuntimeCommand } =
  createRequire(import.meta.url)(bundlePath);
const kmsBridgeSource = await readFile(
  join(process.cwd(), 'scripts', 'docubox-pyhanko-kms-bridge.mjs'),
  'utf8'
);

test.after(async () => {
  await rm(bundleDirectory, { recursive: true, force: true });
});

test('Windows local development uses the isolated PDF security environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'docubox-pdf-security-win32-'));
  const python = join(root, '.venv-pdf-security', 'Scripts', 'python.exe');
  await mkdir(join(root, '.venv-pdf-security', 'Scripts'), { recursive: true });
  await writeFile(python, '');

  try {
    const command = resolvePdfSecurityRuntimeCommand({ cwd: root, platform: 'win32' });
    assert.equal(command.executable, python);
    assert.equal(command.script, join(root, 'vps', 'signer', 'pdf_security.py'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an explicitly configured Python runtime takes priority over the local environment', () => {
  const command = resolvePdfSecurityRuntimeCommand({
    cwd: bundleDirectory,
    platform: 'win32',
    pythonBin: 'C:\\Python\\python.exe',
    script: 'C:\\runtime\\pdf_security.py',
  });

  assert.equal(command.executable, 'C:\\Python\\python.exe');
  assert.equal(command.script, 'C:\\runtime\\pdf_security.py');
});

test('the KMS bridge bundles beneath project node_modules so external packages resolve', () => {
  assert.match(
    kmsBridgeSource,
    /join\(process\.cwd\(\), 'node_modules', '\.cache'\)/
  );
  assert.doesNotMatch(kmsBridgeSource, /tmpdir\(\)/);
});

test('the installed local pyHanko runtime passes the application provider health check', async (context) => {
  const command = resolvePdfSecurityRuntimeCommand();
  if (!existsSync(command.executable)) {
    context.skip('The isolated PDF security runtime is not installed on this machine');
    return;
  }

  const verifier = {
    async healthCheck() {
      return { ready: true, missing: [], provider: 'test-verifier' };
    },
  };
  const provider = new PyHankoProtectedPdfSignatureProvider(
    {
      enabled: true,
      denyPrint: false,
      denyCopyContent: false,
      denyModify: false,
      denyPageExtraction: false,
      denyDocumentAssembly: false,
    },
    {},
    verifier
  );

  const health = await provider.healthCheck();
  assert.equal(health.ready, true);
  assert.equal(health.provider, 'pyhanko-aes256-kms');
  assert.deepEqual(health.missing, []);
});
