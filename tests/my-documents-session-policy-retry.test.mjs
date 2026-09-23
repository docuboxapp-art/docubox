import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/app/mis-documentos/page.tsx', import.meta.url),
  'utf8'
);

test('mis-documentos retries temporary session-policy and schema-cache failures', () => {
  assert.match(source, /DOCUMENT_LOAD_RETRY_DELAYS_MS = \[1_000, 2_500\]/);
  assert.match(source, /errorCode === 'SESSION_POLICY_UNAVAILABLE'/);
  assert.match(source, /errorCode === 'PGRST002'/);
  assert.match(source, /errorMessage\.includes\('schema cache'\)/);
  assert.match(source, /response\.headers\.get\('retry-after'\)/);
  assert.match(source, /fetchDocumentData\('\/api\/documentos\/listar\?tipo=todos'/);
  assert.match(
    source,
    /fetchDocumentData\(\s*'\/api\/documentos\/mis-participaciones\?exclude_owned=true&view=list'/
  );
});

test('mis-documentos coalesces repeated primary loads while one is in flight', () => {
  assert.match(source, /const loadDocumentsInFlightRef = useRef\(false\)/);
  assert.match(source, /if \(!user \|\| loadDocumentsInFlightRef\.current\) return/);
  assert.match(source, /loadDocumentsInFlightRef\.current = true/);
  assert.match(
    source,
    /finally \{\s*loadDocumentsInFlightRef\.current = false;\s*setLoadingDocs\(false\)/
  );
});

test('supporting labels and folders use the same transient-failure handling', () => {
  assert.match(source, /fetchDocumentData\('\/api\/documentos\/etiquetas'\)/);
  assert.match(source, /fetchDocumentData\('\/api\/documentos\/carpetas'/);
});
