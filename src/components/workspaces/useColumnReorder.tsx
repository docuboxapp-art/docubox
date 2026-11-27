import { Fragment, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

type ColumnGesture = {
  pointerId: number;
  from: string;
  startX: number;
  row: HTMLTableRowElement;
};

export type ColumnMovement = { grip: ReactNode; target: boolean };

export function useColumnReorder(
  columns: readonly { id: string }[],
  onMove?: (from: string, to: string) => void | Promise<void>
) {
  const gesture = useRef<ColumnGesture | null>(null);
  const pending = useRef(false);
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function destination(event: PointerEvent<HTMLButtonElement>, drag: ColumnGesture) {
    if (Math.abs(event.clientX - drag.startX) < 6) return null;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('th');
    if (cell?.parentElement !== drag.row) return null;
    const id = cell.querySelector<HTMLElement>('[data-column-grip]')?.dataset.columnGrip;
    return id && id !== drag.from && columns.some((column) => column.id === id) ? id : null;
  }

  function move(from: string, to: string) {
    if (!onMove || pending.current || from === to) return;
    pending.current = true;
    setSaving(true);
    setError('');
    void (async () => {
      try {
        await onMove(from, to);
      } catch {
        setError('No se pudo guardar el orden de las columnas. Intenta mover la columna otra vez.');
      } finally {
        pending.current = false;
        setSaving(false);
      }
    })();
  }

  function movement(id: string, label: string): ColumnMovement | undefined {
    const index = columns.findIndex((column) => column.id === id);
    if (!onMove || columns.length < 2 || index < 0) return undefined;

    return {
      target: id === target,
      grip: (
        <button
          type="button"
          aria-label={`Mover columna ${label}`}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          aria-disabled={saving}
          data-column-grip={id}
          title={`Arrastra para mover ${label} o usa ← y →`}
          className="workspace-column-grip grid size-5 shrink-0 touch-none cursor-grab place-items-center rounded text-muted-foreground/75 hover:bg-primary/10 hover:text-primary focus-visible:outline-primary active:cursor-grabbing"
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0 || pending.current) return;
            const row = event.currentTarget.closest('tr');
            if (!row) return;
            gesture.current = { pointerId: event.pointerId, from: id, startX: event.clientX, row };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = gesture.current;
            if (drag?.pointerId === event.pointerId) setTarget(destination(event, drag));
          }}
          onPointerUp={(event) => {
            const drag = gesture.current;
            if (drag?.pointerId !== event.pointerId) return;
            const to = destination(event, drag);
            gesture.current = null;
            setTarget(null);
            if (to) move(drag.from, to);
          }}
          onLostPointerCapture={(event) => {
            if (gesture.current?.pointerId !== event.pointerId) return;
            gesture.current = null;
            setTarget(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const step = event.key === 'ArrowLeft' ? -1 : 1;
            const adjacent = columns[index + step];
            if (adjacent) move(id, adjacent.id);
          }}
        >
          <GripVertical size={13} aria-hidden="true" />
        </button>
      ),
    };
  }

  return { movement, saving, error };
}

export function orderedTableCells<Column extends { id: string }>(
  columns: readonly Column[],
  cells: Readonly<Record<Column['id'], ReactNode | ((column: Column) => ReactNode)>>
) {
  return columns.map((column) => {
    const cell = cells[column.id as Column['id']];
    return <Fragment key={column.id}>{typeof cell === 'function' ? cell(column) : cell}</Fragment>;
  });
}
