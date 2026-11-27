import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/lib/case-files/template-builder.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const {
  emptyCaseTemplate,
  newCaseTemplateItem,
  newCaseTemplateVerification,
  newCaseTemplateStage,
  parseStoredCaseTemplate,
  toCaseTemplate,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const catalogBundle = await build({
  entryPoints: ['src/lib/case-files/category-catalog.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { caseCategories, caseTagGroups, caseTags } = await import(
  `data:text/javascript;base64,${Buffer.from(catalogBundle.outputFiles[0].text).toString('base64')}`
);

test('expediente categories retain their six correlated types and transversal tag groups', () => {
  assert.equal(caseCategories.length, 16);
  assert.equal(caseTagGroups.length, 7);
  assert.equal(new Set(caseTags.map((tag) => tag.id)).size, caseTags.length);
  for (const category of caseCategories) {
    assert.equal(category.types.length, 6);
    assert.ok(category.types.every((type) => type.code.startsWith(category.code.slice(-2))));
  }
});

test('expediente classification, folio and tags survive a saved draft', () => {
  const category = caseCategories[2];
  const stored = {
    id: 'classified',
    name: 'Alta de proveedor',
    description: 'Prueba',
    case_type: category.name,
    case_subtype: category.types[1].name,
    status: 'draft',
    requirements_schema: {
      categoryCode: category.code,
      typeCode: category.types[1].code,
      folio: 'EXP-2026-001',
      tagIds: [caseTags[0].id, caseTags.at(-1).id],
    },
  };
  const draft = parseStoredCaseTemplate(stored);
  assert.equal(draft.categoryCode, category.code);
  assert.equal(draft.typeCode, category.types[1].code);
  assert.equal(draft.folio, 'EXP-2026-001');
  assert.deepEqual(draft.tagIds, stored.requirements_schema.tagIds);
});

test('classification is optional in a saved draft', () => {
  const stored = {
    id: 'unclassified',
    name: 'Expediente libre',
    description: '',
    case_type: 'Sin especificar',
    case_subtype: null,
    status: 'draft',
    requirements_schema: {
      categoryCode: '',
      typeCode: '',
      tagIds: [],
    },
  };
  const draft = parseStoredCaseTemplate(stored);
  assert.equal(draft.caseType, '');
  assert.equal(draft.caseSubtype, '');
  assert.deepEqual(draft.tagIds, []);
});

test('custom case classifications retain their assigned labels after the catalog entry is removed', () => {
  const tags = [
    { id: 'custom-tag', nombre: 'Integración regional', color: '#047857', group: 'Gestión' },
  ];
  const draft = parseStoredCaseTemplate({
    name: 'Expediente personal',
    case_type: 'Nueva categoría',
    case_subtype: 'Nuevo tipo',
    requirements_schema: {
      categoryCode: 'custom-category',
      typeCode: 'custom-type',
      tagIds: [tags[0].id, 'unrecognized-id'],
      catalogTags: tags,
    },
  });
  assert.equal(draft.categoryCode, 'custom-category');
  assert.equal(draft.typeCode, 'custom-type');
  assert.deepEqual(draft.tagIds, ['custom-tag']);
  assert.deepEqual(draft.catalogTags, tags);
});

test('older case types retain usable requirement rules', () => {
  const stored = {
    id: 'legacy',
    name: 'Alta de proveedor',
    description: '',
    case_type: 'Proveedor',
    case_subtype: null,
    status: 'active',
    requirements_schema: {
      version: 1,
      sections: [
        {
          id: 'section',
          title: 'Documentos',
          description: '',
          items: [
            {
              id: 'requirement',
              kind: 'new_document',
              title: 'Constancia fiscal',
              description: '',
              required: true,
              sourceId: null,
              sourceName: '',
              requiresReview: true,
            },
          ],
        },
      ],
    },
  };
  const draft = parseStoredCaseTemplate(stored);
  assert.equal(draft.personality, 'both');
  assert.deepEqual(draft.sections[0].items[0].allowedFormats, ['PDF', 'JPG', 'PNG']);
  assert.equal(draft.sections[0].items[0].maxSizeMb, 15);
  assert.equal(draft.sections[0].items[0].validityDays, null);
  assert.equal(draft.sections[0].items[0].customizableAtLaunch, true);

  draft.sections[0].items[0].allowedFormats = ['PDF'];
  draft.sections[0].items[0].maxSizeMb = 20;
  const mapped = toCaseTemplate({
    ...stored,
    requirements_schema: { version: 2, personality: draft.personality, sections: draft.sections },
  });
  assert.deepEqual(mapped.requirements[0].allowedFormats, ['PDF']);
  assert.equal(mapped.requirements[0].maxSizeMb, 20);
});

test('document rules, verifications and ordered stages survive the saved schema', () => {
  const draft = emptyCaseTemplate();
  const requirement = newCaseTemplateItem('new_document');
  requirement.title = 'Acta constitutiva';
  requirement.catalogId = 'articles-of-incorporation';
  requirement.conditional = true;
  requirement.required = false;
  requirement.condition = 'Si es persona moral';
  requirement.maxFiles = 3;
  draft.sections[0].items.push(requirement);
  const verification = newCaseTemplateVerification('email_otp');
  draft.verifications.push(verification);
  draft.stages = [
    newCaseTemplateStage('opening'),
    newCaseTemplateStage('documents'),
    newCaseTemplateStage('closing'),
  ];
  const stored = {
    id: 'configured',
    name: 'Alta de proveedor',
    description: '',
    case_type: 'Proveedor',
    case_subtype: null,
    status: 'draft',
    requirements_schema: {
      version: 3,
      personality: draft.personality,
      sections: draft.sections,
      verifications: draft.verifications,
      stages: draft.stages,
    },
  };
  const restored = parseStoredCaseTemplate(stored);
  assert.equal(restored.workflowMode, 'custom');
  assert.equal(restored.sections[0].items[0].condition, 'Si es persona moral');
  assert.equal(restored.sections[0].items[0].maxFiles, 3);
  assert.equal(restored.verifications[0].title, verification.title);
  assert.deepEqual(
    restored.stages.map((stage) => stage.title),
    ['Apertura', 'Carga documental', 'Cierre']
  );
  const preview = toCaseTemplate(stored);
  assert.equal(preview.identityMethods[0], verification.title);
  assert.deepEqual(
    preview.milestones.map((stage) => stage.title),
    ['Apertura', 'Carga documental', 'Cierre']
  );
});

test('expediente experience, deadlines and design survive a saved draft', () => {
  const draft = emptyCaseTemplate();
  draft.name = 'Expediente de proveedor';
  draft.experience = {
    ...draft.experience,
    signAtClosure: true,
    expireSections: true,
    expireElements: true,
    signatureDueDays: 30,
  };
  draft.appearance = {
    ...draft.appearance,
    accentColor: '#123ABC',
    headerText: 'Integración de proveedor',
    showFooter: true,
    footerText: 'Uso interno',
  };
  draft.sections[0].dueInDays = 10;
  const requirement = newCaseTemplateItem('new_document');
  requirement.title = 'Identificación';
  requirement.dueInDays = 7;
  draft.sections[0].items.push(requirement);
  const verification = newCaseTemplateVerification('email_otp');
  verification.dueInDays = 5;
  draft.verifications.push(verification);
  const stored = {
    id: 'experience',
    name: draft.name,
    description: '',
    case_type: 'Proveedor',
    case_subtype: null,
    status: 'draft',
    requirements_schema: {
      sections: draft.sections,
      verifications: draft.verifications,
      stages: draft.stages,
      experience: draft.experience,
      appearance: draft.appearance,
    },
  };
  const restored = parseStoredCaseTemplate(stored);
  assert.equal(restored.experience.signatureDueDays, 30);
  assert.equal(restored.sections[0].dueInDays, 10);
  assert.equal(restored.sections[0].items[0].dueInDays, 7);
  assert.equal(restored.verifications[0].dueInDays, 5);
  assert.equal(restored.appearance.accentColor, '#123ABC');
  assert.equal(restored.appearance.footerText, 'Uso interno');
  assert.deepEqual(toCaseTemplate(stored).closureRuleLabels, ['Firma de cierre del expediente']);
});
