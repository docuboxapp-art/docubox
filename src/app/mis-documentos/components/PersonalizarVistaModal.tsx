'use client';

import React, { useState, useRef, useId, useEffect } from 'react';
import {
  X,
  GripVertical,
  Lock,
  List,
  LayoutGrid,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import {
  DEFAULT_COLUMNS,
  DEFAULT_FILTERS,
  DEFAULT_GRID_COLUMNS,
  type ColumnConfig,
  type FilterVisibilityConfig,
  type GridColumnConfig,
} from './view-config';

interface PersonalizarVistaModalProps {
  open: boolean;
  onClose: () => void;
  columns: ColumnConfig[];
  filters: FilterVisibilityConfig[];
  onColumnsChange?: (cols: ColumnConfig[]) => void;
  onFiltersChange?: (filters: FilterVisibilityConfig[]) => void;
  gridColumns?: GridColumnConfig[];
  onGridColumnsChange?: (cols: GridColumnConfig[]) => void;
  defaultColumns?: ColumnConfig[];
  defaultFilters?: FilterVisibilityConfig[];
  defaultGridColumns?: GridColumnConfig[];
  mandatoryColumnLabel?: string;
  entityLabel?: string;
  onSave?: (value: {
    columns: ColumnConfig[];
    filters: FilterVisibilityConfig[];
    gridColumns: GridColumnConfig[];
  }) => Promise<void>;
}

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'lista', label: 'Lista', Icon: List },
  { id: 'cuadricula', label: 'Cuadrícula', Icon: LayoutGrid },
  { id: 'filtros', label: 'Filtros', Icon: SlidersHorizontal },
] as const;

type TabId = 'lista' | 'cuadricula' | 'filtros';

