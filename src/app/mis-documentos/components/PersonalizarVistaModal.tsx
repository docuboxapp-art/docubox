'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, GripVertical, Lock, List, LayoutGrid, SlidersHorizontal } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';


// ─── Types ───────────────────────────────────────────────────────────────────

export interface ColumnConfig {
  id: string;
  label: string;
  visible: boolean;
}

export interface FilterVisibilityConfig {
  id: string;
  label: string;
  visible: boolean;
}

export interface GridColumnConfig {
  id: string;
  label: string;
  selected: boolean;
  order: number;
}

interface PersonalizarVistaModalProps {
  open: boolean;
  onClose: () => void;
  columns: ColumnConfig[];
  filters: FilterVisibilityConfig[];
  onColumnsChange: (cols: ColumnConfig[]) => void;
  onFiltersChange: (filters: FilterVisibilityConfig[]) => void;
  gridColumns?: GridColumnConfig[];
  onGridColumnsChange?: (cols: GridColumnConfig[]) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'numeroDocumento', label: 'Número de documento', visible: true },
  { id: 'folioInterno', label: 'Folio interno documento', visible: false },
  { id: 'estado', label: 'Estado', visible: true },
  { id: 'estadoParticipacion', label: 'Estado de mi participación', visible: false },
  { id: 'etiquetas', label: 'Etiquetas', visible: true },
  { id: 'tamano', label: 'Tamaño', visible: true },
  { id: 'ultimaModificacion', label: 'Última modificación', visible: true },
  { id: 'propietario', label: 'Propietario', visible: true },
  { id: 'fechaCreacion', label: 'Fecha de creación', visible: false },
  { id: 'fechaCompletado', label: 'Fecha de completado', visible: false },
  { id: 'tipoDocumento', label: 'Tipo de documento', visible: false },
  { id: 'fechaVencimiento', label: 'Fecha de vencimiento', visible: false },
  { id: 'rutaGuardado', label: 'Ruta de guardado', visible: false },
  { id: 'prioridad', label: 'Prioridad', visible: false },
];

export const DEFAULT_GRID_COLUMNS: GridColumnConfig[] = [
  { id: 'estado', label: 'Estado', selected: true, order: 1 },
  { id: 'estadoParticipacion', label: 'Estado de mi participación', selected: false, order: 2 },
  { id: 'etiquetas', label: 'Etiquetas', selected: true, order: 3 },
  { id: 'ultimaModificacion', label: 'Última modificación', selected: true, order: 4 },
  { id: 'tamano', label: 'Tamaño', selected: false, order: 5 },
  { id: 'propietario', label: 'Propietario', selected: false, order: 6 },
  { id: 'numeroDocumento', label: 'Número de documento', selected: false, order: 7 },
  { id: 'folioInterno', label: 'Folio interno', selected: false, order: 8 },
  { id: 'fechaCreacion', label: 'Fecha de creación', selected: false, order: 9 },
  { id: 'fechaCompletado', label: 'Fecha de completado', selected: false, order: 10 },
  { id: 'tipoDocumento', label: 'Tipo de documento', selected: false, order: 11 },
  { id: 'fechaVencimiento', label: 'Fecha de vencimiento', selected: false, order: 12 },
  { id: 'prioridad', label: 'Prioridad', selected: false, order: 13 },
];

// Only the filters that appear in the Mi Espacio toolbar
export const DEFAULT_FILTERS: FilterVisibilityConfig[] = [
  { id: 'estructura', label: 'Tipo', visible: true },
  { id: 'tipoDocumento', label: 'Tipo de Documento', visible: true },
  { id: 'propietario', label: 'Propietario', visible: true },
  { id: 'ultimaModificacion', label: 'Última modificación', visible: true },
  { id: 'estado', label: 'Estado', visible: true },
  { id: 'estadoParticipacion', label: 'Estado de mi participación', visible: true },
  { id: 'fechaVencimiento', label: 'Fecha de Vencimiento', visible: true },
  { id: 'etiquetas', label: 'Etiquetas', visible: false },
  { id: 'fechaCompletado', label: 'Fecha de completado', visible: false },
  { id: 'fechaCreacion', label: 'Fecha de creación', visible: false },
  { id: 'participantes', label: 'Participantes', visible: false },
  { id: 'prioridad', label: 'Prioridad', visible: false },
];

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'lista', label: 'Lista', Icon: List },
  { id: 'cuadricula', label: 'Cuadrícula', Icon: LayoutGrid },
  { id: 'filtros', label: 'Filtros', Icon: SlidersHorizontal },
] as const;

type TabId = 'lista' | 'cuadricula' | 'filtros';

// ─── Component ───────────────────────────────────────────────────────────────

