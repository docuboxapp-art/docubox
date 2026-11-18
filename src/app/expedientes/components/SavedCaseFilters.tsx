'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Filter,
  Folder,
  Loader2,
  Pencil,
  Plus,
  Star,
  Tags,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import {
  buildSavedCaseFilter,
  sameCaseFilters,
  configuredCaseCriteria,
  type CaseFilterValues,
  type SavedCaseFilter,
} from '@/lib/case-files/saved-filters';
import {
  loadSavedCaseFilters,
  persistSavedCaseFilters,
} from '@/lib/case-files/saved-filters-client';
import LaunchDialog from '../lanzar/LaunchDialog';
import CaseFilterEditor from './CaseFilterEditor';

type Props = {
  workspaceId: string;
  current: CaseFilterValues;
  templates: { id: string; name: string }[];
  tags: string[];
  onApply: (filters: CaseFilterValues) => void;
};
const icons = {
  folder: Folder,
  filter: Filter,
  star: Star,
  clock: Clock3,
  tag: Tags,
  check: CheckCircle2,
};
export default function SavedCaseFilters(props: Props) {
  const { user } = useAuth();
  return user?.id ? (
    <Content key={`${user.id}:${props.workspaceId}`} {...props} userId={user.id} />
  ) : null;
}
function Content({
  workspaceId,
  userId,
  current,
  templates,
  tags,
  onApply,
}: Props & { userId: string }) {
  const [filters, setFilters] = useState<SavedCaseFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [editor, setEditor] = useState<SavedCaseFilter | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let live = true;
    loadSavedCaseFilters(createClient(), userId, workspaceId)
      .then((items) => {
        if (live) setFilters(items);
      })
      .catch((cause) => {
        if (live)
          setLoadError(
            cause instanceof Error ? cause.message : 'No se pudieron cargar tus filtros.'
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [workspaceId, userId, retry]);
  function open(filter?: SavedCaseFilter) {
    setError('');
    setDeleting(false);
    setEditor(
      filter
        ? { ...filter, filters: { ...filter.filters } }
        : {
            id: crypto.randomUUID(),
            name: '',
            description: '',
            icon: 'folder',
            emoji: '📁',
            criteria: configuredCaseCriteria(current),
            filters: { ...current },
          }
    );
  }
  function close() {
    if (!saving) {
      setEditor(null);
      setError('');
      setDeleting(false);
    }
  }
  async function save() {
    if (!editor || saving || loading || loadError) return;
    setError('');
    let next: SavedCaseFilter;
    try {
      next = buildSavedCaseFilter(editor, filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Revisa los criterios del filtro.');
      return;
    }
    const updated = filters.some((item) => item.id === next.id)
      ? filters.map((item) => (item.id === next.id ? next : item))
      : [...filters, next];
    setSaving(true);
    try {
      const stored = await persistSavedCaseFilters(createClient(), userId, workspaceId, updated);
      setFilters(stored);
      setSelectedId(next.id);
      onApply(next.filters);
      setEditor(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el filtro.');
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!editor || saving) return;
    setSaving(true);
    setError('');
    try {
      const stored = await persistSavedCaseFilters(
        createClient(),
        userId,
        workspaceId,
        filters.filter((item) => item.id !== editor.id)
      );
      setFilters(stored);
      if (selectedId === editor.id) setSelectedId(null);
      setEditor(null);
      setDeleting(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el filtro.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <section aria-label="Filtros personalizados de expedientes" className="mt-6">
      <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
        Creados por mí
      </p>
      {loading ? (
        <p role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" />
          Cargando filtros…
        </p>
      ) : loadError ? (
        <div role="alert" className="px-3 py-2 text-xs text-red-600">
          <p>{loadError}</p>
          <button
            onClick={() => {
              setLoadError('');
              setLoading(true);
              setRetry((value) => value + 1);
            }}
            className="mt-2 text-primary"
          >
            Reintentar
          </button>
        </div>
      ) : filters.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-slate-400">
          Guarda tus criterios de búsqueda para reutilizarlos.
        </p>
      ) : (
        filters.map((filter) => {
          const Icon = icons[filter.icon];
          const active = selectedId === filter.id && sameCaseFilters(filter.filters, current);
          return (
            <div
              key={filter.id}
              className={`group mb-1 flex items-center rounded-md px-2 ${active ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50 dark:text-muted-foreground'}`}
            >
              <button
                onClick={() => {
                  setSelectedId(filter.id);
                  onApply({ ...filter.filters });
                }}
                aria-pressed={active}
                title={filter.description || filter.name}
                className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-1 text-left text-sm font-medium"
              >
                {filter.emoji ? (
                  <span className="shrink-0 text-base">{filter.emoji}</span>
                ) : (
                  <Icon size={16} className="shrink-0" />
                )}
                <span className="truncate">{filter.name}</span>
              </button>
              <button
                onClick={() => open(filter)}
                aria-label={`Editar filtro ${filter.name}`}
                title="Editar filtro"
                className="rounded p-1.5 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Pencil size={13} />
              </button>
            </div>
          );
        })
      )}
      <button
        disabled={loading || !!loadError}
        onClick={() => open()}
        className="mt-2 flex w-full items-center gap-2.5 rounded-md border border-dashed border-primary/30 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
      >
        <Plus size={15} />
        Crear filtro
      </button>
      {editor && !deleting && (
        <CaseFilterEditor
          value={editor}
          editing={filters.some((item) => item.id === editor.id)}
          saving={saving}
          error={error}
          workspaceId={workspaceId}
          templates={templates}
          tags={tags}
          onChange={(value) => {
            setEditor(value);
            setError('');
          }}
          onClose={close}
          onSave={() => void save()}
          onDelete={() => {
            setError('');
            setDeleting(true);
          }}
        />
      )}
      {editor && deleting && (
        <LaunchDialog
          title="Eliminar filtro"
          description={'¿Quieres eliminar «' + editor.name + '» de tus filtros personalizados?'}
          onClose={close}
          footer={
            <>
              <button
                disabled={saving}
                onClick={() => setDeleting(false)}
                className="h-9 rounded-lg border border-slate-200 px-4 text-sm"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
                onClick={() => void remove()}
                className="h-9 rounded-lg bg-red-600 px-4 text-sm text-white"
              >
                {saving ? 'Guardando…' : 'Eliminar'}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-500">Los expedientes y sus datos se conservarán.</p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          )}
        </LaunchDialog>
      )}
    </section>
  );
}
