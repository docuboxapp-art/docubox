export type CollaborationReportRow = { metric: string; value: number };
export type CollaborationReportFormat = 'csv' | 'pdf' | 'xlsx';
const xml = (value: string) =>
  Array.from(value)
    .filter((char) => {
      const n = char.codePointAt(0) || 0;
      return (
        n === 9 ||
        n === 10 ||
        n === 13 ||
        (n >= 32 && n <= 0xd7ff) ||
        (n >= 0xe000 && n <= 0xfffd) ||
        (n >= 0x10000 && n <= 0x10ffff)
      );
    })
    .join('')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export async function exportCollaborationReport(
  rows: CollaborationReportRow[],
  format: CollaborationReportFormat,
  generatedAt: string,
  level: 'basic' | 'advanced'
) {
  if (rows.some((row) => !Number.isFinite(row.value))) throw new Error('Invalid report value');
  if (format === 'csv') {
    const cell = (value: string) =>
      `"${(/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
    return {
      bytes: new TextEncoder().encode(
        '\uFEFF' +
          ['Indicador,Valor', ...rows.map((row) => `${cell(row.metric)},${row.value}`)].join('\r\n')
      ),
      contentType: 'text/csv; charset=utf-8',
    };
  }
  if (format === 'xlsx') {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    );
    zip.file(
      '_rels/.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    );
    zip.file(
      'xl/workbook.xml',
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Colabora" sheetId="1" r:id="rId1"/></sheets></workbook>'
    );
    zip.file(
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    );
    const strings = (index: number, a: string, b: string) =>
      `<row r="${index}"><c r="A${index}" t="inlineStr"><is><t xml:space="preserve">${xml(a)}</t></is></c><c r="B${index}" t="inlineStr"><is><t>${xml(b)}</t></is></c></row>`;
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="44" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/></cols><sheetData>${strings(1, 'Docubox Colabora', level === 'advanced' ? 'Analítica avanzada' : 'Reporte básico')}${strings(2, 'Generado (UTC)', generatedAt)}${strings(3, 'Indicador', 'Valor')}${rows.map((row, index) => `<row r="${index + 4}"><c r="A${index + 4}" t="inlineStr"><is><t>${xml(row.metric)}</t></is></c><c r="B${index + 4}"><v>${row.value}</v></c></row>`).join('')}</sheetData><autoFilter ref="A3:B${rows.length + 3}"/></worksheet>`
    );
    return {
      bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const color = rgb(0.08, 0.13, 0.23),
    muted = rgb(0.38, 0.45, 0.55),
    blue = rgb(0.14, 0.36, 1);
  const drawText = (
    page: ReturnType<typeof pdf.addPage>,
    text: string,
    x: number,
    y: number,
    size = 10,
    strong = false
  ) => page.drawText(text, { x, y, size, font: strong ? bold : font, color });
  const pages = Math.max(1, Math.ceil(rows.length / 19));
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 40, y: 780, width: 32, height: 4, color: blue });
    drawText(page, 'Docubox', 40, 747, 22, true);
    drawText(page, 'Reporte colaborativo', 40, 716, 17, true);
    page.drawText(level === 'advanced' ? 'ANALÍTICA AVANZADA' : 'REPORTE BÁSICO', {
      x: 40,
      y: 691,
      size: 9,
      font: bold,
      color: muted,
    });
    page.drawText(`Generado (UTC): ${generatedAt.slice(0, 19).replace('T', ' ')}`, {
      x: 40,
      y: 665,
      size: 9,
      font,
      color: muted,
    });
    page.drawRectangle({ x: 40, y: 610, width: 515, height: 30, color: rgb(0.94, 0.96, 0.99) });
    drawText(page, 'Indicador', 52, 621, 10, true);
    drawText(page, 'Valor', 490, 621, 10, true);
    for (const [i, row] of rows.slice(p * 19, (p + 1) * 19).entries()) {
      const y = 587 - i * 25;
      drawText(page, row.metric, 52, y);
      const value = String(row.value);
      drawText(page, value, 530 - font.widthOfTextAtSize(value, 10), y);
      page.drawLine({
        start: { x: 40, y: y - 10 },
        end: { x: 555, y: y - 10 },
        thickness: 0.5,
        color: rgb(0.89, 0.91, 0.94),
      });
    }
    page.drawText('Indicadores limitados a los recursos autorizados en la organización.', {
      x: 40,
      y: 71,
      size: 8,
      font,
      color: muted,
    });
    page.drawText(`Docubox Colabora  |  ${p + 1} / ${pages}`, {
      x: 40,
      y: 50,
      size: 8,
      font,
      color: muted,
    });
  }
  pdf.setTitle('Docubox Colabora - Reporte operativo');
  pdf.setCreator('Docubox');
  return { bytes: await pdf.save(), contentType: 'application/pdf' };
}
