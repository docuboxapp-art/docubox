'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Layers, Search, Star, X } from 'lucide-react';

export type DocumentType = {
  id: string;
  nombre: string;
  grupo_id: string | null;
  descripcion?: string | null;
};
export type DocumentTypeGroup = { id: string; nombre: string };
export type CatalogTag = { id: string; nombre: string; color?: string | null };

function readFavorites(key: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    );
  } catch {
    return new Set();
  }
}

function useFavorites(key: string) {
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites(key));
  const toggleFavorite = (id: string) => {
    setFavorites((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        // Favorites are optional when browser storage is unavailable.
      }
      return next;
    });
  };
  return { favorites, toggleFavorite };
}

function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
}

const modalShell =
  'flex h-[85vh] max-h-[640px] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-card';
const searchInput =
  'w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-background dark:text-foreground';

function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.fullscreenElement || document.body);
}

function FavoriteButton({
  name,
  active,
  onClick,
}: {
  name: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mr-4 shrink-0 rounded-md p-2 transition-colors hover:bg-amber-50"
      title={active ? 'Quitar de favoritos' : 'Agregar a favoritos'}
      aria-label={`${active ? 'Quitar' : 'Agregar'} ${name} ${active ? 'de' : 'a'} favoritos`}
    >
      <Star
        size={16}
        className={active ? 'fill-amber-400 text-amber-400' : 'text-gray-300 hover:text-amber-300'}
      />
    </button>
  );
}

