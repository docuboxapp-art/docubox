'use client';

import { ExperienceOption } from '@/components/forms/ExperienceOption';
import type { CaseTemplateDraft } from '@/lib/case-files/template-builder';
import type { CaseAppearance } from '@/lib/case-files/experience';

const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-border dark:bg-background';
const cardClass = 'rounded-xl border border-slate-200 bg-white p-5 dark:border-border dark:bg-card';

export function CaseDesignStep({ draft, onChange }: {
  draft: CaseTemplateDraft;
  onChange: (appearance: CaseAppearance) => void;
}) {
  const appearance = draft.appearance;
  const update = (patch: Partial<CaseAppearance>) => onChange({ ...appearance, ...patch });
  return <div className="w-full overflow-y-auto px-4 py-6 lg:px-6">
    <div className="mx-auto grid max-w-[1480px] gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
      <div className="space-y-4">
        <section className={cardClass}>
          <h2 className="text-base font-medium">Diseño del expediente</h2>
          <p className="mt-1 text-sm text-slate-500">Personaliza la presentación de este tipo de expediente.</p>
          <div className="mt-5 grid gap-4">
            <label className="text-sm font-medium">Título de cabecera<input value={appearance.headerText} onChange={(event) => update({ headerText: event.target.value })} placeholder={draft.name || 'Nombre del expediente'} className={inputClass} /></label>
            <label className="text-sm font-medium">Texto de apoyo<textarea rows={2} value={appearance.headerDescription} onChange={(event) => update({ headerDescription: event.target.value })} placeholder={draft.description || 'Descripción del expediente'} className={inputClass} /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">Alineación de cabecera<select value={appearance.headerAlignment} onChange={(event) => update({ headerAlignment: event.target.value as CaseAppearance['headerAlignment'] })} className={inputClass}><option value="left">Izquierda</option><option value="center">Centrada</option></select></label>
              <label className="text-sm font-medium">Ancho del contenido<select value={appearance.width} onChange={(event) => update({ width: event.target.value as CaseAppearance['width'] })} className={inputClass}><option value="standard">Estándar</option><option value="wide">Amplio</option></select></label>
              <label className="text-sm font-medium">Color principal<input type="color" value={appearance.accentColor} onChange={(event) => update({ accentColor: event.target.value })} className={`${inputClass} h-10 p-1`} /></label>
              <label className="text-sm font-medium">Color de fondo<input type="color" value={appearance.backgroundColor} onChange={(event) => update({ backgroundColor: event.target.value })} className={`${inputClass} h-10 p-1`} /></label>
            </div>
          </div>
        </section>
        <section className={cardClass}>
          <h3 className="text-sm font-semibold">Presentación de secciones</h3>
          <div className="mt-2 divide-y divide-slate-100 dark:divide-border">
            <ExperienceOption title="Mostrar números de sección" checked={appearance.showSectionNumbers} onChange={(showSectionNumbers) => update({ showSectionNumbers })} />
            <ExperienceOption title="Mostrar descripciones" checked={appearance.showSectionDescriptions} onChange={(showSectionDescriptions) => update({ showSectionDescriptions })} />
            <ExperienceOption title="Espaciado compacto" checked={appearance.compactSpacing} onChange={(compactSpacing) => update({ compactSpacing })} />
            <ExperienceOption title="Mostrar pie de página" checked={appearance.showFooter} onChange={(showFooter) => update({ showFooter })} />
          </div>
          {appearance.showFooter && <label className="mt-3 block text-sm font-medium">Texto del pie<input value={appearance.footerText} onChange={(event) => update({ footerText: event.target.value })} placeholder="Texto opcional" className={inputClass} /></label>}
        </section>
      </div>
      <section className={`${cardClass} h-fit`}>
        <h3 className="text-sm font-semibold">Vista previa del diseño</h3>
        <div className={`mt-4 overflow-hidden rounded-xl border border-slate-200 ${appearance.width === 'wide' ? 'max-w-none' : 'mx-auto max-w-xl'}`} style={{ backgroundColor: appearance.backgroundColor }}>
          <div className={`border-b border-slate-200 bg-white ${appearance.compactSpacing ? 'p-4' : 'p-6'} ${appearance.headerAlignment === 'center' ? 'text-center' : ''}`}>
            <div className="mb-2 h-1 w-16 rounded-full" style={{ backgroundColor: appearance.accentColor, marginInline: appearance.headerAlignment === 'center' ? 'auto' : undefined }} />
            <h4 className="text-lg font-semibold">{appearance.headerText || draft.name || 'Nombre del expediente'}</h4>
            <p className="mt-1 text-sm text-slate-500">{appearance.headerDescription || draft.description || 'Descripción del expediente'}</p>
          </div>
          <div className={appearance.compactSpacing ? 'space-y-2 p-3' : 'space-y-4 p-5'}>
            {(draft.sections.length ? draft.sections.slice(0, 2) : [{ id: 'example', title: 'Sección del expediente', description: 'Descripción de la sección', items: [] }]).map((section, index) => <div key={section.id} className={`rounded-lg border border-slate-200 bg-white ${appearance.compactSpacing ? 'p-3' : 'p-4'}`}>
              <div className="flex items-center gap-2">{appearance.showSectionNumbers && <span className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold text-white" style={{ backgroundColor: appearance.accentColor }}>{index + 1}</span>}<span className="text-sm font-semibold">{section.title || 'Sección sin nombre'}</span></div>
              {appearance.showSectionDescriptions && section.description && <p className="mt-1 text-xs text-slate-500">{section.description}</p>}
              <div className="mt-3 space-y-1">{section.items.slice(0, 2).map((item) => <p key={item.id} className="rounded-md border border-slate-100 px-2 py-1.5 text-xs">{item.title || 'Requisito sin nombre'}</p>)}</div>
            </div>)}
          </div>
          {appearance.showFooter && <div className="border-t border-slate-200 bg-white px-5 py-3 text-center text-xs text-slate-500">{appearance.footerText || 'Pie de página'}</div>}
        </div>
      </section>
    </div>
  </div>;
}
