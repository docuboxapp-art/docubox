'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, FileText, Clock, CheckCircle, AlertCircle, MoreHorizontal, Eye, Edit, Copy, Trash2, Tag, Grid3X3, List, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import AppLayout from '@/components/AppLayout';

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
  numero_oficio?: string;
  etiquetas_ids?: string[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  published: { label: 'Publicada', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  draft: { label: 'Borrador', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  archived: { label: 'Archivada', color: 'bg-gray-100 text-gray-500', icon: AlertCircle },
  'Publicada': { label: 'Publicada', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  'Borrador': { label: 'Borrador', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  'Archivada': { label: 'Archivada', color: 'bg-gray-100 text-gray-500', icon: AlertCircle },
  'En revisión': { label: 'En revisión', color: 'bg-blue-100 text-blue-700', icon: Clock },
};

const CATEGORY_COLORS: Record<string, string> = {
  'Contratos': 'bg-blue-100 text-blue-700',
  'Legal': 'bg-purple-100 text-purple-700',
  'Recursos Humanos': 'bg-orange-100 text-orange-700',
  'Comercial': 'bg-teal-100 text-teal-700',
  'Finanzas': 'bg-green-100 text-green-700',
};

function getPlantillaName(p: Plantilla) { return p.nombre || p.name || 'Sin nombre'; }
function getPlantillaDesc(p: Plantilla) { return p.descripcion || p.description || ''; }
function getPlantillaStatus(p: Plantilla) { return p.estado || p.status || 'draft'; }
function getPlantillaFields(p: Plantilla) { return p.campos_insertados || p.fields || []; }

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DeleteConfirmModal({
  plantillaName,
  onConfirm,
  onCancel,
  isDeleting,
}: {
  plantillaName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50">
              <Trash2 size={20} className="text-red-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Eliminar plantilla</h3>
              <p className="text-sm text-gray-500 mt-0.5">Esta acción no se puede deshacer.</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            ¿Estás seguro de que deseas eliminar <span className="font-semibold">"{plantillaName}"</span>? Se perderán todos los datos asociados.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isDeleting}
              className="h-9 flex-1 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDeleting}
              className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              {isDeleting ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Eliminando...</>
              ) : (
                <><Trash2 size={14} /> Eliminar</>
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
  onDelete,
  onDuplicate,
}: {
  plantilla: Plantilla;
  onEdit: (id: string) => void;
  onDelete: (p: Plantilla) => void;
  onDuplicate: (p: Plantilla) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const statusKey = getPlantillaStatus(plantilla);
  const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG['draft'];
  const StatusIcon = statusCfg.icon;
  const catColor = CATEGORY_COLORS[plantilla.category || ''] || 'bg-gray-100 text-gray-600';

  return (
    <article className="group flex min-h-[282px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
      {/* Preview area */}
      <div className="relative flex h-36 items-center justify-center border-b border-slate-200 bg-slate-50">
        <div className="flex h-[106px] w-[82px] flex-col gap-1.5 rounded-sm border border-slate-200 bg-white p-2.5 shadow-sm transition-transform duration-200 group-hover:-translate-y-0.5">
          <div className="mb-0.5 h-2 w-7 rounded-sm bg-blue-500" />
          <div className="h-1.5 bg-gray-300 rounded w-full" />
          <div className="h-1.5 bg-gray-200 rounded w-4/5" />
          <div className="h-1.5 bg-gray-200 rounded w-3/5" />
          <div className="h-1.5 bg-blue-200 rounded w-full border border-dashed border-blue-300" />
          <div className="h-1.5 bg-gray-200 rounded w-4/5" />
          <div className="h-1.5 bg-gray-200 rounded w-3/5" />
          <div className="h-1.5 bg-blue-200 rounded w-full border border-dashed border-blue-300" />
          <div className="h-1.5 bg-gray-200 rounded w-2/3" />
        </div>
        <div className="absolute right-2.5 top-2.5">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${statusCfg.color}`}>
            <StatusIcon size={10} />
            {statusCfg.label}
          </span>
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-blue-50/70 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onEdit(plantilla.id)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-50"
          >
            <Edit size={12} />
            Editar
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold text-foreground leading-tight line-clamp-2 flex-1">{getPlantillaName(plantilla)}</h3>
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              title="Más acciones"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button onClick={() => { onEdit(plantilla.id); setMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-muted flex items-center gap-2">
                    <Edit size={12} /> Editar
                  </button>
                  <button onClick={() => setMenuOpen(false)} className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-muted flex items-center gap-2">
                    <Eye size={12} /> Vista previa
                  </button>
                  <button onClick={() => { onDuplicate(plantilla); setMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-muted flex items-center gap-2">
                    <Copy size={12} /> Duplicar
                  </button>
                  <button onClick={() => { onDelete(plantilla); setMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2">
                    <Trash2 size={12} /> Eliminar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2 mb-3 flex-1">{getPlantillaDesc(plantilla)}</p>

        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {plantilla.category && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${catColor}`}>
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
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [deleteTarget, setDeleteTarget] = useState<Plantilla | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchPlantillas = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (search) params.set('search', search);
      const res = await fetch(`/api/plantillas?${params.toString()}`);
      const json = await res.json();
      if (json.data) setPlantillas(json.data);
      else setPlantillas([]);
    } catch {
      setPlantillas([]);
    } finally {
      setLoading(false);
    }
  }, [user, filterStatus, search]);

  useEffect(() => {
    fetchPlantillas();
  }, [fetchPlantillas]);

  const handleEdit = (id: string) => {
    router.push(`/plantillas/nueva?id=${id}`);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/plantillas/${deleteTarget.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al eliminar');
      setPlantillas((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      showToast('success', 'Plantilla eliminada correctamente');
    } catch (err: any) {
      showToast('error', err.message || 'Error al eliminar la plantilla');
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleDuplicate = async (plantilla: Plantilla) => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      const res = await fetch('/api/plantillas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

  const filtered = plantillas.filter((p) => {
    const matchSearch = !search || getPlantillaName(p).toLowerCase().includes(search.toLowerCase()) || getPlantillaDesc(p).toLowerCase().includes(search.toLowerCase());
    const matchStatus = !filterStatus || getPlantillaStatus(p) === filterStatus || (filterStatus === 'published' && p.estado_plantilla === 'Publicada') || (filterStatus === 'draft' && (p.estado_plantilla === 'Borrador' || !p.estado_plantilla));
    return matchSearch && matchStatus;
  });

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-4 sm:px-5 md:-my-6 md:py-5 lg:px-6">
        <div className="mx-auto w-full max-w-[1600px]">
          <header className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-700 text-slate-950">Plantillas</h1>
              <p className="mt-1 text-sm text-slate-500">Crea y administra formatos reutilizables para tus documentos.</p>
            </div>
            <Link
              href="/plantillas/nueva"
              className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-700 text-white shadow-[0_8px_18px_-12px_rgba(37,99,235,0.85)] transition-colors hover:bg-primary/90"
            >
              <Plus size={16} />
              Nueva plantilla
            </Link>
          </header>

        {/* Toolbar row */}
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nombre o descripción..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-200 bg-slate-50/60 pl-9 pr-4 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            <option value="published">Publicadas</option>
            <option value="draft">Borradores</option>
            <option value="archived">Archivadas</option>
          </select>
          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-white p-0.5" aria-label="Tipo de vista">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${viewMode === 'grid' ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
              title="Vista cuadrícula"
              aria-pressed={viewMode === 'grid'}
            >
              <Grid3X3 size={15} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${viewMode === 'list' ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
              title="Vista lista"
              aria-pressed={viewMode === 'list'}
            >
              <List size={15} />
            </button>
          </div>
        </div>

        {/* Grid / List */}
        {loading ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              Cargando plantillas...
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50">
              <FileText size={22} className="text-blue-600" />
            </div>
            <h3 className="mb-1 text-base font-semibold text-slate-900">No se encontraron plantillas</h3>
            <p className="mb-4 text-sm text-slate-500">
              {search || filterStatus ? 'Intenta con otros filtros' : 'Crea tu primera plantilla para comenzar'}
            </p>
            <Link
              href="/plantillas/nueva"
              className="flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Plus size={15} />
              Nueva plantilla
            </Link>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* New template card */}
            <Link
              href="/plantillas/nueva"
              className="group flex min-h-[282px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-blue-300 bg-blue-50/30 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-400 hover:bg-blue-50 hover:shadow-sm"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-blue-200 bg-white shadow-sm transition-colors group-hover:border-blue-300">
                <Plus size={20} className="text-blue-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-700">Nueva plantilla</p>
                <p className="mt-0.5 text-xs text-slate-500">Crear desde cero</p>
              </div>
            </Link>
            {filtered.map((p) => (
              <TemplateCard key={p.id} plantilla={p} onEdit={handleEdit} onDelete={setDeleteTarget} onDuplicate={handleDuplicate} />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Nombre</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Actualizado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const statusKey = getPlantillaStatus(p);
                  const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG['draft'];
                  const StatusIcon = statusCfg.icon;
                  return (
                    <tr key={p.id} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-blue-50">
                            <FileText size={14} className="text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground text-sm">{getPlantillaName(p)}</p>
                            <p className="text-xs text-muted-foreground line-clamp-1">{getPlantillaDesc(p)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {p.tipo_documento?.nombre ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                            {p.tipo_documento.nombre}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                          <StatusIcon size={10} />
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(p.updated_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleEdit(p.id)}
                            className="flex h-8 items-center gap-1.5 rounded-md border border-blue-200 px-2.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50"
                          >
                            <Edit size={11} />
                            Editar
                          </button>
                          <button
                            onClick={() => setDeleteTarget(p)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-50 hover:text-red-700"
                            title="Eliminar plantilla"
                          >
                            <Trash2 size={11} />
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
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          plantillaName={getPlantillaName(deleteTarget)}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          isDeleting={isDeleting}
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
