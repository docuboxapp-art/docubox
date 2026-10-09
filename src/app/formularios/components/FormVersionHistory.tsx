'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { FormTemplate } from '@/lib/forms/schema';
import { FORM_STATUS_LABELS } from '@/lib/forms/lifecycle';

type Version = {
  id: string;
  version_number: number;
  revision_number?: number;
  publication_comment?: string | null;
  status: FormTemplate['status'];
  updated_at: string;
};

export default function FormVersionHistory({
  template,
  onSelect,
  disabled = false,
}: {
  template: FormTemplate;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const key = `${template.id}:${template.status}`;
  const [result, setResult] = useState<{ key: string; versions: Version[]; error: string } | null>(
    null
  );
  const loading = result?.key !== key;
  const versions = result?.versions || [];
  const error = result?.error || '';
  useEffect(() => {
    if (!template.id || !template.workspaceId) return;
    let active = true;
    const root = template.rootTemplateId || template.id;
    void (async () => {
      const { data, error: failure } = await createClient()
        .from('form_templates')
        .select('id,version_number,revision_number,publication_comment,status,updated_at')
        .eq('workspace_id', template.workspaceId)
        .or(`id.eq.${root},root_template_id.eq.${root}`)
        .order('version_number', { ascending: false })
        .order('revision_number', { ascending: false });
      let rows: Version[] = data || [];
      let queryError = failure;
      if (failure?.code === '42703') {
        const legacy = await createClient()
          .from('form_templates')
          .select('id,version_number,status,updated_at')
          .eq('workspace_id', template.workspaceId)
          .or(`id.eq.${root},root_template_id.eq.${root}`)
          .order('version_number', { ascending: false });
        rows = legacy.data || [];
        queryError = legacy.error;
      }
      if (!active) return;
      setResult({
        key,
        versions: rows,
        error: queryError ? 'El historial de versiones no está disponible en este entorno.' : '',
      });
    })();
    return () => {
      active = false;
    };
  }, [template.id, template.rootTemplateId, template.workspaceId, key]);

  if (!template.id) return null;
  return (
    <section className="mt-6">
      <h3 className="border-b border-border pb-3 text-sm font-medium">Historial de versiones</h3>
      {loading ? (
        <p className="py-3 text-sm text-muted-foreground">Cargando versiones…</p>
      ) : error ? (
        <p className="py-3 text-sm text-muted-foreground">{error}</p>
      ) : (
        <ul className="divide-y divide-border">
          {versions.map((version) => (
            <li
              key={version.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <div>
                <span>
                  v{version.version_number}.0{(version.revision_number || 1) > 1 ? ` · revisión ${version.revision_number}` : ''} · {FORM_STATUS_LABELS[version.status]}
                </span>
                {version.publication_comment && <p className="mt-0.5 text-xs text-muted-foreground">{version.publication_comment}</p>}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(version.updated_at).toLocaleDateString('es-MX')}
                </p>
              </div>
              {version.id === template.id ? (
                <span className="text-xs text-primary">Versión abierta</span>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  className="text-primary hover:underline"
                  onClick={() => onSelect(version.id)}
                >
                  Abrir
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
