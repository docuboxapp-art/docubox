import { createHash } from 'crypto';
import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type {
  ImportedTemplateField,
  TemplateDocxImportResult,
  TemplateDocxImportStats,
} from '../types';

const MAX_ZIP_ENTRIES = 2048;
const MAX_UNCOMPRESSED_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_XML_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 18 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_BYTES = 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_HTML_BYTES = Math.floor(3.5 * 1024 * 1024);
const IMPORT_TTL_MS = 30 * 60 * 1000;

const XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  processEntities: false,
} as const;

type XmlNode = Record<string, unknown>;
type XmlNodes = XmlNode[];

type TextMarks = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontFamily?: string;
  fontSizePt?: number;
  color?: string;
  href?: string;
};

type NormalizedInline =
  | ({ kind: 'text'; text: string } & TextMarks)
  | { kind: 'lineBreak' }
  | { kind: 'pageBreak' }
  | { kind: 'image'; src: string; alt: string; width?: number; height?: number }
  | { kind: 'field'; field: ImportedTemplateField };

type ParagraphBlock = {
  kind: 'paragraph' | 'heading';
  level?: number;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indentPt?: number;
  list?: { ordered: boolean; level: number };
  inlines: NormalizedInline[];
};

type TableBlock = {
  kind: 'table';
  rows: Array<Array<ParagraphBlock[]>>;
};

type NormalizedBlock = ParagraphBlock | TableBlock;

type Relationship = {
  target: string;
  external: boolean;
  type: string;
};

type ImageAsset = {
  src: string;
  alt: string;
};

type ParseContext = {
  relationships: Map<string, Relationship>;
  images: Map<string, ImageAsset>;
  numbering: Map<string, Map<number, boolean>>;
  styles: Map<string, number>;
  fields: ImportedTemplateField[];
  stats: TemplateDocxImportStats;
  warnings: Set<string>;
  importKey: string;
  pageIndex: number;
};

export class TemplateDocxImportError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function tagName(node: XmlNode) {
  return Object.keys(node).find((key) => key !== ':@' && key !== '#text') || '';
}

function children(node: XmlNode): XmlNodes {
  const value = node[tagName(node)];
  return Array.isArray(value) ? (value as XmlNodes) : [];
}

