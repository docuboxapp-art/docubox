import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync('src/lib/forms/public-access-code.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const api = {};
new Function('require', 'exports', compiled)((name) =>
  name === 'server-only' ? {} : nodeRequire(name), api);

test('new public form codes have exactly eight readable characters', () => {
  const codes = Array.from({ length: 100 }, () => api.createPublicCode());
  for (const code of codes) {
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(api.publicCodeLookup(code), code);
    assert.equal(api.isValidPublicCode(code), true);
  }
  assert.equal(new Set(codes).size, codes.length);
});

test('an older long code remains valid after a short code replaces it', () => {
  const oldCode = 'DBX-0123456789ABCDEF12';
  const shortCode = 'ABCD2345';
  const access = {
    code_lookup: api.publicCodeLookup(shortCode),
    code_hash: api.hashPublicCode(shortCode),
    legacy_code_lookup: api.publicCodeLookup(oldCode),
    legacy_code_hash: api.hashPublicCode(oldCode),
  };
  assert.equal(api.isValidPublicCode(oldCode), true);
  assert.equal(api.matchesStoredPublicCode(oldCode, access), true);
  assert.equal(api.matchesStoredPublicCode(shortCode, access), true);
  assert.equal(api.matchesStoredPublicCode('ZZZZZZZZ', access), false);
});
