'use client';

import { useRef, type AriaAttributes, type CSSProperties, type ReactNode } from 'react';
import type { ColumnMovement } from './useColumnReorder';

export default function ResizableTableHeader<ColumnKey extends string>({
  colKey,
  width,
  minWidth = 60,
  maxWidth = Infinity,
  onResize,
  onResizeEnd,
  className = '',
  style,
  children,
  movement,
  ariaSort,
  resizeLabel = 'Ajustar ancho de columna',
}: {
  colKey: ColumnKey;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  onResize?: (key: ColumnKey, width: number) => void;
  onResizeEnd?: (key: ColumnKey, width: number) => void;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  movement?: ColumnMovement;
  ariaSort?: AriaAttributes['aria-sort'];
  resizeLabel?: string;
}) {
  const header = useRef<HTMLTableCellElement>(null);
  const drag = useRef<{
    id: number;
    startX: number;
    startWidth: number;
    width: number;
    moved: boolean;
  } | null>(null);
  const constrain = (value: number) => Math.min(maxWidth, Math.max(minWidth, value));

  return (
    <th
      ref={header}
      scope="col"
      aria-sort={ariaSort}
      data-column-drop-target={movement?.target || undefined}
      className={`relative select-none whitespace-nowrap ${className}`}
      style={{ width, ...style }}
    >
      {movement ? (
        <div className="flex min-w-0 items-center gap-1.5">
          {movement.grip}
          {children}
        </div>
      ) : (
        children
      )}
      {onResize && (
        <span
          role="separator"
          tabIndex={0}
          aria-label={resizeLabel}
          aria-orientation="vertical"
          aria-valuemin={minWidth}
          aria-valuemax={Number.isFinite(maxWidth) ? maxWidth : undefined}
          aria-valuenow={width}
          title="Arrastrar para redimensionar"
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            const startWidth = header.current?.offsetWidth ?? width ?? 120;
            drag.current = {
              id: event.pointerId,
              startX: event.clientX,
              startWidth,
              width: startWidth,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const gesture = drag.current;
            if (!gesture || gesture.id !== event.pointerId) return;
            const next = constrain(gesture.startWidth + event.clientX - gesture.startX);
            if (next === gesture.width) return;
            gesture.width = next;
            gesture.moved = true;
            onResize(colKey, next);
          }}
          onLostPointerCapture={(event) => {
            const gesture = drag.current;
            if (!gesture || gesture.id !== event.pointerId) return;
            drag.current = null;
            if (gesture.moved) onResizeEnd?.(colKey, gesture.width);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const current = header.current?.offsetWidth ?? width ?? 120;
            const next = constrain(current + (event.key === 'ArrowRight' ? 16 : -16));
            onResize(colKey, next);
            onResizeEnd?.(colKey, next);
          }}
          className="workspace-column-resizer group/resizer absolute inset-y-0 right-0 z-10 flex w-1.5 touch-none cursor-col-resize items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="h-4 w-0.5 rounded-full bg-border transition-colors group-hover/resizer:bg-primary/50 group-focus-visible/resizer:bg-primary" />
        </span>
      )}
    </th>
  );
}
