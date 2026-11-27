'use client';

import { useMemo } from 'react';
import {
  BarChart3,
  LayoutDashboard,
  LineChart as LineIcon,
  PieChart as PieIcon,
  Table2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReportConfig, ReportField, ReportRow, Visualization } from '@/lib/reporting/catalog';
import { buildReportSeries, displayReportValue, displayValue } from '@/lib/reporting/engine';
import { TableSortButton } from '@/components/workspaces/TableSortButton';
import { tableAriaSort, type ListDirection } from '@/lib/workspaces/list-order';

export const reportViews = [
  { id: 'table', label: 'Tabla', icon: Table2 },
  { id: 'bar', label: 'Barras', icon: BarChart3 },
  { id: 'line', label: 'Líneas', icon: LineIcon },
  { id: 'pie', label: 'Circular', icon: PieIcon },
  { id: 'kpi', label: 'Indicadores', icon: LayoutDashboard },
] as const;

export function ReportVisualizationButtons({
  value,
  onChange,
}: {
  value: Visualization;
  onChange: (value: Visualization) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Tipo de visualización"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
    >
      {reportViews.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`flex min-h-[4rem] flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors focus-visible:outline-primary ${
            value === id
              ? 'border-primary/45 bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <Icon size={21} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

const palette = ['#2467ec', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#6366f1'];
const numberFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const monthFormat = new Intl.DateTimeFormat('es-MX', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const shorten = (text: string, length: number) =>
  text.length > length ? text.slice(0, length - 1) + '…' : text;

export function ReportPresentation({
  rows,
  config,
  fields,
  columns,
  pageRows,
  tableSort,
  onTableSort,
  preview = false,
}: {
  rows: ReportRow[];
  config: ReportConfig;
  fields: ReportField[];
  columns: ReportField[];
  pageRows?: ReportRow[];
  tableSort?: { field: string; direction: ListDirection };
  onTableSort?: (field: string, direction: ListDirection) => void;
  preview?: boolean;
}) {
  const { visualization, groupBy, metric, metricOperation } = config;
  const { items: data, totalGroups } = useMemo(() => {
    if (visualization === 'table') return { items: [], totalGroups: 0 };
    const series = buildReportSeries(rows, config, fields);
    if (fields.find((field) => field.id === groupBy)?.type !== 'date') return series;
    return {
      ...series,
      items: series.items.map((item) => ({
        ...item,
        label: /^\d{4}-\d{2}$/.test(item.label)
          ? monthFormat.format(new Date(item.label + '-01T12:00:00Z'))
          : item.label === 'Sin dato'
            ? item.label
            : displayValue(item.key, 'date'),
      })),
    };
  }, [config, fields, groupBy, rows, visualization]);
  const measure =
    metric === '__count'
      ? 'Registros'
      : (metricOperation === 'average' ? 'Promedio de ' : 'Suma de ') +
        (fields.find((field) => field.id === metric)?.label || 'la medida');
  const tableRows = pageRows ?? (preview ? rows.slice(0, 5) : rows);

  if (!rows.length)
    return (
      <p className="grid min-h-36 place-items-center px-4 text-center text-sm text-muted-foreground">
        No hay registros que coincidan con esta configuración.
      </p>
    );

  if (visualization === 'table')
    return (
      <div data-visualization="table" className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="workspace-table-heading border-b border-border">
            <tr>
              {columns.map((field) => {
                const direction = tableSort?.field === field.id ? tableSort.direction : undefined;
                return (
                  <th
                    key={field.id}
                    scope="col"
                    aria-sort={onTableSort ? tableAriaSort(direction) : undefined}
                    className="whitespace-nowrap px-3 py-2.5"
                  >
                    {onTableSort ? (
                      <TableSortButton
                        label={field.label}
                        direction={direction}
                        defaultDirection={field.type === 'date' ? 'desc' : 'asc'}
                        onSort={(next) => onTableSort(field.id, next)}
                      />
                    ) : (
                      field.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {tableRows.map((row, index) => (
              <tr key={index} className="hover:bg-muted/30">
                {columns.map((field) => {
                  const value = displayReportValue(row[field.id], field);
                  return (
                    <td key={field.id} title={value} className="max-w-[19rem] truncate px-3 py-2.5">
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  if (visualization !== 'kpi' && !groupBy)
    return (
      <p className="p-5 text-sm text-muted-foreground">
        Elige el campo de agrupación para la gráfica.
      </p>
    );

  if (
    visualization === 'pie' &&
    (!data.some((item) => (item.value ?? 0) > 0) || data.some((item) => (item.value ?? 0) < 0))
  )
    return (
      <p className="p-5 text-sm text-muted-foreground">
        El gráfico circular necesita valores no negativos y un total mayor que cero.
      </p>
    );

  if (visualization === 'kpi')
    return (
      <div data-visualization="kpi" className="space-y-3">
        <p className="text-sm text-muted-foreground">{measure}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
          {data.map((item) => (
            <div
              key={item.key}
              className="min-w-0 rounded-lg border border-primary/15 bg-primary/5 p-4"
            >
              <span className="block break-words text-sm text-muted-foreground">{item.label}</span>
              <strong className="mt-1 block text-2xl font-semibold text-primary">
                {item.value == null ? '—' : numberFormat.format(item.value)}
              </strong>
            </div>
          ))}
        </div>
        {totalGroups > data.length && (
          <p className="text-xs text-muted-foreground">
            {data.length} de {totalGroups} grupos
          </p>
        )}
      </div>
    );

  const height =
    visualization === 'bar' ? Math.max(230, data.length * 29 + 26) : preview ? 245 : 335;
  return (
    <figure data-visualization={visualization} className="min-w-0">
      <figcaption className="mb-2 text-sm text-muted-foreground">{measure}</figcaption>
      <div
        className="min-w-0 max-h-[44rem] overflow-y-auto"
        style={{ height: Math.min(height, 704) }}
      >
        <ResponsiveContainer width="100%" height={height} minWidth={1} minHeight={1}>
          {visualization === 'bar' ? (
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={metric !== '__count'} tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="label"
                width={preview ? 95 : 125}
                tickFormatter={(label: string) => shorten(label, preview ? 13 : 19)}
                tick={{ fontSize: 11 }}
              />
              <Tooltip />
              <Bar
                dataKey="value"
                name={measure}
                fill={palette[0]}
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          ) : visualization === 'line' ? (
            <LineChart data={data} margin={{ top: 8, right: 14, bottom: 5, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickFormatter={(label: string) => shorten(label, 16)}
                tick={{ fontSize: 11 }}
                minTickGap={24}
              />
              <YAxis allowDecimals={metric !== '__count'} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                dataKey="value"
                name={measure}
                stroke={palette[0]}
                strokeWidth={2}
                dot={data.length <= 15}
                isAnimationActive={false}
              />
            </LineChart>
          ) : (
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius="34%"
                outerRadius="72%"
                isAnimationActive={false}
              >
                {data.map((item, index) => (
                  <Cell key={item.key} fill={palette[index % palette.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value: string) => shorten(value, 27)}
              />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
      {totalGroups > data.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          {data.length} grupos representados de {totalGroups}
        </p>
      )}
    </figure>
  );
}