export default function PersonalizarVistaModal({
  open,
  onClose,
  columns,
  filters,
  onColumnsChange,
  onFiltersChange,
  gridColumns,
  onGridColumnsChange,
}: PersonalizarVistaModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('lista');
  const [localColumns, setLocalColumns] = useState<ColumnConfig[]>(columns);
  const [localFilters, setLocalFilters] = useState<FilterVisibilityConfig[]>(filters);
  const [localGridColumns, setLocalGridColumns] = useState<GridColumnConfig[]>(
    gridColumns || DEFAULT_GRID_COLUMNS
  );

  // Drag state for columns
  const colDragIndexRef = useRef<number | null>(null);
  const colDragOverIndexRef = useRef<number | null>(null);
  const [colDragIndex, setColDragIndex] = useState<number | null>(null);
  const [colDragOverIndex, setColDragOverIndex] = useState<number | null>(null);

  // Drag state for filters
  const filDragIndexRef = useRef<number | null>(null);
  const filDragOverIndexRef = useRef<number | null>(null);
  const [filDragIndex, setFilDragIndex] = useState<number | null>(null);
  const [filDragOverIndex, setFilDragOverIndex] = useState<number | null>(null);

  // Drag state for grid columns
  const gridDragIndexRef = useRef<number | null>(null);
  const gridDragOverIndexRef = useRef<number | null>(null);
  const [gridDragIndex, setGridDragIndex] = useState<number | null>(null);
  const [gridDragOverIndex, setGridDragOverIndex] = useState<number | null>(null);

  // Sync when modal opens
  useEffect(() => {
    if (open) {
      setLocalColumns(columns);
      setLocalFilters(filters);
      setLocalGridColumns(gridColumns || DEFAULT_GRID_COLUMNS);
      setActiveTab('lista');
    }
  }, [open, columns, filters, gridColumns]);

  // ── Column handlers ──────────────────────────────────────────────────────

  const handleToggleColumn = (id: string) => {
    if (id === 'nombre') return;
    setLocalColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c))
    );
  };

  const handleColDragStart = (index: number) => {
    colDragIndexRef.current = index;
    setColDragIndex(index);
  };

  const handleColDragEnter = (index: number) => {
    colDragOverIndexRef.current = index;
    setColDragOverIndex(index);
  };

  const handleColDragEnd = () => {
    const from = colDragIndexRef.current;
    const to = colDragOverIndexRef.current;
    if (from !== null && to !== null && from !== to) {
      setLocalColumns((prev) => {
        const updated = [...prev];
        const [moved] = updated.splice(from, 1);
        updated.splice(to, 0, moved);
        return updated;
      });
    }
    colDragIndexRef.current = null;
    colDragOverIndexRef.current = null;
    setColDragIndex(null);
    setColDragOverIndex(null);
  };

  // ── Filter handlers ──────────────────────────────────────────────────────

  const handleToggleFilter = (id: string) => {
    setLocalFilters((prev) =>
      prev.map((f) => (f.id === id ? { ...f, visible: !f.visible } : f))
    );
  };

  const handleFilDragStart = (index: number) => {
    filDragIndexRef.current = index;
    setFilDragIndex(index);
  };

  const handleFilDragEnter = (index: number) => {
    filDragOverIndexRef.current = index;
    setFilDragOverIndex(index);
  };

  const handleFilDragEnd = () => {
    const from = filDragIndexRef.current;
    const to = filDragOverIndexRef.current;
    if (from !== null && to !== null && from !== to) {
      setLocalFilters((prev) => {
        const updated = [...prev];
        const [moved] = updated.splice(from, 1);
        updated.splice(to, 0, moved);
        return updated;
      });
    }
    filDragIndexRef.current = null;
    filDragOverIndexRef.current = null;
    setFilDragIndex(null);
    setFilDragOverIndex(null);
  };

  // ── Grid column handlers ─────────────────────────────────────────────────

  const selectedGridCount = localGridColumns.filter((c) => c.selected).length;

  const handleToggleGridColumn = (id: string) => {
    const col = localGridColumns.find((c) => c.id === id);
    if (!col) return;
    if (!col.selected && selectedGridCount >= 5) return;
    setLocalGridColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
    );
  };

  const handleGridDragStart = (index: number) => {
    gridDragIndexRef.current = index;
    setGridDragIndex(index);
  };

  const handleGridDragEnter = (index: number) => {
    gridDragOverIndexRef.current = index;
    setGridDragOverIndex(index);
  };

  const handleGridDragEnd = () => {
    const from = gridDragIndexRef.current;
    const to = gridDragOverIndexRef.current;
    if (from !== null && to !== null && from !== to) {
      setLocalGridColumns((prev) => {
        const updated = [...prev];
        const [moved] = updated.splice(from, 1);
        updated.splice(to, 0, moved);
        return updated.map((c, i) => ({ ...c, order: i + 1 }));
      });
    }
    gridDragIndexRef.current = null;
    gridDragOverIndexRef.current = null;
    setGridDragIndex(null);
    setGridDragOverIndex(null);
  };

  // ── Save / Reset ─────────────────────────────────────────────────────────

  const handleSave = () => {
    onColumnsChange(localColumns);
    onFiltersChange(localFilters);
    if (onGridColumnsChange) onGridColumnsChange(localGridColumns);
    onClose();
  };

  const handleReset = () => {
    if (activeTab === 'lista') {
      setLocalColumns(DEFAULT_COLUMNS);
    } else if (activeTab === 'filtros') {
      setLocalFilters(DEFAULT_FILTERS);
    } else {
      setLocalGridColumns(DEFAULT_GRID_COLUMNS);
    }
  };

  if (!open) return null;

  const activeFilterCount = localFilters.filter((f) => f.visible).length;
  const visibleColCount = localColumns.filter((c) => c.visible).length;

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Personalizar Vista</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Ajusta las columnas y filtros visibles según tus preferencias.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground ml-4 flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex mx-6 mt-4 mb-1 bg-slate-100 rounded-xl p-1 gap-1">
          {TABS.map(({ id, label, Icon }) => {
            const isActive = activeTab === id;
            // Badge count per tab
            const badge =
              id === 'lista'
                ? visibleColCount
                : id === 'cuadricula'
                ? selectedGridCount
                : activeFilterCount;

            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-1 text-sm font-medium rounded-lg transition-all relative ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                }`}
              >
                <Icon size={14} className="flex-shrink-0" />
                <span>{label}</span>
                {badge > 0 && (
                  <span
                    className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full flex items-center justify-center ${
                      isActive
                        ? 'bg-white text-blue-600' :'bg-blue-600 text-white'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {/* ── Lista tab ── */}
          {activeTab === 'lista' && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Arrastra para reordenar las columnas o usa la casilla para mostrar/ocultar. La columna <span className="font-semibold text-foreground">Nombre</span> es obligatoria.
              </p>
              <div className="space-y-1.5">
                {/* Nombre — mandatory, always first */}
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-blue-200 bg-blue-50 select-none">
                  <div className="flex items-center gap-2.5">
                    <GripVertical size={16} className="text-muted-foreground/50 flex-shrink-0" />
                    <span className="text-sm text-foreground font-medium">Nombre</span>
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
                      <Lock size={9} />
                      Obligatorio
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked
                    disabled
                    className="w-4 h-4 rounded border-border accent-blue-600 cursor-not-allowed flex-shrink-0 opacity-60"
                  />
                </div>
                {localColumns.filter((col) => col.id !== 'nombre' && col.id !== 'nombreDocumento').map((col, index) => (
                  <div
                    key={col.id}
                    draggable
                    onDragStart={() => handleColDragStart(index)}
                    onDragEnter={() => handleColDragEnter(index)}
                    onDragEnd={handleColDragEnd}
                    onDragOver={(e) => e.preventDefault()}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all cursor-grab active:cursor-grabbing select-none ${
                      colDragIndex === index
                        ? 'opacity-40 border-blue-400 bg-blue-50'
                        : colDragOverIndex === index
                        ? 'border-blue-400 bg-blue-50 shadow-sm'
                        : 'border-border bg-white hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <GripVertical size={16} className="text-muted-foreground/50 flex-shrink-0" />
                      <span className="text-sm text-foreground font-medium">{col.label}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={col.visible}
                      onChange={() => handleToggleColumn(col.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-border accent-blue-600 cursor-pointer flex-shrink-0"
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Cuadrícula tab ── */}
          {activeTab === 'cuadricula' && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Elige hasta <span className="font-semibold text-foreground">5 filas</span> para la vista cuadrícula del documento. El orden en que las acomodes define cómo aparecerán en la tarjeta.
              </p>

              {/* Nombre — mandatory in grid too */}
              <div className="mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5 px-1">Fila obligatoria</p>
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-blue-200 bg-blue-50 select-none">
                  <div className="flex items-center gap-2.5">
                    <GripVertical size={16} className="text-muted-foreground/30 flex-shrink-0" />
                    <span className="text-sm text-foreground font-medium">Nombre</span>
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
                      <Lock size={9} />
                      Obligatorio
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked
                    disabled
                    className="w-4 h-4 rounded border-border accent-blue-600 cursor-not-allowed flex-shrink-0 opacity-60"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">
                  Filas adicionales
                </p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${selectedGridCount >= 5 ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                  {selectedGridCount}/5
                </span>
              </div>

              {/* Selected rows (draggable for order) */}
              {localGridColumns.filter((c) => c.selected).length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] text-muted-foreground/50 mb-1.5 px-1 italic">Arrastra para definir el orden en la tarjeta</p>
                  <div className="space-y-1.5">
                    {localGridColumns
                      .map((col, index) => ({ col, index }))
                      .filter(({ col }) => col.selected)
                      .map(({ col, index }) => (
                        <div
                          key={col.id}
                          draggable
                          onDragStart={() => handleGridDragStart(index)}
                          onDragEnter={() => handleGridDragEnter(index)}
                          onDragEnd={handleGridDragEnd}
                          onDragOver={(e) => e.preventDefault()}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all cursor-grab active:cursor-grabbing select-none ${
                            gridDragIndex === index
                              ? 'opacity-40 border-blue-400 bg-blue-50'
                              : gridDragOverIndex === index
                              ? 'border-blue-400 bg-blue-50 shadow-sm'
                              : 'border-blue-200 bg-blue-50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <GripVertical size={16} className="text-muted-foreground/50 flex-shrink-0" />
                            <span className="text-sm text-foreground font-medium">{col.label}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked
                            onChange={() => handleToggleGridColumn(col.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded border-border accent-blue-600 cursor-pointer flex-shrink-0"
                          />
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Unselected rows */}
              {localGridColumns.filter((c) => !c.selected).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5 px-1">Disponibles</p>
                  <div className="space-y-1.5">
                    {localGridColumns
                      .map((col, index) => ({ col, index }))
                      .filter(({ col }) => !col.selected)
                      .map(({ col, index }) => (
                        <div
                          key={col.id}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all select-none ${
                            selectedGridCount >= 5
                              ? 'border-border bg-muted/20 opacity-50 cursor-not-allowed' :'border-border bg-white hover:bg-muted/30 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <GripVertical size={16} className="text-muted-foreground/30 flex-shrink-0" />
                            <span className="text-sm text-foreground font-medium">{col.label}</span>
                          </div>
                          <input
                            type="checkbox"
                            disabled={selectedGridCount >= 5}
                            onChange={() => handleToggleGridColumn(col.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded border-border accent-blue-600 cursor-pointer flex-shrink-0 disabled:cursor-not-allowed"
                          />
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {selectedGridCount >= 5 && (
                <p className="text-xs text-orange-600 font-medium mt-2 text-center">
                  Máximo 5 filas alcanzado. Desmarca una para agregar otra.
                </p>
              )}
            </>
          )}

          {/* ── Filtros tab ── */}
          {activeTab === 'filtros' && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Elige qué filtros mostrar y en qué orden aparecerán en la barra de herramientas.
              </p>
              <div className="space-y-1.5">
                {localFilters.map((filter, index) => (
                  <div
                    key={filter.id}
                    draggable
                    onDragStart={() => handleFilDragStart(index)}
                    onDragEnter={() => handleFilDragEnter(index)}
                    onDragEnd={handleFilDragEnd}
                    onDragOver={(e) => e.preventDefault()}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all cursor-grab active:cursor-grabbing select-none ${
                      filDragIndex === index
                        ? 'opacity-40 border-blue-400 bg-blue-50'
                        : filDragOverIndex === index
                        ? 'border-blue-400 bg-blue-50 shadow-sm'
                        : 'border-border bg-white hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <GripVertical size={16} className="text-muted-foreground/50 flex-shrink-0" />
                      <span className="text-sm text-foreground font-medium">{filter.label}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={filter.visible}
                      onChange={() => handleToggleFilter(filter.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-border accent-blue-600 cursor-pointer flex-shrink-0"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20">
          <button
            onClick={handleReset}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            {activeTab === 'lista' ? 'Restablecer columnas' : activeTab === 'cuadricula' ? 'Restablecer cuadrícula' : 'Restablecer filtros'}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Default columns for custom filters, favoritos, por-vencer: Nombre, Propietario, Estado, Fecha de creación, Número de documento
export const DEFAULT_CF_COLUMNS: ColumnConfig[] = [
  { id: 'nombre', label: 'Nombre', visible: true },
  { id: 'propietario', label: 'Propietario', visible: true },
  { id: 'estado', label: 'Estado', visible: true },
  { id: 'fechaCreacion', label: 'Fecha de creación', visible: true },
  { id: 'numeroDocumento', label: 'Número de documento', visible: true },
  { id: 'ultimaModificacion', label: 'Última modificación', visible: false },
  { id: 'etiquetas', label: 'Etiquetas', visible: false },
  { id: 'tamano', label: 'Tamaño', visible: false },
  { id: 'fechaVencimiento', label: 'Fecha de vencimiento', visible: false },
  { id: 'tipoDocumento', label: 'Tipo de documento', visible: false },
  { id: 'prioridad', label: 'Prioridad', visible: false },
  { id: 'folioInterno', label: 'Folio interno', visible: false },
];