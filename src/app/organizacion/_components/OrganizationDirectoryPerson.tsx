'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, BadgeCheck, Check, CircleAlert, Clock3, Download, FileCheck2,
  FileKey2, FileText, Fingerprint, History, IdCard, Loader2, Plus,
  ShieldCheck, Upload, UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type Row = Record<string, any>;
const panel = 'bg-background border border-border rounded-lg overflow-hidden';
const input = 'mt-1.5 w-full h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary';

function statusLabel(value?: string) {
  const labels: Record<string, string> = { active: 'Activo', inactive: 'Inactivo', pending: 'Pendiente', verified: 'Verificado', rejected: 'Rechazado', expired: 'Vencido', revoked: 'Revocado', not_started: 'Sin iniciar', identity_verified: 'Identidad acreditada', pending_validation: 'Pendiente de validación', suspended: 'Suspendida', draft: 'Borrador' };
  return labels[value || ''] || value || 'Sin estado';
}

function Status({ value }: { value?: string }) {
  const positive = ['active', 'verified', 'identity_verified'].includes(value || '');
  const warning = ['pending', 'not_started', 'pending_validation', 'draft'].includes(value || '');
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${positive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : warning ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-border bg-muted text-muted-foreground'}`}>{statusLabel(value)}</span>;
}

function date(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value));
}

