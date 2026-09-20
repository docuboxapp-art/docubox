import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const gallerySource = await readFile('src/app/plantillas/page.tsx', 'utf8');
const editorSource = await readFile('src/app/plantillas/nueva/page.tsx', 'utf8');
const previewSource = await readFile('src/lib/templates/preview.ts', 'utf8');

test('template gallery renders stored document content in its sheet preview', () => {
  assert.match(gallerySource, /contenido_html\?: string \| null/);
  assert.match(gallerySource, /buildTemplatePreviewDocument\(plantilla\)/);
  assert.match(gallerySource, /buildTemplatePagePreviewDocument/);
  assert.match(gallerySource, /srcDoc=\{previewDocument\}/);
  assert.match(gallerySource, /<TemplateDocumentPreview plantilla=\{plantilla\} \/>/);
});

test('template thumbnails isolate active content and preserve the empty fallback', () => {
  assert.match(gallerySource, /sandbox=""/);
  assert.match(previewSource, /Content-Security-Policy/);
  assert.match(previewSource, /default-src 'none'/);
  assert.match(gallerySource, /hasMeaningfulTemplateContent/);
  assert.match(gallerySource, /src="\/assets\/images\/docubox-logo-2026\.png"/);
});

test('template card hover exposes preview and edit actions', () => {
  const cardPreview = gallerySource.slice(
    gallerySource.indexOf('group-hover:pointer-events-auto'),
    gallerySource.indexOf('{/* Content */}')
  );

  assert.match(cardPreview, /onPreview\(plantilla\.id\)/);
  assert.match(cardPreview, />\s*Ver\s*</);
  assert.match(cardPreview, /onEdit\(plantilla\.id\)/);
  assert.match(cardPreview, /isArchived \? 'Reactivar' : 'Editar'/);
});

test('template gallery matches document toolbar proportions and renders stored descriptions', () => {
  const toolbar = gallerySource.slice(
    gallerySource.indexOf('placeholder="Buscar plantillas..."'),
    gallerySource.indexOf('{/* Grid / List */}')
  );

  assert.match(toolbar, /className="h-9 w-full/);
  assert.match(toolbar, /className="flex h-9 shrink-0/);
  assert.match(toolbar, /flex h-7 w-8 items-center/);
  assert.doesNotMatch(toolbar, /h-10/);
  assert.doesNotMatch(gallerySource, /Plantilla reutilizable de Docubox/);
  assert.match(gallerySource, /const description = getPlantillaDesc\(template\)\.trim\(\)/);
  assert.match(gallerySource, /\{description && \(/);
});

test('gallery preview mounts the editor paginator before capturing all pages', () => {
  assert.match(editorSource, /useState<1 \| 2 \| 3>\(previewRequested \? 2 : 1\)/);
  assert.match(
    editorSource,
    /const paginationFrame = requestAnimationFrame\(\(\) => \{[\s\S]*?previewFrame = requestAnimationFrame/
  );
  assert.match(
    editorSource,
    /livePages\.length >= serialized\.pages\.length[\s\S]*?\? livePages[\s\S]*?: serialized\.pages/
  );
});

test('closing a preview opened from the gallery returns to the gallery history entry', () => {
  assert.match(gallerySource, /preview=1&preview_origin=gallery/);
  assert.match(gallerySource, /\{\s*scroll: false,\s*\}/);
  assert.match(
    editorSource,
    /const previewOpenedFromGallery = searchParams\?\.get\('preview_origin'\) === 'gallery'/
  );
  assert.match(
    editorSource,
    /if \(previewRequested && previewOpenedFromGallery\) \{\s*router\.back\(\);\s*return;/
  );
  assert.match(editorSource, /onClick=\{handleClosePreview\}/);
});

test('published templates preserve the original and save changes as a new version', () => {
  assert.match(editorSource, /const isExistingPublishedTemplate = Boolean/);
  assert.match(
    editorSource,
    /const saveAction:[\s\S]*?isExistingPublishedTemplate[\s\S]*?\? 'version'[\s\S]*?: 'borrador'/
  );
  assert.match(editorSource, /isExistingPublishedTemplate[\s\S]*?'Crear nueva versión'/);
  assert.match(editorSource, /if \(saved\) router\.push\('\/plantillas'\)/);
});
