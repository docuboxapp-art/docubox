'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarClock,
  Eye,
  History,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import TaskRuleBuilder, {
  actionLabels,
  conditionLabels,
  resourceLabels,
  triggerLabels,
  type CustomRule,
} from './TaskRuleBuilder';

type SystemRule = {
  workspace_id: string;
  rule_key: string;
  enabled: boolean;
  threshold_days: number;
};
type RulePreview = {
  rule: CustomRule;
  total: number;
  disabled: boolean;
  examples: { id: string; title: string; status: string | null }[];
};
type RuleExecution = {
  id: string;
  target_type: string;
  target_id: string;
  target_name: string | null;
  action_kind: CustomRule['action_kind'];
  occurred_at: string;
};

const systemCatalog: Record<string, { label: string; description: string; days: string }> = {
  draft_stale: {
    label: 'Borradores sin actividad',
    description: 'Crea una acción para continuar un documento que sigue en borrador.',
    days: 'Días sin cambios',
  },
  document_due: {
    label: 'Documentos por vencer',
    description: 'Advierte cuando se acerca la fecha límite de un documento en curso.',
    days: 'Días de anticipación',
  },
  form_invite_pending: {
    label: 'Invitaciones de formulario pendientes',
    description: 'Da seguimiento a invitaciones sin respuesta de usuarios registrados.',
    days: 'Días sin respuesta',
  },
  case_due: {
    label: 'Expedientes por vencer',
    description: 'Da seguimiento a expedientes abiertos próximos a su fecha objetivo.',
    days: 'Días de anticipación',
  },
  missing_anexo: {
    label: 'Anexos requeridos',
    description: 'Crea una acción cuando falta un requisito documental obligatorio.',
    days: 'Días para resolver',
  },
  template_draft_stale: {
    label: 'Borradores de plantillas',
    description: 'Retoma plantillas que siguen sin publicar.',
    days: 'Días sin cambios',
  },
  form_draft_stale: {
    label: 'Borradores de formularios',
    description: 'Retoma formularios que siguen sin publicar.',
    days: 'Días sin cambios',
  },
  identity_pending: {
    label: 'Identidad pendiente',
    description: 'Solicita completar la biometría tras verificar el correo.',
    days: 'Días desde registro',
  },
  form_signing_stale: {
    label: 'Firma de formulario pendiente',
    description:
      'Crea un seguimiento para el creador cuando una respuesta permanece en proceso de firma; se cierra al resolverse.',
    days: 'Días sin firma',
  },
  document_signing_stale: {
    label: 'Firma de documento sin avance',
    description: 'Da seguimiento a documentos en proceso sin actividad reciente.',
    days: 'Días sin cambios',
  },
  case_inactive: {
    label: 'Expediente sin avance',
    description: 'Recuerda al responsable retomar un expediente abierto sin cambios.',
    days: 'Días sin cambios',
  },
  identity_phone_pending: {
    label: 'Teléfono por verificar',
    description: 'Pide validar el teléfono registrado cuando el correo ya está verificado.',
    days: 'Días desde registro',
  },
  nom151_failed: {
    label: 'Certificación NOM-151 fallida',
    description:
      'Crea una acción cuando falla el intento más reciente de certificación; se cierra al resolverse.',
    days: 'Días desde el fallo',
  },
};

const taskTypes = [
  ['revisar_documento', 'Revisar documento'],
  ['aprobar_documento', 'Aprobar documento'],
  ['firmar_documento', 'Firmar documento'],
  ['subir_anexo', 'Completar anexo'],
  ['validar_identidad', 'Validar identidad'],
  ['retomar_borrador', 'Retomar borrador'],
  ['revisar_vencimiento', 'Revisar vencimiento'],
  ['responder_formulario', 'Responder formulario'],
  ['seguimiento_formulario', 'Seguimiento de formulario'],
  ['revisar_expediente', 'Revisar expediente'],
];

