import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import test from 'node:test';

const cache = join(process.cwd(), 'node_modules/.cache/form-lifecycle-test');
await mkdir(cache, { recursive: true });
await build({
  entryPoints: ['src/lib/forms/lifecycle.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: join(cache, 'lifecycle.cjs'),
  logLevel: 'silent',
});
const {
  formTemplateFromRow,
  publicationError,
  persistFormDraft,
  publishFormDraft,
  createFormVersion,
  createFormRevision,
  switchFormDraftVersionMode,
  submitFormForApproval,
  formSaveError,
} = createRequire(import.meta.url)(join(cache, 'lifecycle.cjs'));

function row(overrides = {}) {
  return {
    id: 'form-a',
    workspace_id: 'workspace-a',
    created_by: 'owner-a',
    name: 'Test form',
    description: '',
    status: 'draft',
    schema: [{ id: 'field-a', type: 'text', label: 'Name', slug: 'name', required: true }],
    settings: {
      requiresSignature: false,
      allowedSignatureTypes: ['click_sign'],
      expirationHours: 72,
    },
    version_number: 1,
    updated_at: '2026-10-02T00:00:00Z',
    ...overrides,
  };
}

function client(result) {
  const calls = [];
  const chain = {};
  for (const method of ['from', 'update', 'insert', 'eq', 'select'])
    chain[method] = (...args) => {
      calls.push([method, ...args]);
      return chain;
    };
  chain.single = async () => result;
  chain.rpc = async (...args) => {
    calls.push(['rpc', ...args]);
    return result;
  };
  return { db: chain, calls };
}

test('legacy rows normalize to version 1 without losing signature/PDF settings', () => {
  const template = formTemplateFromRow(
    row({
      version_number: undefined,
      settings: { pdfSchema: { header: 'Custom header' }, requireOtp: false, requiresSignature: true },
    })
  );
  assert.equal(template.versionNumber, 1);
  assert.equal(template.settings.pdfSchema.header, 'Custom header');
  assert.equal(template.settings.requireOtp, false);
  assert.equal(template.settings.requiresSignature, true);
  assert.equal(formTemplateFromRow(row()).settings.requiresSignature, true);
});

test('form classification remains in settings when saving a draft', async () => {
  const template = formTemplateFromRow(
    row({
      settings: {
        documentNumber: 'OF-2026-001',
        documentTypeId: 'type-a',
        documentTypeName: 'Solicitud',
        tagIds: ['tag-a', 'tag-b'],
      },
    })
  );
  assert.equal(template.settings.documentNumber, 'OF-2026-001');
  assert.equal(template.settings.documentTypeId, 'type-a');
  assert.equal(template.settings.documentTypeName, 'Solicitud');
  assert.deepEqual(template.settings.tagIds, ['tag-a', 'tag-b']);
  const { db, calls } = client({ data: row(), error: null });
  await persistFormDraft(db, template, 'workspace-a', 'editor-a');
  const payload = calls.find(([method]) => method === 'update')[1];
  assert.equal(payload.settings.documentNumber, 'OF-2026-001');
  assert.equal(payload.settings.documentTypeId, 'type-a');
  assert.equal(payload.settings.documentTypeName, 'Solicitud');
  assert.deepEqual(payload.settings.tagIds, ['tag-a', 'tag-b']);
});

test('el diseño web y PDF se guardan y vuelven a cargar con el formulario', async () => {
  const original = formTemplateFromRow(row());
  const edited = {
    ...original,
    settings: {
      ...original.settings,
      appearance: { ...original.settings.appearance, headerText: 'Mi encabezado', headerDescription: 'Descripción visible', backgroundColor: '#EAF4FF', showDocumentNumber: false, showFooter: true },
      pdfSchema: { ...original.settings.pdfSchema, header: 'PDF personalizado', showIp: false, consentPage: true },
    },
  };
  const { db, calls } = client({ data: row(), error: null });
  await persistFormDraft(db, edited, 'workspace-a', 'owner-a');
  const payload = calls.find(([method]) => method === 'update')[1];
  assert.equal(payload.settings.appearance.headerText, 'Mi encabezado');
  assert.equal(payload.settings.appearance.headerDescription, 'Descripción visible');
  assert.equal(payload.settings.appearance.backgroundColor, '#EAF4FF');
  assert.equal(payload.settings.appearance.showDocumentNumber, false);
  assert.equal(payload.settings.pdfSchema.showIp, false);
  assert.equal(payload.settings.pdfSchema.consentPage, true);
  const loaded = formTemplateFromRow(row({
    settings: payload.settings,
    pdf_schema: payload.settings.pdfSchema,
  }));
  assert.equal(loaded.settings.appearance.headerText, 'Mi encabezado');
  assert.equal(loaded.settings.appearance.headerDescription, 'Descripción visible');
  assert.equal(loaded.settings.appearance.backgroundColor, '#EAF4FF');
  assert.equal(loaded.settings.appearance.showDocumentNumber, false);
  assert.equal(loaded.settings.appearance.showFooter, true);
  assert.equal(loaded.settings.pdfSchema.header, 'PDF personalizado');
  assert.equal(loaded.settings.pdfSchema.showIp, false);
});

test('publication comment saves on a new form and can be cleared from an existing draft', async () => {
  const template = formTemplateFromRow(row());
  const created = client({ data: row({ publication_comment: 'Primera publicación' }), error: null });
  await persistFormDraft(created.db, { ...template, id: undefined, publicationComment: 'Primera publicación' }, 'workspace-a', 'owner-a');
  assert.equal(created.calls.find(([method]) => method === 'insert')[1].publication_comment, 'Primera publicación');

  const updated = client({ data: row({ publication_comment: null }), error: null });
  await persistFormDraft(updated.db, { ...template, publicationComment: '' }, 'workspace-a', 'owner-a');
  assert.equal(updated.calls.find(([method]) => method === 'update')[1].publication_comment, null);
});

test('canonical schema takes precedence and preserves version family', () => {
  const template = formTemplateFromRow(
    row({
      root_template_id: 'family-a',
      version_number: 3,
      form_schema: { fields: [], sections: [] },
      pdf_schema: { header: 'Canonical' },
    })
  );
  assert.equal(template.schema.length, 0);
  assert.equal(template.rootTemplateId, 'family-a');
  assert.equal(template.versionNumber, 3);
  assert.equal(template.settings.pdfSchema.header, 'Canonical');
});

test('publication validates title, fields, field identities and expiration without choosing a signature method', () => {
  const draft = formTemplateFromRow(row());
  assert.match(publicationError(draft), /Agrega el campo Firma/);
  const template = {
    ...draft,
    schema: [...draft.schema, { id: 'signature-a', type: 'signature_block', label: 'Firma', slug: 'firma', required: true }],
  };
  assert.equal(publicationError(template), null);
  for (const invalid of [
    { ...template, name: '  ' },
    { ...template, schema: [] },
    { ...template, schema: [template.schema[0], { ...template.schema[0], id: 'field-b' }] },
    { ...template, settings: { ...template.settings, configureLinkExpiration: true, expirationHours: -1 } },
  ])
    assert.ok(publicationError(invalid));
  assert.equal(publicationError({
    ...template,
    settings: { ...template.settings, allowedSignatureTypes: [] },
  }), null);
  assert.equal(publicationError({
    ...template,
    settings: { ...template.settings, configureLinkExpiration: false, expirationHours: -1 },
  }), null);
  const signed = { ...template, settings: { ...template.settings, requiresSignature: true } };
  assert.equal(publicationError(signed), null);
  assert.match(publicationError({ ...signed, schema: [] }), /Agrega el campo Firma/);
});

test('draft updates are scoped and optimistic, never rewrite owner/workspace/status', async () => {
  const { db, calls } = client({ data: row(), error: null });
  await persistFormDraft(db, formTemplateFromRow(row()), 'workspace-a', 'editor-a');
  const payload = calls.find(([method]) => method === 'update')[1];
  for (const key of ['created_by', 'workspace_id', 'status']) assert.ok(!(key in payload));
  assert.ok(calls.some((call) => call[1] === 'status' && call[2] === 'draft'));
  assert.ok(calls.some((call) => call[1] === 'workspace_id' && call[2] === 'workspace-a'));
  assert.ok(calls.some((call) => call[1] === 'updated_at' && call[2] === row().updated_at));
});

test('new forms are drafts with their authenticated creator', async () => {
  const { db, calls } = client({ data: row(), error: null });
  await persistFormDraft(
    db,
    { ...formTemplateFromRow(row()), id: undefined },
    'workspace-a',
    'owner-a'
  );
  const payload = calls.find(([method]) => method === 'insert')[1];
  assert.equal(payload.status, 'draft');
  assert.equal(payload.created_by, 'owner-a');
  assert.equal(payload.workspace_id, 'workspace-a');
});

test('published/archived forms and workspace changes cannot be autosaved', async () => {
  const { db, calls } = client({ data: row(), error: null });
  for (const status of ['in_review', 'published', 'paused', 'closed', 'archived']) {
    await assert.rejects(
      persistFormDraft(db, formTemplateFromRow(row({ status })), 'workspace-a', 'owner-a')
    );
  }
  await assert.rejects(persistFormDraft(db, formTemplateFromRow(row()), 'workspace-b', 'owner-a'));
  assert.equal(calls.length, 0);
});

test('permission errors and empty updates propagate instead of claiming success', async () => {
  const denied = { code: '42501', message: 'denied' };
  await assert.rejects(
    persistFormDraft(
      client({ data: null, error: denied }).db,
      formTemplateFromRow(row()),
      'workspace-a',
      'owner-a'
    ),
    (error) => error === denied
  );
  await assert.rejects(
    persistFormDraft(
      client({ data: null, error: null }).db,
      formTemplateFromRow(row()),
      'workspace-a',
      'owner-a'
    )
  );
  assert.match(formSaveError(denied), /permiso/);
});

test('publication updates status only and detects conflicts', async () => {
  const { db, calls } = client({ data: row({ status: 'published' }), error: null });
  const draft = formTemplateFromRow(row());
  const signed = { ...draft, schema: [...draft.schema, { id: 'signature-a', type: 'signature_block', label: 'Firma', slug: 'firma', required: true }] };
  const result = await publishFormDraft(db, signed);
  assert.equal(result.status, 'published');
  assert.deepEqual(calls.find(([method]) => method === 'update')[1], { status: 'published' });
  assert.ok(calls.some((call) => call[1] === 'updated_at'));
  await assert.rejects(
    publishFormDraft(
      client({ data: null, error: { code: 'PGRST116' } }).db,
      signed
    )
  );
});

test('new versions use the authorized RPC and preserve database-assigned version', async () => {
  const { db, calls } = client({
    data: row({ id: 'form-v2', version_number: 2, root_template_id: 'form-a' }),
    error: null,
  });
  const result = await createFormVersion(db, 'form-a');
  assert.deepEqual(calls, [['rpc', 'create_form_template_version', { source_id: 'form-a' }]]);
  assert.equal(result.versionNumber, 2);
  assert.equal(result.rootTemplateId, 'form-a');
  assert.equal(result.status, 'draft');
  await assert.rejects(
    createFormVersion(client({ data: null, error: { code: 'PGRST202' } }).db, 'form-a')
  );
  assert.match(formSaveError({ code: 'PGRST202' }), /migración/);
});

test('same-version revisions use a separate RPC and keep their revision number', async () => {
  const { db, calls } = client({
    data: row({ id: 'form-v1-r2', version_number: 1, revision_number: 2,
      root_template_id: 'form-a', source_template_id: 'form-a' }),
    error: null,
  });
  const result = await createFormRevision(db, 'form-a');
  assert.deepEqual(calls, [['rpc', 'create_form_template_revision', { source_id: 'form-a' }]]);
  assert.equal(result.versionNumber, 1);
  assert.equal(result.revisionNumber, 2);
  assert.equal(result.sourceTemplateId, 'form-a');
  assert.equal(result.status, 'draft');
});

test('changing an edited revision to a new version preserves content before removing the old draft', async () => {
  const calls = [];
  const original = formTemplateFromRow(row({
    id: 'revision-draft', root_template_id: 'form-a', source_template_id: 'form-a',
    revision_number: 2, name: 'Edited name', publication_comment: 'Updated fields',
  }));
  const created = row({ id: 'version-draft', root_template_id: 'form-a', version_number: 2 });
  const db = {
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return { data: created, error: null };
    },
    from: () => ({
      update: (payload) => {
        calls.push(['update', payload]);
        const query = { eq: () => query, select: () => query,
          single: async () => ({ data: { ...created, ...payload }, error: null }) };
        return query;
      },
      delete: () => {
        calls.push(['delete']);
        const query = { eq: () => query, select: async () => ({ data: [{ id: 'revision-draft' }], error: null }) };
        return query;
      },
    }),
  };
  const result = await switchFormDraftVersionMode(db, original, 'version', 'workspace-a', 'owner-a');
  assert.equal(result.template.id, 'version-draft');
  assert.equal(result.template.name, 'Edited name');
  assert.equal(result.template.publicationComment, 'Updated fields');
  assert.equal(result.previousDraftRetained, false);
  assert.deepEqual(calls.map(([operation]) => operation), ['rpc', 'update', 'delete']);
  assert.equal(calls[0][1], 'create_form_template_version');
  assert.equal(calls[0][2].source_id, 'form-a');
  assert.equal(calls[1][1].name, 'Edited name');
});

