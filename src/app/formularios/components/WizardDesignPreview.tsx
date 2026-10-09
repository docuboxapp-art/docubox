'use client';

import { Loader2, Save } from 'lucide-react';
import FormPreview from './FormPreview';
import { BottomNotice } from '@/components/ui/BottomNotice';
import { useFormBuilder } from '@/contexts/FormBuilderContext';

export function WizardDesignPreview({
  mode,
  hasChanges,
  isSaving,
  onSaveDefaults,
  saveError,
  documentTypeName,
}: {
  mode: 'web' | 'pdf';
  hasChanges: boolean;
  isSaving: boolean;
  onSaveDefaults: () => void;
  saveError: string;
  documentTypeName?: string;
}) {
  const { state } = useFormBuilder();
  const isPdf = mode === 'pdf';

  return (
    <aside className="min-w-0 xl:sticky xl:top-5 xl:self-start" aria-label={`Vista previa del ${isPdf ? 'PDF' : 'formulario'}`}>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-border">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-foreground">
            Vista previa {isPdf ? 'del PDF' : 'del formulario'}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Se actualiza al cambiar el diseño. Las respuestas son ejemplos.
          </p>
        </div>
        <div className="max-h-[calc(100dvh-420px)] min-h-[220px] overflow-auto bg-slate-100 p-3 sm:p-5" style={!isPdf ? { backgroundColor: state.template.settings.appearance.backgroundColor } : undefined}>
          <div style={{ zoom: isPdf ? 0.7 : 0.78 }}>
            <FormPreview template={state.template} mode={mode} designPreview documentTypeName={documentTypeName} />
          </div>
        </div>
        <div className="border-t border-slate-200 px-5 py-4 dark:border-border">
          <p className="mb-3 text-xs text-slate-500">
            Guarda el formulario actual y aplica {isPdf ? 'la configuración general del PDF como predeterminada' : 'este diseño como predeterminado'} en los formularios nuevos de este espacio.
            {isPdf && ' La visibilidad y los saltos de cada sección se guardan solo en este formulario.'}
          </p>
          <button
            type="button"
            onClick={onSaveDefaults}
            disabled={!hasChanges || isSaving}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {isSaving ? 'Guardando...' : 'Guardar cambios'}
          </button>
          {saveError && <BottomNotice message={saveError} tone="critical" />}
        </div>
      </div>
    </aside>
  );
}
