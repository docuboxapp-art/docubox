import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
  getTableSortDirection,
  tableAriaSort,
  type ListDirection,
} from '@/lib/workspaces/list-order';

export function TableSortButton({
  label,
  direction,
  onSort,
  defaultDirection = 'asc',
  describeDirection,
}: {
  label: string;
  direction?: ListDirection;
  onSort: (direction: ListDirection) => void;
  defaultDirection?: ListDirection;
  describeDirection?: (direction: ListDirection) => string;
}) {
  const next = direction ? (direction === 'asc' ? 'desc' : 'asc') : defaultDirection;
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
  const description = describeDirection?.(next) ?? (next === 'asc' ? 'Ascendente' : 'Descendente');

  return (
    <button
      type="button"
      onClick={() => onSort(next)}
      aria-label={`Ordenar ${label}: ${description}`}
      title={`Ordenar ${label}: ${description}`}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-left text-inherit hover:text-primary focus-visible:rounded-sm focus-visible:outline-primary"
    >
      <span className="truncate">{label}</span>
      <Icon
        size={direction ? 13 : 12}
        className={`shrink-0 ${direction ? 'text-primary' : 'text-muted-foreground'}`}
        aria-hidden="true"
      />
    </button>
  );
}

export function TableSortHeading<Sort extends string>({
  label,
  sort,
  ascending,
  descending,
  onSort,
  defaultDirection,
  className = 'whitespace-nowrap px-3 py-3 text-left',
}: {
  label: string;
  sort: Sort;
  ascending: Sort;
  descending: Sort;
  onSort: (value: Sort) => void;
  defaultDirection?: ListDirection;
  className?: string;
}) {
  const direction = getTableSortDirection(sort, ascending, descending);
  return (
    <th scope="col" className={className} aria-sort={tableAriaSort(direction)}>
      <TableSortButton
        label={label}
        direction={direction}
        defaultDirection={defaultDirection}
        onSort={(next) => onSort(next === 'asc' ? ascending : descending)}
      />
    </th>
  );
}
