export const TEMPLATE_PAPER_SIZES = [
  'Carta (Letter)',
  'Oficio (Legal)',
  'A4',
  'A3',
  'A5',
  'Tabloide',
] as const;

export type TemplatePaperSize = (typeof TEMPLATE_PAPER_SIZES)[number];

export interface TemplateDocumentSettings {
  paperSize: TemplatePaperSize;
  orientation: 'vertical' | 'horizontal';
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  showRulers: boolean;
}

export const DEFAULT_TEMPLATE_DOCUMENT_SETTINGS: TemplateDocumentSettings = {
  paperSize: 'Carta (Letter)',
  orientation: 'vertical',
  margins: { top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 },
  showRulers: false,
};

const isPaperSize = (value: unknown): value is TemplatePaperSize =>
  typeof value === 'string' && TEMPLATE_PAPER_SIZES.includes(value as TemplatePaperSize);

const asMargin = (value: unknown, fallback: number) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10 ? parsed : fallback;
};

export function normalizeTemplateDocumentSettings(value: unknown): TemplateDocumentSettings {
  const candidate = (
    value && typeof value === 'object' ? value : {}
  ) as Partial<TemplateDocumentSettings>;
  const margins: Partial<TemplateDocumentSettings['margins']> = candidate.margins || {};

  return {
    paperSize: isPaperSize(candidate.paperSize)
      ? candidate.paperSize
      : DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.paperSize,
    orientation:
      candidate.orientation === 'horizontal'
        ? 'horizontal'
        : DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.orientation,
    margins: {
      top: asMargin(margins.top, DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.margins.top),
      bottom: asMargin(margins.bottom, DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.margins.bottom),
      left: asMargin(margins.left, DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.margins.left),
      right: asMargin(margins.right, DEFAULT_TEMPLATE_DOCUMENT_SETTINGS.margins.right),
    },
    showRulers: candidate.showRulers === true,
  };
}

export function getTemplateDocumentSettingsStorageKey(workspaceId?: string | null) {
  return `docubox_template_document_settings_${workspaceId || 'personal'}`;
}

export function readTemplateDocumentSettings(workspaceId?: string | null) {
  if (typeof window === 'undefined') return DEFAULT_TEMPLATE_DOCUMENT_SETTINGS;

  try {
    const stored = window.localStorage.getItem(getTemplateDocumentSettingsStorageKey(workspaceId));
    return stored
      ? normalizeTemplateDocumentSettings(JSON.parse(stored))
      : DEFAULT_TEMPLATE_DOCUMENT_SETTINGS;
  } catch {
    return DEFAULT_TEMPLATE_DOCUMENT_SETTINGS;
  }
}

export function writeTemplateDocumentSettings(
  workspaceId: string | null | undefined,
  settings: TemplateDocumentSettings
) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    getTemplateDocumentSettingsStorageKey(workspaceId),
    JSON.stringify(normalizeTemplateDocumentSettings(settings))
  );
}
