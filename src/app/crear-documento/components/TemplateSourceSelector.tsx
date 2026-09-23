'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Loader2, Search, Star } from 'lucide-react';
import type { PublishedTemplateDocument } from '@/lib/templates/preview';
import { getTemplateFamilyId } from '@/lib/templates/versioning';

export type PublishedTemplateSummary = PublishedTemplateDocument;

type Props = {
  open: boolean;
  templates: PublishedTemplateSummary[];
  favoriteIds: string[];
  loading: boolean;
  error: string | null;
  favoritePendingId: string | null;
  selectingId: string | null;
  onClose: () => void;
  onSelect: (template: PublishedTemplateSummary) => void;
  onToggleFavorite: (template: PublishedTemplateSummary) => void;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function TemplateSourceSelector({
  open,
  templates,
  favoriteIds,
  loading,
  error,
  favoritePendingId,
  selectingId,
  onClose,
  onSelect,
  onToggleFavorite,
}: Props) {
  const [search, setSearch] = useState('');
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const filteredTemplates = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('es-MX');
    if (!normalized) return templates;
    return templates.filter(
      (template) =>
        template.nombre.toLocaleLowerCase('es-MX').includes(normalized) ||
        template.descripcion?.toLocaleLowerCase('es-MX').includes(normalized) ||
        template.tipo_documento?.nombre.toLocaleLowerCase('es-MX').includes(normalized)
    );
  }, [search, templates]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !selectingId) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, selectingId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-[1px] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Seleccionar plantilla"
    >
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="min-h-16 border-b border-slate-200 px-5 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate text-base font-600 text-slate-950">Seleccionar plantilla</h2>
            <p className="truncate text-xs text-slate-500">
              Elige una plantilla publicada para iniciar tu documento.
            </p>
          </div>
        </header>

        <div className="border-b border-slate-200 bg-slate-50/70 p-4 sm:px-6">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 focus-within:border-primary">
            <Search size={17} className="shrink-0 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre, descripción o tipo de documento"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              autoFocus
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 size={18} className="animate-spin text-primary" />
              Consultando plantillas publicadas...
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <FileText size={32} className="mb-3 text-slate-300" />
              <p className="text-sm font-600 text-slate-700">No encontramos plantillas</p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
                Prueba con otro término o revisa las plantillas publicadas del espacio actual.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {filteredTemplates.map((template) => {
                const fieldsCount = Array.isArray(template.campos_insertados)
                  ? template.campos_insertados.length
                  : 0;
                const isFavorite = favoriteSet.has(getTemplateFamilyId(template));
                const isSelecting = selectingId === template.id;
                return (
                  <div
                    key={template.id}
                    className="flex flex-col gap-4 bg-white p-4 first:rounded-t-lg last:rounded-b-lg sm:flex-row sm:items-center"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-primary">
                      <FileText size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-600 text-slate-950">
                          {template.nombre}
                        </p>
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-600 text-emerald-700">
                          Publicada
                        </span>
                        <span className="text-[10px] font-normal text-slate-400">
                          v{template.version_publicada || '1.0'}
                        </span>
                      </div>
                      {template.descripcion && (
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {template.descripcion}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{template.tipo_documento?.nombre || 'Sin tipo de documento'}</span>
                        <span>
                          {fieldsCount} {fieldsCount === 1 ? 'campo' : 'campos'}
                        </span>
                        <span>Actualizada {formatDate(template.updated_at)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(template)}
                        disabled={Boolean(favoritePendingId) || Boolean(selectingId)}
                        className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors disabled:opacity-50 ${
                          isFavorite
                            ? 'border-amber-200 bg-amber-50 text-amber-500'
                            : 'border-slate-200 text-slate-400 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-500'
                        }`}
                        title={isFavorite ? 'Quitar de mis favoritas' : 'Agregar a mis favoritas'}
                        aria-label={
                          isFavorite ? 'Quitar de mis favoritas' : 'Agregar a mis favoritas'
                        }
                      >
                        <Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelect(template)}
                        disabled={Boolean(selectingId)}
                        className="flex h-9 min-w-32 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
                      >
                        {isSelecting ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Check size={15} />
                        )}
                        {isSelecting ? 'Preparando...' : 'Usar plantilla'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <footer className="flex shrink-0 justify-end border-t border-slate-200 px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(selectingId)}
            className="h-9 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}
