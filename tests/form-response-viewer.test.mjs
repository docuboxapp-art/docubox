import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('src/app/api/documentos/[documentId]/form-response/route.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ allowed = true } = {}) {
  class FakeDocumentAccessError extends Error {}
  const queried = [];
  const rows = {
    form_responses: {
      id: 'response-id', template_id: 'form-id', submitted_at: '2026-10-09T12:00:00Z',
      respondent_name: 'Ana', respondent_email: 'ana@example.com', folio: 'FORM-1',
      response_data: { name: 'Ana', consent: true, signature: 'data:image/png;base64,private' },
    },
    form_templates: {
      name: 'Alta', version_number: 2, created_by: 'creator-id',
      schema: [
        { id: 'name', label: 'Nombre', type: 'text', sectionId: 'general' },
        { id: 'consent', label: 'Aceptación', type: 'checkbox', sectionId: 'general' },
        { id: 'signature', label: 'Firma', type: 'firma_autografa', sectionId: 'general' },
      ],
      settings: { sections: [{ id: 'general', title: 'Datos generales' }] },
    },
    user_profiles: { full_name: 'Solicitante' },
  };
  const service = {
    from(table) {
      queried.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: rows[table], error: null }),
      };
      return builder;
    },
  };
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name.includes('document-content-access')) return {
      requireDocumentContentAccess: async () => {
        if (!allowed) throw new FakeDocumentAccessError('ACCESS_DENIED');
        return { service, document: { id: 'document-id', nombre: 'Alta', source_form_response_id: 'response-id' } };
      },
    };
    if (name.includes('document-access')) return {
      DocumentAccessError: FakeDocumentAccessError,
      documentAccessResponse: () => ({ status: 403, body: { code: 'ACCESS_DENIED' } }),
    };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return { GET: exports.GET, queried };
}

test('the authorized viewer sees captured answers with labels but never raw signature images', async () => {
  const { GET, queried } = fixture();
  const response = await GET(new Request('https://example.test'), {
    params: Promise.resolve({ documentId: 'document-id' }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.formName, 'Alta');
  assert.equal(body.version, 2);
  assert.deepEqual(body.sections, [{ title: 'Datos generales', fields: [
    { label: 'Nombre', value: 'Ana' },
    { label: 'Aceptación', value: 'Sí' },
  ] }]);
  assert.equal(JSON.stringify(body).includes('base64'), false);
  assert.deepEqual(queried, ['form_responses', 'form_templates', 'user_profiles']);
});

test('the form answers are not queried before document access is granted', async () => {
  const { GET, queried } = fixture({ allowed: false });
  const response = await GET(new Request('https://example.test'), {
    params: Promise.resolve({ documentId: 'document-id' }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(queried, []);
});
