'use client';

import { useState } from 'react';
import { Check, Ruler, Save } from 'lucide-react';
import {
  TEMPLATE_PAPER_SIZES,
  type TemplateDocumentSettings,
  type TemplatePaperSize,
} from '@/lib/templates/document-settings';

interface TemplateDocumentSettingsPanelProps {
  initialSettings: TemplateDocumentSettings;
  onSave: (settings: TemplateDocumentSettings) => void;
  title?: string;
  description?: string;
}

const marginFields = [
  { key: 'top', label: 'Superior' },
  { key: 'bottom', label: 'Inferior' },
  { key: 'left', label: 'Izquierdo' },
  { key: 'right', label: 'Derecho' },
] as const;

export function TemplateDocumentSettingsPanel({
  initialSettings,
  onSave,
  title = 'Configuración del documento',
  description = 'Define la presentación de las hojas de esta plantilla.',
}: TemplateDocumentSettingsPanelProps) {
  const [draft, setDraft] = useState<TemplateDocumentSettings>(initialSettings);
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(initialSettings);

  const updateMargin = (key: (typeof marginFields)[number]['key'], value: string) => {
    const parsed = Number(value);
    setDraft((current) => ({
      ...current,
      margins: {
        ...current.margins,
        [key]: Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0,
      },
    }));
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Ruler size={17} />
        </div>
        <div>
          <h2 className="text-base font-700 text-slate-950">{title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Configuración de hoja
          </label>
          <select
            value={draft.paperSize}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                paperSize: event.target.value as TemplatePaperSize,
              }))
            }
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {TEMPLATE_PAPER_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">
            Orientación de la hoja
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDraft((current) => ({ ...current, orientation: 'vertical' }))}
              className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-600 transition-colors ${
                draft.orientation === 'vertical'
                  ? 'border-primary bg-primary text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="h-4 w-3 rounded-[1px] bg-current" />
              Vertical
            </button>
            <button
              type="button"
              onClick={() => setDraft((current) => ({ ...current, orientation: 'horizontal' }))}
              className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-600 transition-colors ${
                draft.orientation === 'horizontal'
                  ? 'border-primary bg-primary text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="h-3 w-4 rounded-[1px] bg-current" />
              Horizontal
            </button>
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Márgenes</span>
          <div className="grid grid-cols-2 gap-3">
            {marginFields.map((field) => (
              <label key={field.key} className="block text-xs font-medium text-slate-500">
                {field.label}
                <div className="relative mt-1">
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    value={draft.margins[field.key]}
                    onChange={(event) => updateMargin(field.key, event.target.value)}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 pr-8 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    cm
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center justify-between rounded-md border border-slate-200 px-3 py-2.5 transition-colors hover:bg-slate-50">
          <span>
            <span className="block text-sm font-medium text-slate-700">Mostrar regla</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Muestra las medidas alrededor de la hoja.
            </span>
          </span>
          <input
            type="checkbox"
            checked={draft.showRulers}
            onChange={(event) =>
              setDraft((current) => ({ ...current, showRulers: event.target.checked }))
            }
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
          />
        </label>

        {hasChanges && (
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white transition-colors hover:bg-primary/90"
          >
            <Save size={15} />
            Guardar cambios
          </button>
        )}

        {!hasChanges && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Check size={14} className="text-emerald-600" />
            Configuración aplicada
          </div>
        )}
      </div>
    </section>
  );
}
