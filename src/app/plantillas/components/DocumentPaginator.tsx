'use client';

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';

// ─── Page size definitions (px at 96 DPI) ────────────────────────────────────

export type PaperSize =
  | 'Carta (Letter)'
  | 'Oficio (Legal)' | 'A4' | 'A3' | 'A5' | 'Tabloide';

export type PageOrientation = 'vertical' | 'horizontal';

interface PageDimensions {
  width: number;
  height: number;
}

const PAGE_SIZES: Record<PaperSize, PageDimensions> = {
  'Carta (Letter)': { width: 816, height: 1056 },
  'Oficio (Legal)': { width: 816, height: 1344 },
  A4: { width: 794, height: 1123 },
  A3: { width: 1123, height: 1587 },
  A5: { width: 559, height: 794 },
  Tabloide: { width: 1056, height: 1632 },
};

// Default margins in px (at 96dpi, 1cm ≈ 37.8px)
const DEFAULT_MARGIN_TOP = 40;
const DEFAULT_MARGIN_BOTTOM = 40;
const DEFAULT_MARGIN_LEFT = 60;
const DEFAULT_MARGIN_RIGHT = 60;
const PAGE_HEADER_HEIGHT = 32;

export interface PageMargins {
  top: number;    // cm
  bottom: number; // cm
  left: number;   // cm
  right: number;  // cm
}

function cmToPx(cm: number): number {
  return Math.round(cm * 37.795);
}

function getPageDimensions(
  size: PaperSize,
  orientation: PageOrientation
): PageDimensions {
  const base = PAGE_SIZES[size] ?? PAGE_SIZES['Carta (Letter)'];
  if (orientation === 'horizontal') {
    return { width: base.height, height: base.width };
  }
  return base;
}

function getContentHeight(dims: PageDimensions, margins?: PageMargins): number {
  const mt = margins ? cmToPx(margins.top) : DEFAULT_MARGIN_TOP;
  const mb = margins ? cmToPx(margins.bottom) : DEFAULT_MARGIN_BOTTOM;
  // PAGE_HEADER_HEIGHT is display:none so we don't subtract it.
  // Top and bottom margins are occupied by header/footer zones (or spacers),
  // so the editable content area height is the full page minus those margins.
  return dims.height - mt - mb;
}

function getContentWidth(dims: PageDimensions, margins?: PageMargins): number {
  const ml = margins ? cmToPx(margins.left) : DEFAULT_MARGIN_LEFT;
  const mr = margins ? cmToPx(margins.right) : DEFAULT_MARGIN_RIGHT;
  return dims.width - ml - mr;
}

// ─── Inline styles ────────────────────────────────────────────────────────────

const documentPreviewStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '40px',
  padding: '48px 0',
  background: '#eef0f4',
  minHeight: '100vh',
};

function pageStyle(dims: PageDimensions): React.CSSProperties {
  return {
    width: `${dims.width}px`,
    height: `${dims.height}px`,
    background: 'white',
    border: '1px solid #d1d5db',
    boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
    boxSizing: 'border-box',
    overflow: 'hidden',
    flexShrink: 0,
    position: 'relative',
  };
}

const pageHeaderStyle: React.CSSProperties = {
  height: `${PAGE_HEADER_HEIGHT}px`,
  fontSize: '11px',
  color: '#6b7280',
  borderBottom: '1px solid #e5e7eb',
  display: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  userSelect: 'none',
  pointerEvents: 'none',
};

function pageContentStyle(margins?: PageMargins): React.CSSProperties {
  const mt = margins ? cmToPx(margins.top) : DEFAULT_MARGIN_TOP;
  const mb = margins ? cmToPx(margins.bottom) : DEFAULT_MARGIN_BOTTOM;
  const ml = margins ? cmToPx(margins.left) : DEFAULT_MARGIN_LEFT;
  const mr = margins ? cmToPx(margins.right) : DEFAULT_MARGIN_RIGHT;
  return {
    height: '100%',
    padding: `${mt}px ${mr}px ${mb}px ${ml}px`,
    boxSizing: 'border-box',
    overflow: 'hidden',
  };
}

// ─── Horizontal Ruler ─────────────────────────────────────────────────────────

function HorizontalRuler({ width, marginLeft, marginRight }: { width: number; marginLeft: number; marginRight: number }) {
  const totalWidth = width;
  const ticks = [];
  const tickSpacingPx = 37.795 / 2;
  const numTicks = Math.floor(totalWidth / tickSpacingPx);

  for (let i = 0; i <= numTicks; i++) {
    const x = i * tickSpacingPx;
    const isCm = i % 2 === 0;
    const cmVal = i / 2;
    ticks.push(
      <g key={i}>
        <line
          x1={x} y1={isCm ? 0 : 8}
          x2={x} y2={20}
          stroke="#9ca3af"
          strokeWidth={isCm ? 1 : 0.5}
        />
        {isCm && cmVal > 0 && (
          <text x={x} y={10} fontSize="7" fill="#9ca3af" textAnchor="middle" dominantBaseline="middle">
            {Math.round((x - marginLeft) / 37.795)}
          </text>
        )}
      </g>
    );
  }

  return (
    <div style={{ width: totalWidth, height: 20, position: 'relative', flexShrink: 0, userSelect: 'none' }}>
      <svg width={totalWidth} height={20} style={{ display: 'block' }}>
        <rect width={totalWidth} height={20} fill="#f3f4f6" />
        <rect x={0} y={0} width={marginLeft} height={20} fill="#e5e7eb" opacity={0.7} />
        <rect x={totalWidth - marginRight} y={0} width={marginRight} height={20} fill="#e5e7eb" opacity={0.7} />
        {ticks}
        <polygon points={`${marginLeft},20 ${marginLeft - 5},12 ${marginLeft + 5},12`} fill="#3b82f6" />
        <polygon points={`${totalWidth - marginRight},20 ${totalWidth - marginRight - 5},12 ${totalWidth - marginRight + 5},12`} fill="#3b82f6" />
      </svg>
    </div>
  );
}

// ─── Vertical Ruler ───────────────────────────────────────────────────────────

function VerticalRuler({ height, marginTop, marginBottom }: { height: number; marginTop: number; marginBottom: number }) {
  const ticks = [];
  const tickSpacingPx = 37.795 / 2;
  const numTicks = Math.floor(height / tickSpacingPx);

  for (let i = 0; i <= numTicks; i++) {
    const y = i * tickSpacingPx;
    const isCm = i % 2 === 0;
    const cmVal = i / 2;
    ticks.push(
      <g key={i}>
        <line
          x1={isCm ? 0 : 8} y1={y}
          x2={20} y2={y}
          stroke="#9ca3af"
          strokeWidth={isCm ? 1 : 0.5}
        />
        {isCm && cmVal > 0 && (
          <text
            x={10} y={y}
            fontSize="7" fill="#9ca3af"
            textAnchor="middle" dominantBaseline="middle"
            transform={`rotate(-90, 10, ${y})`}
          >
            {Math.round((y - marginTop) / 37.795)}
          </text>
        )}
      </g>
    );
  }

  return (
    <div style={{ width: 20, height, position: 'relative', flexShrink: 0, userSelect: 'none' }}>
      <svg width={20} height={height} style={{ display: 'block' }}>
        <rect width={20} height={height} fill="#f3f4f6" />
        <rect x={0} y={0} width={20} height={marginTop} fill="#e5e7eb" opacity={0.7} />
        <rect x={0} y={height - marginBottom} width={20} height={marginBottom} fill="#e5e7eb" opacity={0.7} />
        {ticks}
        <polygon points={`20,${marginTop} 12,${marginTop - 5} 12,${marginTop + 5}`} fill="#3b82f6" />
        <polygon points={`20,${height - marginBottom} 12,${height - marginBottom - 5} 12,${height - marginBottom + 5}`} fill="#3b82f6" />
      </svg>
    </div>
  );
}

// ─── Table Contextual Toolbar ─────────────────────────────────────────────────

interface TableToolbarState {
  visible: boolean;
  top: number;
  left: number;
  targetCell: HTMLTableCellElement | null;
  targetTable: HTMLTableElement | null;
}

