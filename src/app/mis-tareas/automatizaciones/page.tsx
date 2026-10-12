'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarClock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import TaskRuleBuilder, { actionLabels, conditionLabels, resourceLabels, triggerLabels, type CustomRule } from './TaskRuleBuilder';

type SystemRule = { workspace_id: string; rule_key: string; enabled: boolean; threshold_days: number };

const systemCatalog: Record<string, { label: string; description: string; days: string }> = {
  draft_stale: { label: 'Borradores sin actividad', description: 'Crea una acción para continuar un documento que sigue en borrador.', days: 'Días sin cambios' },
  document_due: { label: 'Documentos por vencer', description: 'Advierte cuando se acerca la fecha límite de un documento en curso.', days: 'Días de anticipación' },
  form_invite_pending: { label: 'Invitaciones de formulario pendientes', description: 'Da seguimiento a invitaciones sin respuesta de usuarios registrados.', days: 'Días sin respuesta' },
  case_due: { label: 'Expedientes por vencer', description: 'Da seguimiento a expedientes abiertos próximos a su fecha objetivo.', days: 'Días de anticipación' },
  missing_anexo: { label: 'Anexos requeridos', description: 'Crea una acción cuando falta un requisito documental obligatorio.', days: 'Días para resolver' },
  template_draft_stale: { label: 'Borradores de plantillas', description: 'Retoma plantillas que siguen sin publicar.', days: 'Días sin cambios' },
  form_draft_stale: { label: 'Borradores de formularios', description: 'Retoma formularios que siguen sin publicar.', days: 'Días sin cambios' },
  identity_pending: { label: 'Identidad pendiente', description: 'Solicita completar la biometría tras verificar el correo.', days: 'Días desde registro' },
};

