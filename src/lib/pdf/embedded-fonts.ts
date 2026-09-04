import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PDFDocument, PDFFont } from 'pdf-lib';

export type DocuboxPdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
};

const FONT_FILES = {
  regular: 'Inter-Regular.woff',
  bold: 'Inter-Bold.woff',
  mono: 'RobotoMono-Regular.woff',
} as const;

let fontBytesPromise: Promise<Record<keyof typeof FONT_FILES, Uint8Array>> | null = null;

function loadFontBytes() {
  if (!fontBytesPromise) {
    const fontDirectory = path.join(process.cwd(), 'infra', 'pdf', 'fonts');
    fontBytesPromise = Promise.all(
      Object.entries(FONT_FILES).map(async ([name, file]) => [
        name,
        new Uint8Array(await readFile(path.join(fontDirectory, file))),
      ])
    ).then((entries) => Object.fromEntries(entries) as Record<keyof typeof FONT_FILES, Uint8Array>);
  }
  return fontBytesPromise;
}

export async function embedDocuboxPdfFonts(pdf: PDFDocument): Promise<DocuboxPdfFonts> {
  pdf.registerFontkit(fontkit);
  const bytes = await loadFontBytes();
  const [regular, bold, mono] = await Promise.all([
    pdf.embedFont(bytes.regular, { subset: true, customName: 'DBXREG+Inter-Regular' }),
    pdf.embedFont(bytes.bold, { subset: true, customName: 'DBXBOL+Inter-Bold' }),
    pdf.embedFont(bytes.mono, { subset: true, customName: 'DBXMON+RobotoMono-Regular' }),
  ]);
  return { regular, bold, mono };
}
