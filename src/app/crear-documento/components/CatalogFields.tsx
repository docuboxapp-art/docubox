'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  DocumentTypeModal,
  TagsModal,
  type DocumentType,
} from '@/components/catalog/CatalogSelectionModals';
import type { Etiqueta, GrupoTipoDocumento, TipoDocumento } from './types';

function useDocumentFavorites(userId: string | undefined, storageKey: string) {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const supabase = createClient();
    void supabase
      .from('user_favorites')
      .select('item_id')
      .eq('user_id', userId)
      .eq('storage_key', storageKey)
      .then(({ data }) => {
        if (active && data) setFavorites(data.map((row: { item_id: string }) => row.item_id));
      });
    return () => {
      active = false;
    };
  }, [userId, storageKey]);

  const toggleFavorite = async (id: string) => {
    if (!userId) return;
    const wasFavorite = favorites.includes(id);
    setFavorites((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
    const supabase = createClient();
    const result = wasFavorite
      ? await supabase
          .from('user_favorites')
          .delete()
          .eq('user_id', userId)
          .eq('storage_key', storageKey)
          .eq('item_id', id)
      : await supabase
          .from('user_favorites')
          .upsert(
            { user_id: userId, storage_key: storageKey, item_id: id },
            { onConflict: 'user_id,storage_key,item_id' }
          );
    if (result.error) {
      setFavorites((current) =>
        wasFavorite ? [...current, id] : current.filter((item) => item !== id)
      );
    }
  };

  return { favorites, toggleFavorite };
}

const searchButtonClass =
  'flex h-10 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';

export function EtiquetasSearchFieldWithModal({
  etiquetas,
  selectedIds,
  onChange,
  userId,
  loading,
}: {
  etiquetas: Etiqueta[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  userId?: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { favorites, toggleFavorite } = useDocumentFavorites(userId, 'fav_etiquetas');
  const selected = etiquetas.filter((tag) => selectedIds.includes(tag.id));

  return (
    <>
      <div className="flex gap-2">
        <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          {selected.length ? (
            selected.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: `${tag.color || '#1E6BFF'}22`,
                  color: tag.color || '#1E6BFF',
                  border: `1px solid ${tag.color || '#1E6BFF'}55`,
                }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color || '#1E6BFF' }}
                />
                {tag.nombre}
                <button
                  type="button"
                  aria-label={`Quitar etiqueta ${tag.nombre}`}
                  onClick={() => onChange(selectedIds.filter((id) => id !== tag.id))}
                  className="ml-0.5 hover:opacity-70"
                >
                  <X size={10} />
                </button>
              </span>
            ))
          ) : (
            <span className="text-gray-400">
              {loading ? 'Cargando...' : 'Seleccionar etiquetas...'}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setOpen(true)}
          className={searchButtonClass}
        >
          <Search size={14} /> Buscar
        </button>
      </div>
      {open && (
        <TagsModal
          tags={etiquetas}
          selectedIds={selectedIds}
          favoriteIds={new Set(favorites)}
          onToggleFavorite={(id) => void toggleFavorite(id)}
          onConfirm={(ids) => {
            onChange(ids);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function DocumentTypeSelectorModal({
  grupos,
  tiposDocumento,
  selectedGrupoId,
  selectedTipoId,
  onSelect,
  userId,
  loading,
  disabled,
}: {
  grupos: GrupoTipoDocumento[];
  tiposDocumento: Record<string, TipoDocumento[]>;
  selectedGrupoId: string;
  selectedTipoId: string;
  onSelect: (grupoId: string, tipoId: string) => void;
  userId?: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { favorites, toggleFavorite } = useDocumentFavorites(userId, 'fav_doctype_merged');
  const types = grupos
    .flatMap((group) => tiposDocumento[group.id] || [])
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const selectedType = (tiposDocumento[selectedGrupoId] || []).find(
    (type) => type.id === selectedTipoId
  );
  const selectedName = selectedTipoId === '__otros__' ? 'Otro' : selectedType?.nombre || '';

  return (
    <>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            readOnly
            value={selectedName}
            placeholder={loading ? 'Cargando...' : 'Seleccionar tipo de documento...'}
            disabled={disabled || loading}
            className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 pr-8 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50"
          />
          {(selectedGrupoId || selectedTipoId) && (
            <button
              type="button"
              onClick={() => onSelect('', '')}
              aria-label="Quitar tipo de documento"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => setOpen(true)}
          className={searchButtonClass}
        >
          <Search size={14} /> Buscar
        </button>
      </div>
      {open && (
        <DocumentTypeModal
          types={types}
          groups={grupos}
          selectedId={selectedTipoId}
          selectedGroupId={selectedGrupoId}
          includeOther
          favoriteIds={new Set(favorites)}
          favoriteKeyForType={(type: DocumentType) => `${type.grupo_id}::${type.id}`}
          onToggleFavorite={(id) => void toggleFavorite(id)}
          onSelect={(id, groupId) => {
            onSelect(groupId || '', id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
