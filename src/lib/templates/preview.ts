import {
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';

export type PublishedTemplateDocument = {
  id: string;
  nombre: string;
  descripcion?: string | null;
  estado?: string | null;
  estado_plantilla?: string | null;
  version_publicada?: string | null;
  source_template_id?: string | null;
  root_template_id?: string | null;
  updated_at: string;
  contenido_html?: string | null;
  campos_insertados?: unknown[];
  hoja_tamano?: string | null;
  hoja_orientacion?: 'vertical' | 'horizontal' | null;
  margenes?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  } | null;
  tipo_documento?: { id: string; nombre: string } | null;
};

export type TemplatePreviewSnapshot = {
  pages: string[];
  headerHtml: string;
  footerHtml: string;
};

export type TemplateRenderedFieldMeasurement = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const TEMPLATE_PAGE_SIZES: Record<string, { width: number; height: number }> = {
  'Carta (Letter)': { width: 816, height: 1056 },
  'Oficio (Legal)': { width: 816, height: 1344 },
  A4: { width: 794, height: 1123 },
  A3: { width: 1123, height: 1587 },
  A5: { width: 559, height: 794 },
  Tabloide: { width: 1056, height: 1632 },
};

const TEMPLATE_FONT_STYLESHEET_URL =
  'https://fonts.googleapis.com/css2?family=Google+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Roboto&family=Open+Sans&family=Lato&family=Montserrat&family=Raleway&family=Nunito&family=Poppins&family=Source+Sans+3&family=Merriweather&family=Playfair+Display&family=Oswald&family=PT+Sans&family=PT+Serif&family=Ubuntu&family=Noto+Sans&family=Libre+Baskerville&family=Crimson+Text&family=EB+Garamond&family=Josefin+Sans&family=Quicksand&family=Mulish&family=Barlow&family=Inter&family=DM+Sans&family=Fira+Sans&family=Cabin&family=Exo+2&family=Titillium+Web&family=Zilla+Slab&family=Spectral&family=Cormorant+Garamond&family=Alegreya&family=Lora&family=Arvo&family=Bitter&family=Karla&family=Rubik&family=Work+Sans&family=Manrope&family=Space+Grotesk&family=Plus+Jakarta+Sans&family=Sora&family=Outfit&family=Figtree&family=Lexend&family=Jost&family=Urbanist&family=Archivo&family=Asap&family=Heebo&family=Hind&family=Varela+Round&family=Comfortaa&family=Pacifico&family=Dancing+Script&family=Caveat&family=Sacramento&family=Great+Vibes&family=Satisfy&family=Kaushan+Script&family=Lobster&family=Righteous&family=Fredoka+One&family=Boogaloo&family=Indie+Flower&family=Patrick+Hand&family=Shadows+Into+Light&family=Amatic+SC&family=Permanent+Marker&family=Rock+Salt&family=Special+Elite&family=Courier+Prime&family=Source+Code+Pro&family=Fira+Code&family=Space+Mono&family=Inconsolata&family=Anonymous+Pro&family=Share+Tech+Mono&display=swap';

const TEMPLATE_PREVIEW_CSS = `
  *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111827;font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,sans-serif}
  .template-preview-page{display:grid;overflow:hidden;background:#fff}
  .template-preview-content{min-height:0;overflow:hidden;font-size:11pt;line-height:1.6;overflow-wrap:break-word;word-break:break-word}
  .template-preview-content h1{font-size:28px;font-weight:700;line-height:1.25;margin:16px 0 8px}.template-preview-content h2{font-size:22px;font-weight:600;line-height:1.3;margin:14px 0 8px}.template-preview-content h3{font-size:18px;font-weight:600;line-height:1.35;margin:12px 0 6px}.template-preview-content h4{font-size:16px;font-weight:600;line-height:1.4;margin:10px 0 6px}.template-preview-content h5{font-size:14px;font-weight:600;line-height:1.4;margin:8px 0 4px}
  .template-preview-content p{font-size:12px;line-height:1.5;margin:0 0 8px}.template-preview-content ul{list-style-type:disc;padding-left:2em;margin:8px 0}.template-preview-content ol{list-style-type:decimal;padding-left:2em;margin:8px 0}.template-preview-content li{display:list-item;margin:2px 0}.template-preview-content table{border-collapse:collapse;width:100%;margin:8px 0}.template-preview-content td,.template-preview-content th{border:1px solid #d1d5db;padding:6px 8px;min-width:40px;vertical-align:top}.template-preview-content img{max-width:100%;height:auto}
  .template-preview-zone{font-size:10pt;color:#374151;overflow:hidden}.template-preview-zone p{margin:0}
  [data-signature-resize-handle],.docubox-resize-handle,script,noscript,object,embed,form{display:none!important}
`;

const PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'";

function safeMargin(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.min(Math.max(value as number, 0), 10) : fallback;
}

function safeFileName(value: string) {
  const normalized = Array.from(value.trim())
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-');
  return `${normalized || 'Plantilla'}.pdf`;
}

export function getTemplatePageDimensions(template: PublishedTemplateDocument) {
  const baseSize =
    TEMPLATE_PAGE_SIZES[template.hoja_tamano || 'Carta (Letter)'] ||
    TEMPLATE_PAGE_SIZES['Carta (Letter)'];
  const landscape = template.hoja_orientacion === 'horizontal';
  return {
    width: landscape ? baseSize.height : baseSize.width,
    height: landscape ? baseSize.width : baseSize.height,
  };
}

export function splitTemplateHtml(html: string): TemplatePreviewSnapshot {
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = parsed.body.firstElementChild as HTMLElement | null;
  if (!root) return { pages: ['<p><br></p>'], headerHtml: '', footerHtml: '' };

  root
    .querySelectorAll(
      'script,noscript,object,embed,form,[data-signature-resize-handle],.docubox-resize-handle'
    )
    .forEach((element) => element.remove());
  const header = root.querySelector('[data-header-zone="true"]');
  const footer = root.querySelector('[data-footer-zone="true"]');
  const headerHtml = header?.innerHTML || '';
  const footerHtml = footer?.innerHTML || '';
  header?.remove();
  footer?.remove();

  const pages: string[] = [];
  let currentPage: Node[] = [];
  Array.from(root.childNodes).forEach((node) => {
    if (node instanceof HTMLElement && node.hasAttribute('data-docubox-page-break')) {
      const page = parsed.createElement('div');
      currentPage.forEach((item) => page.appendChild(item.cloneNode(true)));
      pages.push(page.innerHTML || '<p><br></p>');
      currentPage = [];
      return;
    }
    currentPage.push(node);
  });
  const lastPage = parsed.createElement('div');
  currentPage.forEach((item) => lastPage.appendChild(item.cloneNode(true)));
  if (lastPage.innerHTML || pages.length === 0) pages.push(lastPage.innerHTML || '<p><br></p>');

  return { pages, headerHtml, footerHtml };
}

function resolveZoneHtml(html: string, pageIndex: number) {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = parsed.body.firstElementChild as HTMLElement | null;
  if (!root) return html;
  root.querySelectorAll('[data-page-number="true"]').forEach((element) => {
    const pageNumber = element as HTMLElement;
    const startFrom = Number(pageNumber.getAttribute('data-page-number-start') || 1);
    pageNumber.textContent = `- ${startFrom + pageIndex} -`;
    pageNumber.style.removeProperty('display');
  });
  root.querySelectorAll('[data-hide-first-page="true"]').forEach((element) => {
    (element as HTMLElement).style.display = pageIndex === 0 ? 'none' : '';
  });
  return root.innerHTML;
}

