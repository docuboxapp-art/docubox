import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  compareTemplateVersions,
  selectLatestTemplateVersions,
} from '../src/lib/templates/versioning.ts';

const collectionApi = readFileSync('src/app/api/plantillas/route.ts', 'utf8');
const createDocumentUpload = readFileSync(
  'src/app/crear-documento/components/StepSubir.tsx',
  'utf8'
);
const gallery = readFileSync('src/app/plantillas/page.tsx', 'utf8');
const templateSelector = readFileSync(
  'src/app/crear-documento/components/TemplateSourceSelector.tsx',
  'utf8'
);

test('template versions are compared numerically', () => {
  assert.ok(compareTemplateVersions('1.10', '1.9') > 0);
  assert.ok(compareTemplateVersions('2.0', '1.99') > 0);
  assert.equal(compareTemplateVersions('1.1', '1.1.0'), 0);
});

test('latest template selection keeps one published row per version family', () => {
  const latest = selectLatestTemplateVersions([
    {
      id: 'root-a',
      version_publicada: '1.0',
      root_template_id: null,
      updated_at: '2026-09-01T00:00:00Z',
    },
    {
      id: 'version-a-1-9',
      version_publicada: '1.9',
      root_template_id: 'root-a',
      updated_at: '2026-09-02T00:00:00Z',
    },
    {
      id: 'version-a-1-10',
      version_publicada: '1.10',
      root_template_id: 'root-a',
      updated_at: '2026-09-03T00:00:00Z',
    },
    {
      id: 'root-b',
      version_publicada: '1.0',
      root_template_id: null,
      updated_at: '2026-09-04T00:00:00Z',
    },
  ]);

  assert.deepEqual(
    latest.map((template) => template.id),
    ['root-b', 'version-a-1-10']
  );
});

test('create document requests only the latest published version of each template family', () => {
  assert.match(collectionApi, /latest_only/);
  assert.match(collectionApi, /selectLatestTemplateVersions\(data \|\| \[\]\)/);
  assert.match(createDocumentUpload, /status=published&latest_only=true/);
});

test('template version is shown subtly in create document and the template gallery', () => {
  assert.match(createDocumentUpload, /v\$\{template\.version_publicada \|\| '1\.0'\}/);
  assert.match(gallery, /v\{plantilla\.version_publicada \|\| '1\.0'\}/);
  assert.match(gallery, /v\{template\.version_publicada \|\| '1\.0'\}/);
  assert.match(templateSelector, /v\{template\.version_publicada \|\| '1\.0'\}/);
  assert.match(gallery, /text-\[10px\] font-normal text-slate-400/);
});

test('create document favorites follow the template family across versions', () => {
  assert.match(createDocumentUpload, /getTemplateFamilyId\(template\)/);
  assert.match(templateSelector, /favoriteSet\.has\(getTemplateFamilyId\(template\)\)/);
});
