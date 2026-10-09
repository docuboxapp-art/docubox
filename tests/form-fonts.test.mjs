import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const fontkit = require('@pdf-lib/fontkit');
const { PDFDocument, StandardFonts } = require('pdf-lib');

test('las opciones de fuentes del formulario coinciden con las de plantillas', () => {
  const names = (file, pattern) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    return source.match(pattern)?.[1].match(/'[^']+'/g)?.map((name) => name.slice(1, -1));
  };
  const templateFonts = names('../src/app/plantillas/nueva/page.tsx', /const EDITOR_FONT_FAMILIES = \[([\s\S]*?)\];/);
  const formFonts = names('../src/lib/typography/font-families.ts', /export const TEMPLATE_FONT_FAMILIES = \[([\s\S]*?)\] as const/);
  assert.deepEqual(formFonts, templateFonts);
});

test('el generador PDF incrusta la tipografía seleccionada', async () => {
  const source = readFileSync(new URL('../supabase/functions/generate-form-pdf/index.ts', import.meta.url), 'utf8');
  const functionSource = source.slice(source.indexOf('async function embedFormFonts'), source.indexOf('function stringifyAnswer'));
  const compiled = ts.transpileModule(functionSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const fontBytes = readFileSync(new URL('../infra/pdf/fonts/Inter-Regular.woff', import.meta.url));
  const fakeFetch = async (url) => new Response(
    String(url).includes('fonts.googleapis.com')
      ? "@font-face { font-weight: 400; src: url(https://fonts.gstatic.com/inter.ttf) format('truetype'); }"
      : fontBytes
  );
  const embedFormFonts = Function(
    'StandardFonts', 'fontkit', 'fetch', 'AbortSignal', 'URL',
    `${compiled}\nreturn embedFormFonts;`
  )(StandardFonts, fontkit, fakeFetch, AbortSignal, URL);

  const pdf = await PDFDocument.create();
  const { regular } = await embedFormFonts(pdf, 'Inter');
  assert.match(regular.name, /Inter/);
  pdf.addPage().drawText('Prueba de fuente', { x: 30, y: 700, font: regular });
  assert.ok((await pdf.save()).length > 1000);
});
