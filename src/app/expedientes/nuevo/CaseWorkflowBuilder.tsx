'use client';

import { useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import {
  caseVerificationCatalog,
  documentRequirementCatalog,
  documentRequirementCategories,
  type DocumentRequirementCatalogItem,
} from '@/lib/case-files/template-catalog';
import {
  newCaseTemplateVerification,
  type CaseTemplateVerification,
} from '@/lib/case-files/template-builder';

const inputClass =
  'mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background';
const sectionClass =
  'rounded-xl border border-slate-200 bg-white p-5 dark:border-border dark:bg-card';

export function RequirementCatalog({
  addedIds,
  openByDefault = false,
  multiSelect = false,
  onAdd,
  savedRequirements,
  catalogError,
  canShare,
  onCreate,
  onUpdate,
  onArchive,
}: {
  addedIds: Set<string>;
  openByDefault?: boolean;
  multiSelect?: boolean;
  onAdd: (item: DocumentRequirementCatalogItem) => void;
  savedRequirements: {
    id: string;
    name: string;
    description: string;
    category_key: string;
    defaults?: { instructions?: string };
    scope: 'personal' | 'workspace';
  }[];
  catalogError: string;
  canShare: boolean;
  onCreate: (input: {
    name: string;
    description: string;
    categoryKey: string;
    instructions: string;
    scope: 'template' | 'personal' | 'workspace';
  }) => Promise<string | null>;
  onUpdate: (input: {
    id: string;
    name: string;
    description: string;
    categoryKey: string;
    instructions: string;
  }) => Promise<string | null>;
  onArchive: (id: string) => Promise<string | null>;
}) {
  const [category, setCategory] = useState('');
  const [selection, setSelection] = useState<Map<string, DocumentRequirementCatalogItem>>(
    new Map()
  );
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'docubox' | 'personal' | 'workspace'>('docubox');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saveScope, setSaveScope] = useState<'template' | 'personal' | 'workspace'>('template');
  const [showEditor, setShowEditor] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState('');
  const normalized = query.toLocaleLowerCase('es-MX');
  const visible =
    source === 'docubox'
      ? documentRequirementCatalog.filter(
          (item) =>
            (!category || item.categories.includes(category)) &&
            `${item.title} ${item.description}`.toLocaleLowerCase('es-MX').includes(normalized)
        )
      : savedRequirements
          .filter(
            (item) =>
              item.scope === source &&
              (!category || item.category_key === category) &&
              `${item.name} ${item.description}`.toLocaleLowerCase('es-MX').includes(normalized)
          )
          .map((item) => ({
            id: item.id,
            title: item.name,
            description: item.description,
            categories: [item.category_key],
            instructions: item.defaults?.instructions || '',
          }));
  const beginEdit = (item?: DocumentRequirementCatalogItem, id?: string) => {
    setEditingId(id || null);
    setName(item?.title || '');
    setDescription(item?.description || '');
    setInstructions(item?.instructions || '');
    if (item) setCategory(item.categories[0] || 'identity');
    setSaveScope(id ? (source as 'personal' | 'workspace') : 'template');
    setFormError('');
    setShowEditor(true);
  };
  const save = async () => {
    if (!name.trim()) {
      setFormError('Escribe el nombre del requisito.');
      return;
    }
    if (!description.trim()) {
      setFormError('Escribe la descripción del requisito.');
      return;
    }
    setPending(true);
    let issue: string | null;
    try {
      issue = editingId
        ? await onUpdate({
            id: editingId,
            name,
            description,
            instructions,
            categoryKey: category || 'identity',
          })
        : await onCreate({
            name,
            description,
            instructions,
            categoryKey: category || 'identity',
            scope: saveScope,
          });
    } catch {
      issue = 'No se pudo conectar con el catálogo. Inténtalo de nuevo.';
    } finally {
      setPending(false);
    }
    if (issue) {
      setFormError(issue);
      return;
    }
    setShowEditor(false);
    setEditingId(null);
  };
  return (
    <details open={openByDefault || undefined} className={sectionClass}>
      <summary className="cursor-pointer text-sm font-semibold text-primary">
        Catálogo de requisitos documentales
      </summary>
      <p className="mt-2 text-xs text-slate-500">
        Usa un requisito de Docubox o crea uno para esta plantilla, tu catálogo o tu organización.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Origen del catálogo">
        {(['docubox', 'personal', 'workspace'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setSource(entry)}
            aria-pressed={source === entry}
            className={`rounded-md border px-2 py-1 text-xs ${source === entry ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200'}`}
          >
            {entry === 'docubox'
              ? 'Docubox'
              : entry === 'personal'
                ? 'Mis requisitos'
                : 'Organización'}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategory('')}
          aria-pressed={!category}
          className="rounded-md border px-2.5 py-1.5 text-xs"
        >
          Todas
        </button>
        {documentRequirementCategories.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setCategory(entry.id)}
            aria-pressed={category === entry.id}
            className={`rounded-md border px-2.5 py-1.5 text-xs ${category === entry.id ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200 hover:border-primary/40'}`}
          >
            {entry.title}
          </button>
        ))}
      </div>
      <label className="relative mt-4 block">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <span className="sr-only">Buscar requisito</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar requisito..."
          className={`${inputClass} mt-0 pl-9`}
        />
      </label>
      {source !== 'docubox' && catalogError && (
        <p className="mt-2 text-xs text-amber-700" role="status">
          {catalogError}
        </p>
      )}
      <div className="mt-3 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 dark:divide-border dark:border-border">
        {visible.map((item) => (
          <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                disabled={addedIds.has(item.id)}
                onClick={() => {
                  if (!multiSelect) {
                    onAdd(item);
                    return;
                  }
                  setSelection((current) => {
                    const next = new Map(current);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.set(item.id, item);
                    return next;
                  });
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/30 px-2 py-1 text-xs font-medium text-primary hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Plus size={13} />{' '}
                {addedIds.has(item.id)
                  ? 'Agregado'
                  : selection.has(item.id)
                    ? 'Seleccionado'
                    : multiSelect
                      ? 'Seleccionar'
                      : 'Agregar'}
              </button>
              <button
                type="button"
                onClick={() => beginEdit(item, source === 'docubox' ? undefined : item.id)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
              >
                {source === 'docubox' ? 'Duplicar' : 'Editar'}
              </button>
              {source !== 'docubox' && (
                <button
                  type="button"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `¿Archivar «${item.title}»? Las copias ya agregadas a plantillas se conservarán.`
                      )
                    )
                      return;
                    try {
                      const issue = await onArchive(item.id);
                      if (issue) setFormError(issue);
                    } catch {
                      setFormError('No se pudo conectar con el catálogo. Inténtalo de nuevo.');
                    }
                  }}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-red-600"
                >
                  Archivar
                </button>
              )}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="p-4 text-xs text-slate-500">No hay requisitos con esta búsqueda.</p>
        )}
      </div>
      {multiSelect && (
        <button
          type="button"
          disabled={!selection.size}
          onClick={() => {
            for (const item of selection.values()) onAdd(item);
            setSelection(new Map());
          }}
          className="mt-3 rounded-md bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          Agregar seleccionados ({selection.size})
        </button>
      )}
      <button
        type="button"
        onClick={() => beginEdit()}
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
      >
        <Plus size={14} /> Crear requisito
      </button>
      {formError && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {formError}
        </p>
      )}
      {showEditor && (
        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-border dark:bg-background">
          <p className="text-xs font-semibold">
            {editingId ? 'Editar requisito guardado' : 'Crear requisito documental'}
          </p>
          <label className="block text-xs font-medium">
            Nombre
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={180}
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-medium">
            Descripción
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-medium">
            Instrucciones para el participante
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={3}
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-medium">
            Categoría documental
            <select
              value={category || 'identity'}
              onChange={(event) => setCategory(event.target.value)}
              className={inputClass}
            >
              {documentRequirementCategories.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>
          {!editingId && (
            <label className="block text-xs font-medium">
              Guardar en
              <select
                value={saveScope}
                onChange={(event) => setSaveScope(event.target.value as typeof saveScope)}
                className={inputClass}
              >
                <option value="template">Solo esta plantilla</option>
                <option value="personal" disabled={Boolean(catalogError)}>
                  Mi catálogo
                </option>
                <option value="workspace" disabled={!canShare || Boolean(catalogError)}>
                  Organización
                </option>
              </select>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowEditor(false)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void save()}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {pending ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear y agregar'}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}

export function VerificationStep({
  value,
  onChange,
  allowDeadline = false,
}: {
  value: CaseTemplateVerification[];
  onChange: (value: CaseTemplateVerification[]) => void;
  allowDeadline?: boolean;
}) {
  const update = (id: string, patch: Partial<CaseTemplateVerification>) =>
    onChange(value.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  return (
    <div className="w-full overflow-y-auto px-4 py-6 lg:px-6">
      <div className="mx-auto max-w-[1100px] space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Verificaciones</h2>
          <p className="mt-1 text-sm text-slate-500">
            Elige controles de identidad o cumplimiento para este tipo. Su ejecución dependerá de
            los servicios habilitados al iniciar cada expediente.
          </p>
        </div>
        <section className={sectionClass}>
          <h3 className="text-sm font-semibold">Añadir verificación</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {caseVerificationCatalog.map((entry) => {
              const added = value.some((item) => item.catalogKey === entry.key);
              return (
                <button
                  key={entry.key}
                  type="button"
                  disabled={added}
                  onClick={() => onChange([...value, newCaseTemplateVerification(entry.key)])}
                  className="rounded-lg border border-slate-200 p-3 text-left hover:border-primary hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-border"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Plus size={14} className="text-primary" />
                    {entry.title}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {added ? 'Ya agregada' : entry.description}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => onChange([...value, newCaseTemplateVerification('custom')])}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Plus size={14} /> Crear verificación personalizada
          </button>
        </section>
        {value.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-200 p-6 text-sm text-slate-500">
            Este tipo no tiene verificaciones. Puedes continuar y agregarlas después.
          </p>
        )}
        {value.map((item, index) => (
          <section key={item.id} className={sectionClass}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {index + 1}. {item.title}
              </h3>
              <button
                type="button"
                onClick={() => onChange(value.filter((entry) => entry.id !== item.id))}
                aria-label={`Eliminar ${item.title}`}
                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={15} />
              </button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium">
                Nombre
                <input
                  value={item.title}
                  onChange={(event) => update(item.id, { title: event.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="text-xs font-medium">
                Sujeto a verificar
                <input
                  value={item.subject}
                  onChange={(event) => update(item.id, { subject: event.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="text-xs font-medium">
                Momento de ejecución
                <input
                  value={item.timing}
                  onChange={(event) => update(item.id, { timing: event.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="text-xs font-medium">
                Reintentos permitidos
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={item.retryLimit}
                  onChange={(event) => update(item.id, { retryLimit: Number(event.target.value) })}
                  className={inputClass}
                />
              </label>
              <label className="text-xs font-medium sm:col-span-2">
                Descripción
                <textarea
                  rows={2}
                  value={item.description}
                  onChange={(event) => update(item.id, { description: event.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="text-xs font-medium sm:col-span-2">
                Evidencia a conservar
                <input
                  value={item.evidence}
                  onChange={(event) => update(item.id, { evidence: event.target.value })}
                  className={inputClass}
                />
              </label>
              {allowDeadline && (
                <label className="text-xs font-medium sm:col-span-2">
                  Vencimiento de la verificación (días desde apertura, opcional)
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={item.dueInDays ?? ''}
                    onChange={(event) =>
                      update(item.id, {
                        dueInDays: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                    placeholder="Sin vencimiento"
                    className={inputClass}
                  />
                </label>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-5 text-xs">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.required}
                  onChange={(event) => update(item.id, { required: event.target.checked })}
                  className="accent-primary"
                />{' '}
                Resultado requerido
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.consentRequired}
                  onChange={(event) => update(item.id, { consentRequired: event.target.checked })}
                  className="accent-primary"
                />{' '}
                Solicitar consentimiento
              </label>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
