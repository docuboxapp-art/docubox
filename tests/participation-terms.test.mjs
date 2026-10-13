import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('src/lib/signing/participation-terms.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const terms = {};
new Function('exports', compiled)(terms);

test('the unchanged defaults retain the original terms and role-specific clause', () => {
  const signer = terms.participationTermsText(null, 'firmante');
  const witness = terms.participationTermsText(null, 'testigo');
  assert.match(signer, /Al aceptar y participar en este documento/);
  assert.match(signer, /1\. Que ha revisado el contenido completo/);
  assert.match(signer, /firma autógrafa digital es un acto voluntario/);
  assert.doesNotMatch(witness, /firma autógrafa digital es un acto voluntario/);
  assert.match(witness, /testimonio electrónico del acto/);
});

test('custom terms replace the defaults exactly for every role', () => {
  const custom = 'Condición primera.\n\nCondición segunda.';
  assert.equal(terms.participationTermsText(custom, 'firmante'), custom);
  assert.equal(terms.participationTermsText(custom, 'aprobador'), custom);
});
