import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node's type-stripping test runner resolves the TypeScript source directly.
import { canonicalSha256, canonicalizeRFC8785, sha256Hex } from './canonical.ts';

test('canonicalization is independent from object insertion order', () => {
  const first = { z: 3, a: 'Docubox', nested: { b: true, a: null } };
  const second = { nested: { a: null, b: true }, a: 'Docubox', z: 3 };
  assert.equal(canonicalizeRFC8785(first), canonicalizeRFC8785(second));
  assert.equal(canonicalSha256(first).sha256, canonicalSha256(second).sha256);
});

test('strings are normalized to Unicode NFC', () => {
  assert.equal(canonicalizeRFC8785({ value: 'Me\u0301xico' }), canonicalizeRFC8785({ value: 'México' }));
});

test('changing a protected value changes the hash', () => {
  assert.notEqual(canonicalSha256({ status: 'COMPLETED' }).sha256, canonicalSha256({ status: 'SEALED' }).sha256);
});

test('changing one PDF byte changes SHA-256', () => {
  const original = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const changed = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2e]);
  assert.notEqual(sha256Hex(original), sha256Hex(changed));
});
