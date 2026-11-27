'use client';

import { useEffect, useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, X } from 'lucide-react';
import type { WorkspaceDocumentTab } from '@/lib/documents/workspace-actions';
import { DocumentViewerActionContext } from '@/components/documents/DocumentViewerActionContext';

const DocumentViewer = dynamic(() => import('../../visor-documento/[id]/page'), {
  ssr: false,
  loading: () => (
    <p
      role="status"
      className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"
    >
      <Loader2 size={16} className="animate-spin text-primary" aria-hidden="true" />
      Cargando documento…
    </p>
  ),
});

const dialogTitles = {
  descargas: 'Descargar documento',
  editar: 'Editar documento',
  permisos: 'Compartir documento',
} satisfies Record<WorkspaceDocumentTab, string>;

export default function WorkspaceDocumentDialog({
  action,
  onClose,
  onUpdated,
}: {
  action: { id: string; name: string; tab: WorkspaceDocumentTab };
  onClose: () => void;
  onUpdated: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-3xl overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)]"
    >
      <div className="flex max-h-[calc(100dvh-1rem-2px)] flex-col sm:max-h-[calc(100dvh-2rem-2px)]">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              {dialogTitles[action.tab]}
            </h2>
            <p className="truncate text-sm text-muted-foreground">{action.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50"
          >
            <X size={16} aria-hidden="true" />
            Cerrar
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto">
          <DocumentViewerActionContext.Provider
            value={{
              documentId: action.id,
              tab: action.tab,
              onUpdated,
              onSavingChange: setSaving,
            }}
          >
            <DocumentViewer />
          </DocumentViewerActionContext.Provider>
        </div>
      </div>
    </dialog>
  );
}