function attributes(node: XmlNode) {
  const value = node[':@'];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function attribute(node: XmlNode | undefined, ...names: string[]) {
  if (!node) return undefined;
  const attrs = attributes(node);
  for (const name of names) {
    const value = attrs[name];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return undefined;
}

function direct(nodes: XmlNodes, name: string) {
  return nodes.filter((node) => tagName(node) === name);
}

function first(nodes: XmlNodes, name: string) {
  return nodes.find((node) => tagName(node) === name);
}

function descendants(nodes: XmlNodes, name: string, result: XmlNode[] = []) {
  for (const node of nodes) {
    if (tagName(node) === name) result.push(node);
    descendants(children(node), name, result);
  }
  return result;
}

function textContent(nodes: XmlNodes): string {
  let output = '';
  for (const node of nodes) {
    const value = node['#text'];
    if (typeof value === 'string' || typeof value === 'number') output += String(value);
    output += textContent(children(node));
  }
  return output;
}

function parseXml(xml: string, filename: string): XmlNodes {
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) {
    throw new TemplateDocxImportError(
      413,
      'FILE_TOO_LARGE',
      `${filename} excede el límite de procesamiento.`
    );
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new TemplateDocxImportError(
      422,
      'CORRUPTED_DOCX',
      `El archivo contiene XML inválido en ${filename}.`
    );
  }
  try {
    const parsed = new XMLParser(XML_OPTIONS).parse(xml);
    return Array.isArray(parsed) ? (parsed as XmlNodes) : [];
  } catch {
    throw new TemplateDocxImportError(
      422,
      'DOCX_PARSE_FAILED',
      `No fue posible interpretar ${filename}.`
    );
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeHref(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function safeFont(value?: string) {
  if (!value || !/^[\p{L}\p{N} .,'-]{1,80}$/u.test(value)) return undefined;
  return value;
}

function normalizeZipPath(baseFile: string, target: string) {
  const cleanTarget = target.replace(/\\/g, '/').split('#')[0];
  if (!cleanTarget || cleanTarget.startsWith('/') || /^[A-Za-z]:/.test(cleanTarget)) return null;
  const output = baseFile.split('/').slice(0, -1);
  for (const part of cleanTarget.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (output.length === 0) return null;
      output.pop();
    } else {
      output.push(part);
    }
  }
  return output.join('/');
}

function mimeForImage(path: string) {
  const extension = path.toLowerCase().split('.').pop();
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  }[extension || ''];
}

function valueEnabled(node?: XmlNode) {
  if (!node) return false;
  const value = attribute(node, 'w:val', 'val');
  return value === undefined || !['0', 'false', 'off', 'none'].includes(value.toLowerCase());
}

function runMarks(run: XmlNode, href?: string): TextMarks {
  const properties = first(children(run), 'w:rPr');
  const propertyNodes = properties ? children(properties) : [];
  const sizeValue = Number(attribute(first(propertyNodes, 'w:sz'), 'w:val', 'val')) / 2;
  const fontNode = first(propertyNodes, 'w:rFonts');
  const color = attribute(first(propertyNodes, 'w:color'), 'w:val', 'val');
  return {
    bold: valueEnabled(first(propertyNodes, 'w:b')),
    italic: valueEnabled(first(propertyNodes, 'w:i')),
    underline: valueEnabled(first(propertyNodes, 'w:u')),
    strike: valueEnabled(first(propertyNodes, 'w:strike')),
    fontFamily: safeFont(attribute(fontNode, 'w:ascii', 'w:hAnsi', 'ascii', 'hAnsi')),
    fontSizePt:
      Number.isFinite(sizeValue) && sizeValue >= 6 && sizeValue <= 72 ? sizeValue : undefined,
    color: color && /^[0-9A-Fa-f]{6}$/.test(color) ? `#${color}` : undefined,
    href,
  };
}

function parseRelationships(xml: string | null, filename: string) {
  const relationships = new Map<string, Relationship>();
  if (!xml) return relationships;
  const nodes = parseXml(xml, filename);
  for (const relation of descendants(nodes, 'Relationship')) {
    const id = attribute(relation, 'Id');
    const target = attribute(relation, 'Target');
    if (!id || !target) continue;
    relationships.set(id, {
      target,
      external: attribute(relation, 'TargetMode') === 'External',
      type: attribute(relation, 'Type') || '',
    });
  }
  return relationships;
}

function parseStyleHeadings(xml: string | null) {
  const styles = new Map<string, number>();
  if (!xml) return styles;
  const nodes = parseXml(xml, 'word/styles.xml');
  for (const style of descendants(nodes, 'w:style')) {
    if (attribute(style, 'w:type', 'type') !== 'paragraph') continue;
    const id = attribute(style, 'w:styleId', 'styleId');
    if (!id) continue;
    const name = attribute(first(children(style), 'w:name'), 'w:val', 'val') || id;
    const match = `${id} ${name}`.match(/(?:heading|t[ií]tulo)\s*([1-6])/i);
    if (match) styles.set(id, Number(match[1]));
    else if (/(?:title|t[ií]tulo)$/i.test(name)) styles.set(id, 1);
  }
  return styles;
}

function parseNumbering(xml: string | null) {
  const output = new Map<string, Map<number, boolean>>();
  if (!xml) return output;
  const nodes = parseXml(xml, 'word/numbering.xml');
  const abstract = new Map<string, Map<number, boolean>>();
  for (const abstractNode of descendants(nodes, 'w:abstractNum')) {
    const id = attribute(abstractNode, 'w:abstractNumId', 'abstractNumId');
    if (!id) continue;
    const levels = new Map<number, boolean>();
    for (const level of direct(children(abstractNode), 'w:lvl')) {
      const index = Number(attribute(level, 'w:ilvl', 'ilvl') || 0);
      const format = attribute(first(children(level), 'w:numFmt'), 'w:val', 'val') || 'bullet';
      levels.set(index, format !== 'bullet' && format !== 'none');
    }
    abstract.set(id, levels);
  }
  for (const number of descendants(nodes, 'w:num')) {
    const id = attribute(number, 'w:numId', 'numId');
    const abstractId = attribute(first(children(number), 'w:abstractNumId'), 'w:val', 'val');
    if (id && abstractId && abstract.has(abstractId)) output.set(id, abstract.get(abstractId)!);
  }
  return output;
}

async function loadImageAssets(
  zip: JSZip,
  baseFile: string,
  relationships: Map<string, Relationship>,
  warnings: Set<string>,
  imageBudget: { used: number }
) {
  const images = new Map<string, ImageAsset>();
  for (const [id, relation] of relationships) {
    if (!relation.type.endsWith('/image')) continue;
    if (relation.external) {
      warnings.add('EXTERNAL_IMAGE_IGNORED');
      continue;
    }
    const path = normalizeZipPath(baseFile, relation.target);
    const mime = path ? mimeForImage(path) : undefined;
    const entry = path ? zip.file(path) : null;
    if (!path || !mime || !entry) {
      warnings.add('UNSUPPORTED_IMAGE_IGNORED');
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await entry.async('uint8array');
    } catch {
      throw new TemplateDocxImportError(
        422,
        'ASSET_EXTRACTION_FAILED',
        'No fue posible extraer una imagen del documento Word.'
      );
    }
    if (
      bytes.byteLength > MAX_EMBEDDED_IMAGE_BYTES ||
      imageBudget.used + bytes.byteLength > MAX_TOTAL_IMAGE_BYTES
    ) {
      warnings.add('IMAGE_SIZE_LIMIT_REACHED');
      continue;
    }
    imageBudget.used += bytes.byteLength;
    images.set(id, {
      src: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
      alt: path.split('/').pop() || 'imagen importada',
    });
  }
  return images;
}

function parseDrawing(node: XmlNode, context: ParseContext): NormalizedInline[] {
  const blip = descendants([node], 'a:blip')[0];
  const imageData = descendants([node], 'v:imagedata')[0];
  const relationId = attribute(blip, 'r:embed', 'embed') || attribute(imageData, 'r:id', 'id');
  if (!relationId) return [];
  const asset = context.images.get(relationId);
  if (!asset) return [];
  const extent = descendants([node], 'wp:extent')[0];
  const width = Math.round(Number(attribute(extent, 'cx') || 0) / 9525);
  const height = Math.round(Number(attribute(extent, 'cy') || 0) / 9525);
  const properties = descendants([node], 'wp:docPr')[0];
  context.stats.images += 1;
  return [
    {
      kind: 'image',
      src: asset.src,
      alt: attribute(properties, 'descr', 'title', 'name') || asset.alt,
      width: width > 0 ? Math.min(width, 700) : undefined,
      height: height > 0 ? height : undefined,
    },
  ];
}

function parseRun(run: XmlNode, context: ParseContext, href?: string) {
  const marks = runMarks(run, href);
  const output: NormalizedInline[] = [];
  for (const node of children(run)) {
    const name = tagName(node);
    if (name === 'w:t' || name === 'w:instrText') {
      output.push({ kind: 'text', text: textContent(children(node)), ...marks });
    } else if (name === 'w:tab') {
      output.push({ kind: 'text', text: '\t', ...marks });
    } else if (name === 'w:br') {
      if (attribute(node, 'w:type', 'type') === 'page') output.push({ kind: 'pageBreak' });
      else output.push({ kind: 'lineBreak' });
    } else if (name === 'w:lastRenderedPageBreak') {
      output.push({ kind: 'pageBreak' });
    } else if (name === 'w:drawing' || name === 'w:pict') {
      output.push(...parseDrawing(node, context));
    }
  }
  return output;
}

function parseParagraphInlines(paragraph: XmlNode, context: ParseContext) {
  const output: NormalizedInline[] = [];
  const visit = (nodes: XmlNodes, href?: string) => {
    for (const node of nodes) {
      const name = tagName(node);
      if (name === 'w:r') {
        output.push(...parseRun(node, context, href));
      } else if (name === 'w:hyperlink') {
        const relation = context.relationships.get(attribute(node, 'r:id', 'id') || '');
        const anchor = attribute(node, 'w:anchor', 'anchor');
        const link = relation?.external
          ? safeHref(relation.target)
          : anchor
            ? `#${anchor}`
            : undefined;
        if (relation?.external && !link) context.warnings.add('UNSAFE_LINK_REMOVED');
        visit(children(node), link);
      } else if (name !== 'w:pPr') {
        visit(children(node), href);
      }
    }
  };
  visit(children(paragraph));
  return output;
}

function makeField(context: ParseContext, label: string) {
  const index = context.fields.length + 1;
  const field: ImportedTemplateField = {
    id: `field-import-${context.importKey.slice(0, 10)}-${index}`,
    valueKey: `imported:${label.trim().toLocaleLowerCase('es-MX')}`,
    label,
    fieldType: 'text',
    customName: label,
    showLabelInDocument: false,
    options: [],
    pageIndex: context.pageIndex,
    scope: 'general',
    required: false,
    assignedParticipantId: null,
  };
  context.fields.push(field);
  context.stats.variables += 1;
  return field;
}

function splitVariables(inlines: NormalizedInline[], context: ParseContext) {
  const output: NormalizedInline[] = [];
  let textGroup: Array<Extract<NormalizedInline, { kind: 'text' }>> = [];

  const flush = () => {
    if (textGroup.length === 0) return;
    const combined = textGroup.map((item) => item.text).join('');
    const offsets: number[] = [];
    let position = 0;
    for (const item of textGroup) {
      offsets.push(position);
      position += item.text.length;
    }
    const appendRange = (start: number, end: number) => {
      for (let index = 0; index < textGroup.length; index += 1) {
        const item = textGroup[index];
        const itemStart = offsets[index];
        const itemEnd = itemStart + item.text.length;
        const overlapStart = Math.max(start, itemStart);
        const overlapEnd = Math.min(end, itemEnd);
        if (overlapStart < overlapEnd) {
          output.push({
            ...item,
            text: item.text.slice(overlapStart - itemStart, overlapEnd - itemStart),
          });
        }
      }
    };

    const variablePattern = /\{\{\s*([\p{L}_][\p{L}\p{N}_]{0,63})\s*\}\}/gu;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = variablePattern.exec(combined))) {
      appendRange(cursor, match.index);
      output.push({ kind: 'field', field: makeField(context, match[1]) });
      cursor = match.index + match[0].length;
    }
    appendRange(cursor, combined.length);
    textGroup = [];
  };

  for (const inline of inlines) {
    if (inline.kind === 'text') textGroup.push(inline);
    else {
      flush();
      output.push(inline);
      if (inline.kind === 'pageBreak') context.pageIndex += 1;
    }
  }
  flush();
  return output;
}

function parseParagraph(paragraph: XmlNode, context: ParseContext): ParagraphBlock {
  const properties = first(children(paragraph), 'w:pPr');
  const propertyNodes = properties ? children(properties) : [];
  const styleId = attribute(first(propertyNodes, 'w:pStyle'), 'w:val', 'val');
  const headingLevel = styleId ? context.styles.get(styleId) : undefined;
  const alignmentValue = attribute(first(propertyNodes, 'w:jc'), 'w:val', 'val');
  const alignment = ['left', 'center', 'right', 'both', 'justify'].includes(alignmentValue || '')
    ? ((alignmentValue === 'both' ? 'justify' : alignmentValue) as ParagraphBlock['alignment'])
    : undefined;
  const indentTwips = Number(attribute(first(propertyNodes, 'w:ind'), 'w:left', 'left') || 0);
  const numProperties = first(propertyNodes, 'w:numPr');
  const numId = attribute(
    first(numProperties ? children(numProperties) : [], 'w:numId'),
    'w:val',
    'val'
  );
  const listLevel = Number(
    attribute(first(numProperties ? children(numProperties) : [], 'w:ilvl'), 'w:val', 'val') || 0
  );
  const list = numId
    ? { ordered: context.numbering.get(numId)?.get(listLevel) ?? false, level: listLevel }
    : undefined;
  const block: ParagraphBlock = {
    kind: headingLevel ? 'heading' : 'paragraph',
    level: headingLevel,
    alignment,
    indentPt: indentTwips > 0 ? Math.min(indentTwips / 20, 144) : undefined,
    list,
    inlines: splitVariables(parseParagraphInlines(paragraph, context), context),
  };
  context.stats.paragraphs += 1;
  if (headingLevel) context.stats.headings += 1;
  if (list) context.stats.lists += 1;
  context.stats.pageBreaks += block.inlines.filter((inline) => inline.kind === 'pageBreak').length;
  return block;
}

function parseTable(table: XmlNode, context: ParseContext): TableBlock {
  const rows = direct(children(table), 'w:tr').map((row) =>
    direct(children(row), 'w:tc').map((cell) =>
      direct(children(cell), 'w:p').map((paragraph) => parseParagraph(paragraph, context))
    )
  );
  context.stats.tables += 1;
  return { kind: 'table', rows };
}

function parseBlocks(nodes: XmlNodes, context: ParseContext) {
  const output: NormalizedBlock[] = [];
  for (const node of nodes) {
    const name = tagName(node);
    if (name === 'w:p') output.push(parseParagraph(node, context));
    else if (name === 'w:tbl') output.push(parseTable(node, context));
  }
  return output;
}

function renderText(inline: Extract<NormalizedInline, { kind: 'text' }>) {
  let content = escapeHtml(inline.text).replace(/\t/g, '&emsp;');
  if (!content) return '';
  if (inline.bold) content = `<strong>${content}</strong>`;
  if (inline.italic) content = `<em>${content}</em>`;
  if (inline.underline) content = `<u>${content}</u>`;
  if (inline.strike) content = `<s>${content}</s>`;
  const styles: string[] = [];
  if (inline.fontFamily) styles.push(`font-family:${escapeHtml(inline.fontFamily)}`);
  if (inline.fontSizePt) styles.push(`font-size:${inline.fontSizePt}pt`);
  if (inline.color) styles.push(`color:${inline.color}`);
  if (styles.length > 0) content = `<span style="${styles.join(';')}">${content}</span>`;
  if (inline.href) {
    content = `<a href="${escapeHtml(inline.href)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
  }
  return content;
}

function renderField(field: ImportedTemplateField) {
  return `<span contenteditable="false" data-field-id="${escapeHtml(field.id)}" data-field-value-key="${escapeHtml(field.valueKey)}" data-field-label="${escapeHtml(field.label)}" data-field-type="text" data-field-scope="general" style="display:inline;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:4px;padding:1px 7px;font-size:inherit;font-family:inherit;line-height:inherit;user-select:none;cursor:pointer;white-space:nowrap;" title="Clic para editar propiedades">{{${escapeHtml(field.label)}}}</span>`;
}

function renderInline(inline: NormalizedInline) {
  if (inline.kind === 'text') return renderText(inline);
  if (inline.kind === 'lineBreak') return '<br>';
  if (inline.kind === 'field') return renderField(inline.field);
  if (inline.kind === 'image') {
    const width = inline.width
      ? ` width="${inline.width}" style="width:${inline.width}px;height:auto;max-width:100%;display:block;margin:8px auto;"`
      : ' style="height:auto;max-width:100%;display:block;margin:8px auto;"';
    return `<img src="${inline.src}" alt="${escapeHtml(inline.alt)}" data-alignment="center"${width}>`;
  }
  return '';
}

function paragraphStyle(block: ParagraphBlock) {
  const styles: string[] = [];
  if (block.alignment) styles.push(`text-align:${block.alignment}`);
  if (block.indentPt) styles.push(`padding-left:${block.indentPt}pt`);
  return styles.length > 0 ? ` style="${styles.join(';')}"` : '';
}

function renderParagraphSegments(block: ParagraphBlock, insideList = false) {
  const segments: NormalizedInline[][] = [[]];
  for (const inline of block.inlines) {
    if (inline.kind === 'pageBreak') segments.push([]);
    else segments[segments.length - 1].push(inline);
  }
  const output: string[] = [];
  segments.forEach((segment, index) => {
    const content = segment.map(renderInline).join('') || '<br>';
    const tag = insideList ? 'span' : block.kind === 'heading' ? `h${block.level || 1}` : 'p';
    output.push(`<${tag}${paragraphStyle(block)}>${content}</${tag}>`);
    if (index < segments.length - 1) {
      output.push(
        '<div data-docubox-page-break="true" style="height:0;break-after:page;page-break-after:always;"></div>'
      );
    }
  });
  return output.join('');
}

function renderTable(block: TableBlock) {
  const rows = block.rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td style="border:1px solid #D1D5DB;padding:6px 8px;vertical-align:top;">${cell
                .map((paragraph) => renderParagraphSegments(paragraph))
                .join('')}</td>`
          )
          .join('')}</tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;margin:8px 0;">${rows}</table>`;
}

function renderBlocks(blocks: NormalizedBlock[]) {
  let html = '';
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.kind === 'table') {
      html += renderTable(block);
      continue;
    }
    if (!block.list) {
      html += renderParagraphSegments(block);
      continue;
    }
    const ordered = block.list.ordered;
    const level = block.list.level;
    const items: string[] = [];
    while (index < blocks.length) {
      const item = blocks[index];
      if (
        item.kind === 'table' ||
        !item.list ||
        item.list.ordered !== ordered ||
        item.list.level !== level
      )
        break;
      items.push(`<li>${renderParagraphSegments(item, true)}</li>`);
      index += 1;
    }
    index -= 1;
    const tag = ordered ? 'ol' : 'ul';
    html += `<${tag} style="padding-left:${Math.min(24 + level * 20, 100)}px;">${items.join('')}</${tag}>`;
  }
  return html || '<p><br></p>';
}

