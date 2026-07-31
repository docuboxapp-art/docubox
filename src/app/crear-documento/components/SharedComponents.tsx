'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Search, ChevronDown, CheckCircle2, X, Info, Star } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Etiqueta } from './types';

// ─── Favorites helpers (Supabase) ─────────────────────────────────────────────

async function fetchFavoritesFromDB(userId: string, storageKey: string): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_favorites')
    .select('item_id')
    .eq('user_id', userId)
    .eq('storage_key', storageKey)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data.map((r: { item_id: string }) => r.item_id);
}

async function addFavoriteToDB(userId: string, storageKey: string, itemId: string): Promise<void> {
  const supabase = createClient();
  await supabase.from('user_favorites').upsert(
    { user_id: userId, storage_key: storageKey, item_id: itemId },
    { onConflict: 'user_id,storage_key,item_id' }
  );
}

async function removeFavoriteFromDB(userId: string, storageKey: string, itemId: string): Promise<void> {
  const supabase = createClient();
  await supabase
    .from('user_favorites')
    .delete()
    .eq('user_id', userId)
    .eq('storage_key', storageKey)
    .eq('item_id', itemId);
}

// ─── FavoriteSearchableSelect ─────────────────────────────────────────────────

export function FavoriteSearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  storageKey,
  userId,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
  storageKey: string;
  userId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [favorites, setFavoritesState] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Load favorites from Supabase on mount / when userId changes
  useEffect(() => {
    if (!userId) return;
    fetchFavoritesFromDB(userId, storageKey).then(setFavoritesState);
  }, [userId, storageKey]);

  const toggleFavorite = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      e.preventDefault();
      if (!userId) return;
      const isFav = favorites.includes(id);
      // Optimistic update
      setFavoritesState((prev) =>
        isFav ? prev.filter((f) => f !== id) : [...prev, id]
      );
      if (isFav) {
        await removeFavoriteFromDB(userId, storageKey, id);
      } else {
        await addFavoriteToDB(userId, storageKey, id);
      }
    },
    [userId, storageKey, favorites]
  );

  // Sort: favorites first (preserving their order), then alphabetical
  const sortedOptions = React.useMemo(() => {
    const favSet = new Set(favorites);
    const favItems = favorites
      .map((fid) => options.find((o) => o.id === fid))
      .filter(Boolean) as { id: string; label: string }[];
    const rest = options
      .filter((o) => !favSet.has(o.id))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
    return [...favItems, ...rest];
  }, [options, favorites]);

  const filtered = sortedOptions.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const hasFavorites = favorites.filter((fid) => options.some((o) => o.id === fid)).length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`w-full flex items-center justify-between border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white transition-colors ${
          disabled
            ? 'opacity-50 cursor-not-allowed bg-gray-50 border-gray-200'
            : hasFavorites && !value
            ? 'border-amber-300 hover:border-amber-400 cursor-pointer ring-1 ring-amber-200' :'border-gray-200 hover:border-gray-300 cursor-pointer'
        }`}
      >
        <span className={`flex items-center gap-1.5 ${selected ? 'text-gray-800' : 'text-gray-400'}`}>
          {selected && favorites.includes(selected.id) && (
            <Star size={12} className="text-amber-400 fill-amber-400 shrink-0" />
          )}
          {selected ? selected.label : placeholder}
        </span>
        <div className="flex items-center gap-1.5">
          {hasFavorites && !value && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
              <Star size={9} className="fill-amber-400 text-amber-400" />
              {favorites.filter((fid) => options.some((o) => o.id === fid)).length} favorito{favorites.filter((fid) => options.some((o) => o.id === fid)).length !== 1 ? 's' : ''}
            </span>
          )}
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
          {/* Favorites section header */}
          {!search && favorites.filter((fid) => options.some((o) => o.id === fid)).length > 0 && (
            <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-100 flex items-center gap-1.5">
              <Star size={11} className="text-amber-400 fill-amber-400" />
              <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide">Favoritos</span>
            </div>
          )}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">Sin resultados</div>
            ) : (
              filtered.map((o, idx) => {
                const isFav = favorites.includes(o.id);
                const prevIsFav = idx > 0 && favorites.includes(filtered[idx - 1].id);
                const showDivider = !search && idx > 0 && !isFav && prevIsFav;
                return (
                  <React.Fragment key={o.id}>
                    {showDivider && <div className="border-t border-gray-100 my-0.5" />}
                    <div
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors cursor-pointer hover:bg-gray-50 ${
                        value === o.id ? 'text-primary font-medium bg-primary/5' : 'text-gray-700'
                      }`}
                    >
                      <span
                        className="flex items-center gap-2 flex-1 min-w-0 py-0.5"
                        onClick={() => { onChange(o.id); setOpen(false); setSearch(''); }}
                      >
                        {isFav && <Star size={12} className="text-amber-400 fill-amber-400 shrink-0" />}
                        <span className="truncate">{o.label}</span>
                      </span>
                      {userId && (
                        <button
                          type="button"
                          onClick={(e) => toggleFavorite(e, o.id)}
                          title={isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}
                          className={`ml-2 shrink-0 p-1 rounded-md transition-colors ${
                            isFav
                              ? 'text-amber-400 hover:text-amber-500 hover:bg-amber-50' :'text-gray-300 hover:text-amber-400 hover:bg-amber-50'
                          }`}
                        >
                          <Star size={13} className={isFav ? 'fill-amber-400' : ''} />
                        </button>
                      )}
                    </div>
                  </React.Fragment>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()));
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`w-full flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white transition-colors ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:border-gray-300 cursor-pointer'}`}
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">Sin resultados</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(o.id); setOpen(false); setSearch(''); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors ${value === o.id ? 'text-primary font-medium bg-primary/5' : 'text-gray-700'}`}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function EtiquetasMultiSelect({
  etiquetas,
  selectedIds,
  onChange,
}: {
  etiquetas: Etiqueta[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const filtered = etiquetas.filter((e) => e.nombre.toLowerCase().includes(search.toLowerCase()));
  const selected = etiquetas.filter((e) => selectedIds.includes(e.id));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen((v) => !v)}
        className="min-h-[42px] w-full flex flex-wrap gap-1.5 items-center border border-gray-200 rounded-lg px-3 py-2 cursor-pointer hover:border-gray-300 transition-colors bg-white"
      >
        {selected.length === 0 ? (
          <span className="text-sm text-gray-400">Seleccionar etiquetas...</span>
        ) : (
          selected.map((e) => (
            <span
              key={e.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: e.color || '#6B7280' }}
            >
              {e.nombre}
              <button
                type="button"
                onClick={(ev) => { ev.stopPropagation(); toggle(e.id); }}
                className="hover:opacity-70 transition-opacity"
              >
                <X size={10} />
              </button>
            </span>
          ))
        )}
        <ChevronDown size={14} className={`text-gray-400 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar etiqueta..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">Sin resultados</div>
            ) : (
              filtered.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggle(e.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors ${selectedIds.includes(e.id) ? 'bg-primary/5' : ''}`}
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: e.color || '#6B7280' }} />
                  <span className="flex-1 text-left text-gray-700">{e.nombre}</span>
                  {selectedIds.includes(e.id) && <CheckCircle2 size={14} className="text-primary shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FavoriteEtiquetasMultiSelect ─────────────────────────────────────────────

const ETIQUETAS_STORAGE_KEY = 'fav_etiquetas';

export function FavoriteEtiquetasMultiSelect({
  etiquetas,
  selectedIds,
  onChange,
  userId,
}: {
  etiquetas: Etiqueta[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  userId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const favoritesRef = useRef<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // DEBUG: log userId prop on every render
  console.log('[FavoriteEtiquetasMultiSelect] userId prop:', userId);

  // Keep ref in sync with state
  useEffect(() => {
    favoritesRef.current = favorites;
    // DEBUG: log favorites state whenever it changes
    console.log('[FavoriteEtiquetasMultiSelect] favorites state updated:', favorites);
  }, [favorites]);

  // Load favorites from Supabase
  useEffect(() => {
    console.log('[FavoriteEtiquetasMultiSelect] load effect — userId:', userId);
    if (!userId) {
      console.warn('[FavoriteEtiquetasMultiSelect] userId is falsy, skipping Supabase query');
      return;
    }
    const supabase = createClient();
    supabase
      .from('user_favorites')
      .select('item_id')
      .eq('user_id', userId)
      .eq('storage_key', ETIQUETAS_STORAGE_KEY)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        // DEBUG: log raw Supabase query result
        console.log('[FavoriteEtiquetasMultiSelect] Supabase query result — data:', data, '| error:', error);
        if (data) setFavorites(data.map((r: { item_id: string }) => r.item_id));
      });
  }, [userId]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleToggleFavorite = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    e.preventDefault();
    // DEBUG: log star click
    console.log('[FavoriteEtiquetasMultiSelect] star clicked — itemId:', itemId, '| userId:', userId, '| currentFavorites:', favoritesRef.current);
    if (!userId) {
      console.warn('[FavoriteEtiquetasMultiSelect] star click ignored — userId is falsy');
      return;
    }
    const supabase = createClient();
    const current = favoritesRef.current;
    const isFav = current.includes(itemId);
    if (isFav) {
      setFavorites(current.filter((f) => f !== itemId));
      supabase
        .from('user_favorites')
        .delete()
        .eq('user_id', userId)
        .eq('storage_key', ETIQUETAS_STORAGE_KEY)
        .eq('item_id', itemId)
        .then(() => {});
    } else {
      setFavorites([...current, itemId]);
      supabase
        .from('user_favorites')
        .upsert(
          { user_id: userId, storage_key: ETIQUETAS_STORAGE_KEY, item_id: itemId },
          { onConflict: 'user_id,storage_key,item_id' }
        )
        .then(() => {});
    }
  };

  const handleToggleSelected = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    if (selectedIds.includes(itemId)) {
      onChange(selectedIds.filter((x) => x !== itemId));
    } else {
      onChange([...selectedIds, itemId]);
    }
  };

  const sortedEtiquetas = useMemo(() => {
    const favSet = new Set(favorites);
    const favItems = favorites
      .map((fid) => etiquetas.find((e) => e.id === fid))
      .filter((e): e is Etiqueta => e !== undefined);
    const rest = etiquetas
      .filter((e) => !favSet.has(e.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return [...favItems, ...rest];
  }, [etiquetas, favorites]);

  const filtered = useMemo(
    () =>
      search
        ? sortedEtiquetas.filter((e) =>
            e.nombre.toLowerCase().includes(search.toLowerCase())
          )
        : sortedEtiquetas,
    [sortedEtiquetas, search]
  );

  const selected = useMemo(
    () => etiquetas.filter((e) => selectedIds.includes(e.id)),
    [etiquetas, selectedIds]
  );

  const validFavCount = useMemo(
    () => favorites.filter((fid) => etiquetas.some((e) => e.id === fid)).length,
    [favorites, etiquetas]
  );

  const hasFavorites = validFavCount > 0;

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <div
        role="button"
        tabIndex={0}
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((v) => !v)}
        className={`min-h-[42px] w-full flex flex-wrap gap-1.5 items-center border rounded-lg px-3 py-2 cursor-pointer transition-colors bg-white ${
          hasFavorites && selected.length === 0
            ? 'border-amber-300 hover:border-amber-400 ring-1 ring-amber-200' :'border-gray-200 hover:border-gray-300'
        }`}
      >
        {selected.length === 0 ? (
          <span className="text-sm text-gray-400 flex items-center gap-1.5">
            {hasFavorites && <Star size={12} className="text-amber-400 fill-amber-400" />}
            Seleccionar etiquetas...
          </span>
        ) : (
          selected.map((e) => (
            <span
              key={e.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: e.color || '#6B7280' }}
            >
              {favorites.includes(e.id) && (
                <Star size={9} className="fill-white text-white shrink-0" />
              )}
              {e.nombre}
              <button
                type="button"
                onClick={(ev) => { ev.stopPropagation(); onChange(selectedIds.filter((x) => x !== e.id)); }}
                className="hover:opacity-70 transition-opacity ml-0.5"
              >
                <X size={10} />
              </button>
            </span>
          ))
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {hasFavorites && selected.length === 0 && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
              <Star size={9} className="fill-amber-400 text-amber-400" />
              {validFavCount} favorito{validFavCount !== 1 ? 's' : ''}
            </span>
          )}
          <ChevronDown
            size={14}
            className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar etiqueta..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Favorites header */}
          {!search && hasFavorites && (
            <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-100 flex items-center gap-1.5">
              <Star size={11} className="text-amber-400 fill-amber-400" />
              <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide">
                Favoritos
              </span>
            </div>
          )}

          {/* List */}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">Sin resultados</div>
            ) : (
              filtered.map((e, idx) => {
                const isFav = favorites.includes(e.id);
                const isSelected = selectedIds.includes(e.id);
                const prevIsFav = idx > 0 && favorites.includes(filtered[idx - 1].id);
                const showDivider = !search && idx > 0 && !isFav && prevIsFav;
                return (
                  <React.Fragment key={e.id}>
                    {showDivider && <div className="border-t border-gray-100 my-0.5" />}
                    <div
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                        isSelected ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-gray-50'
                      }`}
                      onClick={(ev) => handleToggleSelected(ev, e.id)}
                    >
                      {isFav && (
                        <Star size={11} className="text-amber-400 fill-amber-400 shrink-0" />
                      )}
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: e.color || '#6B7280' }}
                      />
                      <span className="flex-1 text-left text-gray-700">{e.nombre}</span>
                      {isSelected && (
                        <CheckCircle2 size={14} className="text-primary shrink-0" />
                      )}
                      {/* Star button — always visible; disabled state when no userId */}
                      <button
                        type="button"
                        onClick={(ev) => handleToggleFavorite(ev, e.id)}
                        title={isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}
                        className={`shrink-0 p-1 rounded-md transition-colors ${
                          isFav
                            ? 'text-amber-400 hover:text-amber-500 hover:bg-amber-50' :'text-gray-300 hover:text-amber-400 hover:bg-amber-50'
                        }`}
                      >
                        <Star size={13} className={isFav ? 'fill-amber-400' : ''} />
                      </button>
                    </div>
                  </React.Fragment>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="w-4 h-4 rounded-full border border-gray-300 text-gray-400 hover:text-gray-600 hover:border-gray-400 flex items-center justify-center transition-colors"
        aria-label="Información"
      >
        <Info size={10} />
      </button>
      {show && (
        <span className="absolute left-5 top-1/2 -translate-y-1/2 z-50 w-52 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none leading-relaxed">
          {text}
          <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
        </span>
      )}
    </span>
  );
}
