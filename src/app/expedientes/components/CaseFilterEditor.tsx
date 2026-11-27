'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpDown,
  CalendarDays,
  CircleDot,
  Filter,
  Flag,
  FolderKanban,
  GripVertical,
  Lock,
  Plus,
  Search,
  Send,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { CUSTOM_FILTER_ICON_OPTIONS } from '@/lib/filters/custom-filter-icons';
import { caseCategories } from '@/lib/case-files/category-catalog';
import { caseOrderOptions } from '@/lib/case-files/consultation-order';
import { CASE_STATUS_META } from '@/lib/case-files/schema';
import {
  CASE_FILTER_CRITERIA,
  LEGACY_CASE_FILTER_EMOJI,
  configuredCaseCriteria,
  normalizeCaseFilterValues,
  removeCaseCriterion,
  reorderCaseCriteria,
  type CaseFilterCriterion,
  type SavedCaseFilter,
} from '@/lib/case-files/saved-filters';
import { caseRequest } from '@/lib/case-files/runtime-client';
import CaseFilterSelect from './CaseFilterSelect';

const meta = {
  category: { label: 'Categoría de expediente', icon: FolderKanban },
  subtype: { label: 'Tipo de expediente', icon: FolderKanban },
  responsible: { label: 'Responsable', icon: Filter },
  scope: { label: 'Vista', icon: Filter },
  type: { label: 'Expediente', icon: FolderKanban },
  status: { label: 'Estado', icon: CircleDot },
  priority: { label: 'Prioridad', icon: Flag },
  tag: { label: 'Etiquetas', icon: Tags },
  access: { label: 'Acceso', icon: Lock },
  dates: { label: 'Fecha de creación', icon: CalendarDays },
  query: { label: 'Nombre, folio o participante', icon: Search },
  scheduled: { label: 'Envíos programados', icon: Send },
  sort: { label: 'Orden', icon: ArrowUpDown },
};
const input =
  'h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-card dark:text-foreground';
type Props = {
  value: SavedCaseFilter;
  editing: boolean;
  saving: boolean;
  error: string;
  workspaceId: string;
  templates: { id: string; name: string }[];
  tags: string[];
  onChange: (value: SavedCaseFilter) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
};

