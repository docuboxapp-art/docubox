'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Bell, CalendarClock, Check, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type SystemRule = { workspace_id: string; rule_key: string; enabled: boolean; threshold_days: number };
type CustomRule = { id: string; name: string; enabled: boolean; trigger_kind: 'due_soon' | 'overdue'; action_kind: 'notify_assignee' | 'raise_priority'; lead_days: number; task_type: string | null; work_kind: string | null };

const systemCatalog: Record<string, { label: string; description: string; days: string }> = {
  draft_stale: { label: 'Borradores sin actividad', description: 'Crea una acción para continuar un documento que sigue en borrador.', days: 'Días sin cambios' },
  document_due: { label: 'Documentos por vencer', description: 'Advierte cuando se acerca la fecha límite de un documento en curso.', days: 'Días de anticipación' },
  form_invite_pending: { label: 'Invitaciones de formulario pendientes', description: 'Da seguimiento a invitaciones sin respuesta de usuarios registrados.', days: 'Días sin respuesta' },
  case_due: { label: 'Expedientes por vencer', description: 'Da seguimiento a expedientes abiertos próximos a su fecha objetivo.', days: 'Días de anticipación' },
  missing_anexo: { label: 'Anexos requeridos', description: 'Crea una acción cuando falta un requisito documental obligatorio.', days: 'Días para resolver' },
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
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', trigger_kind: 'due_soon' as CustomRule['trigger_kind'],
    lead_days: 2, work_kind: '', task_type: '', action_kind: 'notify_assignee' as CustomRule['action_kind'] });

  const load = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    const [system, custom] = await Promise.all([
      supabase.from('task_system_rules').select('workspace_id,rule_key,enabled,threshold_days').eq('workspace_id', workspaceId).order('rule_key'),
      supabase.from('task_custom_rules').select('id,name,enabled,trigger_kind,action_kind,lead_days,task_type,work_kind').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
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
  const createRule = async () => {
    if (!workspaceId || !user?.id || !canManage || form.name.trim().length < 3) return;
    setSaving(true); setError('');
    const { error: insertError } = await supabase.from('task_custom_rules').insert({
      workspace_id: workspaceId, created_by: user.id, name: form.name.trim(),
      trigger_kind: form.trigger_kind, action_kind: form.action_kind, lead_days: form.lead_days,
      task_type: form.task_type || null, work_kind: form.work_kind || null,
    });
    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    setBuilder(false); setStep(0); setForm({ name: '', trigger_kind: 'due_soon', lead_days: 2, work_kind: '', task_type: '', action_kind: 'notify_assignee' });
    void load();
  };

  return <AppLayout noPadding><main className="min-h-screen bg-[#f6f8fb] px-4 py-6 sm:px-6">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Link href="/mis-tareas" className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white" aria-label="Volver a tareas"><ArrowLeft size={17} /></Link><div><h1 className="text-2xl font-semibold text-slate-950">Automatizaciones de tareas</h1><p className="text-sm text-slate-500">Reglas del sistema y flujos configurados para este espacio de trabajo.</p></div></div>
        {canManage && <button onClick={() => setBuilder(true)} className="flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white"><Plus size={16} />Nueva automatización</button>}
      </header>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <p className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">Cargando reglas…</p> : <>
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="flex items-center gap-2 font-semibold text-slate-950"><ShieldCheck size={18} className="text-blue-600" />Reglas del sistema</h2><p className="mt-1 text-sm text-slate-500">Se revisan cada 30 minutos. Al resolverse la condición, la acción se cierra con una nota automática.</p></div><div className="divide-y divide-slate-100">
          {systemRules.map(rule => { const info = systemCatalog[rule.rule_key]; if (!info) return null; return <div key={rule.rule_key} className="flex flex-wrap items-center gap-4 px-5 py-4"><div className="min-w-56 flex-1"><p className="text-sm font-semibold text-slate-900">{info.label}</p><p className="mt-0.5 text-xs text-slate-500">{info.description}</p></div><label className="flex items-center gap-2 text-xs text-slate-600">{info.days}<input aria-label={info.days + ' para ' + info.label} type="number" min={1} max={90} defaultValue={rule.threshold_days} disabled={!canManage} onBlur={event => { const value = Number(event.target.value); if (value >= 1 && value <= 90 && value !== rule.threshold_days) void updateSystem(rule, { threshold_days: value }); }} className="h-9 w-16 rounded-md border border-slate-200 px-2 text-center text-sm" /></label><button role="switch" aria-checked={rule.enabled} aria-label={`${rule.enabled ? 'Desactivar' : 'Activar'} ${info.label}`} disabled={!canManage} onClick={() => updateSystem(rule, { enabled: !rule.enabled })} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${rule.enabled ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{rule.enabled ? 'Activa' : 'Inactiva'}</button></div>; })}
        </div></section>
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="flex items-center gap-2 font-semibold text-slate-950"><CalendarClock size={18} className="text-blue-600" />Flujos personalizados</h2><p className="mt-1 text-sm text-slate-500">Define una condición, filtra las tareas y elige una acción ejecutable.</p></div>{customRules.length === 0 ? <p className="px-5 py-8 text-sm text-slate-500">Aún no hay flujos personalizados.</p> : <div className="divide-y divide-slate-100">{customRules.map(rule => <div key={rule.id} className="flex flex-wrap items-center gap-3 px-5 py-4"><div className="min-w-56 flex-1"><p className="text-sm font-semibold text-slate-900">{rule.name}</p><p className="mt-1 text-xs text-slate-500">{rule.trigger_kind === 'overdue' ? 'Tarea vencida' : `${rule.lead_days} días antes de vencer`} · {rule.work_kind || 'Acciones y actividades'} · {rule.task_type ? taskTypes.find(type => type[0] === rule.task_type)?.[1] || rule.task_type : 'Todos los tipos'} → {rule.action_kind === 'notify_assignee' ? 'Notificar responsable' : 'Elevar prioridad'}</p></div>{canManage && <><button role="switch" aria-checked={rule.enabled} onClick={() => updateCustom(rule, !rule.enabled)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${rule.enabled ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{rule.enabled ? 'Activa' : 'Inactiva'}</button><button onClick={() => removeCustom(rule)} aria-label={`Eliminar ${rule.name}`} className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button></>}</div>)}</div>}</section>
      </>}
    </div>
    {builder && <div role="dialog" aria-modal="true" aria-label="Nueva automatización" className="fixed inset-0 z-[80] overflow-y-auto bg-[#f6f8fb]"><div className="mx-auto min-h-screen max-w-4xl bg-white shadow-xl"><header className="flex items-center justify-between border-b border-slate-200 px-6 py-4"><div><h2 className="text-lg font-semibold">Nueva automatización</h2><p className="text-sm text-slate-500">Condición → filtros → acción</p></div><button onClick={() => setBuilder(false)} className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"><X size={16} />Cerrar</button></header><div className="space-y-6 p-6"><div className="flex gap-2">{['Condición','Filtros','Acción'].map((label,index) => <span key={label} className={`rounded-full px-3 py-1 text-xs ${step === index ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{index+1}. {label}</span>)}</div>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {step === 0 && <><h3 className="font-semibold">¿Cuándo debe ejecutarse?</h3><label className="block text-sm">Nombre del flujo<input maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej. Avisar revisiones próximas a vencer" className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3" /></label><label className="block text-sm">Condición<select value={form.trigger_kind} onChange={e => setForm({ ...form, trigger_kind: e.target.value as CustomRule['trigger_kind'] })} className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3"><option value="due_soon">Se acerca la fecha límite</option><option value="overdue">Ya venció</option></select></label>{form.trigger_kind === 'due_soon' && <label className="block text-sm">Días de anticipación<input type="number" min={1} max={30} value={form.lead_days} onChange={e => setForm({ ...form, lead_days: Number(e.target.value) })} className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3" /></label>}</>}
      {step === 1 && <><h3 className="font-semibold">¿A qué tareas aplica?</h3><p className="text-sm text-slate-500">Deja un filtro en “Todos” para incluir todas las tareas del espacio.</p><label className="block text-sm">Clase de trabajo<select value={form.work_kind} onChange={e => setForm({ ...form, work_kind: e.target.value })} className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3"><option value="">Acciones y actividades</option><option value="accion">Acciones</option><option value="actividad">Actividades</option></select></label><label className="block text-sm">Tipo de tarea<select value={form.task_type} onChange={e => setForm({ ...form, task_type: e.target.value })} className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3"><option value="">Todos los tipos</option>{taskTypes.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></>}
      {step === 2 && <><h3 className="font-semibold">¿Qué debe hacer el sistema?</h3><div className="grid gap-3 sm:grid-cols-2"><button onClick={() => setForm({ ...form, action_kind: 'notify_assignee' })} className={`rounded-lg border p-4 text-left ${form.action_kind === 'notify_assignee' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}><Bell size={19} /><span className="mt-2 block text-sm font-semibold">Notificar al responsable</span><span className="text-xs text-slate-500">Aviso interno, máximo una vez por día y tarea.</span></button><button onClick={() => setForm({ ...form, action_kind: 'raise_priority' })} className={`rounded-lg border p-4 text-left ${form.action_kind === 'raise_priority' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}><ShieldCheck size={19} /><span className="mt-2 block text-sm font-semibold">Elevar prioridad</span><span className="text-xs text-slate-500">Eleva de baja o media a alta y registra el cambio.</span></button></div><div className="rounded-md bg-slate-50 p-4 text-sm text-slate-600"><strong>Resumen:</strong> {form.trigger_kind === 'overdue' ? 'Al vencer' : `${form.lead_days} días antes de vencer`} una {form.work_kind || 'tarea'}{form.task_type ? ` de tipo ${taskTypes.find(type => type[0] === form.task_type)?.[1]}` : ''}, el sistema {form.action_kind === 'notify_assignee' ? 'notificará a su responsable' : 'elevará su prioridad'}.</div></>}
    </div><footer className="flex justify-between border-t border-slate-200 px-6 py-4"><button onClick={() => step === 0 ? setBuilder(false) : setStep(step-1)} className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm"><ArrowLeft size={15} />{step === 0 ? 'Cancelar' : 'Atrás'}</button><button onClick={() => step === 2 ? void createRule() : setStep(step+1)} disabled={saving || (step === 0 && (form.name.trim().length < 3 || form.lead_days < 1 || form.lead_days > 30))} className="flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{step === 2 ? <><Check size={15} />Crear flujo</> : <>Siguiente<ArrowRight size={15} /></>}</button></footer></div></div>}
  </main></AppLayout>;
}
