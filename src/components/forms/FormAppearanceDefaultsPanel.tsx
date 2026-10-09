'use client';

import { useState } from 'react';
import { Check, Save } from 'lucide-react';
import FormPreview from '@/app/formularios/components/FormPreview';
import { type FormAppearance } from '@/lib/forms/schema';
import { createFormDesignPreviewTemplate } from '@/lib/forms/design-preview-template';
import { ExperienceOption } from './ExperienceOption';
import { FormTypographySelect } from './FormTypographySelect';

const inputClass = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-border dark:bg-background';

export function FormAppearanceDefaultsPanel({ initialSettings, onSave, saved = true }: { initialSettings: FormAppearance; onSave: (settings: FormAppearance) => void; saved?: boolean }) {
  const [draft, setDraft] = useState(initialSettings);
  const update = (updates: Partial<FormAppearance>) => setDraft((current) => ({ ...current, ...updates }));
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(initialSettings);
  const preview = createFormDesignPreviewTemplate();
  preview.settings.appearance = draft;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
      <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
        <h2 className="text-base font-medium">Diseño predeterminado del formulario</h2>
        <p className="mt-1 text-sm text-slate-500">Se aplicará a los formularios nuevos de tu cuenta en este espacio.</p>
        <div className="mt-5 space-y-4">
          <label className="block"><span className="mb-1.5 block text-sm font-medium">Texto del encabezado</span><input className={inputClass} value={draft.headerText} maxLength={120} onChange={(event) => update({ headerText: event.target.value })} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-sm font-medium">Alineación del encabezado</span><select className={inputClass} value={draft.headerAlignment} onChange={(event) => update({ headerAlignment: event.target.value as FormAppearance['headerAlignment'] })}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option></select></label>
            <label><span className="mb-1.5 block text-sm font-medium">Color principal</span><span className="flex h-10 items-center gap-3 rounded-lg border border-slate-200 px-3"><input type="color" aria-label="Color principal del formulario" value={draft.accentColor} onChange={(event) => update({ accentColor: event.target.value })} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" /><span className="font-mono text-xs">{draft.accentColor}</span></span></label>
            <label><span className="mb-1.5 block text-sm font-medium">Ancho</span><select className={inputClass} value={draft.width} onChange={(event) => update({ width: event.target.value as FormAppearance['width'] })}><option value="standard">Estándar</option><option value="wide">Amplio</option></select></label>
            <label><span className="mb-1.5 block text-sm font-medium">Tipografía</span><FormTypographySelect className={inputClass} value={draft.typography} onChange={(typography) => update({ typography })} /></label>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-border">
            <ExperienceOption title="Mostrar encabezado" checked={draft.showHeader} onChange={(showHeader) => update({ showHeader })} />
            <ExperienceOption title="Mostrar franja de color" checked={draft.showAccentBar} onChange={(showAccentBar) => update({ showAccentBar })} />
            <ExperienceOption title="Mostrar barra de progreso" checked={draft.showProgressBar} onChange={(showProgressBar) => update({ showProgressBar })} />
            <ExperienceOption title="Mostrar descripción" checked={draft.showDescription} onChange={(showDescription) => update({ showDescription })} />
            <ExperienceOption title="Numerar secciones" checked={draft.showSectionNumbers} onChange={(showSectionNumbers) => update({ showSectionNumbers })} />
            <ExperienceOption title="Mostrar descripciones de secciones" checked={draft.showSectionDescriptions} onChange={(showSectionDescriptions) => update({ showSectionDescriptions })} />
            <ExperienceOption title="Espaciado compacto" checked={draft.compactSpacing} onChange={(compactSpacing) => update({ compactSpacing })} />
            <ExperienceOption title="Mostrar pie del formulario" checked={draft.showFooter} onChange={(showFooter) => update({ showFooter })} />
          </div>
          {draft.showFooter && <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
            <label><span className="mb-1.5 block text-sm font-medium">Texto del pie</span><input className={inputClass} value={draft.footerText} maxLength={200} onChange={(event) => update({ footerText: event.target.value })} /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Alineación</span><select className={inputClass} value={draft.footerAlignment} onChange={(event) => update({ footerAlignment: event.target.value as FormAppearance['footerAlignment'] })}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option></select></label>
          </div>}
          <label className="block"><span className="mb-1.5 block text-sm font-medium">Mensaje tras enviar</span><textarea className={inputClass + ' h-auto resize-y py-2.5'} rows={2} value={draft.confirmationMessage} maxLength={300} onChange={(event) => update({ confirmationMessage: event.target.value })} /></label>
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4">
          {(hasChanges || !saved) ? <button type="button" onClick={() => onSave(draft)} className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white"><Save size={15} /> Guardar cambios</button> : <span className="flex items-center gap-2 text-xs text-slate-500"><Check size={14} className="text-emerald-600" /> Configuración aplicada</span>}
        </div>
      </section>
      <aside className="min-w-0 xl:sticky xl:top-5 xl:self-start"><div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border dark:bg-card"><h3 className="mb-3 text-sm font-semibold">Vista previa del formulario</h3><div className="max-h-[640px] overflow-auto bg-slate-100 p-3"><div style={{ zoom: 0.72 }}><FormPreview template={preview} mode="web" designPreview /></div></div></div></aside>
    </div>
  );
}
