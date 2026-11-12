'use client';

import { useState } from 'react';
import { Loader2, RotateCcw, Save } from 'lucide-react';
import {
  createDefaultFormLegalDefaults,
  normalizeFormLegalDefaults,
  type FormLegalDefaults,
  type LegalFieldType,
} from '@/lib/forms/legal-field-content';

const fieldTypes: Array<{ type: LegalFieldType; title: string }> = [
  { type: 'consentimiento', title: 'Consentimiento' },
  { type: 'declaration', title: 'Declaración bajo protesta' },
];

export function FormLegalDefaultsPanel({
  initialSettings,
  onSave,
}: {
  initialSettings: FormLegalDefaults;
  onSave: (value: FormLegalDefaults) => Promise<void>;
}) {
  const [value, setValue] = useState<FormLegalDefaults>(() => normalizeFormLegalDefaults(initialSettings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (type: LegalFieldType, field: 'description' | 'acceptanceLabel', text: string) =>
    setValue((current) => ({ ...current, [type]: { ...current[type], [field]: text } }));
  const save = async () => {
    if (fieldTypes.some(({ type }) => !value[type].description.trim() || !value[type].acceptanceLabel.trim())) {
      setError('Completa ambos textos en cada campo.');
      return;
    }
    setSaving(true);
    setError('');
    try { await onSave(value); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Textos legales predeterminados</h2>
        <p className="mt-1 text-sm text-slate-500">Se aplican al agregar nuevos campos de Consentimiento o Declaración bajo protesta. Cada formulario puede ajustar sus textos desde las propiedades del campo.</p>
      </div>
      {fieldTypes.map(({ type, title }) => <section key={type} className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="mt-4 space-y-4">
          <label className="block text-xs font-medium">Texto que leerá el participante
            <textarea rows={4} maxLength={1000} value={value[type].description} onChange={(event) => update(type, 'description', event.target.value)} className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-primary dark:border-border dark:bg-background" />
            <span className="mt-1 block text-right font-normal text-slate-400">{value[type].description.length}/1000</span>
          </label>
          <label className="block text-xs font-medium">Texto junto a la casilla de aceptación
            <input maxLength={160} value={value[type].acceptanceLabel} onChange={(event) => update(type, 'acceptanceLabel', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-primary dark:border-border dark:bg-background" />
            <span className="mt-1 block text-right font-normal text-slate-400">{value[type].acceptanceLabel.length}/160</span>
          </label>
        </div>
      </section>)}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => setValue(createDefaultFormLegalDefaults())} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-border"><RotateCcw size={15} /> Restaurar textos originales</button>
        <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar predeterminados</button>
      </div>
    </div>
  );
}
