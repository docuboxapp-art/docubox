import { useState, type ComponentProps } from 'react';
import {
  compareTableValues,
  tableAriaSort,
  type ListDirection,
  type TableSortValue,
} from '@/lib/workspaces/list-order';
import { TableSortButton } from './TableSortButton';

export function useTableOrdering<Row>(
  rows: readonly Row[],
  columns: Readonly<Record<string, (row: Row) => TableSortValue>>,
  afterSort?: () => void
) {
  const [sort, setSort] = useState<{ key: string; direction: ListDirection } | null>(null);
  const read = sort && Object.hasOwn(columns, sort.key) ? columns[sort.key] : undefined;
  const orderedRows =
    sort && read
      ? [...rows].sort((left, right) => compareTableValues(read(left), read(right), sort.direction))
      : rows;

  function sortHeading(
    key: string,
    label: string,
    defaultDirection?: ListDirection
  ): ComponentProps<'th'> {
    const direction = sort?.key === key ? sort.direction : undefined;
    return {
      scope: 'col',
      'aria-sort': tableAriaSort(direction),
      children: (
        <TableSortButton
          label={label}
          direction={direction}
          defaultDirection={defaultDirection}
          onSort={(direction) => {
            setSort({ key, direction });
            afterSort?.();
          }}
        />
      ),
    };
  }
  return { orderedRows, sortHeading };
}
