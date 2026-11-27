import { useCallback, useState, useSyncExternalStore } from 'react';
import { moveViewColumn, restoreViewOrder, viewConfigRecord } from '@/lib/workspaces/view-order';
import { useColumnReorder } from './useColumnReorder';

type Layout = { columns: { id: string }[]; widths: Record<string, number> };
type Column = { id: string; label: string };

const layoutChanged = 'docubox:table-columns-changed';
const maxWidth = 720;
const minWidth = (id: string, primaryId?: string) => (id === primaryId ? 144 : 96);

function readLayout(serialized: string) {
  try {
    return viewConfigRecord(JSON.parse(serialized));
  } catch {
    return {};
  }
}

export function useTableColumnLayout<T extends Column>(
  columns: readonly T[],
  {
    table,
    userId,
    workspaceId,
    primaryId,
  }: {
    table: string;
    userId?: string;
    workspaceId?: string;
    primaryId?: string;
  }
) {
  const key = userId ? `docubox:table-columns:v1:${userId}:${workspaceId ?? 'all'}:${table}` : null;
  const [draft, setDraft] = useState<{ key: string | null; id: string; width: number } | null>(
    null
  );
  const [temporary, setTemporary] = useState<{ key: string | null; value: Layout } | null>(null);
  const subscribe = useCallback(
    (update: () => void) => {
      if (!key) return () => {};
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) update();
      };
      window.addEventListener('storage', onStorage);
      window.addEventListener(layoutChanged, update);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(layoutChanged, update);
      };
    },
    [key]
  );
  const readStorage = useCallback(() => {
    try {
      return key ? (window.localStorage.getItem(key) ?? '') : '';
    } catch {
      return '';
    }
  }, [key]);
  const serialized = useSyncExternalStore(subscribe, readStorage, () => '');
  const stored = temporary?.key === key ? temporary.value : readLayout(serialized);
  const movable = restoreViewOrder(
    stored.columns,
    columns.filter((column) => column.id !== primaryId)
  );
  const primary = columns.find((column) => column.id === primaryId);
  const ordered = primary ? [primary, ...movable] : movable;
  const rawWidths = viewConfigRecord(stored.widths);
  const widths: Record<string, number> = {};
  for (const { id } of columns) {
    const width = rawWidths[id];
    if (typeof width === 'number' && Number.isFinite(width)) {
      widths[id] = Math.min(maxWidth, Math.max(minWidth(id, primaryId), Math.round(width)));
    }
  }

  function save(next: readonly T[], newWidths = widths) {
    const value = { columns: next.map(({ id }) => ({ id })), widths: newWidths };
    if (key) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        setTemporary(null);
        window.dispatchEvent(new Event(layoutChanged));
        return;
      } catch {
        // Keep the layout usable while browser storage is unavailable.
      }
    }
    setTemporary({ key, value });
  }

  const { movement } = useColumnReorder(movable, (from, to) => {
    const next = moveViewColumn(movable, from, to);
    if (next) save(next);
  });

  function headerProps({ id, label }: T) {
    const width = draft?.key === key && draft.id === id ? draft.width : widths[id];
    return {
      colKey: id,
      resizeLabel: `Ajustar ancho de ${label}`,
      width,
      style: { minWidth: width },
      minWidth: minWidth(id, primaryId),
      maxWidth,
      movement: movement(id, label),
      onResize: (id: string, width: number) => setDraft({ key, id, width }),
      onResizeEnd: (id: string, width: number) => {
        setDraft(null);
        save(movable, { ...widths, [id]: width });
      },
    };
  }

  return { columns: ordered, headerProps };
}
