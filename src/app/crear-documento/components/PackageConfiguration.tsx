'use client';

import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { CheckCircle2, Paperclip, Trash2, Upload } from 'lucide-react';
import {
  MAX_PACKAGE_FILE_BYTES,
  type SupplementalDocumentDraft,
  type SupplementalResourceType,
} from '@/lib/document-package/types';
import type { Participant } from './types';
import { InfoTooltip } from './SharedComponents';

const RESOURCE_OPTIONS: Array<{
  value: SupplementalResourceType;
  label: string;
  description: string;
}> = [
  {
    value: 'informative',
    label: 'Informativo',
    description: 'El participante puede consultarlo durante el proceso.',
  },
  {
    value: 'read_required',
    label: 'Lectura requerida',
    description: 'Debe abrirse antes de continuar con la participación.',
  },
  {
    value: 'acceptance_required',
    label: 'Aceptación requerida',
    description: 'Requiere una confirmación expresa del participante.',
  },
  {
    value: 'downloadable',
    label: 'Descargable',
    description: 'Queda disponible como archivo de referencia.',
  },
];

export function PackageConfiguration({
  resources,
  onChange,
  participants,
  onParticipantsChange,
}: {
  resources: SupplementalDocumentDraft[];
  onChange: (resources: SupplementalDocumentDraft[]) => void;
  participants: Participant[];
  onParticipantsChange: Dispatch<SetStateAction<Participant[]>>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<SupplementalResourceType>('informative');
  const [error, setError] = useState('');

  const selectFile = (selected: File | null) => {
    setError('');
    if (!selected) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(selected.type)) {
      setError('Solo se permiten archivos PDF, JPG o PNG.');
      return;
    }
    if (selected.size <= 0 || selected.size > MAX_PACKAGE_FILE_BYTES) {
      setError('El archivo debe pesar menos de 25 MB.');
      return;
    }
    setFile(selected);
    if (!title.trim()) setTitle(selected.name.replace(/\.[^/.]+$/, ''));
  };

  const addResource = () => {
    if (!file || !title.trim()) {
      setError('Selecciona un archivo e indica su nombre.');
      return;
    }
    onChange([
      ...resources,
      {
        id: crypto.randomUUID(),
        title: title.trim(),
        description: description.trim(),
        type,
        file,
      },
    ]);
    setFile(null);
    setTitle('');
    setDescription('');
    setType('informative');
    setError('');
  };

  const setResourceParticipant = (resourceId: string, participantId: string, checked: boolean) => {
    onParticipantsChange((current) =>
      current.map((participant) => {
        if (participant.id !== participantId) return participant;
        const assigned = participant.visibleResourceIds || [];
        return {
          ...participant,
          visibleResourceIds: checked
            ? [...new Set([...assigned, resourceId])]
            : assigned.filter((id) => id !== resourceId),
        };
      })
    );
  };

  const removeResource = (resourceId: string) => {
    onChange(resources.filter((resource) => resource.id !== resourceId));
    onParticipantsChange((current) =>
      current.map((participant) => ({
        ...participant,
        visibleResourceIds: (participant.visibleResourceIds || []).filter(
          (id) => id !== resourceId
        ),
      }))
    );
  };

  return (
    <>
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group/option flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-50"
        >
          <input
            type="checkbox"
            checked={resources.length > 0}
            readOnly
            tabIndex={-1}
            className="pointer-events-none h-4 w-4 rounded border-gray-300 accent-primary"
          />
          <span className="flex-1 text-sm font-normal !font-normal text-gray-700">
            Documentos complementarios
          </span>
          <InfoTooltip
            showOnParentHover
            text="Agrega documentos que determinados participantes deberán consultar, aceptar o descargar durante el proceso."
          />
        </button>
        {resources.length > 0 && (
          <div className="mx-3 mb-2 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 size={14} className="shrink-0" />
              {resources.length}{' '}
              {resources.length === 1 ? 'recurso configurado' : 'recursos configurados'}
            </span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-xs font-600 text-primary hover:underline"
            >
              Editar
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="package-title"
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <div>
                <h2 id="package-title" className="text-lg font-700 text-slate-950">
                  Documentos complementarios
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Agrega archivos de consulta, lectura, aceptación o descarga sin modificar el
                  documento principal.
                </p>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-600 text-slate-600">
                    Nombre del recurso *
                  </label>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={180}
                    placeholder="Ej. Aviso de privacidad"
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-600 text-slate-600">Tipo *</label>
                  <select
                    value={type}
                    onChange={(event) => setType(event.target.value as SupplementalResourceType)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                  >
                    {RESOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    {RESOURCE_OPTIONS.find((option) => option.value === type)?.description}
                  </p>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-600 text-slate-600">Descripción</label>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="Indica por qué se incluye este recurso."
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </div>
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  selectFile(event.dataTransfer.files[0] || null);
                }}
                onClick={() => inputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center hover:border-primary/60"
              >
                <Upload size={24} className="text-slate-400" />
                <p className="mt-2 text-sm font-600 text-primary">
                  Arrastra un archivo o selecciónalo
                </p>
                <p className="mt-1 text-xs text-slate-500">PDF, JPG o PNG, hasta 25 MB.</p>
                {file && (
                  <p className="mt-2 max-w-full truncate text-xs font-600 text-slate-700">
                    {file.name}
                  </p>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="hidden"
                onChange={(event) => {
                  selectFile(event.target.files?.[0] || null);
                  event.target.value = '';
                }}
              />
              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {error}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={addResource}
                  className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-600 text-white hover:bg-primary/90"
                >
                  <Paperclip size={15} />
                  Agregar recurso
                </button>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-700 uppercase text-slate-500">Recursos agregados</h3>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {resources.length}
                  </span>
                </div>
                {resources.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-500">
                    Aún no has agregado documentos complementarios.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {resources.map((resource) => (
                      <div key={resource.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center gap-3">
                          <Paperclip size={15} className="shrink-0 text-slate-400" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-600 text-slate-900">
                              {resource.title}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {
                                RESOURCE_OPTIONS.find((option) => option.value === resource.type)
                                  ?.label
                              }{' '}
                              · {resource.file.name}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeResource(resource.id)}
                            aria-label={`Eliminar ${resource.title}`}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <p className="mb-2 text-xs font-600 text-slate-600">Entregar a:</p>
                          {participants.length === 0 ? (
                            <p className="text-xs text-slate-500">
                              Agrega participantes para asignar este documento.
                            </p>
                          ) : (
                            <div className="grid gap-2 sm:grid-cols-2">
                              {participants.map((participant) => (
                                <label
                                  key={participant.id}
                                  className="flex cursor-pointer items-center gap-2 text-xs text-slate-700"
                                >
                                  <input
                                    type="checkbox"
                                    checked={(participant.visibleResourceIds || []).includes(
                                      resource.id
                                    )}
                                    onChange={(event) =>
                                      setResourceParticipant(
                                        resource.id,
                                        participant.id,
                                        event.target.checked
                                      )
                                    }
                                    className="h-4 w-4 rounded border-slate-300 accent-primary"
                                  />
                                  <span className="truncate">
                                    {participant.name || participant.email || 'Participante'}
                                  </span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 rounded-lg border border-slate-200 px-4 text-sm font-600 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 rounded-lg bg-primary px-4 text-sm font-600 text-white hover:bg-primary/90"
              >
                Guardar configuración
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
