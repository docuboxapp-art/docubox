import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [signingSource, autographSource, efirmaSource, clickSignSource, migrationSource] =
  await Promise.all([
    readFile(new URL('../src/app/firmar-documento/[id]/page.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/app/mi-perfil/components/AutografaStampSelector.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../src/app/mi-perfil/components/EfirmaStampSelector.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../src/app/mi-perfil/components/ClickSignStampSelector.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL(
        '../supabase/migrations/20260922174500_signature_save_prompt_preference.sql',
        import.meta.url
      ),
      'utf8'
    ),
  ]);

test('signing flow offers a persisted save-prompt preference and compact actions', () => {
  assert.match(signingSource, /signature_save_prompt_dismissed/);
  assert.match(signingSource, /No volver a preguntarme en este perfil/);
  assert.match(signingSource, /className="inline-flex h-9 min-w-\[112px\]/);
  assert.match(migrationSource, /signature_save_prompt_dismissed BOOLEAN NOT NULL DEFAULT FALSE/);
});

test('signing flow opens the real stamp selector for every signature method', () => {
  assert.match(signingSource, /Cambiar estampa/);
  assert.match(signingSource, /Puedes cambiar cómo se verá/);
  assert.match(signingSource, /activeStampMethod === 'autografa'/);
  assert.match(signingSource, /activeStampMethod === 'efirma'/);
  assert.match(signingSource, /ClickSignStampSelector/);
  assert.match(signingSource, /signature_stamp_style: myRole === 'firmante' \? selectedStampStyle/);

  for (const selectorSource of [autographSource, efirmaSource, clickSignSource]) {
    assert.match(selectorSource, /initiallyOpen\?: boolean/);
    assert.match(selectorSource, /showSummary\?: boolean/);
    assert.match(selectorSource, /onCancel\?: \(\) => void/);
    assert.match(selectorSource, /useState\(initiallyOpen\)/);
  }
});

test('document previews render the selected stamp inside signature fields', async () => {
  const templateSource = await readFile(
    new URL('../src/components/templates/TemplateDocumentPreview.tsx', import.meta.url),
    'utf8'
  );

  assert.match(
    signingSource,
    /stampDisplayProps=\{[\s\S]*?field\.tipo === 'firma' && firmaData[\s\S]*?previewStampProps/
  );
  assert.match(
    signingSource,
    /signatureStamp=\{[\s\S]*?firmaData \? <FittedSignatureStamp \{\.\.\.previewStampProps\}/
  );
  assert.match(
    signingSource,
    /signatureStamp=\{[\s\S]*?displayFirmaData\s*\?\s*\(?\s*<FittedSignatureStamp \{\.\.\.completedStampProps\}/
  );
  assert.match(
    signingSource,
    /const scale = Math\.min\([\s\S]*?container\.clientWidth \/ width,[\s\S]*?container\.clientHeight \/ height/
  );
  assert.match(templateSource, /onFieldsMeasured=\{signatureStamp \? handleFieldsMeasured/);
  assert.match(templateSource, /signatureFieldIds\?\.includes\(field\.id\)/);
});