test('changing an edited new version to a revision starts from the latest published revision', async () => {
  const calls = [];
  const original = formTemplateFromRow(row({
    id: 'version-draft', root_template_id: 'form-a', version_number: 2,
  }));
  const created = row({
    id: 'revision-draft', root_template_id: 'form-a', source_template_id: 'published-revision',
    revision_number: 3,
  });
  const lookup = { eq: () => lookup, or: () => lookup, not: () => lookup,
    neq: () => lookup, lt: () => lookup, order: () => lookup, limit: () => lookup,
    maybeSingle: async () => ({ data: { id: 'published-revision' }, error: null }) };
  const db = {
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return { data: created, error: null };
    },
    from: () => ({
      select: () => lookup,
      update: (payload) => {
        const query = { eq: () => query, select: () => query,
          single: async () => ({ data: { ...created, ...payload }, error: null }) };
        return query;
      },
      delete: () => {
        const query = { eq: () => query, select: async () => ({ data: [{ id: 'version-draft' }], error: null }) };
        return query;
      },
    }),
  };
  const result = await switchFormDraftVersionMode(db, original, 'revision', 'workspace-a', 'owner-a');
  assert.equal(result.template.revisionNumber, 3);
  assert.equal(result.template.sourceTemplateId, 'published-revision');
  assert.equal(calls[0][1], 'create_form_template_revision');
  assert.equal(calls[0][2].source_id, 'published-revision');
});

