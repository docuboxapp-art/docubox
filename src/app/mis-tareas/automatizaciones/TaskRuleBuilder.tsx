'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, Check, ListChecks, ShieldCheck, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export type CustomRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger_kind: 'due_soon' | 'overdue' | 'created' | 'inactive' | 'resource_condition';
  action_kind: 'notify_assignee' | 'raise_priority' | 'create_followup';
  additional_action_kinds: Array<'notify_assignee' | 'raise_priority' | 'create_followup'>;
  lead_days: number;
  task_type: string | null;
  work_kind: string | null;
  priority_filter: string | null;
  status_filter: string | null;
  origin_filter: string | null;
  source_filter: string | null;
  target_kind:
    'task' | 'document' | 'form_template' | 'template' | 'case_file' | 'form_response' | 'user';
  condition_kind: 'created' | 'inactive' | 'due_soon' | 'overdue' | 'status';
  entity_status_filter: string | null;
  generated_task_type: string;
  generated_priority: 'critica' | 'alta' | 'media' | 'baja';
};
type Form = Omit<CustomRule, 'id' | 'enabled'>;
const defaults: Form = {
  name: '',
  trigger_kind: 'due_soon',
  action_kind: 'notify_assignee',
  additional_action_kinds: [],
  lead_days: 2,
  task_type: null,
  work_kind: null,
  priority_filter: null,
  status_filter: null,
  origin_filter: null,
  source_filter: null,
  target_kind: 'task',
  condition_kind: 'inactive',
  entity_status_filter: null,
  generated_task_type: 'revisar_documento',
  generated_priority: 'media',
};
export const resourceLabels: Record<CustomRule['target_kind'], string> = {
  task: 'Tareas existentes',
  document: 'Documentos',
  form_template: 'Formularios',
  template: 'Plantillas',
  case_file: 'Expedientes',
  form_response: 'Respuestas de formulario',
  user: 'Usuarios y validación',
};
export const conditionLabels: Record<CustomRule['condition_kind'], string> = {
  created: 'Recurso nuevo',
  inactive: 'Sin cambios recientes',
  due_soon: 'Fecha límite cercana',
  overdue: 'Fecha límite vencida',
  status: 'Estado específico',
};
const resourceTypes: Record<Exclude<CustomRule['target_kind'], 'task'>, string[]> = {
  document: [
    'revisar_documento',
    'aprobar_documento',
    'firmar_documento',
    'subir_anexo',
    'revisar_vencimiento',
  ],
  form_template: ['seguimiento_formulario', 'revisar_documento', 'aprobar_documento'],
  template: ['revisar_documento', 'aprobar_documento'],
  case_file: ['revisar_expediente', 'cerrar_expediente', 'subir_anexo'],
  form_response: ['revisar_documento', 'aprobar_documento', 'corregir_datos'],
  user: ['validar_identidad'],
};
const resourceStatuses: Record<Exclude<CustomRule['target_kind'], 'task'>, string[]> = {
  document: ['borrador', 'en_proceso', 'completado', 'rechazado'],
  form_template: ['draft', 'in_review', 'published', 'paused', 'closed', 'archived'],
  template: ['draft', 'published', 'archived'],
  case_file: ['draft', 'open', 'in_progress', 'closed'],
  form_response: ['draft', 'submitted', 'signing', 'signed'],
  user: ['correo pendiente', 'identidad pendiente', 'validado'],
};
const typeOptions = [
  ['firmar_documento', 'Firmar documento'],
  ['revisar_documento', 'Revisar documento'],
  ['aprobar_documento', 'Aprobar documento'],
  ['subir_anexo', 'Completar anexo'],
  ['validar_identidad', 'Validar identidad'],
  ['retomar_borrador', 'Retomar borrador'],
  ['revisar_vencimiento', 'Revisar vencimiento'],
  ['responder_formulario', 'Responder formulario'],
  ['seguimiento_formulario', 'Seguimiento de formulario'],
  ['revisar_expediente', 'Revisar expediente'],
  ['resolver_comentario', 'Resolver comentario'],
  ['corregir_datos', 'Corregir datos'],
];
export const triggerLabels: Record<CustomRule['trigger_kind'], string> = {
  due_soon: 'Fecha límite cercana',
  overdue: 'Tarea vencida',
  created: 'Tarea creada',
  inactive: 'Sin cambios recientes',
  resource_condition: 'Condición de recurso',
};
export const actionLabels: Record<CustomRule['action_kind'], string> = {
  notify_assignee: 'Notificar al responsable',
  raise_priority: 'Elevar prioridad',
  create_followup: 'Crear seguimiento',
};

