'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, FileText, Clock, CheckCircle, AlertCircle, MoreHorizontal, Eye, Edit, Copy, Trash2, Tag, Grid3X3, List, BookOpen, X } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center shrink-0">
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
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDeleting}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
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
    <div className="bg-white rounded-xl border border-border hover:border-primary/40 hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden group">
      {/* Preview area */}
      <div className="relative bg-gradient-to-br from-gray-50 to-gray-100 h-40 flex items-center justify-center border-b border-border">
        <div className="w-24 bg-white rounded shadow-sm p-2 flex flex-col gap-1.5">
          <div className="h-1.5 bg-gray-300 rounded w-full" />
          <div className="h-1.5 bg-gray-200 rounded w-4/5" />
          <div className="h-1.5 bg-gray-200 rounded w-3/5" />
          <div className="h-1.5 bg-blue-200 rounded w-full border border-dashed border-blue-300" />
          <div className="h-1.5 bg-gray-200 rounded w-4/5" />
          <div className="h-1.5 bg-gray-200 rounded w-3/5" />
          <div className="h-1.5 bg-blue-200 rounded w-full border border-dashed border-blue-300" />
          <div className="h-1.5 bg-gray-200 rounded w-2/3" />
        </div>
        <div className="absolute top-2 right-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
            <StatusIcon size={10} />
            {statusCfg.label}
          </span>
        </div>
        <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <button
            onClick={() => onEdit(plantilla.id)}
            className="bg-white text-primary border border-primary/20 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm hover:bg-primary/5 transition-colors flex items-center gap-1"
          >
            <Edit size={12} />
            Editar
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold text-foreground leading-tight line-clamp-2 flex-1">{getPlantillaName(plantilla)}</h3>
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-6 z-20 bg-white border border-border rounded-lg shadow-lg py-1 w-40">
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

        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2 mt-auto">
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
    </div>
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
      <div className="w-full max-w-none px-4 sm:px-6 lg:px-8 pt-2 pb-4 md:pb-6 min-h-[calc(100vh-8rem)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <BookOpen size={24} className="text-primary" />
              Plantillas
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Gestiona y crea plantillas de documentos reutilizables</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/plantillas/nueva"
              className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <Plus size={16} />
              Nueva plantilla
            </Link>
          </div>
        </div>

        {/* Toolbar row */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="flex-1 relative min-w-[160px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar plantillas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
          >
            <option value="">Todos los estados</option>
            <option value="published">Publicadas</option>
            <option value="draft">Borradores</option>
            <option value="archived">Archivadas</option>
          </select>
          <div className="flex items-center border border-border rounded-lg overflow-hidden bg-white">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              title="Vista cuadrícula"
            >
              <Grid3X3 size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              title="Vista lista"
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* Grid / List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <FileText size={28} className="text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">No se encontraron plantillas</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {search || filterStatus ? 'Intenta con otros filtros' : 'Crea tu primera plantilla para comenzar'}
            </p>
            <Link
              href="/plantillas/nueva"
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 transition-colors"
            >
              <Plus size={15} />
              Nueva plantilla
            </Link>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* New template card */}
            <Link
              href="/plantillas/nueva"
              className="bg-white rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 flex flex-col items-center justify-center gap-3 h-64 group"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center transition-colors">
                <Plus size={22} className="text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground group-hover:text-primary">Nueva plantilla</p>
                <p className="text-xs text-muted-foreground mt-0.5">Crear desde cero</p>
              </div>
            </Link>
            {filtered.map((p) => (
              <TemplateCard key={p.id} plantilla={p} onEdit={handleEdit} onDelete={setDeleteTarget} onDuplicate={handleDuplicate} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nombre</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tipo</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actualizado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((p) => {
                  const statusKey = getPlantillaStatus(p);
                  const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG['draft'];
                  const StatusIcon = statusCfg.icon;
                  return (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                            <FileText size={14} className="text-primary" />
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
                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary border border-primary/20 rounded-lg hover:bg-primary/5 transition-colors"
                          >
                            <Edit size={11} />
                            Editar
                          </button>
                          <button
                            onClick={() => setDeleteTarget(p)}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
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
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium"
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
