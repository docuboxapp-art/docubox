'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity, BadgeCheck, Building2, Check, CircleAlert, FileKey2, Fingerprint,
  IdCard, Link2, Loader2, MailCheck, Network, Palette, Plus, ReceiptText, RefreshCw, Save,
  ScrollText, ShieldCheck, UserPlus, Users, UsersRound, Workflow, XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export type SectionKey = 'perfil' | 'miembros' | 'equipos' | 'roles' | 'directorio' |
  'facultades' | 'flujos' | 'politicas-firma' | 'seguridad' | 'certificados' |
  'integraciones' | 'marca' | 'plan-consumo' | 'auditoria';

type Row = Record<string, any>;
type Icon = typeof Building2;

const meta: Record<SectionKey, { title: string; description: string; icon: Icon }> = {
  perfil: { title: 'Perfil de la organización', description: 'Datos generales, fiscales, legales y de contacto.', icon: Building2 },
  miembros: { title: 'Miembros', description: 'Acceso, invitaciones y ciclo de vida de las personas usuarias.', icon: Users },
  equipos: { title: 'Equipos y áreas', description: 'Estructura operativa y responsables de cada unidad.', icon: UsersRound },
  roles: { title: 'Roles y permisos', description: 'Permisos RBAC aplicados dentro de esta organización.', icon: ShieldCheck },
  directorio: { title: 'Directorio', description: 'Personas internas y externas relacionadas con la organización.', icon: IdCard },
  facultades: { title: 'Facultades y poderes', description: 'Alcances, vigencias y evidencia de representación.', icon: BadgeCheck },
  flujos: { title: 'Flujos de aprobación', description: 'Reglas versionadas para revisión y autorización.', icon: Workflow },
  'politicas-firma': { title: 'Políticas de firma', description: 'Métodos permitidos y requisitos de evidencia.', icon: FileKey2 },
  seguridad: { title: 'Seguridad', description: 'Controles exigidos a los miembros de la organización.', icon: Fingerprint },
  certificados: { title: 'Certificados', description: 'Inventario público, vigencias y estado criptográfico.', icon: ScrollText },
  integraciones: { title: 'Integraciones', description: 'Conexiones autorizadas sin exponer secretos en el navegador.', icon: Network },
  marca: { title: 'Marca y comunicaciones', description: 'Identidad visual aplicada a experiencias organizacionales.', icon: Palette },
  'plan-consumo': { title: 'Plan y consumo', description: 'Límites contratados y uso registrado del espacio.', icon: ReceiptText },
  auditoria: { title: 'Auditoría', description: 'Registro inmutable de acciones administrativas.', icon: Activity },
};

const resources: Partial<Record<SectionKey, { table: string; name: string }>> = {
  equipos: { table: 'organization_units', name: 'name' },
  roles: { table: 'organization_roles', name: 'name' },
  directorio: { table: 'organization_directory_people', name: 'full_name' },
  facultades: { table: 'organization_authorities', name: 'authority_type' },
  flujos: { table: 'organization_approval_workflows', name: 'name' },
  'politicas-firma': { table: 'organization_signature_policies', name: 'name' },
};

