'use client';

import { GitBranch, Plus, Trash2 } from 'lucide-react';
import {
  flowStagesError,
  newFlowStage,
  type FlowAction,
  type FlowField,
  type FlowStage,
} from '@/lib/tasks/flow-stages';

const actionLabels: Record<FlowAction, string> = {
  notify_assignee: 'Notificar al responsable',
  raise_priority: 'Elevar prioridad',
  create_followup: 'Crear seguimiento',
};
const fieldLabels: Record<FlowField, string> = {
  status: 'Estado',
  priority: 'Prioridad',
  risk: 'Riesgo',
  source_type: 'Tipo de recurso',
  overdue: 'Está vencido',
  inactive_days: 'Días sin cambios',
};

export default function TaskFlowStagesEditor({
  stages,
  targetKind,
  onChange,
}: {
  stages: FlowStage[];
  targetKind: string;
  onChange: (stages: FlowStage[]) => void;
}) {
  const fieldClass =
    'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800';
  const error = flowStagesError(stages, targetKind);
  const patch = (index: number, value: Partial<FlowStage>) =>
    onChange(
      stages.map((stage, position) => (position === index ? { ...stage, ...value } : stage))
    );
  const options =
    targetKind === 'task'
      ? Object.entries(fieldLabels)
      : Object.entries(fieldLabels).filter(([key]) =>
          ['status', 'source_type', 'overdue'].includes(key)
        );
  const add = () => {
    if (stages.length >= 5) return;
    const next = stages.length + 1;
    onChange([
      ...stages.map((stage, index) =>
        index === stages.length - 1
          ? { ...stage, nextTrue: stage.nextTrue ?? next, nextFalse: stage.nextFalse ?? next }
          : stage
      ),
      { ...newFlowStage(), value: targetKind === 'task' ? 'pendiente' : '', field: 'status' },
    ]);
  };
  const removeLast = () =>
    onChange(
      stages.slice(0, -1).map((stage) => ({
        ...stage,
        nextTrue: stage.nextTrue === stages.length ? null : stage.nextTrue,
        nextFalse: stage.nextFalse === stages.length ? null : stage.nextFalse,
      }))
    );
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <GitBranch size={18} className="text-blue-600" />
            Decisiones y ramas
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Después de la acción inicial, cada etapa evalúa el estado actual. La rama «Sí» o «No»
            ejecuta sus propias acciones y puede continuar a otra etapa o terminar. Solo se permiten
            saltos hacia delante.
          </p>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={stages.length >= 5}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm font-medium text-blue-700 disabled:opacity-50"
        >
          <Plus size={15} />
          Añadir decisión
        </button>
      </div>
      {stages.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-500">
          El flujo terminará después de las acciones iniciales. Añade una decisión para crear ramas.
        </p>
      )}
      {stages.map((stage, index) => (
        <article
          key={index}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-950">Etapa {index + 1} · decisión</h4>
            {index === stages.length - 1 && (
              <button
                type="button"
                onClick={removeLast}
                aria-label={`Quitar etapa ${index + 1}`}
                className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_1fr]">
            <label className="text-xs font-medium text-slate-600">
              Campo
              <select
                value={stage.field}
                onChange={(event) => {
                  const field = event.target.value as FlowField;
                  patch(index, {
                    field,
                    operator: field === 'inactive_days' ? 'gte' : 'eq',
                    value: field === 'overdue' ? 'true' : field === 'inactive_days' ? '3' : '',
                  });
                }}
                className={`mt-1 ${fieldClass}`}
              >
                {options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Comparación
              <select
                value={stage.operator}
                disabled={stage.field === 'inactive_days'}
                onChange={(event) =>
                  patch(index, { operator: event.target.value as FlowStage['operator'] })
                }
                className={`mt-1 ${fieldClass}`}
              >
                <option value={stage.field === 'inactive_days' ? 'gte' : 'eq'}>
                  {stage.field === 'inactive_days' ? 'Al menos' : 'Es igual a'}
                </option>
                {stage.field !== 'inactive_days' && <option value="ne">Es distinto de</option>}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Valor
              {stage.field === 'overdue' ? (
                <select
                  value={stage.value}
                  onChange={(event) => patch(index, { value: event.target.value })}
                  className={`mt-1 ${fieldClass}`}
                >
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              ) : stage.field === 'priority' ? (
                <select
                  value={stage.value}
                  onChange={(event) => patch(index, { value: event.target.value })}
                  className={`mt-1 ${fieldClass}`}
                >
                  <option value="">Selecciona</option>
                  {['baja', 'media', 'alta', 'critica'].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : stage.field === 'risk' ? (
                <select
                  value={stage.value}
                  onChange={(event) => patch(index, { value: event.target.value })}
                  className={`mt-1 ${fieldClass}`}
                >
                  <option value="">Selecciona</option>
                  {['bajo', 'medio', 'alto'].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={stage.field === 'inactive_days' ? 'number' : 'text'}
                  min={stage.field === 'inactive_days' ? 1 : undefined}
                  max={stage.field === 'inactive_days' ? 90 : undefined}
                  maxLength={60}
                  value={stage.value}
                  onChange={(event) => patch(index, { value: event.target.value })}
                  placeholder={stage.field === 'status' ? 'Ej. en_proceso' : 'Valor exacto'}
                  className={`mt-1 ${fieldClass}`}
                />
              )}
            </label>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(['True', 'False'] as const).map((branch) => {
              const actionsKey = branch === 'True' ? 'onTrue' : 'onFalse';
              const nextKey = branch === 'True' ? 'nextTrue' : 'nextFalse';
              return (
                <div
                  key={branch}
                  className={`rounded-lg border p-4 ${branch === 'True' ? 'border-green-200 bg-green-50/40' : 'border-slate-200 bg-slate-50/60'}`}
                >
                  <p className="text-sm font-semibold text-slate-900">
                    Si {branch === 'True' ? 'se cumple' : 'no se cumple'}
                  </p>
                  <div className="mt-3 space-y-2">
                    {(Object.entries(actionLabels) as [FlowAction, string][])
                      .filter(([action]) => targetKind === 'task' || action !== 'raise_priority')
                      .map(([action, label]) => (
                        <label
                          key={action}
                          className="flex items-center gap-2 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={stage[actionsKey].includes(action)}
                            onChange={() =>
                              patch(index, {
                                [actionsKey]: stage[actionsKey].includes(action)
                                  ? stage[actionsKey].filter((item) => item !== action)
                                  : [...stage[actionsKey], action],
                              })
                            }
                            className="h-4 w-4 accent-blue-600"
                          />
                          {label}
                        </label>
                      ))}
                  </div>
                  <label className="mt-4 block text-xs font-medium text-slate-600">
                    Después
                    <select
                      value={stage[nextKey] ?? ''}
                      onChange={(event) =>
                        patch(index, {
                          [nextKey]: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                      className={`mt-1 ${fieldClass}`}
                    >
                      <option value="">Finalizar flujo</option>
                      {stages.map(
                        (_, target) =>
                          target > index && (
                            <option key={target} value={target + 1}>
                              Ir a etapa {target + 1}
                            </option>
                          )
                      )}
                    </select>
                  </label>
                </div>
              );
            })}
          </div>
        </article>
      ))}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </section>
  );
}
