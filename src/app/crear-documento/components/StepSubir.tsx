'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, ExternalLink, FileText, CheckCircle2, Eye, EyeOff, Trash2, ShieldCheck, Folder, Tag, Monitor, Smartphone, Clock, AlertTriangle, Search, Star, X, ChevronRight, Layers, Plus, Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAppModules } from '@/contexts/AppModulesContext';
import { SearchableSelect, InfoTooltip } from './SharedComponents';
import type { DocumentConfig, GrupoTipoDocumento, TipoDocumento, Etiqueta, Carpeta } from './types';

// ─── Brand Icons ──────────────────────────────────────────────────────────────

function GoogleDriveIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8 2.5 1.9 3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.2 3.3 3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8 2.5-1.2 4.5-1.2h-18.5c0-1.5-.5-2.9-1.2-4.5z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35-.8 2.8 1.2 4.5 1.2h50.8c1.6 0 3.1-.4 4.5-1.2z" fill="#00832d"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.9 1.5-2.9 3.3-3.3l13.75 23.8 16.15 27h27.45c0-1.5-.5-2.9-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );
}

function OneDriveIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#1565c0" d="M28 20.1c1.3-3.2 4.4-5.5 8.1-5.5 4.8 0 8.6 4.1 8.6 8.6 0 .4 0 1 .1 1.5-3.1.5-5.5 3.1-5.5 8.1 0 3.2 2.4 5.5 5.5 5.5 2.4 0 4.6-2.3 4.6-5.5 0-1.5-.5-2.9-1.2-4.5z" />
      <path fill="#42a5f5" d="M28 20.1c-1.7-2.1-4.4-3.5-7.3-3.5-5.1 0-9.2 4.1-9.2 8.6 0 .5 0 1 .1 1.5-3.1.5-5.5 3.1-5.5 8.1 0 3.2 2.4 5.5 5.5 5.5 2.4 0 4.6-2.3 4.6-5.5 0-1.5-.5-2.9-1.2-4.5z" />
    </svg>
  );
}

function DropboxIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 528 512" xmlns="http://www.w3.org/2000/svg">
      <path fill="#0061ff" d="M264.4 116.3l-132 84.3 132 84.3-132 83.6L0 284.1l132.3-84.3L0 116.3 132.3 32l132.1 84.3zM131.6 395.7l132-84.3 132 84.3-132 83.6L395.7 32 528 116.3l-132.3 83.5L528 283.4l-132.3 84.3-131.3-83.6z" />
    </svg>
  );
}

// ─── QR Code helper ───────────────────────────────────────────────────────────

function QRCodeDisplay({ url }: { url: string }) {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  useEffect(() => {
    const encoded = encodeURIComponent(url);
    setQrSrc(`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encoded}`);
  }, [url]);
  if (!qrSrc) return <div className="w-[200px] h-[200px] bg-gray-100 rounded-lg animate-pulse" />;
  return <img src={qrSrc} alt="Código QR para subir desde móvil" className="w-[160px] h-[160px] rounded-lg border border-gray-200" />;
}

// ─── Phone Upload Tab ─────────────────────────────────────────────────────────