function buildTemplatePageMarkup(
  template: PublishedTemplateDocument,
  pageHtml: string,
  headerHtml: string,
  footerHtml: string,
  pageIndex: number
) {
  const { width, height } = getTemplatePageDimensions(template);
  const top = safeMargin(template.margenes?.top, 2.54);
  const bottom = safeMargin(template.margenes?.bottom, 2.54);
  const left = safeMargin(template.margenes?.left, 3.17);
  const right = safeMargin(template.margenes?.right, 3.17);

  return `<section class="template-preview-page" style="width:${width}px;height:${height}px;grid-template-rows:${top}cm minmax(0,1fr) ${bottom}cm"><div class="template-preview-zone" style="padding:4px ${right}cm 4px ${left}cm;display:flex;align-items:flex-end">${resolveZoneHtml(headerHtml, pageIndex)}</div><div class="template-preview-content" style="padding:0 ${right}cm 0 ${left}cm">${pageHtml}</div><div class="template-preview-zone" style="padding:4px ${right}cm 4px ${left}cm;display:flex;align-items:flex-start">${resolveZoneHtml(footerHtml, pageIndex)}</div></section>`;
}

export function buildTemplatePagePreviewDocument(
  template: PublishedTemplateDocument,
  pageIndex = 0
) {
  const snapshot = splitTemplateHtml(template.contenido_html || '');
  return buildTemplatePagePreviewDocumentFromSnapshot(template, snapshot, pageIndex);
}

export function buildTemplatePagePreviewDocumentFromSnapshot(
  template: PublishedTemplateDocument,
  snapshot: TemplatePreviewSnapshot,
  pageIndex = 0
) {
  const safePageIndex = Math.min(Math.max(pageIndex, 0), Math.max(snapshot.pages.length - 1, 0));
  const markup = buildTemplatePageMarkup(
    template,
    snapshot.pages[safePageIndex] || '<p><br></p>',
    snapshot.headerHtml,
    snapshot.footerHtml,
    safePageIndex
  );
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><link rel="stylesheet" href="${TEMPLATE_FONT_STYLESHEET_URL}"><style>${TEMPLATE_PREVIEW_CSS}</style></head><body>${markup}</body></html>`;
}

export function getTemplatePageCount(template: PublishedTemplateDocument) {
  const fieldPageCount = Array.isArray(template.campos_insertados)
    ? template.campos_insertados.reduce<number>((highestPage, rawField) => {
        if (!rawField || typeof rawField !== 'object') return highestPage;
        const pageIndex = (rawField as { pageIndex?: unknown }).pageIndex;
        return typeof pageIndex === 'number' && Number.isFinite(pageIndex)
          ? Math.max(highestPage, Math.max(0, pageIndex) + 1)
          : highestPage;
      }, 1)
    : 1;
  if (typeof DOMParser === 'undefined') return fieldPageCount;
  const serializedPageCount = splitTemplateHtml(template.contenido_html || '').pages.length;
  return Math.max(serializedPageCount, fieldPageCount);
}

async function waitForFrame(frame: HTMLIFrameElement, srcDoc: string) {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('No fue posible preparar la plantilla.')),
      10_000
    );
    frame.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    frame.srcdoc = srcDoc;
  });
  const frameDocument = frame.contentDocument;
  if (!frameDocument) throw new Error('No fue posible preparar la plantilla.');
  await frameDocument.fonts?.ready;
  await Promise.all(
    Array.from(frameDocument.images).map(async (image) => {
      if (image.complete) return;
      await new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    })
  );
  return frameDocument;
}

type TemplatePdfFontFamily = {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
};

type TemplatePdfFonts = {
  serif: TemplatePdfFontFamily;
  sans: TemplatePdfFontFamily;
  mono: TemplatePdfFontFamily;
};

function parseCssColor(value: string, makeRgb: (red: number, green: number, blue: number) => RGB) {
  const match = value.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i
  );
  if (!match) return makeRgb(0.07, 0.09, 0.13);
  return makeRgb(
    Math.min(255, Number(match[1])) / 255,
    Math.min(255, Number(match[2])) / 255,
    Math.min(255, Number(match[3])) / 255
  );
}

function selectTemplatePdfFont(style: CSSStyleDeclaration, fonts: TemplatePdfFonts) {
  const family = style.fontFamily.toLowerCase();
  const group = /courier|mono|consolas/.test(family)
    ? fonts.mono
    : /times|serif|georgia|merriweather|baskerville|garamond|lora|bitter|slab/.test(family)
      ? fonts.serif
      : fonts.sans;
  const numericWeight = Number.parseInt(style.fontWeight, 10);
  const bold = Number.isFinite(numericWeight)
    ? numericWeight >= 600
    : /bold|bolder/.test(style.fontWeight);
  const italic = /italic|oblique/.test(style.fontStyle);
  if (bold && italic) return group.boldItalic;
  if (bold) return group.bold;
  if (italic) return group.italic;
  return group.regular;
}

function makePdfSafeText(value: string, font: PDFFont) {
  const replacements: Record<string, string> = {
    '\u00a0': ' ',
    '\u2010': '-',
    '\u2011': '-',
    '\u2012': '-',
    '\u2013': '-',
    '\u2014': '-',
    '\u2022': '*',
    '\u2026': '...',
  };
  let result = '';
  for (const character of value.normalize('NFC')) {
    const candidate = replacements[character] ?? character;
    try {
      font.encodeText(candidate);
      result += candidate;
    } catch {
      result += '?';
    }
  }
  return result;
}

function transformPdfText(value: string, style: CSSStyleDeclaration) {
  if (style.textTransform === 'uppercase') return value.toLocaleUpperCase('es-MX');
  if (style.textTransform === 'lowercase') return value.toLocaleLowerCase('es-MX');
  if (style.textTransform === 'capitalize') {
    return value.replace(
      /(^|\s)(\S)/g,
      (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase('es-MX')}`
    );
  }
  return value;
}