const managePermission: Partial<Record<SectionKey, string>> = {
  perfil: 'organization.profile.update',
  miembros: 'members.update',
  equipos: 'teams.manage',
  roles: 'roles.manage',
  directorio: 'directory.manage',
  facultades: 'authorities.manage',
  flujos: 'workflows.manage',
  'politicas-firma': 'signature_policies.manage',
  seguridad: 'security.manage',
  certificados: 'certificates.manage',
  integraciones: 'integrations.manage',
  marca: 'branding.manage',
  'plan-consumo': 'billing.manage',
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function labelStatus(value?: string | null) {
  const values: Record<string, string> = {
    active: 'Activo', pending: 'Pendiente', suspended: 'Suspendido', blocked: 'Bloqueado',
    offboarded: 'Baja', draft: 'Borrador', archived: 'Archivado', connected: 'Conectado',
    degraded: 'Degradado', disabled: 'Deshabilitado', error: 'Error', valid: 'Válido',
    expiring: 'Próximo a vencer', expired: 'Vencido', revoked: 'Revocado',
    not_configured: 'No configurado', not_started: 'No iniciado', identity_verified: 'Identidad acreditada',
  };
  return values[value || ''] || value?.replaceAll('_', ' ') || 'Sin estado';
}

function Status({ value }: { value?: string | null }) {
  const positive = ['active', 'connected', 'valid', 'identity_verified', 'verified'].includes(value || '');
  const warning = ['pending', 'draft', 'not_configured', 'not_started', 'expiring'].includes(value || '');
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${positive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : warning ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-border bg-muted text-muted-foreground'}`}>{labelStatus(value)}</span>;
}

function Header({ section, children }: { section: SectionKey; children?: React.ReactNode }) {
  return <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3"><div><h2 className="text-xl font-medium text-foreground">{meta[section].title}</h2><p className="mt-1 text-sm text-muted-foreground">{meta[section].description}</p></div>{children}</div>;
}

function Empty({ icon: Icon, title, text }: { icon: Icon; title: string; text: string }) {
  return <div className="py-14 px-5 text-center"><Icon size={28} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">{text}</p></div>;
}

export default function OrganizationSections({ section }: { section: SectionKey }) {
  const { activeWorkspace } = useWorkspace();
  const { user, session } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const elevatedRole = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const requiredPermission = managePermission[section];
  const canManage = elevatedRole || Boolean(requiredPermission && permissionKeys.includes(requiredPermission));
  const canInvite = elevatedRole || permissionKeys.includes('members.invite');
  const canSuspendMembers = elevatedRole || permissionKeys.includes('members.suspend');
  const canOffboardMembers = elevatedRole || permissionKeys.includes('members.offboard');
  const canManageRoles = elevatedRole || permissionKeys.includes('roles.manage');
  const [rows, setRows] = useState<Row[]>([]);
  const [extra, setExtra] = useState<Row[]>([]);
  const [record, setRecord] = useState<Row>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [inviteUnit, setInviteUnit] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedRolePermissions, setSelectedRolePermissions] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true); setError('');
    const id = activeWorkspace.id;
    try {
      if (['perfil', 'seguridad', 'marca'].includes(section)) {
        const result = await supabase.from('workspaces').select('*').eq('id', id).single();
        if (result.error) throw result.error;
        setRecord(result.data || {}); setRows([]);
      } else if (section === 'miembros') {
        const [members, invitationsResponse, roles, units] = await Promise.all([
          supabase.from('workspace_members').select('id,user_id,role,status,job_title,mfa_required,biometric_required,joined_at,user_profiles(full_name,email)').eq('workspace_id', id).order('joined_at'),
          session?.access_token
            ? fetch(`/api/organizacion/invitations?workspace_id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
            : Promise.resolve(null),
          supabase.from('organization_roles').select('id,name,system_key').eq('workspace_id', id).order('name'),
          supabase.from('organization_units').select('id,name').eq('workspace_id', id).eq('status', 'active').order('name'),
        ]);
        if (members.error) throw members.error;
        const invitationPayload = invitationsResponse ? await invitationsResponse.json().catch(() => ({})) : {};
        if (invitationsResponse && !invitationsResponse.ok) throw new Error(invitationPayload.error || 'No se pudieron cargar las invitaciones.');
        setRows(members.data || []); setExtra(invitationPayload.data || []); setRecord({ roles: roles.data || [], units: units.data || [] });
      } else if (section === 'integraciones') {
        const result = await supabase.from('organization_integrations').select('*').eq('workspace_id', id).order('display_name');
        if (result.error) throw result.error; setRows(result.data || []);
      } else if (section === 'certificados') {
        const result = await supabase.from('organization_certificates').select('*').eq('workspace_id', id).order('created_at', { ascending: false });
        if (result.error) throw result.error; setRows(result.data || []);
      } else if (section === 'roles') {
        const [roles, permissions] = await Promise.all([
          supabase.from('organization_roles').select('*,organization_role_permissions(permission_id)').eq('workspace_id', id).order('is_system', { ascending: false }).order('name'),
          supabase.from('organization_permissions').select('id,permission_key,name,description,category').order('category').order('name'),
        ]);
        if (roles.error) throw roles.error;
        if (permissions.error) throw permissions.error;
        setRows(roles.data || []);
        setExtra(permissions.data || []);
      } else if (section === 'plan-consumo') {
        const [subscription, usage] = await Promise.all([
          supabase.from('subscriptions').select('*,subscription_plans(name,slug)').eq('workspace_id', id).maybeSingle(),
          supabase.from('organization_usage_ledger').select('*').eq('workspace_id', id).order('occurred_at', { ascending: false }).limit(100),
        ]);
        if (subscription.error) throw subscription.error;
        setRecord(subscription.data || {}); setRows(usage.data || []);
      } else if (section === 'auditoria') {
        const result = await supabase.from('organization_audit_events').select('*').eq('workspace_id', id).order('occurred_at', { ascending: false }).limit(200);
        if (result.error) throw result.error; setRows(result.data || []);
      } else {
        const config = resources[section];
        if (!config) return;
        const result = await supabase.from(config.table).select('*').eq('workspace_id', id).order('created_at', { ascending: false });
        if (result.error) throw result.error; setRows(result.data || []);
      }
    } catch (cause: any) { setError(cause?.message || 'No se pudo cargar la información.'); }
    finally { setLoading(false); }
  }, [activeWorkspace?.id, section, session?.access_token, supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!activeWorkspace?.id) {
      setPermissionKeys([]);
      return;
    }

    let active = true;
    supabase
      .rpc('get_my_organization_permissions', { ws_id: activeWorkspace.id })
      .then(({ data, error: permissionError }) => {
        if (!active) return;
        if (permissionError) {
          setPermissionKeys([]);
          return;
        }
        setPermissionKeys((data || []).map((item: Row) => item.permission_key));
      });

    return () => { active = false; };
  }, [activeWorkspace?.id, supabase]);

  const audit = async (eventType: string, resourceType: string, resourceId: string | null, summary: string) => {
    if (!activeWorkspace?.id || !user?.id) return;
    await supabase.from('organization_audit_events').insert({ workspace_id: activeWorkspace.id, actor_user_id: user.id, event_type: eventType, resource_type: resourceType, resource_id: resourceId, summary });
  };

  const notices = <>{error && <div className="border border-red-200 bg-red-50 text-red-700 rounded-md px-4 py-3 text-sm flex gap-2"><CircleAlert size={17} />{error}</div>}{success && <div className="border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-md px-4 py-3 text-sm flex gap-2"><Check size={17} />{success}</div>}</>;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); if (!activeWorkspace?.id || !canManage) return;
    setSaving(true); setError(''); setSuccess('');
    const allowed = ['name', 'legal_name', 'trade_name', 'rfc', 'legal_person_type', 'tax_regime', 'industry', 'website', 'contact_email', 'contact_phone', 'timezone'];
    const payload = Object.fromEntries(allowed.map((key) => [key, record[key] || null]));
    const result = await supabase.from('workspaces').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', activeWorkspace.id);
    if (result.error) setError(result.error.message); else { await audit('organization.profile.updated', 'workspace', activeWorkspace.id, 'Perfil de la organización actualizado'); setSuccess('Los cambios se guardaron correctamente.'); }
    setSaving(false);
  };

  const saveSettings = async (column: 'security_settings' | 'branding_settings') => {
    if (!activeWorkspace?.id || !canManage) return;
    setSaving(true); setError(''); setSuccess('');
    const result = await supabase.from('workspaces').update({ [column]: record[column] || {}, updated_at: new Date().toISOString() }).eq('id', activeWorkspace.id);
    if (result.error) setError(result.error.message); else { await audit(`organization.${column}.updated`, 'workspace', activeWorkspace.id, 'Configuración organizacional actualizada'); setSuccess('Configuración guardada.'); }
    setSaving(false);
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault(); if (!activeWorkspace?.id || !session?.access_token || !canInvite || !inviteEmail.trim()) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const response = await fetch('/api/organizacion/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          email: inviteEmail.trim().toLowerCase(),
          role_id: inviteRole || null,
          unit_id: inviteUnit || null,
          message: inviteMessage.trim() || null,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo enviar la invitación.');
      setInviteEmail(''); setInviteRole(''); setInviteUnit(''); setInviteMessage(''); setShowCreate(false);
      setSuccess('Invitación enviada correctamente.');
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo enviar la invitación.');
    }
    setSaving(false);
  };

  const updateInvitation = async (invitationId: string, action: 'resend' | 'revoke') => {
    if (!activeWorkspace?.id || !session?.access_token || !canInvite) return;
    if (action === 'revoke' && !window.confirm('La persona ya no podrá utilizar este enlace. ¿Deseas cancelar la invitación?')) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const response = await fetch('/api/organizacion/invitations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspace_id: activeWorkspace.id, invitation_id: invitationId, action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo actualizar la invitación.');
      setSuccess(action === 'resend' ? 'Invitación reenviada.' : 'Invitación cancelada.');
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo actualizar la invitación.');
    } finally {
      setSaving(false);
    }
  };

  const createResource = async (event: FormEvent) => {
    event.preventDefault(); const config = resources[section];
    if (!config || !activeWorkspace?.id || !newName.trim()) return;
    setSaving(true); setError('');
    const payload: Row = { workspace_id: activeWorkspace.id, [config.name]: newName.trim(), created_by: user?.id || null };
    if (section === 'facultades') payload.scope = {};
    const result = await supabase.from(config.table).insert(payload).select('id').single();
    if (result.error) setError(result.error.message); else { await audit(`${section}.created`, config.table, result.data.id, `${meta[section].title}: ${newName.trim()}`); setNewName(''); setShowCreate(false); setSuccess('Registro creado correctamente.'); await load(); }
    setSaving(false);
  };

  const selectRole = (role: Row) => {
    const permissionIds = new Set(
      (role.organization_role_permissions || []).map((item: Row) => item.permission_id)
    );
    setSelectedRoleId(role.id);
    setSelectedRolePermissions(
      extra.filter((permission) => permissionIds.has(permission.id)).map((permission) => permission.permission_key)
    );
    setError('');
    setSuccess('');
  };

  const saveRolePermissions = async () => {
    if (!activeWorkspace?.id || !selectedRoleId || !canManage) return;
    setSaving(true); setError(''); setSuccess('');
    const result = await supabase.rpc('set_organization_role_permissions', {
      ws_id: activeWorkspace.id,
      target_role_id: selectedRoleId,
      permission_keys: selectedRolePermissions,
    });
    if (result.error) setError(result.error.message);
    else { setSuccess('Permisos del rol actualizados.'); await load(); }
    setSaving(false);
  };

  if (section === 'perfil') return (
    <form onSubmit={saveProfile} className="max-w-[1200px] mx-auto space-y-5"><Header section={section}>{canManage && <button disabled={saving} className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"><Save size={16} /> Guardar cambios</button>}</Header>{notices}
      <section className="bg-background border border-border rounded-lg overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Datos generales</h3></div><div className="p-5 grid md:grid-cols-2 gap-4">{[
        ['name', 'Nombre del espacio'], ['legal_name', 'Razón social'], ['trade_name', 'Nombre comercial'], ['rfc', 'RFC'], ['legal_person_type', 'Tipo de persona'], ['tax_regime', 'Régimen fiscal'], ['industry', 'Industria'], ['website', 'Sitio web'], ['contact_email', 'Correo de contacto'], ['contact_phone', 'Teléfono'], ['timezone', 'Zona horaria'],
      ].map(([key, label]) => <label key={key}><span className="text-sm">{label}</span><input disabled={!canManage || loading} value={record[key] || ''} onChange={(e) => setRecord((current) => ({ ...current, [key]: e.target.value }))} className="mt-1.5 w-full h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary disabled:bg-muted" /></label>)}</div></section>
      <section className="bg-background border border-border rounded-lg p-5 flex gap-3"><ShieldCheck size={19} className="text-primary mt-0.5" /><div><h3 className="font-medium">Verificación empresarial</h3><p className="mt-1 text-sm text-muted-foreground">Los estados dependen de evidencia validada y no se activan manualmente.</p><div className="mt-3 flex gap-2"><Status value={record.verification_status} /><Status value={record.kyb_status} /></div></div></section>
    </form>
  );

  if (section === 'miembros') return (
    <div className="max-w-[1400px] mx-auto space-y-5"><Header section={section}>{canInvite && <button onClick={() => setShowCreate(!showCreate)} className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"><UserPlus size={16} /> Invitar miembro</button>}</Header>{notices}
      {showCreate && <form onSubmit={invite} className="bg-background border border-border rounded-lg overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Nueva invitación</h3><p className="mt-1 text-sm text-muted-foreground">El enlace será de un solo uso y vencerá en siete días.</p></div><div className="p-5 grid md:grid-cols-2 gap-4"><label><span className="text-sm">Correo electrónico</span><input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="mt-1.5 w-full h-10 rounded-md border border-border bg-background px-3 text-sm" placeholder="persona@empresa.com" /></label><label><span className="text-sm">Rol inicial</span><select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="mt-1.5 w-full h-10 rounded-md border border-border px-3 text-sm bg-background"><option value="">Miembro</option>{(record.roles || []).filter((role: Row) => role.system_key !== 'owner' && (canManageRoles || role.system_key === 'member')).map((role: Row) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label><span className="text-sm">Equipo o área</span><select value={inviteUnit} onChange={(e) => setInviteUnit(e.target.value)} className="mt-1.5 w-full h-10 rounded-md border border-border px-3 text-sm bg-background"><option value="">Sin asignar</option>{(record.units || []).map((unit: Row) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label><span className="text-sm">Mensaje opcional</span><input value={inviteMessage} maxLength={500} onChange={(e) => setInviteMessage(e.target.value)} className="mt-1.5 w-full h-10 rounded-md border border-border bg-background px-3 text-sm" placeholder="Contexto para la persona invitada" /></label></div><div className="px-5 py-4 border-t border-border bg-muted/30 flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="h-10 px-4 rounded-md border border-border bg-background text-sm font-medium">Cancelar</button><button disabled={saving} className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <MailCheck size={16} />} Enviar invitación</button></div></form>}
      <section className="bg-background border border-border rounded-lg overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Miembros y accesos</h3></div>{loading ? <div className="py-12 text-center text-sm text-muted-foreground">Cargando miembros...</div> : rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60"><tr><th className="text-left font-medium px-5 py-3">Persona</th><th className="text-left font-medium px-4 py-3">Rol</th><th className="text-left font-medium px-4 py-3">Estado</th><th className="text-right font-medium px-5 py-3">Acciones</th></tr></thead><tbody className="divide-y divide-border">{rows.map((member) => { const person = Array.isArray(member.user_profiles) ? member.user_profiles[0] : member.user_profiles; return <tr key={member.id}><td className="px-5 py-3.5"><Link href={`/organizacion/miembros/${member.id}`} className="font-medium hover:text-primary">{person?.full_name || person?.email || 'Usuario'}</Link><p className="text-xs text-muted-foreground mt-0.5">{person?.email}</p></td><td className="px-4 py-3.5 capitalize">{member.role}</td><td className="px-4 py-3.5"><Status value={member.status} /></td><td className="px-5 py-3.5 text-right"><div className="inline-flex gap-3"><Link href={`/organizacion/miembros/${member.id}`} className="text-primary">Administrar</Link>{member.role !== 'owner' && canOffboardMembers && member.status !== 'offboarded' && <Link href={`/organizacion/continuidad?member=${member.id}`} className="text-red-600">Dar de baja</Link>}</div></td></tr>; })}</tbody></table></div> : <Empty icon={Users} title="Sin miembros visibles" text="Invita a la primera persona para delegar responsabilidades." />}</section>
      <section className="bg-background border border-border rounded-lg overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Invitaciones</h3><p className="mt-1 text-sm text-muted-foreground">Seguimiento de entrega, vigencia y aceptación.</p></div>{extra.length ? <div className="divide-y divide-border">{extra.map((item) => <div key={item.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3"><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{item.email}</p><p className="text-xs text-muted-foreground mt-1">{item.organization_roles?.name || 'Miembro'}{item.organization_units?.name ? ` · ${item.organization_units.name}` : ''} · Expira {formatDate(item.expires_at)}</p></div><div className="flex flex-wrap items-center gap-2"><Status value={item.delivery_status === 'failed' ? 'error' : item.status} />{item.status === 'pending' && canInvite && <><button disabled={saving} onClick={() => updateInvitation(item.id, 'resend')} className="h-8 px-2.5 rounded-md border border-border text-xs font-medium inline-flex items-center gap-1.5"><RefreshCw size={13} /> Reenviar</button><button disabled={saving} onClick={() => updateInvitation(item.id, 'revoke')} className="h-8 px-2.5 rounded-md border border-red-200 text-red-600 text-xs font-medium inline-flex items-center gap-1.5"><XCircle size={13} /> Cancelar</button></>}</div></div>)}</div> : <div className="px-5 py-8 text-center text-sm text-muted-foreground">No hay invitaciones registradas.</div>}</section>
    </div>
  );

  if (section === 'roles') {
    const selectedRole = rows.find((role) => role.id === selectedRoleId);
    const permissionGroups = extra.reduce<Record<string, Row[]>>((groups, permission) => {
      const category = permission.category || 'Otros';
      groups[category] = [...(groups[category] || []), permission];
      return groups;
    }, {});
    return <div className="max-w-[1400px] mx-auto space-y-5"><Header section={section}>{canManage && <button onClick={() => setShowCreate(!showCreate)} className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"><Plus size={16} /> Nuevo rol</button>}</Header>{notices}
      {showCreate && <form onSubmit={createResource} className="bg-background border border-border rounded-lg p-5 flex gap-3 items-end"><label className="flex-1"><span className="text-sm">Nombre del rol</span><input required value={newName} onChange={(event) => setNewName(event.target.value)} className="mt-1.5 w-full h-10 rounded-md border border-border px-3" /></label><button disabled={saving} className="h-10 px-4 rounded-md bg-primary text-white text-sm">Crear rol</button></form>}
      <div className="grid lg:grid-cols-[360px_minmax(0,1fr)] gap-5 items-start">
        <section className="bg-background border border-border rounded-lg overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Roles disponibles</h3></div>{loading ? <div className="py-12 text-center text-sm text-muted-foreground">Cargando roles...</div> : <div className="divide-y divide-border">{rows.map((role) => <button key={role.id} type="button" onClick={() => selectRole(role)} className={`w-full px-5 py-4 text-left hover:bg-muted/50 ${selectedRoleId === role.id ? 'bg-primary/5' : ''}`}><div className="flex items-center gap-2"><span className="font-medium text-sm flex-1">{role.name}</span>{role.is_system && <span className="text-[11px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Sistema</span>}</div><p className="mt-1 text-xs text-muted-foreground">{role.description || 'Rol personalizado'}</p></button>)}</div>}</section>
        <section className="bg-background border border-border rounded-lg overflow-hidden">{selectedRole ? <><div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3"><div><h3 className="font-medium">Permisos de {selectedRole.name}</h3><p className="mt-0.5 text-sm text-muted-foreground">{selectedRole.is_system ? 'Los roles base están protegidos para conservar un acceso seguro.' : 'Selecciona únicamente las capacidades necesarias.'}</p></div>{!selectedRole.is_system && canManage && <button onClick={saveRolePermissions} disabled={saving} className="h-9 px-3 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"><Save size={15} /> Guardar</button>}</div><div className="p-5 space-y-5">{Object.entries(permissionGroups).map(([category, permissions]) => <div key={category}><h4 className="text-xs font-medium uppercase text-muted-foreground">{category}</h4><div className="mt-2 grid md:grid-cols-2 gap-2">{permissions.map((permission) => <label key={permission.id} className="flex gap-3 rounded-md border border-border p-3"><input type="checkbox" disabled={Boolean(selectedRole.is_system) || !canManage} checked={selectedRolePermissions.includes(permission.permission_key)} onChange={(event) => setSelectedRolePermissions((current) => event.target.checked ? [...current, permission.permission_key] : current.filter((key) => key !== permission.permission_key))} className="mt-0.5 w-4 h-4" /><span><span className="block text-sm font-medium">{permission.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{permission.description}</span></span></label>)}</div></div>)}</div></> : <Empty icon={ShieldCheck} title="Selecciona un rol" text="Consulta sus permisos o configura un rol personalizado." />}</section>
      </div>
    </div>;
  }

  if (section === 'seguridad') {
    const settings = record.security_settings || {};
    return <div className="max-w-[1100px] mx-auto space-y-5"><Header section={section}>{canManage && <button onClick={() => saveSettings('security_settings')} disabled={saving} className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"><Save size={16} /> Guardar</button>}</Header>{notices}<section className="bg-background border border-border rounded-lg overflow-hidden divide-y divide-border">{[
      ['require_mfa', 'Exigir autenticación multifactor', 'Requiere un segundo factor compatible.'], ['require_biometric', 'Exigir autenticación biométrica', 'Usa WebAuthn/FIDO2 cuando el dispositivo lo permita.'], ['block_expired_access', 'Bloquear accesos vencidos', 'Impide operar al concluir la vigencia del miembro.'],
    ].map(([key, title, text]) => <label key={key} className="flex items-start gap-4 px-5 py-4"><input type="checkbox" disabled={!canManage} checked={Boolean(settings[key])} onChange={(e) => setRecord((current) => ({ ...current, security_settings: { ...settings, [key]: e.target.checked } }))} className="mt-1 w-4 h-4" /><div><p className="text-sm font-medium">{title}</p><p className="text-sm text-muted-foreground mt-0.5">{text}</p></div></label>)}</section><div className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm text-amber-800">Docubox mantiene un control como pendiente cuando su proveedor técnico no puede verificarse.</div></div>;
  }

  if (section === 'marca') {
    const branding = record.branding_settings || {};
    return <div className="max-w-[1100px] mx-auto space-y-5"><Header section={section}>{canManage && <button onClick={() => saveSettings('branding_settings')} disabled={saving} className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"><Save size={16} /> Guardar</button>}</Header>{notices}<section className="bg-background border border-border rounded-lg p-5 grid md:grid-cols-2 gap-4"><label><span className="text-sm">Color principal</span><input type="color" disabled={!canManage} value={branding.primary_color || '#1E6BFF'} onChange={(e) => setRecord((current) => ({ ...current, branding_settings: { ...branding, primary_color: e.target.value } }))} className="mt-1.5 block w-full h-10 border border-border rounded-md p-1" /></label><label><span className="text-sm">Nombre mostrado</span><input disabled={!canManage} value={branding.display_name || ''} onChange={(e) => setRecord((current) => ({ ...current, branding_settings: { ...branding, display_name: e.target.value } }))} className="mt-1.5 block w-full h-10 border border-border rounded-md px-3" /></label><label className="md:col-span-2"><span className="text-sm">URL del logotipo</span><input disabled={!canManage} value={branding.logo_url || ''} onChange={(e) => setRecord((current) => ({ ...current, branding_settings: { ...branding, logo_url: e.target.value } }))} className="mt-1.5 block w-full h-10 border border-border rounded-md px-3" placeholder="https://..." /></label></section></div>;
  }

  if (section === 'plan-consumo') {
    const plan = Array.isArray(record.subscription_plans) ? record.subscription_plans[0] : record.subscription_plans;
    return <div className="max-w-[1200px] mx-auto space-y-5"><Header section={section} />{notices}<section className="grid sm:grid-cols-3 bg-background border border-border rounded-lg overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-border"><div className="p-5"><p className="text-sm text-muted-foreground">Plan actual</p><p className="mt-2 text-xl font-medium">{plan?.name || 'Sin plan identificado'}</p></div><div className="p-5"><p className="text-sm text-muted-foreground">Documentos usados</p><p className="mt-2 text-xl font-medium">{record.documents_used ?? 0}</p></div><div className="p-5"><p className="text-sm text-muted-foreground">Límite</p><p className="mt-2 text-xl font-medium">{record.documents_limit ?? '—'}</p></div></section><section className="bg-background border border-border rounded-lg overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-medium">Registro de consumo</h3></div>{rows.length ? <div className="divide-y divide-border">{rows.map((item) => <div key={item.id} className="px-5 py-3.5 flex justify-between"><span>{item.metric_key}</span><span>{item.quantity} {item.unit}</span></div>)}</div> : <Empty icon={ReceiptText} title="Sin consumo adicional" text="Los movimientos aparecerán cuando un módulo registre uso." />}</section></div>;
  }

  if (section === 'auditoria') return <div className="max-w-[1400px] mx-auto space-y-5"><Header section={section} />{notices}<section className="bg-background border border-border rounded-lg overflow-hidden">{loading ? <div className="py-12 text-center text-sm text-muted-foreground">Cargando auditoría...</div> : rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60"><tr><th className="px-5 py-3 text-left font-medium">Evento</th><th className="px-4 py-3 text-left font-medium">Recurso</th><th className="px-4 py-3 text-left font-medium">Fecha</th></tr></thead><tbody className="divide-y divide-border">{rows.map((item) => <tr key={item.id}><td className="px-5 py-3.5"><p className="font-medium">{item.summary}</p><p className="text-xs text-muted-foreground mt-0.5">{item.event_type}</p></td><td className="px-4 py-3.5">{item.resource_type}</td><td className="px-4 py-3.5 whitespace-nowrap">{formatDate(item.occurred_at)}</td></tr>)}</tbody></table></div> : <Empty icon={Activity} title="Sin eventos" text="Las acciones administrativas nuevas se conservarán aquí." />}</section></div>;

  if (section === 'integraciones' || section === 'certificados') {
    const integrations = section === 'integraciones';
    return <div className="max-w-[1200px] mx-auto space-y-5"><Header section={section} />{notices}<section className="bg-background border border-border rounded-lg overflow-hidden">{rows.length ? <div className="divide-y divide-border">{rows.map((item) => <div key={item.id} className="px-5 py-4 flex gap-4"><div className="w-9 h-9 bg-primary/10 text-primary rounded-md grid place-items-center">{integrations ? <Link2 size={17} /> : <ScrollText size={17} />}</div><div className="flex-1"><p className="font-medium">{integrations ? item.display_name : item.subject_name}</p><p className="text-sm text-muted-foreground mt-1">{integrations ? item.provider_key : `Serie: ${item.serial_number || 'No registrada'}`}</p></div><Status value={item.status} /></div>)}</div> : <Empty icon={integrations ? Network : ScrollText} title={integrations ? 'Sin integraciones configuradas' : 'Sin certificados registrados'} text={integrations ? 'No se muestran conexiones hasta tener configuración backend autorizada.' : 'Solo se guardan certificados públicos, nunca llaves privadas.'} />}</section></div>;
  }

  const config = resources[section]; const sectionMeta = meta[section];
  return <div className="max-w-[1300px] mx-auto space-y-5"><Header section={section}>{canManage && config && <button onClick={() => setShowCreate(!showCreate)} className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"><Plus size={16} /> Crear</button>}</Header>{notices}{showCreate && config && <form onSubmit={createResource} className="bg-background border border-border rounded-lg p-5 flex gap-3 items-end"><label className="flex-1"><span className="text-sm">{section === 'facultades' ? 'Tipo de facultad' : section === 'directorio' ? 'Nombre completo' : 'Nombre'}</span><input required value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1.5 w-full h-10 rounded-md border border-border px-3" /></label><button disabled={saving} className="h-10 px-4 rounded-md bg-primary text-white text-sm">Guardar</button></form>}<section className="bg-background border border-border rounded-lg overflow-hidden">{loading ? <div className="py-12 flex justify-center gap-2 text-sm text-muted-foreground"><Loader2 size={17} className="animate-spin" /> Cargando...</div> : rows.length ? <div className="divide-y divide-border">{rows.map((item) => <div key={item.id} className="px-5 py-4 flex gap-4"><div className="w-9 h-9 bg-primary/10 text-primary rounded-md grid place-items-center"><sectionMeta.icon size={17} /></div><div className="flex-1"><p className="font-medium">{item[config?.name || 'name']}</p><p className="text-sm text-muted-foreground mt-1">{item.description || (item.is_system ? 'Rol protegido del sistema' : `Creado ${formatDate(item.created_at)}`)}</p></div><Status value={item.status || (item.is_system ? 'active' : null)} /></div>)}</div> : <Empty icon={sectionMeta.icon} title={`Sin ${sectionMeta.title.toLowerCase()}`} text="Crea el primer registro cuando la organización haya definido su política interna." />}</section></div>;
}
