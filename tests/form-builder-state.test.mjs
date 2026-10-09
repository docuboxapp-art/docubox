import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import test from 'node:test';
import { createDefaultFormTemplate, normalizeFormTemplate } from '../src/lib/forms/schema.ts';

const cache = join(process.cwd(), 'node_modules/.cache/form-builder-state-test');
await mkdir(cache, { recursive: true });
await build({
  entryPoints: ['src/contexts/FormBuilderContext.tsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: join(cache, 'context.cjs'),
  logLevel: 'silent',
});
const { formBuilderReducer, snapshotPdfSectionLayout } = createRequire(import.meta.url)(join(cache, 'context.cjs'));
const experience = (settings) => ({
  multiStep: settings.multiStep,
  mode: settings.mode,
  allowSaveProgress: settings.allowSaveProgress,
  configurePdfDetails: settings.configurePdfDetails,
  configureFormDetails: settings.configureFormDetails,
  requiresSignature: settings.requiresSignature,
  configureLinkExpiration: settings.configureLinkExpiration,
  expirationHours: settings.expirationHours,
});
const state = (template) => ({
  template,
  savedExperience: experience(template.settings),
  savedAppearance: template.settings.appearance,
  savedPdfSchema: template.settings.pdfSchema,
  savedPdfSections: snapshotPdfSectionLayout(template.sections),
  selectedFieldId: null,
  selectedSectionId: template.sections[0].id,
  canvasMode: 'list',
  isDirty: true,
  isSaving: false,
  lastSaved: null,
});

test('new forms start with empty name and description without clearing saved content', () => {
  const template = createDefaultFormTemplate();
  assert.equal(template.name, '');
  assert.equal(template.description, '');
  const existing = normalizeFormTemplate({ id: 'saved', name: 'Mi formulario', description: 'Mi descripcion' });
  assert.equal(existing.name, 'Mi formulario');
  assert.equal(existing.description, 'Mi descripcion');
});

test('signature conditions from older drafts are removed and cannot be reintroduced', () => {
  const legacy = normalizeFormTemplate({
    schema: [{
      id: 'signature', type: 'signature_block', label: 'Firma', slug: 'firma',
      required: false, conditionalVisible: true,
      conditionalRule: { fieldId: 'choice', operator: 'eq', value: 'yes', action: 'show' },
    }],
  });
  assert.equal(legacy.schema[0].required, true);
  assert.equal(legacy.schema[0].conditionalVisible, false);
  assert.equal(legacy.schema[0].conditionalRule, undefined);

  const next = formBuilderReducer(state(legacy), {
    type: 'UPDATE_FIELD',
    payload: { id: 'signature', updates: {
      conditionalVisible: true,
      conditionalRule: { fieldId: 'choice', operator: 'eq', value: 'yes', action: 'hide' },
    } },
  });
  assert.equal(next.template.schema[0].conditionalVisible, false);
  assert.equal(next.template.schema[0].conditionalRule, undefined);
});

test('save acknowledgement clears only the exact saved snapshot', () => {
  const template = createDefaultFormTemplate();
  const saved = { ...template, id: 'persisted', updatedAt: 'now' };
  const next = formBuilderReducer(state(template), {
    type: 'ACK_SAVE',
    payload: { snapshot: template, saved },
  });
  assert.equal(next.isDirty, false);
  assert.equal(next.template, saved);
});

test('edits during save remain dirty and keep the newly persisted ID', () => {
  const template = createDefaultFormTemplate();
  const edited = { ...template, name: 'Newer edit', publicationComment: 'Newer comment' };
  const saved = { ...template, id: 'persisted', updatedAt: 'now', publicationComment: 'Earlier comment' };
  const next = formBuilderReducer(state(edited), {
    type: 'ACK_SAVE',
    payload: { snapshot: template, saved },
  });
  assert.equal(next.isDirty, true);
  assert.equal(next.template.name, 'Newer edit');
  assert.equal(next.template.publicationComment, 'Newer comment');
  assert.equal(next.template.id, 'persisted');
  assert.equal(next.template.updatedAt, 'now');
});

test('experience changes stay pending independently of other edits until the saved snapshot is acknowledged', () => {
  const template = createDefaultFormTemplate();
  const initial = { ...state(template), isDirty: false };
  const renamed = formBuilderReducer(initial, { type: 'SET_TEMPLATE_META', payload: { name: 'Otro nombre' } });
  assert.deepEqual(renamed.savedExperience, experience(renamed.template.settings));

  const selected = formBuilderReducer(renamed, {
    type: 'SET_SETTINGS', payload: { allowSaveProgress: false },
  });
  assert.equal(selected.savedExperience.allowSaveProgress, true);
  assert.equal(selected.template.settings.allowSaveProgress, false);

  const saved = { ...selected.template, id: 'persisted' };
  const acknowledged = formBuilderReducer(selected, {
    type: 'ACK_SAVE', payload: { snapshot: selected.template, saved },
  });
  assert.equal(acknowledged.savedExperience.allowSaveProgress, false);
  assert.equal(acknowledged.isDirty, false);
});

test('saving experience defaults does not save or create the form draft', () => {
  const template = createDefaultFormTemplate();
  const selected = formBuilderReducer({ ...state(template), isDirty: false }, {
    type: 'SET_SETTINGS', payload: { allowSaveProgress: false },
  });
  const savedDefaults = formBuilderReducer(selected, {
    type: 'SAVE_EXPERIENCE_DEFAULTS', payload: experience(selected.template.settings),
  });
  assert.equal(savedDefaults.template, selected.template);
  assert.equal(savedDefaults.template.id, undefined);
  assert.equal(savedDefaults.isDirty, true);
  assert.equal(savedDefaults.lastSaved, null);
  assert.equal(savedDefaults.savedExperience.allowSaveProgress, false);
});

test('late save acknowledgements cannot replace another open form', () => {
  const template = { ...createDefaultFormTemplate(), id: 'original' };
  const other = state({ ...template, id: 'other' });
  assert.equal(
    formBuilderReducer(other, {
      type: 'ACK_SAVE',
      payload: { snapshot: template, saved: template },
    }),
    other
  );
});

test('switching canvas views or selecting a field does not dirty the form', () => {
  const clean = { ...state(createDefaultFormTemplate()), isDirty: false };
  assert.equal(
    formBuilderReducer(clean, { type: 'SET_CANVAS_MODE', payload: 'pdf' }).isDirty,
    false
  );
  assert.equal(formBuilderReducer(clean, { type: 'SELECT_FIELD', payload: null }).isDirty, false);
});

test('PDF defaults initialize only untouched new forms', () => {
  const template = createDefaultFormTemplate();
  const defaults = {
    configurePdfDetails: true,
    pdfSchema: { ...template.settings.pdfSchema, header: 'Encabezado predeterminado' },
  };
  const clean = { ...state(template), isDirty: false };
  const initialized = formBuilderReducer(clean, {
    type: 'APPLY_PDF_DEFAULTS',
    payload: defaults,
  });
  assert.equal(initialized.template.settings.configurePdfDetails, true);
  assert.equal(initialized.savedExperience.configurePdfDetails, true);
  assert.equal(initialized.template.settings.pdfSchema.header, 'Encabezado predeterminado');
  assert.equal(initialized.savedPdfSchema.header, 'Encabezado predeterminado');
  assert.equal(initialized.isDirty, false);
  assert.equal(formBuilderReducer(state(template), { type: 'APPLY_PDF_DEFAULTS', payload: defaults }).template, template);
  assert.equal(formBuilderReducer({ ...clean, template: { ...template, id: 'saved' } }, { type: 'APPLY_PDF_DEFAULTS', payload: defaults }).template.id, 'saved');
});

test('el diseño web solo queda aplicado tras guardar formulario y predeterminado', () => {
  const template = createDefaultFormTemplate();
  const loaded = formBuilderReducer(state(template), {
    type: 'SET_TEMPLATE', payload: { ...template, id: 'draft' },
  });
  assert.deepEqual(loaded.savedAppearance, loaded.template.settings.appearance);
  const edited = formBuilderReducer(loaded, {
    type: 'SET_APPEARANCE', payload: { headerText: 'Nuevo encabezado' },
  });
  assert.notDeepEqual(edited.savedAppearance, edited.template.settings.appearance);
  const persisted = formBuilderReducer(edited, {
    type: 'ACK_SAVE', payload: { snapshot: edited.template, saved: { ...edited.template, updatedAt: 'now' } },
  });
  assert.notDeepEqual(persisted.savedAppearance, persisted.template.settings.appearance);
  const applied = formBuilderReducer(persisted, {
    type: 'SAVE_APPEARANCE_DESIGN', payload: persisted.template.settings.appearance,
  });
  assert.deepEqual(applied.savedAppearance, applied.template.settings.appearance);
});

test('editing the visible header keeps the General name and description intact', () => {
  const template = createDefaultFormTemplate();
  template.name = 'Nombre interno';
  template.description = 'Descripción interna';
  const edited = formBuilderReducer(state(template), {
    type: 'SET_APPEARANCE',
    payload: { headerText: 'Nombre público', headerDescription: 'Descripción pública' },
  });
  assert.equal(edited.template.name, 'Nombre interno');
  assert.equal(edited.template.description, 'Descripción interna');
  assert.equal(edited.template.settings.appearance.headerText, 'Nombre público');
  assert.equal(edited.template.settings.appearance.headerDescription, 'Descripción pública');
});

test('General code and catalog type are copied into the public appearance', () => {
  const template = createDefaultFormTemplate();
  const edited = formBuilderReducer(state(template), {
    type: 'SET_SETTINGS',
    payload: { documentNumber: 'FORM-001', documentTypeId: 'catalog-1', documentTypeName: 'Solicitud' },
  });
  assert.equal(edited.template.settings.appearance.headerDocumentNumber, 'FORM-001');
  assert.equal(edited.template.settings.appearance.headerDocumentTypeName, 'Solicitud');
  assert.equal(edited.template.settings.documentTypeId, 'catalog-1');
});

test('el diseño PDF sigue pendiente entre pasos hasta guardar sus predeterminados', () => {
  const template = createDefaultFormTemplate();
  const loaded = formBuilderReducer(state(template), {
    type: 'SET_TEMPLATE', payload: { ...template, id: 'draft' },
  });
  assert.deepEqual(loaded.savedPdfSchema, loaded.template.settings.pdfSchema);
  const edited = formBuilderReducer(loaded, {
    type: 'SET_PDF_SCHEMA', payload: { header: 'Otro encabezado PDF' },
  });
  const persisted = formBuilderReducer(edited, {
    type: 'ACK_SAVE', payload: { snapshot: edited.template, saved: { ...edited.template, updatedAt: 'now' } },
  });
  assert.notDeepEqual(persisted.savedPdfSchema, persisted.template.settings.pdfSchema);
  const applied = formBuilderReducer(persisted, {
    type: 'SAVE_PDF_DESIGN', payload: {
      pdfSchema: persisted.template.settings.pdfSchema,
      sections: persisted.template.sections,
    },
  });
  assert.deepEqual(applied.savedPdfSchema, applied.template.settings.pdfSchema);
  assert.deepEqual(applied.savedPdfSections, snapshotPdfSectionLayout(applied.template.sections));
  const sectionEdited = formBuilderReducer(applied, {
    type: 'UPDATE_SECTION', payload: { id: applied.template.sections[0].id, updates: { pageBreakBefore: true } },
  });
  assert.notDeepEqual(sectionEdited.savedPdfSections, snapshotPdfSectionLayout(sectionEdited.template.sections));
});

test('experience defaults initialize only untouched new forms without inserting a signature field', () => {
  const template = createDefaultFormTemplate();
  const clean = { ...state(template), isDirty: false };
  const defaults = {
    multiStep: false,
    mode: 'scroll',
    allowSaveProgress: false,
    configurePdfDetails: true,
    configureFormDetails: true,
    requiresSignature: true,
    configureLinkExpiration: true,
    expirationHours: 0.5,
  };
  const initialized = formBuilderReducer(clean, {
    type: 'APPLY_EXPERIENCE_DEFAULTS', payload: defaults,
  });
  assert.equal(initialized.isDirty, false);
  assert.equal(initialized.template.settings.mode, 'scroll');
  assert.deepEqual(initialized.savedExperience, defaults);
  assert.equal(initialized.template.settings.expirationHours, 0.5);
  assert.equal(initialized.template.settings.configureLinkExpiration, true);
  assert.equal(initialized.template.schema.length, 0);
  assert.equal(formBuilderReducer(state(template), {
    type: 'APPLY_EXPERIENCE_DEFAULTS', payload: defaults,
  }).template, template);
  assert.equal(formBuilderReducer({ ...clean, template: { ...template, id: 'saved' } }, {
    type: 'APPLY_EXPERIENCE_DEFAULTS', payload: defaults,
  }).template.id, 'saved');
});

test('requiring a signature waits for a manually inserted mandatory field', () => {
  const initial = state(createDefaultFormTemplate());
  assert.equal(initial.template.settings.requiresSignature, true);
  assert.equal(initial.template.schema.length, 0);

  const enabled = formBuilderReducer(initial, {
    type: 'SET_SETTINGS', payload: { requiresSignature: true },
  });
  assert.equal(enabled.template.schema.length, 0);
  const signature = {
    id: 'signature-a', type: 'signature_block', label: 'Firma', slug: 'firma',
    required: true, pdf: { show: true, label: 'Firma', order: 0 },
  };
  const inserted = formBuilderReducer(enabled, {
    type: 'ADD_FIELD', payload: { field: signature },
  });
  assert.equal(inserted.template.schema[0].type, 'signature_block');
  assert.equal(inserted.template.schema[0].required, true);
  assert.deepEqual(inserted.template.settings.allowedSignatureTypes, []);
  assert.deepEqual(inserted.template.sections[0].fieldIds, [signature.id]);
  assert.equal(formBuilderReducer(inserted, {
    type: 'ADD_FIELD', payload: { field: { ...signature, id: 'signature-b' } },
  }), inserted);

  const optional = formBuilderReducer(inserted, {
    type: 'UPDATE_FIELD', payload: { id: signature.id, updates: { required: false } },
  });
  const unchanged = formBuilderReducer(optional, {
    type: 'SET_SETTINGS', payload: { requiresSignature: true },
  });
  assert.equal(unchanged.template.schema.length, 1);
  assert.equal(unchanged.template.schema[0].required, true);

  const disabled = formBuilderReducer(unchanged, {
    type: 'SET_SETTINGS', payload: { requiresSignature: false },
  });
  assert.equal(disabled.template.settings.requiresSignature, true);
  assert.equal(disabled.template.schema.length, 1);
  const deleted = formBuilderReducer(unchanged, { type: 'DELETE_FIELD', payload: signature.id });
  assert.equal(deleted.template.schema.length, 0);
  assert.deepEqual(deleted.template.sections[0].fieldIds, []);
});

test('editing an older signed draft does not insert a missing signature field', () => {
  const template = createDefaultFormTemplate();
  const loaded = formBuilderReducer(state(template), {
    type: 'SET_TEMPLATE',
    payload: {
      ...template,
      id: 'older-draft',
      settings: { ...template.settings, requiresSignature: true },
    },
  });
  assert.equal(loaded.template.schema.length, 0);
  assert.equal(loaded.isDirty, false);
});