function TableContextualToolbar({
  state,
  onClose,
}: {
  state: TableToolbarState;
  onClose: () => void;
}) {
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [showBorderMenu, setShowBorderMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.visible) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [state.visible, onClose]);

  if (!state.visible || !state.targetCell || !state.targetTable) return null;

  const table = state.targetTable;
  const cell = state.targetCell;

  const insertRowAbove = () => {
    const row = cell.closest('tr') as HTMLTableRowElement;
    if (!row) return;
    const newRow = row.cloneNode(true) as HTMLTableRowElement;
    Array.from(newRow.cells).forEach((c) => { c.innerHTML = '&nbsp;'; });
    row.parentNode?.insertBefore(newRow, row);
    onClose();
  };

  const insertRowBelow = () => {
    const row = cell.closest('tr') as HTMLTableRowElement;
    if (!row) return;
    const newRow = row.cloneNode(true) as HTMLTableRowElement;
    Array.from(newRow.cells).forEach((c) => { c.innerHTML = '&nbsp;'; });
    row.parentNode?.insertBefore(newRow, row.nextSibling);
    onClose();
  };

  const deleteRow = () => {
    const row = cell.closest('tr') as HTMLTableRowElement;
    if (!row) return;
    const tbody = row.parentNode;
    if (tbody && tbody.childNodes.length > 1) {
      tbody.removeChild(row);
    }
    onClose();
  };

  const insertColLeft = () => {
    const row = cell.closest('tr') as HTMLTableRowElement;
    if (!row) return;
    const colIdx = Array.from(row.cells).indexOf(cell);
    Array.from(table.rows).forEach((r) => {
      const newCell = r.insertCell(colIdx);
      newCell.innerHTML = '&nbsp;';
      newCell.style.cssText = 'border:1px solid #ccc;padding:6px 8px;min-width:40px;';
    });
    onClose();
  };

  const insertColRight = () => {
    const row = cell.closest('tr') as HTMLTableRowElement;
    if (!row) return;
    const colIdx = Array.from(row.cells).indexOf(cell);
    Array.from(table.rows).forEach((r) => {
      const newCell = r.insertCell(colIdx + 1);
      newCell.innerHTML = '&nbsp;';
      newCell.style.cssText = 'border:1px solid #ccc;padding:6px 8px;min-width:40px;';
    });
    onClose();
  };

  const deleteCol = () => {
    const row = cell.closest('tr') as HTMLTableRowElement;
    if (!row) return;
    const colIdx = Array.from(row.cells).indexOf(cell);
    if (Array.from(table.rows[0]?.cells ?? []).length <= 1) return;
    Array.from(table.rows).forEach((r) => {
      if (r.cells[colIdx]) r.deleteCell(colIdx);
    });
    onClose();
  };

  const setCellBg = (color: string) => {
    cell.style.backgroundColor = color;
    setShowBgPicker(false);
    onClose();
  };

  const setCellAlign = (align: string) => {
    cell.style.textAlign = align;
    cell.style.verticalAlign = 'middle';
    onClose();
  };

  const setBorder = (style: string) => {
    if (style === 'all') {
      Array.from(table.querySelectorAll('td, th')).forEach((c) => {
        (c as HTMLElement).style.border = '1px solid #ccc';
      });
    } else if (style === 'none') {
      Array.from(table.querySelectorAll('td, th')).forEach((c) => {
        (c as HTMLElement).style.border = 'none';
      });
    } else if (style === 'outer') {
      table.style.border = '2px solid #374151';
      Array.from(table.querySelectorAll('td, th')).forEach((c) => {
        (c as HTMLElement).style.border = 'none';
      });
    }
    setShowBorderMenu(false);
    onClose();
  };

  const BtnSm = ({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1 rounded hover:bg-gray-100 text-gray-700 text-xs flex items-center justify-center"
    >
      {children}
    </button>
  );

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl flex items-center gap-0.5 px-1.5 py-1"
      style={{ top: state.top, left: state.left }}
    >
      {/* Row operations */}
      <BtnSm onClick={insertRowAbove} title="Insertar fila arriba">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="12" y1="3" x2="12" y2="9"/></svg>
      </BtnSm>
      <BtnSm onClick={insertRowBelow} title="Insertar fila abajo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="12" y1="15" x2="12" y2="21"/></svg>
      </BtnSm>
      <BtnSm onClick={deleteRow} title="Eliminar fila">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="9" y1="8" x2="15" y2="16"/><line x1="15" y1="8" x2="9" y2="16"/></svg>
      </BtnSm>

      <div className="w-px h-5 bg-gray-200 mx-0.5" />

      {/* Column operations */}
      <BtnSm onClick={insertColLeft} title="Insertar columna izquierda">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="12" x2="9" y2="12"/></svg>
      </BtnSm>
      <BtnSm onClick={insertColRight} title="Insertar columna derecha">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="15" y1="12" x2="21" y2="12"/></svg>
      </BtnSm>
      <BtnSm onClick={deleteCol} title="Eliminar columna">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/></svg>
      </BtnSm>

      <div className="w-px h-5 bg-gray-200 mx-0.5" />

      {/* Cell alignment */}
      <BtnSm onClick={() => setCellAlign('left')} title="Alinear izquierda">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
      </BtnSm>
      <BtnSm onClick={() => setCellAlign('center')} title="Centrar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
      </BtnSm>
      <BtnSm onClick={() => setCellAlign('right')} title="Alinear derecha">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
      </BtnSm>

      <div className="w-px h-5 bg-gray-200 mx-0.5" />

      {/* Cell background color */}
      <div className="relative">
        <button
          type="button"
          title="Color de fondo de celda"
          onClick={() => setShowBgPicker((v) => !v)}
          className="p-1 rounded hover:bg-gray-100 text-gray-700 flex items-center gap-0.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {showBgPicker && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-2 z-[10000]">
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Color de celda</p>
            <div className="grid grid-cols-6 gap-1 mb-2">
              {['#ffffff','#f3f4f6','#fef3c7','#fee2e2','#dbeafe','#d1fae5','#ede9fe','#fce7f3','#ffedd5','#e0f2fe','#374151','#1e40af','#065f46','#7c3aed','#9f1239','#92400e'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCellBg(c)}
                  className="w-5 h-5 rounded border border-gray-300 hover:scale-110 transition-transform"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
              <input type="color" className="w-5 h-5 cursor-pointer rounded" onChange={(e) => setCellBg(e.target.value)} />
              Personalizado
            </label>
          </div>
        )}
      </div>

      {/* Borders */}
      <div className="relative">
        <button
          type="button"
          title="Bordes de tabla"
          onClick={() => setShowBorderMenu((v) => !v)}
          className="p-1 rounded hover:bg-gray-100 text-gray-700 flex items-center gap-0.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {showBorderMenu && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-[10000] min-w-[160px]">
            <button type="button" onClick={() => setBorder('all')} className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Todos los bordes</button>
            <button type="button" onClick={() => setBorder('outer')} className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Solo borde exterior</button>
            <button type="button" onClick={() => setBorder('none')} className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Sin bordes</button>
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-gray-200 mx-0.5" />

      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        title="Cerrar"
        className="p-1 rounded hover:bg-gray-100 text-gray-700 text-xs flex items-center justify-center"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}

// ─── Image Contextual Toolbar ─────────────────────────────────────────────────

interface ImageToolbarState {
  visible: boolean;
  top: number;
  left: number;
  targetFigure: HTMLElement | null;
  notifyChange: (() => void) | null;
}

