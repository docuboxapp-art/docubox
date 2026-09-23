import type { PublishedTemplateDocument } from './preview';

export const TEMPLATE_DOCUMENT_MIME_TYPE = 'application/vnd.docubox.template+json';
export const TEMPLATE_DOCUMENT_KIND = 'docubox-template-document';

export type TemplateDocumentPayload = {
  kind: typeof TEMPLATE_DOCUMENT_KIND;
  schemaVersion: 1;
  createdAt: string;
  template: PublishedTemplateDocument;
};

export type TemplateFieldValues = Record<string, string | null | undefined>;

export function isTemplateDocumentMimeType(value: string | null | undefined) {
  return String(value || '').toLowerCase() === TEMPLATE_DOCUMENT_MIME_TYPE;
}

export function createTemplateDocumentPayload(
  template: PublishedTemplateDocument
): TemplateDocumentPayload {
  return {
    kind: TEMPLATE_DOCUMENT_KIND,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    template: JSON.parse(JSON.stringify(template)) as PublishedTemplateDocument,
  };
}

export function createTemplateDocumentFile(template: PublishedTemplateDocument) {
  const payload = createTemplateDocumentPayload(template);
  const safeName = (template.nombre || 'Plantilla')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  return new File([JSON.stringify(payload)], `${safeName}.docubox-template`, {
    type: TEMPLATE_DOCUMENT_MIME_TYPE,
  });
}

export function parseTemplateDocumentPayload(value: unknown): TemplateDocumentPayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TemplateDocumentPayload>;
  if (
    candidate.kind !== TEMPLATE_DOCUMENT_KIND ||
    candidate.schemaVersion !== 1 ||
    !candidate.template ||
    typeof candidate.template !== 'object' ||
    typeof candidate.template.id !== 'string' ||
    typeof candidate.template.nombre !== 'string'
  ) {
    return null;
  }
  return candidate as TemplateDocumentPayload;
}

export async function loadTemplateDocumentSource({
  documentId,
  fileType,
  fileUrl,
  headers,
}: {
  documentId: string;
  fileType?: string | null;
  fileUrl?: string | null;
  headers?: Record<string, string>;
}): Promise<PublishedTemplateDocument | null> {
  if (isTemplateDocumentMimeType(fileType) && fileUrl) {
    const response = await fetch(fileUrl, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers,
    });
    if (response.ok) {
      const payload = parseTemplateDocumentPayload(await response.json().catch(() => null));
      if (payload) return payload.template;
    }
  }

  const response = await fetch(
    `/api/documentos/${encodeURIComponent(documentId)}/template-source`,
    { cache: 'no-store', credentials: 'same-origin', headers }
  );
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.template && typeof payload.template === 'object' ? payload.template : null;
}

function setResolvedFieldAppearance(
  field: HTMLElement,
  fieldType: string,
  value: string,
  final: boolean
) {
  const originalTypography = {
    fontFamily: field.style.fontFamily,
    fontSize: field.style.fontSize,
    fontWeight: field.style.fontWeight,
    fontStyle: field.style.fontStyle,
    lineHeight: field.style.lineHeight,
    letterSpacing: field.style.letterSpacing,
    textDecoration: field.style.textDecoration,
  };
  const originalLayout = {
    direction: field.style.direction,
    margin: field.style.margin,
    marginBlock: field.style.marginBlock,
    marginInline: field.style.marginInline,
    textAlign: field.style.textAlign,
    textIndent: field.style.textIndent,
    verticalAlign: field.style.verticalAlign,
    wordSpacing: field.style.wordSpacing,
  };
  field.removeAttribute('title');
  field.removeAttribute('data-field-selected');
  field.setAttribute('contenteditable', 'false');
  field.style.background = 'transparent';
  field.style.border = '0';
  field.style.borderRadius = '0';
  field.style.boxShadow = 'none';
  field.style.color = 'inherit';
  field.style.cursor = 'default';
  field.style.outline = '0';
  field.style.padding = '0';
  field.style.userSelect = 'text';
  Object.assign(field.style, originalTypography, originalLayout);

  if (fieldType === 'signature') {
    field.innerHTML = '';
    field.style.display = 'inline-flex';
    field.style.verticalAlign = 'middle';
    if (!final && value.startsWith('data:image/')) {
      const image = field.ownerDocument.createElement('img');
      image.src = value;
      image.alt = 'Firma';
      image.style.width = '100%';
      image.style.height = '100%';
      image.style.objectFit = 'contain';
      field.appendChild(image);
    } else if (!final && value) {
      field.textContent = value;
    }
    return;
  }

  field.style.display = 'inline';
  field.style.height = 'auto';
  field.style.maxWidth = 'none';
  field.style.minHeight = '0';
  field.style.minWidth = '0';
  field.style.resize = 'none';
  field.style.whiteSpace = 'pre-wrap';
  field.style.width = 'auto';
  const previousText = field.previousSibling?.textContent || '';
  const nextText = field.nextSibling?.textContent || '';
  const needsLeadingSpace =
    Boolean(previousText) &&
    !/\s$/.test(previousText) &&
    !/[([{¿¡/]$/.test(previousText) &&
    !/^[,.;:!?%)\]}]/.test(value);
  const needsTrailingSpace =
    Boolean(nextText) &&
    !/^\s/.test(nextText) &&
    !/^[,.;:!?%)\]}]/.test(nextText) &&
    !/[([{¿¡/]$/.test(value);
  field.textContent = `${needsLeadingSpace ? ' ' : ''}${value}${needsTrailingSpace ? ' ' : ''}`;
}

export function applyTemplateFieldValues(
  template: PublishedTemplateDocument,
  values: TemplateFieldValues,
  options: { final?: boolean } = {}
): PublishedTemplateDocument {
  if (typeof DOMParser === 'undefined' || !template.contenido_html) return template;

  const parsed = new DOMParser().parseFromString(
    `<div id="docubox-template-root">${template.contenido_html}</div>`,
    'text/html'
  );
  const root = parsed.getElementById('docubox-template-root');
  if (!root) return template;

  root.querySelectorAll<HTMLElement>('[data-field-id]').forEach((field) => {
    const fieldId = field.dataset.fieldId || '';
    const valueKey = field.dataset.fieldValueKey || fieldId;
    const fieldType = String(field.dataset.fieldType || 'text').toLowerCase();
    const resolved = values[valueKey] ?? values[fieldId];
    const value = typeof resolved === 'string' ? resolved : '';
    if (value || options.final) {
      setResolvedFieldAppearance(field, fieldType, value, options.final === true);
    }
  });

  return { ...template, contenido_html: root.innerHTML };
}
