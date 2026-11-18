'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCollaborationApi } from '@/lib/collaboration/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaboration } from '@/contexts/CollaborationContext';
import type { CollaborationRequestItemInput } from '@/lib/collaboration/request-items';
import RequestItemsEditor from './RequestItemsEditor';

export default function RequestRequirementActions({
  requestId,
  item,
  onSaved,
}: {
  requestId: string;
  item?: CollaborationRequestItemInput & {
    id: string;
    status: string;
    form_response_id?: string | null;
  };
  onSaved: () => Promise<void>;
}) {
  const api = useCollaborationApi();
  const { activeWorkspace } = useWorkspace();
  const { can } = useCollaboration();
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'' | 'edit' | 'remove'>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (mode) dialog.current?.showModal();
    else dialog.current?.close();
  }, [mode]);
  if (
    !can('requests.create', true) ||
    (item && (item.status !== 'pending' || item.form_response_id))
  )
    return null;
  const close = () => {
    if (!saving) {
      setMode('');
      setError('');
    }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeWorkspace?.id) return;
    setSaving(true);
    setError('');
    try {
      const data = new FormData(event.currentTarget);
      const values = JSON.parse(String(data.get('items') || '[]'));
      await api(`/api/colabora/details/requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action: mode === 'remove' ? 'remove_item' : item ? 'edit_item' : 'add_item',
          item_id: item?.id,
          item: mode === 'remove' ? undefined : values[0],
        }),
      });
      setMode('');
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el requisito.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="flex items-center gap-1.5">
        {item ? (
          <>
            <button
              type="button"
              aria-label={`Editar requisito ${item.title}`}
              onClick={() => setMode('edit')}
              className="colabora-icon-button"
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              aria-label={`Quitar requisito ${item.title}`}
              onClick={() => setMode('remove')}
              className="colabora-icon-button text-red-600"
            >
              <Trash2 size={15} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setMode('edit')}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-3 text-xs font-medium text-primary"
          >
            <Plus size={15} />
            Agregar requisito
          </button>
        )}
      </div>
      <dialog
        ref={dialog}
        aria-label={
          mode === 'remove' ? 'Quitar requisito' : item ? 'Editar requisito' : 'Agregar requisito'
        }
        className="colabora-dialog"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        {mode && (
          <form onSubmit={save}>
            <div className="colabora-dialog-header">
              <h3>
                {mode === 'remove'
                  ? 'Quitar requisito'
                  : item
                    ? 'Editar requisito'
                    : 'Agregar requisito'}
              </h3>
              <button type="button" onClick={close} disabled={saving} aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              {error && (
                <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </p>
              )}
              {mode === 'remove' ? (
                <p className="text-sm">
                  Se quitará «{item?.title}». Los requisitos que ya tienen entregas o accesos
                  emitidos se conservan para mantener la trazabilidad.
                </p>
              ) : (
                <RequestItemsEditor
                  disabled={saving}
                  single
                  initialItems={
                    item
                      ? [
                          {
                            item_type: item.item_type,
                            title: item.title,
                            description: item.description,
                            required: item.required,
                            form_template_id: item.form_template_id,
                            document_id: item.document_id,
                          },
                        ]
                      : undefined
                  }
                />
              )}
            </div>
            <div className="colabora-dialog-footer">
              <button
                type="button"
                onClick={close}
                disabled={saving}
                className="colabora-secondary-button"
              >
                Cancelar
              </button>
              <button disabled={saving} className="colabora-primary-button">
                {saving && <Loader2 size={15} className="animate-spin" />}
                {mode === 'remove' ? 'Quitar' : 'Guardar requisito'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