function PhoneUploadTab({ onFileReceived }: { onFileReceived: (file: File) => void }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState(false);
  const supabase = createClient();

  const generateQR = async () => {
    setGenerating(true);
    setError(null);
    setReceived(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('La sesion no es valida.');
      const res = await fetch('/api/mobile-upload/create-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar QR');
      setSessionToken(data.token);
      setExpiresAt(new Date(data.expiresAt));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) { clearInterval(interval); setSessionToken(null); setExpiresAt(null); }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  useEffect(() => {
    if (!sessionToken) return;
    const channel = supabase
      .channel(`mobile-upload-${sessionToken}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mobile_upload_sessions', filter: `token=eq.${sessionToken}` },
        (payload: any) => {
          const row = payload.new;
          if (row.status === 'completed') {
            supabase.auth.getSession().then(({ data: { session } }) => fetch(`/api/mobile-upload/get-file?token=${sessionToken}`, {
              headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
            }))
              .then((r) => r.json())
              .then((data) => {
                if (data.fileData) {
                  const byteString = atob(data.fileData);
                  const ab = new ArrayBuffer(byteString.length);
                  const ia = new Uint8Array(ab);
                  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                  const blob = new Blob([ab], { type: data.fileType || 'application/octet-stream' });
                  const file = new File([blob], data.fileName || 'documento', { type: data.fileType });
                  setReceived(true);
                  setSessionToken(null);
                  onFileReceived(file);
                }
              })
              .catch(() => setError('Error al recuperar el archivo del móvil.'));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionToken, supabase, onFileReceived]);

  const mobileUrl = sessionToken ? `${process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '')}/subir-movil/${sessionToken}` : null;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const expired = sessionToken && timeLeft === 0;

  return (
    <div className="flex flex-col items-center py-6 px-4">
      {received ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center">
            <CheckCircle2 size={28} className="text-emerald-500" />
          </div>
          <p className="text-base font-semibold text-gray-900">¡Archivo recibido!</p>
          <p className="text-sm text-gray-500 text-center">El documento fue cargado desde tu teléfono.</p>
        </div>
      ) : !sessionToken ? (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <Smartphone size={28} className="text-primary" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-800 mb-1">Subir desde tu teléfono</p>
            <p className="text-xs text-gray-500">Genera un código QR y escanéalo con tu teléfono para subir un documento directamente desde tu dispositivo móvil.</p>
          </div>
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 w-full">
              <AlertTriangle size={14} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}
          <button onClick={generateQR} disabled={generating} className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60">
            {generating ? (<><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Generando…</>) : (<><Smartphone size={15} />Generar código QR</>)}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-800 mb-1">Escanea el código QR</p>
            <p className="text-xs text-gray-500">Abre la cámara de tu teléfono y escanea el código para subir tu documento.</p>
          </div>
          {mobileUrl && <QRCodeDisplay url={mobileUrl} />}
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${timeLeft < 60 ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
            <Clock size={14} />
            {expired ? 'Código expirado' : `Válido por ${minutes}:${String(seconds).padStart(2, '0')}`}
          </div>
          <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            <svg className="animate-pulse h-3 w-3 text-blue-500" fill="currentColor" viewBox="0 0 8 8"><circle cx="3" cy="3" r="4" /></svg>
            <span className="text-xs text-blue-600">Esperando archivo desde el móvil…</span>
          </div>
          <button onClick={() => { setSessionToken(null); setExpiresAt(null); }} className="text-xs text-gray-400 hover:text-gray-600 underline transition-colors">
            Cancelar y generar nuevo código
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Search Field + Modal (replaces FavoriteSearchableSelect) ─────────────────

interface SearchModalOption {
  id: string;
  label: string;
}

function SearchFieldWithModal({
  label,
  value,
  options,
  onSelect,
  placeholder,
  storageKey,
  userId,
  loading,
  disabled,
  required,
}: {
  label: string;
  value: string;
  options: SearchModalOption[];
  onSelect: (id: string) => void;
  placeholder?: string;
  storageKey: string;
  userId?: string;
  loading?: boolean;
  disabled?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'todos' | 'favoritos'>('todos');

  const selectedLabel = options.find((o) => o.id === value)?.label ?? '';

  useEffect(() => {
    if (!userId || !storageKey) return;
    const supabase = createClient();
    supabase
      .from('user_favorites')
      .select('item_id')
      .eq('user_id', userId)
      .eq('storage_key', storageKey)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data) setFavorites(data.map((r: { item_id: string }) => r.item_id));
      });
  }, [userId, storageKey]);

  const toggleFavorite = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!userId) return;
    const isFav = favorites.includes(id);
    setFavorites((prev) => isFav ? prev.filter((f) => f !== id) : [...prev, id]);
    const supabase = createClient();
    if (isFav) {
      await supabase.from('user_favorites').delete().eq('user_id', userId).eq('storage_key', storageKey).eq('item_id', id);
    } else {
      await supabase.from('user_favorites').upsert({ user_id: userId, storage_key: storageKey, item_id: id }, { onConflict: 'user_id,storage_key,item_id' });
    }
  };

  const filtered = options.filter((o) => {
    const matchSearch = o.label.toLowerCase().includes(search.toLowerCase());
    if (activeTab === 'favoritos') return matchSearch && favorites.includes(o.id);
    return matchSearch;
  });

  const sortedFiltered = [...filtered].sort((a, b) => {
    const aFav = favorites.includes(a.id);
    const bFav = favorites.includes(b.id);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return a.label.localeCompare(b.label, 'es');
  });

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
    setSearch('');
  };

  return (
    <>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            readOnly
            value={selectedLabel}
            placeholder={loading ? 'Cargando...' : (placeholder ?? 'Seleccionar...')}
            disabled={disabled || loading}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white cursor-default disabled:bg-gray-50 disabled:text-gray-400 pr-8"
          />
          {value && (
            <button
              type="button"
              onClick={() => onSelect('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => { if (!disabled && !loading) { setOpen(true); setSearch(''); setActiveTab('todos'); } }}
          disabled={disabled || loading}
          className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white"
        >
          <Search size={14} />
          Buscar
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">{label}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 pt-4 pb-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex gap-1 mt-3">
                <button
                  onClick={() => setActiveTab('todos')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeTab === 'todos' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setActiveTab('favoritos')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1 ${activeTab === 'favoritos' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  <Star size={11} />Favoritos {favorites.length > 0 && `(${favorites.length})`}
                </button>
              </div>
            </div>
            <div className="px-5 pb-4 max-h-64 overflow-y-auto">
              {sortedFiltered.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">
                  {activeTab === 'favoritos' ? 'No tienes favoritos aún' : 'Sin resultados'}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {sortedFiltered.map((opt) => {
                    const isFav = favorites.includes(opt.id);
                    const isSelected = value === opt.id;
                    return (
                      <div
                        key={opt.id}
                        onClick={() => handleSelect(opt.id)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 text-gray-700'}`}
                      >
                        <span className="flex-1 text-sm">{opt.label}</span>
                        {isSelected && <CheckCircle2 size={14} className="text-primary shrink-0" />}
                        <button
                          type="button"
                          onClick={(e) => toggleFavorite(e, opt.id)}
                          className={`shrink-0 transition-colors ${isFav ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'}`}
                        >
                          <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Etiquetas Search Field + Modal ───────────────────────────────────────────

function EtiquetasSearchFieldWithModal({
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
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'todos' | 'favoritos'>('todos');
  const storageKey = 'fav_etiquetas';

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase
      .from('user_favorites')
      .select('item_id')
      .eq('user_id', userId)
      .eq('storage_key', storageKey)
      .then(({ data }) => {
        if (data) setFavorites(data.map((r: { item_id: string }) => r.item_id));
      });
  }, [userId]);

  const toggleFavorite = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!userId) return;
    const isFav = favorites.includes(id);
    setFavorites((prev) => isFav ? prev.filter((f) => f !== id) : [...prev, id]);
    const supabase = createClient();
    if (isFav) {
      await supabase.from('user_favorites').delete().eq('user_id', userId).eq('storage_key', storageKey).eq('item_id', id);
    } else {
      await supabase.from('user_favorites').upsert({ user_id: userId, storage_key: storageKey, item_id: id }, { onConflict: 'user_id,storage_key,item_id' });
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const filtered = etiquetas.filter((e) => {
    const matchSearch = e.nombre.toLowerCase().includes(search.toLowerCase());
    if (activeTab === 'favoritos') return matchSearch && favorites.includes(e.id);
    return matchSearch;
  });

  const selectedLabels = etiquetas.filter((e) => selectedIds.includes(e.id)).map((e) => e.nombre).join(', ');
  const selectedEtiquetas = etiquetas.filter((e) => selectedIds.includes(e.id));

  return (
    <>
      <div className="flex gap-2">
        <div
          className={`flex-1 relative flex flex-wrap items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 min-h-[42px] bg-white ${loading ? 'bg-gray-50' : ''}`}
        >
          {selectedEtiquetas.length === 0 ? (
            <span className={`text-sm ${loading ? 'text-gray-400' : 'text-gray-400'}`}>
              {loading ? 'Cargando...' : 'Seleccionar etiquetas...'}
            </span>
          ) : (
            <>
              {selectedEtiquetas.map((e) => (
                <span
                  key={e.id}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: e.color ? `${e.color}22` : '#6366f122',
                    color: e.color || '#6366f1',
                    border: `1px solid ${e.color ? `${e.color}55` : '#6366f155'}`,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: e.color || '#6366f1' }}
                  />
                  {e.nombre}
                  <button
                    type="button"
                    onClick={() => toggleSelect(e.id)}
                    className="ml-0.5 hover:opacity-70 transition-opacity"
                    style={{ color: e.color || '#6366f1' }}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => { if (!loading) { setOpen(true); setSearch(''); setActiveTab('todos'); } }}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white"
        >
          <Search size={14} />
          Buscar
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Etiquetas</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 pt-4 pb-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar etiqueta..."
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex gap-1 mt-3">
                <button
                  onClick={() => setActiveTab('todos')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeTab === 'todos' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setActiveTab('favoritos')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1 ${activeTab === 'favoritos' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  <Star size={11} />Favoritos {favorites.length > 0 && `(${favorites.length})`}
                </button>
              </div>
              {selectedIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {etiquetas.filter((e) => selectedIds.includes(e.id)).map((e) => (
                    <span key={e.id} className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full">
                      {e.nombre}
                      <button onClick={() => toggleSelect(e.id)} className="hover:text-primary/70"><X size={10} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="px-5 pb-4 max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">
                  {activeTab === 'favoritos' ? 'No tienes favoritos aún' : 'Sin resultados'}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filtered.map((etq) => {
                    const isFav = favorites.includes(etq.id);
                    const isSelected = selectedIds.includes(etq.id);
                    return (
                      <div
                        key={etq.id}
                        onClick={() => toggleSelect(etq.id)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 text-gray-700'}`}
                      >
                        <span className="flex-1 text-sm">{etq.nombre}</span>
                        {isSelected && <CheckCircle2 size={14} className="text-primary shrink-0" />}
                        <button
                          type="button"
                          onClick={(e) => toggleFavorite(e, etq.id)}
                          className={`shrink-0 transition-colors ${isFav ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'}`}
                        >
                          <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Confirmar ({selectedIds.length} seleccionadas)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Merged Document Type Selector Modal ──────────────────────────────────────

interface DocTypeOption {
  grupoId: string;
  grupoNombre: string;
  tipoId: string;
  tipoNombre: string;
  tipoDescripcion?: string | null;
}

function DocumentTypeSelectorModal({
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
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'favoritos' | 'por_grupo' | 'libre'>('libre');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Build flat list of all options — sorted A-Z by tipo name
  const allOptions: DocTypeOption[] = grupos.flatMap((g) =>
    (tiposDocumento[g.id] || []).map((t) => ({
      grupoId: g.id,
      grupoNombre: g.nombre,
      tipoId: t.id,
      tipoNombre: t.nombre,
      tipoDescripcion: t.descripcion,
    }))
  ).sort((a, b) => a.tipoNombre.localeCompare(b.tipoNombre, 'es'));

  // Derive selected label — show only tipo name in the field
  const selectedGrupo = grupos.find((g) => g.id === selectedGrupoId);
  const selectedTipoLabel = (() => {
    if (!selectedGrupoId || !selectedTipoId) return '';
    if (selectedTipoId === '__otros__') return `Otro`;
    const tipos = tiposDocumento[selectedGrupoId] || [];
    const tipo = tipos.find((t) => t.id === selectedTipoId);
    if (!tipo) return '';
    return tipo.nombre;
  })();

  // Load favorites from Supabase
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase
      .from('user_favorites')
      .select('item_id')
      .eq('user_id', userId)
      .eq('storage_key', 'fav_doctype_merged')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data) setFavorites(data.map((r: { item_id: string }) => r.item_id));
      });
  }, [userId]);

  const toggleFavorite = async (e: React.MouseEvent, compositeId: string) => {
    e.stopPropagation();
    if (!userId) return;
    const isFav = favorites.includes(compositeId);
    setFavorites((prev) => (isFav ? prev.filter((f) => f !== compositeId) : [...prev, compositeId]));
    const supabase = createClient();
    if (isFav) {
      await supabase.from('user_favorites').delete().eq('user_id', userId).eq('storage_key', 'fav_doctype_merged').eq('item_id', compositeId);
    } else {
      await supabase.from('user_favorites').upsert(
        { user_id: userId, storage_key: 'fav_doctype_merged', item_id: compositeId },
        { onConflict: 'user_id,storage_key,item_id' }
      );
    }
  };

  const handleSelect = (grupoId: string, tipoId: string) => {
    onSelect(grupoId, tipoId);
    setOpen(false);
    setSearch('');
  };

  const handleClear = () => {
    onSelect('', '');
  };

  const toggleGroup = (grupoId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(grupoId)) next.delete(grupoId);
      else next.add(grupoId);
      return next;
    });
  };

  // Tab: Favoritos
  const favOptions = allOptions.filter((o) => favorites.includes(`${o.grupoId}::${o.tipoId}`));
  const filteredFavs = favOptions.filter(
    (o) =>
      o.tipoNombre.toLowerCase().includes(search.toLowerCase()) ||
      o.grupoNombre.toLowerCase().includes(search.toLowerCase())
  );

  // Tab: Libre (free search across all)
  const filteredLibre = allOptions.filter(
    (o) =>
      o.tipoNombre.toLowerCase().includes(search.toLowerCase()) ||
      o.grupoNombre.toLowerCase().includes(search.toLowerCase()) ||
      (o.tipoDescripcion || '').toLowerCase().includes(search.toLowerCase())
  );

  // Tab: Por grupo
  const filteredGrupos = grupos.filter((g) => {
    const tipos = tiposDocumento[g.id] || [];
    if (search.trim() === '') return tipos.length > 0;
    return tipos.some(
      (t) =>
        t.nombre.toLowerCase().includes(search.toLowerCase()) ||
        g.nombre.toLowerCase().includes(search.toLowerCase()) ||
        (t.descripcion || '').toLowerCase().includes(search.toLowerCase())
    );
  });

  const isSelected = (grupoId: string, tipoId: string) =>
    selectedGrupoId === grupoId && selectedTipoId === tipoId;

  const tabCount = {
    favoritos: favOptions.length,
    libre: allOptions.length,
  };

  return (
    <>
      {/* Trigger field */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            readOnly
            value={selectedTipoLabel}
            placeholder={loading ? 'Cargando...' : 'Seleccionar tipo de documento...'}
            disabled={disabled || loading}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white cursor-default disabled:bg-gray-50 disabled:text-gray-400 pr-8"
          />
          {(selectedGrupoId || selectedTipoId) && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (!disabled && !loading) {
              setOpen(true);
              setSearch('');
              setActiveTab('libre');
            }
          }}
          disabled={disabled || loading}
          className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white"
        >
          <Search size={14} />
          Buscar
        </button>
      </div>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden flex flex-col"
            style={{ maxHeight: '85vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-primary" />
                <h3 className="text-base font-semibold text-gray-900">Tipo de documento</h3>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Search bar */}
            <div className="px-5 pt-4 pb-3 border-b border-gray-100">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar tipo o documento..."
                  className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 px-5 pt-3 pb-3">
              {(
                [
                  { id: 'libre', label: 'Por tipo', count: tabCount.libre },
                  { id: 'favoritos', label: 'Favoritos', count: tabCount.favoritos },
                  { id: 'por_grupo', label: 'Por grupo', count: null },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {tab.id === 'favoritos' && <Star size={13} />}
                  {tab.label}
                  {tab.count !== null && tab.count > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-5 py-3" style={{ minHeight: 0 }}>
              {/* ── Favoritos tab ── */}
              {activeTab === 'favoritos' && (
                <>
                  {filteredFavs.length === 0 ? (
                    <div className="py-10 text-center">
                      <Star size={28} className="text-gray-200 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">
                        {search ? 'Sin resultados en favoritos' : 'Aún no tienes favoritos. Márcalos con ★ en las otras pestañas.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {filteredFavs.map((opt) => {
                        const compositeId = `${opt.grupoId}::${opt.tipoId}`;
                        const isFav = favorites.includes(compositeId);
                        const sel = isSelected(opt.grupoId, opt.tipoId);
                        return (
                          <div
                            key={compositeId}
                            onClick={() => handleSelect(opt.grupoId, opt.tipoId)}
                            className={`flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${sel ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 text-gray-700'}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{opt.tipoNombre}</p>
                              <p className="text-xs text-gray-400 truncate">{opt.grupoNombre}</p>
                              {opt.tipoDescripcion && (
                                <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{opt.tipoDescripcion}</p>
                              )}
                            </div>
                            {sel && <CheckCircle2 size={14} className="text-primary shrink-0 mt-0.5" />}
                            <button
                              type="button"
                              onClick={(e) => toggleFavorite(e, compositeId)}
                              className={`shrink-0 transition-colors mt-0.5 ${isFav ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'}`}
                            >
                              <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* ── Por grupo tab ── */}
              {activeTab === 'por_grupo' && (
                <>
                  {filteredGrupos.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-400">Sin resultados</div>
                  ) : (
                    <div className="space-y-2">
                      {filteredGrupos.map((grupo) => {
                        const tipos = (tiposDocumento[grupo.id] || []).filter(
                          (t) =>
                            search.trim() === '' ||
                            t.nombre.toLowerCase().includes(search.toLowerCase()) ||
                            grupo.nombre.toLowerCase().includes(search.toLowerCase()) ||
                            (t.descripcion || '').toLowerCase().includes(search.toLowerCase())
                        );
                        const isExpanded = expandedGroups.has(grupo.id) || search.trim() !== '';
                        return (
                          <div key={grupo.id} className="border border-gray-100 rounded-xl overflow-hidden">
                            {/* Group header */}
                            <button
                              type="button"
                              onClick={() => toggleGroup(grupo.id)}
                              className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-800">{grupo.nombre}</p>
                                <p className="text-xs text-gray-400">{tipos.length} documento{tipos.length !== 1 ? 's' : ''}</p>
                              </div>
                              <ChevronRight
                                size={15}
                                className={`text-gray-400 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                              />
                            </button>
                            {/* Group items */}
                            {isExpanded && (
                              <div className="divide-y divide-gray-50">
                                {tipos.length === 0 ? (
                                  <p className="px-4 py-3 text-xs text-gray-400">Sin documentos en este grupo</p>
                                ) : (
                                  tipos.map((tipo) => {
                                    const compositeId = `${grupo.id}::${tipo.id}`;
                                    const isFav = favorites.includes(compositeId);
                                    const sel = isSelected(grupo.id, tipo.id);
                                    return (
                                      <div
                                        key={tipo.id}
                                        onClick={() => handleSelect(grupo.id, tipo.id)}
                                        className={`flex items-start gap-2 px-4 py-3 cursor-pointer transition-colors ${sel ? 'bg-primary/10' : 'hover:bg-gray-50'}`}
                                      >
                                        <div className="flex-1 min-w-0">
                                          <p className={`text-sm font-medium ${sel ? 'text-primary' : 'text-gray-800'}`}>{tipo.nombre}</p>
                                          {tipo.descripcion && (
                                            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{tipo.descripcion}</p>
                                          )}
                                        </div>
                                        {sel && <CheckCircle2 size={14} className="text-primary shrink-0 mt-0.5" />}
                                        <button
                                          type="button"
                                          onClick={(e) => toggleFavorite(e, compositeId)}
                                          className={`shrink-0 transition-colors mt-0.5 ${isFav ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'}`}
                                        >
                                          <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                                        </button>
                                      </div>
                                    );
                                  })
                                )}
                                {/* "Otro" option per group */}
                                {search.trim() === '' && (
                                  (() => {
                                    const compositeId = `${grupo.id}::__otros__`;
                                    const isFav = favorites.includes(compositeId);
                                    const sel = isSelected(grupo.id, '__otros__');
                                    return (
                                      <div
                                        onClick={() => handleSelect(grupo.id, '__otros__')}
                                        className={`flex items-start gap-2 px-4 py-3 cursor-pointer transition-colors ${sel ? 'bg-primary/10' : 'hover:bg-gray-50'}`}
                                      >
                                        <div className="flex-1 min-w-0">
                                          <p className={`text-sm font-medium italic ${sel ? 'text-primary' : 'text-gray-500'}`}>Otro</p>
                                          <p className="text-xs text-gray-400 mt-0.5">Especificar manualmente</p>
                                        </div>
                                        {sel && <CheckCircle2 size={14} className="text-primary shrink-0 mt-0.5" />}
                                        <button
                                          type="button"
                                          onClick={(e) => toggleFavorite(e, compositeId)}
                                          className={`shrink-0 transition-colors mt-0.5 ${isFav ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'}`}
                                        >
                                          <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                                        </button>
                                      </div>
                                    );
                                  })()
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* ── Libre tab ── */}
              {activeTab === 'libre' && (
                <>
                  {filteredLibre.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-400">Sin resultados</div>
                  ) : (
                    <div className="space-y-0.5">
                      {filteredLibre.map((opt) => {
                        const compositeId = `${opt.grupoId}::${opt.tipoId}`;
                        const isFav = favorites.includes(compositeId);
                        const sel = isSelected(opt.grupoId, opt.tipoId);
                        return (
                          <div
                            key={compositeId}
                            onClick={() => handleSelect(opt.grupoId, opt.tipoId)}
                            className={`flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${sel ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 text-gray-700'}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{opt.tipoNombre}</p>
                              <p className="text-xs text-gray-400 truncate">{opt.grupoNombre}</p>
                              {opt.tipoDescripcion && (
                                <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{opt.tipoDescripcion}</p>
                              )}
                            </div>
                            {sel && <CheckCircle2 size={14} className="text-primary shrink-0 mt-0.5" />}
                            <button
                              type="button"
                              onClick={(e) => toggleFavorite(e, compositeId)}
                              className={`shrink-0 transition-colors mt-0.5 ${isFav ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'}`}
                            >
                              <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Metadata Modal ───────────────────────────────────────────────────────────

interface MetaEtiqueta {
  clave: string;
  valor: string;
}

function MetadatosModal({
  documentoId,
  onClose,
  onSaved,
}: {
  documentoId?: string;
  onClose: () => void;
  onSaved?: (metaetiquetas: MetaEtiqueta[]) => void;
}) {
  const [metaetiquetas, setMetaetiquetas] = useState<MetaEtiqueta[]>([{ clave: '', valor: '' }]);
  const [savedMetaetiquetas, setSavedMetaetiquetas] = useState<(MetaEtiqueta & { id?: string })[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<MetaEtiqueta>({ clave: '', valor: '' });
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [view, setView] = useState<'list' | 'add'>('list');

  // Load existing metaetiquetas
  useEffect(() => {
    if (!documentoId) { setView('add'); return; }
    const load = async () => {
      setLoadingExisting(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('document_metaetiquetas')
          .select('id, clave, valor')
          .eq('documento_id', documentoId)
          .order('created_at', { ascending: true });
        if (data && data.length > 0) {
          setSavedMetaetiquetas(data);
          setView('list');
        } else {
          setView('add');
        }
      } catch { /* silent */ }
      finally { setLoadingExisting(false); }
    };
    load();
  }, [documentoId]);

  const addRow = () => setMetaetiquetas((prev) => [...prev, { clave: '', valor: '' }]);
  const removeRow = (idx: number) => setMetaetiquetas((prev) => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, field: 'clave' | 'valor', value: string) => {
    setMetaetiquetas((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  };

  const handleSave = async () => {
    const valid = metaetiquetas.filter((m) => m.clave.trim() !== '');
    if (valid.length === 0) { setError('Agrega al menos una metaetiqueta con clave.'); return; }
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) throw new Error('No autenticado');

      if (documentoId) {
        const rows = valid.map((m) => ({
          documento_id: documentoId,
          clave: m.clave.trim(),
          valor: m.valor.trim(),
          user_id: session.user.id,
        }));
        const { error: dbError } = await supabase
          .from('document_metaetiquetas')
          .upsert(rows, { onConflict: 'documento_id,clave' });
        if (dbError) throw dbError;
        // Reload saved
        const { data: refreshed } = await supabase
          .from('document_metaetiquetas')
          .select('id, clave, valor')
          .eq('documento_id', documentoId)
          .order('created_at', { ascending: true });
        if (refreshed) setSavedMetaetiquetas(refreshed);
      }
      setSaved(true);
      onSaved?.(valid);
      setMetaetiquetas([{ clave: '', valor: '' }]);
      setTimeout(() => { setSaved(false); setView('list'); }, 1200);
    } catch (err: any) {
      setError(err.message || 'Error al guardar metaetiquetas');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (idx: number) => {
    const item = savedMetaetiquetas[idx];
    if (!item || !documentoId) return;
    setDeletingIdx(idx);
    try {
      const supabase = createClient();
      if (item.id) {
        await supabase.from('document_metaetiquetas').delete().eq('id', item.id);
      } else {
        await supabase.from('document_metaetiquetas').delete().eq('documento_id', documentoId).eq('clave', item.clave);
      }
      setSavedMetaetiquetas((prev) => prev.filter((_, i) => i !== idx));
    } catch { /* silent */ }
    finally { setDeletingIdx(null); }
  };

  const handleEditSave = async (idx: number) => {
    const item = savedMetaetiquetas[idx];
    if (!item || !documentoId) return;
    setSaving(true);
    try {
      const supabase = createClient();
      if (item.id) {
        await supabase.from('document_metaetiquetas').update({ clave: editValues.clave.trim(), valor: editValues.valor.trim() }).eq('id', item.id);
      }
      setSavedMetaetiquetas((prev) => prev.map((m, i) => i === idx ? { ...m, clave: editValues.clave, valor: editValues.valor } : m));
      setEditingIdx(null);
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Tag size={18} className="text-primary" />
            <h3 className="text-base font-semibold text-gray-900">Metaetiquetas del documento</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
        </div>

        {loadingExisting ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          </div>
        ) : (
          <>
            {/* Saved metaetiquetas list */}
            {savedMetaetiquetas.length > 0 && (
              <div className="px-5 pt-4 pb-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Metaetiquetas guardadas ({savedMetaetiquetas.length})</p>
                  <button type="button" onClick={() => setView(view === 'add' ? 'list' : 'add')} className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1">
                    {view === 'add' ? (
                      <><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>Ver lista</>
                    ) : (
                      <><Plus size={12} />Agregar más</>
                    )}
                  </button>
                </div>
                {view === 'list' && (
                  <div className="space-y-1.5 mb-3 max-h-48 overflow-y-auto">
                    {savedMetaetiquetas.map((m, idx) => (
                      <div key={idx} className="border border-gray-100 rounded-lg bg-gray-50 px-3 py-2">
                        {editingIdx === idx ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editValues.clave}
                              onChange={(e) => setEditValues((v) => ({ ...v, clave: e.target.value }))}
                              className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                              placeholder="Clave"
                            />
                            <span className="text-gray-400 text-xs">:</span>
                            <input
                              type="text"
                              value={editValues.valor}
                              onChange={(e) => setEditValues((v) => ({ ...v, valor: e.target.value }))}
                              className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                              placeholder="Valor"
                            />
                            <button type="button" onClick={() => handleEditSave(idx)} disabled={saving} className="text-emerald-600 hover:text-emerald-700 p-1">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            </button>
                            <button type="button" onClick={() => setEditingIdx(null)} className="text-gray-400 hover:text-gray-600 p-1"><X size={14} /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-700 flex-1 truncate">{m.clave}</span>
                            <span className="text-gray-400 text-xs">:</span>
                            <span className="text-xs text-gray-600 flex-1 truncate">{m.valor || <span className="text-gray-400 italic">sin valor</span>}</span>
                            <button type="button" onClick={() => { setEditingIdx(idx); setEditValues({ clave: m.clave, valor: m.valor }); }} className="text-gray-400 hover:text-primary transition-colors p-1" title="Editar">
                              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button type="button" onClick={() => handleDelete(idx)} disabled={deletingIdx === idx} className="text-gray-400 hover:text-red-500 transition-colors p-1 disabled:opacity-50" title="Eliminar">
                              {deletingIdx === idx ? (
                                <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                              ) : (
                                <X size={13} />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Add new metaetiquetas form */}
            {(view === 'add' || savedMetaetiquetas.length === 0) && (
              <div className="px-5 py-4 flex-1 overflow-y-auto">
                {savedMetaetiquetas.length === 0 && (
                  <p className="text-sm text-gray-500 mb-4">Define pares clave-valor para clasificar y buscar este documento. Se guardarán vinculadas al documento.</p>
                )}
                <div className="space-y-2 mb-3">
                  {metaetiquetas.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={m.clave}
                        onChange={(e) => updateRow(idx, 'clave', e.target.value)}
                        placeholder="Clave (ej: departamento)"
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <span className="text-gray-400 text-sm">:</span>
                      <input
                        type="text"
                        value={m.valor}
                        onChange={(e) => updateRow(idx, 'valor', e.target.value)}
                        placeholder="Valor (ej: legal)"
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button type="button" onClick={() => removeRow(idx)} disabled={metaetiquetas.length === 1} className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-30 p-1">
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addRow} className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors">
                  <Plus size={14} />Agregar metaetiqueta
                </button>
                {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
                {saved && <p className="mt-3 text-xs text-emerald-600 font-medium">✓ Metaetiquetas guardadas correctamente</p>}
              </div>
            )}
          </>
        )}

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cerrar</button>
          {(view === 'add' || savedMetaetiquetas.length === 0) && (
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-2">
              {saving && <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
              Guardar metaetiquetas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Access Code Modal ────────────────────────────────────────────────────────
function CodigoAccesoModal({
  documentoId,
  existingCode,
  onClose,
  onSaved,
  onDeleted,
}: {
  documentoId?: string;
  existingCode?: string;
  onClose: () => void;
  onSaved: (code: string) => void;
  onDeleted: () => void;
}) {
  const isEditing = !!existingCode;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const getStrength = (code: string) => {
    if (!code) return null;
    let score = 0;
    if (code.length >= 6) score++;
    if (code.length >= 10) score++;
    if (/[A-Z]/.test(code)) score++;
    if (/[0-9]/.test(code)) score++;
    if (/[!@#$%^&*]/.test(code)) score++;
    if (score <= 2) return { level: 'weak', label: 'Débil', color: 'bg-red-400', textColor: 'text-red-500' };
    if (score <= 3) return { level: 'medium', label: 'Media', color: 'bg-amber-400', textColor: 'text-amber-500' };
    return { level: 'strong', label: 'Fuerte', color: 'bg-emerald-500', textColor: 'text-emerald-600' };
  };

  const strength = getStrength(password);

  const handleSave = async () => {
    if (!password) { setError('Ingresa una contraseña.'); return; }
    if (password.length < 4) { setError('Mínimo 4 caracteres.'); return; }
    if (password !== confirmPassword) { setError('Las contraseñas no coinciden.'); return; }
    setSaving(true);
    setError(null);
    try {
      if (documentoId) {
        const supabase = createClient();
        await supabase.from('document_security_settings').upsert({
          documento_id: documentoId,
          codigo_acceso_enabled: true,
          codigo_acceso: password,
        }, { onConflict: 'documento_id' });
      }
      setSaved(true);
      onSaved(password);
      setTimeout(() => onClose(), 1000);
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      if (documentoId) {
        const supabase = createClient();
        await supabase.from('document_security_settings').upsert({
          documento_id: documentoId,
          codigo_acceso_enabled: false,
          codigo_acceso: null,
        }, { onConflict: 'documento_id' });
      }
      onDeleted();
      onClose();
    } catch { /* silent */ }
    finally { setDeleting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-primary" />
            <h3 className="text-base font-semibold text-gray-900">{isEditing ? 'Cambiar código de acceso' : 'Establecer código de acceso'}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-500">
            {isEditing
              ? 'Ingresa una nueva contraseña para reemplazar la actual. Los participantes deberán usarla para acceder al documento.'
              : 'Define una contraseña que los participantes deberán ingresar para acceder al documento en el visor y en Mi Espacio.'}
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Nueva contraseña</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="Mínimo 4 caracteres"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 pr-10"
                autoFocus
              />
              <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {strength && (
              <div className="mt-1.5 space-y-1">
                <div className="flex gap-1">
                  {(['weak', 'medium', 'strong'] as const).map((level, i) => (
                    <div key={level} className={`h-1.5 flex-1 rounded-full transition-colors ${
                      (strength.level === 'weak' && i === 0) ||
                      (strength.level === 'medium' && i <= 1) ||
                      (strength.level === 'strong' && i <= 2)
                        ? strength.color : 'bg-gray-200'
                    }`} />
                  ))}
                </div>
                <p className={`text-xs font-medium ${strength.textColor}`}>Seguridad: {strength.label}</p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Confirmar contraseña</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                placeholder="Repite la contraseña"
                className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 pr-10 transition-colors ${
                  confirmPassword && confirmPassword !== password
                    ? 'border-red-300 focus:ring-red-200'
                    : confirmPassword && confirmPassword === password
                    ? 'border-emerald-300 focus:ring-emerald-200' :'border-gray-200 focus:ring-primary/30'
                }`}
              />
              <button type="button" onClick={() => setShowConfirm((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {confirmPassword && confirmPassword === password && (
              <p className="mt-1 text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 size={11} />Las contraseñas coinciden
              </p>
            )}
          </div>

          {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={11} />{error}</p>}
          {saved && <p className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 size={11} />Código guardado correctamente</p>}

          {isEditing && !confirmDelete && (
            <button type="button" onClick={() => setConfirmDelete(true)} className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-red-200 text-red-500 rounded-lg text-sm hover:bg-red-50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              Eliminar código de acceso
            </button>
          )}

          {confirmDelete && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
              <p className="text-xs text-red-700 font-medium">¿Confirmas que deseas eliminar el código de acceso? El documento quedará sin protección de contraseña.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmDelete(false)} className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">Cancelar</button>
                <button type="button" onClick={handleDelete} disabled={deleting} className="flex-1 px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-60">
                  {deleting ? 'Eliminando...' : 'Sí, eliminar'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving || saved} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-2">
            {saving && <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
            {isEditing ? 'Cambiar contraseña' : 'Guardar contraseña'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── File Uploaded Layout ─────────────────────────────────────────────────────

function FileUploadedLayout({
  file,
  onRemove,
  config,
  onConfigChange,
  viewMode,
  onGuardarAvance,
  savingDraft,
  onSecurityChange,
  documentoId,
  onPdfMetadata,
}: {
  file: File;
  onRemove: () => void;
  config: DocumentConfig;
  onConfigChange: (c: DocumentConfig) => void;
  viewMode: 'split' | 'stacked';
  onGuardarAvance: () => void;
  savingDraft: boolean;
  onSecurityChange?: (s: import('./types').SecuritySettings & { urgente: boolean; publico: boolean; selloDigital: boolean; selloUbicacion: 'calce' | 'libre'; estampaAutenticacion: boolean; metadatosAdicionales: boolean; leyendasDocumento: boolean }) => void;
  documentoId?: string;
  onPdfMetadata?: (meta: { pageCount: number; title?: string; author?: string; creationDate?: string }) => void;
}) {
  const { user } = useAuth();
  const [userId, setUserId] = useState<string | undefined>(user?.id);

  useEffect(() => {
    if (user?.id) {
      setUserId(user.id);
      return;
    }
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setUserId(session.user.id);
    });
  }, [user?.id]);

  // Default to 'general' tab (Configuración general first)
  const [activeTab, setActiveTab] = useState<'seguridad' | 'general'>('general');
  const [vencimiento, setVencimiento] = useState(false);
  // Vencimiento sub-options
  const [vencimientoSolicitud, setVencimientoSolicitud] = useState(false);
  const [vencimientoCompletar, setVencimientoCompletar] = useState(false);
  const [incluirHoraVencimiento, setIncluirHoraVencimiento] = useState(false);
  const [presetVencimiento, setPresetVencimiento] = useState<'24h' | '3d' | '7d' | '15d' | '30d' | 'personalizado'>('7d');
  const [fechaVencimientoPersonalizado, setFechaVencimientoPersonalizado] = useState('');
  const [horaVencimiento, setHoraVencimiento] = useState('23:59');
  const [zonaHoraria, setZonaHoraria] = useState('America/Mexico_City');
  const [diasHabiles, setDiasHabiles] = useState(false);
  const [recordatorioEnabled, setRecordatorioEnabled] = useState(false);
  const [recordatorioCuando, setRecordatorioCuando] = useState<'diario' | '48h' | '24h' | '6h'>('24h');

  const [codigoAcceso, setCodigoAcceso] = useState(false);
  const [codigoAccesoValue, setCodigoAccesoValue] = useState('');
  const [showCodigoAccesoModal, setShowCodigoAccesoModal] = useState(false);
  const [proteccionFirmado, setProteccionFirmado] = useState(false);
  const [proteccionParticipacion, setProteccionParticipacion] = useState(false);
  const [urgente, setUrgente] = useState(false);
  const [publico, setPublico] = useState(false);
  const [selloDigital, setSelloDigital] = useState(false);
  const [selloUbicacion, setSelloUbicacion] = useState<'calce' | 'libre'>('calce');
  const [estampaAutenticacion, setEstampaAutenticacion] = useState(false);
  const [metadatosAdicionales, setMetadatosAdicionales] = useState(false);
  const [leyendasDocumento, setLeyendasDocumento] = useState(false);
  const [showMetadatosModal, setShowMetadatosModal] = useState(false);
  const [savedMetadatosCount, setSavedMetadatosCount] = useState(0);

  const [impedirImpresion, setImpedirImpresion] = useState(false);
  const [evitarCopiaTexto, setEvitarCopiaTexto] = useState(false);
  const [impedirModificacion, setImpedirModificacion] = useState(false);
  const [impedirExtraccion, setImpedirExtraccion] = useState(false);
  const [evitarMontaje, setEvitarMontaje] = useState(false);

  const [grupos, setGrupos] = useState<GrupoTipoDocumento[]>([]);
  // tiposDocumento is now a map: grupoId → TipoDocumento[]
  const [tiposDocumentoMap, setTiposDocumentoMap] = useState<Record<string, TipoDocumento[]>>({});
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // Compute effective fecha vencimiento from preset
  const getEffectiveFechaVencimiento = () => {
    if (presetVencimiento === 'personalizado') return fechaVencimientoPersonalizado;
    const now = new Date();
    const daysMap: Record<string, number> = { '24h': 1, '3d': 3, '7d': 7, '15d': 15, '30d': 30 };
    const days = daysMap[presetVencimiento] ?? 7;
    now.setDate(now.getDate() + days);
    return now.toISOString().split('T')[0];
  };

  const recordatorioFrecuencia = recordatorioEnabled ? recordatorioCuando : '';

  useEffect(() => {
    onSecurityChange?.({
      vencimientoEnabled: vencimiento,
      fechaVencimiento: getEffectiveFechaVencimiento(),
      recordatorioFrecuencia,
      codigoAccesoEnabled: codigoAcceso,
      codigoAcceso: codigoAccesoValue,
      proteccionAdicionalEnabled: proteccionFirmado,
      impedirImpresion,
      evitarCopiaTexto,
      impedirModificacion,
      impedirExtraccion,
      evitarMontaje,
      legalHoldEnabled: false,
      urgente,
      publico,
      selloDigital,
      selloUbicacion,
      estampaAutenticacion,
      metadatosAdicionales,
      leyendasDocumento,
      vencimientoSolicitud,
      vencimientoCompletar,
      proteccionParticipacionEnabled: proteccionParticipacion,
    } as any);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vencimiento, vencimientoSolicitud, vencimientoCompletar, incluirHoraVencimiento, presetVencimiento, fechaVencimientoPersonalizado, horaVencimiento, zonaHoraria, diasHabiles, recordatorioEnabled, recordatorioCuando, codigoAcceso, codigoAccesoValue, proteccionFirmado, proteccionParticipacion, impedirImpresion, evitarCopiaTexto, impedirModificacion, impedirExtraccion, evitarMontaje, urgente, publico, selloDigital, selloUbicacion, estampaAutenticacion, metadatosAdicionales, leyendasDocumento]);

  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  const fileSizeKB = (file.size / 1024).toFixed(2);

  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; });

  const autoNameSetRef = useRef<string | null>(null);

  useEffect(() => {
    if (autoNameSetRef.current === file.name) return;
    autoNameSetRef.current = file.name;
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
    onConfigChange({ ...configRef.current, nombre: nameWithoutExt });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.name]);

  // Load all data including all tipos for all grupos
  useEffect(() => {
    const loadData = async () => {
      setLoadingData(true);
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const safeJson = async (res: Response) => {
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) return {};
          return res.json();
        };
        const [gruposRes, etiquetasRes, carpetasRes] = await Promise.all([
          fetch('/api/documentos/grupos', { headers }).then(safeJson),
          fetch('/api/documentos/etiquetas', { headers }).then(safeJson),
          fetch('/api/documentos/carpetas', { headers }).then(safeJson),
        ]);
        const gruposData: GrupoTipoDocumento[] = gruposRes.data || [];
        if (gruposData.length > 0) {
          setGrupos(gruposData);
          // Load tipos for all groups in parallel
          const tiposResults = await Promise.all(
            gruposData.map((g) =>
              fetch(`/api/documentos/tipos?grupo_id=${g.id}`, { headers })
                .then(safeJson)
                .then((d) => ({ grupoId: g.id, tipos: (d.data || []) as TipoDocumento[] }))
                .catch(() => ({ grupoId: g.id, tipos: [] as TipoDocumento[] }))
            )
          );
          const map: Record<string, TipoDocumento[]> = {};
          tiposResults.forEach(({ grupoId, tipos }) => { map[grupoId] = tipos; });
          setTiposDocumentoMap(map);
        }
        if (etiquetasRes.data) setEtiquetas(etiquetasRes.data);
        if (carpetasRes.data) setCarpetas(carpetasRes.data);
      } catch (err) {
        console.error('loadData error:', err);
      } finally {
        setLoadingData(false);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (!isPdf) return;
    const objectUrl = URL.createObjectURL(file);
    const renderPdfThumbnail = async () => {
      try {
        // @ts-ignore
        let pdfjsLib = (window as any).pdfjsLib;
        if (!pdfjsLib) {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          script.onload = async () => {
            // @ts-ignore
            let lib = (window as any).pdfjsLib;
            lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            try {
              const pdf = await lib.getDocument(objectUrl).promise;
              const page = await pdf.getPage(1);
              const viewport = page.getViewport({ scale: 0.3 });
              const canvas = document.createElement('canvas');
              canvas.width = viewport.width; canvas.height = viewport.height;
              const ctx = canvas.getContext('2d');
              await page.render({ canvasContext: ctx, viewport }).promise;
              setThumbnailUrl(canvas.toDataURL());
              // Extract PDF metadata
              try {
                const meta = await pdf.getMetadata();
                const info = meta?.info ?? {};
                const pageCount: number = pdf.numPages ?? 0;
                const title: string | undefined = info.Title || undefined;
                const author: string | undefined = info.Author || undefined;
                let creationDate: string | undefined;
                if (info.CreationDate) {
                  try {
                    const raw: string = info.CreationDate;
                    const cleaned = raw.replace(/^D:/, '').replace(/[+\-]\d{2}'\d{2}'$/, '').replace(/Z$/, '');
                    const y = cleaned.slice(0, 4), mo = cleaned.slice(4, 6), d = cleaned.slice(6, 8);
                    const h = cleaned.slice(8, 10) || '00', mi = cleaned.slice(10, 12) || '00', s = cleaned.slice(12, 14) || '00';
                    creationDate = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
                  } catch { creationDate = undefined; }
                }
                if (onPdfMetadata) onPdfMetadata({ pageCount, title, author, creationDate });
              } catch { /* silently ignore metadata extraction errors */ }
            } catch { /* silently fail */ }
          };
          document.head.appendChild(script);
        } else {
          const pdf = await pdfjsLib.getDocument(objectUrl).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 0.3 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width; canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          setThumbnailUrl(canvas.toDataURL());
          // Extract PDF metadata
          try {
            const meta = await pdf.getMetadata();
            const info = meta?.info ?? {};
            const pageCount: number = pdf.numPages ?? 0;
            const title: string | undefined = info.Title || undefined;
            const author: string | undefined = info.Author || undefined;
            let creationDate: string | undefined;
            if (info.CreationDate) {
              try {
                const raw: string = info.CreationDate;
                const cleaned = raw.replace(/^D:/, '').replace(/[+\-]\d{2}'\d{2}'$/, '').replace(/Z$/, '');
                const y = cleaned.slice(0, 4), mo = cleaned.slice(4, 6), d = cleaned.slice(6, 8);
                const h = cleaned.slice(8, 10) || '00', mi = cleaned.slice(10, 12) || '00', s = cleaned.slice(12, 14) || '00';
                creationDate = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
              } catch { creationDate = undefined; }
            }
            if (onPdfMetadata) onPdfMetadata({ pageCount, title, author, creationDate });
          } catch { /* silently ignore metadata extraction errors */ }
        }
      } catch { /* silently fail */ }
    };
    renderPdfThumbnail();
    return () => { URL.revokeObjectURL(objectUrl); };
  }, [file, isPdf]);

  const update = (field: keyof DocumentConfig, value: any) => onConfigChange({ ...config, [field]: value });

  const folderOptions = [
    { id: 'raiz', label: 'Mi Espacio (Raíz)' },
    ...carpetas.map((c) => ({ id: c.id, label: c.parent_id ? `  └ ${c.nombre}` : c.nombre })),
  ];

  // Preset options for vencimiento
  const PRESET_OPTIONS: { id: typeof presetVencimiento; label: string }[] = [
    { id: '24h', label: '24 horas' },
    { id: '3d', label: '3 días' },
    { id: '7d', label: '7 días (recomendado)' },
    { id: '15d', label: '15 días' },
    { id: '30d', label: '30 días' },
    { id: 'personalizado', label: 'Personalizado' },
  ];

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <h2 className="mb-4 text-base font-700 text-slate-950">Archivo cargado</h2>
            <div className="border border-gray-200 rounded-lg p-4 flex gap-4 items-start mb-4">
              <div className="w-20 h-28 bg-gray-100 rounded border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                {thumbnailUrl ? (
                  <img src={thumbnailUrl} alt="Miniatura del documento" className="w-full h-full object-cover" />
                ) : isPdf ? (
                  <div className="w-full h-full flex items-center justify-center bg-gray-50"><FileText size={28} className="text-primary animate-pulse" /></div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-blue-50">
                    <FileText size={24} className="text-primary" />
                    <span className="text-[9px] font-bold text-primary uppercase">{file.name.split('.').pop()}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{file.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{fileSizeKB} KB</p>
                <div className="flex items-center gap-1.5 mt-3">
                  <button onClick={() => { const url = URL.createObjectURL(file); window.open(url, '_blank'); }} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 hover:bg-gray-50 transition-colors">
                    <Eye size={13} />Ver
                  </button>
                  <button onClick={onRemove} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600 transition-colors">
                    <Trash2 size={13} />Eliminar
                  </button>
                </div>
              </div>
            </div>
            {/* Guardar avance button removed */}
          </div>

          <div className="rounded-lg border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Configuración del documento</h2>
            <p className="text-sm text-gray-400 mb-4">Configura la seguridad y propiedades de tu documento.</p>
            {/* Tabs — Configuración general FIRST (default), Seguridad y protección SECOND */}
            <div className="flex gap-2 mb-4 bg-gray-100 rounded-xl p-1">
              <button onClick={() => setActiveTab('general')} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all flex-1 justify-center ${activeTab === 'general' ? 'bg-white text-primary shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
                <FileText size={15} />Configuración general
              </button>
              <button onClick={() => setActiveTab('seguridad')} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all flex-1 justify-center ${activeTab === 'seguridad' ? 'bg-white text-primary shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
                <ShieldCheck size={15} />Seguridad y protección
              </button>
            </div>

            {/* ── Configuración general tab ── */}
            {activeTab === 'general' && (
              <div className="space-y-1.5">
                <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg">
                  <input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-primary accent-primary" />
                  <span className="text-sm text-gray-700 flex-1 font-normal">Marcar como documento urgente</span>
                  <InfoTooltip text="Marca este documento como urgente para que los participantes lo identifiquen fácilmente y le den prioridad." />
                </label>
                <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg">
                  <input type="checkbox" checked={publico} onChange={(e) => setPublico(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary" />
                  <span className="text-sm text-gray-700 flex-1 font-normal">Publicar al completar en el portal de verificación</span>
                  <InfoTooltip text="Cuando el documento quede completado, habilita una ficha pública verificable y un código QR. Antes de completarse no será visible públicamente." />
                </label>
                <div>
                  <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg">
                    <input type="checkbox" checked={selloDigital} onChange={(e) => setSelloDigital(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary" />
                    <span className="text-sm text-gray-700 flex-1 font-normal">Agregar sello digital y cadena original</span>
                    <InfoTooltip text="Genera la cadena original, el sello digital y la evidencia criptográfica con valores reales cuando el documento quede completado." />
                  </label>
                  {selloDigital && (
                    <div className="ml-10 mr-3 mb-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                      <p className="mb-2.5 text-xs font-semibold text-slate-700">Ubicación de la certificación</p>
                      <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-1" role="radiogroup" aria-label="Ubicación de sellos y cadenas">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selloUbicacion === 'calce'}
                          onClick={() => setSelloUbicacion('calce')}
                          className={`min-h-9 rounded-md px-3 text-xs font-semibold transition-colors ${selloUbicacion === 'calce' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                          Al calce
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selloUbicacion === 'libre'}
                          onClick={() => setSelloUbicacion('libre')}
                          className={`min-h-9 rounded-md px-3 text-xs font-semibold transition-colors ${selloUbicacion === 'libre' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                          En cualquier parte
                        </button>
                      </div>
                      <p className="mt-2.5 text-xs leading-5 text-slate-500">
                        {selloUbicacion === 'calce'
                          ? 'Se integrará automáticamente en el anexo final de certificación, sin cubrir el contenido original.'
                          : 'En el paso 3 podrás colocar la cadena original, el sello digital, la estampa de tiempo y la cadena de evidencia.'}
                      </p>
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg">
                  <input type="checkbox" checked={estampaAutenticacion} onChange={(e) => setEstampaAutenticacion(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary" />
                  <span className="text-sm text-gray-700 flex-1 font-normal">Agregar estampa en documento</span>
                  <InfoTooltip text="Genera una estampa de autenticación al calce de la hoja que acredita la existencia del documento en un momento determinado." />
                </label>
                <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg">
                  <input type="checkbox" checked={leyendasDocumento} onChange={(e) => setLeyendasDocumento(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary" />
                  <span className="text-sm text-gray-700 flex-1 font-normal">Agregar leyendas en documento</span>
                  <InfoTooltip text="Incorpora leyendas legales o informativas en el documento para cumplimiento normativo o comunicación a los participantes." />
                </label>
                <div>
<label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg" onClick={(e) => { e.preventDefault(); setShowMetadatosModal(true); }}>
                  <input type="checkbox" checked={metadatosAdicionales} onChange={() => {}} className="w-4 h-4 rounded border-gray-300 accent-primary pointer-events-none" />
                  <span className="text-sm text-gray-700 flex-1 font-normal">Crear metadatos adicionales al documento</span>
                  <InfoTooltip text="Agrega metaetiquetas personalizadas (clave-valor) al documento para facilitar su búsqueda, clasificación y gestión documental." />
                </label>
                {metadatosAdicionales && savedMetadatosCount > 0 && (
                  <div className="ml-10 mr-3 mb-1">
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                      <span className="text-xs text-emerald-700 flex-1">({savedMetadatosCount}) Metadatos registrados</span>
                      <button type="button" onClick={() => setShowMetadatosModal(true)} className="text-xs text-primary hover:text-primary/80 font-medium">Editar</button>
                    </div>
                  </div>
                )}
              </div>
              </div>
            )}

            {/* ── Seguridad y protección tab ── */}
            {activeTab === 'seguridad' && (
              <div className="space-y-1.5">
                {/* Vencimiento */}
                <div>
                  <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg">
                    <input type="checkbox" checked={vencimiento} onChange={(e) => setVencimiento(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary" />
                    <span className="text-sm text-gray-700 flex-1 font-normal">Establecer vencimiento para este documento</span>
                    <InfoTooltip text="Define una fecha límite después de la cual el documento ya no podrá ser firmado o accedido." />
                  </label>

                  {vencimiento && (
                    <div className="ml-10 mr-3 mb-2 space-y-4 border border-gray-100 rounded-xl p-4 bg-gray-50/50">
                      {/* Sub-opciones de vencimiento */}
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-700 mb-1">Tipo de vencimiento</p>
                        <label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-white rounded-lg border border-gray-100 bg-white">
                          <input type="checkbox" checked={vencimientoSolicitud} onChange={(e) => setVencimientoSolicitud(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary mt-0.5" />
                          <div>
                            <p className="text-sm text-gray-800 font-medium">Vencimiento de solicitud de participación</p>
                            <p className="text-xs text-gray-500 mt-0.5">El plazo para que los firmantes completen su acción. Al habilitarlo, en la configuración de participantes aparecerá un campo de fecha de vencimiento por participante.</p>
                          </div>
                        </label>
                        <label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-white rounded-lg border border-gray-100 bg-white">
                          <input type="checkbox" checked={vencimientoCompletar} onChange={(e) => setVencimientoCompletar(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary mt-0.5" />
                          <div>
                            <p className="text-sm text-gray-800 font-medium">Vencimiento para completar participación en documento</p>
                            <p className="text-xs text-gray-500 mt-0.5">El documento tiene vigencia legal limitada para poder completarse.</p>
                          </div>
                        </label>
                      </div>

                      {/* Presets de fecha */}
                      <div>
                        <p className="text-xs font-semibold text-gray-700 mb-2">Selección rápida de plazo</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {PRESET_OPTIONS.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setPresetVencimiento(p.id)}
                              className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors text-center ${presetVencimiento === p.id ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'}`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                        {presetVencimiento === 'personalizado' && (
                          <div className="mt-2">
                            <input
                              type="date"
                              value={fechaVencimientoPersonalizado}
                              onChange={(e) => setFechaVencimientoPersonalizado(e.target.value)}
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                            />
                          </div>
                        )}
                      </div>

                      {/* Hora de vencimiento */}
                      <label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-white rounded-lg border border-gray-100 bg-white">
                        <input type="checkbox" checked={incluirHoraVencimiento} onChange={(e) => setIncluirHoraVencimiento(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm text-gray-800 font-medium">Incluir hora de vencimiento</p>
                          <p className="text-xs text-gray-500 mt-0.5">La fecha/hora límite para que los participantes completen su participación.</p>
                          {incluirHoraVencimiento && (
                            <input
                              type="time"
                              value={horaVencimiento}
                              onChange={(e) => setHoraVencimiento(e.target.value)}
                              className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                            />
                          )}
                        </div>
                      </label>

                      {/* Zona horaria */}
                      <div>
                        <p className="text-xs font-semibold text-gray-700 mb-1.5">Zona horaria</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                            <span className="text-xs">CDT / Ciudad de México (UTC-6)</span>
                          </div>
                          <button type="button" className="px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-50 transition-colors bg-white">Cambiar</button>
                        </div>
                      </div>

                      {/* Días hábiles vs naturales */}
                      <div className="flex items-center justify-between px-3 py-2.5 bg-white rounded-lg border border-gray-100">
                        <div>
                          <p className="text-sm text-gray-800 font-medium">Contar solo días hábiles</p>
                          <p className="text-xs text-gray-500 mt-0.5">Relevante para trámites legales y fiscales.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDiasHabiles((v) => !v)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${diasHabiles ? 'bg-primary' : 'bg-gray-200'}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${diasHabiles ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                      </div>

                      {/* Recordatorio */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between px-3 py-2.5 bg-white rounded-lg border border-gray-100">
                          <div>
                            <p className="text-sm text-gray-800 font-medium">Recordatorio previo al vencimiento</p>
                            <p className="text-xs text-gray-500 mt-0.5">Notifica a los participantes antes de que venza el plazo.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setRecordatorioEnabled((v) => !v)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${recordatorioEnabled ? 'bg-primary' : 'bg-gray-200'}`}
                          >
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${recordatorioEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                        {recordatorioEnabled && (
                          <div className="px-3">
                            <p className="text-xs font-medium text-gray-600 mb-1.5">Cuándo enviar el recordatorio</p>
                            <div className="grid grid-cols-2 gap-1.5">
                              {([
                                { id: 'diario', label: 'Diario' },
                                { id: '48h', label: '48h antes' },
                                { id: '24h', label: '24h antes' },
                                { id: '6h', label: '6h antes' },
                              ] as const).map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => setRecordatorioCuando(opt.id)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${recordatorioCuando === opt.id ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'}`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Código de acceso */}
                <div>
                  <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg" onClick={(e) => { e.preventDefault(); if (!codigoAcceso) { setCodigoAcceso(true); setShowCodigoAccesoModal(true); } else { setShowCodigoAccesoModal(true); } }}>
                    <input type="checkbox" checked={codigoAcceso} onChange={() => {}} className="w-4 h-4 rounded border-gray-300 accent-primary pointer-events-none" />
                    <span className="text-sm text-gray-700 flex-1 font-normal">Establecer un código de acceso</span>
                    <InfoTooltip text="Protege el documento con una contraseña que los participantes deberán ingresar para acceder en el visor y en Mi Espacio." />
                  </label>
                  {codigoAcceso && codigoAccesoValue && (
                    <div className="ml-10 mr-3 mb-1">
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        <span className="text-xs text-emerald-700 flex-1">Código de acceso configurado</span>
                        <button type="button" onClick={() => setShowCodigoAccesoModal(true)} className="text-xs text-primary hover:text-primary/80 font-medium">Cambiar</button>
                        <button type="button" onClick={() => { setCodigoAcceso(false); setCodigoAccesoValue(''); }} className="text-xs text-red-500 hover:text-red-600 font-medium">Eliminar</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Protección adicional para participar */}
                <div>
                  <label className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg">
                    <input type="checkbox" checked={proteccionParticipacion} onChange={(e) => setProteccionParticipacion(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary mt-0.5" />
                    <div className="flex-1">
                      <span className="text-sm text-gray-700 font-normal">Agregar protección adicional para participar en documento</span>
                      {proteccionParticipacion && (
                        <p className="text-xs text-gray-500 mt-0.5">Solicitará token móvil (TOTP) al participante; si no lo tiene, enviará un OTP al correo electrónico registrado para verificar su identidad antes de participar.</p>
                      )}
                    </div>
                    <InfoTooltip text="Requiere verificación adicional de identidad (token móvil o OTP por correo) antes de que el participante pueda firmar o interactuar con el documento." />
                  </label>
                </div>

                {/* Protección adicional */}
                <div>
                  <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg">
                    <input type="checkbox" checked={proteccionFirmado} onChange={(e) => setProteccionFirmado(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary" />
                    <span className="text-sm text-gray-700 flex-1 font-normal">Protección adicional a documento firmado</span>
                    <InfoTooltip text="Aplica una capa extra de seguridad al documento una vez que ha sido firmado, evitando modificaciones." />
                  </label>
                  {proteccionFirmado && (
                    <div className="ml-10 mr-3 mb-2 space-y-2">
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-amber-700"><span className="font-bold">¡Atención!</span> Esta acción es irreversible una vez que se envíe el documento.</p>
                      </div>
                      {[
                        { label: 'Impedir la impresión de documentos.', state: impedirImpresion, set: setImpedirImpresion },
                        { label: 'Evite la copia de texto e imágenes.', state: evitarCopiaTexto, set: setEvitarCopiaTexto },
                        { label: 'Impedir la modificación.', state: impedirModificacion, set: setImpedirModificacion },
                        { label: 'Impedir la extracción de contenido.', state: impedirExtraccion, set: setImpedirExtraccion },
                        { label: 'Evitar el montaje de documentos.', state: evitarMontaje, set: setEvitarMontaje },
                      ].map(({ label, state, set }) => (
                        <label key={label} className="flex items-center gap-3 px-2 py-1.5 cursor-pointer hover:bg-gray-50 rounded-lg">
                          <input type="checkbox" checked={state} onChange={(e) => set(e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-primary" />
                          <span className="text-sm text-gray-700">{label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {/* Legal Hold removed as requested */}
              </div>
            )}
          </div>
        </div>

        <div className="h-fit rounded-lg border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <h2 className="mb-5 text-base font-700 text-slate-950">Propiedades del documento</h2>
          <div className="space-y-4">
            {/* Nombre del documento */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre del documento <span className="text-red-500">*</span></label>
              <input type="text" value={config.nombre} onChange={(e) => update('nombre', e.target.value)} placeholder="Nombre del documento" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>

            {/* Descripción */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción del documento</label>
              <textarea value={config.descripcion} onChange={(e) => update('descripcion', e.target.value)} placeholder="Añade un resumen o notas sobre el contenido del documento." rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
            </div>

            {/* Número de oficio */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Número de oficio / documento</label>
              <input type="text" value={config.numeroOficio} onChange={(e) => update('numeroOficio', e.target.value)} placeholder="Ej. OF-2026-001" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>

            {/* Ruta de guardado */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <span className="flex items-center gap-1.5"><Folder size={14} className="text-gray-400" />Ruta de guardado</span>
              </label>
              <SearchableSelect options={folderOptions} value={config.ruta || 'raiz'} onChange={(id) => update('ruta', id)} placeholder="Mi Espacio (Raíz)" />
            </div>

            {/* Merged: Tipo de documento + Documento */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Layers size={14} className="text-gray-400" />
                  Tipo de documento <span className="text-red-500">*</span>
                </span>
              </label>
              {loadingData ? (
                <div className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-400 bg-gray-50 flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Cargando tipos...
                </div>
              ) : grupos.length === 0 ? (
                <div className="w-full border border-amber-200 rounded-lg px-3 py-2.5 text-sm text-amber-600 bg-amber-50">No hay tipos disponibles</div>
              ) : (
                <DocumentTypeSelectorModal
                  grupos={grupos}
                  tiposDocumento={tiposDocumentoMap}
                  selectedGrupoId={config.grupotipoId}
                  selectedTipoId={config.tipoDocumentoId}
                  onSelect={(grupoId, tipoId) => {
                    onConfigChange({ ...config, grupotipoId: grupoId, tipoDocumentoId: tipoId, otroTipoDocumento: '' });
                  }}
                  userId={userId}
                  loading={loadingData}
                />
              )}
              {config.tipoDocumentoId === '__otros__' && (
                <div className="mt-2">
                  <input
                    type="text"
                    value={config.otroTipoDocumento}
                    onChange={(e) => update('otroTipoDocumento', e.target.value)}
                    placeholder="Especifica el tipo de documento..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    autoFocus
                  />
                </div>
              )}
            </div>

            {/* Etiquetas */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <span className="flex items-center gap-1.5"><Tag size={14} className="text-gray-400" />Etiquetas</span>
              </label>
              <EtiquetasSearchFieldWithModal
                etiquetas={etiquetas}
                selectedIds={config.etiquetasIds}
                onChange={(ids) => update('etiquetasIds', ids)}
                userId={userId}
                loading={loadingData}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Metadatos Modal */}
      {showMetadatosModal && (
        <MetadatosModal
          documentoId={documentoId}
          onClose={() => {
            setShowMetadatosModal(false);
            if (savedMetadatosCount === 0) {
              setMetadatosAdicionales(false);
            }
          }}
          onSaved={(metaetiquetas) => {
            setMetadatosAdicionales(true);
            setSavedMetadatosCount(metaetiquetas.length);
          }}
        />
      )}

      {/* Código de Acceso Modal */}
      {showCodigoAccesoModal && (
        <CodigoAccesoModal
          documentoId={documentoId}
          existingCode={codigoAccesoValue || undefined}
          onClose={() => { setShowCodigoAccesoModal(false); if (!codigoAccesoValue) { setCodigoAcceso(false); } }}
          onSaved={(code) => { setCodigoAccesoValue(code); setCodigoAcceso(true); }}
          onDeleted={() => { setCodigoAcceso(false); setCodigoAccesoValue(''); }}
        />
      )}
    </div>
  );
}

// ─── Step 1: Subir ────────────────────────────────────────────────────────────

export function StepSubir({
  file,
  onFileChange,
  config,
  onConfigChange,
  viewMode,
  onGuardarAvance,
  savingDraft,
  onSecurityChange,
  documentoId,
  onPdfMetadata,
}: {
  file: File | null;
  onFileChange: (f: File | null) => void;
  config: DocumentConfig;
  onConfigChange: (c: DocumentConfig) => void;
  viewMode: 'split' | 'stacked';
  onGuardarAvance: () => void;
  savingDraft: boolean;
  onSecurityChange?: (s: import('./types').SecuritySettings & { urgente: boolean; publico: boolean; selloDigital: boolean; selloUbicacion: 'calce' | 'libre'; estampaAutenticacion: boolean; metadatosAdicionales: boolean }) => void;
  documentoId?: string;
  onPdfMetadata?: (meta: { pageCount: number; title?: string; author?: string; creationDate?: string }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'computadora' | 'telefono' | 'gdrive' | 'onedrive' | 'dropbox'>('computadora');
  const { isModuleActive } = useAppModules();
  const plantillasEnabled = isModuleActive('plantillas');
  const [plantillas, setPlantillas] = useState<{ id: string; nombre: string; descripcion?: string }[]>([]);
  const [plantillasLoading, setPlantillasLoading] = useState(false);

  // Load plantillas if module is active
  useEffect(() => {
    if (!plantillasEnabled) return;
    setPlantillasLoading(true);
    const supabase = createClient();
    supabase
      .from('plantillas')
      .select('id, nombre, descripcion')
      .eq('estado', 'publicada')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setPlantillas(data || []);
        setPlantillasLoading(false);
      })
      .catch(() => setPlantillasLoading(false));
  }, [plantillasEnabled]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFileChange(dropped);
  }, [onFileChange]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { const selected = e.target.files?.[0] ?? null; onFileChange(selected); };

  if (file) {
    return <FileUploadedLayout file={file} onRemove={() => onFileChange(null)} config={config} onConfigChange={onConfigChange} viewMode={viewMode} onGuardarAvance={onGuardarAvance} savingDraft={savingDraft} onSecurityChange={onSecurityChange} documentoId={documentoId} onPdfMetadata={onPdfMetadata} />;
  }

  const tabs: Array<{ id: 'computadora' | 'telefono' | 'gdrive' | 'onedrive' | 'dropbox'; label: string; icon?: React.ComponentType<{ size?: number; className?: string }>; brandIcon?: React.ReactNode; active: boolean }> = [
    { id: 'computadora', label: 'Equipo de cómputo', icon: Monitor, active: true },
    { id: 'telefono', label: 'Teléfono', icon: Smartphone, active: true },
    { id: 'gdrive', label: 'Google Drive', brandIcon: <GoogleDriveIcon size={22} />, active: false },
    { id: 'onedrive', label: 'OneDrive', brandIcon: <OneDriveIcon size={22} />, active: false },
    { id: 'dropbox', label: 'Dropbox', brandIcon: <DropboxIcon size={22} />, active: false },
  ];

  return (
    <div className="w-full">
      <div className={`grid grid-cols-1 ${plantillasEnabled ? 'xl:grid-cols-2' : ''} gap-5`}>
        <div className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="mb-0.5 text-base font-700 text-slate-950">Subir documento</h2>
            <p className="text-sm text-gray-500">Selecciona el origen de tu archivo.</p>
          </div>
          <div className="flex min-h-[320px]">
            <div className="w-44 shrink-0 border-r border-slate-100 bg-slate-50/70 py-2 sm:w-52">
              {tabs.map((tab) => {
                const IconComp = tab.icon;
                const isActive = activeTab === tab.id;
                const isDisabled = !tab.active;
                return (
                  <button key={tab.id} onClick={() => { if (!isDisabled) setActiveTab(tab.id); }} disabled={isDisabled} title={isDisabled ? 'Próximamente' : undefined}
                    className={`group relative flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors ${isDisabled ? 'cursor-not-allowed opacity-40' : isActive ? 'border-r-2 border-primary bg-white font-semibold text-primary' : 'text-slate-600 hover:bg-white/70 hover:text-slate-950'}`}
                  >
                    <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isActive ? 'bg-primary text-white' : isDisabled ? 'bg-gray-200 text-gray-500' : 'bg-gray-200 text-gray-600'}`}>{tabs.indexOf(tab) + 1}</span>
                    <span className="text-[15px] leading-tight">{tab.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex-1 overflow-hidden">
              {activeTab === 'computadora' && (
                <div className="p-4 flex flex-col h-full">
                  <div onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                    className={`mb-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-10 transition-colors ${dragging ? 'border-primary bg-primary/5' : 'border-slate-300 bg-slate-50/40 hover:border-primary/60 hover:bg-primary/[0.02]'}`}
                    onClick={() => inputRef.current?.click()}>
                    <Upload size={32} className="text-gray-400 mb-3" />
                    <p className="text-sm text-primary font-medium text-center">Arrastra un archivo para subir</p>
                    <p className="text-xs text-gray-400 mt-1 text-center">Archivos PDF, DOCX hasta 25MB</p>
                  </div>
                  <input ref={inputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={handleInputChange} />
                  <button className="w-full border border-gray-200 rounded-lg py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors" onClick={() => inputRef.current?.click()}>
                    <Upload size={15} />Elegir archivo
                  </button>
                </div>
              )}
              {activeTab === 'telefono' && <PhoneUploadTab onFileReceived={onFileChange} />}
              {(activeTab === 'gdrive' || activeTab === 'onedrive' || activeTab === 'dropbox') && (
                <div className="flex flex-col items-center justify-center h-full py-10 px-6 gap-3">
                  <div className="w-14 h-14 bg-gray-50 border border-gray-200 rounded-2xl flex items-center justify-center shadow-sm">
                    {activeTab === 'gdrive' && <GoogleDriveIcon size={32} />}
                    {activeTab === 'onedrive' && <OneDriveIcon size={32} />}
                    {activeTab === 'dropbox' && <DropboxIcon size={32} />}
                  </div>
                  <p className="text-sm font-semibold text-gray-500 text-center">Próximamente disponible</p>
                  <p className="text-xs text-gray-400 text-center">Esta integración estará disponible en una próxima actualización.</p>
                </div>
              )}
            </div>
          </div>
        </div>
        {plantillasEnabled && (
          <div className="flex flex-col justify-between rounded-lg border border-slate-200/90 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div>
              <div className="flex items-start gap-3 mb-4">
                <div className="mt-0.5"><ExternalLink size={22} className="text-primary" /></div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">¿Buscas una plantilla?</h2>
                  <p className="text-sm text-gray-500 mt-1">Ahorra tiempo utilizando una de nuestras plantillas pre-diseñadas.</p>
                </div>
              </div>
              {plantillasLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Cargando plantillas...
                </div>
              ) : plantillas.length > 0 ? (
                <div className="flex flex-col gap-2 mb-4 max-h-48 overflow-y-auto">
                  {plantillas.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2.5 hover:border-primary/40 transition-colors cursor-pointer group">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{p.nombre}</p>
                        {p.descripcion && <p className="text-xs text-gray-400 truncate">{p.descripcion}</p>}
                      </div>
                      <ChevronRight size={14} className="text-gray-400 group-hover:text-primary transition-colors flex-shrink-0" />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <button className="w-full border border-gray-300 bg-white rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Explorar Plantillas</button>
          </div>
        )}
      </div>
    </div>
  );
}