function drawTemplateVectorText({
  page,
  pageElement,
  fonts,
  makeRgb,
}: {
  page: PDFPage;
  pageElement: HTMLElement;
  fonts: TemplatePdfFonts;
  makeRgb: (red: number, green: number, blue: number) => RGB;
}) {
  const frameDocument = pageElement.ownerDocument;
  const frameWindow = frameDocument.defaultView;
  if (!frameWindow) return;
  const pageRect = pageElement.getBoundingClientRect();
  const { height: pdfHeight } = page.getSize();
  const pointScale = 0.75;
  const walker = frameDocument.createTreeWalker(pageElement, frameWindow.NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();

  while (current) {
    const textNode = current as Text;
    const parent = textNode.parentElement;
    const text = textNode.data;
    if (!parent || !text.trim()) {
      current = walker.nextNode();
      continue;
    }
    const style = frameWindow.getComputedStyle(parent);
    const opacity = Number.parseFloat(style.opacity || '1');
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      opacity <= 0 ||
      Number.parseFloat(style.fontSize || '0') <= 0
    ) {
      current = walker.nextNode();
      continue;
    }

    const font = selectTemplatePdfFont(style, fonts);
    const fontSize = Math.max(1, Number.parseFloat(style.fontSize) * pointScale);
    const color = parseCssColor(style.color, makeRgb);
    const tokenPattern = /[^\S\r\n]*\S+[^\S\r\n]*/g;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(text))) {
      const range = frameDocument.createRange();
      range.setStart(textNode, match.index);
      range.setEnd(textNode, match.index + match[0].length);
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0
      );
      if (rects.length === 0) continue;

      const drawRun = (run: string, rect: DOMRect) => {
        const transformed = transformPdfText(run, style);
        const safeText = makePdfSafeText(transformed, font);
        if (!safeText) return;
        const x = (rect.left - pageRect.left) * pointScale;
        const y =
          pdfHeight - (rect.bottom - pageRect.top) * pointScale + Math.max(0.7, fontSize * 0.18);
        const browserWidth = rect.width * pointScale;
        const pdfWidth = font.widthOfTextAtSize(safeText, fontSize);
        const horizontalScale =
          pdfWidth > browserWidth && browserWidth > 0
            ? Math.max(1, Math.min(100, ((browserWidth - 0.2) / pdfWidth) * 100))
            : 100;
        page.pushOperators(pushGraphicsState(), setCharacterSqueeze(horizontalScale));
        page.drawText(safeText, {
          x,
          y,
          size: fontSize,
          font,
          color,
          opacity: Math.min(1, opacity),
        });
        page.pushOperators(popGraphicsState());
        if (style.textDecorationLine.includes('underline')) {
          page.drawLine({
            start: { x, y: y - Math.max(0.6, fontSize * 0.08) },
            end: { x: x + rect.width * pointScale, y: y - Math.max(0.6, fontSize * 0.08) },
            thickness: Math.max(0.35, fontSize * 0.045),
            color,
            opacity: Math.min(1, opacity),
          });
        }
      };

      if (rects.length === 1) {
        drawRun(match[0], rects[0]);
        continue;
      }

      let runStart = match.index;
      let runTop: number | null = null;
      for (let offset = 0; offset < match[0].length; offset += 1) {
        const characterIndex = match.index + offset;
        const characterRange = frameDocument.createRange();
        characterRange.setStart(textNode, characterIndex);
        characterRange.setEnd(textNode, characterIndex + 1);
        const characterRect = characterRange.getBoundingClientRect();
        if (runTop !== null && Math.abs(characterRect.top - runTop) >= 1) {
          const runRange = frameDocument.createRange();
          runRange.setStart(textNode, runStart);
          runRange.setEnd(textNode, characterIndex);
          drawRun(text.slice(runStart, characterIndex), runRange.getBoundingClientRect());
          runStart = characterIndex;
        }
        runTop = characterRect.top;
      }
      if (runStart < match.index + match[0].length) {
        const runRange = frameDocument.createRange();
        runRange.setStart(textNode, runStart);
        runRange.setEnd(textNode, match.index + match[0].length);
        drawRun(
          text.slice(runStart, match.index + match[0].length),
          runRange.getBoundingClientRect()
        );
      }
    }
    current = walker.nextNode();
  }
}

