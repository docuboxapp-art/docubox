'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive, Building2, Check, ChevronRight, CircleAlert, Eye, EyeOff, KeyRound,
  Loader2, LockKeyhole, Plus, Save, ShieldCheck, UsersRound, X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type Row = Record<string, any>;
type Section = 'equipos' | 'roles';
type PendingRoleAction = { action: 'save_role' | 'archive_role'; payload: Row };

const emptyUnit = {
  id: null, name: '', internal_key: '', unit_type: 'team', description: '', parent_id: '',
  leader_member_id: '', deputy_member_id: '', cost_center_id: '', member_ids: [] as string[],
};
const emptyRole = { id: null, name: '', description: '', scope_type: 'organization', scope_config: {} };

function personOf(member: Row) {
  const profile = member?.user_profiles;
  return (Array.isArray(profile) ? profile[0] : profile) || {};
}

function labelType(value: string) {
  return ({ area: 'Área', department: 'Departamento', team: 'Equipo', branch: 'Sucursal', business_unit: 'Unidad de negocio' } as Row)[value] || value;
}

function orderUnits(rows: Row[]) {
  const byParent = new Map<string, Row[]>();
  rows.forEach((row) => {
    const key = row.parent_id || 'root';
    byParent.set(key, [...(byParent.get(key) || []), row]);
  });
  const ordered: Array<Row & { depth: number }> = [];
  const visited = new Set<string>();
  const visit = (parent: string, depth: number) => {
    (byParent.get(parent) || []).sort((a, b) => a.name.localeCompare(b.name, 'es')).forEach((row) => {
      if (visited.has(row.id)) return;
      visited.add(row.id); ordered.push({ ...row, depth }); visit(row.id, depth + 1);
    });
  };
  visit('root', 0);
  rows.filter((row) => !visited.has(row.id)).forEach((row) => ordered.push({ ...row, depth: 0 }));
  return ordered;
}

