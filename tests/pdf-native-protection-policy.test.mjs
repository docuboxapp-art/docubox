import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import test from 'node:test';

const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-pdf-native-policy');
const bundlePath = join(cacheDirectory, 'policy.cjs');
await mkdir(cacheDirectory, { recursive: true });
await build({
  entryPoints: [join(process.cwd(), 'src', 'lib', 'documents', 'pdf-native-protection.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
});

const { hasPdfNativeProtection, pdfNativeProtectionPolicy } = createRequire(import.meta.url)(bundlePath);

test('a document without the protection option preserves the existing PDF pipeline', () => {
  const policy = pdfNativeProtectionPolicy({ proteccion_firmado: false, impedir_impresion: true });
  assert.deepEqual(policy, {
    denyPrint: false,
    denyCopyContent: false,
    denyModify: false,
    denyPageExtraction: false,
    denyDocumentAssembly: false,
  });
  assert.equal(hasPdfNativeProtection(policy), false);
});

test('the existing persisted fields normalize to one PDF-native policy', () => {
  const policy = pdfNativeProtectionPolicy({
    proteccion_firmado: true,
    impedir_impresion: true,
    evitar_copia_texto: true,
    impedir_modificacion: true,
    impedir_extraccion: true,
    evitar_montaje: true,
  });
  assert.deepEqual(policy, {
    denyPrint: true,
    denyCopyContent: true,
    denyModify: true,
    denyPageExtraction: true,
    denyDocumentAssembly: true,
  });
  assert.equal(hasPdfNativeProtection(policy), true);
});
