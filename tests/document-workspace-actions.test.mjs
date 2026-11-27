import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

let authorization;
let requests;
const fixtureKey = Symbol.for('docubox.workspaceDocumentActionsTest');
globalThis[fixtureKey] = {
  access() {
    if (authorization.error) throw Object.assign(new Error('Permiso denegado.'), { status: 403 });
    return authorization;
  },
  requests() { return requests; },
};

async function loadRoute(action) {
  const mocks = {
    'server-only': '',
    'next/server': 'export const NextResponse = { json: (body, init) => Response.json(body, init) };',
    '@/lib/security/document-access': `
      const fixture = globalThis[Symbol.for('docubox.workspaceDocumentActionsTest')];
      export class DocumentAccessError extends Error {
        constructor(code, message, status) { super(message); this.code = code; this.status = status; }
      }
      export const requireDocumentAccess = (_request, _id, options) => {
        if (!options.requireEdit) throw new Error('Missing edit permission check');
        return fixture.access();
      };
      export const documentAccessResponse = (error) => ({
        status: error.status || 500, body: { error: error.message, code: error.code },
      });
    `,
    '@/lib/crypto/document-encryption': 'export const documentEncryptionPolicy = () => ({enabled:false}); export const encryptAndUploadDocumentObject = () => {};',
    '@/lib/case-files/runtime.server': `
      const fixture = globalThis[Symbol.for('docubox.workspaceDocumentActionsTest')];
      export class CaseRuntimeError extends Error {}
      export const runtimeFailure = () => ({body:{},status:409});
      export const assertCaseSourceReplacementAllowed = async () => { fixture.requests().push('case-lock'); };
    `,
  };
  const { outputFiles } = await build({
    entryPoints: [`src/app/api/documentos/[documentId]/${action}/route.ts`],
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'document-route-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'js' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const [{ PATCH }, { POST }] = await Promise.all([loadRoute('edit'), loadRoute('replace-file')]);
const context = { params: Promise.resolve({ documentId: 'document-id' }) };
const revision = '2026-11-24T18:30:00Z';

function setup({
  document = {},
  response = false,
  evidence = false,
  activeSigning = false,
  startsSigningDuringUpload = false,
  conflict = false,
  denied = false,
} = {}) {
  requests = [];
  let uploaded = false;
  const service = {
    from(table) {
      const operation = { table, filters: [] };
      const query = {
        select() { return query; },
        eq(key, value) { operation.filters.push(['eq', key, value]); return query; },
        is(key, value) { operation.filters.push(['is', key, value]); return query; },
        or(value) { operation.filters.push(['or', value]); return query; },
        order() { return query; },
        limit() { return query; },
        update(values) { operation.update = values; return query; },
        insert() { operation.insert = true; return query; },
        delete() { operation.delete = true; return query; },
        async maybeSingle() {
          requests.push(operation);
          if (table === 'documentos') return { error: null, data: conflict ? null : { id: 'document-id', ...operation.update } };
          if (table === 'document_versions') return { error: null, data: { version_number: 1 } };
          const found =
            (table === 'participation_responses' && response) ||
            (table === 'signature_evidence' && evidence) ||
            (table === 'participant_completion_attempts' && (activeSigning || (uploaded && startsSigningDuringUpload)));
          return { error: null, data: found ? { id: 'signature-record' } : null };
        },
        then(resolve) { requests.push(operation); return Promise.resolve({ error: null }).then(resolve); },
      };
      return query;
    },
    storage: {
      from() {
        return {
          async upload() { uploaded = true; requests.push('upload'); return { error: null }; },
          async remove() { requests.push('storage-removed'); return { error: null }; },
        };
      },
    },
  };
  authorization = {
    error: denied,
    user: { id: 'owner-id' },
    service,
    document: { id: 'document-id', workspace_id: 'workspace-id', estado: 'en_proceso', updated_at: revision, participantes: [], ...document },
  };
  return requests;
}

function edit(updates, operation) {
  return PATCH(new Request('http://localhost/api/documents/edit', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates, operation }),
  }), context);
}

function replace() {
  const body = new FormData();
  body.append('file', new File(['%PDF-1.4\n'], 'reemplazo.pdf', { type: 'application/pdf' }));
  return POST(new Request('http://localhost/api/documents/replace-file', { method: 'POST', body }), context);
}

test('completed names and editing are blocked by the API, including legacy completion timestamps', async () => {
  for (const document of [{ estado: 'completado' }, { fecha_completado: revision }]) {
    const operations = setup({ document });
    assert.equal((await edit({ nombre: 'Otro nombre' }, 'rename')).status, 409);
    assert.equal((await edit({ descripcion: 'Texto nuevo' })).status, 409);
    assert.equal(operations.some(({ table }) => table === 'documentos'), false);
  }
});

test('rename accepts the name alone on non-completed documents and preserves the state condition', async () => {
  const operations = setup({ document: { estado: 'borrador' } });
  assert.equal((await edit({ nombre: 'Cambio', descripcion: 'Inesperada' }, 'rename')).status, 400);
  const renamed = await edit({ nombre: '  Título guardado  ' }, 'rename');
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).data.nombre, 'Título guardado');
  assert.deepEqual(operations.find(({ table }) => table === 'documentos').filters, [
    ['eq', 'id', 'document-id'],
    ['eq', 'estado', 'borrador'],
    ['is', 'deleted_at', null],
    ['is', 'fecha_completado', null],
    ['eq', 'updated_at', revision],
  ]);
});

test('edits are accepted before signing and reject existing evidence, signed participants, and active signature claims', async () => {
  const changes = { descripcion: 'Texto nuevo', campos_solicitados: [], participant_mode: 'yo_y_otros' };
  setup({ document: { estado: 'en_progreso', participantes: [{ estado: 'en_revision' }] } });
  const result = await edit(changes);
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).data.campos_solicitados, []);

  for (const state of [
    { document: { participantes: [{ sub_estado: 'firmo' }] } },
    { response: true }, { evidence: true }, { activeSigning: true },
  ]) {
    const operations = setup(state);
    const blocked = await edit(changes);
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, 'DOCUMENT_EDIT_CONFLICT');
    assert.ok(!operations.some(({ update }) => update));
  }
});

test('writes use server edit permission and reject a document that changed before the update', async () => {
  setup({ denied: true });
  assert.equal((await edit({ nombre: 'Cambio' })).status, 403);
  const operations = setup({ conflict: true });
  assert.equal((await edit({ nombre: 'Cambio' })).status, 409);
  assert.ok(!operations.some(({ table }) => table === 'document_lifecycle_audit_events'));
});

test('file replacement preserves the original when signing starts during upload', async () => {
  let operations = setup({ activeSigning: true });
  assert.equal((await replace()).status, 409);
  assert.ok(!operations.includes('upload'));

  operations = setup({ startsSigningDuringUpload: true });
  assert.equal((await replace()).status, 409);
  assert.ok(operations.includes('storage-removed'));
  assert.ok(!operations.some(({ table }) => table === 'documentos'));
  assert.ok(operations.some(({ table, delete: removed }) => table === 'document_versions' && removed));

  operations = setup();
  assert.equal((await replace()).status, 200);
  assert.ok(operations.includes('upload') && !operations.includes('storage-removed'));
});
