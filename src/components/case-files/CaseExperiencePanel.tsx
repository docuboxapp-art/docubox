'use client';

import { Save } from 'lucide-react';
import { ExperienceOption } from '@/components/forms/ExperienceOption';
import type { CaseExperience } from '@/lib/case-files/experience';

export function CaseExperiencePanel({
  value,
  onChange,
  onSaveDefaults,
  status,
}: {
  value: CaseExperience;
  onChange: (value: CaseExperience) => void;
  onSaveDefaults?: () => void;
  status?: string;
}) {
  const update = (patch: Partial<CaseExperience>) => onChange({ ...value, ...patch });
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card">
      <h2 className="text-base font-medium leading-5 text-slate-950 dark:text-foreground">
        Experiencia del expediente
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Define cómo se presenta y se integra el expediente.
      </p>
      <div className="mt-5 divide-y divide-slate-100 dark:divide-border">
        <ExperienceOption
          title="Mostrar por pasos"
          description="Presenta una sección del expediente a la vez."
          checked={value.showBySteps}
          onChange={(showBySteps) => update({ showBySteps })}
        />
        <ExperienceOption
          title="Permitir guardar avance"
          description="Permite retomar la integración del expediente sin perder el avance."
          checked={value.allowSaveProgress}
          onChange={(allowSaveProgress) => update({ allowSaveProgress })}
        />
        <ExperienceOption
          title="Firmar cierre de expediente"
          description="Agrega la firma de cierre como condición opcional de este tipo de expediente."
          checked={value.signAtClosure}
          onChange={(signAtClosure) =>
            update({
              signAtClosure,
              signatureDueDays: signAtClosure ? value.signatureDueDays : null,
            })
          }
        />
        <div>
          <ExperienceOption
            title="Configurar vencimientos"
            description="Activa plazos desde la apertura del expediente y elige dónde aplicarlos."
            checked={value.expireSections || value.expireElements}
            onChange={(enabled) => update({ expireSections: enabled, expireElements: false })}
          />
          {(value.expireSections || value.expireElements) && (
            <fieldset className="mb-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-border dark:bg-muted/30">
              <legend className="sr-only">Aplicar vencimientos a</legend>
              <p className="text-xs font-medium text-slate-500">Aplicar a</p>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-foreground">
                <input
                  type="checkbox"
                  checked={value.expireSections}
                  onChange={(event) => update({ expireSections: event.target.checked })}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                Secciones
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-foreground">
                <input
                  type="checkbox"
                  checked={value.expireElements}
                  onChange={(event) => update({ expireElements: event.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span>Requisitos, verificaciones y firmas</span>
              </label>
              {value.signAtClosure && value.expireElements && (
                <label className="block border-t border-slate-200 pt-3 text-xs font-medium text-slate-700 dark:border-border dark:text-foreground">
                  Firma de cierre · plazo en días
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={value.signatureDueDays ?? ''}
                    onChange={(event) =>
                      update({
                        signatureDueDays: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                    placeholder="Sin vencimiento"
                    className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary dark:border-border dark:bg-background"
                  />
                </label>
              )}
            </fieldset>
          )}
        </div>
        <ExperienceOption
          title="Configurar diseño del expediente"
          description="Permite personalizar su presentación en el paso Diseño."
          checked={value.configureDesign}
          onChange={(configureDesign) => update({ configureDesign })}
        />
      </div>
      {onSaveDefaults && (
        <button
          type="button"
          onClick={onSaveDefaults}
          className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-primary hover:bg-blue-50 dark:border-border"
        >
          <Save size={14} />
          Guardar como predeterminados
        </button>
      )}
      {status && (
        <p role="status" className="mt-3 text-xs text-slate-500">
          {status}
        </p>
      )}
    </section>
  );
}