export default function TaskAutomationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const canManage = Boolean(activeWorkspace && ['owner', 'admin'].includes(activeWorkspace.role));
  const [systemRules, setSystemRules] = useState<SystemRule[]>([]);
  const [customRules, setCustomRules] = useState<CustomRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [builder, setBuilder] = useState(false);
  const [editingRule, setEditingRule] = useState<CustomRule | null>(null);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [historyRule, setHistoryRule] = useState<CustomRule | null>(null);
  const [executions, setExecutions] = useState<RuleExecution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [system, custom] = await Promise.all([
      supabase
        .from('task_system_rules')
        .select('workspace_id,rule_key,enabled,threshold_days')
        .eq('workspace_id', workspaceId)
        .order('rule_key'),
      supabase
        .from('task_custom_rules')
        .select(
          'id,name,enabled,trigger_kind,action_kind,additional_action_kinds,workflow_stages,lead_days,task_type,work_kind,priority_filter,status_filter,origin_filter,source_filter,target_kind,condition_kind,entity_status_filter,generated_task_type,generated_priority'
        )
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false }),
    ]);
    if (system.error || custom.error)
      setError(
        system.error?.message || custom.error?.message || 'No se pudieron cargar las reglas.'
      );
    else {
      setError('');
      setSystemRules(system.data || []);
      setCustomRules(custom.data || []);
    }
    setLoading(false);
  }, [workspaceId, supabase]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const updateSystem = async (rule: SystemRule, patch: Partial<SystemRule>) => {
    if (!workspaceId || !canManage) return;
    const { error: updateError } = await supabase
      .from('task_system_rules')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('rule_key', rule.rule_key);
    if (updateError) setError(updateError.message);
    else void load();
  };
  const updateCustom = async (rule: CustomRule, enabled: boolean) => {
    const { error: updateError } = await supabase
      .from('task_custom_rules')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('id', rule.id);
    if (updateError) setError(updateError.message);
    else void load();
  };
  const removeCustom = async (rule: CustomRule) => {
    if (!window.confirm(`¿Eliminar la automatización “${rule.name}”?`)) return;
    const { error: deleteError } = await supabase
      .from('task_custom_rules')
      .delete()
      .eq('id', rule.id);
    if (deleteError) setError(deleteError.message);
    else void load();
  };
  const previewCustom = async (rule: CustomRule) => {
    setPreviewLoading(true);
    setError('');
    const result = await supabase.rpc('preview_task_custom_rule', { p_rule_id: rule.id });
    setPreviewLoading(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const value = result.data as {
      total?: number;
      disabled?: boolean;
      examples?: RulePreview['examples'];
    } | null;
    setPreview({
      rule,
      total: Number(value?.total || 0),
      disabled: Boolean(value?.disabled),
      examples: value?.examples || [],
    });
  };
  const showHistory = async (rule: CustomRule) => {
    if (!workspaceId) return;
    setHistoryRule(rule);
    setHistoryLoading(true);
    setHistoryError('');
    const result = await supabase
      .from('task_rule_executions')
      .select('id,target_type,target_id,target_name,action_kind,occurred_at')
      .eq('workspace_id', workspaceId)
      .eq('rule_id', rule.id)
      .order('occurred_at', { ascending: false })
      .limit(50);
    setHistoryLoading(false);
    if (result.error) {
      setHistoryError(result.error.message);
      setExecutions([]);
      return;
    }
    setExecutions((result.data || []) as RuleExecution[]);
  };

  return (
    <AppLayout noPadding>
      <main className="min-h-screen bg-[#f6f8fb] px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link
                href="/mis-tareas"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white"
                aria-label="Volver a tareas"
              >
                <ArrowLeft size={17} />
              </Link>
              <div>
                <h1 className="text-2xl font-semibold text-slate-950">
                  Automatizaciones de tareas
                </h1>
                <p className="text-sm text-slate-500">
                  Reglas del sistema y flujos configurados para este espacio de trabajo.
                </p>
              </div>
            </div>
            {canManage && (
              <button
                onClick={() => {
                  setEditingRule(null);
                  setBuilder(true);
                }}
                className="flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white"
              >
                <Plus size={16} />
                Nueva automatización
              </button>
            )}
          </header>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          {loading ? (
            <p className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
              Cargando reglas…
            </p>
          ) : (
            <>
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="flex items-center gap-2 font-semibold text-slate-950">
                    <ShieldCheck size={18} className="text-blue-600" />
                    Reglas del sistema
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Se revisan cada 30 minutos. Al resolverse la condición, la acción se cierra con
                    una nota automática.
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {systemRules.map((rule) => {
                    const info = systemCatalog[rule.rule_key];
                    if (!info) return null;
                    return (
                      <div
                        key={rule.rule_key}
                        className="flex flex-wrap items-center gap-4 px-5 py-4"
                      >
                        <div className="min-w-56 flex-1">
                          <p className="text-sm font-semibold text-slate-900">{info.label}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{info.description}</p>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-600">
                          {info.days}
                          <input
                            aria-label={info.days + ' para ' + info.label}
                            type="number"
                            min={1}
                            max={90}
                            defaultValue={rule.threshold_days}
                            disabled={!canManage}
                            onBlur={(event) => {
                              const value = Number(event.target.value);
                              if (value >= 1 && value <= 90 && value !== rule.threshold_days)
                                void updateSystem(rule, { threshold_days: value });
                            }}
                            className="h-9 w-16 rounded-md border border-slate-200 px-2 text-center text-sm"
                          />
                        </label>
                        <button
                          role="switch"
                          aria-checked={rule.enabled}
                          aria-label={`${rule.enabled ? 'Desactivar' : 'Activar'} ${info.label}`}
                          disabled={!canManage}
                          onClick={() => updateSystem(rule, { enabled: !rule.enabled })}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${rule.enabled ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}
                        >
                          {rule.enabled ? 'Activa' : 'Inactiva'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="flex items-center gap-2 font-semibold text-slate-950">
                    <CalendarClock size={18} className="text-blue-600" />
                    Flujos personalizados
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Define condiciones, acciones iniciales y decisiones con ramas sobre tareas o
                    recursos reales.
                  </p>
                </div>
                {customRules.length === 0 ? (
                  <p className="px-5 py-8 text-sm text-slate-500">
                    Aún no hay flujos personalizados.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {customRules.map((rule) => (
                      <div key={rule.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                        <div className="min-w-56 flex-1">
                          <p className="text-sm font-semibold text-slate-900">{rule.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {resourceLabels[rule.target_kind]} ·{' '}
                            {rule.target_kind === 'task'
                              ? triggerLabels[rule.trigger_kind]
                              : conditionLabels[rule.condition_kind]}
                            {rule.target_kind === 'task'
                              ? ` · ${rule.work_kind || 'Acciones y actividades'} · ${rule.task_type ? taskTypes.find((type) => type[0] === rule.task_type)?.[1] || rule.task_type : 'Todos los tipos'}`
                              : rule.entity_status_filter
                                ? ` · ${rule.entity_status_filter}`
                                : ''}{' '}
                            →{' '}
                            {[rule.action_kind, ...(rule.additional_action_kinds || [])]
                              .map((value) => actionLabels[value])
                              .join(' + ')}
                            {rule.workflow_stages?.length
                              ? ` · ${rule.workflow_stages.length} ${rule.workflow_stages.length === 1 ? 'decisión' : 'decisiones'}`
                              : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => void previewCustom(rule)}
                          disabled={previewLoading}
                          aria-label={`Probar ${rule.name}`}
                          className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Eye size={16} />
                          Probar
                        </button>
                        <button
                          onClick={() => void showHistory(rule)}
                          aria-label={`Historial de ${rule.name}`}
                          className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50"
                        >
                          <History size={16} />
                          Historial
                        </button>
                        {canManage && (
                          <>
                            <button
                              role="switch"
                              aria-checked={rule.enabled}
                              onClick={() => updateCustom(rule, !rule.enabled)}
                              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${rule.enabled ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}
                            >
                              {rule.enabled ? 'Activa' : 'Inactiva'}
                            </button>
                            <button
                              onClick={() => {
                                setEditingRule(rule);
                                setBuilder(true);
                              }}
                              aria-label={`Editar ${rule.name}`}
                              className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => removeCustom(rule)}
                              aria-label={`Eliminar ${rule.name}`}
                              className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
        {builder && workspaceId && user?.id && (
          <TaskRuleBuilder
            workspaceId={workspaceId}
            userId={user.id}
            existing={editingRule}
            onClose={() => setBuilder(false)}
            onSaved={() => {
              setBuilder(false);
              void load();
            }}
          />
        )}
        {preview && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Prueba de ${preview.rule.name}`}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4"
          >
            <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    Prueba: {preview.rule.name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Consulta de solo lectura; no ejecuta acciones ni envía avisos.
                  </p>
                </div>
                <button
                  onClick={() => setPreview(null)}
                  aria-label="Cerrar prueba"
                  className="rounded-md border border-slate-200 p-2"
                >
                  <X size={17} />
                </button>
              </div>
              <p className="mt-5 rounded-lg bg-blue-50 p-4 text-sm text-blue-900">
                {preview.disabled
                  ? 'La regla está inactiva. Actívala para consultar sus coincidencias.'
                  : `${preview.total} ${preview.total === 1 ? 'recurso coincide' : 'recursos coinciden'} ahora con esta regla.`}
              </p>
              {!preview.disabled && preview.examples.length > 0 && (
                <div className="mt-4 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {preview.examples.map((example) => (
                    <div
                      key={example.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                    >
                      <span className="min-w-0 truncate text-slate-800">{example.title}</span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {example.status || 'Sin estado'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {preview.total > preview.examples.length && (
                <p className="mt-2 text-xs text-slate-500">
                  Se muestran las primeras {preview.examples.length} coincidencias.
                </p>
              )}
            </div>
          </div>
        )}
        {historyRule && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Historial de ${historyRule.name}`}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4"
          >
            <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    Historial: {historyRule.name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Acciones realmente ejecutadas; se muestran las 50 más recientes.
                  </p>
                </div>
                <button
                  onClick={() => setHistoryRule(null)}
                  aria-label="Cerrar historial"
                  className="rounded-md border border-slate-200 p-2"
                >
                  <X size={17} />
                </button>
              </div>
              {historyLoading ? (
                <p className="mt-6 text-sm text-slate-500">Cargando historial…</p>
              ) : historyError ? (
                <p
                  role="alert"
                  className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
                >
                  {historyError}
                </p>
              ) : executions.length === 0 ? (
                <p className="mt-6 rounded-lg border border-dashed border-slate-200 p-6 text-sm text-slate-500">
                  Esta regla aún no ha ejecutado acciones.
                </p>
              ) : (
                <div className="mt-5 max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {executions.map((execution) => (
                    <div
                      key={execution.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-medium text-slate-900">
                          {actionLabels[execution.action_kind]}
                        </p>
                        <p className="text-xs text-slate-500">
                          {execution.target_name ||
                            `${resourceLabels[execution.target_type as CustomRule['target_kind']] || execution.target_type} · ${execution.target_id.slice(0, 8)}`}
                        </p>
                      </div>
                      <time className="text-xs text-slate-500" dateTime={execution.occurred_at}>
                        {new Date(execution.occurred_at).toLocaleString('es-MX')}
                      </time>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </AppLayout>
  );
}