type PreviewTextBoundary = { node: Text; offset: number };

function collectPreviewTextBoundaries(root: HTMLElement): PreviewTextBoundary[] {
  const boundaries: PreviewTextBoundary[] = [];
  const doc = root.ownerDocument;
  const showText = doc.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(root, showText);
  let current = walker.nextNode();

  while (current) {
    const textNode = current as Text;
    const parent = textNode.parentElement;
    const isAtomic = parent?.closest(
      'table, figure, [contenteditable="false"], [data-field-id], [data-docubox-page-break]'
    );
    if (!isAtomic) {
      for (let offset = 1; offset <= textNode.data.length; offset += 1) {
        if (offset === textNode.data.length || /\s/.test(textNode.data[offset - 1])) {
          boundaries.push({ node: textNode, offset });
        }
      }
    }
    current = walker.nextNode();
  }

  return boundaries;
}

function clonePreviewElementRange(
  source: HTMLElement,
  boundary: PreviewTextBoundary,
  part: 'before' | 'after'
) {
  const range = source.ownerDocument.createRange();
  range.selectNodeContents(source);
  if (part === 'before') range.setEnd(boundary.node, boundary.offset);
  else range.setStart(boundary.node, boundary.offset);
  const clone = source.cloneNode(false) as HTMLElement;
  clone.removeAttribute('id');
  clone.appendChild(range.cloneContents());
  return clone;
}

function splitPreviewNodeToFit(
  source: Node,
  fits: (candidate: Node) => boolean
): { before: Node; after: Node } | null {
  if (source.nodeType === 3) {
    const ownerDocument = source.ownerDocument || document;
    const value = source.textContent || '';
    const boundaries = Array.from(
      { length: Math.max(0, value.length - 1) },
      (_, index) => index + 1
    ).filter((offset) => /\s/.test(value[offset - 1]));
    if (boundaries.length === 0 && value.length > 1) {
      boundaries.push(...Array.from({ length: value.length - 1 }, (_, index) => index + 1));
    }
    let low = 0;
    let high = boundaries.length - 1;
    let best = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = ownerDocument.createTextNode(value.slice(0, boundaries[middle]));
      if (fits(candidate)) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best < 0) return null;
    const offset = boundaries[best];
    return {
      before: ownerDocument.createTextNode(value.slice(0, offset)),
      after: ownerDocument.createTextNode(value.slice(offset)),
    };
  }

  if (source.nodeType !== 1) return null;
  const element = source as HTMLElement;
  if (element.matches('table, figure')) return null;
  const boundaries = collectPreviewTextBoundaries(element);
  if (boundaries.length < 2) return null;
  let low = 0;
  let high = boundaries.length - 2;
  let best = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = clonePreviewElementRange(element, boundaries[middle], 'before');
    if (fits(candidate)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (best < 0) return null;
  return {
    before: clonePreviewElementRange(element, boundaries[best], 'before'),
    after: clonePreviewElementRange(element, boundaries[best], 'after'),
  };
}