function Notice({ error, success }: { error: string; success: string }) {
  return <>{error && <div role="alert" className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><CircleAlert size={17} className="mt-0.5 shrink-0" />{error}</div>}{success && <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"><Check size={17} className="mt-0.5 shrink-0" />{success}</div>}</>;
}

export default function OrganizationStructureAdministration({ section }: { section: Section }) {
  const { session } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [data, setData] = useState<Row[]>([]);
  const [members, setMembers] = useState<Row[]>([]);
  const [memberships, setMemberships] = useState<Row[]>([]);
  const [costCenters, setCostCenters] = useState<Row[]>([]);
  const [permissions, setPermissions] = useState<Row[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unitForm, setUnitForm] = useState<Row>(emptyUnit);
  const [roleForm, setRoleForm] = useState<Row>(emptyRole);
  const [rolePermissionIds, setRolePermissionIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pendingRoleAction, setPendingRoleAction] = useState<PendingRoleAction | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [reauthError, setReauthError] = useState('');

  const request = useCallback(async (url: string, init?: RequestInit) => {
    if (!session?.access_token) throw new Error('La sesión no está disponible.');
    const response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'No se pudo completar la operación.');
    return payload;
  }, [session?.access_token]);

  const load = useCallback(async () => {
    if (!activeWorkspace?.id || !session?.access_token) return;
    setLoading(true); setError('');
    try {
      const resource = section === 'roles' ? 'roles' : 'units';
      const result = await request(`/api/organizacion/structure?workspace_id=${encodeURIComponent(activeWorkspace.id)}&resource=${resource}`);
      setData(result.data || []);
      setMembers(result.members || []);
      setMemberships(result.memberships || []);
      setCostCenters(result.cost_centers || []);
      setPermissions(result.permissions || []);
      setMemberCounts(result.member_counts || {});
    } catch (cause: any) { setError(cause?.message || 'No se pudo cargar la estructura.'); }
    finally { setLoading(false); }
  }, [activeWorkspace?.id, request, section, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const selectUnit = (unit: Row) => {
    setSelectedId(unit.id);
    setUnitForm({
      ...emptyUnit, ...unit,
      parent_id: unit.parent_id || '', leader_member_id: unit.leader_member_id || '',
      deputy_member_id: unit.deputy_member_id || '', cost_center_id: unit.cost_center_id || '',
      member_ids: memberships.filter((item) => item.unit_id === unit.id).map((item) => item.member_id),
    });
    setError(''); setSuccess('');
  };

  const selectRole = (role: Row) => {
    setSelectedId(role.id);
    setRoleForm({ ...emptyRole, ...role });
    setRolePermissionIds((role.organization_role_permissions || []).map((item: Row) => item.permission_id));
    setError(''); setSuccess('');
  };

  const saveUnit = async (event: FormEvent) => {
    event.preventDefault(); if (!activeWorkspace?.id) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const result = await request('/api/organizacion/structure', { method: 'POST', body: JSON.stringify({ workspace_id: activeWorkspace.id, action: 'save_unit', unit: unitForm }) });
      await request('/api/organizacion/structure', { method: 'POST', body: JSON.stringify({ workspace_id: activeWorkspace.id, action: 'set_unit_members', unit_id: result.id, member_ids: unitForm.member_ids || [] }) });
      setSuccess('La estructura de la unidad se guardó correctamente.');
      setSelectedId(result.id);
      setUnitForm((current) => ({ ...current, id: result.id }));
      await load();
    } catch (cause: any) { setError(cause?.message || 'No se pudo guardar la unidad.'); }
    finally { setSaving(false); }
  };

  const archiveUnit = async () => {
    if (!activeWorkspace?.id || !unitForm.id || !window.confirm('La unidad dejará de estar disponible para nuevas asignaciones. ¿Deseas archivarla?')) return;
    setSaving(true); setError('');
    try {
      await request('/api/organizacion/structure', { method: 'POST', body: JSON.stringify({ workspace_id: activeWorkspace.id, action: 'archive_unit', unit_id: unitForm.id }) });
      setSuccess('Unidad archivada.'); setSelectedId(null); setUnitForm(emptyUnit); await load();
    } catch (cause: any) { setError(cause?.message || 'No se pudo archivar la unidad.'); }
    finally { setSaving(false); }
  };

  const askRoleReauthentication = (action: PendingRoleAction['action'], payload: Row) => {
    setPendingRoleAction({ action, payload }); setPassword(''); setReauthError('');
  };

  const saveRole = (event: FormEvent) => {
    event.preventDefault();
    askRoleReauthentication('save_role', { role: roleForm, permission_ids: rolePermissionIds });
  };

  const executeRoleAction = async (token: string, pending: PendingRoleAction) => {
    if (!activeWorkspace?.id) return;
    if (pending.action === 'archive_role') {
      await request('/api/organizacion/structure', { method: 'POST', headers: { 'X-Organization-Reauth': token }, body: JSON.stringify({ workspace_id: activeWorkspace.id, action: 'archive_role', role_id: pending.payload.role_id }) });
      setSelectedId(null); setRoleForm(emptyRole); setRolePermissionIds([]);
      return;
    }
    const saved = await request('/api/organizacion/structure', { method: 'POST', headers: { 'X-Organization-Reauth': token }, body: JSON.stringify({ workspace_id: activeWorkspace.id, action: 'save_role', role: pending.payload.role }) });
    await request('/api/organizacion/structure', { method: 'POST', headers: { 'X-Organization-Reauth': token }, body: JSON.stringify({ workspace_id: activeWorkspace.id, action: 'set_role_permissions', role_id: saved.id, permission_ids: pending.payload.permission_ids }) });
    setSelectedId(saved.id);
    setRoleForm((current) => ({ ...current, id: saved.id }));
  };

  const confirmRoleAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingRoleAction || !activeWorkspace?.id || !password) return;
    setSaving(true); setReauthError(''); setError(''); setSuccess('');
    try {
      const auth = await request('/api/organizacion/reauthenticate', { method: 'POST', body: JSON.stringify({ workspace_id: activeWorkspace.id, password, scopes: ['roles.manage'] }) });
      await executeRoleAction(auth.token, pendingRoleAction);
      setSuccess(pendingRoleAction.action === 'archive_role' ? 'Rol archivado.' : 'Rol y permisos guardados correctamente.');
      setPendingRoleAction(null); setPassword(''); await load();
    } catch (cause: any) { setReauthError(cause?.message || 'No se pudo confirmar tu identidad.'); }
    finally { setSaving(false); }
  };

  const orderedUnits = useMemo(() => orderUnits(data), [data]);
  const permissionGroups = useMemo(() => permissions.reduce<Record<string, Row[]>>((groups, item) => {
    const key = item.category || 'Otros'; groups[key] = [...(groups[key] || []), item]; return groups;
  }, {}), [permissions]);
  const selectedRole = data.find((role) => role.id === selectedId);
  const roleProtected = Boolean(selectedRole?.is_system);
  const input = 'mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:bg-muted';

  return <div className="mx-auto max-w-[1450px] space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-medium">{section === 'equipos' ? 'Equipos y áreas' : 'Roles y permisos'}</h2><p className="mt-1 text-sm text-muted-foreground">{section === 'equipos' ? 'Estructura jerárquica, responsables y membresías de la organización.' : 'Permisos explícitos y alcance efectivo para cada función.'}</p></div><button onClick={() => { setSelectedId(null); section === 'equipos' ? setUnitForm(emptyUnit) : (setRoleForm(emptyRole), setRolePermissionIds([])); }} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"><Plus size={16} /> {section === 'equipos' ? 'Nueva unidad' : 'Nuevo rol'}</button></div>
    <Notice error={error} success={success} />
    <div className="grid items-start gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section className="overflow-hidden rounded-lg border border-border bg-background"><div className="border-b border-border px-5 py-4"><h3 className="font-medium">{section === 'equipos' ? 'Estructura' : 'Roles disponibles'}</h3><p className="mt-1 text-sm text-muted-foreground">{data.filter((item) => item.status !== 'archived' && item.status !== 'inactive').length} activos</p></div>{loading ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 size={17} className="animate-spin" /> Cargando...</div> : data.length ? <div className="max-h-[calc(100vh-310px)] overflow-y-auto divide-y divide-border">{section === 'equipos' ? orderedUnits.map((unit) => <button key={unit.id} onClick={() => selectUnit(unit)} className={`flex w-full items-center gap-2 px-4 py-3.5 text-left hover:bg-muted/50 ${selectedId === unit.id ? 'bg-primary/5' : ''}`} style={{ paddingLeft: 16 + unit.depth * 20 }}><ChevronRight size={14} className={unit.depth ? 'text-muted-foreground' : 'text-transparent'} /><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${unit.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}><Building2 size={15} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{unit.name}</span><span className="block truncate text-xs text-muted-foreground">{labelType(unit.unit_type)} · {memberships.filter((item) => item.unit_id === unit.id).length} miembros</span></span></button>) : data.map((role) => <button key={role.id} onClick={() => selectRole(role)} className={`flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/50 ${selectedId === role.id ? 'bg-primary/5' : ''}`}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><ShieldCheck size={16} /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-medium">{role.name}</span>{role.is_system && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Sistema</span>}</span><span className="mt-0.5 block text-xs text-muted-foreground">{memberCounts[role.id] || 0} miembros · {role.scope_type || 'organization'}</span></span></button>)}</div> : <div className="px-6 py-16 text-center text-sm text-muted-foreground">Todavía no hay registros.</div>}</section>

      {section === 'equipos' ? <form onSubmit={saveUnit} className="overflow-hidden rounded-lg border border-border bg-background"><div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h3 className="font-medium">{unitForm.id ? 'Editar unidad' : 'Nueva unidad'}</h3><p className="mt-1 text-sm text-muted-foreground">La jerarquía no permite dependencias circulares.</p></div>{unitForm.id && <button type="button" onClick={archiveUnit} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-600 hover:bg-red-50"><Archive size={15} /> Archivar</button>}</div><div className="grid gap-4 p-5 sm:grid-cols-2"><label className="text-sm">Nombre<input required value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })} className={input} /></label><label className="text-sm">Clave interna<input value={unitForm.internal_key || ''} onChange={(e) => setUnitForm({ ...unitForm, internal_key: e.target.value })} className={`${input} uppercase`} placeholder="LEGAL-MX" /></label><label className="text-sm">Tipo<select value={unitForm.unit_type} onChange={(e) => setUnitForm({ ...unitForm, unit_type: e.target.value })} className={input}><option value="area">Área</option><option value="department">Departamento</option><option value="team">Equipo</option><option value="branch">Sucursal</option><option value="business_unit">Unidad de negocio</option></select></label><label className="text-sm">Unidad superior<select value={unitForm.parent_id || ''} onChange={(e) => setUnitForm({ ...unitForm, parent_id: e.target.value })} className={input}><option value="">Nivel principal</option>{data.filter((unit) => unit.id !== unitForm.id && unit.status === 'active').map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="text-sm">Responsable<select value={unitForm.leader_member_id || ''} onChange={(e) => setUnitForm({ ...unitForm, leader_member_id: e.target.value })} className={input}><option value="">Sin asignar</option>{members.map((member) => <option key={member.id} value={member.id}>{personOf(member).full_name || personOf(member).email}</option>)}</select></label><label className="text-sm">Suplente<select value={unitForm.deputy_member_id || ''} onChange={(e) => setUnitForm({ ...unitForm, deputy_member_id: e.target.value })} className={input}><option value="">Sin asignar</option>{members.map((member) => <option key={member.id} value={member.id}>{personOf(member).full_name || personOf(member).email}</option>)}</select></label><label className="text-sm">Centro de costo<select value={unitForm.cost_center_id || ''} onChange={(e) => setUnitForm({ ...unitForm, cost_center_id: e.target.value })} className={input}><option value="">Sin centro</option>{costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}</select></label><label className="text-sm sm:col-span-2">Descripción<textarea value={unitForm.description || ''} onChange={(e) => setUnitForm({ ...unitForm, description: e.target.value })} className="mt-1.5 min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm" /></label><fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Miembros</legend><div className="mt-2 grid max-h-52 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">{members.map((member) => { const checked = (unitForm.member_ids || []).includes(member.id); const profile = personOf(member); return <label key={member.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"><input type="checkbox" checked={checked} onChange={(e) => setUnitForm({ ...unitForm, member_ids: e.target.checked ? [...(unitForm.member_ids || []), member.id] : (unitForm.member_ids || []).filter((id: string) => id !== member.id) })} className="h-4 w-4" /><span className="min-w-0"><span className="block truncate">{profile.full_name || profile.email}</span><span className="block truncate text-xs text-muted-foreground">{profile.email}</span></span></label>; })}</div></fieldset></div><div className="flex justify-end border-t border-border bg-muted/20 px-5 py-4"><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar unidad</button></div></form>
      : <form onSubmit={saveRole} className="overflow-hidden rounded-lg border border-border bg-background"><div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h3 className="font-medium">{roleForm.id ? roleForm.name : 'Nuevo rol'}</h3><p className="mt-1 text-sm text-muted-foreground">{roleProtected ? 'Rol base protegido; clónalo para personalizarlo.' : `${memberCounts[roleForm.id] || 0} miembros recibirán los cambios.`}</p></div>{roleForm.id && !roleProtected && <button type="button" onClick={() => { if (window.confirm('Sólo podrás archivarlo cuando no tenga miembros asignados. ¿Continuar?')) askRoleReauthentication('archive_role', { role_id: roleForm.id }); }} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-600"><Archive size={15} /> Archivar</button>}</div><div className="grid gap-4 p-5 sm:grid-cols-2"><label className="text-sm">Nombre<input required disabled={roleProtected} value={roleForm.name || ''} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} className={input} /></label><label className="text-sm">Alcance<select disabled={roleProtected} value={roleForm.scope_type || 'organization'} onChange={(e) => setRoleForm({ ...roleForm, scope_type: e.target.value })} className={input}><option value="organization">Toda la organización</option><option value="units">Unidades seleccionadas</option><option value="team">Sólo equipo</option><option value="own">Elementos propios</option><option value="assigned">Elementos asignados</option><option value="custom">Personalizado</option></select></label><label className="text-sm sm:col-span-2">Descripción<textarea disabled={roleProtected} value={roleForm.description || ''} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} className="mt-1.5 min-h-20 w-full rounded-md border border-border bg-background p-3 text-sm disabled:bg-muted" /></label></div><div className="border-t border-border px-5 py-4"><h4 className="font-medium">Permisos</h4><p className="mt-1 text-sm text-muted-foreground">Denegación por defecto: sólo se habilitan las acciones seleccionadas.</p></div><div className="max-h-[430px] space-y-5 overflow-y-auto px-5 pb-5">{Object.entries(permissionGroups).map(([category, items]) => <fieldset key={category}><legend className="mb-2 text-xs font-medium uppercase text-muted-foreground">{category}</legend><div className="grid gap-2 sm:grid-cols-2">{items.map((permission) => <label key={permission.id} className="flex gap-3 rounded-md border border-border p-3 text-sm"><input type="checkbox" disabled={roleProtected} checked={rolePermissionIds.includes(permission.id)} onChange={(e) => setRolePermissionIds((current) => e.target.checked ? [...current, permission.id] : current.filter((id) => id !== permission.id))} className="mt-0.5 h-4 w-4" /><span><span className="block font-medium">{permission.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{permission.description || permission.permission_key}</span></span></label>)}</div></fieldset>)}</div>{!roleProtected && <div className="flex justify-end border-t border-border bg-muted/20 px-5 py-4"><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"><Save size={16} /> Guardar rol</button></div>}</form>}
    </div>

    {pendingRoleAction && <div className="fixed inset-0 z-[130] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true"><form onSubmit={confirmRoleAction} className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-background shadow-2xl"><div className="flex items-start gap-3 border-b border-border p-5"><span className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary"><LockKeyhole size={18} /></span><div className="flex-1"><h3 className="font-medium">Confirmar administración de roles</h3><p className="mt-1 text-sm text-muted-foreground">Esta operación cambia privilegios efectivos de la organización.</p></div><button type="button" onClick={() => setPendingRoleAction(null)} className="grid h-9 w-9 place-items-center rounded-md hover:bg-muted" aria-label="Cerrar"><X size={17} /></button></div><div className="space-y-4 p-5">{reauthError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{reauthError}</div>}<label className="block text-sm font-medium">Contraseña<span className="relative mt-1.5 block"><input autoFocus required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 w-full rounded-md border border-border bg-background px-3 pr-11 text-sm" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label></div><div className="flex justify-end gap-2 border-t border-border bg-muted/20 p-4"><button type="button" onClick={() => setPendingRoleAction(null)} className="h-10 rounded-md border border-border px-4 text-sm">Cancelar</button><button disabled={saving || !password} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />} Confirmar</button></div></form></div>}
  </div>;
}