async function readXml(zip: JSZip, path: string, budget: { used: number }) {
  const entry = zip.file(path);
  if (!entry) return null;
  const xml = await entry.async('string');
  budget.used += Buffer.byteLength(xml, 'utf8');
  if (budget.used > MAX_TOTAL_XML_BYTES) {
    throw new TemplateDocxImportError(
      413,
      'FILE_TOO_LARGE',
      'El contenido XML del DOCX excede el límite permitido.'
    );
  }
  return xml;
}

function inspectUnsupportedContent(zip: JSZip, documentXml: string, warnings: Set<string>) {
  const names = Object.keys(zip.files).map((name) => name.toLowerCase());
  if (names.some((name) => name.includes('vbaproject.bin') || name.startsWith('word/activex/'))) {
    warnings.add('ACTIVE_CONTENT_IGNORED');
  }
  if (names.some((name) => name.startsWith('word/embeddings/')))
    warnings.add('EMBEDDED_OBJECT_IGNORED');
  if (names.some((name) => name.startsWith('word/diagrams/'))) warnings.add('DIAGRAM_SIMPLIFIED');
  if (/<(?:m:oMath|w:pict|w:object)\b/i.test(documentXml))
    warnings.add('UNSUPPORTED_CONTENT_SIMPLIFIED');
}