test('approval submission uses the workflow RPC and reloads the reviewed row', async () => {
  const calls = [];
  const db = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { data: 'instance-a', error: null };
    },
    from: (table) => {
      calls.push(['from', table]);
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: row({ status: 'in_review' }), error: null }) }) }),
      };
    },
  };
  const reviewed = await submitFormForApproval(db, 'form-a', 'workspace-a', 'workflow-a');
  assert.equal(reviewed.status, 'in_review');
  assert.equal(calls[0][0], 'submit_form_for_approval');
  assert.equal(calls[0][1].target_form_id, 'form-a');
  assert.equal(calls[0][1].ws_id, 'workspace-a');
  assert.equal(calls[0][1].target_workflow_id, 'workflow-a');
  assert.ok(calls[0][1].requested_idempotency_key);
  assert.deepEqual(calls[1], ['from', 'form_templates']);
});

test('PostgREST composite-row arrays are accepted without inventing a version', async () => {
  const { db } = client({
    data: [row({ id: 'form-v4', version_number: 4, root_template_id: 'form-a' })],
    error: null,
  });
  const result = await createFormVersion(db, 'form-a');
  assert.equal(result.id, 'form-v4');
  assert.equal(result.versionNumber, 4);
  await assert.rejects(createFormVersion(client({ data: [], error: null }).db, 'form-a'));
});
