'use client';

import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  reportPeriods,
  type Condition,
  type ReportConfig,
  type ReportField,
  type ReportRow,
} from '@/lib/reporting/catalog';
import { displayReportValue, operatorsForType, searchableReportText } from '@/lib/reporting/engine';
import { reportButton, reportCard, reportControl } from '../components/styles';

export function ReportConditions({
  config,
  fields,
  rows,
  change,
}: {
  config: ReportConfig;
  fields: ReportField[];
  rows: ReportRow[];
  change: (patch: Partial<ReportConfig>) => void;
}) {
  const optionsId = useId();
  const dates = fields.filter((field) => field.type === 'date');
  const update = (index: number, patch: Partial<Condition>) =>
    change({
      conditions: config.conditions.map((item, position) =>
        position === index ? { ...item, ...patch } : item
      ),
    });

  return (
    <section className={reportCard + ' p-4 sm:p-5'}>
      <h2 className="text-base font-semibold">3. Flujo y condiciones</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          Periodo
          <select
            value={config.period}
            disabled={!dates.length}
            className={reportControl}
            onChange={(event) =>
              change({
                period: event.target.value as ReportConfig['period'],
                dateField: config.dateField || dates[0]?.id || '',
              })
            }
          >
            {reportPeriods.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          Fecha de referencia
          <select
            value={config.dateField}
            className={reportControl}
            onChange={(event) =>
              change({
                dateField: event.target.value,
                period: event.target.value ? config.period : 'all',
              })
            }
          >
            <option value="">Sin fecha</option>
            {config.dateField && !dates.some((field) => field.id === config.dateField) && (
              <option value={config.dateField}>Campo no disponible</option>
            )}
            {dates.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          Coincidencia
          <select
            value={config.match}
            onChange={(event) => change({ match: event.target.value as ReportConfig['match'] })}
            className={reportControl}
          >
            <option value="all">Todas las condiciones</option>
            <option value="any">Cualquier condición</option>
          </select>
        </label>
      </div>
      <div className="mt-4 space-y-2">
        {config.conditions.map((condition, index) => {
          const field = fields.find((item) => item.id === condition.field);
          const type = field?.type ?? 'text';
          const noValue = ['empty', 'not_empty'].includes(condition.operator);
          const operators = operatorsForType(type);
          const distinct: string[] = [];
          if (type === 'text' && field && !noValue) {
            const labels = new Set<string>();
            for (const row of rows) {
              const raw = row[field.id];
              if (raw == null || raw === '') continue;
              const label = displayReportValue(raw, field);
              if (label.length > 100 || labels.has(label)) continue;
              labels.add(label);
              distinct.push(label);
              if (distinct.length === 30) break;
            }
            distinct.sort((a, b) => a.localeCompare(b, 'es'));
          }
          const normalized = searchableReportText(condition.value);
          const selectedBoolean = ['true', 'si', '1'].includes(normalized)
            ? 'true'
            : ['false', 'no', '0'].includes(normalized)
              ? 'false'
              : '';

          return (
            <div
              key={index}
              className="grid min-w-0 gap-2 rounded-md border border-border bg-muted/20 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <select
                aria-label={'Campo de condición ' + (index + 1)}
                value={condition.field}
                className={reportControl}
                onChange={(event) =>
                  update(index, { field: event.target.value, operator: 'eq', value: '' })
                }
              >
                {!field && <option value={condition.field}>Campo no disponible</option>}
                {fields.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={'Operador ' + (index + 1)}
                value={condition.operator}
                className={reportControl}
                onChange={(event) => {
                  const operator = event.target.value as Condition['operator'];
                  update(
                    index,
                    ['empty', 'not_empty'].includes(operator)
                      ? { operator, value: '' }
                      : { operator }
                  );
                }}
              >
                {!operators.some(([id]) => id === condition.operator) && (
                  <option value={condition.operator}>Operador no disponible</option>
                )}
                {operators.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              {type === 'boolean' ? (
                <select
                  aria-label={'Valor ' + (index + 1)}
                  value={selectedBoolean}
                  disabled={noValue}
                  className={reportControl}
                  onChange={(event) => update(index, { value: event.target.value })}
                >
                  <option value="">Selecciona un valor</option>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <div className="min-w-0">
                  <input
                    aria-label={'Valor ' + (index + 1)}
                    placeholder="Valor"
                    value={condition.value}
                    disabled={noValue}
                    type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
                    step={type === 'number' ? 'any' : undefined}
                    maxLength={500}
                    list={distinct.length ? optionsId + '-' + index : undefined}
                    className={reportControl + ' w-full'}
                    onChange={(event) => update(index, { value: event.target.value })}
                  />
                  {distinct.length > 0 && (
                    <datalist id={optionsId + '-' + index}>
                      {distinct.map((label) => (
                        <option key={label} value={label} />
                      ))}
                    </datalist>
                  )}
                </div>
              )}
              <button
                type="button"
                className={
                  reportButton +
                  ' justify-self-end px-2.5 text-muted-foreground hover:text-destructive'
                }
                aria-label={'Quitar condición ' + (index + 1)}
                onClick={() =>
                  change({
                    conditions: config.conditions.filter((_, position) => position !== index),
                  })
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          disabled={!fields.length || config.conditions.length >= 12}
          onClick={() =>
            change({
              conditions: [
                ...config.conditions,
                { field: fields[0].id, operator: 'eq', value: '' },
              ],
            })
          }
          className={reportButton + ' border-dashed border-primary/35 text-primary'}
        >
          <Plus size={15} aria-hidden="true" />
          Añadir condición
        </button>
      </div>
    </section>
  );
}
