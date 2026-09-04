import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';

export type PdfFontAuditRow = {
  resource: string;
  name: string;
  type: string;
  embedded: boolean;
  subset: boolean;
  unicode: boolean;
};

const FONT_DESCRIPTOR = PDFName.of('FontDescriptor');

function nameOf(value: unknown) {
  return String(value || '').replace(/^\//, '');
}

function descriptorFor(pdf: PDFDocument, font: PDFDict) {
  const direct = font.lookupMaybe(FONT_DESCRIPTOR, PDFDict);
  if (direct) return direct;
  const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
  return descendants?.lookupMaybe(0, PDFDict)?.lookupMaybe(FONT_DESCRIPTOR, PDFDict) || null;
}

export async function auditPdfFonts(bytes: Uint8Array): Promise<PdfFontAuditRow[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const rows = new Map<string, PdfFontAuditRow>();

  for (const page of pdf.getPages()) {
    const resources = page.node.Resources();
    const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (!fonts) continue;

    for (const [resourceName, reference] of fonts.entries()) {
      const font = pdf.context.lookup(reference, PDFDict);
      const descriptor = descriptorFor(pdf, font);
      const name = nameOf(font.get(PDFName.of('BaseFont')));
      const type = nameOf(font.get(PDFName.of('Subtype')));
      const row = {
        resource: nameOf(resourceName),
        name,
        type,
        embedded: Boolean(
          descriptor &&
            ['FontFile', 'FontFile2', 'FontFile3'].some((key) => descriptor.has(PDFName.of(key)))
        ),
        subset: /^[A-Z]{6}\+/.test(name),
        unicode: font.has(PDFName.of('ToUnicode')),
      };
      rows.set(`${row.resource}:${row.name}`, row);
    }
  }

  return [...rows.values()];
}

export async function assertPdfFontsEmbedded(bytes: Uint8Array) {
  const fonts = await auditPdfFonts(bytes);
  if (fonts.length === 0 || fonts.some((font) => !font.embedded)) {
    throw new Error('PDF_FONT_NOT_EMBEDDED');
  }
  return fonts;
}
