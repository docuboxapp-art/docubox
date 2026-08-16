'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity, ArrowLeft, BadgeCheck, BriefcaseBusiness, CalendarClock, Check,
  CircleAlert, Eye, EyeOff, FileText, Fingerprint, KeyRound, Laptop, Loader2, LockKeyhole,
  Save, ShieldAlert, ShieldCheck, UserRound, UsersRound,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type Row = Record<string, any>;
type TabKey = 'resumen' | 'roles' | 'equipos' | 'seguridad' | 'facultades' | 'trabajo' | 'auditoria';
type PendingAction = { action: string; values: Row };

const sensitiveActionScopes: Record<string, string> = {
  update_member: 'members.update',
  set_status: 'members.suspend',
  set_roles: 'roles.manage',
  revoke_sessions: 'security.manage',
};

const sensitiveActionLabels: Record<string, { title: string; description: string }> = {
  update_member: { title: 'Confirmar cambios del miembro', description: 'Vas a modificar requisitos de acceso o información administrativa.' },
  set_status: { title: 'Confirmar cambio de acceso', description: 'Este cambio puede suspender, reactivar o cerrar las sesiones del miembro.' },
  set_roles: { title: 'Confirmar asignación de roles', description: 'Los roles determinan qué información y operaciones puede utilizar esta persona.' },
  revoke_sessions: { title: 'Confirmar revocación de sesiones', description: 'El miembro tendrá que autenticarse nuevamente en sus dispositivos.' },
};

const tabItems: Array<{ key: TabKey; label: string; capability?: string }> = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'roles', label: 'Roles y alcance' },
  { key: 'equipos', label: 'Equipos' },
  { key: 'seguridad', label: 'Seguridad', capability: 'readSecurity' },
  { key: 'facultades', label: 'Facultades', capability: 'readAuthorities' },
  { key: 'trabajo', label: 'Documentos y tareas', capability: 'readWork' },
  { key: 'auditoria', label: 'Auditoría', capability: 'readAudit' },
];

function personOf(member?: Row) {
  const profile = member?.user_profiles;
  return (Array.isArray(profile) ? profile[0] : profile) || {};
}

