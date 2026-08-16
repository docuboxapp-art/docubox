'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, CalendarClock, Check, CheckCircle2, CircleAlert,
  FileCheck2, History, KeyRound, Loader2, LockKeyhole, RefreshCw, ShieldAlert,
  ShieldCheck, UserRoundCheck, Users, X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  isExecutableOffboarding,
  offboardingAssetLabels,
  offboardingAssetTotal,
  transferableAssetTotal,
  validateOffboardingSelection,
  type OffboardingAssets,
} from '@/lib/organization/continuity';

type Row = Record<string, any>;

const steps = [
  ['Persona', 'Elige a quién dar de baja'],
  ['Continuidad', 'Define sucesor y fecha'],
  ['Inventario', 'Revisa activos y accesos'],
  ['Confirmación', 'Autoriza la ejecución'],
] as const;

const transferOptions = [
  ['documents', 'Reasignar documentos'],
  ['case_files', 'Reasignar expedientes'],
  ['tasks', 'Reasignar tareas'],
  ['shared_resources', 'Reasignar plantillas y recursos'],
  ['responsibilities', 'Reasignar equipos, centros de costo y permisos'],
  ['api_credentials', 'Revocar API keys personales de la organización'],
] as const;

function personOf(member?: Row) {
  const person = Array.isArray(member?.user_profiles) ? member?.user_profiles[0] : member?.user_profiles;
  return person || {};
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function statusLabel(value?: string) {
  return ({ pending: 'Pendiente', scheduled: 'Programada', processing: 'Procesando', completed: 'Completada', failed: 'Fallida', cancelled: 'Cancelada', expired: 'Expirada' } as Record<string, string>)[value || ''] || value || 'Sin estado';
}

function Status({ value }: { value?: string }) {
  const good = value === 'completed';
  const warning = ['pending', 'scheduled', 'processing'].includes(value || '');
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${good ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' : warning ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' : 'border-border bg-muted text-muted-foreground'}`}>{statusLabel(value)}</span>;
}

function Notice({ error, success }: { error: string; success: string }) {
  return <>{error && <div role="alert" className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><CircleAlert size={17} className="mt-0.5 shrink-0" />{error}</div>}{success && <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"><Check size={17} className="mt-0.5 shrink-0" />{success}</div>}</>;
}

export default function OrganizationContinuity() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, session } = useAuth();
  const { activeWorkspace, refreshWorkspaces } = useWorkspace();
  const confirmationStarted = useRef(false);
  const [members, setMembers] = useState<Row[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]);
  const [transfers, setTransfers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [step, setStep] = useState(0);
  const [memberId, setMemberId] = useState('');
  const [successorId, setSuccessorId] = useState('');
  const [timing, setTiming] = useState<'now' | 'scheduled'>('now');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [reason, setReason] = useState('');
  const [inventory, setInventory] = useState<Row | null>(null);
  const [transferPlan, setTransferPlan] = useState<Row>(Object.fromEntries(transferOptions.map(([key]) => [key, true])));
  const [confirmation, setConfirmation] = useState('');
  const [offboardingKey, setOffboardingKey] = useState('');
  const [newOwnerId, setNewOwnerId] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerConfirmation, setOwnerConfirmation] = useState('');

  const elevated = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const canRead = elevated || permissions.includes('members.read');
  const canOffboard = elevated || permissions.includes('members.offboard');
  const canTransferOwnership = activeWorkspace?.role === 'owner';
  const selectedMember = members.find((member) => member.id === memberId);
  const activeCandidates = members.filter((member) => member.status === 'active' && member.id !== memberId);
  const ownershipCandidates = members.filter((member) => member.status === 'active' && member.user_id !== user?.id);
  const assets = (inventory?.assets || {}) as OffboardingAssets;

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}`, ...(init?.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'No se pudo completar la operación.');
    return payload;
  }, [session?.access_token]);

  const load = useCallback(async () => {
    if (!activeWorkspace?.id || !session?.access_token) return;
    setLoading(true);
    setError('');
    try {
      const [memberResult, permissionResult, continuity] = await Promise.all([
        supabase.from('workspace_members').select('id,user_id,role,status,job_title,joined_at,user_profiles(full_name,email,email_verified)').eq('workspace_id', activeWorkspace.id).order('joined_at'),
        supabase.rpc('get_my_organization_permissions', { ws_id: activeWorkspace.id }),
        api(`/api/organizacion/continuity?workspace_id=${encodeURIComponent(activeWorkspace.id)}`),
      ]);
      if (memberResult.error) throw memberResult.error;
      setMembers(memberResult.data || []);
      setPermissions((permissionResult.data || []).map((item: Row) => item.permission_key));
      setJobs(continuity.data?.jobs || []);
      setTransfers(continuity.data?.transfers || []);
      const requestedMember = searchParams.get('member');
      if (requestedMember && (memberResult.data || []).some((member) => member.id === requestedMember)) setMemberId(requestedMember);
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo cargar la continuidad organizacional.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id, api, searchParams, session?.access_token, supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const token = searchParams.get('ownership_token');
    if (!token || !session?.access_token || confirmationStarted.current) return;
    confirmationStarted.current = true;
    setSaving(true);
    setError('');
    api('/api/organizacion/continuity', { method: 'POST', body: JSON.stringify({ action: 'confirm_ownership', token }) })
      .then(async () => {
        setSuccess('La transferencia se confirmó. La organización conserva un propietario activo.');
        await refreshWorkspaces();
        router.replace('/organizacion/continuidad');
        await load();
      })
      .catch((cause) => setError(cause?.message || 'No se pudo confirmar la transferencia.'))
      .finally(() => setSaving(false));
  }, [api, load, refreshWorkspaces, router, searchParams, session?.access_token]);

  const loadInventory = async () => {
    if (!activeWorkspace?.id || !memberId) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const result = await api(`/api/organizacion/continuity?action=preview&workspace_id=${encodeURIComponent(activeWorkspace.id)}&member_id=${encodeURIComponent(memberId)}`);
      setInventory(result.data);
      setStep(2);
    } catch (cause: any) { setError(cause?.message || 'No se pudo preparar el inventario.'); }
    finally { setSaving(false); }
  };

  const next = async () => {
    setError('');
    if (step === 0) {
      if (!selectedMember) return setError('Selecciona un miembro.');
      if (selectedMember.user_id === user?.id) return setError('No puedes iniciar tu propia baja.');
      if (selectedMember.role === 'owner') return setError('Primero transfiere la propiedad desde el panel inferior.');
      setStep(1);
      return;
    }
    if (step === 1) {
      if (timing === 'scheduled' && !effectiveAt) return setError('Selecciona la fecha de ejecución.');
      await loadInventory();
      return;
    }
    if (step === 2) setStep(3);
  };

  const executeOffboarding = async () => {
    if (!activeWorkspace?.id || !selectedMember) return;
    const validation = validateOffboardingSelection({
      memberId,
      memberRole: selectedMember.role,
      successorId,
      transferableAssets: transferableAssetTotal(assets),
      confirmation,
    });
    if (validation) return setError(validation);
    setSaving(true); setError(''); setSuccess('');
    try {
      const key = offboardingKey || window.crypto.randomUUID();
      setOffboardingKey(key);
      const scheduledDate = timing === 'scheduled' ? new Date(effectiveAt) : new Date();
      const result = await api('/api/organizacion/continuity', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_offboarding', workspace_id: activeWorkspace.id, member_id: memberId,
          successor_member_id: successorId || null, effective_at: scheduledDate.toISOString(),
          execute_now: timing === 'now', reason, transfer_plan: transferPlan, idempotency_key: key,
        }),
      });
      if (result.data?.status === 'failed') throw new Error(result.data.message || 'La baja no pudo completarse.');
      setSuccess(timing === 'now' ? 'La baja concluyó y se generó el reporte de cierre.' : 'La baja quedó programada. Podrás ejecutarla cuando llegue la fecha.');
      setStep(0); setMemberId(''); setSuccessorId(''); setReason(''); setInventory(null); setConfirmation(''); setOffboardingKey('');
      await load();
    } catch (cause: any) { setError(cause?.message || 'No se pudo completar la baja.'); }
    finally { setSaving(false); }
  };

  const jobAction = async (action: 'execute_offboarding' | 'cancel_offboarding', job: Row) => {
    if (!activeWorkspace?.id) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const result = await api('/api/organizacion/continuity', { method: 'POST', body: JSON.stringify({ action, workspace_id: activeWorkspace.id, job_id: job.id }) });
      if (result.data?.status === 'failed') throw new Error(result.data.message || 'La ejecución falló sin aplicar cambios.');
      setSuccess(action === 'execute_offboarding' ? 'Baja ejecutada correctamente.' : 'Baja programada cancelada.');
      await load();
    } catch (cause: any) { setError(cause?.message || 'No se pudo completar la acción.'); }
    finally { setSaving(false); }
  };

  const requestOwnership = async () => {
    if (!activeWorkspace?.id) return;
    if (!newOwnerId) return setError('Selecciona al nuevo propietario.');
    if (ownerConfirmation.trim().toUpperCase() !== 'TRANSFERIR PROPIEDAD') return setError('Escribe TRANSFERIR PROPIEDAD para confirmar.');
    setSaving(true); setError(''); setSuccess('');
    try {
      await api('/api/organizacion/continuity', {
        method: 'POST',
        body: JSON.stringify({
          action: 'request_ownership', workspace_id: activeWorkspace.id, target_member_id: newOwnerId,
          current_password: ownerPassword, confirmation: ownerConfirmation, idempotency_key: window.crypto.randomUUID(),
        }),
      });
      setOwnerPassword(''); setOwnerConfirmation(''); setNewOwnerId('');
      setSuccess('Se envió un enlace de un solo uso al nuevo propietario. Vence en 30 minutos.');
      await load();
    } catch (cause: any) { setError(cause?.message || 'No se pudo iniciar la transferencia.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="min-h-[420px] grid place-items-center text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Loader2 size={17} className="animate-spin" /> Cargando continuidad...</span></div>;

  if (!canRead) return <div className="max-w-xl mx-auto rounded-lg border border-border bg-background p-8 text-center"><LockKeyhole size={30} className="mx-auto text-muted-foreground" /><h2 className="mt-4 text-lg font-medium">Acceso restringido</h2><p className="mt-2 text-sm text-muted-foreground">Necesitas permiso para consultar miembros y operaciones de continuidad.</p></div>;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 className="text-2xl font-medium text-foreground">Continuidad organizacional</h2><p className="mt-1 text-sm text-muted-foreground">Bajas controladas, reasignación de activos y transferencia segura de propiedad.</p></div>
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={16} className="text-emerald-600" /> Historial, autorías y firmas preservados</div>
      </header>
      <Notice error={error} success={success} />

      {canOffboard && <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border px-5 py-4"><h3 className="font-medium">Baja y transferencia de activos</h3><p className="mt-1 text-sm text-muted-foreground">El acceso se cierra solo después de revisar y reasignar responsabilidades.</p></div>
        <div className="grid border-b border-border sm:grid-cols-4">
          {steps.map(([title, description], index) => <button key={title} type="button" onClick={() => index < step && setStep(index)} disabled={index > step} className={`min-h-[72px] border-b border-border px-4 py-3 text-left last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${step === index ? 'bg-primary/5' : ''}`}><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${index <= step ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>{index < step ? <Check size={14} /> : index + 1}</span><span className="ml-2 text-sm font-medium">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span></button>)}
        </div>

        <div className="p-5 sm:p-6">
          {step === 0 && <div className="space-y-3"><div><h4 className="font-medium">Selecciona a la persona</h4><p className="mt-1 text-sm text-muted-foreground">El propietario requiere transferir primero la propiedad. No puedes iniciar tu propia baja.</p></div><div className="divide-y divide-border rounded-lg border border-border">{members.filter((member) => member.status !== 'offboarded').map((member) => { const person = personOf(member); const disabled = member.user_id === user?.id; return <label key={member.id} className={`flex items-center gap-3 px-4 py-3 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-muted/40'}`}><input type="radio" name="offboarding-member" disabled={disabled} checked={memberId === member.id} onChange={() => { setMemberId(member.id); setInventory(null); setSuccessorId(''); }} className="h-4 w-4" /><div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-sm font-medium text-primary">{String(person.full_name || person.email || 'U').slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{person.full_name || person.email}</p><p className="truncate text-xs text-muted-foreground">{person.email}</p></div><span className="text-xs capitalize text-muted-foreground">{member.role}</span></label>; })}</div></div>}

          {step === 1 && <div className="grid gap-5 lg:grid-cols-2"><div><label className="text-sm font-medium">Sucesor</label><select value={successorId} onChange={(event) => setSuccessorId(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"><option value="">Sin sucesor, solo si no existen activos</option>{activeCandidates.map((member) => <option key={member.id} value={member.id}>{personOf(member).full_name || personOf(member).email}</option>)}</select><p className="mt-2 text-xs text-muted-foreground">El sucesor recibe propiedad operativa; nunca recibe autoría ni firmas históricas.</p><label className="mt-5 block text-sm font-medium">Motivo interno</label><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} className="mt-2 w-full rounded-md border border-border bg-background p-3 text-sm" placeholder="Motivo de la baja y referencia interna" /></div><div><p className="text-sm font-medium">Momento de ejecución</p><div className="mt-2 grid gap-2"><label className={`flex cursor-pointer gap-3 rounded-md border p-4 ${timing === 'now' ? 'border-primary bg-primary/5' : 'border-border'}`}><input type="radio" checked={timing === 'now'} onChange={() => setTiming('now')} /><span><span className="block text-sm font-medium">Inmediata</span><span className="mt-1 block text-xs text-muted-foreground">Reasigna activos y cierra el acceso al confirmar.</span></span></label><label className={`flex cursor-pointer gap-3 rounded-md border p-4 ${timing === 'scheduled' ? 'border-primary bg-primary/5' : 'border-border'}`}><input type="radio" checked={timing === 'scheduled'} onChange={() => setTiming('scheduled')} /><span><span className="block text-sm font-medium">Programada</span><span className="mt-1 block text-xs text-muted-foreground">Queda pendiente hasta la fecha definida.</span></span></label></div>{timing === 'scheduled' && <label className="mt-4 block text-sm font-medium">Fecha y hora<input type="datetime-local" value={effectiveAt} min={new Date().toISOString().slice(0, 16)} onChange={(event) => setEffectiveAt(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm" /></label>}</div></div>}

          {step === 2 && inventory && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{offboardingAssetLabels.map(([key, label]) => <div key={key} className="rounded-md border border-border p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><FileCheck2 size={16} />{label}</div><p className="mt-2 text-2xl font-medium">{Number(assets[key] || 0)}</p></div>)}</div><div className="rounded-md border border-border"><div className="border-b border-border px-4 py-3"><h4 className="text-sm font-medium">Accesos a cerrar</h4></div><div className="grid gap-3 p-4 sm:grid-cols-3">{[['Sesiones', inventory.access?.active_sessions], ['API keys', inventory.access?.active_api_credentials], ['Invitaciones', inventory.access?.pending_invitations]].map(([label, value]) => <div key={String(label)}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-medium">{Number(value || 0)}</p></div>)}</div><p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{inventory.access?.global_authenticator_note}</p></div><div><h4 className="text-sm font-medium">Tratamiento por categoría</h4><div className="mt-2 grid gap-2 md:grid-cols-2">{transferOptions.map(([key, label]) => <label key={key} className="flex items-start gap-3 rounded-md border border-border p-3"><input type="checkbox" checked={Boolean(transferPlan[key])} onChange={(event) => setTransferPlan((current) => ({ ...current, [key]: event.target.checked }))} className="mt-0.5 h-4 w-4" /><span className="text-sm">{label}</span></label>)}</div></div></div>}

          {step === 3 && inventory && <div className="mx-auto max-w-2xl space-y-5"><div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"><div className="flex gap-3"><ShieldAlert size={20} className="shrink-0 text-amber-700" /><div><h4 className="font-medium text-amber-900 dark:text-amber-200">Confirmación reforzada</h4><p className="mt-1 text-sm text-amber-800 dark:text-amber-300">Se procesarán {offboardingAssetTotal(assets)} referencias. Las facultades se suspenden, los accesos se revocan y la membresía histórica permanece.</p></div></div></div><div className="rounded-lg border border-border p-4"><p className="text-sm text-muted-foreground">Persona</p><p className="mt-1 font-medium">{personOf(selectedMember).full_name || personOf(selectedMember).email}</p><p className="mt-4 text-sm text-muted-foreground">Sucesor</p><p className="mt-1 font-medium">{successorId ? personOf(members.find((member) => member.id === successorId)).full_name || personOf(members.find((member) => member.id === successorId)).email : 'No aplica'}</p><p className="mt-4 text-sm text-muted-foreground">Ejecución</p><p className="mt-1 font-medium">{timing === 'now' ? 'Inmediata' : formatDate(effectiveAt)}</p></div><label className="block text-sm font-medium">Escribe <strong>DAR DE BAJA</strong><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm" /></label></div>}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-4"><button type="button" disabled={step === 0 || saving} onClick={() => setStep((current) => Math.max(0, current - 1))} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm disabled:opacity-40"><ArrowLeft size={16} /> Atrás</button>{step < 3 ? <button type="button" disabled={saving} onClick={next} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : null} Continuar <ArrowRight size={16} /></button> : <button type="button" disabled={saving || confirmation.trim().toUpperCase() !== 'DAR DE BAJA'} onClick={executeOffboarding} className="inline-flex h-10 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />} Confirmar baja</button>}</div>
      </section>}

      {canTransferOwnership && <section className="overflow-hidden rounded-lg border border-border bg-background"><div className="border-b border-border px-5 py-4"><h3 className="font-medium">Transferencia de propiedad</h3><p className="mt-1 text-sm text-muted-foreground">Requiere correo verificado, MFA del nuevo propietario, tu contraseña y confirmación por enlace de un solo uso.</p></div><div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]"><div className="space-y-4"><label className="block text-sm font-medium">Nuevo propietario<select value={newOwnerId} onChange={(event) => setNewOwnerId(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"><option value="">Selecciona un miembro activo</option>{ownershipCandidates.map((member) => <option key={member.id} value={member.id}>{personOf(member).full_name || personOf(member).email}</option>)}</select></label><label className="block text-sm font-medium">Confirma tu contraseña<input type="password" value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} autoComplete="current-password" className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm" /></label><label className="block text-sm font-medium">Escribe <strong>TRANSFERIR PROPIEDAD</strong><input value={ownerConfirmation} onChange={(event) => setOwnerConfirmation(event.target.value)} autoComplete="off" className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm" /></label><button type="button" onClick={requestOwnership} disabled={saving || !newOwnerId || !ownerPassword} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"><KeyRound size={16} /> Solicitar transferencia</button></div><div className="rounded-lg border border-border bg-muted/30 p-5"><UserRoundCheck size={24} className="text-primary" /><h4 className="mt-3 font-medium">Sin periodos sin propietario</h4><p className="mt-2 text-sm text-muted-foreground">El cambio de roles y del propietario del espacio ocurre en una sola transacción cuando la persona designada confirma. Hasta entonces conservas la propiedad.</p><div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole size={15} /> El token se almacena únicamente como hash SHA-256.</div></div></div></section>}

      <section className="overflow-hidden rounded-lg border border-border bg-background"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-medium">Operaciones de continuidad</h3><p className="mt-1 text-sm text-muted-foreground">Historial de bajas y reportes de cierre.</p></div><button type="button" onClick={load} aria-label="Actualizar" className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted"><RefreshCw size={16} /></button></div>{jobs.length ? <div className="divide-y divide-border">{jobs.map((job) => { const member = members.find((item) => item.id === job.member_id); return <div key={job.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><History size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{personOf(member).full_name || personOf(member).email || 'Miembro histórico'}</p><p className="mt-1 text-xs text-muted-foreground">Creada {formatDate(job.created_at)} · Efectiva {formatDate(job.effective_at)}</p></div><Status value={job.status} /><div className="flex gap-2">{isExecutableOffboarding(job.status, job.effective_at) && <button type="button" onClick={() => jobAction('execute_offboarding', job)} className="h-8 rounded-md border border-border px-3 text-xs font-medium">Ejecutar</button>}{['pending', 'scheduled'].includes(job.status) && <button type="button" onClick={() => jobAction('cancel_offboarding', job)} aria-label="Cancelar baja" className="grid h-8 w-8 place-items-center rounded-md border border-red-200 text-red-600"><X size={15} /></button>}</div></div>; })}</div> : <div className="px-5 py-12 text-center"><CalendarClock size={26} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-medium">Sin operaciones registradas</p><p className="mt-1 text-sm text-muted-foreground">Las bajas programadas y concluidas aparecerán aquí.</p></div>}</section>

      {canTransferOwnership && transfers.length > 0 && <section className="overflow-hidden rounded-lg border border-border bg-background"><div className="border-b border-border px-5 py-4"><h3 className="font-medium">Transferencias de propiedad</h3></div><div className="divide-y divide-border">{transfers.map((transfer) => <div key={transfer.id} className="flex items-center gap-3 px-5 py-4"><CheckCircle2 size={18} className={transfer.status === 'completed' ? 'text-emerald-600' : 'text-muted-foreground'} /><div className="flex-1"><p className="text-sm font-medium">Solicitud {transfer.id.slice(0, 8)}</p><p className="mt-1 text-xs text-muted-foreground">Vence {formatDate(transfer.expires_at)}</p></div><Status value={transfer.status} /></div>)}</div></section>}
    </div>
  );
}
