'use client';

import {
  FileSearch,
  UserRoundCheck,
  PenLine,
  Flag,
  Info,
  Settings2,
  Circle,
  ShieldCheck,
} from 'lucide-react';
import type { CaseTemplateDraft } from '@/lib/case-files/template-builder';
import {
  CASE_CONTROL_ROLES,
  defaultReviewPolicy,
  reviewClosureConditions,
  reviewPolicyIssues,
  reviewPolicySources,
  type CaseReviewPolicy,
} from '@/lib/case-files/review-policy';
import { resolvedCaseWorkflow, validateCaseWorkflow } from '@/lib/case-files/workflow';
import { ExperienceOption } from '@/components/forms/ExperienceOption';
import { CaseWorkflowStep } from './CaseWorkflowStep';

const card =
  'rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-border dark:bg-card sm:p-5';
const input =
  'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-border dark:bg-background';
function RolePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: 'owner' | 'admin' | 'member' | null) => void;
}) {
  return (
    <label className="block text-xs font-medium">
      {label}
      <select
        className={input}
        value={value || ''}
        onChange={(event) => onChange((event.target.value as 'owner' | 'admin' | 'member') || null)}
      >
        <option value="">Seleccionar rol…</option>
        {Object.entries(CASE_CONTROL_ROLES).map(([key, text]) => (
          <option value={key} key={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export function CaseReviewCloseStep({
  draft,
  onChange,
  onEditContent,
  onEditGeneral,
}: {
  draft: CaseTemplateDraft;
  onChange: (value: CaseTemplateDraft) => void;
  onEditContent: (id: string) => void;
  onEditGeneral: () => void;
}) {
  const policy = draft.reviewPolicy;
  const source = reviewPolicySources(draft);
  const issues = reviewPolicyIssues(draft);
  const advanced = draft.workflowMode === 'custom';
  const stages = resolvedCaseWorkflow(draft);
  const update = (patch: Partial<CaseReviewPolicy>) =>
    onChange({
      ...draft,
      reviewPolicy: {
        ...policy,
        ...patch,
        origin: 'user',
        decisionOrigins: {
          ...policy.decisionOrigins,
          ...(patch.reviewTiming ? { reviewTiming: 'user' as const } : {}),
          ...(patch.approval ? { approval: 'user' as const } : {}),
          ...(patch.completion ? { completion: 'user' as const } : {}),
        },
      },
    });
  const status = (
    hasIssue: boolean,
    inherited = false,
    decision: 'reviewTiming' | 'approval' | 'completion' = 'reviewTiming'
  ) => (
    <span
      className={
        'shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ' +
        (hasIssue
          ? 'bg-amber-50 text-amber-800'
          : 'bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground')
      }
    >
      {hasIssue
        ? 'Requiere atención'
        : inherited
          ? 'Heredado'
          : policy.decisionOrigins[decision] === 'legacy'
            ? 'Heredado'
            : policy.decisionOrigins[decision] === 'default'
              ? 'Predeterminado'
              : 'Configurado'}
    </span>
  );
  const signatureTiming = policy.approval.enabled
    ? 'Después de la aprobación final'
    : 'Después de los controles previos obligatorios';
  const summary = advanced
    ? stages.map((stage) => ({
        title: stage.title,
        text: `${stage.description || 'Etapa heredada.'} ${stage.dependsOn?.length ? 'Con dependencias configuradas.' : 'Sin dependencia de otra etapa.'}`,
      }))
    : [
        { title: 'Recopilación', text: 'Se recibirán las aportaciones y formularios aplicables.' },
        ...(source.reviewed.length
          ? [
              {
                title: 'Revisión',
                text:
                  policy.reviewTiming === 'progressive'
                    ? 'Cada entrega habilitará su revisión de forma independiente.'
                    : 'Comenzará al reunir las aportaciones iniciales obligatorias.',
              },
            ]
          : []),
        ...(source.verifications.length
          ? [
              {
                title: 'Verificaciones',
                text: `${source.verifications.length} controles configurados. Podrán ejecutarse en paralelo cuando sus fuentes lo permitan.`,
              },
            ]
          : []),
        {
          title: 'Aprobación',
          text: policy.approval.enabled
            ? `Autorizará: ${policy.approval.role ? CASE_CONTROL_ROLES[policy.approval.role] : 'rol pendiente de asignar'}.`
            : 'No requiere aprobación final.',
        },
        ...(source.signatureRequired ? [{ title: 'Firma', text: signatureTiming + '.' }] : []),
        {
          title: 'Cierre',
          text:
            policy.completion.mode === 'manual'
              ? 'Al cumplir las condiciones quedará listo para confirmación autorizada.'
              : 'Se solicitará el cierre automático al cumplir todas las condiciones.',
        },
      ];
  return (
    <div className="w-full overflow-y-auto p-4 lg:p-6">
      <div className="mx-auto grid max-w-[1480px] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm dark:border-blue-900 dark:bg-blue-950/30">
            <Info size={19} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">Configuración basada en tu contenido</h2>
              <p className="mt-1 text-xs text-slate-600 dark:text-muted-foreground">
                {source.requested.length} requisitos, {source.forms.length} formularios,{' '}
                {source.generated.length} documentos de trabajo o desde plantilla y{' '}
                {source.verifications.length} verificaciones. Estos conteos describen la plantilla.
              </p>
            </div>
          </div>
          {advanced && (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
              role="status"
            >
              <p className="font-semibold">Flujo avanzado conservado</p>
              <p className="mt-1 text-xs">
                Las etapas existentes se mantienen como representación operativa. Las decisiones
                sencillas se muestran como referencia y no sustituyen sus reglas.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                {source.reviewed.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="text-xs font-medium text-primary underline"
                    onClick={() => onEditContent(item.id)}
                  >
                    Editar en Contenido: {item.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          <fieldset disabled={advanced} className="min-w-0 space-y-4 disabled:opacity-80">
            <section className={card}>
              <div className="flex items-start gap-3">
                <FileSearch size={21} className="shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">1. Revisión de información</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Define cuándo estarán disponibles las revisiones requeridas en Contenido.
                  </p>
                </div>
                {status(issues.some((issue) => issue.code === 'reviewer_missing'))}
              </div>
              {source.reviewed.length ? (
                <>
                  <div className="mt-4 space-y-3 rounded-lg border border-slate-200 p-3 dark:border-border">
                    {[
                      {
                        id: 'progressive',
                        title: 'Conforme se recibe',
                        text: 'Cada entrega válida habilita su revisión. Las observaciones de un elemento no bloquean los demás.',
                      },
                      {
                        id: 'after_collection',
                        title: 'Cuando se reúna toda la información obligatoria',
                        text: 'Espera las aportaciones iniciales aplicables; no exige documentos generados como resultado posterior.',
                      },
                    ].map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-start gap-2 text-sm"
                      >
                        <input
                          type="radio"
                          name="case-review-timing"
                          checked={policy.reviewTiming === option.id}
                          onChange={() =>
                            update({ reviewTiming: option.id as CaseReviewPolicy['reviewTiming'] })
                          }
                          className="mt-1 accent-primary"
                        />
                        <span>
                          <span className="font-medium">{option.title}</span>
                          {option.id === 'progressive' && (
                            <span className="ml-2 text-[11px] text-primary">Recomendada</span>
                          )}
                          <span className="mt-1 block text-xs text-slate-500">{option.text}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <ul className="mt-3 space-y-2 text-xs">
                    {source.reviewed.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          {item.title} ·{' '}
                          {item.reviewerRole
                            ? CASE_CONTROL_ROLES[item.reviewerRole]
                            : 'Revisor pendiente'}
                        </span>
                        <button
                          type="button"
                          onClick={() => onEditContent(item.id)}
                          className="font-medium text-primary hover:underline"
                        >
                          Editar en Contenido
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  Esta plantilla no requiere revisión documental. Las entregas se registrarán como
                  recibidas, no como aprobadas.
                </p>
              )}
            </section>
            <section className={card}>
              <div className="flex items-start gap-3">
                <UserRoundCheck size={21} className="shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">2. Aprobación final del expediente</h3>
                  <ExperienceOption
                    title="Solicitar autorización final"
                    checked={policy.approval.enabled}
                    onChange={(enabled) => update({ approval: { ...policy.approval, enabled } })}
                  />
                </div>
                {status(policy.approval.enabled && !policy.approval.role, false, 'approval')}
              </div>
              {policy.approval.enabled && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <RolePicker
                    label="Quién aprueba"
                    value={policy.approval.role}
                    onChange={(role) => update({ approval: { ...policy.approval, role } })}
                  />
                  <div className="text-xs">
                    <p className="font-medium">Cuándo se solicita</p>
                    <p className="mt-2 text-slate-500">
                      Después de la recopilación, las revisiones y las verificaciones previas
                      obligatorias.
                    </p>
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">
                El rol se resolverá a una persona autorizada al abrir el expediente. La
                autoaprobación no constituye una revisión independiente.
              </p>
            </section>
            {source.signatureRequired && (
              <section className={card}>
                <div className="flex items-start gap-3">
                  <PenLine size={21} className="shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">3. Firma de documentos</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Obligación heredada de la configuración de firma.
                    </p>
                  </div>
                  {status(!source.signatures.length, true)}
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  {source.signatures.length ? (
                    source.signatures.map((item) => (
                      <p key={item.id}>
                        {item.title}{' '}
                        <button
                          type="button"
                          className="ml-2 text-xs text-primary hover:underline"
                          onClick={() => onEditContent(item.id)}
                        >
                          Ver origen
                        </button>
                      </p>
                    ))
                  ) : (
                    <p className="text-amber-800">
                      La firma de cierre requiere vincular documento, versión, firmantes y método en
                      su origen.{' '}
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={onEditGeneral}
                      >
                        Revisar configuración
                      </button>
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    Momento: {signatureTiming}. El envío no equivale a una firma completada.
                  </p>
                </div>
              </section>
            )}
            <section className={card}>
              <div className="flex items-start gap-3">
                <Flag size={21} className="shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">
                    {source.signatureRequired ? '4' : '3'}. Finalización del expediente
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Todas las condiciones se comprobarán antes de completar el expediente.
                  </p>
                </div>
                {status(
                  policy.completion.mode === 'manual' && !policy.completion.role,
                  false,
                  'completion'
                )}
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  {[
                    { id: 'automatic', title: 'Automáticamente al cumplir las condiciones' },
                    { id: 'manual', title: 'Mediante confirmación de un responsable' },
                  ].map((option) => (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-start gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name="case-completion-mode"
                        checked={policy.completion.mode === option.id}
                        onChange={() =>
                          update({
                            completion: {
                              ...policy.completion,
                              mode: option.id as 'automatic' | 'manual',
                            },
                          })
                        }
                        className="mt-1 accent-primary"
                      />
                      <span>{option.title}</span>
                    </label>
                  ))}
                  {policy.completion.mode === 'manual' && (
                    <RolePicker
                      label="Quién confirma el cierre"
                      value={policy.completion.role}
                      onChange={(role) => update({ completion: { ...policy.completion, role } })}
                    />
                  )}
                </div>
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-muted/30">
                  <p className="text-xs font-semibold">Condiciones previstas de cierre</p>
                  <ul className="mt-2 space-y-2">
                    {reviewClosureConditions(draft).map((text) => (
                      <li
                        key={text}
                        className="flex items-start gap-2 text-xs text-slate-600 dark:text-muted-foreground"
                      >
                        <Circle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          </fieldset>
          {issues.length > 0 && (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"
            >
              <p className="font-semibold">Antes de publicar</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {issues.map((issue) => (
                  <li key={issue.code + (issue.itemId || '')}>{issue.message}</li>
                ))}
              </ul>
              <p className="mt-2">Puedes guardar el borrador y continuar completándolo.</p>
            </div>
          )}
          <details className="rounded-xl border border-slate-200 bg-white dark:border-border dark:bg-card">
            <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-semibold">
              <Settings2 size={17} aria-hidden="true" />
              Configuración avanzada
              <span className="ml-auto text-xs font-normal text-slate-500">
                Etapas y dependencias existentes
              </span>
            </summary>
            <div className="border-t border-slate-100 dark:border-border">
              <p className="px-4 pt-4 text-xs text-slate-500">
                Los plazos se conservan en sus fuentes. Las notificaciones automáticas y la
                ejecución de transiciones requieren integración de servidor; no se envían desde esta
                pantalla.
              </p>
              <CaseWorkflowStep
                draft={draft}
                stages={stages}
                validation={validateCaseWorkflow(draft, stages)}
                onChange={(workflowMode, stages) =>
                  onChange({
                    ...draft,
                    workflowMode,
                    stages,
                    reviewPolicy: {
                      ...policy,
                      compatibility: workflowMode === 'custom' ? 'advanced' : 'simple',
                    },
                  })
                }
              />
            </div>
          </details>
          {!advanced && policy.origin === 'user' && (
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => {
                if (
                  window.confirm(
                    'Se restaurará revisión conforme se recibe, se desactivará la aprobación final opcional y se propondrá cierre automático. El contenido y las firmas heredadas se conservarán. ¿Continuar?'
                  )
                )
                  onChange({ ...draft, reviewPolicy: defaultReviewPolicy() });
              }}
            >
              Usar configuración recomendada
            </button>
          )}
        </div>
        <aside className={card + ' xl:sticky xl:top-0'}>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck size={19} className="text-primary" aria-hidden="true" />
            Así funcionará este expediente
          </h2>
          <ol className="mt-5 space-y-4">
            {summary.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-primary">
                  <Circle size={13} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-border">
            Esta es una configuración de la plantilla. No representa entregas recibidas, revisiones
            realizadas ni firmas completadas.
            {advanced ? ' El flujo avanzado conserva sus dependencias originales.' : ''}
          </p>
        </aside>
      </div>
    </div>
  );
}
