import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

test('Docubox visual PDF embeds subset fonts with Unicode maps', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'docubox-pdf-fonts-'));
  const bundle = path.join(directory, 'font-test.cjs');
  try {
    await build({
      stdin: {
        contents: `
          import { PDFDocument } from 'pdf-lib';
          import { embedDocuboxPdfFonts } from './src/lib/pdf/embedded-fonts';
          import { assertPdfFontsEmbedded } from './src/lib/pdf/font-audit';
          export async function run() {
            const pdf = await PDFDocument.create();
            const page = pdf.addPage([612, 792]);
            const { regular, bold, mono } = await embedDocuboxPdfFonts(pdf);
            page.drawText('Docubox: información íntegra, año 2026, México.', { x: 40, y: 720, font: regular });
            page.drawText('Firma PAdES-B-T verificada', { x: 40, y: 690, font: bold });
            page.drawText('SHA-256=ABCDEF0123456789', { x: 40, y: 660, font: mono });
            const bytes = await pdf.save({ useObjectStreams: false });
            return { bytes, fonts: await assertPdfFontsEmbedded(bytes) };
          }
        `,
        resolveDir: process.cwd(),
        sourcefile: 'pdf-font-test-entry.ts',
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: bundle,
      logLevel: 'silent',
    });
    const result = await createRequire(import.meta.url)(bundle).run();
    assert.ok(result.bytes.length > 0);
    assert.equal(result.fonts.length, 3);
    for (const font of result.fonts) {
      assert.equal(font.embedded, true, `${font.name} must be embedded`);
      assert.equal(font.subset, true, `${font.name} must be subset`);
      assert.equal(font.unicode, true, `${font.name} must include ToUnicode`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