export default function CaseFilterEditor({
  value,
  editing,
  saving,
  error,
  workspaceId,
  templates,
  tags,
  onChange,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [iconOpen, setIconOpen] = useState(!editing),
    [adding, setAdding] = useState(false),
    [over, setOver] = useState<number | null>(null);
  const drag = useRef<number | null>(null);
  const criteria = configuredCaseCriteria(value.filters, value.criteria);
  const emoji = value.emoji || LEGACY_CASE_FILTER_EMOJI[value.icon];
  const [preview, setPreview] = useState<{ key: string; total?: number; error?: boolean } | null>(
    null
  );
  const previewParams = new URLSearchParams({
    workspaceId,
    conteo: '1',
    categoria: value.filters.category,
    subtipo: value.filters.subtype,
    responsable: value.filters.responsible,
    estado: value.filters.status,
    vista: value.filters.scope,
    prioridad: value.filters.priority,
    acceso: value.filters.access,
    desde: value.filters.from,
    hasta: value.filters.to,
    tipo: value.filters.type,
    etiqueta: value.filters.tag,
    q: value.filters.query,
    envio: value.filters.scheduled ? 'scheduled' : '',
  }).toString();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      try {
        normalizeCaseFilterValues(value.filters);
      } catch {
        setPreview({ key: previewParams, error: true });
        return;
      }
      caseRequest<{ total: number }>(`/api/expedientes/consultar?${previewParams}`)
        .then((result) => {
          if (live) setPreview({ key: previewParams, total: result.total });
        })
        .catch(() => {
          if (live) setPreview({ key: previewParams, error: true });
        });
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // The serialized parameters cover every query criterion; names, icons and row order do not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewParams]);
  function patch(patch: Partial<SavedCaseFilter['filters']>) {
    onChange({
      ...value,
      filters: {
        ...value.filters,
        ...(patch.category !== undefined ? { subtype: '' } : {}),
        ...patch,
      },
    });
  }
  function move(from: number, to: number) {
    onChange({ ...value, criteria: reorderCaseCriteria(criteria, from, to) });
  }
  function options(key: CaseFilterCriterion): { id: string; name: string }[] {
    switch (key) {
      case 'category':
        return [
          { id: '', name: 'Todas las categorías' },
          ...caseCategories.map((c) => ({ id: c.name, name: c.name })),
        ];
      case 'subtype':
        return [
          { id: '', name: 'Todos los tipos' },
          ...caseCategories
            .filter((c) => !value.filters.category || c.name === value.filters.category)
            .flatMap((c) => c.types.map((t) => ({ id: t.name, name: t.name }))),
        ];
      case 'responsible':
        return [
          { id: '', name: 'Todos los responsables' },
          { id: 'me', name: 'Soy responsable' },
        ];
      case 'scope':
        return [
          { id: 'all', name: 'Todos los expedientes' },
          { id: 'mine', name: 'Soy responsable' },
          { id: 'active', name: 'En seguimiento' },
          { id: 'favorites', name: 'Mis favoritos' },
          { id: 'due', name: 'Por vencer (72 h)' },
        ];
      case 'type':
        return [{ id: '', name: 'Todos los tipos' }, ...templates];
      case 'status':
        return [
          { id: 'all', name: 'Todos los estados' },
          ...Object.entries(CASE_STATUS_META).map(([id, v]) => ({ id, name: v.label })),
        ];
      case 'priority':
        return [
          { id: '', name: 'Todas las prioridades' },
          { id: 'low', name: 'Baja' },
          { id: 'normal', name: 'Normal' },
          { id: 'high', name: 'Alta' },
          { id: 'urgent', name: 'Urgente' },
        ];
      case 'tag':
        return [
          { id: '', name: 'Todas las etiquetas' },
          ...tags.map((name) => ({ id: name, name })),
        ];
      case 'access':
        return [
          { id: '', name: 'Todas las modalidades' },
          { id: 'private', name: 'Privado' },
          { id: 'public', name: 'Público con código' },
        ];
      case 'scheduled':
        return [
          { id: 'false', name: 'Todos los envíos' },
          { id: 'true', name: 'Solo envíos programados' },
        ];
      case 'sort':
        return [...caseOrderOptions];
      default:
        return [];
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="case-filter-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-0 text-slate-950 shadow-[0_24px_70px_-24px_rgba(15,23,42,0.45)] backdrop:bg-black/40 backdrop:backdrop-blur-[2px] dark:border-border dark:bg-card dark:text-foreground"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white px-5 py-4 dark:border-border dark:bg-card">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Filter size={16} />
          </span>
          <h2 id="case-filter-editor-title" className="text-base font-600">
            {editing ? 'Editar filtro personalizado' : 'Crear filtro personalizado'}
          </h2>
        </header>
        <fieldset disabled={saving} className="min-w-0 space-y-4 px-5 py-4 disabled:opacity-70">
          <label className="block">
            <span className="mb-1.5 block text-xs font-600 text-slate-600">
              Nombre del filtro <span className="text-red-500">*</span>
            </span>
            <input
              autoFocus
              maxLength={80}
              value={value.name}
              onChange={(event) => onChange({ ...value, name: event.target.value })}
              placeholder="Ej. Expedientes privados en seguimiento"
              className={input}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-600 text-slate-600">
              Descripción{' '}
              <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
            </span>
            <input
              maxLength={200}
              value={value.description}
              onChange={(event) => onChange({ ...value, description: event.target.value })}
              placeholder="Ej. Expedientes en seguimiento del área legal"
              className={input}
            />
          </label>
          <div>
            <p className="mb-2 text-xs font-600 text-slate-600">
              Ícono{' '}
              <span className="font-normal text-slate-500">
                ({CUSTOM_FILTER_ICON_OPTIONS.length} opciones)
              </span>
            </p>
            {!iconOpen ? (
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-lg">
                  {emoji}
                </span>
                <button
                  type="button"
                  onClick={() => setIconOpen(true)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div className="custom-filter-icon-picker grid max-h-60 grid-cols-8 gap-2 overflow-y-auto pr-1 sm:grid-cols-10">
                {CUSTOM_FILTER_ICON_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={`Usar ícono ${option}`}
                    aria-pressed={emoji === option}
                    onClick={() => {
                      onChange({ ...value, emoji: option });
                      setIconOpen(false);
                    }}
                    className={`custom-filter-icon-option flex aspect-square w-full items-center justify-center rounded-md border transition-colors ${emoji === option ? 'border-primary bg-primary/10' : 'border-slate-200 hover:border-primary/40 hover:bg-slate-50'}`}
                  >
                    <span aria-hidden="true">{option}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-600 text-slate-600">Criterios de filtrado</p>
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-border dark:bg-muted/30">
              {criteria.map((key, index) => {
                const current =
                  key === 'scheduled'
                    ? String(value.filters.scheduled)
                    : key === 'dates'
                      ? ''
                      : value.filters[key];
                const choices = options(key);
                if (current && !choices.some((option) => option.id === current))
                  choices.push({ id: current, name: `${current} (no disponible)` });
                return (
                  <div
                    key={key}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setOver(index);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (drag.current !== null) move(drag.current, index);
                      drag.current = null;
                      setOver(null);
                    }}
                    className={`flex items-start gap-2 rounded-md border bg-white p-2 transition-colors dark:bg-card ${over === index ? 'border-primary bg-primary/5' : 'border-slate-200 dark:border-border'}`}
                  >
                    <button
                      draggable
                      type="button"
                      onDragStart={() => {
                        drag.current = index;
                      }}
                      onDragEnd={() => {
                        drag.current = null;
                        setOver(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                          event.preventDefault();
                          move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                        }
                      }}
                      aria-label={`Reordenar ${meta[key].label}`}
                      title="Arrastrar para reordenar"
                      className="mt-1 shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground"
                    >
                      <GripVertical size={14} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <span className="mb-1 block text-xs font-normal text-slate-600">
                        {meta[key].label}
                      </span>
                      {key === 'query' ? (
                        <input
                          aria-label={meta[key].label}
                          maxLength={120}
                          value={value.filters.query}
                          onChange={(event) => patch({ query: event.target.value })}
                          placeholder="Buscar…"
                          className={input}
                        />
                      ) : key === 'dates' ? (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="min-w-0 text-xs text-slate-500">
                            Desde
                            <input
                              type="date"
                              max={value.filters.to || undefined}
                              value={value.filters.from}
                              onChange={(event) => patch({ from: event.target.value })}
                              className={`${input} min-w-0 px-1.5`}
                            />
                          </label>
                          <label className="min-w-0 text-xs text-slate-500">
                            Hasta
                            <input
                              type="date"
                              min={value.filters.from || undefined}
                              value={value.filters.to}
                              onChange={(event) => patch({ to: event.target.value })}
                              className={`${input} min-w-0 px-1.5`}
                            />
                          </label>
                        </div>
                      ) : (
                        <CaseFilterSelect
                          inline
                          label={meta[key].label}
                          value={current}
                          options={choices}
                          onChange={(selected) =>
                            patch(
                              key === 'scheduled'
                                ? { scheduled: selected === 'true' }
                                : { [key]: selected }
                            )
                          }
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...value,
                          criteria: criteria.filter((item) => item !== key),
                          filters: removeCaseCriterion(value.filters, key),
                        })
                      }
                      aria-label={`Eliminar criterio ${meta[key].label}`}
                      title="Eliminar criterio"
                      className="mt-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-red-100 hover:text-red-500"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
              {!adding ? (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-dashed border-primary/40 px-3 text-sm font-600 text-primary transition-colors hover:bg-primary/5"
                >
                  <Plus size={14} />
                  Agregar criterio
                </button>
              ) : (
                <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm dark:bg-card">
                  <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                    <p className="text-xs font-normal uppercase tracking-wide text-slate-500">
                      Seleccionar criterio
                    </p>
                    <button
                      type="button"
                      onClick={() => setAdding(false)}
                      aria-label="Cerrar criterios"
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="custom-filter-criteria-options max-h-64 overflow-y-auto p-1">
                    {CASE_FILTER_CRITERIA.filter((key) => !criteria.includes(key)).map((key) => {
                      const Icon = meta[key].icon;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            onChange({ ...value, criteria: [...criteria, key] });
                            setAdding(false);
                          }}
                          className="group flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-normal text-slate-700 transition-colors hover:bg-slate-50 hover:text-primary"
                        >
                          <Icon
                            size={16}
                            strokeWidth={1.8}
                            className="shrink-0 text-slate-500 group-hover:text-primary"
                          />
                          {meta[key].label}
                        </button>
                      );
                    })}
                    {criteria.length === CASE_FILTER_CRITERIA.length && (
                      <p className="py-2 text-center text-xs text-muted-foreground">
                        Todos los criterios han sido agregados
                      </p>
                    )}
                  </div>
                </div>
              )}
              {criteria.length > 1 && (
                <p className="pt-1 text-center text-xs text-muted-foreground">
                  💡 Arrastra los criterios para reordenarlos
                </p>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="mb-1 text-xs font-medium text-primary">Vista previa</p>
            <p className="text-sm">
              <span className="mr-1">{emoji}</span>
              <span className="font-medium">{value.name || 'Sin nombre'}</span>
              {' — '}
              <span className="text-muted-foreground">
                {preview?.key !== previewParams
                  ? 'Calculando coincidencias…'
                  : preview.error
                    ? 'Vista previa no disponible'
                    : `${preview.total} expediente(s) coinciden`}
              </span>
            </p>
          </div>
          {error && (
            <p role="alert" className="text-xs text-red-500">
              {error}
            </p>
          )}
        </fieldset>
        <footer className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4 dark:border-border dark:bg-card">
          {editing && (
            <button
              type="button"
              disabled={saving}
              onClick={onDelete}
              className="mr-auto rounded p-2 text-slate-400 hover:text-red-600"
              aria-label="Eliminar filtro"
              title="Eliminar filtro"
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="flex h-9 items-center rounded-lg border border-slate-200 px-4 text-sm font-600 text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear filtro'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
