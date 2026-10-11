import type { ReportField, ReportRow } from './catalog';
import { displayValue } from './engine';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filename(name: string, extension: string) {
  return `${name.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'informe'}.${extension}`;
}
function xml(value: unknown) { return [...String(value ?? '')].map(char => { const code = char.charCodeAt(0); return code < 32 && ![9, 10, 13].includes(code) ? ' ' : char; }).join('').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] || char)); }
function columns(fields: ReportField[], rows: ReportRow[]) { return rows.map(row => fields.map(field => row[field.id])); }

export async function exportReport(name: string, fields: ReportField[], rows: ReportRow[], format: 'csv' | 'json' | 'xlsx' | 'pdf') {
  if (format === 'json') {
    const payload = rows.map(row => Object.fromEntries(fields.map(field => [field.id, row[field.id] ?? null])));
    download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }), filename(name, 'json'));
    return;
  }
  if (format === 'csv') {
    const cell = (value: unknown) => { const text = String(value ?? ''); const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text; return `"${safe.replace(/"/g, '""')}"`; };
    const lines = [fields.map(field => cell(field.label)).join(','), ...columns(fields, rows).map(row => row.map(cell).join(','))];
    download(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), filename(name, 'csv'));
    return;
  }
  if (format === 'xlsx') {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const letters = (number: number) => { let text = ''; for (let n = number + 1; n; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text; return text; };
    const all = [fields.map(field => field.label), ...columns(fields, rows)];
    const sheet = all.map((row, index) => `<row r="${index + 1}">${row.map((value, col) => {
      const address = `${letters(col)}${index + 1}`;
      return typeof value === 'number' && Number.isFinite(value) ? `<c r="${address}"><v>${value}</v></c>`
        : `<c r="${address}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }).join('')}</row>`).join('');
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Informe" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`);
    download(await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename(name, 'xlsx'));
    return;
  }
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const safe = (value: string) => [...value].map(char => { const code = char.charCodeAt(0); return code < 32 || code >= 127 && code <= 159 ? ' ' : code > 255 ? '?' : char; }).join('');
  const wrap = (value: string, size: number) => {
    const lines: string[] = [];
    for (let index = 0; index < value.length; index += size) lines.push(value.slice(index, index + size));
    return lines.length ? lines : [''];
  };
  const width = 595, height = 842, margin = 40;
  let page = pdf.addPage([width, height]); let y = height - margin;
  const drawHeader = () => {
    page.drawText(safe(name).slice(0, 75), { x: margin, y, size: 16, font: bold, color: rgb(0.05, 0.12, 0.25) }); y -= 22;
    page.drawText(`${rows.length} registros · ${new Date().toLocaleDateString('es-MX')}`, { x: margin, y, size: 9, font, color: rgb(0.4, 0.46, 0.57) }); y -= 27;
  };
  drawHeader();
  rows.forEach((row, index) => {
    if (y < margin + 45) { page = pdf.addPage([width, height]); y = height - margin; drawHeader(); }
    page.drawText(`Registro ${index + 1}`, { x: margin, y, size: 10, font: bold, color: rgb(0.1, 0.35, 0.8) }); y -= 19;
    fields.forEach(field => {
      const lines = wrap(safe(displayValue(row[field.id], field.type)), 67);
      const labels = wrap(safe(field.label), 25);
      for (let lineIndex = 0; lineIndex < Math.max(lines.length, labels.length); lineIndex++) {
        if (y < margin + 12) { page = pdf.addPage([width, height]); y = height - margin; drawHeader(); }
        if (labels[lineIndex]) page.drawText(labels[lineIndex], { x: margin, y, size: 8.5, font: bold, color: rgb(0.3, 0.36, 0.45) });
        if (lines[lineIndex]) page.drawText(lines[lineIndex], { x: margin + 155, y, size: 8.5, font, color: rgb(0.12, 0.17, 0.25) });
        y -= 12;
      }
      y -= 6;
    });
    page.drawLine({ start: { x: margin, y: y + 2 }, end: { x: width - margin, y: y + 2 }, thickness: 0.5, color: rgb(0.85, 0.88, 0.92) });
    y -= 17;
  });
  download(new Blob([Uint8Array.from(await pdf.save())], { type: 'application/pdf' }), filename(name, 'pdf'));
}
