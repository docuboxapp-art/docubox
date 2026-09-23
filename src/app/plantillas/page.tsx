'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  MoreHorizontal,
  Eye,
  Edit,
  Copy,
  Archive,
  ArchiveRestore,
  Tag,
  LayoutGrid,
  LayoutList,
  X,
  Star,
  ListFilter,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import AppLayout from '@/components/AppLayout';
import AppImage from '@/components/ui/AppImage';
import { createClient } from '@/lib/supabase/client';
import { templateApiFetch } from '@/lib/templates/client';
import {
  buildTemplatePagePreviewDocument,
  type PublishedTemplateDocument,
} from '@/lib/templates/preview';

type TemplateFilter = 'published' | 'draft' | 'archived' | 'favorites';
type TemplateSort = '' | 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';

const TEMPLATE_FAVORITES_KEY = 'plantillas';
const TABLE_PAGE_SIZE = 10;

interface Plantilla {
  id: string;
  nombre?: string;
  name?: string;
  descripcion?: string;
  description?: string;
  category?: string;
  estado?: string;
  status?: string;
  created_at: string;
  updated_at: string;
  campos_insertados?: unknown[];
  fields?: unknown[];
  signer_roles?: unknown[];
  tipo_documento?: { id: string; nombre: string } | null;
  grupo_tipo?: { id: string; nombre: string } | null;
  area_responsable?: string;
  tipo_plantilla?: string;
  estado_plantilla?: string;
  version_publicada?: string | null;
  source_template_id?: string | null;
  root_template_id?: string | null;
  numero_oficio?: string;
  etiquetas_ids?: string[];
  hoja_tamano?: string;
  hoja_orientacion?: 'vertical' | 'horizontal';
  contenido_html?: string | null;
  margenes?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  } | null;
}

