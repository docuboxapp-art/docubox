'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import {
  collaborationItemTypeLabels,
  type CollaborationRequestItemInput,
} from '@/lib/collaboration/request-items';
import { useCollaborationApi } from '@/lib/collaboration/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type Source = { id: string; name?: string; nombre?: string; estado?: string };
export default function RequestItemsEditor({
  initialItems,
  initialFormId = '',
  name = 'items',
  single = false,
  onChange,
  disabled = false,
}: {
  initialItems?: CollaborationRequestItemInput[];
  initialFormId?: string;
  name?: string;
  single?: boolean;
  onChange?: (items: CollaborationRequestItemInput[]) => void;
  disabled?: boolean;
}) {
  const { activeWorkspace } = useWorkspace();
  const api = useCollaborationApi();
  const [items, setItems] = useState<CollaborationRequestItemInput[]>(
    () =>
      initialItems || [
        {
          item_type: initialFormId ? 'form' : 'document',
          title: '',
          required: true,
          form_template_id: initialFormId || null,
        },
      ]
  );
  const [sources, setSources] = useState<{ forms: Source[]; documents: Source[] }>({
    forms: [],
    documents: [],
  });
  const [error, setError] = useState('');
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let active = true;
    Promise.all([
      api<{ data: Source[] }>(
        `/api/colabora/catalog?workspace_id=${activeWorkspace.id}&type=forms`
      ),
      api<{ data: Source[] }>(
        `/api/colabora/catalog?workspace_id=${activeWorkspace.id}&type=documents`
      ),
    ])
      .then(([forms, documents]) => {
        if (active) {
          setSources({ forms: forms.data, documents: documents.data });
          setError('');
        }
      })
      .catch(() => {
        if (active)
          setError(
            'No se pudieron consultar los formularios y documentos. Cierra y vuelve a abrir el editor para intentarlo de nuevo.'
          );
      });
    return () => {
      active = false;
    };
  }, [activeWorkspace?.id, api]);
  const update = (next: CollaborationRequestItemInput[]) => {
    setItems(next);
    onChange?.(next);
  };
  const patch = (index: number, values: Partial<CollaborationRequestItemInput>) =>
    update(items.map((item, i) => (i === index ? { ...item, ...values } : item)));
  const move = (index: number, direction: number) => {
    const next = [...items];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    update(next);
  };
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <input type="hidden" name={name} value={JSON.stringify(items)} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Requisitos de la solicitud</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Agrega documentos, formularios publicados o documentos ya enviados a firma.
          </p>
        </div>
        {!single && (
          <button
            type="button"
            aria-label="Agregar requisito"
            onClick={() => update([...items, { item_type: 'document', title: '', required: true }])}
            disabled={items.length >= 50 || disabled}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium"
          >
            <Plus size={15} />
            Agregar
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {items.map((item, index) => (
        <section key={index} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Requisito {index + 1}</span>
            {!single && (
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`Subir requisito ${index + 1}`}
                  onClick={() => move(index, -1)}
                  className="rounded p-1.5 disabled:opacity-30"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  disabled={index === items.length - 1}
                  aria-label={`Bajar requisito ${index + 1}`}
                  onClick={() => move(index, 1)}
                  className="rounded p-1.5 disabled:opacity-30"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  disabled={items.length === 1}
                  aria-label={`Quitar requisito ${index + 1}`}
                  onClick={() => update(items.filter((_, i) => i !== index))}
                  className="rounded p-1.5 text-red-600 disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
          <label className="block text-sm">
            Tipo
            <select
              value={item.item_type}
              onChange={(e) =>
                patch(index, {
                  item_type: e.target.value as CollaborationRequestItemInput['item_type'],
                  form_template_id: null,
                  document_id: null,
                })
              }
              className="colabora-input mt-1.5"
            >
              {Object.entries(collaborationItemTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {['form', 'signature'].includes(item.item_type) && (
            <label className="block text-sm">
              {item.item_type === 'form' ? 'Formulario publicado' : 'Documento para firma'}
              <select
                required
                value={String(
                  item.item_type === 'form' ? item.form_template_id || '' : item.document_id || ''
                )}
                onChange={(e) => {
                  const selected = (
                    item.item_type === 'form' ? sources.forms : sources.documents
                  ).find((row) => row.id === e.target.value);
                  patch(index, {
                    [item.item_type === 'form' ? 'form_template_id' : 'document_id']:
                      e.target.value || null,
                    ...(!item.title ? { title: selected?.name || selected?.nombre || '' } : {}),
                  });
                }}
                className="colabora-input mt-1.5"
              >
                <option value="">Seleccionar...</option>
                {(item.item_type === 'form'
                  ? sources.forms
                  : sources.documents.filter(
                      (row) =>
                        !['borrador', 'cancelado', 'rechazado', 'vencido'].includes(
                          row.estado || ''
                        )
                    )
                ).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name || row.nombre}
                  </option>
                ))}
              </select>
              {item.item_type === 'signature' && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Debe incluir al destinatario como participante. Se utilizará el proceso de firma
                  del documento.
                </span>
              )}
            </label>
          )}
          <label className="block text-sm">
            Nombre del requisito
            <input
              required
              minLength={2}
              maxLength={180}
              value={item.title}
              onChange={(e) => patch(index, { title: e.target.value })}
              className="colabora-input mt-1.5"
            />
          </label>
          <label className="block text-sm">
            Indicaciones
            <textarea
              maxLength={2000}
              rows={2}
              value={item.description || ''}
              onChange={(e) => patch(index, { description: e.target.value })}
              className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.required}
              onChange={(e) => patch(index, { required: e.target.checked })}
            />
            Obligatorio
          </label>
        </section>
      ))}
    </fieldset>
  );
}
