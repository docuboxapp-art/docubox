export type ListDirection = 'asc' | 'desc';
export type CatalogSort = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';
export type TableSortValue = string | number | boolean | null | undefined;

export const DEFAULT_CATALOG_SORT: CatalogSort = 'updated_desc';

const tableCollator = new Intl.Collator('es-MX', { numeric: true, sensitivity: 'base' });

export function tableDate(value: string | null | undefined) {
  return value ? Date.parse(value) : null;
}

export function compareTableValues(
  left: TableSortValue,
  right: TableSortValue,
  direction: ListDirection
) {
  const missing = (value: TableSortValue) =>
    value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value));
  if (missing(left)) return missing(right) ? 0 : 1;
  if (missing(right)) return -1;
  const order =
    typeof left === 'number' && typeof right === 'number'
      ? left - right
      : tableCollator.compare(String(left), String(right));
  return direction === 'asc' ? order : -order;
}

export function getTableSortDirection(sort: string, ascending: string, descending: string) {
  return sort === ascending ? 'asc' : sort === descending ? 'desc' : undefined;
}

export function tableAriaSort(direction: ListDirection | undefined) {
  return direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined;
}

/** A missing or unreadable date goes at the end in either direction. */
export function compareListDates(
  left: string | null | undefined,
  right: string | null | undefined,
  direction: ListDirection
) {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  if (!Number.isFinite(leftTime)) return Number.isFinite(rightTime) ? 1 : 0;
  if (!Number.isFinite(rightTime)) return -1;
  return direction === 'asc' ? leftTime - rightTime : rightTime - leftTime;
}

export function compareCatalogRows<T extends { id: string; updated_at?: string | null }>(
  left: T,
  right: T,
  sort: `${string}_${ListDirection}`,
  nameOf: (row: T) => string,
  columnValues?: Readonly<Record<string, (row: T) => TableSortValue>>
) {
  if (sort === 'updated_asc' || sort === 'updated_desc') {
    const byDate = compareListDates(
      left.updated_at,
      right.updated_at,
      sort === 'updated_asc' ? 'asc' : 'desc'
    );
    if (byDate) return byDate;
  } else if (columnValues) {
    const field = sort.slice(0, sort.lastIndexOf('_'));
    const read = columnValues[field];
    if (read && Object.hasOwn(columnValues, field)) {
      const order = compareTableValues(
        read(left),
        read(right),
        sort.endsWith('_asc') ? 'asc' : 'desc'
      );
      if (order) return order;
    }
  }
  const byName = nameOf(left).localeCompare(nameOf(right), 'es-MX');
  return (sort === 'name_desc' ? -byName : byName) || left.id.localeCompare(right.id);
}