const TEMPLATE_PREVIEW_PAGE_SIZES: Record<string, { width: number; height: number }> = {
  'Carta (Letter)': { width: 816, height: 1056 },
  'Oficio (Legal)': { width: 816, height: 1344 },
  A4: { width: 794, height: 1123 },
  A3: { width: 1123, height: 1587 },
  A5: { width: 559, height: 794 },
  Tabloide: { width: 1056, height: 1632 },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  published: { label: 'Publicada', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  draft: { label: 'Borrador', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  archived: { label: 'Archivada', color: 'bg-gray-100 text-gray-500', icon: AlertCircle },
  Publicada: { label: 'Publicada', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  Borrador: { label: 'Borrador', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  Archivada: { label: 'Archivada', color: 'bg-gray-100 text-gray-500', icon: AlertCircle },
  'En revisión': { label: 'En revisión', color: 'bg-blue-100 text-blue-700', icon: Clock },
};

const CATEGORY_COLORS: Record<string, string> = {
  Contratos: 'bg-blue-100 text-blue-700',
  Legal: 'bg-purple-100 text-purple-700',
  'Recursos Humanos': 'bg-orange-100 text-orange-700',
  Comercial: 'bg-teal-100 text-teal-700',
  Finanzas: 'bg-green-100 text-green-700',
};

function getPlantillaName(p: Plantilla) {
  return p.nombre || p.name || 'Sin nombre';
}
function getPlantillaDesc(p: Plantilla) {
  return p.descripcion || p.description || '';
}
function getPlantillaStatus(p: Plantilla) {
  return p.estado || p.status || 'draft';
}
function getNormalizedStatus(p: Plantilla): 'published' | 'draft' | 'archived' | 'other' {
  const status = getPlantillaStatus(p).toLowerCase();
  const displayStatus = p.estado_plantilla?.toLowerCase();
  if (status === 'archived' || displayStatus === 'archivada') return 'archived';
  if (status === 'published' || displayStatus === 'publicada') return 'published';
  if (status === 'draft' || displayStatus === 'borrador') return 'draft';
  return 'other';
}
function getPlantillaFields(p: Plantilla) {
  return p.campos_insertados || p.fields || [];
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function hasMeaningfulTemplateContent(html?: string | null) {
  if (!html?.trim()) return false;
  const visibleText = html
    .replace(/<br\s*\/?\s*>/gi, '')
    .replace(/&nbsp;|&#160;/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
  return Boolean(visibleText || /<(img|table|figure|hr)\b/i.test(html));
}

function buildTemplatePreviewDocument(plantilla: Plantilla) {
  return buildTemplatePagePreviewDocument(
    {
      ...plantilla,
      nombre: getPlantillaName(plantilla),
    } as PublishedTemplateDocument,
    0
  );
}

function TemplateDocumentPreview({
  plantilla,
  compact = false,
}: {
  plantilla: Plantilla;
  compact?: boolean;
}) {
  const baseSize =
    TEMPLATE_PREVIEW_PAGE_SIZES[plantilla.hoja_tamano || 'Carta (Letter)'] ||
    TEMPLATE_PREVIEW_PAGE_SIZES['Carta (Letter)'];
  const isLandscape = plantilla.hoja_orientacion === 'horizontal';
  const pageWidth = isLandscape ? baseSize.height : baseSize.width;
  const pageHeight = isLandscape ? baseSize.width : baseSize.height;
  const maxPreviewWidth = compact ? 32 : isLandscape ? 150 : 116;
  const maxPreviewHeight = compact ? 32 : isLandscape ? 112 : 150;
  const scale = Math.min(maxPreviewWidth / pageWidth, maxPreviewHeight / pageHeight);
  const previewWidth = pageWidth * scale;
  const previewHeight = pageHeight * scale;
  const previewDocument = useMemo(
    () =>
      hasMeaningfulTemplateContent(plantilla.contenido_html)
        ? buildTemplatePreviewDocument(plantilla)
        : null,
    [pageHeight, pageWidth, plantilla]
  );

  if (previewDocument) {
    const sheet = (
      <div
        className={`relative overflow-hidden rounded-[3px] border border-slate-200 bg-white shadow-[0_8px_20px_-12px_rgba(15,23,42,0.35)] ${compact ? '' : 'transition-transform duration-200 group-hover:-translate-y-0.5'}`}
        style={{ width: previewWidth, height: previewHeight }}
      >
        <iframe
          srcDoc={previewDocument}
          sandbox=""
          referrerPolicy="no-referrer"
          loading="lazy"
          tabIndex={-1}
          title={`Vista previa de ${getPlantillaName(plantilla)}`}
          className="pointer-events-none absolute left-0 top-0 border-0 bg-white"
          style={{
            width: pageWidth,
            height: pageHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
    );

    return compact ? (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-50">
        {sheet}
      </div>
    ) : (
      sheet
    );
  }

  if (compact) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50">
        <div className="flex h-8 w-6 flex-col overflow-hidden rounded-[2px] border border-slate-200 bg-white px-1 pt-1 shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
          <AppImage
            src="/assets/images/docubox-logo-2026.png"
            alt="Docubox"
            width={20}
            height={5}
            className="h-auto w-5 object-contain"
            showLoadingBackground={false}
          />
          <span className="mt-1 h-px w-full bg-[#1E6BFF]" />
          <span className="mt-1 h-px w-full bg-slate-200" />
          <span className="mt-1 h-px w-4/5 bg-slate-200" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-[3px] border border-slate-200 bg-white px-3 pb-3 pt-3 shadow-[0_8px_20px_-12px_rgba(15,23,42,0.35)] transition-transform duration-200 group-hover:-translate-y-0.5"
      style={{ width: isLandscape ? 150 : 116, height: isLandscape ? 112 : 150 }}
    >
      <AppImage
        src="/assets/images/docubox-logo-2026.png"
        alt="Docubox"
        width={54}
        height={11}
        className="h-auto w-[54px] object-contain"
        showLoadingBackground={false}
      />
      <div className="mt-2 h-[2px] w-full bg-[#1E6BFF]" />
      <div className="mt-2.5 h-1.5 w-4/5 rounded-sm bg-slate-700" />
      <div className="mt-2 space-y-1.5">
        <div className="h-1 w-full rounded-sm bg-slate-200" />
        <div className="h-1 w-11/12 rounded-sm bg-slate-200" />
        <div className="h-1 w-3/4 rounded-sm bg-slate-200" />
      </div>
      <div className="mt-2.5 rounded-[2px] border border-blue-100 bg-blue-50/70 p-1.5">
        <div className="h-1 w-4/5 rounded-sm bg-blue-200" />
        <div className="mt-1 h-1 w-full rounded-sm bg-blue-100" />
      </div>
      <span className="absolute bottom-2.5 right-3 text-[6px] font-medium text-slate-300">
        DOCUBOX
      </span>
    </div>
  );
}

function ArchiveConfirmModal({
  plantillaName,
  onConfirm,
  onCancel,
  isArchiving,
}: {
  plantillaName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isArchiving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100">
              <Archive size={20} className="text-slate-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Archivar plantilla</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                Podrás reactivarla cuando la necesites.
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            ¿Deseas archivar <span className="font-semibold">&quot;{plantillaName}&quot;</span>? La
            plantilla dejará de estar disponible para nuevos documentos, pero conservará su
            contenido y versiones.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isArchiving}
              className="h-9 flex-1 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isArchiving}
              className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-slate-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            >
              {isArchiving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{' '}
                  Archivando...
                </>
              ) : (
                <>
                  <Archive size={14} /> Archivar
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  plantilla,
  onEdit,
  onPreview,
  onArchive,
  onReactivate,
  onDuplicate,
  isFavorite,
  onToggleFavorite,
  favoritePending,
  lifecyclePending,
}: {
  plantilla: Plantilla;
  onEdit: (id: string) => void;
  onPreview: (id: string) => void;
  onArchive: (p: Plantilla) => void;
  onReactivate: (p: Plantilla) => void;
  onDuplicate: (p: Plantilla) => void;
  isFavorite: boolean;
  onToggleFavorite: (p: Plantilla) => void;
  favoritePending: boolean;
  lifecyclePending: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const statusKey = getPlantillaStatus(plantilla);
  const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG['draft'];
  const StatusIcon = statusCfg.icon;
  const isArchived = getNormalizedStatus(plantilla) === 'archived';
  const catColor = CATEGORY_COLORS[plantilla.category || ''] || 'bg-gray-100 text-gray-600';
  const description = getPlantillaDesc(plantilla).trim();

  return (
    <article
      className={`group relative flex min-h-[292px] flex-col rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_10px_28px_-18px_rgba(30,107,255,0.45)] ${menuOpen ? 'z-30' : ''}`}
    >
      {/* Preview area */}
      <div className="relative flex h-44 items-center justify-center overflow-hidden rounded-t-lg border-b border-slate-200 bg-[#f7f9fc]">
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-slate-100/70 to-transparent" />
        <TemplateDocumentPreview plantilla={plantilla} />
        <button
          type="button"
          onClick={() => onToggleFavorite(plantilla)}
          disabled={favoritePending}
          aria-label={isFavorite ? 'Quitar de favoritos' : 'Marcar como favorita'}
          title={isFavorite ? 'Quitar de favoritos' : 'Marcar como favorita'}
          className={`absolute left-2.5 top-2.5 z-20 flex h-8 w-8 items-center justify-center rounded-md border bg-white shadow-sm transition-colors disabled:cursor-wait disabled:opacity-60 ${
            isFavorite
              ? 'border-amber-200 text-amber-500 hover:bg-amber-50'
              : 'border-slate-200 text-slate-400 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-500'
          }`}
        >
          <Star size={15} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
        <div className="absolute right-2.5 top-2.5 z-20">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${statusCfg.color}`}
          >
            <StatusIcon size={10} />
            {statusCfg.label}
          </span>
        </div>
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-white/75 px-4 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => onPreview(plantilla.id)}
            className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-primary"
            aria-label="Ver vista previa de la plantilla"
          >
            <Eye size={12} />
            Ver
          </button>
          <button
            type="button"
            onClick={() => (isArchived ? onReactivate(plantilla) : onEdit(plantilla.id))}
            disabled={lifecyclePending}
            className="flex h-9 items-center gap-1.5 rounded-md bg-[#1E6BFF] px-3.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#1557d6] disabled:cursor-wait disabled:opacity-60"
            aria-label={isArchived ? 'Reactivar plantilla' : 'Editar plantilla'}
          >
            {isArchived ? <ArchiveRestore size={12} /> : <Edit size={12} />}
            {isArchived ? 'Reactivar' : 'Editar'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-slate-950">
              {getPlantillaName(plantilla)}
            </h3>
            <span className="shrink-0 text-[10px] font-normal text-slate-400">
              v{plantilla.version_publicada || '1.0'}
            </span>
          </div>
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-slate-400 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700"
              title="Más acciones"
              aria-label="Más acciones de la plantilla"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-9 z-40 w-44 rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_12px_32px_-10px_rgba(15,23,42,0.28)]">
                  {!isArchived && (
                    <button
                      type="button"
                      onClick={() => {
                        onEdit(plantilla.id);
                        setMenuOpen(false);
                      }}
                      className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950"
                    >
                      <Edit size={14} className="text-slate-400" /> Editar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onPreview(plantilla.id);
                      setMenuOpen(false);
                    }}
                    className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <Eye size={14} className="text-slate-400" /> Vista previa
                  </button>
                  {!isArchived && (
                    <button
                      type="button"
                      onClick={() => {
                        onDuplicate(plantilla);
                        setMenuOpen(false);
                      }}
                      className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950"
                    >
                      <Copy size={14} className="text-slate-400" /> Duplicar
                    </button>
                  )}
                  <div className="mt-1 border-t border-slate-100 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (isArchived) onReactivate(plantilla);
                        else onArchive(plantilla);
                        setMenuOpen(false);
                      }}
                      disabled={lifecyclePending}
                      className={`flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
                        isArchived
                          ? 'text-blue-700 hover:bg-blue-50'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                      {isArchived ? 'Reactivar' : 'Archivar'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {description && (
          <p className="mb-3 line-clamp-2 flex-1 text-xs leading-5 text-slate-500">{description}</p>
        )}

        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {plantilla.category && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${catColor}`}
            >
              <Tag size={9} />
              {plantilla.category}
            </span>
          )}
          {plantilla.tipo_documento?.nombre && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
              <FileText size={9} />
              {plantilla.tipo_documento.nombre}
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <FileText size={10} />
            {getPlantillaFields(plantilla).length} campos
          </span>
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {formatDate(plantilla.updated_at)}
          </span>
        </div>
      </div>
    </article>
  );
}

export default function PlantillasGalleryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id;
  const { activeWorkspace } = useWorkspace();
  const activeWorkspaceId = activeWorkspace?.id;
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<TemplateFilter>('published');
  const [sortMode, setSortMode] = useState<TemplateSort>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [favoritePendingId, setFavoritePendingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [archiveTarget, setArchiveTarget] = useState<Plantilla | null>(null);
  const [lifecyclePendingId, setLifecyclePendingId] = useState<string | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchPlantillas = useCallback(async () => {
    if (!user || !activeWorkspaceId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ workspace_id: activeWorkspaceId });
      const res = await templateApiFetch(`/api/plantillas?${params.toString()}`);
      const json = await res.json();
      if (json.data) setPlantillas(json.data);
      else setPlantillas([]);
    } catch {
      setPlantillas([]);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchPlantillas(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchPlantillas]);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    const loadFavorites = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('user_favorites')
        .select('item_id')
        .eq('user_id', userId)
        .eq('storage_key', TEMPLATE_FAVORITES_KEY)
        .order('created_at', { ascending: true });

      if (!active) return;
      if (error) {
        setFavorites([]);
        return;
      }
      setFavorites((data || []).map((row: { item_id: string }) => row.item_id));
    };

    void loadFavorites();
    return () => {
      active = false;
    };
  }, [userId]);

  const handleEdit = (id: string) => {
    router.push(`/plantillas/nueva?id=${id}`);
  };

  const handlePreview = (id: string) => {
    router.push(`/plantillas/nueva?id=${encodeURIComponent(id)}&preview=1&preview_origin=gallery`, {
      scroll: false,
    });
  };

  const updateTemplateLifecycle = useCallback(
    async (template: Plantilla, action: 'archive' | 'reactivate') => {
      if (!activeWorkspaceId || lifecyclePendingId) return;
      setLifecyclePendingId(template.id);
      try {
        const res = await templateApiFetch(`/api/plantillas/${template.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ workspaceId: activeWorkspaceId, action }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(
            json.error ||
              (action === 'archive'
                ? 'No fue posible archivar la plantilla.'
                : 'No fue posible reactivar la plantilla.')
          );
        }
        setPlantillas((current) =>
          current.map((item) => (item.id === template.id ? { ...item, ...json.data } : item))
        );
        showToast(
          'success',
          action === 'archive'
            ? 'Plantilla archivada correctamente.'
            : 'Plantilla reactivada correctamente.'
        );
      } catch (error) {
        showToast(
          'error',
          error instanceof Error ? error.message : 'No fue posible actualizar la plantilla.'
        );
      } finally {
        setLifecyclePendingId(null);
      }
    },
    [activeWorkspaceId, lifecyclePendingId, showToast]
  );

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    try {
      await updateTemplateLifecycle(archiveTarget, 'archive');
    } finally {
      setArchiveTarget(null);
    }
  };

  const handleReactivate = (template: Plantilla) => {
    void updateTemplateLifecycle(template, 'reactivate');
  };

  const handleDuplicate = async (plantilla: Plantilla) => {
    if (isDuplicating || !activeWorkspaceId) return;
    setIsDuplicating(true);
    try {
      const res = await templateApiFetch('/api/plantillas', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          nombre: `${getPlantillaName(plantilla)} (copia)`,
          descripcion: getPlantillaDesc(plantilla),
          numeroOficio: plantilla.numero_oficio,
          areaResponsable: plantilla.area_responsable,
          tipoPlantilla: plantilla.tipo_plantilla,
          etiquetasIds: plantilla.etiquetas_ids || [],
          tipoDocumentoId: plantilla.tipo_documento?.id || null,
          grupotipoId: plantilla.grupo_tipo?.id || null,
          hojaTamano: (plantilla as any).hoja_tamano || 'Carta (Letter)',
          hojaOrientacion: (plantilla as any).hoja_orientacion || 'vertical',
          contenidoHtml: (plantilla as any).contenido_html || null,
          camposInsertados: plantilla.campos_insertados || [],
          estado: 'draft',
          estadoPlantilla: 'Borrador',
          fields: plantilla.fields || [],
          content: (plantilla as any).content || {},
          signerRoles: plantilla.signer_roles || [],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al duplicar');
      await fetchPlantillas();
      showToast('success', 'Plantilla duplicada correctamente');
    } catch (err: any) {
      showToast('error', err.message || 'Error al duplicar la plantilla');
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleToggleFavorite = useCallback(
    async (plantilla: Plantilla) => {
      if (!userId || favoritePendingId) return;

      const wasFavorite = favorites.includes(plantilla.id);
      setFavoritePendingId(plantilla.id);
      setFavorites((current) =>
        wasFavorite ? current.filter((id) => id !== plantilla.id) : [...current, plantilla.id]
      );

      try {
        const supabase = createClient();
        const operation = wasFavorite
          ? supabase
              .from('user_favorites')
              .delete()
              .eq('user_id', userId)
              .eq('storage_key', TEMPLATE_FAVORITES_KEY)
              .eq('item_id', plantilla.id)
          : supabase.from('user_favorites').upsert(
              {
                user_id: userId,
                storage_key: TEMPLATE_FAVORITES_KEY,
                item_id: plantilla.id,
              },
              { onConflict: 'user_id,storage_key,item_id' }
            );
        const { error } = await operation;
        if (error) throw error;
      } catch {
        setFavorites((current) =>
          wasFavorite
            ? current.includes(plantilla.id)
              ? current
              : [...current, plantilla.id]
            : current.filter((id) => id !== plantilla.id)
        );
        showToast('error', 'No fue posible actualizar tus favoritas.');
      } finally {
        setFavoritePendingId(null);
      }
    },
    [favoritePendingId, favorites, showToast, userId]
  );

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const visibleTemplates = useMemo(
    () => plantillas.filter((template) => getNormalizedStatus(template) !== 'other'),
    [plantillas]
  );
  const filterCounts = useMemo(
    () => ({
      published: visibleTemplates.filter(
        (template) => getNormalizedStatus(template) === 'published'
      ).length,
      draft: visibleTemplates.filter((template) => getNormalizedStatus(template) === 'draft')
        .length,
      archived: visibleTemplates.filter((template) => getNormalizedStatus(template) === 'archived')
        .length,
      favorites: visibleTemplates.filter((template) => favoriteSet.has(template.id)).length,
    }),
    [favoriteSet, visibleTemplates]
  );
  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('es-MX');
    return visibleTemplates
      .filter((template) => {
        const matchesFilter =
          filterMode === 'favorites'
            ? favoriteSet.has(template.id)
            : getNormalizedStatus(template) === filterMode;
        const matchesSearch =
          !normalizedSearch ||
          getPlantillaName(template).toLocaleLowerCase('es-MX').includes(normalizedSearch) ||
          getPlantillaDesc(template).toLocaleLowerCase('es-MX').includes(normalizedSearch) ||
          template.tipo_documento?.nombre.toLocaleLowerCase('es-MX').includes(normalizedSearch);
        return matchesFilter && matchesSearch;
      })
      .sort((left, right) => {
        if (!sortMode) return 0;
        if (sortMode === 'name_asc')
          return getPlantillaName(left).localeCompare(getPlantillaName(right), 'es-MX');
        if (sortMode === 'name_desc')
          return getPlantillaName(right).localeCompare(getPlantillaName(left), 'es-MX');
        const leftTime = new Date(left.updated_at).getTime();
        const rightTime = new Date(right.updated_at).getTime();
        return sortMode === 'updated_asc' ? leftTime - rightTime : rightTime - leftTime;
      });
  }, [favoriteSet, filterMode, search, sortMode, visibleTemplates]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedTemplates = filtered.slice(
    (safeCurrentPage - 1) * TABLE_PAGE_SIZE,
    safeCurrentPage * TABLE_PAGE_SIZE
  );
  const selectedTemplateSet = new Set(selectedTemplateIds);
  const allPageTemplatesSelected =
    paginatedTemplates.length > 0 &&
    paginatedTemplates.every((template) => selectedTemplateSet.has(template.id));

  const toggleTemplateSelection = (templateId: string) => {
    setSelectedTemplateIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId]
    );
  };

  const togglePageSelection = () => {
    setSelectedTemplateIds((current) => {
      const next = new Set(current);
      if (allPageTemplatesSelected) {
        paginatedTemplates.forEach((template) => next.delete(template.id));
      } else {
        paginatedTemplates.forEach((template) => next.add(template.id));
      }
      return Array.from(next);
    });
  };

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-4 sm:px-5 md:-my-6 md:py-5 lg:px-6">
        <div className="mx-auto w-full max-w-[1600px]">
          <header className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-600 text-slate-950">Plantillas</h1>
              <p className="mt-1 text-sm text-slate-500">
                Crea y administra formatos reutilizables para tus documentos.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/plantillas/nueva"
                className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-600 text-white shadow-[0_8px_18px_-12px_rgba(30,107,255,0.85)] transition-colors hover:bg-primary/90"
              >
                <Plus size={16} />
                Nueva plantilla
              </Link>
            </div>
          </header>

          <section className="mb-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center gap-2 p-3">
              <div className="relative min-w-[160px] flex-1">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="search"
                  placeholder="Buscar plantillas..."
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-9 w-full rounded-md border border-slate-200 bg-slate-50/70 pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15"
                />
              </div>
              <div className="relative min-w-[180px]">
                <ListFilter
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <select
                  value={filterMode}
                  onChange={(event) => {
                    setFilterMode(event.target.value as TemplateFilter);
                    setCurrentPage(1);
                  }}
                  aria-label="Filtrar plantillas"
                  className="h-9 w-full appearance-none rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-700 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
                >
                  <option value="published">Publicadas ({filterCounts.published})</option>
                  <option value="draft">Borradores ({filterCounts.draft})</option>
                  <option value="archived">Archivadas ({filterCounts.archived})</option>
                  <option value="favorites">Favoritas ({filterCounts.favorites})</option>
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
              </div>
              <div className="relative min-w-[150px]">
                <ArrowUpDown
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <select
                  value={sortMode}
                  onChange={(event) => {
                    setSortMode(event.target.value as TemplateSort);
                    setCurrentPage(1);
                  }}
                  aria-label="Ordenar plantillas"
                  className="h-9 w-full appearance-none rounded-md border border-slate-200 bg-white pl-9 pr-8 text-sm text-slate-700 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
                >
                  <option value="" disabled>
                    Ordenar
                  </option>
                  <option value="updated_desc">Más recientes</option>
                  <option value="updated_asc">Más antiguas</option>
                  <option value="name_asc">Nombre A-Z</option>
                  <option value="name_desc">Nombre Z-A</option>
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
              </div>
              <div
                className="flex h-9 shrink-0 items-center overflow-hidden rounded-md border border-slate-200 bg-white p-0.5"
                aria-label="Tipo de vista"
              >
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('list');
                    setCurrentPage(1);
                  }}
                  className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${viewMode === 'list' ? 'bg-slate-100 text-slate-950' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
                  title="Vista en lista"
                  aria-label="Vista en lista"
                  aria-pressed={viewMode === 'list'}
                >
                  <LayoutList size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('grid');
                    setCurrentPage(1);
                  }}
                  className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${viewMode === 'grid' ? 'bg-slate-100 text-slate-950' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
                  title="Vista en cuadrícula"
                  aria-label="Vista en cuadrícula"
                  aria-pressed={viewMode === 'grid'}
                >
                  <LayoutGrid size={16} />
                </button>
              </div>
            </div>
          </section>

          {/* Grid / List */}
          {loading ? (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3 text-xs font-medium text-slate-500">
                Cargando plantillas...
              </div>
              <div className="divide-y divide-slate-100" aria-busy="true">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex h-[68px] items-center gap-3 px-4">
                    <div className="h-10 w-10 animate-pulse rounded-md bg-slate-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-48 animate-pulse rounded bg-slate-100" />
                      <div className="h-2.5 w-72 max-w-full animate-pulse rounded bg-slate-100" />
                    </div>
                    <div className="h-7 w-20 animate-pulse rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
                {filterMode === 'favorites' ? <Star size={21} /> : <FileText size={21} />}
              </div>
              <h3 className="text-sm font-semibold text-slate-900">
                {search
                  ? 'No se encontraron plantillas'
                  : filterMode === 'favorites'
                    ? 'Aún no tienes plantillas favoritas'
                    : filterMode === 'published'
                      ? 'No hay plantillas publicadas'
                      : filterMode === 'archived'
                        ? 'No hay plantillas archivadas'
                        : 'No hay borradores'}
              </h3>
              <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
                {search
                  ? 'Prueba con otro nombre, descripción o tipo de documento.'
                  : filterMode === 'favorites'
                    ? 'Marca una plantilla con la estrella para encontrarla aquí.'
                    : 'Crea una plantilla nueva para comenzar.'}
              </p>
            </div>
          ) : (
            <>
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {paginatedTemplates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      plantilla={template}
                      onEdit={handleEdit}
                      onPreview={handlePreview}
                      onArchive={setArchiveTarget}
                      onReactivate={handleReactivate}
                      onDuplicate={handleDuplicate}
                      isFavorite={favoriteSet.has(template.id)}
                      onToggleFavorite={handleToggleFavorite}
                      favoritePending={favoritePendingId === template.id}
                      lifecyclePending={lifecyclePendingId === template.id}
                    />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                  <table className="w-full min-w-[980px] table-fixed text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80">
                      <tr>
                        <th className="w-12 px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={allPageTemplatesSelected}
                            onChange={togglePageSelection}
                            aria-label="Seleccionar todas las plantillas de esta página"
                            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#1E6BFF]"
                          />
                        </th>
                        <th className="w-[36%] px-3 py-3 text-left text-xs font-medium text-slate-500">
                          Plantilla
                        </th>
                        <th className="w-[18%] px-3 py-3 text-left text-xs font-medium text-slate-500">
                          Tipo de documento
                        </th>
                        <th className="w-28 px-3 py-3 text-left text-xs font-medium text-slate-500">
                          Estado
                        </th>
                        <th className="w-24 px-3 py-3 text-left text-xs font-medium text-slate-500">
                          Campos
                        </th>
                        <th className="w-36 px-3 py-3 text-left text-xs font-medium text-slate-500">
                          Actualizada
                        </th>
                        <th className="w-40 px-3 py-3 text-right text-xs font-medium text-slate-500">
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedTemplates.map((template) => {
                        const statusKey = getNormalizedStatus(template);
                        const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.draft;
                        const StatusIcon = statusCfg.icon;
                        const isFavorite = favoriteSet.has(template.id);
                        const isSelected = selectedTemplateSet.has(template.id);
                        const isArchived = statusKey === 'archived';
                        const description = getPlantillaDesc(template).trim();
                        return (
                          <tr key={template.id} className="transition-colors hover:bg-slate-50/70">
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleTemplateSelection(template.id)}
                                aria-label={`Seleccionar ${getPlantillaName(template)}`}
                                className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#1E6BFF]"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <TemplateDocumentPreview plantilla={template} compact />
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-baseline gap-1.5">
                                    <p className="truncate text-sm font-medium text-slate-900">
                                      {getPlantillaName(template)}
                                    </p>
                                    <span className="shrink-0 text-[10px] font-normal text-slate-400">
                                      v{template.version_publicada || '1.0'}
                                    </span>
                                  </div>
                                  {description && (
                                    <p className="mt-0.5 truncate text-xs text-slate-500">
                                      {description}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <span className="block truncate text-xs text-slate-600">
                                {template.tipo_documento?.nombre || 'Sin clasificar'}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <span
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${statusCfg.color}`}
                              >
                                <StatusIcon size={11} />
                                {statusCfg.label}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-xs text-slate-600">
                              {getPlantillaFields(template).length}
                            </td>
                            <td className="px-3 py-3 text-xs text-slate-500">
                              {formatDate(template.updated_at)}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleToggleFavorite(template)}
                                  disabled={favoritePendingId === template.id}
                                  aria-label={
                                    isFavorite ? 'Quitar de favoritos' : 'Marcar como favorita'
                                  }
                                  title={
                                    isFavorite ? 'Quitar de favoritos' : 'Marcar como favorita'
                                  }
                                  className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-wait disabled:opacity-60 ${
                                    isFavorite
                                      ? 'bg-amber-50 text-amber-500'
                                      : 'text-slate-400 hover:bg-amber-50 hover:text-amber-500'
                                  }`}
                                >
                                  <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePreview(template.id)}
                                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-blue-50 hover:text-primary"
                                  title="Vista previa"
                                  aria-label="Vista previa de la plantilla"
                                >
                                  <Eye size={13} />
                                </button>
                                {!isArchived && (
                                  <button
                                    type="button"
                                    onClick={() => handleEdit(template.id)}
                                    className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-blue-50 hover:text-primary"
                                    title="Editar plantilla"
                                    aria-label="Editar plantilla"
                                  >
                                    <Edit size={13} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    isArchived
                                      ? handleReactivate(template)
                                      : setArchiveTarget(template)
                                  }
                                  disabled={lifecyclePendingId === template.id}
                                  className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-wait disabled:opacity-60 ${
                                    isArchived
                                      ? 'text-blue-600 hover:bg-blue-50'
                                      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                                  }`}
                                  title={isArchived ? 'Reactivar plantilla' : 'Archivar plantilla'}
                                  aria-label={
                                    isArchived ? 'Reactivar plantilla' : 'Archivar plantilla'
                                  }
                                >
                                  {isArchived ? (
                                    <ArchiveRestore size={13} />
                                  ) : (
                                    <Archive size={13} />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {totalPages > 1 && (
                <div className="mt-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Mostrando {(safeCurrentPage - 1) * TABLE_PAGE_SIZE + 1}–
                    {Math.min(safeCurrentPage * TABLE_PAGE_SIZE, filtered.length)} de{' '}
                    {filtered.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      disabled={safeCurrentPage === 1}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Página anterior"
                      aria-label="Página anterior"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <span className="min-w-20 text-center text-slate-600">
                      {safeCurrentPage} de {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                      disabled={safeCurrentPage === totalPages}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Página siguiente"
                      aria-label="Página siguiente"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Archive confirmation modal */}
      {archiveTarget && (
        <ArchiveConfirmModal
          plantillaName={getPlantillaName(archiveTarget)}
          onConfirm={handleArchiveConfirm}
          onCancel={() => setArchiveTarget(null)}
          isArchiving={lifecyclePendingId === archiveTarget.id}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg"
          style={{
            backgroundColor: toast.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: toast.type === 'success' ? '#065F46' : '#991B1B',
            border: `1px solid ${toast.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
          }}
        >
          {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
          <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}
    </AppLayout>
  );
}