export async function resolveTemplatePreviewSnapshot(
  template: PublishedTemplateDocument
): Promise<TemplatePreviewSnapshot> {
  const serialized = splitTemplateHtml(template.contenido_html || '');
  if (serialized.pages.length > 1 || !template.contenido_html?.trim()) return serialized;

  const { width, height } = getTemplatePageDimensions(template);
  const top = safeMargin(template.margenes?.top, 2.54);
  const bottom = safeMargin(template.margenes?.bottom, 2.54);
  const left = safeMargin(template.margenes?.left, 3.17);
  const right = safeMargin(template.margenes?.right, 3.17);
  const cmToPx = (value: number) => (value * 96) / 2.54;
  const contentWidth = Math.max(1, width - cmToPx(left + right));
  const contentHeight = Math.max(1, height - cmToPx(top + bottom));
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><link rel="stylesheet" href="${TEMPLATE_FONT_STYLESHEET_URL}"><style>${TEMPLATE_PREVIEW_CSS}</style></head><body><div id="template-pagination-measure" class="template-preview-content" style="width:${contentWidth}px;min-height:0;height:auto;overflow:hidden">${serialized.pages[0]}</div></body></html>`;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${contentWidth}px`,
    height: `${contentHeight}px`,
    border: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(frame);

  try {
    const frameDocument = await waitForFrame(frame, srcDoc);
    const measureRoot = frameDocument.getElementById('template-pagination-measure');
    if (!measureRoot) return serialized;
    const pendingNodes = Array.from(measureRoot.childNodes).map((node) => node.cloneNode(true));
    measureRoot.innerHTML = '';
    const pageGroups: Node[][] = [];
    let currentGroup: Node[] = [];
    const measureNodes = (nodes: Node[]) => {
      measureRoot.innerHTML = '';
      nodes.forEach((node) => measureRoot.appendChild(node.cloneNode(true)));
      return measureRoot.scrollHeight;
    };

    while (pendingNodes.length > 0) {
      const node = pendingNodes.shift();
      if (!node) continue;
      if (measureNodes([...currentGroup, node]) <= contentHeight) {
        currentGroup.push(node.cloneNode(true));
        continue;
      }
      const split = splitPreviewNodeToFit(node, (candidate) => {
        return measureNodes([...currentGroup, candidate]) <= contentHeight;
      });
      if (split) {
        currentGroup.push(split.before);
        pageGroups.push(currentGroup);
        currentGroup = [];
        pendingNodes.unshift(split.after);
        continue;
      }
      if (currentGroup.length > 0) {
        pageGroups.push(currentGroup);
        currentGroup = [];
        pendingNodes.unshift(node);
        continue;
      }
      pageGroups.push([node.cloneNode(true)]);
    }
    if (currentGroup.length > 0) pageGroups.push(currentGroup);

    const pages = pageGroups.map((nodes) => {
      const container = frameDocument.createElement('div');
      nodes.forEach((node) => container.appendChild(node.cloneNode(true)));
      return container.innerHTML || '<p><br></p>';
    });
    return pages.length > 0 ? { ...serialized, pages } : serialized;
  } finally {
    frame.remove();
  }
}

