export function viewConfigRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Restore a saved order and visibility while using the current field catalog. */
export function restoreViewOrder<T extends { id: string }>(
  raw: unknown,
  catalog: readonly T[]
): T[] {
  const entries = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const result: T[] = [];
  for (const entry of entries) {
    const row = viewConfigRecord(entry);
    const known = catalog.find((item) => item.id === row.id);
    if (!known || seen.has(known.id)) continue;
    seen.add(known.id);
    result.push({
      ...known,
      ...('visible' in known && typeof row.visible === 'boolean' ? { visible: row.visible } : {}),
      ...('selected' in known && typeof row.selected === 'boolean'
        ? { selected: row.selected }
        : {}),
    });
  }
  return [...result, ...catalog.filter((item) => !seen.has(item.id)).map((item) => ({ ...item }))];
}

export function moveViewColumn<T extends { id: string }>(
  columns: readonly T[],
  fromId: string,
  toId: string
): T[] | null {
  const from = columns.findIndex((column) => column.id === fromId);
  const to = columns.findIndex((column) => column.id === toId);
  if (from < 0 || to < 0 || from === to) return null;

  const reordered = [...columns];
  const [column] = reordered.splice(from, 1);
  reordered.splice(to, 0, column);
  return reordered;
}