export function DocumentTypeModal({
  types,
  groups,
  selectedId,
  selectedGroupId,
  favoriteIds,
  favoriteKeyForType,
  onToggleFavorite,
  includeOther = false,
  onSelect,
  onClose,
}: {
  types: DocumentType[];
  groups: DocumentTypeGroup[];
  selectedId: string;
  selectedGroupId?: string;
  favoriteIds?: ReadonlySet<string>;
  favoriteKeyForType?: (type: DocumentType) => string;
  onToggleFavorite?: (id: string) => void;
  includeOther?: boolean;
  onSelect: (id: string, groupId?: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'tipo' | 'favoritos' | 'grupo'>('tipo');
  const [search, setSearch] = useState('');
  const [drillGroupId, setDrillGroupId] = useState<string | null>(null);
  const { favorites: localFavorites, toggleFavorite: toggleLocalFavorite } =
    useFavorites('tipo_doc_favorites');
  const favorites = favoriteIds || localFavorites;
  const favoriteKey = (type: DocumentType) => favoriteKeyForType?.(type) || type.id;
  const toggleFavorite = onToggleFavorite || toggleLocalFavorite;
  useEscapeToClose(onClose);

  const otherTypes: DocumentType[] = includeOther
    ? groups.map((group) => ({
        id: '__otros__',
        nombre: 'Otro',
        grupo_id: group.id,
        descripcion: 'Especificar manualmente',
      }))
    : [];
  const typesWithOther = [...types, ...otherTypes];
  const query = search.trim().toLocaleLowerCase('es');
  const filteredTypes = (tab === 'favoritos' ? typesWithOther : types).filter((type) => {
    const groupName = groups.find((group) => group.id === type.grupo_id)?.nombre || '';
    const matches =
      type.nombre.toLocaleLowerCase('es').includes(query) ||
      groupName.toLocaleLowerCase('es').includes(query) ||
      (type.descripcion || '').toLocaleLowerCase('es').includes(query);
    return matches && (tab !== 'favoritos' || favorites.has(favoriteKey(type)));
  });
  const filteredGroups = groups.filter(
    (group) =>
      group.nombre.toLocaleLowerCase('es').includes(query) ||
      (includeOther && ('otro'.includes(query) || 'especificar manualmente'.includes(query))) ||
      types.some(
        (type) => type.grupo_id === group.id && type.nombre.toLocaleLowerCase('es').includes(query)
      )
  );
  const drillTypes = typesWithOther.filter(
    (type) =>
      type.grupo_id === drillGroupId &&
      (type.nombre.toLocaleLowerCase('es').includes(query) ||
        (type.descripcion || '').toLocaleLowerCase('es').includes(query))
  );
  const favoriteCount = typesWithOther.filter((type) => favorites.has(favoriteKey(type))).length;

  const renderType = (type: DocumentType) => {
    const group = groups.find((item) => item.id === type.grupo_id);
    const isSelected =
      selectedId === type.id && (!selectedGroupId || selectedGroupId === type.grupo_id);
    const key = favoriteKey(type);
    return (
      <div
        key={`${type.grupo_id || ''}:${type.id}`}
        className={`flex items-center border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-border dark:hover:bg-muted ${isSelected ? 'bg-blue-50 dark:bg-primary/10' : ''}`}
      >
        <button
          type="button"
          onClick={() => onSelect(type.id, type.grupo_id || undefined)}
          className="min-w-0 flex-1 px-5 py-3.5 text-left"
        >
          <span
            className={`block text-sm font-semibold leading-snug ${isSelected ? 'text-blue-700' : 'text-gray-900 dark:text-foreground'}`}
          >
            {type.nombre}
          </span>
          {group && <span className="mt-0.5 block text-xs text-gray-500">{group.nombre}</span>}
          {type.descripcion && (
            <span className="mt-0.5 block text-xs text-gray-400">{type.descripcion}</span>
          )}
        </button>
        <FavoriteButton
          name={type.nombre}
          active={favorites.has(key)}
          onClick={() => toggleFavorite(key)}
        />
      </div>
    );
  };

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Tipo de documento"
          className={modalShell}
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-border">
            <div className="flex items-center gap-2">
              <Layers size={18} className="text-blue-600" />
              <h3 className="text-base font-semibold text-gray-900 dark:text-foreground">
                Tipo de documento
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="rounded-md p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </div>
          <div className="px-5 pb-3 pt-4">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setDrillGroupId(null);
                }}
                placeholder="Buscar tipo o documento..."
                aria-label="Buscar tipo de documento"
                className={searchInput}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
            {(
              [
                ['tipo', 'Por tipo', types.length],
                ['favoritos', 'Favoritos', favoriteCount],
                ['grupo', 'Por grupo', null],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTab(value);
                  setDrillGroupId(null);
                }}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${tab === value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-muted dark:text-muted-foreground'}`}
              >
                {value === 'favoritos' && (
                  <Star size={11} className={tab === value ? 'fill-white' : ''} />
                )}
                {label}
                {count !== null && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${tab === value ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-gray-100 dark:border-border">
            {tab !== 'grupo' &&
              (filteredTypes.length ? (
                filteredTypes.map(renderType)
              ) : (
                <div className="px-5 py-10 text-center text-sm text-gray-400">
                  {tab === 'favoritos' ? 'No tienes favoritos aún' : 'No se encontraron tipos'}
                </div>
              ))}
            {tab === 'grupo' &&
              (drillGroupId === null ? (
                filteredGroups.length ? (
                  filteredGroups.map((group) => {
                    const count = types.filter((type) => type.grupo_id === group.id).length;
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setDrillGroupId(group.id)}
                        className="mx-3 my-2 flex items-center justify-between rounded-xl border border-gray-100 px-5 py-4 text-left hover:bg-gray-50 dark:border-border dark:hover:bg-muted"
                        style={{ width: 'calc(100% - 24px)' }}
                      >
                        <span>
                          <span className="block text-sm font-semibold text-gray-900 dark:text-foreground">
                            {group.nombre}
                          </span>
                          <span className="mt-0.5 block text-xs text-gray-500">
                            {count} documento{count === 1 ? '' : 's'}
                          </span>
                        </span>
                        <ArrowRight size={16} className="shrink-0 text-gray-400" />
                      </button>
                    );
                  })
                ) : (
                  <div className="px-5 py-10 text-center text-sm text-gray-400">
                    No se encontraron grupos
                  </div>
                )
              ) : (
                <>
                  <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3 dark:border-border dark:bg-muted">
                    <button
                      type="button"
                      onClick={() => setDrillGroupId(null)}
                      className="flex items-center gap-1.5 text-xs font-medium text-blue-600"
                    >
                      <ArrowRight size={13} className="rotate-180" /> Grupos
                    </button>
                    <span className="text-gray-300">/</span>
                    <span className="truncate text-xs font-semibold text-gray-700 dark:text-foreground">
                      {groups.find((group) => group.id === drillGroupId)?.nombre}
                    </span>
                  </div>
                  {drillTypes.length ? (
                    drillTypes.map(renderType)
                  ) : (
                    <div className="px-5 py-10 text-center text-sm text-gray-400">
                      No se encontraron tipos en este grupo
                    </div>
                  )}
                </>
              ))}
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}

export function TagsModal({
  tags,
  selectedIds,
  favoriteIds,
  onToggleFavorite,
  onConfirm,
  onClose,
}: {
  tags: CatalogTag[];
  selectedIds: string[];
  favoriteIds?: ReadonlySet<string>;
  onToggleFavorite?: (id: string) => void;
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'todos' | 'favoritos'>('todos');
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState(selectedIds);
  const { favorites: localFavorites, toggleFavorite: toggleLocalFavorite } =
    useFavorites('etiqueta_favorites');
  const favorites = favoriteIds || localFavorites;
  const toggleFavorite = onToggleFavorite || toggleLocalFavorite;
  useEscapeToClose(onClose);

  const query = search.trim().toLocaleLowerCase('es');
  const filtered = tags.filter(
    (tag) =>
      tag.nombre.toLocaleLowerCase('es').includes(query) &&
      (tab === 'todos' || favorites.has(tag.id))
  );
  const favoriteCount = tags.filter((tag) => favorites.has(tag.id)).length;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section role="dialog" aria-modal="true" aria-label="Etiquetas" className={modalShell}>
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-border">
            <h3 className="text-base font-semibold text-gray-900 dark:text-foreground">
              Etiquetas
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="rounded-md p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </div>
          <div className="px-5 pb-3 pt-4">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar etiqueta..."
                aria-label="Buscar etiqueta"
                className={searchInput}
              />
            </div>
          </div>
          <div className="flex gap-2 px-5 pb-3">
            <button
              type="button"
              onClick={() => setTab('todos')}
              className={`flex-1 rounded-xl py-2 text-sm font-semibold ${tab === 'todos' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-muted dark:text-muted-foreground'}`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setTab('favoritos')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold ${tab === 'favoritos' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-muted dark:text-muted-foreground'}`}
            >
              <Star size={13} /> Favoritos ({favoriteCount})
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-gray-100 dark:border-border">
            {filtered.length ? (
              filtered.map((tag) => {
                const selected = localSelected.includes(tag.id);
                return (
                  <div
                    key={tag.id}
                    className={`group flex items-center border-b border-gray-50 last:border-0 hover:bg-gray-50 dark:border-border dark:hover:bg-muted ${selected ? 'bg-blue-50/50 dark:bg-primary/10' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setLocalSelected((previous) =>
                          selected ? previous.filter((id) => id !== tag.id) : [...previous, tag.id]
                        )
                      }
                      aria-pressed={selected}
                      className={`min-w-0 flex-1 px-5 py-3 text-left text-sm ${selected ? 'font-medium text-blue-700' : 'text-gray-700 dark:text-foreground'}`}
                    >
                      {tag.nombre}
                    </button>
                    <FavoriteButton
                      name={tag.nombre}
                      active={favorites.has(tag.id)}
                      onClick={() => toggleFavorite(tag.id)}
                    />
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-10 text-center text-sm text-gray-400">
                {tab === 'favoritos' ? 'No tienes favoritos aún' : 'No se encontraron etiquetas'}
              </div>
            )}
          </div>
          <div className="border-t border-gray-100 px-5 py-4 dark:border-border">
            <button
              type="button"
              onClick={() => onConfirm(localSelected)}
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Confirmar ({localSelected.length} seleccionada{localSelected.length === 1 ? '' : 's'})
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
