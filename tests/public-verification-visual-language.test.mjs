import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const files = await Promise.all([
  read('../src/app/verificar-documento/page.tsx'),
  read('../src/app/verificar-documento/[identifier]/page.tsx'),
  read('../src/app/verificar-documento/components/PublicVerificationShell.tsx'),
  read('../src/app/verificar-documento/components/VerificationResultView.tsx'),
]);

const verificationUi = files.join('\n');

test('public verification uses the Docubox primary and slate visual language', () => {
  assert.match(verificationUi, /bg-primary/);
  assert.match(verificationUi, /text-primary/);
  assert.match(verificationUi, /border-slate-200/);
  assert.match(verificationUi, /text-slate-950/);
});

test('public verification does not reintroduce legacy indigo and zinc tokens', () => {
  assert.doesNotMatch(
    verificationUi,
    /#4f46e5|#4338ca|indigo-(?:50|100|200)|#18181b|#52525b|#71717a|#ebebf0|#14213d/i
  );
});

test('participant results use the same quiet table treatment as the application', () => {
  assert.match(
    files[3],
    /<thead className="border-b border-slate-200 bg-slate-50[^"]*text-slate-500"/
  );
});