export default function TaskRuleBuilder({
  workspaceId,
  userId,
  existing,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  userId: string;
  existing: CustomRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(() =>
    existing
      ? {
          name: existing.name,
          trigger_kind: existing.trigger_kind,
          action_kind: existing.action_kind,
          additional_action_kinds: existing.additional_action_kinds || [],
          lead_days: existing.lead_days,
          task_type: existing.task_type,
          work_kind: existing.work_kind,
          priority_filter: existing.priority_filter,
          status_filter: existing.status_filter,
          origin_filter: existing.origin_filter,
          source_filter: existing.source_filter,
          target_kind: existing.target_kind,
          condition_kind: existing.condition_kind,
          entity_status_filter: existing.entity_status_filter,
          generated_task_type: existing.generated_task_type,
          generated_priority: existing.generated_priority,
        }
      : { ...defaults }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fieldClass = 'mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';
  const isResource = form.target_kind !== 'task';
  const selectedResource = isResource
    ? (form.target_kind as Exclude<CustomRule['target_kind'], 'task'>)
    : null;
  const update = (patch: Partial<Form>) => setForm((value) => ({ ...value, ...patch }));
  const save = async () => {
    if (
      form.name.trim().length < 3 ||
      form.lead_days < 1 ||
      form.lead_days > 30 ||
      (isResource && form.condition_kind === 'status' && !form.entity_status_filter)
    )
      return;
    setSaving(true);
    setError('');
    const selectedActions = [form.action_kind, ...form.additional_action_kinds];
    const primaryAction = selectedActions.length > 1 && form.action_kind === 'raise_priority'
      ? selectedActions.find(value => value !== 'raise_priority')! : form.action_kind;
    const payload = {
      ...form,
      name: form.name.trim(),
      updated_at: new Date().toISOString(),
      trigger_kind: isResource ? 'resource_condition' : form.trigger_kind,
      action_kind: isResource && primaryAction === 'raise_priority' ? 'create_followup' : primaryAction,
      additional_action_kinds: selectedActions.filter(value =>
        value !== primaryAction && (!isResource || value !== 'raise_priority')),
      entity_status_filter: isResource ? form.entity_status_filter : null,
      task_type: isResource ? null : form.task_type,
      work_kind: isResource ? null : form.work_kind,
      priority_filter: isResource ? null : form.priority_filter,
      status_filter: isResource ? null : form.status_filter,
      origin_filter: isResource ? null : form.origin_filter,
      source_filter: isResource ? null : form.source_filter,
    };
    const result = existing
      ? await supabase
          .from('task_custom_rules')
          .update(payload)
          .eq('id', existing.id)
          .eq('workspace_id', workspaceId)
      : await supabase
          .from('task_custom_rules')
          .insert({ ...payload, workspace_id: workspaceId, created_by: userId });
    setSaving(false);
    if (result.error) {
      setError(result.error.code === '23505'
        ? 'Ya existe una automatización con ese nombre en este espacio.'
        : result.error.message);
      return;
    }
    onSaved();
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={existing ? 'Editar automatización' : 'Nueva automatización'}
      className="fixed inset-0 z-[80] overflow-y-auto bg-[#f6f8fb]"
    >
      <div className="mx-auto min-h-screen max-w-4xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">
              {existing ? 'Editar' : 'Nueva'} automatización
            </h2>
            <p className="text-sm text-slate-500">Condición → filtros → acción</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"
          >
            <X size={16} />
            Cerrar
          </button>
        </header>
        <div className="space-y-6 p-6">
          <div className="flex gap-2">
            {['Condición', 'Filtros', 'Acción'].map((label, index) => (
              <span
                key={label}
                className={`rounded-full px-3 py-1 text-xs ${step === index ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {index + 1}. {label}
              </span>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {step === 0 && (
            <>
              <h3 className="font-semibold">¿Cuándo debe ejecutarse?</h3>
              <label className="block text-sm">
                Nombre del flujo
                <input
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder="Ej. Recordar revisiones inactivas"
                  className={fieldClass}
                />
              </label>
              <label className="block text-sm">
                Aplicar a
                <select
                  value={form.target_kind}
                  className={fieldClass}
                  onChange={(e) => {
                    const target_kind = e.target.value as Form['target_kind'];
                    update({
                      target_kind,
                      trigger_kind: target_kind === 'task' ? 'due_soon' : 'resource_condition',
                      condition_kind: 'inactive',
                      entity_status_filter: null,
                      action_kind: target_kind === 'task' ? 'notify_assignee' : 'create_followup',
                      additional_action_kinds: [],
                      generated_task_type:
                        target_kind === 'task'
                          ? 'revisar_documento'
                          : resourceTypes[target_kind][0],
                    });
                  }}
                >
                  {Object.entries(resourceLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Condición
                {isResource ? (
                  <select
                    value={form.condition_kind}
                    className={fieldClass}
                    onChange={(e) =>
                      update({ condition_kind: e.target.value as Form['condition_kind'] })
                    }
                  >
                    {Object.entries(conditionLabels)
                      .filter(
                        ([value]) =>
                          !['due_soon', 'overdue'].includes(value) ||
                          ['document', 'case_file'].includes(form.target_kind)
                      )
                      .map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                  </select>
                ) : (
                  <select
                    value={form.trigger_kind}
                    className={fieldClass}
                    onChange={(e) =>
                      update({ trigger_kind: e.target.value as Form['trigger_kind'] })
                    }
                  >
                    {Object.entries(triggerLabels)
                      .filter(([value]) => value !== 'resource_condition')
                      .map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                  </select>
                )}
              </label>
              {((isResource && ['inactive', 'due_soon'].includes(form.condition_kind)) ||
                (!isResource && ['due_soon', 'inactive'].includes(form.trigger_kind))) && (
                <label className="block text-sm">
                  {(isResource ? form.condition_kind : form.trigger_kind) === 'inactive'
                    ? 'Días sin cambios'
                    : 'Días de anticipación'}
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={form.lead_days}
                    onChange={(e) => update({ lead_days: Number(e.target.value) })}
                    className={fieldClass}
                  />
                </label>
              )}
            </>
          )}
          {step === 1 && (
            <>
              <h3 className="font-semibold">¿A qué {isResource ? 'recursos' : 'tareas'} aplica?</h3>
              <p className="text-sm text-slate-500">
                Los filtros vacíos incluyen cualquier valor; los seleccionados deben cumplirse a la
                vez.
              </p>
              {isResource && selectedResource && (
                <label className="block max-w-md text-sm">
                  Estado del recurso
                  <select
                    value={form.entity_status_filter || ''}
                    onChange={(e) => update({ entity_status_filter: e.target.value || null })}
                    className={fieldClass}
                  >
                    <option value="">Cualquier estado activo</option>
                    {resourceStatuses[selectedResource].map((value) => (
                      <option key={value} value={value}>
                        {value.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                  {form.condition_kind === 'status' && !form.entity_status_filter && (
                    <span className="mt-1 block text-xs text-amber-700">
                      Elige el estado que activa la regla.
                    </span>
                  )}
                </label>
              )}
              {!isResource && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm">
                    Clase
                    <select
                      value={form.work_kind || ''}
                      onChange={(e) => update({ work_kind: e.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">Acciones y actividades</option>
                      <option value="accion">Acciones</option>
                      <option value="actividad">Actividades</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    Tipo
                    <select
                      value={form.task_type || ''}
                      onChange={(e) => update({ task_type: e.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">Todos los tipos</option>
                      {typeOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Prioridad
                    <select
                      value={form.priority_filter || ''}
                      onChange={(e) => update({ priority_filter: e.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">Todas</option>
                      {['critica', 'alta', 'media', 'baja'].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Estado
                    <select
                      value={form.status_filter || ''}
                      onChange={(e) => update({ status_filter: e.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">Todos los activos</option>
                      {[
                        'nueva',
                        'pendiente',
                        'en_proceso',
                        'bloqueada',
                        'en_revision',
                        'vencida',
                        'escalada',
                      ].map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Origen
                    <select
                      value={form.origin_filter || ''}
                      onChange={(e) => update({ origin_filter: e.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">Manual y sistema</option>
                      <option value="manual">Manual</option>
                      <option value="sistema">Sistema</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    Recurso
                    <select
                      value={form.source_filter || ''}
                      onChange={(e) => update({ source_filter: e.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">Todos los recursos</option>
                      {[
                        ['document', 'Documento'],
                        ['form_template', 'Formulario'],
                        ['template', 'Plantilla'],
                        ['case_file', 'Expediente'],
                        ['form_response', 'Respuesta'],
                        ['user', 'Usuario'],
                        ['task', 'Tarea'],
                        ['form_token', 'Invitación'],
                        ['participant_requirement', 'Anexo'],
                      ].map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <h3 className="font-semibold">¿Qué debe hacer el sistema?</h3>
              <p className="text-sm text-slate-500">Puedes elegir varias acciones. Cada una se ejecuta una vez por coincidencia; los avisos tienen control de duplicados.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {Object.entries(actionLabels)
                  .filter(([value]) => !isResource || value !== 'raise_priority')
                  .map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => {
                        const selected = [form.action_kind, ...form.additional_action_kinds];
                        const next = selected.includes(value as Form['action_kind'])
                          ? selected.filter(item => item !== value) : [...selected, value as Form['action_kind']];
                        if (!next.length) return;
                        update({ action_kind: next[0], additional_action_kinds: next.slice(1) });
                      }}
                      aria-pressed={form.action_kind === value || form.additional_action_kinds.includes(value as Form['action_kind'])}
                      className={`rounded-lg border p-4 text-left ${form.action_kind === value || form.additional_action_kinds.includes(value as Form['action_kind']) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
                    >
                      {value === 'notify_assignee' ? (
                        <Bell size={19} />
                      ) : value === 'create_followup' ? (
                        <ListChecks size={19} />
                      ) : (
                        <ShieldCheck size={19} />
                      )}
                      <span className="mt-2 block text-sm font-semibold">{label}</span>
                    </button>
                  ))}
              </div>
              {isResource && selectedResource && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {(form.action_kind === 'create_followup' || form.additional_action_kinds.includes('create_followup')) && (
                    <label className="text-sm">
                      Tipo de acción que se creará
                      <select
                        value={form.generated_task_type}
                        onChange={(e) => update({ generated_task_type: e.target.value })}
                        className={fieldClass}
                      >
                        {resourceTypes[selectedResource].map((value) => (
                          <option key={value} value={value}>
                            {typeOptions.find(([key]) => key === value)?.[1] ||
                              value.replaceAll('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="text-sm">
                    Prioridad
                    <select
                      value={form.generated_priority}
                      onChange={(e) =>
                        update({ generated_priority: e.target.value as Form['generated_priority'] })
                      }
                      className={fieldClass}
                    >
                      {(['baja', 'media', 'alta', 'critica'] as const).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">
                {resourceLabels[form.target_kind]} ·{' '}
                {isResource
                  ? conditionLabels[form.condition_kind]
                  : triggerLabels[form.trigger_kind]}
                {' → '}
                {[form.action_kind, ...form.additional_action_kinds].map(value => actionLabels[value]).join(' + ')}. Las ejecuciones se concilian cada 30 minutos; los
                seguimientos se cierran con historial cuando deja de cumplirse la condición.
              </p>
            </>
          )}
        </div>
        <footer className="flex justify-between border-t border-slate-200 px-6 py-4">
          <button
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm"
          >
            <ArrowLeft size={15} />
            {step === 0 ? 'Cancelar' : 'Atrás'}
          </button>
          <button
            onClick={() => (step === 2 ? void save() : setStep(step + 1))}
            disabled={
              saving ||
              (step === 0 &&
                (form.name.trim().length < 3 || form.lead_days < 1 || form.lead_days > 30)) ||
              (step === 1 &&
                isResource &&
                form.condition_kind === 'status' &&
                !form.entity_status_filter)
            }
            className="flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {step === 2 ? (
              <>
                <Check size={15} />
                {existing ? 'Guardar cambios' : 'Crear flujo'}
              </>
            ) : (
              <>
                Siguiente
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
