'use client';

import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import {
  newCaseTemplateStage,
  type CaseTemplateDraft,
  type CaseTemplateStage,
  type CaseWorkflowActivityKind,
} from '@/lib/case-files/template-builder';
import { suggestCaseWorkflow, type WorkflowValidation } from '@/lib/case-files/workflow';
import { caseStageCatalog } from '@/lib/case-files/template-catalog';

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-border dark:bg-background';
type ActivityOption = { kind: CaseWorkflowActivityKind; refId: string | null; label: string };
const roleLabel = {
  owner: 'Responsable del expediente',
  admin: 'Administrador',
  member: 'Integrador',
} as const;

function availableActivities(draft: CaseTemplateDraft): ActivityOption[] {
  const result: ActivityOption[] = [];
  for (const item of draft.sections.flatMap((section) => section.items)) {
    const kind: CaseWorkflowActivityKind =
      item.kind === 'form'
        ? 'complete_form'
        : item.kind === 'document_template'
          ? 'generate_document'
          : item.kind === 'new_document'
            ? 'create_document'
            : 'receive_document';
    result.push({
      kind,
      refId: item.id,
      label: `${kind === 'complete_form' ? 'Completar formulario' : kind === 'generate_document' ? 'Generar documento' : kind === 'create_document' ? 'Crear documento' : 'Recibir documento'} · ${item.title}`,
    });
    if (item.requiresReview)
      result.push({
        kind: 'review_document',
        refId: item.id,
        label: `Revisar documento · ${item.title}`,
      });
  }
  for (const verification of draft.verifications)
    result.push({
      kind: 'verify',
      refId: verification.id,
      label: `Ejecutar verificación · ${verification.title}`,
    });
  result.push(
    { kind: 'approve', refId: null, label: 'Aprobar expediente' },
    { kind: 'close', refId: null, label: 'Cerrar expediente' }
  );
  if (draft.experience.signAtClosure)
    result.push({ kind: 'sign', refId: null, label: 'Firmar cierre del expediente' });
  return result;
}