function moveInGroup<T extends { id: string }>(
  items: T[],
  id: string,
  direction: number,
  include: (item: T) => boolean
) {
  const group = items.filter(include);
  const target = group[group.findIndex((item) => item.id === id) + direction];
  if (!target) return items;
  const next = [...items];
  const from = next.findIndex((item) => item.id === id);
  const to = next.findIndex((item) => item.id === target.id);
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

function TouchReorder({
  label,
  first,
  last,
  onMove,
}: {
  label: string;
  first: boolean;
  last: boolean;
  onMove: (direction: number) => void;
}) {
  return (
    <span className="touch-reorder-controls">
      <button
        type="button"
        aria-label={`Subir ${label}`}
        disabled={first}
        onClick={() => onMove(-1)}
      >
        <ChevronUp size={16} />
      </button>
      <button type="button" aria-label={`Bajar ${label}`} disabled={last} onClick={() => onMove(1)}>
        <ChevronDown size={16} />
      </button>
    </span>
  );
}

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
  defaultColumns = DEFAULT_COLUMNS,
  defaultFilters = DEFAULT_FILTERS,
  defaultGridColumns = DEFAULT_GRID_COLUMNS,
  mandatoryColumnLabel = 'Nombre',
  entityLabel = 'documento',
  onSave,
}: PersonalizarVistaModalProps) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    return () => previous?.focus();
  }, [open]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const requestClose = () => {
    if (!saving) onClose();
  };
  function reordered<T>(items: T[], from: number, to: number) {
    if (to < 0 || to >= items.length) return items;
    const next = [...items];
    const [entry] = next.splice(from, 1);
    next.splice(to, 0, entry);
    return next;
  }
  const [activeTab, setActiveTab] = useState<TabId>('lista');
  const [localColumns, setLocalColumns] = useState<ColumnConfig[]>(columns);
  const [localFilters, setLocalFilters] = useState<FilterVisibilityConfig[]>(filters);
  const [localGridColumns, setLocalGridColumns] = useState<GridColumnConfig[]>(
    gridColumns || defaultGridColumns
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

  // ── Column handlers ──────────────────────────────────────────────────────

  const handleToggleColumn = (id: string) => {
    if (id === 'nombre') return;
    setLocalColumns((prev) => prev.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
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
    setLocalFilters((prev) => prev.map((f) => (f.id === id ? { ...f, visible: !f.visible } : f)));
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

  const handleSave = async () => {
    if (saving) return;
    setSaveError('');
    setSaving(true);
    try {
      if (onSave)
        await onSave({
          columns: localColumns,
          filters: localFilters,
          gridColumns: localGridColumns,
        });
      else {
        onColumnsChange?.(localColumns);
        onFiltersChange?.(localFilters);
        onGridColumnsChange?.(localGridColumns);
      }
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar la vista.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (activeTab === 'lista') {
      setLocalColumns(defaultColumns.map((c) => ({ ...c })));
    } else if (activeTab === 'filtros') {
      setLocalFilters(defaultFilters.map((c) => ({ ...c })));
    } else {
      setLocalGridColumns(defaultGridColumns.map((c) => ({ ...c })));
    }
  };

  if (!open) return null;

  const activeFilterCount = localFilters.filter((f) => f.visible).length;
  const visibleColCount = localColumns.filter((c) => c.visible).length;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40"
      onClick={requestClose}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={saving}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            const focusable = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),[tabindex="0"]'
              )
            ).filter((el) => el.getClientRects().length);
            const first = focusable[0],
              last = focusable[focusable.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last || document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              first?.focus();
            }
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            requestClose();
          }
        }}
        className="personalize-view-panel bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between px-6 pt-6 pb-4 border-b border-border">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-foreground">
              Personalizar Vista
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Ajusta las columnas y filtros visibles según tus preferencias.
            </p>
          </div>
          <button
            disabled={saving}
            onClick={requestClose}
            aria-label="Cerrar Personalizar vista"
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground ml-4 flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Personalización de la vista"
          className="flex shrink-0 mx-6 mt-4 mb-1 bg-slate-100 rounded-xl p-1 gap-1"
        >
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
                disabled={saving}
                key={id}
                role="tab"
                aria-selected={isActive}
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
                    className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full flex items-center justify-center ${
                      isActive ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'
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
        <div
          className={`${saving ? 'pointer-events-none ' : ''}min-h-0 flex-1 overflow-y-auto px-6 py-3`}
        >
          <fieldset disabled={saving} className="min-w-0 border-0 p-0">
            {/* ── Lista tab ── */}
            {activeTab === 'lista' && (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  Arrastra para reordenar las columnas o usa la casilla para mostrar/ocultar. La
                  columna{' '}
                  <span className="font-semibold text-foreground">{mandatoryColumnLabel}</span> es
                  obligatoria.
                </p>
                <div className="space-y-1.5">
                  {/* Nombre — mandatory, always first */}
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-blue-200 bg-blue-50 select-none">
                    <div className="flex items-center gap-2.5">
                      <GripVertical size={16} className="text-muted-foreground/50 flex-shrink-0" />
                      <span className="text-sm text-foreground font-medium">
                        {mandatoryColumnLabel}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
                        <Lock size={9} />
                        Obligatorio
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked
                      aria-label={`Mostrar columna ${mandatoryColumnLabel}`}
                      disabled
                      className="w-4 h-4 rounded border-border accent-blue-600 cursor-not-allowed flex-shrink-0 opacity-60"
                    />
                  </div>
                  {localColumns
                    .filter((col) => col.id !== 'nombre' && col.id !== 'nombreDocumento')
                    .map((col, index) => (
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
                          <button
                            disabled={saving}
                            type="button"
                            aria-label={`Reordenar columna ${col.label}`}
                            title="Arrastra o usa las flechas para reordenar"
                            onKeyDown={(event) => {
                              if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
                                event.preventDefault();
                                setLocalColumns((prev) =>
                                  reordered(prev, index, index + (event.key === 'ArrowUp' ? -1 : 1))
                                );
                              }
                            }}
                            className="rounded p-0.5 text-muted-foreground/50 focus-visible:outline-primary"
                          >
                            <GripVertical size={16} />
                          </button>
                          <span className="text-sm text-foreground font-medium">{col.label}</span>
                        </div>
                        <TouchReorder
                          label={`columna ${col.label}`}
                          first={index === 0}
                          last={
                            index ===
                            localColumns.filter(
                              (item) => item.id !== 'nombre' && item.id !== 'nombreDocumento'
                            ).length -
                              1
                          }
                          onMove={(direction) =>
                            setLocalColumns((prev) =>
                              moveInGroup(
                                prev,
                                col.id,
                                direction,
                                (item) => item.id !== 'nombre' && item.id !== 'nombreDocumento'
                              )
                            )
                          }
                        />
                        <input
                          type="checkbox"
                          aria-label={`Mostrar columna ${col.label}`}
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
                  Elige hasta <span className="font-semibold text-foreground">5 filas</span> para la
                  vista cuadrícula del {entityLabel}. El orden en que las acomodes define cómo
                  aparecerán en la tarjeta.
                </p>

                {/* Nombre — mandatory in grid too */}
                <div className="mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5 px-1">
                    Fila obligatoria
                  </p>
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-blue-200 bg-blue-50 select-none">
                    <div className="flex items-center gap-2.5">
                      <GripVertical size={16} className="text-muted-foreground/30 flex-shrink-0" />
                      <span className="text-sm text-foreground font-medium">
                        {mandatoryColumnLabel}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
                        <Lock size={9} />
                        Obligatorio
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked
                      aria-label={`Mostrar columna ${mandatoryColumnLabel}`}
                      disabled
                      className="w-4 h-4 rounded border-border accent-blue-600 cursor-not-allowed flex-shrink-0 opacity-60"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">
                    Filas adicionales
                  </p>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${selectedGridCount >= 5 ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}
                  >
                    {selectedGridCount}/5
                  </span>
                </div>

                {/* Selected rows (draggable for order) */}
                {localGridColumns.filter((c) => c.selected).length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] text-muted-foreground/50 mb-1.5 px-1 italic">
                      Arrastra para definir el orden en la tarjeta
                    </p>
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
                              <button
                                disabled={saving}
                                type="button"
                                aria-label={`Reordenar fila ${col.label}`}
                                title="Arrastra o usa las flechas para reordenar"
                                onKeyDown={(event) => {
                                  if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
                                    event.preventDefault();
                                    setLocalGridColumns((prev) =>
                                      moveInGroup(
                                        prev,
                                        col.id,
                                        event.key === 'ArrowUp' ? -1 : 1,
                                        (item) => item.selected
                                      ).map((item, position) => ({ ...item, order: position + 1 }))
                                    );
                                  }
                                }}
                                className="rounded p-0.5 text-muted-foreground/50 focus-visible:outline-primary"
                              >
                                <GripVertical size={16} />
                              </button>
                              <span className="text-sm text-foreground font-medium">
                                {col.label}
                              </span>
                            </div>
                            <TouchReorder
                              label={`fila ${col.label}`}
                              first={localGridColumns.find((item) => item.selected)?.id === col.id}
                              last={
                                localGridColumns.filter((item) => item.selected).at(-1)?.id ===
                                col.id
                              }
                              onMove={(direction) =>
                                setLocalGridColumns((prev) =>
                                  moveInGroup(prev, col.id, direction, (item) => item.selected).map(
                                    (item, position) => ({ ...item, order: position + 1 })
                                  )
                                )
                              }
                            />
                            <input
                              type="checkbox"
                              aria-label={`Mostrar en cuadrícula ${col.label}`}
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
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5 px-1">
                      Disponibles
                    </p>
                    <div className="space-y-1.5">
                      {localGridColumns
                        .map((col) => ({ col }))
                        .filter(({ col }) => !col.selected)
                        .map(({ col }) => (
                          <div
                            key={col.id}
                            className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all select-none ${
                              selectedGridCount >= 5
                                ? 'border-border bg-muted/20 opacity-50 cursor-not-allowed'
                                : 'border-border bg-white hover:bg-muted/30 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <GripVertical
                                size={16}
                                className="text-muted-foreground/30 flex-shrink-0"
                              />
                              <span className="text-sm text-foreground font-medium">
                                {col.label}
                              </span>
                            </div>
                            <input
                              type="checkbox"
                              aria-label={`Mostrar en cuadrícula ${col.label}`}
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
                        <button
                          disabled={saving}
                          type="button"
                          aria-label={`Reordenar filtro ${filter.label}`}
                          title="Arrastra o usa las flechas para reordenar"
                          onKeyDown={(event) => {
                            if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
                              event.preventDefault();
                              setLocalFilters((prev) =>
                                reordered(prev, index, index + (event.key === 'ArrowUp' ? -1 : 1))
                              );
                            }
                          }}
                          className="rounded p-0.5 text-muted-foreground/50 focus-visible:outline-primary"
                        >
                          <GripVertical size={16} />
                        </button>
                        <span className="text-sm text-foreground font-medium">{filter.label}</span>
                      </div>
                      <TouchReorder
                        label={`filtro ${filter.label}`}
                        first={index === 0}
                        last={index === localFilters.length - 1}
                        onMove={(direction) =>
                          setLocalFilters((prev) =>
                            moveInGroup(prev, filter.id, direction, () => true)
                          )
                        }
                      />
                      <input
                        type="checkbox"
                        aria-label={`Mostrar filtro ${filter.label}`}
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
          </fieldset>
        </div>
        {saveError && (
          <p role="alert" className="px-6 pb-3 text-sm text-red-600">
            {saveError}
          </p>
        )}

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-t border-border bg-muted/20">
          <button
            disabled={saving}
            onClick={handleReset}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            {activeTab === 'lista'
              ? 'Restablecer columnas'
              : activeTab === 'cuadricula'
                ? 'Restablecer cuadrícula'
                : 'Restablecer filtros'}
          </button>
          <div className="flex items-center gap-2">
            <button
              disabled={saving}
              onClick={requestClose}
              className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              disabled={saving}
              onClick={handleSave}
              className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {saving ? 'Guardando…' : 'Aplicar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