function ImageContextualToolbar({
  state,
  onClose,
}: {
  state: ImageToolbarState;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.visible) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [state.visible, onClose]);

  if (!state.visible || !state.targetFigure) return null;

  const figure = state.targetFigure;
  const img = figure.querySelector('img') as HTMLImageElement | null;
  if (!img) return null;

  const applyAlignment = (alignment: 'left' | 'center' | 'right') => {
    figure.setAttribute('data-alignment', alignment);
    figure.style.textAlign = alignment;
    if (alignment === 'left') {
      figure.style.display = 'block';
      figure.style.marginLeft = '0';
      figure.style.marginRight = 'auto';
    } else if (alignment === 'center') {
      figure.style.display = 'block';
      figure.style.marginLeft = 'auto';
      figure.style.marginRight = 'auto';
    } else {
      figure.style.display = 'block';
      figure.style.marginLeft = 'auto';
      figure.style.marginRight = '0';
    }
    state.notifyChange?.();
    onClose();
  };

  const applySize = (pct: number) => {
    const container = figure.closest('[data-page-content]') as HTMLElement | null;
    const containerWidth = container ? container.offsetWidth : 600;
    const newWidth = Math.max(80, Math.min(containerWidth - 20, Math.round(containerWidth * pct / 100)));
    img.style.width = `${newWidth}px`;
    img.style.height = 'auto';
    img.setAttribute('width', String(newWidth));
    figure.setAttribute('data-width', String(newWidth));
    state.notifyChange?.();
    onClose();
  };

  const deleteImage = () => {
    figure.parentNode?.removeChild(figure);
    state.notifyChange?.();
    onClose();
  };

  const replaceImage = () => {
    const url = window.prompt('URL de la nueva imagen:', img.src);
    if (url && url.trim()) {
      img.src = url.trim();
      img.setAttribute('src', url.trim());
      state.notifyChange?.();
    }
    onClose();
  };

  const setAltText = () => {
    const alt = window.prompt('Texto alternativo (alt):', img.alt || '');
    if (alt !== null) {
      img.alt = alt;
      img.setAttribute('alt', alt);
      state.notifyChange?.();
    }
    onClose();
  };

  const BtnSm = ({ onClick, title, children, danger }: { onClick: () => void; title: string; children: React.ReactNode; danger?: boolean }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      title={title}
      className={`p-1 rounded text-xs flex items-center justify-center ${danger ? 'hover:bg-red-50 text-red-600' : 'hover:bg-gray-100 text-gray-700'}`}
    >
      {children}
    </button>
  );

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl flex items-center gap-0.5 px-1.5 py-1"
      style={{ top: state.top, left: state.left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="text-xs text-gray-400 mr-1 font-medium">Imagen</span>
      <div className="w-px h-5 bg-gray-200 mx-0.5" />

      {/* Alignment */}
      <BtnSm onClick={() => applyAlignment('left')} title="Alinear izquierda">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
      </BtnSm>
      <BtnSm onClick={() => applyAlignment('center')} title="Centrar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
      </BtnSm>
      <BtnSm onClick={() => applyAlignment('right')} title="Alinear derecha">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
      </BtnSm>

      <div className="w-px h-5 bg-gray-200 mx-0.5" />

      {/* Size presets */}
      <button type="button" onMouseDown={(e) => { e.preventDefault(); applySize(25); }} title="Pequeño (25%)" className="px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-700 text-xs font-medium">S</button>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); applySize(50); }} title="Mediano (50%)" className="px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-700 text-xs font-medium">M</button>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); applySize(75); }} title="Grande (75%)" className="px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-700 text-xs font-medium">L</button>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); applySize(100); }} title="Completo (100%)" className="px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-700 text-xs font-medium">XL</button>

      <div className="w-px h-5 bg-gray-200 mx-0.5" />

      {/* Alt text */}
      <BtnSm onClick={setAltText} title="Texto alternativo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </BtnSm>

      {/* Replace */}
      <BtnSm onClick={replaceImage} title="Reemplazar imagen">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
      </BtnSm>

      {/* Delete */}
      <BtnSm onClick={deleteImage} title="Eliminar imagen" danger>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </BtnSm>

      <div className="w-px h-5 bg-gray-200 mx-0.5" />

      {/* Close */}
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onClose(); }}
        title="Cerrar"
        className="p-1 rounded hover:bg-gray-100 text-gray-700 text-xs flex items-center justify-center"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}

// ─── Header/Footer Zone ───────────────────────────────────────────────────────

interface HeaderFooterZoneProps {
  type: 'header' | 'footer';
  onRemove: () => void;
  onPageNumbers: () => void;
  contentRef: React.RefObject<HTMLDivElement>;
  marginLeft?: number;
  marginRight?: number;
  zoneHeight?: number;
}