const taskTypes = [
  ['revisar_documento', 'Revisar documento'], ['aprobar_documento', 'Aprobar documento'],
  ['firmar_documento', 'Firmar documento'], ['subir_anexo', 'Completar anexo'],
  ['validar_identidad', 'Validar identidad'], ['retomar_borrador', 'Retomar borrador'],
  ['revisar_vencimiento', 'Revisar vencimiento'], ['responder_formulario', 'Responder formulario'],
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

  const load = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    const [system, custom] = await Promise.all([
      supabase.from('task_system_rules').select('workspace_id,rule_key,enabled,threshold_days').eq('workspace_id', workspaceId).order('rule_key'),
      supabase.from('task_custom_rules').select('id,name,enabled,trigger_kind,action_kind,lead_days,task_type,work_kind,priority_filter,status_filter,origin_filter,source_filter,target_kind,condition_kind,entity_status_filter,generated_task_type,generated_priority').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    ]);
    if (system.error || custom.error) setError(system.error?.message || custom.error?.message || 'No se pudieron cargar las reglas.');
    else { setError(''); setSystemRules(system.data || []); setCustomRules(custom.data || []); }
    setLoading(false);
  }, [workspaceId, supabase]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const updateSystem = async (rule: SystemRule, patch: Partial<SystemRule>) => {
    if (!workspaceId || !canManage) return;
    const { error: updateError } = await supabase.from('task_system_rules').update({ ...patch, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('rule_key', rule.rule_key);
    if (updateError) setError(updateError.message); else void load();
  };
  const updateCustom = async (rule: CustomRule, enabled: boolean) => {
    const { error: updateError } = await supabase.from('task_custom_rules').update({ enabled, updated_at: new Date().toISOString() }).eq('id', rule.id);
    if (updateError) setError(updateError.message); else void load();
  };
  const removeCustom = async (rule: CustomRule) => {
    if (!window.confirm(`¿Eliminar la automatización “${rule.name}”?`)) return;
    const { error: deleteError } = await supabase.from('task_custom_rules').delete().eq('id', rule.id);
    if (deleteError) setError(deleteError.message); else void load();
  };

  return <AppLayout noPadding><main className="min-h-screen bg-[#f6f8fb] px-4 py-6 sm:px-6">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Link href="/mis-tareas" className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Volver a tareas"><ArrowLeft size={17} /></Link><div><h1 className="text-2xl font-semibold text-slate-950">Automatizaciones de tareas</h1><p className="text-sm text-slate-500">Reglas del sistema y flujos configurados para este espacio de trabajo.</p></div></div>
        {canManage && <button onClick={() => { setEditingRule(null); setBuilder(true); }} className="flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white"><Plus size={16} />Nueva automatización</button>}
      </header>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <p className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">Cargando reglas…</p> : <>
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="flex items-center gap-2 font-semibold text-slate-950"><ShieldCheck size={18} className="text-blue-600" />Reglas del sistema</h2><p className="mt-1 text-sm text-slate-500">Se revisan cada 30 minutos. Al resolverse la condición, la acción se cierra con una nota automática.</p></div><div className="divide-y divide-slate-100">
          {systemRules.map(rule => { const info = systemCatalog[rule.rule_key]; if (!info) return null; return <div key={rule.rule_key} className="flex flex-wrap items-center gap-4 px-5 py-4"><div className="min-w-56 flex-1"><p className="text-sm font-semibold text-slate-900">{info.label}</p><p className="mt-0.5 text-xs text-slate-500">{info.description}</p></div><label className="flex items-center gap-2 text-xs text-slate-600">{info.days}<input aria-label={info.days + ' para ' + info.label} type="number" min={1} max={90} defaultValue={rule.threshold_days} disabled={!canManage} onBlur={event => { const value = Number(event.target.value); if (value >= 1 && value <= 90 && value !== rule.threshold_days) void updateSystem(rule, { threshold_days: value }); }} className="h-9 w-16 rounded-md border border-slate-200 px-2 text-center text-sm" /></label><button role="switch" aria-checked={rule.enabled} aria-label={`${rule.enabled ? 'Desactivar' : 'Activar'} ${info.label}`} disabled={!canManage} onClick={() => updateSystem(rule, { enabled: !rule.enabled })} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${rule.enabled ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{rule.enabled ? 'Activa' : 'Inactiva'}</button></div>; })}
        </div></section>
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="flex items-center gap-2 font-semibold text-slate-950"><CalendarClock size={18} className="text-blue-600" />Flujos personalizados</h2><p className="mt-1 text-sm text-slate-500">Define una condición sobre tareas o recursos reales y elige una acción ejecutable.</p></div>{customRules.length === 0 ? <p className="px-5 py-8 text-sm text-slate-500">Aún no hay flujos personalizados.</p> : <div className="divide-y divide-slate-100">{customRules.map(rule => <div key={rule.id} className="flex flex-wrap items-center gap-3 px-5 py-4"><div className="min-w-56 flex-1"><p className="text-sm font-semibold text-slate-900">{rule.name}</p><p className="mt-1 text-xs text-slate-500">{resourceLabels[rule.target_kind]} · {rule.target_kind === 'task' ? triggerLabels[rule.trigger_kind] : conditionLabels[rule.condition_kind]}{rule.target_kind === 'task' ? ` · ${rule.work_kind || 'Acciones y actividades'} · ${rule.task_type ? taskTypes.find(type => type[0] === rule.task_type)?.[1] || rule.task_type : 'Todos los tipos'}` : rule.entity_status_filter ? ` · ${rule.entity_status_filter}` : ''} → {actionLabels[rule.action_kind]}</p></div>{canManage && <><button role="switch" aria-checked={rule.enabled} onClick={() => updateCustom(rule, !rule.enabled)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${rule.enabled ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{rule.enabled ? 'Activa' : 'Inactiva'}</button><button onClick={() => { setEditingRule(rule); setBuilder(true); }} aria-label={`Editar ${rule.name}`} className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><Pencil size={16} /></button><button onClick={() => removeCustom(rule)} aria-label={`Eliminar ${rule.name}`} className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button></>}</div>)}</div>}</section>
      </>}
    </div>
    {builder && workspaceId && user?.id && <TaskRuleBuilder workspaceId={workspaceId} userId={user.id}
      existing={editingRule} onClose={() => setBuilder(false)}
      onSaved={() => { setBuilder(false); void load(); }} />}
  </main></AppLayout>;
}