export function CaseWorkflowStep({
  draft,
  stages,
  validation,
  onChange,
}: {
  draft: CaseTemplateDraft;
  stages: CaseTemplateStage[];
  validation: WorkflowValidation;
  onChange: (mode: CaseTemplateDraft['workflowMode'], stages: CaseTemplateStage[]) => void;
}) {
  const custom = draft.workflowMode === 'custom';
  const options = availableActivities(draft);
  const update = (id: string, patch: Partial<CaseTemplateStage>) =>
    onChange(
      'custom',
      stages.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage))
    );
  const move = (index: number, delta: -1 | 1) => {
    const next = [...stages];
    const other = index + delta;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    onChange('custom', next);
  };
  const remove = (id: string) => {
    const dependents = stages.filter((stage) => stage.dependsOn?.includes(id));
    if (
      dependents.length &&
      !window.confirm(
        `Esta etapa tiene ${dependents.length} dependencias. Si la eliminas, esas relaciones también se quitarán. ¿Continuar?`
      )
    )
      return;
    onChange(
      'custom',
      stages
        .filter((stage) => stage.id !== id)
        .map((stage) => ({
          ...stage,
          dependsOn: (stage.dependsOn || []).filter((dependency) => dependency !== id),
        }))
    );
  };
  return (
    <div className="w-full overflow-y-auto px-4 py-6 lg:px-6">
      <div className="mx-auto max-w-[1100px] space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Etapas avanzadas</h2>
            <p className="mt-1 text-sm text-slate-500">
              Define cuándo se usa el contenido de los pasos anteriores. Las actividades referencian
              requisitos y verificaciones existentes.
            </p>
          </div>
          <div className="flex gap-2">
            {custom ? (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Se reemplazarán estas etapas: ${stages.map((stage) => stage.title).join(', ')}. Se aplicará la política de revisión y cierre actual, conservando el contenido y las firmas heredadas. ¿Continuar?`
                    )
                  )
                    onChange('recommended', suggestCaseWorkflow(draft));
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-primary"
              >
                Restaurar recomendado
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onChange(
                    'custom',
                    stages.map((stage) => ({
                      ...stage,
                      activities: [...(stage.activities || [])],
                      dependsOn: [...(stage.dependsOn || [])],
                    }))
                  )
                }
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-primary"
              >
                Personalizar flujo
              </button>
            )}
          </div>
        </div>
        <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900">
          {custom
            ? 'Modo personalizado: asigna actividades y dependencias explícitamente. Los cambios en Contenido no sobrescriben este flujo.'
            : `Flujo recomendado para ${draft.caseType || 'este expediente'}: se actualiza al cambiar Contenido o Verificaciones.`}
        </p>
        {(validation.errors.length > 0 || validation.warnings.length > 0) && (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"
            role="status"
          >
            <p className="font-semibold">Revisión del flujo</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {[...validation.errors, ...validation.warnings].map((issue, index) => (
                <li key={`${issue.code}-${issue.stageId || issue.itemId || index}`}>
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {stages.map((stage, index) => {
          const issues = validation.errors.filter((issue) => issue.stageId === stage.id);
          return (
            <details
              key={stage.id}
              className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card"
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 marker:hidden">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {stage.title || 'Etapa sin nombre'}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {stage.description || 'Sin descripción'} ·{' '}
                    {roleLabel[stage.coordinatorRole || 'owner']} · {stage.activities?.length || 0}{' '}
                    actividades · {stage.execution === 'parallel' ? 'Paralela' : 'Secuencial'}
                  </span>
                </span>
                {issues.length > 0 && (
                  <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                    Revisar {issues.length}
                  </span>
                )}
              </summary>
              <div className="space-y-4 border-t border-slate-100 p-4 dark:border-border">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium">
                    Nombre
                    <input
                      disabled={!custom}
                      value={stage.title}
                      onChange={(event) => update(stage.id, { title: event.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-xs font-medium">
                    Coordinador
                    <select
                      disabled={!custom}
                      value={stage.coordinatorRole || 'owner'}
                      onChange={(event) =>
                        update(stage.id, {
                          coordinatorRole: event.target
                            .value as CaseTemplateStage['coordinatorRole'],
                        })
                      }
                      className={inputClass}
                    >
                      {Object.entries(roleLabel).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium sm:col-span-2">
                    Descripción
                    <textarea
                      disabled={!custom}
                      rows={2}
                      value={stage.description}
                      onChange={(event) => update(stage.id, { description: event.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-xs font-medium">
                    Ejecución
                    <select
                      disabled={!custom}
                      value={stage.execution || 'sequential'}
                      onChange={(event) =>
                        update(stage.id, {
                          execution: event.target.value as CaseTemplateStage['execution'],
                        })
                      }
                      className={inputClass}
                    >
                      <option value="sequential">Secuencial</option>
                      <option value="parallel">En paralelo</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium">
                    Condición para completar
                    <select
                      disabled={!custom}
                      value={stage.completionMode || 'manual'}
                      onChange={(event) =>
                        update(stage.id, {
                          completionMode: event.target.value as CaseTemplateStage['completionMode'],
                        })
                      }
                      className={inputClass}
                    >
                      <option value="all_activities">Todas las actividades completadas</option>
                      <option value="manual">Confirmación manual autorizada</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium">
                    Plazo (días, opcional)
                    <input
                      disabled={!custom}
                      type="number"
                      min={1}
                      max={3650}
                      value={stage.deadlineDays ?? ''}
                      onChange={(event) =>
                        update(stage.id, {
                          deadlineDays: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                </div>
                <fieldset>
                  <legend className="text-xs font-semibold">Depende de</legend>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {stages
                      .filter((other) => other.id !== stage.id)
                      .map((other) => (
                        <label key={other.id} className="inline-flex items-center gap-1.5 text-xs">
                          <input
                            disabled={!custom}
                            type="checkbox"
                            checked={(stage.dependsOn || []).includes(other.id)}
                            onChange={(event) =>
                              update(stage.id, {
                                dependsOn: event.target.checked
                                  ? [...(stage.dependsOn || []), other.id]
                                  : (stage.dependsOn || []).filter((id) => id !== other.id),
                              })
                            }
                          />
                          {other.title}
                        </label>
                      ))}
                  </div>
                </fieldset>
                <div>
                  <h3 className="text-xs font-semibold">Actividades vinculadas</h3>
                  <ul className="mt-2 space-y-1">
                    {(stage.activities || []).map((activity) => {
                      const option = options.find(
                        (entry) => entry.kind === activity.kind && entry.refId === activity.refId
                      );
                      return (
                        <li
                          key={activity.id}
                          className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs dark:border-border"
                        >
                          <span>{option?.label || 'Referencia no disponible'}</span>
                          {custom && (
                            <button
                              type="button"
                              onClick={() =>
                                update(stage.id, {
                                  activities: (stage.activities || []).filter(
                                    (entry) => entry.id !== activity.id
                                  ),
                                })
                              }
                              aria-label={`Quitar actividad ${option?.label || ''}`}
                              className="text-red-600"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {custom && (
                    <select
                      aria-label={`Agregar actividad a ${stage.title}`}
                      defaultValue=""
                      onChange={(event) => {
                        const option = options[Number(event.target.value)];
                        if (!option) return;
                        if (
                          !(stage.activities || []).some(
                            (entry) => entry.kind === option.kind && entry.refId === option.refId
                          )
                        )
                          update(stage.id, {
                            activities: [
                              ...(stage.activities || []),
                              {
                                id: crypto.randomUUID(),
                                kind: option.kind,
                                refId: option.refId,
                                required: true,
                              },
                            ],
                          });
                        event.target.value = '';
                      }}
                      className={inputClass}
                    >
                      <option value="">Agregar actividad existente...</option>
                      {options.map((option, optionIndex) => (
                        <option key={`${option.kind}-${option.refId}`} value={optionIndex}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {custom && (
                  <div className="flex flex-wrap justify-end gap-1 border-t border-slate-100 pt-3 dark:border-border">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Subir ${stage.title}`}
                      className="rounded-md p-2 text-slate-500 disabled:opacity-40"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={index === stages.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Bajar ${stage.title}`}
                      className="rounded-md p-2 text-slate-500 disabled:opacity-40"
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChange('custom', [
                          ...stages.slice(0, index + 1),
                          {
                            ...stage,
                            id: crypto.randomUUID(),
                            title: `${stage.title} (copia)`,
                            activities: [],
                            dependsOn: [],
                          },
                          ...stages.slice(index + 1),
                        ])
                      }
                      aria-label={`Duplicar ${stage.title}`}
                      className="rounded-md p-2 text-slate-500"
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(stage.id)}
                      aria-label={`Eliminar ${stage.title}`}
                      className="rounded-md p-2 text-red-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            </details>
          );
        })}
        {custom && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            <label className="min-w-[220px] flex-1 text-xs font-medium">
              Agregar etapa
              <select id="new-case-stage-kind" className={inputClass}>
                {caseStageCatalog.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.title}
                  </option>
                ))}
                <option value="custom">Etapa personalizada</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                const select = document.getElementById(
                  'new-case-stage-kind'
                ) as HTMLSelectElement | null;
                const entry = newCaseTemplateStage(select?.value || 'custom');
                onChange('custom', [
                  ...stages,
                  { ...entry, dependsOn: stages.length ? [stages.at(-1)!.id] : [] },
                ]);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-white"
            >
              <Plus size={14} />
              Agregar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
