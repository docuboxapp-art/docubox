'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  LockKeyhole,
  Search,
} from 'lucide-react';
import type { PlatformRow } from '@/lib/platform-admin/data';
import { TableSortButton } from '@/components/workspaces/TableSortButton';
import { tableAriaSort, type ListDirection } from '@/lib/workspaces/list-order';
import TablePagination, { useTablePagination } from '@/components/workspaces/TablePagination';

export type PlatformColumn = { key: string; label: string; mono?: boolean };

function formatValue(key: string, value: PlatformRow[string]) {
  if (value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return new Intl.NumberFormat('es-MX').format(value);
  if (/(_at|_time|expires|period_end)$/.test(key)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    }
  }
  if (key.includes('hash') || key === 'id' || key.endsWith('_id')) {
    return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
  }
  return value;
}

function Status({ value }: { value: PlatformRow[string] }) {
  const normalized = String(value ?? '').toLowerCase();
  const positive = [
    'active',
    'valid',
    'verified',
    'completed',
    'completado',
    'issued',
    'success',
    'true',
  ].includes(normalized);
  const pending = ['pending', 'processing', 'invited', 'not_started'].includes(normalized);
  const negative = ['failed', 'invalid', 'blocked', 'suspended', 'revoked', 'false'].includes(
    normalized
  );
  const Icon = positive ? CheckCircle2 : pending ? Clock3 : negative ? AlertCircle : Database;
  const className = positive
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : pending
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : negative
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {formatValue('status', value)}
    </span>
  );
}

export default function PlatformDataTable({
  rows,
  columns,
  protectedContent = false,
  rowHrefPrefix,
}: {
  rows: PlatformRow[];
  columns: PlatformColumn[];
  protectedContent?: boolean;
  rowHrefPrefix?: string;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? '');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('es-MX');
    const matching = normalizedQuery
      ? rows.filter((row) =>
          columns.some((column) =>
            String(row[column.key] ?? '')
              .toLocaleLowerCase('es-MX')
              .includes(normalizedQuery)
          )
        )
      : rows;
    return [...matching].sort((left, right) => {
      const a = String(left[sortKey] ?? '');
      const b = String(right[sortKey] ?? '');
      return a.localeCompare(b, 'es-MX', { numeric: true }) * (sortDirection === 'asc' ? 1 : -1);
    });
  }, [columns, query, rows, sortDirection, sortKey]);

  const pagination = useTablePagination(filtered.length, JSON.stringify([query, sortKey, sortDirection]));
  const visibleRows = filtered.slice(pagination.start, pagination.end);

  const changeSort = (key: string, direction: ListDirection) => {
    setSortKey(key);
    setSortDirection(direction);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#121418]">
      {protectedContent ? (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <LockKeyhole className="h-4 w-4" aria-hidden="true" />
          Contenido protegido. Esta vista no permite abrir ni descargar archivos de clientes.
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <label className="relative block w-full max-w-sm">
          <span className="sr-only">Buscar registros</span>
          <Search
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar en esta vista..."
            className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <span className="text-xs text-slate-500">{filtered.length} registros</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="workspace-table-heading">
            <tr>
              {columns.map((column) => {
                const direction = sortKey === column.key ? sortDirection : undefined;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={tableAriaSort(direction)}
                    className="whitespace-nowrap border-b border-border px-4 py-3"
                  >
                    <TableSortButton
                      label={column.label}
                      direction={direction}
                      onSort={(next) => changeSort(column.key, next)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr
                key={String(row.id ?? row.user_id ?? `${index}`)}
                className="border-b border-slate-100 last:border-0 dark:border-slate-800"
              >
                {columns.map((column, columnIndex) => {
                  const value = row[column.key];
                  const statusColumn = [
                    'status',
                    'estado',
                    'verification_status',
                    'outcome',
                  ].includes(column.key);
                  return (
                    <td
                      key={column.key}
                      className={`max-w-80 px-4 py-3 text-slate-700 dark:text-slate-200 ${column.mono ? 'font-mono text-xs' : ''}`}
                    >
                      {statusColumn ? (
                        <Status value={value} />
                      ) : rowHrefPrefix && columnIndex === 0 && value ? (
                        <Link
                          href={`${rowHrefPrefix}/${encodeURIComponent(String(value))}`}
                          className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                        >
                          {formatValue(column.key, value)}
                        </Link>
                      ) : (
                        formatValue(column.key, value)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-14 text-center text-sm text-slate-500"
                >
                  No hay registros que coincidan con la búsqueda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <TablePagination {...pagination} />
    </section>
  );
}
