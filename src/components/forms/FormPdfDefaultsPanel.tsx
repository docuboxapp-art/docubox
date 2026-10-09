'use client';

import { useState } from 'react';
import { Check, Save } from 'lucide-react';
import FormPreview from '@/app/formularios/components/FormPreview';
import { PDF_CONTENT_OPTIONS, type FormPdfDefaults } from '@/lib/forms/pdf-defaults';
import { FORM_PAGE_SIZES } from '@/lib/forms/pdf-page-sizes';
import { type PdfSchema } from '@/lib/forms/schema';
import { createFormDesignPreviewTemplate } from '@/lib/forms/design-preview-template';
import { ExperienceOption } from './ExperienceOption';
import { FormTypographySelect } from './FormTypographySelect';

const inputClass = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-border dark:bg-background';

export function FormPdfDefaultsPanel({ initialSettings, onSave, saved = true }: { initialSettings: FormPdfDefaults; onSave: (settings: FormPdfDefaults) => void; saved?: boolean }) {
  const [draft, setDraft] = useState(initialSettings);
  const pdf = draft.pdfSchema;
  const update = (changes: Partial<PdfSchema>) => setDraft((current) => ({ ...current, pdfSchema: { ...current.pdfSchema, ...changes } }));
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(initialSettings);
  const preview = createFormDesignPreviewTemplate();
  preview.settings.pdfSchema = pdf;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
          <h2 className="text-base font-medium">Identidad predeterminada del PDF</h2>
          <p className="mt-1 text-sm text-slate-500">Se aplicará a los formularios nuevos de tu cuenta en este espacio.</p>
          <div className="mt-5 space-y-4">
            <label className="block"><span className="mb-1.5 block text-sm font-medium">Encabezado</span><input className={inputClass} value={pdf.header} maxLength={500} onChange={(event) => update({ header: event.target.value })} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-medium">Pie de página</span><textarea className={inputClass + ' h-auto resize-y py-2.5'} rows={2} value={pdf.footer} maxLength={500} onChange={(event) => update({ footer: event.target.value })} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-medium">Color principal</span><span className="flex h-10 items-center gap-3 rounded-lg border border-slate-200 px-3"><input type="color" aria-label="Color principal del PDF" value={pdf.primaryColor} onChange={(event) => update({ primaryColor: event.target.value })} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" /><span className="font-mono text-xs">{pdf.primaryColor}</span></span></label>
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
          <h2 className="text-base font-medium">Formato y distribución</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-sm font-medium">Tamaño de página</span><select className={inputClass} value={pdf.pageSize} onChange={(event) => update({ pageSize: event.target.value as PdfSchema['pageSize'] })}>{FORM_PAGE_SIZES.map((size) => <option key={size.value} value={size.value}>{size.label}</option>)}</select></label>
            <label><span className="mb-1.5 block text-sm font-medium">Orientación</span><select className={inputClass} value={pdf.orientation} onChange={(event) => update({ orientation: event.target.value as PdfSchema['orientation'] })}><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></label>
            <label><span className="mb-1.5 block text-sm font-medium">Márgenes</span><select className={inputClass} value={pdf.margins} onChange={(event) => update({ margins: event.target.value as PdfSchema['margins'] })}><option value="normal">Normales</option><option value="narrow">Estrechos</option><option value="wide">Amplios</option></select></label>
            <label><span className="mb-1.5 block text-sm font-medium">Tipografía</span><FormTypographySelect className={inputClass} value={pdf.typography} onChange={(typography) => update({ typography })} /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Alineación del encabezado</span><select className={inputClass} value={pdf.headerAlignment} onChange={(event) => update({ headerAlignment: event.target.value as PdfSchema['headerAlignment'] })}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option></select></label>
            <label><span className="mb-1.5 block text-sm font-medium">Respuestas</span><select className={inputClass} value={pdf.columns} onChange={(event) => update({ columns: event.target.value as PdfSchema['columns'] })}><option value="one">Una columna</option><option value="two">Dos columnas</option></select></label>
          </div>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-border">
            <ExperienceOption title="Numerar secciones" checked={pdf.showSectionNumbers} onChange={(showSectionNumbers) => update({ showSectionNumbers })} />
            <ExperienceOption title="Mostrar descripción" checked={pdf.showDescription} onChange={(showDescription) => update({ showDescription })} />
            <ExperienceOption title="Incluir campos sin respuesta" checked={pdf.showUnanswered} onChange={(showUnanswered) => update({ showUnanswered })} />
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
          <h2 className="text-base font-medium">Contenido automático</h2>
          <div className="mt-3 grid gap-x-5 sm:grid-cols-2">
            {PDF_CONTENT_OPTIONS.map(([key, label]) => (
              <ExperienceOption key={key} title={label} checked={pdf[key]} onChange={(value) => update({ [key]: value })} />
            ))}
          </div>
          <div className="mt-5 border-t border-slate-100 pt-4">
            {(hasChanges || !saved) ? <button type="button" onClick={() => onSave(draft)} className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white"><Save size={15} /> Guardar cambios</button> : <span className="flex items-center gap-2 text-xs text-slate-500"><Check size={14} className="text-emerald-600" /> Configuración aplicada</span>}
          </div>
        </section>
      </div>
      <aside className="min-w-0 xl:sticky xl:top-5 xl:self-start"><div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border dark:bg-card"><h3 className="mb-3 text-sm font-semibold">Vista previa del PDF</h3><div className="max-h-[640px] overflow-auto bg-slate-100 p-3"><div style={{ zoom: 0.62 }}><FormPreview template={preview} mode="pdf" designPreview /></div></div></div></aside>
    </div>
  );
}
