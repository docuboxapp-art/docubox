'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  isTablePageSize,
  shouldShowTablePagination,
  TABLE_PAGE_SIZES,
  type TablePageSize,
} from '@/lib/workspaces/table-pagination';

export function useTablePagination(total: number, resetKey = '') {
  const [pageSize, setPageSize] = useState<TablePageSize>(DEFAULT_TABLE_PAGE_SIZE);
  const [location, setLocation] = useState({ page: 1, key: resetKey });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = location.key === resetKey ? Math.min(location.page, pageCount) : 1;
  if (location.key !== resetKey || location.page !== page) {
    setLocation({ page, key: resetKey });
  }

  function onPageChange(next: number) {
    setLocation({ page: Math.max(1, Math.min(next, pageCount)), key: resetKey });
  }

  function onPageSizeChange(size: TablePageSize) {
    setPageSize(size);
    setLocation({ page: 1, key: resetKey });
  }

  return {
    total,
    page,
    pageSize,
    start: (page - 1) * pageSize,
    end: Math.min(page * pageSize, total),
    onPageChange,
    onPageSizeChange,
  };
}

const control =
  'h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-primary disabled:opacity-50';
const pageButton = `${control} grid w-9 shrink-0 place-items-center hover:bg-muted disabled:hover:bg-card`;

export default function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  disabled = false,
}: {
  total: number;
  page: number;
  pageSize: TablePageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: TablePageSize) => void;
  disabled?: boolean;
}) {
  if (!shouldShowTablePagination(total)) return null;

  const pageCount = Math.ceil(total / pageSize);
  const current = Math.max(1, Math.min(page, pageCount));
  const first = (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);

  return (
    <nav
      aria-label="Paginación de la tabla"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-card px-3 py-2.5 text-sm text-muted-foreground sm:px-4"
    >
      <p aria-live="polite" className="tabular-nums">
        {`Mostrando ${first}–${last} de ${total}`}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          Registros por página
          <select
            className={control}
            value={pageSize}
            disabled={disabled}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (isTablePageSize(next)) onPageSizeChange(next);
            }}
          >
            {TABLE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Página anterior"
            className={pageButton}
            disabled={disabled || current <= 1}
            onClick={() => onPageChange(current - 1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <label className="flex items-center gap-1.5">
            Página
            <select
              className={control}
              value={current}
              disabled={disabled || pageCount <= 1}
              onChange={(event) => onPageChange(Number(event.currentTarget.value))}
            >
              {Array.from({ length: pageCount }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
            <span className="whitespace-nowrap">de {pageCount}</span>
          </label>
          <button
            type="button"
            aria-label="Página siguiente"
            className={pageButton}
            disabled={disabled || current >= pageCount}
            onClick={() => onPageChange(current + 1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  );
}