export async function createPdfFromPublishedTemplate(
  template: PublishedTemplateDocument,
  options: {
    onFieldsMeasured?: (fields: TemplateRenderedFieldMeasurement[]) => void;
  } = {}
) {
  if (!template.contenido_html?.trim()) {
    throw new Error('Esta plantilla no contiene un documento utilizable.');
  }

  const { width, height } = getTemplatePageDimensions(template);
  const snapshot = await resolveTemplatePreviewSnapshot(template);
  const pagesMarkup = snapshot.pages
    .map((pageHtml, index) =>
      buildTemplatePageMarkup(template, pageHtml, snapshot.headerHtml, snapshot.footerHtml, index)
    )
    .join('');
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><link rel="stylesheet" href="${TEMPLATE_FONT_STYLESHEET_URL}"><style>${TEMPLATE_PREVIEW_CSS}</style></head><body>${pagesMarkup}</body></html>`;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    border: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(frame);

  try {
    const frameDocument = await waitForFrame(frame, srcDoc);
    const pageElements = Array.from(
      frameDocument.querySelectorAll<HTMLElement>('.template-preview-page')
    );
    if (pageElements.length === 0) throw new Error('La plantilla no contiene paginas utilizables.');
    if (options.onFieldsMeasured) {
      const measurements = pageElements.flatMap((pageElement, pageIndex) => {
        const pageRect = pageElement.getBoundingClientRect();
        if (pageRect.width <= 0 || pageRect.height <= 0) return [];
        return Array.from(pageElement.querySelectorAll<HTMLElement>('[data-field-id]')).flatMap(
          (field) => {
            const id = field.dataset.fieldId || '';
            if (!id) return [];
            const rect = field.getBoundingClientRect();
            return [
              {
                id,
                page: pageIndex + 1,
                x: ((rect.left - pageRect.left) / pageRect.width) * 100,
                y: ((rect.top - pageRect.top) / pageRect.height) * 100,
                width: (rect.width / pageRect.width) * 100,
                height: (rect.height / pageRect.height) * 100,
              },
            ];
          }
        );
      });
      options.onFieldsMeasured(measurements);
    }
    const [{ default: html2canvas }, { PDFDocument, StandardFonts, rgb }] = await Promise.all([
      import('html2canvas'),
      import('pdf-lib'),
    ]);
    const pdf = await PDFDocument.create();
    const fonts: TemplatePdfFonts = {
      serif: {
        regular: await pdf.embedFont(StandardFonts.TimesRoman),
        bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
        italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
        boldItalic: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
      },
      sans: {
        regular: await pdf.embedFont(StandardFonts.Helvetica),
        bold: await pdf.embedFont(StandardFonts.HelveticaBold),
        italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
        boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
      },
      mono: {
        regular: await pdf.embedFont(StandardFonts.Courier),
        bold: await pdf.embedFont(StandardFonts.CourierBold),
        italic: await pdf.embedFont(StandardFonts.CourierOblique),
        boldItalic: await pdf.embedFont(StandardFonts.CourierBoldOblique),
      },
    };
    const pdfWidth = width * 0.75;
    const pdfHeight = height * 0.75;
    for (const pageElement of pageElements) {
      const canvas = await html2canvas(pageElement, {
        backgroundColor: '#ffffff',
        logging: false,
        scale: 2,
        useCORS: false,
        windowWidth: width,
        windowHeight: height,
        onclone: (_clonedDocument, clonedPage) => {
          clonedPage.querySelectorAll<HTMLElement>('*').forEach((element) => {
            const hasDirectText = Array.from(element.childNodes).some(
              (node) => node.nodeType === 3 && Boolean(node.textContent?.trim())
            );
            if (!hasDirectText) return;
            element.style.setProperty('color', 'transparent', 'important');
            element.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
            element.style.setProperty('text-shadow', 'none', 'important');
            element.style.setProperty('text-decoration-color', 'transparent', 'important');
          });
        },
      });
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error('No fue posible generar la pagina.')),
          'image/png'
        );
      });
      const image = await pdf.embedPng(await blob.arrayBuffer());
      const page = pdf.addPage([pdfWidth, pdfHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pdfWidth, height: pdfHeight });
      drawTemplateVectorText({ page, pageElement, fonts, makeRgb: rgb });
    }
    const bytes = await pdf.save();
    const fileBuffer = new Uint8Array(bytes.byteLength);
    fileBuffer.set(bytes);
    return new File([fileBuffer.buffer], safeFileName(template.nombre), {
      type: 'application/pdf',
    });
  } finally {
    frame.remove();
  }
}