export default function OrganizationDirectoryPerson({ personId }: { personId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { activeWorkspace } = useWorkspace();
  const { user, session } = useAuth();
  const [person, setPerson] = useState<Row | null>(null);
  const [evidence, setEvidence] = useState<Row[]>([]);
  const [authorities, setAuthorities] = useState<Row[]>([]);
  const [events, setEvents] = useState<Row[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [tab, setTab] = useState('general');
  const [loading, setLoading] = useState(true);
  const [showEvidence, setShowEvidence] = useState(false);
  const [form, setForm] = useState<Row>({ evidence_type: 'appointment', status: 'pending' });
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const elevated = ['owner', 'admin'].includes(activeWorkspace?.role || '');
  const canManage = elevated || permissions.includes('directory.manage');
  const canReadSensitive = elevated || permissions.includes('directory.sensitive.read');
  const canDownloadSensitive = elevated || permissions.includes('directory.sensitive.download');

  const load = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true); setError('');
    const [personResult, authorityResult, evidenceResult, auditResult, permissionResult] = await Promise.all([
      supabase.rpc('get_organization_directory_person', { ws_id: activeWorkspace.id, target_person_id: personId }),
      supabase.from('organization_authorities').select('*').eq('workspace_id', activeWorkspace.id).eq('person_id', personId).order('created_at', { ascending: false }),
      supabase.from('organization_directory_evidence').select('*').eq('workspace_id', activeWorkspace.id).eq('person_id', personId).order('created_at', { ascending: false }),
      supabase.from('organization_audit_events').select('*').eq('workspace_id', activeWorkspace.id).eq('resource_id', personId).order('occurred_at', { ascending: false }),
      supabase.rpc('get_my_organization_permissions', { ws_id: activeWorkspace.id }),
    ]);
    if (personResult.error) setError(personResult.error.message); else setPerson(personResult.data?.[0] || null);
    if (!authorityResult.error) setAuthorities(authorityResult.data || []);
    if (!evidenceResult.error) setEvidence(evidenceResult.data || []);
    if (!auditResult.error) setEvents(auditResult.data || []);
    setPermissions((permissionResult.data || []).map((item: Row) => item.permission_key));
    setLoading(false);
  }, [activeWorkspace?.id, personId, supabase]);

  useEffect(() => { load(); }, [load]);

  const audit = async (eventType: string, summary: string) => {
    if (!activeWorkspace?.id || !user?.id) return;
    await supabase.from('organization_audit_events').insert({ workspace_id: activeWorkspace.id, actor_user_id: user.id, event_type: eventType, resource_type: 'organization_directory_person', resource_id: personId, summary });
  };

  useEffect(() => {
    if (!person || !activeWorkspace?.id || !user?.id) return;
    const key = `docubox-directory-view:${personId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    audit('directory.person.viewed', `Consulta del expediente de ${person.full_name}`);
    // This event is intentionally best effort and must not block the detail view.
  }, [person, activeWorkspace?.id, personId, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addEvidence = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeWorkspace?.id || !user?.id || !session?.access_token || !canManage || !form.display_name?.trim() || !evidenceFile) return;
    setSavingEvidence(true);
    setError(''); setSuccess('');
    try {
      const payload = new FormData();
      payload.set('workspace_id', activeWorkspace.id);
      payload.set('person_id', personId);
      payload.set('evidence_type', form.evidence_type);
      payload.set('display_name', form.display_name.trim());
      payload.set('valid_from', form.valid_from || '');
      payload.set('valid_until', form.valid_until || '');
      payload.set('file', evidenceFile);
      const response = await fetch('/api/organizacion/directory-evidence', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: payload });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo cargar la evidencia.');
      setForm({ evidence_type: 'appointment', status: 'pending' });
      setEvidenceFile(null); setShowEvidence(false);
      setSuccess('El archivo quedó resguardado y pendiente de validación.');
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo cargar la evidencia.');
    } finally { setSavingEvidence(false); }
  };

  const updateEvidence = async (item: Row, action: 'verify' | 'revoke') => {
    if (!activeWorkspace?.id || !session?.access_token || !canManage) return;
    setSavingEvidence(true); setError(''); setSuccess('');
    try {
      const response = await fetch('/api/organizacion/directory-evidence', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspace_id: activeWorkspace.id, evidence_id: item.id, action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo actualizar la evidencia.');
      setSuccess(action === 'verify' ? 'Evidencia validada.' : 'Evidencia revocada.');
      await load();
    } catch (cause: any) { setError(cause?.message || 'No se pudo actualizar la evidencia.'); }
    finally { setSavingEvidence(false); }
  };

  const downloadEvidence = async (item: Row) => {
    if (!activeWorkspace?.id || !session?.access_token || !canDownloadSensitive) return;
    setError('');
    try {
      const query = new URLSearchParams({ workspace_id: activeWorkspace.id, evidence_id: item.id });
      const response = await fetch(`/api/organizacion/directory-evidence?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo autorizar la descarga.');
      window.location.assign(result.url);
    } catch (cause: any) { setError(cause?.message || 'No se pudo descargar la evidencia.'); }
  };

  const tabs: Array<[string, string, LucideIcon]> = [
    ['general', 'Datos generales', UserRound], ['organization', 'Relación', IdCard],
    ['evidence', 'Documentos probatorios', FileText], ['authorities', 'Facultades', BadgeCheck],
    ['identity', 'Identidad', Fingerprint], ['history', 'Participación y firma', History],
    ['audit', 'Auditoría', Clock3],
  ];

  if (loading) return <div className="min-h-[420px] grid place-items-center text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Loader2 size={17} className="animate-spin" /> Cargando expediente...</span></div>;
  if (!person) return <div className="max-w-xl mx-auto py-20 text-center"><IdCard size={30} className="mx-auto text-muted-foreground" /><h2 className="mt-3 font-medium">Persona no disponible</h2><Link href="/organizacion/directorio" className="mt-4 inline-flex text-sm text-primary">Volver al directorio</Link></div>;

  return <div className="max-w-[1400px] mx-auto space-y-5">
    <div className="flex items-start gap-3"><Link href="/organizacion/directorio" aria-label="Volver al directorio" className="w-10 h-10 grid place-items-center rounded-md border border-border bg-background"><ArrowLeft size={17} /></Link><div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-medium truncate">{person.full_name}</h2><Status value={person.status} /></div><p className="mt-1 text-sm text-muted-foreground">{person.job_title || 'Sin cargo'}{person.area_name ? ` · ${person.area_name}` : ''}</p></div></div>
    {error && <div className="border border-red-200 bg-red-50 text-red-700 rounded-md px-4 py-3 text-sm flex gap-2"><CircleAlert size={17} />{error}</div>}{success && <div className="border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-md px-4 py-3 text-sm flex gap-2"><Check size={17} />{success}</div>}
    <section className={panel}><div className="px-3 border-b border-border overflow-x-auto flex">{tabs.map(([value, label, Icon]) => <button key={value} onClick={() => setTab(value)} className={`h-12 px-3 inline-flex items-center gap-2 whitespace-nowrap text-sm border-b-2 ${tab === value ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground'}`}><Icon size={15} />{label}</button>)}</div>
      {tab === 'general' && <div className="p-5 grid sm:grid-cols-2 xl:grid-cols-3 gap-5">{[['Nombre completo', person.full_name], ['Correo', person.email || 'No registrado'], ['Teléfono', person.phone || 'No registrado'], ['Tipo de persona', person.person_type === 'legal_entity' ? 'Persona moral' : 'Persona física'], ['Versión de datos', `v${person.data_version}`], ['Última actualización', date(person.updated_at)]].map(([label, value]) => <div key={label}><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>)}<div><p className="text-xs uppercase text-muted-foreground">RFC</p><p className="mt-1 text-sm font-medium">{canReadSensitive ? person.rfc || 'No registrado' : '•••••••••••••'}</p></div></div>}
      {tab === 'organization' && <div className="p-5 grid sm:grid-cols-2 xl:grid-cols-3 gap-5">{[['Relación', String(person.relationship_type || 'No definida').replaceAll('_', ' ')], ['Cargo', person.job_title || 'No registrado'], ['Área', person.area_name || 'No registrada'], ['Acceso Docubox', person.member_id ? 'Miembro vinculado' : 'Sin cuenta vinculada'], ['Vigente desde', date(person.valid_from)], ['Vigente hasta', date(person.valid_until)]].map(([label, value]) => <div key={label}><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium capitalize">{value}</p></div>)}</div>}
      {tab === 'evidence' && <div>{canReadSensitive ? <><div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3"><div><h3 className="font-medium">Documentos probatorios</h3><p className="mt-0.5 text-sm text-muted-foreground">Archivos privados, huella SHA-256 y descargas temporales auditadas.</p></div>{canManage && <button onClick={() => setShowEvidence((value) => !value)} className="h-9 px-3 rounded-md bg-primary text-white text-sm inline-flex items-center gap-2"><Plus size={15} /> Cargar evidencia</button>}</div>{showEvidence && <form onSubmit={addEvidence} className="p-5 bg-muted/30 grid md:grid-cols-2 xl:grid-cols-4 gap-4"><label><span className="text-sm">Tipo</span><select value={form.evidence_type} onChange={(e) => setForm({ ...form, evidence_type: e.target.value })} className={input}><option value="appointment">Nombramiento</option><option value="power">Poder</option><option value="minutes">Acta</option><option value="identity">Identificación</option><option value="other">Otro</option></select></label><label className="md:col-span-2"><span className="text-sm">Nombre visible</span><input required value={form.display_name || ''} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={input} /></label><label><span className="text-sm">Archivo probatorio</span><span className={`${input} flex items-center gap-2 overflow-hidden`}><Upload size={15} className="shrink-0 text-primary" /><span className="truncate">{evidenceFile?.name || 'PDF, JPG o PNG'}</span></span><input required type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)} className="sr-only" /></label><label><span className="text-sm">Desde</span><input type="date" value={form.valid_from || ''} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} className={input} /></label><label><span className="text-sm">Hasta</span><input type="date" value={form.valid_until || ''} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} className={input} /></label><div className="md:col-span-2 flex items-end justify-end"><button disabled={savingEvidence || !evidenceFile} className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50">{savingEvidence ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Resguardar archivo</button></div></form>}{evidence.length ? <div className="divide-y divide-border">{evidence.map((item) => <div key={item.id} className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center"><span className="w-9 h-9 rounded-md bg-primary/10 text-primary grid place-items-center"><FileText size={16} /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{item.display_name}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.evidence_type} · v{item.version} · vence {date(item.valid_until)}</p>{item.sha256_hash && <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={item.sha256_hash}>SHA-256 {item.sha256_hash}</p>}</div><Status value={item.status} /><div className="flex items-center gap-2">{canManage && item.status === 'pending' && <button disabled={savingEvidence} onClick={() => updateEvidence(item, 'verify')} className="h-8 px-2.5 rounded-md border border-emerald-200 text-xs font-medium text-emerald-700 inline-flex items-center gap-1.5"><FileCheck2 size={13} /> Validar</button>}{canManage && item.status !== 'revoked' && <button disabled={savingEvidence} onClick={() => updateEvidence(item, 'revoke')} className="h-8 px-2.5 rounded-md border border-red-200 text-xs font-medium text-red-600">Revocar</button>}{canDownloadSensitive && item.storage_path && <button onClick={() => downloadEvidence(item)} aria-label={`Descargar ${item.display_name}`} className="h-8 w-8 grid place-items-center rounded-md border border-border text-primary"><Download size={14} /></button>}</div></div>)}</div> : <div className="px-5 py-12 text-center text-sm text-muted-foreground">No hay evidencia registrada.</div>}</> : <div className="px-5 py-14 text-center"><ShieldCheck size={28} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-medium">Acceso restringido</p><p className="mt-1 text-sm text-muted-foreground">Se requiere permiso para consultar documentos probatorios.</p></div>}</div>}
      {tab === 'authorities' && <div>{authorities.length ? <div className="divide-y divide-border">{authorities.map((item) => <div key={item.id} className="px-5 py-4 flex items-center gap-4"><span className="w-9 h-9 rounded-md bg-primary/10 text-primary grid place-items-center"><FileKey2 size={16} /></span><div className="flex-1"><p className="text-sm font-medium">{item.authority_type}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.modality} · hasta {date(item.valid_until)}</p></div><Status value={item.status} /></div>)}</div> : <div className="px-5 py-12 text-center text-sm text-muted-foreground">No hay facultades asociadas.</div>}</div>}
      {tab === 'identity' && <div className="p-5 flex items-start gap-4"><span className="w-10 h-10 rounded-md bg-primary/10 text-primary grid place-items-center"><Fingerprint size={18} /></span><div><h3 className="font-medium">Estado de identidad y enrolamiento</h3><div className="mt-2"><Status value={person.identity_status} /></div><p className="mt-3 text-sm text-muted-foreground">Docubox muestra el estado registrado; la evidencia biométrica permanece restringida y no se expone en esta vista.</p></div></div>}
      {tab === 'history' && <div className="p-5"><div className="border border-border rounded-md p-4 flex gap-3"><History size={18} className="text-muted-foreground" /><div><p className="text-sm font-medium">Historial documental conectado</p><p className="mt-1 text-sm text-muted-foreground">Las participaciones aparecerán al vincular esta persona con firmantes y participantes de documentos, sin duplicar sus registros.</p></div></div></div>}
      {tab === 'audit' && <div>{events.length ? <div className="divide-y divide-border">{events.map((item) => <div key={item.id} className="px-5 py-4"><p className="text-sm font-medium">{item.summary}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.event_type} · {date(item.occurred_at)}</p></div>)}</div> : <div className="px-5 py-12 text-center text-sm text-muted-foreground">No hay eventos asociados.</div>}</div>}
    </section>
  </div>;
}
