'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, FileText, LayoutTemplate, Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import { CASE_TEMPLATES } from '@/lib/case-files/schema';
import {
  parseStoredCaseTemplate,
  type StoredCaseTemplate,
} from '@/lib/case-files/template-builder';
import { CaseWorkspace, SectionHeader } from '../components/CaseUI';

export default function PlantillasExpedientePage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [saved, setSaved] = useState<StoredCaseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;
    const load = async () => {
      const { data, error: loadError } = await createClient()
        .from('case_file_templates')
        .select('id,name,description,case_type,case_subtype,requirements_schema,status')
        .eq('workspace_id', activeWorkspace.id)
        .neq('status', 'archived')
        .order('updated_at', { ascending: false });
      if (cancelled) return;
      setSaved((data || []) as StoredCaseTemplate[]);
      setError(loadError ? 'No se pudieron cargar los tipos de expediente guardados.' : '');
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id]);

  return (
    <AppLayout noPadding>
      <CaseWorkspace>
        <SectionHeader
          title="Tipos de expediente"
          description="Diseña la estructura reutilizable antes de lanzar un expediente y elegir participantes."
          action={
            <button
              type="button"
              onClick={() => router.push('/expedientes/nuevo')}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground"
            >
              <Plus size={15} /> Crear tipo de expediente
            </button>
          }
        />
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Cargando tipos de expediente…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {saved.map((template) => {
              const draft = parseStoredCaseTemplate(template);
              const items = draft.sections.flatMap((section) => section.items);
              return (
                <article
                  key={template.id}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card"
                >
                  <header className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-border">
                    <span className="flex h-10 w-10 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-primary">
                      <LayoutTemplate size={18} />
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${template.status === 'active' ? 'bg-emerald-50 text-emerald-700' : template.status === 'paused' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}
                    >
                      {template.status === 'active' ? 'Publicado' : template.status === 'paused' ? 'Pausado' : 'Borrador'}
                    </span>
                  </header>
                  <div className="p-4">
                    <p className="text-xs font-semibold text-primary">{template.case_type}</p>
                    <h2 className="mt-1 text-base font-semibold">{template.name}</h2>
                    <p className="mt-2 min-h-10 text-sm leading-5 text-slate-500">
                      {template.description || 'Sin descripción'}
                    </p>
                    <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-md border border-slate-200">
                      <Metric value={draft.sections.length} label="secciones" />
                      <Metric
                        value={items.filter((item) => item.kind !== 'form').length}
                        label="documentos"
                      />
                      <Metric
                        value={items.filter((item) => item.kind === 'form').length}
                        label="formularios"
                      />
                    </div>
                    <div className="mt-4 space-y-2">
                      {items.slice(0, 4).map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 text-xs text-slate-600"
                        >
                          <Check size={12} className="text-emerald-600" />
                          {item.title}
                        </div>
                      ))}
                    </div>
                  </div>
                  <footer className="border-t border-slate-200 p-3 dark:border-border">
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/expedientes/nuevo?id=${encodeURIComponent(template.id)}`)
                      }
                      className="h-9 w-full rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-border"
                    >
                      Editar tipo
                    </button>
                  </footer>
                </article>
              );
            })}
            {CASE_TEMPLATES.map((template) => (
              <article
                key={template.id}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card"
              >
                <header className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-border">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-primary">
                    <FileText size={18} />
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    Ejemplo base
                  </span>
                </header>
                <div className="p-4">
                  <p className="text-xs font-semibold text-primary">{template.type}</p>
                  <h2 className="mt-1 text-base font-semibold">{template.name}</h2>
                  <p className="mt-2 min-h-10 text-sm leading-5 text-slate-500">
                    {template.description}
                  </p>
                  <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-md border border-slate-200">
                    <Metric value={1} label="sección" />
                    <Metric value={template.requirements.length} label="documentos" />
                    <Metric value={0} label="formularios" />
                  </div>
                  <div className="mt-4 space-y-2">
                    {template.requirements.slice(0, 4).map((item) => (
                      <div
                        key={item.name}
                        className="flex items-center gap-2 text-xs text-slate-600"
                      >
                        <Check size={12} className="text-emerald-600" />
                        {item.name}
                      </div>
                    ))}
                  </div>
                </div>
                <footer className="border-t border-slate-200 p-3 dark:border-border">
                  <button
                    type="button"
                    onClick={() =>
                      router.push(`/expedientes/nuevo?tipo=${encodeURIComponent(template.id)}`)
                    }
                    className="h-9 w-full rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-border"
                  >
                    Usar como base
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </CaseWorkspace>
    </AppLayout>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-r border-slate-200 bg-slate-50 p-2 text-center last:border-r-0 dark:bg-background">
      <p className="text-sm font-semibold">{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}