function nestedOf(row: Row, key: string) {
  const value = row?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return 'No registrado';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No registrado';
  return new Intl.DateTimeFormat('es-MX', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(parsed);
}

function statusLabel(value?: string) {
  return ({ active: 'Activo', suspended: 'Suspendido', blocked: 'Bloqueado', offboarded: 'Baja', invited: 'Invitado', success: 'Correcto', denied: 'Denegado', failed: 'Fallido' } as Record<string, string>)[value || ''] || value || 'Sin estado';
}

function Status({ value }: { value?: string }) {
  const good = ['active', 'success', 'completed'].includes(value || '');
  const warning = ['invited', 'pending', 'suspended'].includes(value || '');
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${good ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' : warning ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' : 'border-border bg-muted text-muted-foreground'}`}>{statusLabel(value)}</span>;
}

function Empty({ icon: Icon, title, text }: { icon: typeof Activity; title: string; text: string }) {
  return <div className="px-6 py-12 text-center"><Icon size={24} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{text}</p></div>;
}

export default function OrganizationMemberDetail({ memberId }: { memberId: string }) {
  const { session } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [data, setData] = useState<Row | null>(null);
  const [tab, setTab] = useState<TabKey>('resumen');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [memberForm, setMemberForm] = useState<Row>({});
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reauthPassword, setReauthPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [reauthenticating, setReauthenticating] = useState(false);
  const [reauthError, setReauthError] = useState('');
  const [reauthTokens, setReauthTokens] = useState<Record<string, { token: string; expiresAt: number }>>({});

  const api = useCallback(async (init?: RequestInit) => {
    if (!activeWorkspace?.id || !session?.access_token) throw new Error('La sesión no está disponible.');
    const response = await fetch(`/api/organizacion/members/${encodeURIComponent(memberId)}${init?.method ? '' : `?workspace_id=${encodeURIComponent(activeWorkspace.id)}`}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = new Error(payload.error || 'No se pudo completar la operación.') as Error & { code?: string };
      failure.code = payload.code;
      throw failure;
    }
    return payload;
  }, [activeWorkspace?.id, memberId, session?.access_token]);

  const load = useCallback(async () => {
    if (!activeWorkspace?.id || !session?.access_token) return;
    setLoading(true);
    setError('');
    try {
      const result = await api();
      const next = result.data || {};
      setData(next);
      setMemberForm({
        job_title: next.member?.job_title || '',
        access_expires_at: next.member?.access_expires_at ? new Date(next.member.access_expires_at).toISOString().slice(0, 10) : '',
        mfa_required: Boolean(next.member?.mfa_required),
        biometric_required: Boolean(next.member?.biometric_required),
      });
      setSelectedRoles((next.roles || []).map((item: Row) => item.role_id));
      setSelectedUnits((next.units || []).map((item: Row) => item.unit_id));
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo cargar el miembro.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id, api, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const executeAction = async (action: string, values: Row = {}, reauthToken?: string) => {
    if (!activeWorkspace?.id) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      await api({
        method: 'POST',
        headers: reauthToken ? { 'X-Organization-Reauth': reauthToken } : undefined,
        body: JSON.stringify({ action, workspace_id: activeWorkspace.id, ...values }),
      });
      setSuccess(action === 'revoke_sessions' ? 'Las sesiones activas fueron revocadas.' : 'Los cambios se guardaron correctamente.');
      await load();
    } catch (cause: any) {
      if (cause?.code === 'reauthentication_required' || cause?.code === 'reauthentication_invalid') {
        const scope = sensitiveActionScopes[action];
        if (scope) {
          setReauthTokens((current) => { const next = { ...current }; delete next[scope]; return next; });
          setPendingAction({ action, values });
          setReauthError('La confirmación anterior venció. Ingresa tu contraseña nuevamente.');
          return;
        }
      }
      setError(cause?.message || 'No se pudo completar la operación.');
    } finally {
      setSaving(false);
    }
  };

  const act = async (action: string, values: Row = {}, confirmation?: string) => {
    if (confirmation && !window.confirm(confirmation)) return;
    const scope = sensitiveActionScopes[action];
    if (!scope) {
      await executeAction(action, values);
      return;
    }
    const cached = reauthTokens[scope];
    if (cached && cached.expiresAt > Date.now() + 5_000) {
      await executeAction(action, values, cached.token);
      return;
    }
    setPendingAction({ action, values });
    setReauthPassword('');
    setReauthError('');
  };

  const confirmSensitiveAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pendingAction || !activeWorkspace?.id || !session?.access_token) return;
    const scope = sensitiveActionScopes[pendingAction.action];
    if (!scope || !reauthPassword) return;
    setReauthenticating(true);
    setReauthError('');
    try {
      const response = await fetch('/api/organizacion/reauthenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspace_id: activeWorkspace.id, password: reauthPassword, scopes: [scope] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo confirmar tu identidad.');
      const action = pendingAction;
      const expiresAt = new Date(payload.expires_at).getTime();
      setReauthTokens((current) => ({ ...current, [scope]: { token: payload.token, expiresAt } }));
      setPendingAction(null);
      setReauthPassword('');
      await executeAction(action.action, action.values, payload.token);
    } catch (cause: any) {
      setReauthError(cause?.message || 'No se pudo confirmar tu identidad.');
    } finally {
      setReauthenticating(false);
    }
  };

  const visibleTabs = useMemo(() => tabItems.filter((item) => !item.capability || data?.capabilities?.[item.capability]), [data?.capabilities]);
  const member = data?.member;
  const person = personOf(member);
  const isOwner = member?.role === 'owner';

  if (loading && !data) return <div className="min-h-[420px] grid place-items-center text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Loader2 size={17} className="animate-spin" /> Cargando detalle del miembro...</span></div>;
  if (!data || !member) return <div className="max-w-3xl mx-auto"><Link href="/organizacion/miembros" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Volver a miembros</Link><div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error || 'No se encontró el miembro.'}</div></div>;

  const initials = String(person.full_name || person.email || 'U').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const notices = <>{error && <div role="alert" className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><CircleAlert size={17} className="mt-0.5 shrink-0" />{error}</div>}{success && <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"><Check size={17} className="mt-0.5 shrink-0" />{success}</div>}</>;

  const actionCopy = pendingAction ? sensitiveActionLabels[pendingAction.action] : null;

  return <div className="max-w-[1400px] mx-auto space-y-5">
    <Link href="/organizacion/miembros" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Miembros</Link>
    <section className="rounded-lg border border-border bg-background overflow-hidden">
      <div className="px-5 py-5 flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex min-w-0 items-center gap-4 flex-1">
          <div className="h-12 w-12 shrink-0 rounded-md bg-primary/10 text-primary grid place-items-center font-medium">{initials}</div>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-medium truncate">{person.full_name || 'Usuario sin nombre'}</h2><Status value={member.status} /></div><p className="mt-1 text-sm text-muted-foreground truncate">{person.email}</p></div>
        </div>
        {!isOwner && <div className="flex flex-wrap items-center gap-2">
          {data.capabilities?.suspendMember && (member.status === 'active' ? <button disabled={saving} onClick={() => act('set_status', { status: 'suspended' }, 'Se revocarán las sesiones activas de este miembro. ¿Deseas suspenderlo?')} className="h-10 px-4 rounded-md border border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50 disabled:opacity-50">Suspender acceso</button> : member.status === 'suspended' && <button disabled={saving} onClick={() => act('set_status', { status: 'active' })} className="h-10 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50">Reactivar</button>)}
          {data.capabilities?.offboardMember && member.status !== 'offboarded' && <Link href={`/organizacion/continuidad?member=${member.id}`} className="h-10 px-4 rounded-md bg-red-600 text-white text-sm font-medium inline-flex items-center">Dar de baja</Link>}
        </div>}
      </div>
      <div className="border-t border-border overflow-x-auto px-3"><div className="flex min-w-max">{visibleTabs.map((item) => <button key={item.key} onClick={() => setTab(item.key)} className={`h-12 px-3 border-b-2 text-sm ${tab === item.key ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{item.label}</button>)}</div></div>
    </section>
    {notices}

    {tab === 'resumen' && <div className="grid xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)] gap-5 items-start">
      <section className="rounded-lg border border-border bg-background overflow-hidden"><div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3"><div><h3 className="font-medium">Información laboral y acceso</h3><p className="mt-1 text-sm text-muted-foreground">Datos internos de la membresía.</p></div>{data.capabilities?.updateMember && <button disabled={saving} onClick={() => act('update_member', memberForm)} className="h-9 px-3 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"><Save size={15} /> Guardar</button>}</div><div className="p-5 grid sm:grid-cols-2 gap-4">
        <label><span className="text-sm">Puesto</span><input disabled={!data.capabilities?.updateMember} value={memberForm.job_title} onChange={(event) => setMemberForm((current) => ({ ...current, job_title: event.target.value }))} className="mt-1.5 w-full h-10 rounded-md border border-border bg-background px-3 text-sm disabled:bg-muted" placeholder="Ej. Gerente jurídico" /></label>
        <label><span className="text-sm">Acceso vigente hasta</span><input type="date" disabled={!data.capabilities?.updateMember} value={memberForm.access_expires_at} onChange={(event) => setMemberForm((current) => ({ ...current, access_expires_at: event.target.value }))} className="mt-1.5 w-full h-10 rounded-md border border-border bg-background px-3 text-sm disabled:bg-muted" /></label>
        <label className="sm:col-span-2 flex gap-3 rounded-md border border-border p-4"><input type="checkbox" disabled={!data.capabilities?.updateMember} checked={memberForm.mfa_required} onChange={(event) => setMemberForm((current) => ({ ...current, mfa_required: event.target.checked }))} className="mt-0.5 h-4 w-4" /><span><span className="block text-sm font-medium">Requerir MFA</span><span className="mt-0.5 block text-sm text-muted-foreground">Exige un segundo factor conforme a la política de la organización.</span></span></label>
        <label className="sm:col-span-2 flex gap-3 rounded-md border border-border p-4"><input type="checkbox" disabled={!data.capabilities?.updateMember} checked={memberForm.biometric_required} onChange={(event) => setMemberForm((current) => ({ ...current, biometric_required: event.target.checked }))} className="mt-0.5 h-4 w-4" /><span><span className="block text-sm font-medium">Requerir enrolamiento biométrico</span><span className="mt-0.5 block text-sm text-muted-foreground">Solicita una credencial WebAuthn/FIDO2 compatible.</span></span></label>
      </div></section>
      <section className="rounded-lg border border-border bg-background overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Resumen de cuenta</h3></div><dl className="divide-y divide-border text-sm">{[
        ['Rol base', statusLabel(member.role)], ['Fecha de ingreso', formatDate(member.joined_at)], ['Último acceso', formatDate(member.last_access_at, true)], ['Correo', person.email || 'No registrado'], ['Teléfono', person.telefono || 'No registrado'],
      ].map(([label, value]) => <div key={label} className="px-5 py-3.5 flex justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl></section>
    </div>}

    {tab === 'roles' && <section className="rounded-lg border border-border bg-background overflow-hidden"><div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3"><div><h3 className="font-medium">Roles efectivos</h3><p className="mt-1 text-sm text-muted-foreground">Los permisos se combinan entre los roles seleccionados.</p></div>{data.capabilities?.manageRoles && !isOwner && <button disabled={saving} onClick={() => act('set_roles', { role_ids: selectedRoles })} className="h-9 px-3 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"><Save size={15} /> Guardar</button>}</div><div className="p-5 grid md:grid-cols-2 xl:grid-cols-3 gap-3">{(data.available_roles || []).filter((role: Row) => role.system_key !== 'owner').map((role: Row) => <label key={role.id} className="flex gap-3 rounded-md border border-border p-4"><input type="checkbox" disabled={!data.capabilities?.manageRoles || isOwner} checked={selectedRoles.includes(role.id)} onChange={(event) => setSelectedRoles((current) => event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} className="mt-0.5 h-4 w-4" /><span><span className="block text-sm font-medium">{role.name}</span><span className="mt-1 block text-xs text-muted-foreground">{role.description || 'Rol personalizado'}{role.is_system ? ' · Sistema' : ''}</span></span></label>)}</div></section>}

    {tab === 'equipos' && <section className="rounded-lg border border-border bg-background overflow-hidden"><div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3"><div><h3 className="font-medium">Equipos y áreas</h3><p className="mt-1 text-sm text-muted-foreground">Ubicación funcional del miembro dentro de la organización.</p></div>{data.capabilities?.manageTeams && <button disabled={saving} onClick={() => act('set_units', { unit_ids: selectedUnits })} className="h-9 px-3 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"><Save size={15} /> Guardar</button>}</div>{(data.available_units || []).length ? <div className="p-5 grid md:grid-cols-2 xl:grid-cols-3 gap-3">{data.available_units.map((unit: Row) => <label key={unit.id} className="flex gap-3 rounded-md border border-border p-4"><input type="checkbox" disabled={!data.capabilities?.manageTeams} checked={selectedUnits.includes(unit.id)} onChange={(event) => setSelectedUnits((current) => event.target.checked ? [...current, unit.id] : current.filter((id) => id !== unit.id))} className="mt-0.5 h-4 w-4" /><span><span className="block text-sm font-medium">{unit.name}</span><span className="mt-1 block text-xs text-muted-foreground">{unit.description || 'Unidad activa'}</span></span></label>)}</div> : <Empty icon={UsersRound} title="Sin equipos disponibles" text="Crea un equipo antes de asignar membresías." />}</section>}

    {tab === 'seguridad' && data.security && <div className="space-y-5"><section className="grid sm:grid-cols-3 rounded-lg border border-border bg-background overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-border">{[
      [ShieldCheck, 'MFA', data.security.totp?.is_enabled || person.mfa_enabled ? 'Configurado' : 'No configurado'], [Fingerprint, 'Passkeys', `${(data.security.credentials || []).filter((item: Row) => item.is_active).length} activas`], [Laptop, 'Sesiones', `${(data.security.sessions || []).length} registradas`],
    ].map(([Icon, label, value]: any) => <div key={label} className="p-5"><Icon size={19} className="text-primary" /><p className="mt-3 text-sm text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>)}</section>
      <section className="rounded-lg border border-border bg-background overflow-hidden"><div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3"><div><h3 className="font-medium">Sesiones y dispositivos</h3><p className="mt-1 text-sm text-muted-foreground">Revocar sesiones no elimina las credenciales biométricas registradas.</p></div>{data.capabilities?.manageSecurity && <button disabled={saving || !(data.security.sessions || []).length} onClick={() => act('revoke_sessions', { reason: 'Revocación administrativa desde detalle de miembro' }, 'El miembro tendrá que volver a autenticarse. ¿Deseas revocar todas sus sesiones?')} className="h-9 px-3 rounded-md border border-red-300 text-red-600 text-sm font-medium disabled:opacity-50">Revocar sesiones</button>}</div>{(data.security.sessions || []).length ? <div className="divide-y divide-border">{data.security.sessions.map((session: Row) => <div key={session.session_id} className="px-5 py-4 flex items-center gap-4"><div className="h-9 w-9 rounded-md bg-muted grid place-items-center"><Laptop size={17} /></div><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{session.device_name || 'Dispositivo sin nombre'}</p><p className="mt-1 text-xs text-muted-foreground truncate">{[session.browser, session.os, session.location].filter(Boolean).join(' · ') || 'Sin detalles del dispositivo'}</p></div><div className="text-right"><Status value={session.risk_level === 'normal' ? 'active' : session.risk_level} /><p className="mt-1 text-xs text-muted-foreground">{formatDate(session.last_active_at, true)}</p></div></div>)}</div> : <Empty icon={Laptop} title="Sin sesiones registradas" text="No se encontraron sesiones activas o históricas para este miembro." />}</section>
      <section className="rounded-lg border border-border bg-background overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Credenciales biométricas</h3></div>{(data.security.credentials || []).length ? <div className="divide-y divide-border">{data.security.credentials.map((credential: Row) => <div key={credential.id} className="px-5 py-4 flex items-center gap-4"><KeyRound size={18} className="text-primary" /><div className="flex-1"><p className="text-sm font-medium">{credential.device_name}</p><p className="mt-1 text-xs text-muted-foreground">{[credential.device_type, credential.os, credential.registered_from].filter(Boolean).join(' · ')}</p></div><Status value={credential.is_active ? 'active' : 'offboarded'} /></div>)}</div> : <Empty icon={Fingerprint} title="Sin credenciales" text="El miembro no ha registrado una passkey o dispositivo biométrico." />}</section>
    </div>}

    {tab === 'facultades' && <section className="rounded-lg border border-border bg-background overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Facultades de firma</h3><p className="mt-1 text-sm text-muted-foreground">Poderes y límites vigentes asociados directamente al miembro.</p></div>{data.authorities?.length ? <div className="divide-y divide-border">{data.authorities.map((authority: Row) => <div key={authority.id} className="px-5 py-4 flex gap-4"><BadgeCheck size={19} className="mt-0.5 text-primary" /><div className="flex-1"><p className="font-medium">{authority.authority_type}</p><p className="mt-1 text-sm text-muted-foreground">{authority.modality} · Vigencia: {formatDate(authority.valid_from)} a {formatDate(authority.valid_until)}</p>{authority.monetary_limit != null && <p className="mt-1 text-sm">Límite: {Number(authority.monetary_limit).toLocaleString('es-MX', { style: 'currency', currency: authority.currency || 'MXN' })}</p>}</div><Status value={authority.status} /></div>)}</div> : <Empty icon={BadgeCheck} title="Sin facultades asociadas" text="No existen poderes de firma vinculados a este miembro." />}</section>}

    {tab === 'trabajo' && data.work && <div className="grid xl:grid-cols-2 gap-5 items-start"><section className="rounded-lg border border-border bg-background overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Documentos propios</h3></div>{data.work.documents?.length ? <div className="divide-y divide-border">{data.work.documents.map((document: Row) => <div key={document.id} className="px-5 py-4 flex items-center gap-3"><FileText size={18} className="text-primary" /><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{document.nombre}</p><p className="mt-1 text-xs text-muted-foreground">{document.documento_id} · {formatDate(document.updated_at, true)}</p></div><Status value={document.estado} /></div>)}</div> : <Empty icon={FileText} title="Sin documentos propios" text="No hay documentos asignados a esta persona como propietaria." />}</section><section className="rounded-lg border border-border bg-background overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Tareas asignadas</h3></div>{data.work.tasks?.length ? <div className="divide-y divide-border">{data.work.tasks.map((task: Row) => <div key={task.id} className="px-5 py-4 flex items-center gap-3"><BriefcaseBusiness size={18} className="text-primary" /><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{task.title}</p><p className="mt-1 text-xs text-muted-foreground">{task.tipo} · vence {formatDate(task.due_date)}</p></div><Status value={task.estado} /></div>)}</div> : <Empty icon={BriefcaseBusiness} title="Sin tareas asignadas" text="Este miembro no tiene tareas organizacionales pendientes." />}</section></div>}

    {tab === 'auditoria' && <section className="rounded-lg border border-border bg-background overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Actividad auditada</h3><p className="mt-1 text-sm text-muted-foreground">Cambios administrativos y acciones relacionadas con el miembro.</p></div>{data.audit?.length ? <div className="divide-y divide-border">{data.audit.map((event: Row) => <div key={event.id} className="px-5 py-4 flex gap-4"><Activity size={17} className="mt-0.5 text-muted-foreground" /><div className="flex-1"><p className="text-sm font-medium">{event.summary}</p><p className="mt-1 text-xs text-muted-foreground">{event.event_type} · {event.origin}</p></div><div className="text-right"><Status value={event.outcome} /><p className="mt-1 text-xs text-muted-foreground">{formatDate(event.occurred_at, true)}</p></div></div>)}</div> : <Empty icon={Activity} title="Sin actividad auditada" text="Los eventos administrativos nuevos aparecerán aquí." />}</section>}

    {pendingAction && actionCopy && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
      <form onSubmit={confirmSensitiveAction} className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><LockKeyhole size={19} /></div>
          <div className="min-w-0 flex-1"><h3 id="reauth-title" className="font-medium">{actionCopy.title}</h3><p className="mt-1 text-sm text-muted-foreground">{actionCopy.description}</p></div>
          <button type="button" onClick={() => { setPendingAction(null); setReauthPassword(''); setReauthError(''); }} className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Cerrar"><span aria-hidden="true" className="text-xl leading-none">×</span></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-md border border-border bg-muted/40 px-3.5 py-3 text-sm text-muted-foreground">Confirma tu contraseña. La autorización temporal sólo será válida para esta clase de operación durante diez minutos.</div>
          {reauthError && <div role="alert" className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><CircleAlert size={17} className="mt-0.5 shrink-0" />{reauthError}</div>}
          <label className="block text-sm font-medium">Contraseña
            <span className="relative mt-1.5 block"><input autoFocus required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} className="h-11 w-full rounded-md border border-border bg-background px-3 pr-11 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /><button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-muted/20 px-5 py-4"><button type="button" onClick={() => { setPendingAction(null); setReauthPassword(''); setReauthError(''); }} className="h-10 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted">Cancelar</button><button disabled={reauthenticating || !reauthPassword} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50">{reauthenticating && <Loader2 size={16} className="animate-spin" />} Confirmar y continuar</button></div>
      </form>
    </div>}
  </div>;
}