function HeaderFooterZone({
  type,
  onRemove,
  onPageNumbers,
  contentRef,
  marginLeft = 60,
  marginRight = 60,
  zoneHeight = 40,
}: HeaderFooterZoneProps) {
  const [isActive, setIsActive] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const label = type === 'header' ? 'Encabezado' : 'Pie de página';

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: MouseEvent) => {
      if (zoneRef.current && !zoneRef.current.contains(e.target as Node)) {
        setIsActive(false);
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isActive]);

  useEffect(() => {
    if (!showOptions) return;
    const handler = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOptions]);

  return (
    <div
      ref={zoneRef}
      style={{
        borderTop: type === 'footer' ? '1px dashed #93c5fd' : undefined,
        borderBottom: type === 'header' ? '1px dashed #93c5fd' : undefined,
        position: 'relative',
        backgroundColor: isActive ? '#eff6ff' : undefined,
        transition: 'background-color 0.15s',
        flexShrink: 0,
        minHeight: `${zoneHeight}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: type === 'header' ? 'flex-end' : 'flex-start',
      }}
      onClick={() => setIsActive(true)}
    >
      {/* Editable content area — horizontally aligned to document margins */}
      <div
        ref={contentRef}
        contentEditable
        suppressContentEditableWarning
        style={{
          minHeight: '28px',
          paddingLeft: `${marginLeft}px`,
          paddingRight: `${marginRight}px`,
          paddingTop: '4px',
          paddingBottom: '4px',
          outline: 'none',
          fontSize: '10pt',
          color: '#374151',
          fontFamily: 'Arial, sans-serif',
          boxSizing: 'border-box',
          width: '100%',
        }}
        onFocus={() => setIsActive(true)}
        onBlur={() => {
          setTimeout(() => {
            if (zoneRef.current && !zoneRef.current.contains(document.activeElement)) {
              setIsActive(false);
              setShowOptions(false);
            }
          }, 150);
        }}
        data-placeholder={`Haz clic para editar ${label.toLowerCase()}...`}
        {...(type === 'header' ? { 'data-header-editable': 'true' } : { 'data-footer-editable': 'true' })}
      />

      {/* Config bar — only visible when active */}
      {isActive && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '2px 8px',
            backgroundColor: '#f0f9ff',
            borderTop: type === 'footer' ? undefined : '1px solid #bae6fd',
            borderBottom: type === 'header' ? undefined : '1px solid #bae6fd',
            fontSize: '10px',
            color: '#0369a1',
            userSelect: 'none',
          }}
        >
          <span style={{ fontWeight: 600 }}>{label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} ref={optionsRef}>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowOptions((v) => !v); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 8px',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '10px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Opciones
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {showOptions && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: '2px',
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
                    zIndex: 9999,
                    minWidth: '180px',
                    padding: '4px 0',
                  }}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onPageNumbers(); setShowOptions(false); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px', fontSize: '12px', color: '#374151', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f9fafb')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '')}
                  >
                    Números de página
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); setShowOptions(false); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px', fontSize: '12px', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fef2f2')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '')}
                  >
                    Quitar {type === 'header' ? 'encabezado' : 'pie de página'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HeaderFooterZoneReadOnly — mirrors first-page header/footer on subsequent pages ──

function HeaderFooterZoneReadOnly({
  type,
  sourceRef,
  marginLeft = 60,
  marginRight = 60,
  pageIndex = 1,
  zoneHeight = 40,
}: {
  type: 'header' | 'footer';
  sourceRef: React.RefObject<HTMLDivElement>;
  marginLeft?: number;
  marginRight?: number;
  pageIndex?: number;
  zoneHeight?: number;
}) {
  const [html, setHtml] = useState('');

  useEffect(() => {
    const update = () => {
      if (sourceRef.current) {
        setHtml(sourceRef.current.innerHTML);
      }
    };
    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [sourceRef]);

  // For page index 0 (first page), hide elements marked as data-hide-first-page
  const getDisplayHtml = () => {
    if (pageIndex !== 0) return html;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
      const root = doc.body.firstChild as HTMLElement;
      if (root) {
        root.querySelectorAll('[data-hide-first-page="true"]').forEach((el) => {
          (el as HTMLElement).style.display = 'none';
        });
        return root.innerHTML;
      }
    } catch {
      // fallback
    }
    return html;
  };
  const displayHtml = getDisplayHtml();

  return (
    <div
      style={{
        borderTop: type === 'footer' ? '1px dashed #93c5fd' : undefined,
        borderBottom: type === 'header' ? '1px dashed #93c5fd' : undefined,
        minHeight: `${zoneHeight}px`,
        paddingLeft: `${marginLeft}px`,
        paddingRight: `${marginRight}px`,
        paddingTop: '4px',
        paddingBottom: '4px',
        fontSize: '10pt',
        color: '#374151',
        fontFamily: 'Arial, sans-serif',
        pointerEvents: 'none',
        userSelect: 'none',
        boxSizing: 'border-box',
        flexShrink: 0,
        display: 'flex',
        alignItems: type === 'header' ? 'flex-end' : 'flex-start',
      }}
      dangerouslySetInnerHTML={{ __html: displayHtml || '' }}
    />
  );
}

// ─── Read-only DocumentPaginator (preview) ────────────────────────────────────

interface DocumentPaginatorProps {
  html: string;
  paperSize: PaperSize;
  orientation: PageOrientation;
  onPageCountChange?: (count: number) => void;
}

export function DocumentPaginator({
  html,
  paperSize,
  orientation,
  onPageCountChange,
}: DocumentPaginatorProps) {
  const dims = getPageDimensions(paperSize, orientation);
  const contentHeight = getContentHeight(dims);
  const contentWidth = getContentWidth(dims);
  const [pages, setPages] = useState<string[]>([html]);
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!measureRef.current) return;
    const container = measureRef.current;
    container.innerHTML = html;
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length === 0) {
      setPages([html]);
      onPageCountChange?.(1);
      return;
    }
    const pageContents: string[] = [];
    let currentHtml = '';
    let currentHeight = 0;
    for (const child of children) {
      const h = child.offsetHeight;
      if (currentHeight + h > contentHeight && currentHeight > 0) {
        pageContents.push(currentHtml);
        currentHtml = child.outerHTML;
        currentHeight = h;
      } else {
        currentHtml += child.outerHTML;
        currentHeight += h;
      }
    }
    if (currentHtml) pageContents.push(currentHtml);
    const result = pageContents.length > 0 ? pageContents : [html];
    setPages(result);
    onPageCountChange?.(result.length);
  }, [html, contentHeight, contentWidth, onPageCountChange]);

  return (
    <>
      <div
        ref={measureRef}
        style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          width: `${contentWidth}px`,
          visibility: 'hidden',
          pointerEvents: 'none',
          fontFamily: 'Arial, sans-serif',
          fontSize: '12pt',
          lineHeight: '1.6',
          wordBreak: 'break-word',
        }}
      />
      <div className="document-preview" style={documentPreviewStyle}>
        {pages.map((pageHtml, idx) => (
          <div key={idx} className="page" data-page={idx + 1} style={pageStyle(dims)}>
            <div className="page-header" style={pageHeaderStyle}>
              Página {idx + 1}
            </div>
            <div className="page-content" style={pageContentStyle()}>
              <div
                style={{
                  fontFamily: 'Arial, sans-serif',
                  fontSize: '12pt',
                  lineHeight: '1.6',
                  wordBreak: 'break-word',
                }}
                dangerouslySetInnerHTML={{ __html: pageHtml }}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── MultiPageEditor ──────────────────────────────────────────────────────────

interface PageData {
  id: string;
  content: string;
}

let pageIdCounter = 0;
function newPageId(): string {
  pageIdCounter += 1;
  return `page-${pageIdCounter}-${Date.now()}`;
}

export interface MultiPageEditorHandle {
  getHTML: () => string;
  setHTML: (html: string) => void;
  insertPageNumber: (opts: { position: 'header' | 'footer'; showOnFirst: boolean; startFrom: number }) => void;
}

interface MultiPageEditorProps {
  paperSize: PaperSize;
  orientation: PageOrientation;
  initialHtml?: string;
  onChange?: (html: string) => void;
  editorStyle?: React.CSSProperties;
  onPageCountChange?: (count: number) => void;
  margins?: PageMargins;
  showRulers?: boolean;
  showHeader?: boolean;
  showFooter?: boolean;
  firstPageDifferent?: boolean;
  onFirstPageDifferentChange?: (v: boolean) => void;
  onRemoveHeader?: () => void;
  onRemoveFooter?: () => void;
  onPageNumbers?: () => void;
  onImageSelected?: (data: { figure: HTMLElement; originalWidth: number; originalHeight: number; currentWidth: number }) => void;
}

export const MultiPageEditor = forwardRef<
  MultiPageEditorHandle,
  MultiPageEditorProps
>(function MultiPageEditor(
  {
    paperSize,
    orientation,
    initialHtml = '<p><br></p>',
    onChange,
    editorStyle,
    onPageCountChange,
    margins,
    showRulers = false,
    showHeader = false,
    showFooter = false,
    firstPageDifferent = false,
    onFirstPageDifferentChange,
    onRemoveHeader,
    onRemoveFooter,
    onPageNumbers,
    onImageSelected,
  },
  ref
) {
  const dims = getPageDimensions(paperSize, orientation);
  const contentHeight = getContentHeight(dims, margins);

  // ── State: array of pages ─────────────────────────────────────────────────
  const [pages, setPages] = useState<PageData[]>(() => [
    { id: newPageId(), content: initialHtml },
  ]);

  // ── Contextual toolbars ───────────────────────────────────────────────────
  const [tableToolbar, setTableToolbar] = useState<TableToolbarState>({
    visible: false, top: 0, left: 0, targetCell: null, targetTable: null,
  });
  const [imageToolbar, setImageToolbar] = useState<ImageToolbarState>({
    visible: false, top: 0, left: 0, targetFigure: null, notifyChange: null,
  });

  // ── Header/Footer refs ────────────────────────────────────────────────────
  const headerContentRef = useRef<HTMLDivElement>(null);
  const footerContentRef = useRef<HTMLDivElement>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const pageContentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pageIdsRef = useRef<string[]>([pages[0].id]);
  const isPaginatingRef = useRef(false);
  const focusedPageIdRef = useRef<string | null>(null);
  const pendingFocusRef = useRef<{ pageId: string; atEnd: boolean } | null>(null);
  // Track currently selected image figure
  const selectedFigureRef = useRef<HTMLElement | null>(null);

  // ── Expose getHTML / setHTML ──────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    getHTML: () => {
      let html = '';
      // Include header
      if (showHeader && headerContentRef.current) {
        html += `<div data-header-zone="true" style="border-bottom:1px solid #e5e7eb;padding:6px 0 8px;margin-bottom:12px;font-size:11px;">${headerContentRef.current.innerHTML}</div>`;
      }
      html += pageIdsRef.current
        .map((id) => {
          const el = pageContentRefs.current.get(id);
          if (!el) return '';
          // Serialize figures back to clean img tags for storage
          const clone = el.cloneNode(true) as HTMLElement;
          serializeFiguresToImgs(clone);
          return clone.innerHTML;
        })
        .join('');
      // Include footer
      if (showFooter && footerContentRef.current) {
        html += `<div data-footer-zone="true" style="border-top:1px solid #e5e7eb;padding:8px 0 6px;margin-top:12px;font-size:11px;">${footerContentRef.current.innerHTML}</div>`;
      }
      return html;
    },
    setHTML: (html: string) => {
      const id = newPageId();
      pageIdsRef.current = [id];
      setPages([{ id, content: html }]);
    },
    insertPageNumber: (opts: { position: 'header' | 'footer'; showOnFirst: boolean; startFrom: number }) => {
      const targetRef = opts.position === 'header' ? headerContentRef : footerContentRef;
      if (!targetRef.current) return;
      // Remove any existing page number in the zone
      targetRef.current.querySelectorAll('[data-page-number]').forEach((n) => n.remove());
      // Insert page number placeholder — actual number shown per-page via CSS counter or static "1"
      const hideAttr = opts.showOnFirst ? '' : ' data-hide-first-page="true"';
      const numHtml = `<span data-page-number="true"${hideAttr} style="display:inline-block;color:#6B7280;font-size:0.85em;font-family:Arial,sans-serif;">— ${opts.startFrom} —</span>`;
      const wrapper = `<div style="text-align:center;">${numHtml}</div>`;
      targetRef.current.insertAdjacentHTML('beforeend', wrapper);
    },
  }));

  // ── Serialize figures back to plain <img> for storage ────────────────────
  const serializeFiguresToImgs = useCallback((container: HTMLElement) => {
    container.querySelectorAll('figure[data-docubox-image]').forEach((fig) => {
      const figEl = fig as HTMLElement;
      const img = figEl.querySelector('img');
      if (!img) {
        figEl.parentNode?.removeChild(figEl);
        return;
      }
      const newImg = document.createElement('img');
      newImg.src = img.src;
      newImg.alt = img.alt || '';
      const w = img.style.width || img.getAttribute('width') || figEl.getAttribute('data-width') || '';
      if (w) {
        newImg.setAttribute('width', w.replace('px', ''));
        newImg.style.width = w.includes('px') ? w : `${w}px`;
      }
      newImg.style.height = 'auto';
      newImg.style.maxWidth = '100%';
      let alignment = figEl.getAttribute('data-alignment') || 'center';
      newImg.setAttribute('data-alignment', alignment);
      if (alignment === 'center') {
        newImg.style.display = 'block';
        newImg.style.marginLeft = 'auto';
        newImg.style.marginRight = 'auto';
      } else if (alignment === 'right') {
        newImg.style.display = 'block';
        newImg.style.marginLeft = 'auto';
        newImg.style.marginRight = '0';
      } else {
        newImg.style.display = 'block';
        newImg.style.marginLeft = '0';
        newImg.style.marginRight = 'auto';
      }
      figEl.parentNode?.replaceChild(newImg, figEl);
    });
  }, []);

  // ── Notify parent ─────────────────────────────────────────────────────────
  const notifyChange = useCallback(() => {
    if (!onChange) return;
    let html = '';
    if (showHeader && headerContentRef.current) {
      html += `<div data-header-zone="true">${headerContentRef.current.innerHTML}</div>`;
    }
    html += pageIdsRef.current
      .map((id) => {
        const el = pageContentRefs.current.get(id);
        if (!el) return '';
        const clone = el.cloneNode(true) as HTMLElement;
        serializeFiguresToImgs(clone);
        return clone.innerHTML;
      })
      .join('');
    if (showFooter && footerContentRef.current) {
      html += `<div data-footer-zone="true">${footerContentRef.current.innerHTML}</div>`;
    }
    onChange(html);
  }, [onChange, showHeader, showFooter, serializeFiguresToImgs]);

  // ── Notify page count ─────────────────────────────────────────────────────
  useEffect(() => {
    onPageCountChange?.(pages.length);
  }, [pages.length, onPageCountChange]);

  // ── Deselect all image figures ────────────────────────────────────────────
  const deselectAllImages = useCallback(() => {
    document.querySelectorAll('figure[data-docubox-image][data-selected="true"]').forEach((fig) => {
      const figEl = fig as HTMLElement;
      figEl.setAttribute('data-selected', 'false');
      figEl.style.outline = '';
      figEl.querySelectorAll('.docubox-resize-handle').forEach((h) => {
        (h as HTMLElement).style.display = 'none';
      });
    });
    selectedFigureRef.current = null;
  }, []);

  // ── Select an image figure ────────────────────────────────────────────────
  const selectFigure = useCallback((figEl: HTMLElement) => {
    deselectAllImages();
    figEl.setAttribute('data-selected', 'true');
    figEl.style.outline = '2px solid #2563eb';
    figEl.style.outlineOffset = '2px';
    figEl.querySelectorAll('.docubox-resize-handle').forEach((h) => {
      (h as HTMLElement).style.display = 'block';
    });
    selectedFigureRef.current = figEl;
  }, [deselectAllImages]);

  // ── Make images resizable (wraps <img> in <figure data-docubox-image>) ───
  const makeImagesResizable = useCallback((container: HTMLElement) => {
    // 1. Convert any plain <img> (not already in a figure) into figure wrappers
    const imgs = Array.from(container.querySelectorAll('img:not([data-in-figure])'));
    imgs.forEach((img) => {
      const imgEl = img as HTMLImageElement;
      // Skip if already inside a figure
      if (imgEl.closest('figure[data-docubox-image]')) return;

      // Read existing alignment from data-alignment attribute or inline style
      let alignment: 'left' | 'center' | 'right' = 'center';
      const dataAlign = imgEl.getAttribute('data-alignment') as 'left' | 'center' | 'right' | null;
      if (dataAlign && ['left', 'center', 'right'].includes(dataAlign)) {
        alignment = dataAlign;
      }

      // Read existing width
      const existingWidth = imgEl.getAttribute('width') || imgEl.style.width || '';
      const widthPx = existingWidth ? parseInt(existingWidth, 10) : 300;

      // Create figure wrapper
      const figure = document.createElement('figure');
      figure.setAttribute('data-docubox-image', 'true');
      figure.setAttribute('data-selected', 'false');
      figure.setAttribute('data-alignment', alignment);
      figure.setAttribute('data-width', String(widthPx));
      figure.setAttribute('contenteditable', 'false');
      figure.style.cssText = `
        display: block;
        position: relative;
        margin: 8px 0;
        line-height: 0;
        max-width: 100%;
        cursor: default;
        ${alignment === 'center' ? 'margin-left:auto;margin-right:auto;' : ''}
        ${alignment === 'right' ? 'margin-left:auto;margin-right:0;' : ''}
        ${alignment === 'left' ? 'margin-left:0;margin-right:auto;' : ''}
      `;

      // Style the image
      imgEl.style.width = `${widthPx}px`;
      imgEl.style.height = 'auto';
      imgEl.style.maxWidth = '100%';
      imgEl.style.display = 'block';
      imgEl.style.userSelect = 'none';
      imgEl.draggable = false;
      imgEl.setAttribute('data-in-figure', 'true');

      // Insert figure before img, move img into figure
      imgEl.parentNode?.insertBefore(figure, imgEl);
      figure.appendChild(imgEl);

      // Create 4 corner resize handles
      const corners: Array<{ pos: string; style: string; cursor: string }> = [
        { pos: 'nw', style: 'top:-5px;left:-5px;', cursor: 'nwse-resize' },
        { pos: 'ne', style: 'top:-5px;right:-5px;', cursor: 'nesw-resize' },
        { pos: 'sw', style: 'bottom:-5px;left:-5px;', cursor: 'nesw-resize' },
        { pos: 'se', style: 'bottom:-5px;right:-5px;', cursor: 'nwse-resize' },
      ];

      corners.forEach(({ pos, style, cursor }) => {
        const handle = document.createElement('span');
        handle.className = 'docubox-resize-handle';
        handle.setAttribute('data-handle-pos', pos);
        handle.style.cssText = `
          display: none;
          position: absolute;
          ${style}
          width: 10px;
          height: 10px;
          background: #2563eb;
          border: 2px solid white;
          border-radius: 50%;
          z-index: 20;
          cursor: ${cursor};
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        `;
        figure.appendChild(handle);

        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const startX = e.clientX;
          const startY = e.clientY;
          const startW = imgEl.offsetWidth || widthPx;
          const startH = imgEl.offsetHeight || Math.round(widthPx * 0.75);
          const aspectRatio = startH > 0 && startW > 0 ? startH / startW : 0.75;

          // Get max width from container
          const pageContent = container.closest('[data-page-content]') as HTMLElement | null;
          const maxWidth = pageContent ? pageContent.offsetWidth - 20 : 620;

          // Disable contentEditable during drag to prevent selection interference
          const allEditors = document.querySelectorAll('[data-page-content]');
          allEditors.forEach((ed) => { (ed as HTMLElement).contentEditable = 'false'; });

          const onMove = (me: MouseEvent) => {
            me.preventDefault();
            let dx = me.clientX - startX;
            // Invert for left-side handles
            if (pos === 'nw' || pos === 'sw') dx = -dx;
            const newW = Math.max(80, Math.min(maxWidth, startW + dx));
            const newH = Math.round(newW * aspectRatio);
            imgEl.style.width = `${newW}px`;
            imgEl.style.height = `${newH}px`;
            figure.setAttribute('data-width', String(newW));
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            // Re-enable contentEditable
            allEditors.forEach((ed) => { (ed as HTMLElement).contentEditable = 'true'; });
            // Persist width attribute
            imgEl.setAttribute('width', String(imgEl.offsetWidth));
            // Notify change
            notifyChange();
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      });

      // Click on figure to select
      figure.addEventListener('mousedown', (e) => {
        // Don't intercept handle clicks
        if ((e.target as HTMLElement).classList.contains('docubox-resize-handle')) return;
        e.stopPropagation();
        selectFigure(figure);

        // Show image toolbar
        const rect = figure.getBoundingClientRect();
        setImageToolbar({
          visible: true,
          top: Math.max(8, rect.top - 44),
          left: rect.left,
          targetFigure: figure,
          notifyChange,
        });
        setTableToolbar((t) => ({ ...t, visible: false }));

        // Notify parent for image size modal
        if (onImageSelected) {
          const img = figure.querySelector('img') as HTMLImageElement | null;
          if (img) {
            const naturalW = img.naturalWidth || parseInt(img.getAttribute('width') || '300', 10);
            const naturalH = img.naturalHeight || Math.round(naturalW * 0.75);
            const currentW = img.offsetWidth || parseInt(img.style.width || img.getAttribute('width') || '300', 10);
            onImageSelected({ figure, originalWidth: naturalW, originalHeight: naturalH, currentWidth: currentW });
          }
        }
      });
    });
  }, [notifyChange, selectFigure]);

  // ── Core pagination ───────────────────────────────────────────────────────
  const runPagination = useCallback(() => {
    if (isPaginatingRef.current) return;
    isPaginatingRef.current = true;

    const sel = window.getSelection();
    let savedAnchorNode: Node | null = null;
    let savedAnchorOffset = 0;
    let savedFocusPageId = focusedPageIdRef.current;

    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      savedAnchorNode = range.startContainer;
      savedAnchorOffset = range.startOffset;
    }

    const allNodes: Node[] = [];
    for (const id of pageIdsRef.current) {
      const el = pageContentRefs.current.get(id);
      if (!el) continue;
      Array.from(el.childNodes).forEach((node) => {
        allNodes.push(node.cloneNode(true));
      });
    }

    if (allNodes.length === 0) {
      isPaginatingRef.current = false;
      return;
    }

    const ml = margins ? cmToPx(margins.left) : DEFAULT_MARGIN_LEFT;
    const mr = margins ? cmToPx(margins.right) : DEFAULT_MARGIN_RIGHT;

    const measureDiv = document.createElement('div');
    measureDiv.style.cssText = `
      position: fixed;
      top: -9999px;
      left: -9999px;
      width: ${dims.width - ml - mr}px;
      visibility: hidden;
      pointer-events: none;
      font-family: Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.6;
      word-break: break-word;
      overflow-wrap: break-word;
      box-sizing: border-box;
    `;
    document.body.appendChild(measureDiv);

    const pageGroups: Node[][] = [];
    let currentGroup: Node[] = [];

    for (const node of allNodes) {
      measureDiv.innerHTML = '';
      currentGroup.forEach((n) => measureDiv.appendChild(n.cloneNode(true)));
      measureDiv.appendChild(node.cloneNode(true));
      const totalHeight = measureDiv.scrollHeight;

      if (totalHeight > contentHeight && currentGroup.length > 0) {
        pageGroups.push(currentGroup);
        currentGroup = [node.cloneNode(true)];
        measureDiv.innerHTML = '';
        measureDiv.appendChild(node.cloneNode(true));
      } else {
        currentGroup.push(node.cloneNode(true));
      }
    }
    if (currentGroup.length > 0) {
      pageGroups.push(currentGroup);
    }

    document.body.removeChild(measureDiv);

    if (pageGroups.length === 0) {
      pageGroups.push([]);
    }

    const existingIds = [...pageIdsRef.current];
    const newIds: string[] = [];
    for (let i = 0; i < pageGroups.length; i++) {
      newIds.push(existingIds[i] ?? newPageId());
    }

    const newPagesState: PageData[] = newIds.map((id, i) => {
      const tempDiv = document.createElement('div');
      pageGroups[i].forEach((n) => tempDiv.appendChild(n.cloneNode(true)));
      let html = tempDiv.innerHTML || '<p><br></p>';

      const el = pageContentRefs.current.get(id);
      if (el) {
        el.innerHTML = html;
        makeImagesResizable(el);
      }

      return { id, content: html };
    });

    pageIdsRef.current = newIds;

    const newIdSet = new Set(newIds);
    for (const [id] of pageContentRefs.current) {
      if (!newIdSet.has(id)) {
        pageContentRefs.current.delete(id);
      }
    }

    setPages(newPagesState);

    requestAnimationFrame(() => {
      isPaginatingRef.current = false;

      if (pendingFocusRef.current) {
        const { pageId, atEnd } = pendingFocusRef.current;
        pendingFocusRef.current = null;
        const targetEl = pageContentRefs.current.get(pageId);
        if (targetEl) {
          targetEl.focus();
          const range = document.createRange();
          if (atEnd) {
            range.selectNodeContents(targetEl);
            range.collapse(false);
          } else {
            range.setStart(targetEl, 0);
            range.collapse(true);
          }
          const newSel = window.getSelection();
          if (newSel) {
            newSel.removeAllRanges();
            newSel.addRange(range);
          }
        }
        return;
      }

      if (savedAnchorNode && savedFocusPageId) {
        const focusEl = pageContentRefs.current.get(savedFocusPageId);
        if (focusEl && focusEl.contains(savedAnchorNode)) {
          try {
            const range = document.createRange();
            range.setStart(savedAnchorNode, savedAnchorOffset);
            range.collapse(true);
            const newSel = window.getSelection();
            if (newSel) {
              newSel.removeAllRanges();
              newSel.addRange(range);
            }
          } catch {
            if (focusEl) {
              focusEl.focus();
              const range = document.createRange();
              range.selectNodeContents(focusEl);
              range.collapse(false);
              const newSel = window.getSelection();
              if (newSel) {
                newSel.removeAllRanges();
                newSel.addRange(range);
              }
            }
          }
        }
      }

      notifyChange();
    });
  }, [dims, contentHeight, margins, notifyChange, makeImagesResizable]);

  // ── Re-paginate when paper size / orientation / margins change ────────────
  useEffect(() => {
    requestAnimationFrame(() => {
      runPagination();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperSize, orientation, margins]);

  // ── Input handler ─────────────────────────────────────────────────────────
  const handleInput = useCallback(
    (pageId: string, pageIndex: number) => {
      const el = pageContentRefs.current.get(pageId);
      if (!el) return;

      const hasOverflow = el.scrollHeight > el.clientHeight;
      const isLastPage = pageIndex === pageIdsRef.current.length - 1;

      if (!hasOverflow && isLastPage) {
        notifyChange();
        return;
      }

      if (hasOverflow) {
        const nextPageId = pageIdsRef.current[pageIndex + 1];
        if (nextPageId) {
          pendingFocusRef.current = { pageId: nextPageId, atEnd: false };
        } else {
          pendingFocusRef.current = null;
        }
      }

      requestAnimationFrame(() => {
        runPagination();
      });
    },
    [runPagination, notifyChange]
  );

  // ── KeyDown handler ───────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, pageId: string, pageIndex: number) => {
      // NEVER block clipboard shortcuts or common editing shortcuts
      const isModifier = e.ctrlKey || e.metaKey;
      if (isModifier) {
        const key = e.key.toLowerCase();
        if (['c', 'x', 'v', 'a', 'z', 'y', 'b', 'i', 'u'].includes(key)) {
          return;
        }
      }

      // Delete or Backspace: if an image is selected, delete it
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFigureRef.current) {
          e.preventDefault();
          const fig = selectedFigureRef.current;
          fig.parentNode?.removeChild(fig);
          selectedFigureRef.current = null;
          setImageToolbar((t) => ({ ...t, visible: false }));
          requestAnimationFrame(() => {
            runPagination();
            notifyChange();
          });
          return;
        }
        requestAnimationFrame(() => {
          runPagination();
        });
      }

      if (e.key === 'Enter') {
        requestAnimationFrame(() => {
          const el = pageContentRefs.current.get(pageId);
          if (el && el.scrollHeight > el.clientHeight) {
            runPagination();
          } else {
            notifyChange();
          }
        });
      }

      // Escape: deselect image
      if (e.key === 'Escape') {
        deselectAllImages();
        setImageToolbar((t) => ({ ...t, visible: false }));
      }
    },
    [runPagination, notifyChange, deselectAllImages]
  );

  // ── Paste handler — preserve table formatting from Word ───────────────────
  const sanitizePastedHtml = useCallback((html: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    doc.querySelectorAll('script, iframe, object, embed, meta, link, noscript').forEach((el) => el.remove());

    doc.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
        if (name === 'href' && attr.value.toLowerCase().includes('javascript:')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    doc.querySelectorAll('o\\:p, w\\:*, m\\:*').forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
    });

    doc.querySelectorAll('[class]').forEach((el) => {
      const cls = el.getAttribute('class') || '';
      if (cls.includes('mso') || cls.includes('Mso')) {
        el.removeAttribute('class');
      }
    });

    doc.querySelectorAll('table').forEach((table) => {
      const existingStyle = table.getAttribute('style') || '';
      if (!existingStyle.includes('border-collapse')) {
        table.style.borderCollapse = 'collapse';
      }
      if (!existingStyle.includes('width')) {
        table.style.width = '100%';
      }
      table.style.margin = '8px 0';

      table.querySelectorAll('td, th').forEach((cell) => {
        const el = cell as HTMLElement;
        const computedBg = el.style.backgroundColor || el.getAttribute('bgcolor') || '';
        const computedColor = el.style.color || '';
        const computedBorder = el.style.border || el.style.borderTop || '';
        const computedFontWeight = el.style.fontWeight || '';
        const computedTextAlign = el.style.textAlign || '';
        const computedPadding = el.style.padding || '6px 8px';
        const computedWidth = el.style.width || '';

        let preservedStyle = `padding:${computedPadding};min-width:40px;`;
        if (computedBg) preservedStyle += `background-color:${computedBg};`;
        if (computedColor) preservedStyle += `color:${computedColor};`;
        if (computedBorder) {
          preservedStyle += `border:${computedBorder};`;
        } else {
          preservedStyle += 'border:1px solid #ccc;';
        }
        if (computedFontWeight) preservedStyle += `font-weight:${computedFontWeight};`;
        if (computedTextAlign) preservedStyle += `text-align:${computedTextAlign};`;
        if (computedWidth) preservedStyle += `width:${computedWidth};`;

        el.setAttribute('style', preservedStyle);
      });
    });

    doc.querySelectorAll('[style]').forEach((el) => {
      if (el.tagName === 'TD' || el.tagName === 'TH' || el.tagName === 'TABLE' || el.tagName === 'TR') return;
      const style = el.getAttribute('style') || '';
      const cleaned = style
        .split(';')
        .filter((s) => !s.trim().startsWith('mso-') && s.trim())
        .join(';');
      if (cleaned) {
        el.setAttribute('style', cleaned);
      } else {
        el.removeAttribute('style');
      }
    });

    return doc.body.innerHTML;
  }, []);

  // ── Paste helpers ─────────────────────────────────────────────────────────

  const escapeHtml = useCallback((value: string): string => {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }, []);

  const insertPlainTextInlineAtRange = useCallback((range: Range, text: string) => {
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  const insertMultilineTextAtRange = useCallback((range: Range, text: string) => {
    const fragment = document.createDocumentFragment();
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    lines.forEach((line, index) => {
      if (index > 0) {
        fragment.appendChild(document.createElement('br'));
      }
      fragment.appendChild(document.createTextNode(line));
    });
    const lastNode = fragment.lastChild;
    range.insertNode(fragment);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.setEndAfter(lastNode);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, []);

  const insertHtmlAtRange = useCallback((range: Range, html: string) => {
    const fragment = range.createContextualFragment(html);
    const lastNode = fragment.lastChild;
    range.insertNode(fragment);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.setEndAfter(lastNode);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, []);

  const normalizePastedHtmlForCurrentLine = useCallback((html: string, plainText: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    doc.querySelectorAll('script, iframe, object, embed, meta, link, style').forEach((el) => {
      el.remove();
    });

    // Remove event handlers and javascript: hrefs
    doc.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value.toLowerCase();
        if (name.startsWith('on') || value.includes('javascript:')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    const hasTable = !!doc.querySelector('table');
    if (hasTable) {
      return doc.body.innerHTML;
    }

    const cleanText = plainText.trim();
    const isSingleLine = cleanText && !cleanText.includes('\n');

    if (isSingleLine) {
      const bodyText = doc.body.textContent?.trim() || '';
      if (bodyText === cleanText) {
        // Single-line text with no meaningful HTML formatting — return as escaped text
        return escapeHtml(cleanText);
      }
    }

    return doc.body.innerHTML;
  }, [escapeHtml]);

  // ── Direct onPaste handler for each page div ─────────────────────────────
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>, pageId: string, _pageIndex: number) => {
      e.preventDefault();
      e.stopPropagation();

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      let html = clipboardData.getData('text/html');
      const text = clipboardData.getData('text/plain');

      if (!html && !text) return;

      focusedPageIdRef.current = pageId;

      const editorEl = e.currentTarget;
      editorEl.focus();

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);

      // Ensure selection is inside this editor; if not, move cursor to end
      if (!editorEl.contains(range.commonAncestorContainer)) {
        const endRange = document.createRange();
        endRange.selectNodeContents(editorEl);
        endRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(endRange);
        const freshRange = sel.getRangeAt(0);
        range.setStart(freshRange.startContainer, freshRange.startOffset);
        range.setEnd(freshRange.endContainer, freshRange.endOffset);
      }

      range.deleteContents();

      const hasTable = html && /<table[\s\S]*?>/i.test(html);
      const hasMultipleLines = text.includes('\n');

      if (hasTable) {
        // Paste table HTML directly (sanitized)
        insertHtmlAtRange(range, sanitizePastedHtml(html));
      } else if (html) {
        // Normalize HTML: if it's a single-line copy, don't wrap in <p>/<div>
        const inlineHtml = normalizePastedHtmlForCurrentLine(html, text);
        insertHtmlAtRange(range, inlineHtml);
      } else if (text) {
        if (hasMultipleLines) {
          insertMultilineTextAtRange(range, text);
        } else {
          insertPlainTextInlineAtRange(range, text);
        }
      }

      // After insertion, re-initialize images and re-paginate
      requestAnimationFrame(() => {
        makeImagesResizable(editorEl);
        runPagination();
        notifyChange();
      });
    },
    [
      sanitizePastedHtml,
      normalizePastedHtmlForCurrentLine,
      insertHtmlAtRange,
      insertMultilineTextAtRange,
      insertPlainTextInlineAtRange,
      runPagination,
      notifyChange,
      makeImagesResizable,
    ]
  );

  // ── Click handler for contextual toolbars ─────────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // If clicking inside a figure, it's handled by the figure's own mousedown
    if (target.closest('figure[data-docubox-image]')) {
      return;
    }

    // Table cell click
    const cell = target.closest('td, th') as HTMLTableCellElement | null;
    if (cell) {
      const table = cell.closest('table') as HTMLTableElement | null;
      if (table) {
        const rect = cell.getBoundingClientRect();
        setTableToolbar({
          visible: true,
          top: rect.top - 44,
          left: rect.left,
          targetCell: cell,
          targetTable: table,
        });
        setImageToolbar((t) => ({ ...t, visible: false }));
        return;
      }
    }

    // Clicked on empty area — deselect images
    deselectAllImages();
    setImageToolbar((t) => ({ ...t, visible: false }));
    setTableToolbar((t) => ({ ...t, visible: false }));
  }, [deselectAllImages]);

  // ── Compute margin px values ──────────────────────────────────────────────
  const mt = margins ? cmToPx(margins.top) : DEFAULT_MARGIN_TOP;
  const mb = margins ? cmToPx(margins.bottom) : DEFAULT_MARGIN_BOTTOM;
  const ml = margins ? cmToPx(margins.left) : DEFAULT_MARGIN_LEFT;
  const mr = margins ? cmToPx(margins.right) : DEFAULT_MARGIN_RIGHT;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Contextual toolbars */}
      <TableContextualToolbar
        state={tableToolbar}
        onClose={() => setTableToolbar((t) => ({ ...t, visible: false }))}
      />
      <ImageContextualToolbar
        state={imageToolbar}
        onClose={() => setImageToolbar((t) => ({ ...t, visible: false }))}
      />

      <div className="document-preview" style={documentPreviewStyle}>
        {pages.map((page, index) => (
          <div key={page.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {/* Horizontal ruler (only for first page, shown above) */}
            {showRulers && index === 0 && (
              <div style={{ display: 'flex', marginLeft: '20px' }}>
                <HorizontalRuler width={dims.width} marginLeft={ml} marginRight={mr} />
              </div>
            )}

            <div style={{ display: 'flex' }}>
              {/* Vertical ruler */}
              {showRulers && (
                <VerticalRuler height={dims.height} marginTop={mt} marginBottom={mb} />
              )}

              {/* Page */}
              <div
                className="page"
                data-page={index + 1}
                style={pageStyle(dims)}
              >
                {/* Fixed-height page header (hidden UI chrome, not document header) */}
                <div className="page-header" style={pageHeaderStyle}>
                  Página {index + 1}
                </div>

                {/* Page content area — full height flex column */}
                <div
                  className="page-content"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    overflow: 'hidden',
                    padding: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Header zone — occupies top margin area, aligned to left/right margins */}
                  {showHeader ? (
                    index === 0 ? (
                      <HeaderFooterZone
                        type="header"
                        onRemove={onRemoveHeader || (() => {})}
                        onPageNumbers={onPageNumbers || (() => {})}
                        contentRef={headerContentRef}
                        marginLeft={ml}
                        marginRight={mr}
                        zoneHeight={mt}
                      />
                    ) : (
                      <HeaderFooterZoneReadOnly
                        type="header"
                        sourceRef={headerContentRef}
                        marginLeft={ml}
                        marginRight={mr}
                        pageIndex={index}
                        zoneHeight={mt}
                      />
                    )
                  ) : (
                    /* No header: top spacer to preserve top margin */
                    <div style={{ height: `${mt}px`, flexShrink: 0 }} />
                  )}

                  {/* Main editable content — only left/right padding; top/bottom handled by header/footer zones */}
                  <div
                    ref={(el) => {
                      if (el) {
                        pageContentRefs.current.set(page.id, el);
                        if (!pageIdsRef.current.includes(page.id)) {
                          pageIdsRef.current = pages.map((p) => p.id);
                        }
                        if (el.innerHTML === '' && page.content) {
                          el.innerHTML = page.content;
                          makeImagesResizable(el);
                        }
                      } else {
                        pageContentRefs.current.delete(page.id);
                      }
                    }}
                    contentEditable
                    suppressContentEditableWarning
                    tabIndex={0}
                    onFocus={() => { focusedPageIdRef.current = page.id; }}
                    onInput={() => handleInput(page.id, index)}
                    onKeyDown={(e) => handleKeyDown(e, page.id, index)}
                    onPaste={(e) => handlePaste(e, page.id, index)}
                    onClick={handleClick}
                    style={{
                      outline: 'none',
                      flex: 1,
                      overflow: 'hidden',
                      fontFamily: 'Arial, sans-serif',
                      fontSize: '11pt',
                      lineHeight: '1.6',
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word',
                      color: '#111827',
                      paddingLeft: `${ml}px`,
                      paddingRight: `${mr}px`,
                      paddingTop: 0,
                      paddingBottom: 0,
                      boxSizing: 'border-box',
                      cursor: 'text',
                      userSelect: 'text',
                      WebkitUserSelect: 'text',
                      ...editorStyle,
                    }}
                    data-page-id={page.id}
                    data-page-content="true"
                  />

                  {/* Footer zone — occupies bottom margin area, aligned to left/right margins */}
                  {showFooter ? (
                    index === 0 ? (
                      <HeaderFooterZone
                        type="footer"
                        onRemove={onRemoveFooter || (() => {})}
                        onPageNumbers={onPageNumbers || (() => {})}
                        contentRef={footerContentRef}
                        marginLeft={ml}
                        marginRight={mr}
                        zoneHeight={mb}
                      />
                    ) : (
                      <HeaderFooterZoneReadOnly
                        type="footer"
                        sourceRef={footerContentRef}
                        marginLeft={ml}
                        marginRight={mr}
                        pageIndex={index}
                        zoneHeight={mb}
                      />
                    )
                  ) : (
                    /* No footer: bottom spacer to preserve bottom margin */
                    <div style={{ height: `${mb}px`, flexShrink: 0 }} />
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        [contenteditable][data-placeholder]:empty:before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
        /* Hide page-number elements on page 1 (editable zone) when showOnFirst=false */
        [data-header-editable] [data-hide-first-page="true"],
        [data-footer-editable] [data-hide-first-page="true"] {
          display: none !important;
        }
        table { border-collapse: collapse; }
        td, th { min-width: 40px; }
        [data-page-content] {
          user-select: text;
          -webkit-user-select: text;
          cursor: text;
          overflow-wrap: break-word;
          word-wrap: break-word;
        }
        [data-page-content] * {
          user-select: text;
          -webkit-user-select: text;
        }
        [data-page-content] h1 {
          font-size: 28px;
          font-weight: 700;
          line-height: 1.25;
          margin: 16px 0 8px;
          display: block;
        }
        [data-page-content] h2 {
          font-size: 22px;
          font-weight: 600;
          line-height: 1.3;
          margin: 14px 0 8px;
          display: block;
        }
        [data-page-content] h3 {
          font-size: 18px;
          font-weight: 600;
          line-height: 1.35;
          margin: 12px 0 6px;
          display: block;
        }
        [data-page-content] h4 {
          font-size: 16px;
          font-weight: 600;
          line-height: 1.4;
          margin: 10px 0 6px;
          display: block;
        }
        [data-page-content] h5 {
          font-size: 14px;
          font-weight: 600;
          line-height: 1.4;
          margin: 8px 0 4px;
          display: block;
        }
        [data-page-content] p {
          font-size: 12px;
          line-height: 1.5;
          margin: 0 0 8px;
          display: block;
        }
        [data-page-content] ul {
          list-style-type: disc;
          padding-left: 2em;
          margin: 8px 0;
          display: block;
        }
        [data-page-content] ol {
          list-style-type: decimal;
          padding-left: 2em;
          margin: 8px 0;
          display: block;
        }
        [data-page-content] li {
          display: list-item;
          margin: 2px 0;
        }
        [data-page-content] figure[data-docubox-image],
        [data-page-content] figure[data-docubox-image] * {
          user-select: none;
          -webkit-user-select: none;
        }
        [data-page-content] table {
          border-collapse: collapse;
          width: 100%;
          margin: 8px 0;
        }
        [data-page-content] td,
        [data-page-content] th {
          border: 1px solid #d1d5db;
          padding: 6px 8px;
          min-width: 40px;
          vertical-align: top;
        }

        /* ── Resizable image styles ── */
        figure[data-docubox-image] {
          display: block;
          position: relative;
          margin: 8px 0;
          line-height: 0;
          max-width: 100%;
          cursor: default;
        }
        figure[data-docubox-image] img {
          display: block;
          max-width: 100%;
          height: auto;
          cursor: pointer;
          user-select: none;
          -webkit-user-select: none;
        }
        figure[data-docubox-image][data-selected="true"] img {
          outline: 2px solid #2563eb;
          outline-offset: 2px;
        }
        figure[data-docubox-image][data-alignment="left"] {
          margin-left: 0;
          margin-right: auto;
        }
        figure[data-docubox-image][data-alignment="center"] {
          margin-left: auto;
          margin-right: auto;
        }
        figure[data-docubox-image][data-alignment="right"] {
          margin-left: auto;
          margin-right: 0;
        }
        .docubox-resize-handle {
          position: absolute;
          width: 10px;
          height: 10px;
          background: #2563eb;
          border: 2px solid white;
          border-radius: 50%;
          z-index: 20;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .docubox-resize-handle:hover {
          background: #1d4ed8;
          transform: scale(1.2);
        }
      `}</style>
    </>
  );
});

