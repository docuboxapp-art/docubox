import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({
  entryPoints: ['src/lib/identity/capture-crypto.ts'],
  outfile: 'node_modules/.cache/stored-identity-image-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'server-only-shim',
      setup(plugin) {
        plugin.onResolve({ filter: /^server-only$/ }, () => ({
          path: 'server-only',
          namespace: 'shim',
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: '' }));
      },
    },
  ],
});
const {
  encryptCapture,
  readStoredIdentityImage,
} = require('../node_modules/.cache/stored-identity-image-test.cjs');
await build({
  entryPoints: ['src/lib/identity/stored-identity.ts'],
  outfile: 'node_modules/.cache/stored-identity-lookup-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'server-only-shim',
      setup(plugin) {
        plugin.onResolve({ filter: /^server-only$/ }, () => ({
          path: 'server-only',
          namespace: 'shim',
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: '' }));
      },
    },
  ],
});
const { findStoredIdentity } = require('../node_modules/.cache/stored-identity-lookup-test.cjs');
const key = Buffer.alloc(32, 7);
const image = Buffer.alloc(300, 42).toString('base64');

test('reads an approved legacy image data URL without requiring a new ID capture', () => {
  assert.equal(readStoredIdentityImage(`data:image/jpeg;base64,${image}`, key), image);
});

test('reads a current encrypted ID image', () => {
  assert.equal(readStoredIdentityImage(encryptCapture(image, key), key), image);
});

test('rejects malformed images and encrypted rows with the wrong key', () => {
  assert.equal(readStoredIdentityImage('data:image/jpeg;base64,invalid!', key), null);
  assert.equal(readStoredIdentityImage(encryptCapture(image, key), Buffer.alloc(32, 8)), null);
});

test('a registered user with a legacy approved ID takes the selfie-only branch', async () => {
  const supabase = {
    from(table) {
      assert.equal(table, 'id_capture_logs');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        not() {
          return this;
        },
        order() {
          return this;
        },
        range() {
          return Promise.resolve({
            data: [
              {
                anverso_b64: `data:image/jpeg;base64,${image}`,
                curp_extracted: null,
                nombre_extracted: null,
              },
            ],
            error: null,
          });
        },
      };
    },
  };
  const stored = await findStoredIdentity(supabase, 'registered-user', key);
  assert.equal(stored?.front, image);
});