async function parsePart(
  zip: JSZip,
  path: string,
  xml: string,
  base: Omit<ParseContext, 'relationships' | 'images'>,
  xmlBudget: { used: number },
  imageBudget: { used: number }
) {
  const relationPath = `${path.slice(0, path.lastIndexOf('/'))}/_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;
  const relationshipXml = await readXml(zip, relationPath, xmlBudget);
  const relationships = parseRelationships(relationshipXml, relationPath);
  const images = await loadImageAssets(zip, path, relationships, base.warnings, imageBudget);
  const nodes = parseXml(xml, path);
  const root = descendants(
    nodes,
    path.includes('/header') ? 'w:hdr' : path.includes('/footer') ? 'w:ftr' : 'w:body'
  )[0];
  return parseBlocks(root ? children(root) : [], { ...base, relationships, images });
}

export function buildTemplateImportId(userId: string, workspaceId: string, bytes: Uint8Array) {
  const digest = createHash('sha256')
    .update('docubox:template-docx-import:v1\0')
    .update(userId)
    .update('\0')
    .update(workspaceId)
    .update('\0')
    .update(bytes)
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export async function parseTemplateDocx(input: {
  bytes: Uint8Array;
  filename: string;
  workspaceId: string;
  importId: string;
}): Promise<TemplateDocxImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input.bytes, { checkCRC32: false, createFolders: false });
  } catch {
    throw new TemplateDocxImportError(
      422,
      'INVALID_DOCX',
      'El archivo no es un DOCX válido o está dañado.'
    );
  }

  const entries = Object.values(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new TemplateDocxImportError(
      413,
      'FILE_TOO_LARGE',
      'El DOCX contiene demasiados elementos internos.'
    );
  }
  if (
    entries.some((entry) => {
      const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string })
        .unsafeOriginalName;
      return Boolean(
        original && (original.includes('..') || original.startsWith('/') || original.includes('\\'))
      );
    })
  ) {
    throw new TemplateDocxImportError(
      422,
      'INVALID_DOCX',
      'El paquete DOCX contiene rutas internas no permitidas.'
    );
  }

  let uncompressedBytes = 0;
  for (const entry of entries) {
    const internal = entry as JSZip.JSZipObject & {
      _data?: { uncompressedSize?: number };
    };
    const entryBytes = Number(internal._data?.uncompressedSize || 0);
    if (entryBytes > MAX_UNCOMPRESSED_ENTRY_BYTES) {
      throw new TemplateDocxImportError(
        413,
        'FILE_TOO_LARGE',
        'El DOCX contiene un elemento interno demasiado grande.'
      );
    }
    uncompressedBytes += entryBytes;
    if (uncompressedBytes > MAX_UNCOMPRESSED_PACKAGE_BYTES) {
      throw new TemplateDocxImportError(
        413,
        'FILE_TOO_LARGE',
        'El contenido descomprimido del DOCX excede el límite permitido.'
      );
    }
  }

  try {
    zip = await JSZip.loadAsync(input.bytes, { checkCRC32: true, createFolders: false });
  } catch {
    throw new TemplateDocxImportError(
      422,
      'CORRUPTED_DOCX',
      'El paquete DOCX no superó la verificación de integridad.'
    );
  }

  if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) {
    throw new TemplateDocxImportError(
      422,
      'INVALID_DOCX',
      'El archivo no contiene la estructura requerida de Microsoft Word.'
    );
  }

  const warnings = new Set<string>();
  const fields: ImportedTemplateField[] = [];
  const stats: TemplateDocxImportStats = {
    paragraphs: 0,
    headings: 0,
    lists: 0,
    tables: 0,
    images: 0,
    variables: 0,
    pageBreaks: 0,
  };
  const xmlBudget = { used: 0 };
  const imageBudget = { used: 0 };
  const contentTypesXml = await readXml(zip, '[Content_Types].xml', xmlBudget);
  if (!contentTypesXml) {
    throw new TemplateDocxImportError(
      422,
      'INVALID_DOCX',
      'El archivo no contiene la definición de tipos DOCX.'
    );
  }
  parseXml(contentTypesXml, '[Content_Types].xml');
  if (!contentTypesXml.includes('wordprocessingml.document')) {
    throw new TemplateDocxImportError(
      422,
      'INVALID_DOCX',
      'El paquete no corresponde a un documento Microsoft Word .docx.'
    );
  }
  const documentXml = await readXml(zip, 'word/document.xml', xmlBudget);
  if (!documentXml) {
    throw new TemplateDocxImportError(
      422,
      'INVALID_DOCX',
      'No se encontró el contenido principal del DOCX.'
    );
  }
  inspectUnsupportedContent(zip, documentXml, warnings);

  const styles = parseStyleHeadings(await readXml(zip, 'word/styles.xml', xmlBudget));
  const numbering = parseNumbering(await readXml(zip, 'word/numbering.xml', xmlBudget));
  const baseContext = {
    numbering,
    styles,
    fields,
    stats,
    warnings,
    importKey: input.importId.replace(/-/g, ''),
    pageIndex: 0,
  };
  const body = await parsePart(
    zip,
    'word/document.xml',
    documentXml,
    baseContext,
    xmlBudget,
    imageBudget
  );

  const headerBlocks: NormalizedBlock[] = [];
  const footerBlocks: NormalizedBlock[] = [];
  const partNames = Object.keys(zip.files)
    .filter((name) => /^word\/(header|footer)\d+\.xml$/i.test(name))
    .sort();
  for (const path of partNames) {
    const xml = await readXml(zip, path, xmlBudget);
    if (!xml) continue;
    const blocks = await parsePart(zip, path, xml, baseContext, xmlBudget, imageBudget);
    if (path.toLowerCase().includes('/header')) headerBlocks.push(...blocks);
    else footerBlocks.push(...blocks);
  }

  let contentHtml = renderBlocks(body);
  if (headerBlocks.length > 0) {
    contentHtml = `<header data-docubox-imported-header="true" style="border-bottom:1px solid #E5E7EB;margin-bottom:12px;padding-bottom:6px;font-size:0.85em;">${renderBlocks(headerBlocks)}</header>${contentHtml}`;
    warnings.add('HEADER_IMPORTED_AS_EDITABLE_CONTENT');
  }
  if (footerBlocks.length > 0) {
    contentHtml += `<footer data-docubox-imported-footer="true" style="border-top:1px solid #E5E7EB;margin-top:12px;padding-top:6px;font-size:0.85em;">${renderBlocks(footerBlocks)}</footer>`;
    warnings.add('FOOTER_IMPORTED_AS_EDITABLE_CONTENT');
  }
  if (Buffer.byteLength(contentHtml, 'utf8') > MAX_RESULT_HTML_BYTES) {
    throw new TemplateDocxImportError(
      413,
      'FILE_TOO_LARGE',
      'El contenido editable resultante es demasiado grande para abrirse de forma segura.'
    );
  }

  const now = new Date();
  const baseName =
    input.filename
      .replace(/\.docx$/i, '')
      .trim()
      .slice(0, 120) || 'Plantilla importada';
  return {
    importId: input.importId,
    workspaceId: input.workspaceId,
    originalFilename: input.filename.slice(0, 180),
    suggestedName: baseName,
    contentHtml,
    fields,
    warnings: [...warnings],
    stats,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + IMPORT_TTL_MS).toISOString(),
  };
}