// ─── EditableDocumentPaginator (legacy wrapper kept for compatibility) ─────────

interface EditableDocumentPaginatorProps {
  editorContent: React.ReactNode;
  currentHtml: string;
  paperSize: PaperSize;
  orientation: PageOrientation;
}

export function EditableDocumentPaginator({
  editorContent,
  currentHtml,
  paperSize,
  orientation,
}: EditableDocumentPaginatorProps) {
  const dims = getPageDimensions(paperSize, orientation);
  const contentHeight = getContentHeight(dims);
  const contentWidth = getContentWidth(dims);
  const [extraPages, setExtraPages] = useState<string[]>([]);
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!measureRef.current) return;
    const container = measureRef.current;
    container.innerHTML = currentHtml;
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length === 0) {
      setExtraPages([]);
      return;
    }
    const pageContents: string[] = [];
    let curHtml = '';
    let curHeight = 0;
    for (const child of children) {
      const h = child.offsetHeight;
      if (curHeight + h > contentHeight && curHeight > 0) {
        pageContents.push(curHtml);
        curHtml = child.outerHTML;
        curHeight = h;
      } else {
        curHtml += child.outerHTML;
        curHeight += h;
      }
    }
    if (curHtml) pageContents.push(curHtml);
    setExtraPages(pageContents.slice(1));
  }, [currentHtml, contentHeight, contentWidth]);

  return (
    <>
      <div
        ref={measureRef}
        style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          width: `${contentWidth}px`,
          visibility: 'hidden',
          pointerEvents: 'none',
          fontFamily: 'Arial, sans-serif',
          fontSize: '12pt',
          lineHeight: '1.6',
          wordBreak: 'break-word',
        }}
      />
      <div className="document-preview" style={documentPreviewStyle}>
        <div className="page" data-page="1" style={pageStyle(dims)}>
          <div className="page-header" style={pageHeaderStyle}>
            Página 1
          </div>
          <div className="page-content" style={pageContentStyle()}>
            {editorContent}
          </div>
        </div>
        {extraPages.map((pageHtml, idx) => (
          <div key={idx + 2} className="page" data-page={idx + 2} style={pageStyle(dims)}>
            <div className="page-header" style={pageHeaderStyle}>
              Página {idx + 2}
            </div>
            <div className="page-content" style={pageContentStyle()}>
              <div
                style={{
                  fontFamily: 'Arial, sans-serif',
                  fontSize: '12pt',
                  lineHeight: '1.6',
                  wordBreak: 'break-word',
                }}
                dangerouslySetInnerHTML={{ __html: pageHtml }}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
