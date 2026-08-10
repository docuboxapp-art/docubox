import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node's type-stripping test runner resolves the TypeScript source directly.
import { normalizeSha256, sha256Token } from './repository.ts';

test('normalizes a SHA-256 fingerprint without weakening validation', () => {
  const raw = 'SHA-256: A'.padEnd(73, 'A');
  assert.equal(normalizeSha256(raw), 'a'.repeat(64));
  assert.equal(normalizeSha256('1234'), null);
  assert.equal(normalizeSha256('g'.repeat(64)), null);
});

test('public tokens are stored as deterministic SHA-256 digests', () => {
  assert.equal(
    sha256Token('kL9W2jDd7YqP4sNt'),
    '12aa414279251cf2dd0d54b5d2af772ab9488906e35a0c800822917cc3a41304'
  );
  assert.notEqual(sha256Token('token-a'), sha256Token('token-b'));
});
