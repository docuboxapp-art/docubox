'use client';

import { useState } from 'react';
import { Check, Save } from 'lucide-react';
import { ExperienceOption, InfoTooltip } from '@/components/forms/ExperienceOption';
import type { FormExperienceDefaults } from '@/lib/forms/experience-defaults';

const options = [
  ['multiStep', 'Mostrar por pasos', 'Presenta una sección del formulario a la vez.'],
  ['allowSaveProgress', 'Permitir guardar avance', 'Guarda las respuestas en este navegador para retomarlas después.'],
  ['configureFormDetails', 'Configurar diseño del formulario', 'Añade el paso Diseño para personalizar el formulario web.'],
  ['configurePdfDetails', 'Configurar diseño del PDF', 'Añade el paso PDF para personalizar el documento generado.'],
  ['requiresSignature', 'Requiere firma', 'Exige agregar un campo Firma en Contenido antes de continuar.'],
  ['configureLinkExpiration', 'Establecer vigencia del enlace', 'Define la vigencia sugerida al compartirlo. Si se omite, se usan 72 horas.'],
] as const;

export function FormExperienceDefaultsPanel({
  initialSettings,
  saved,
  onSave,
}: {
  initialSettings: FormExperienceDefaults;
  saved: boolean;
  onSave: (settings: FormExperienceDefaults) => void;
}) {
  const [draft, setDraft] = useState(initialSettings);
  const [expirationUnit, setExpirationUnit] = useState<'minutes' | 'hours'>(
    initialSettings.expirationHours < 1 || !Number.isInteger(initialSettings.expirationHours)
      ? 'minutes' : 'hours'
  );
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(initialSettings);
  const expirationValue = expirationUnit === 'minutes'
    ? Math.round(draft.expirationHours * 60)
    : Number(draft.expirationHours.toFixed(2));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card">
      <h2 className="text-base font-medium text-slate-950 dark:text-foreground">
        Experiencia del participante
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
        Se precarga al crear un formulario nuevo con tu cuenta en este espacio de trabajo.
      </p>

      <div className="mt-5 divide-y divide-slate-100 dark:divide-border">
        {options.map(([key, title, description]) => (
          <ExperienceOption
            key={key}
            title={title}
            description={description}
            checked={draft[key]}
            onChange={(checked) => setDraft((current) => ({
                ...current,
                [key]: checked,
                ...(key === 'multiStep' ? { mode: checked ? 'multistep' : 'scroll' } : {}),
              }))}
            />
        ))}
      </div>

      {draft.configureLinkExpiration && <div className="border-t border-slate-100 pt-4 dark:border-border">
        <div className="flex items-center gap-1">
          <label htmlFor="default-form-link-expiration" className="text-sm font-medium text-slate-700 dark:text-foreground">
            Vigencia predeterminada del enlace
          </label>
          <InfoTooltip label="Vigencia predeterminada del enlace" description="Puedes ajustarla para cada envío al compartir el formulario." />
        </div>
        <div className="mt-2 flex gap-2">
          <input
            id="default-form-link-expiration"
            type="number"
            min={expirationUnit === 'minutes' ? 1 : 1 / 60}
            max={expirationUnit === 'minutes' ? 43200 : 720}
            step={expirationUnit === 'minutes' ? 1 : 'any'}
            value={expirationValue > 0 ? expirationValue : ''}
            onChange={(event) => setDraft((current) => ({
              ...current,
              expirationHours: (Number(event.target.value) || 0) / (expirationUnit === 'minutes' ? 60 : 1),
            }))}
            aria-invalid={draft.expirationHours < 1 / 60 || draft.expirationHours > 720}
            className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary dark:border-border dark:bg-background dark:text-foreground"
          />
          <select
            aria-label="Unidad de vigencia predeterminada"
            value={expirationUnit}
            onChange={(event) => setExpirationUnit(event.target.value as 'minutes' | 'hours')}
            className="h-10 w-28 shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-border dark:bg-background dark:text-foreground"
          >
            <option value="minutes">Minutos</option>
            <option value="hours">Horas</option>
          </select>
        </div>
        {(draft.expirationHours < 1 / 60 || draft.expirationHours > 720) && (
          <p className="mt-1 text-xs text-red-600">Elige entre 1 minuto y 720 horas.</p>
        )}
      </div>}

      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-border">
        {(hasChanges || !saved) ? (
          <button
            type="button"
            disabled={draft.configureLinkExpiration && (draft.expirationHours < 1 / 60 || draft.expirationHours > 720)}
            onClick={() => onSave(draft)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={15} /> {saved ? 'Actualizar configuración' : 'Guardar configuración'}
          </button>
        ) : (
          <div role="status" className="flex items-center gap-2 text-xs text-slate-500 dark:text-muted-foreground">
            <Check size={14} className="text-emerald-600" /> Configuración aplicada
          </div>
        )}
      </div>
    </section>
  );
}
