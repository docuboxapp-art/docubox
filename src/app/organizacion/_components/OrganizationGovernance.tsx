'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  FileKey2,
  FileText,
  Loader2,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Workflow,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export type GovernanceSection =
  'directorio' | 'facultades' | 'flujos' | 'politicas-firma' | 'recursos';
type Row = Record<string, any>;

const inputClass =
  'mt-1.5 w-full h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary disabled:bg-muted';
const panelClass = 'bg-background border border-border rounded-lg overflow-hidden';

const sectionMeta = {
  directorio: [
    'Directorio organizacional',
    'Colaboradores, representantes, apoderados y firmantes reutilizables.',
  ],
  facultades: [
    'Facultades de firma',
    'Representación, límites, vigencias y evidencia configurada por la organización.',
  ],
  flujos: [
    'Flujos de aprobación',
    'Procesos reutilizables y versionados para revisar, aprobar y firmar.',
  ],
  'politicas-firma': [
    'Políticas de firma',
    'Niveles de seguridad reutilizables para documentos y procesos.',
  ],
  recursos: [
    'Plantillas y recursos',
    'Gobierno de recursos compartidos sin duplicar sus módulos de origen.',
  ],
} satisfies Record<GovernanceSection, [string, string]>;

const permissionBySection: Record<GovernanceSection, string> = {
  directorio: 'directory.manage',
  facultades: 'authorities.manage',
  flujos: 'workflows.manage',
  'politicas-firma': 'signature_policies.manage',
  recursos: 'resources.manage',
};

function Status({ value }: { value?: string }) {
  const labels: Record<string, string> = {
    active: 'Activa',
    inactive: 'Inactiva',
    draft: 'Borrador',
    pending_validation: 'Pendiente de validación',
    suspended: 'Suspendida',
    expired: 'Vencida',
    revoked: 'Revocada',
    published: 'Publicada',
    paused: 'Pausada',
    archived: 'Archivada',
    in_review: 'En revisión',
    approved: 'Aprobado',
    not_started: 'Sin enrolamiento',
    pending: 'Pendiente',
    verified: 'Verificado',
    identity_verified: 'Identidad acreditada',
  };
  const positive = ['active', 'published', 'approved', 'verified', 'identity_verified'].includes(
    value || ''
  );
  const warning = [
    'draft',
    'pending_validation',
    'pending',
    'paused',
    'not_started',
    'in_review',
  ].includes(value || '');
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${positive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : warning ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-border bg-muted text-muted-foreground'}`}
    >
      {labels[value || ''] || value || 'Sin estado'}
    </span>
  );
}

function Header({ section, action }: { section: GovernanceSection; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div>
        <h2 className="text-xl font-medium text-foreground">{sectionMeta[section][0]}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{sectionMeta[section][1]}</p>
      </div>
      {action}
    </div>
  );
}

function Notices({ error, success }: { error: string; success: string }) {
  return (
    <>
      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 rounded-md px-4 py-3 text-sm flex gap-2">
          <CircleAlert size={17} className="shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-md px-4 py-3 text-sm flex gap-2">
          <Check size={17} className="shrink-0" />
          {success}
        </div>
      )}
    </>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function DefaultGovernanceControl({
  workspaceId,
  kind,
  rows,
  canManage,
}: {
  workspaceId: string;
  kind: 'workflow' | 'signature_policy';
  rows: Row[];
  canManage: boolean;
}) {
  const { session } = useAuth();
  const [currentId, setCurrentId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const scope = kind === 'workflow' ? 'workflows.manage' : 'signature_policies.manage';
  const title = kind === 'workflow' ? 'Flujo predeterminado' : 'Política predeterminada';

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
          ...(init?.headers || {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar la configuración.');
      return payload;
    },
    [session?.access_token]
  );

  useEffect(() => {
    if (!session?.access_token) return;
    request(`/api/organizacion/governance-defaults?workspace_id=${workspaceId}`)
      .then((payload) => {
        const value =
          kind === 'workflow'
            ? payload.defaults?.workflow_id
            : payload.defaults?.signature_policy_id;
        setCurrentId(value || '');
        setSelectedId(value || '');
      })
      .catch((cause) => setError(cause.message));
  }, [kind, request, session?.access_token, workspaceId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const reauth = await request('/api/organizacion/reauthenticate', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: workspaceId, password, scopes: [scope] }),
      });
      await request('/api/organizacion/governance-defaults', {
        method: 'PATCH',
        headers: { 'X-Organization-Reauth': reauth.token },
        body: JSON.stringify({ workspace_id: workspaceId, kind, resource_id: selectedId || null }),
      });
      setCurrentId(selectedId);
      setPassword('');
      setConfirming(false);
      setSuccess('El valor se aplicará únicamente a documentos nuevos.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  const published = rows.filter((item) => item.status === 'published');
  return (
    <section className={`${panelClass} p-4`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Se hereda al enviar documentos nuevos desde este espacio. Los documentos existentes
            conservan su versión.
          </p>
        </div>
        <label className="block lg:w-[360px]">
          <span className="sr-only">{title}</span>
          <select
            disabled={!canManage || saving}
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setSuccess('');
            }}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="">Sin valor predeterminado</option>
            {published.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · v{item.version}
              </option>
            ))}
          </select>
        </label>
        {canManage && (
          <button
            disabled={selectedId === currentId || saving}
            onClick={() => setConfirming(true)}
            className="h-10 rounded-md border border-border bg-background px-4 text-sm font-medium disabled:opacity-40"
          >
            Guardar
          </button>
        )}
      </div>
      {success && <p className="mt-3 text-xs text-emerald-700">{success}</p>}
      {error && (
        <p className="mt-3 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {confirming && (
        <form
          onSubmit={save}
          className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end"
        >
          <label className="flex-1 text-sm">
            <span>Confirma tu contraseña</span>
            <input
              autoFocus
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setPassword('');
              }}
              className="h-10 rounded-md border border-border px-4 text-sm"
            >
              Cancelar
            </button>
            <button
              disabled={saving || !password}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <LockKeyhole size={15} />}{' '}
              Confirmar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function dateLabel(value?: string | null) {
  if (!value) return 'Sin vigencia definida';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(
    new Date(`${value}T12:00:00`)
  );
}

function DirectoryView({ workspaceId, userId, canManage, audit }: ViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [members, setMembers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<Row>({
    person_type: 'individual',
    relationship_type: 'collaborator',
    identity_status: 'not_started',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [people, workspaceMembers] = await Promise.all([
      supabase
        .from('organization_directory_people')
        .select(
          'id,full_name,email,phone,relationship_type,person_type,job_title,area_name,identity_status,status,valid_until,member_id,created_at'
        )
        .eq('workspace_id', workspaceId)
        .order('full_name'),
      supabase
        .from('workspace_members')
        .select('id,user_id,user_profiles(full_name,email)')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('joined_at'),
    ]);
    if (people.error) setError(people.error.message);
    else setRows(people.data || []);
    if (!workspaceMembers.error) setMembers(workspaceMembers.data || []);
    setLoading(false);
  }, [supabase, workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const createPerson = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !form.full_name?.trim()) return;
    setError('');
    setSuccess('');
    const result = await supabase
      .from('organization_directory_people')
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        full_name: form.full_name.trim(),
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        person_type: form.person_type,
        relationship_type: form.relationship_type,
        job_title: form.job_title?.trim() || null,
        area_name: form.area_name?.trim() || null,
        member_id: form.member_id || null,
        valid_until: form.valid_until || null,
        identity_status: form.identity_status,
      })
      .select('id')
      .single();
    if (result.error) {
      setError(result.error.message);
      return;
    }
    await audit(
      'directory.person.created',
      'organization_directory_person',
      result.data.id,
      `Persona agregada al directorio: ${form.full_name.trim()}`
    );
    setForm({
      person_type: 'individual',
      relationship_type: 'collaborator',
      identity_status: 'not_started',
    });
    setShowForm(false);
    setSuccess('La persona quedó disponible en el directorio.');
    await load();
  };

  const filtered = rows.filter((item) =>
    `${item.full_name} ${item.email || ''} ${item.area_name || ''}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const memberLabel = (member: Row) => {
    const profile = Array.isArray(member.user_profiles)
      ? member.user_profiles[0]
      : member.user_profiles;
    return profile?.full_name || profile?.email || 'Miembro';
  };
  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <Header
        section="directorio"
        action={
          canManage && (
            <button
              onClick={() => setShowForm((value) => !value)}
              className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"
            >
              <Plus size={16} /> Agregar persona
            </button>
          )
        }
      />
      <Notices error={error} success={success} />
      {showForm && (
        <form
          onSubmit={createPerson}
          className={`${panelClass} p-5 grid md:grid-cols-2 xl:grid-cols-4 gap-4`}
        >
          <label className="xl:col-span-2">
            <span className="text-sm">Nombre completo</span>
            <input
              required
              value={form.full_name || ''}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-sm">Tipo de persona</span>
            <select
              value={form.person_type}
              onChange={(e) => setForm({ ...form, person_type: e.target.value })}
              className={inputClass}
            >
              <option value="individual">Persona física</option>
              <option value="legal_entity">Persona moral</option>
            </select>
          </label>
          <label>
            <span className="text-sm">Relación</span>
            <select
              value={form.relationship_type}
              onChange={(e) => setForm({ ...form, relationship_type: e.target.value })}
              className={inputClass}
            >
              <option value="collaborator">Colaborador</option>
              <option value="representative">Representante</option>
              <option value="attorney">Apoderado</option>
              <option value="authorized_signer">Firmante autorizado</option>
            </select>
          </label>
          <label>
            <span className="text-sm">Correo</span>
            <input
              type="email"
              value={form.email || ''}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-sm">Teléfono</span>
            <input
              value={form.phone || ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-sm">Cargo</span>
            <input
              value={form.job_title || ''}
              onChange={(e) => setForm({ ...form, job_title: e.target.value })}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-sm">Área</span>
            <input
              value={form.area_name || ''}
              onChange={(e) => setForm({ ...form, area_name: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="xl:col-span-2">
            <span className="text-sm">Vincular miembro existente</span>
            <select
              value={form.member_id || ''}
              onChange={(e) => setForm({ ...form, member_id: e.target.value })}
              className={inputClass}
            >
              <option value="">Sin acceso a la plataforma</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberLabel(member)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-sm">Vigencia</span>
            <input
              type="date"
              value={form.valid_until || ''}
              onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
              className={inputClass}
            />
          </label>
          <div className="flex items-end gap-2">
            <button className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium">
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-10 px-3 rounded-md border border-border text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      <section className={panelClass}>
        <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h3 className="font-medium">Personas registradas</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Una persona puede existir sin una cuenta Docubox.
            </p>
          </div>
          <label className="relative sm:w-72">
            <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-10 rounded-md border border-border bg-background pl-9 pr-3 text-sm"
              placeholder="Buscar en el directorio"
            />
          </label>
        </div>
        {loading ? (
          <div className="py-14 flex justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={17} className="animate-spin" /> Cargando directorio...
          </div>
        ) : filtered.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="text-left font-medium px-5 py-3">Persona</th>
                  <th className="text-left font-medium px-4 py-3">Relación</th>
                  <th className="text-left font-medium px-4 py-3">Cargo y área</th>
                  <th className="text-left font-medium px-4 py-3">Identidad</th>
                  <th className="text-left font-medium px-4 py-3">Vigencia</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="px-5 py-3.5">
                      <p className="font-medium">{item.full_name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.email || 'Sin correo'}
                        {item.member_id ? ' · Miembro vinculado' : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 capitalize">
                      {String(item.relationship_type || 'sin relación').replaceAll('_', ' ')}
                    </td>
                    <td className="px-4 py-3.5">
                      <p>{item.job_title || '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.area_name || 'Sin área'}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <Status value={item.identity_status} />
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">{dateLabel(item.valid_until)}</td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/organizacion/directorio/${item.id}`}
                        aria-label={`Ver ${item.full_name}`}
                        className="w-8 h-8 grid place-items-center rounded-md border border-border text-primary hover:bg-primary/5"
                      >
                        <ArrowRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Directorio vacío"
            text="Agrega personas para reutilizarlas en documentos, facultades y flujos."
          />
        )}
      </section>
    </div>
  );
}

function AuthoritiesView({ workspaceId, userId, canManage, audit }: ViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [people, setPeople] = useState<Row[]>([]);
  const [evidence, setEvidence] = useState<Row[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<Row>({
    modality: 'individual',
    currency: 'MXN',
    required_representatives: 1,
    identity_required: true,
  });
  const load = useCallback(async () => {
    setLoading(true);
    const [authorities, directory, evidenceRows] = await Promise.all([
      supabase
        .from('organization_authorities')
        .select('*,organization_directory_people(full_name,email)')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false }),
      supabase
        .from('organization_directory_people')
        .select('id,full_name,email')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('full_name'),
      supabase
        .from('organization_directory_evidence')
        .select('id,person_id,display_name,valid_until,status')
        .eq('workspace_id', workspaceId)
        .eq('status', 'verified')
        .order('created_at', { ascending: false }),
    ]);
    if (authorities.error) setError(authorities.error.message);
    else setRows(authorities.data || []);
    if (!directory.error) setPeople(directory.data || []);
    if (!evidenceRows.error) setEvidence(evidenceRows.data || []);
    setLoading(false);
  }, [supabase, workspaceId]);
  useEffect(() => {
    load();
  }, [load]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !form.person_id || !form.authority_type?.trim()) return;
    setError('');
    setSuccess('');
    const result = await supabase
      .from('organization_authorities')
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        person_id: form.person_id,
        authority_type: form.authority_type.trim(),
        modality: form.modality,
        legal_basis: form.legal_basis?.trim() || null,
        monetary_limit: form.monetary_limit ? Number(form.monetary_limit) : null,
        currency: form.currency,
        document_types: String(form.document_types || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        areas: String(form.areas || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        required_representatives: Number(form.required_representatives) || 1,
        identity_required: Boolean(form.identity_required),
        evidence_id: form.evidence_id || null,
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        status: 'pending_validation',
      })
      .select('id')
      .single();
    if (result.error) {
      setError(result.error.message);
      return;
    }
    await audit(
      'authority.created',
      'organization_authority',
      result.data.id,
      `Facultad registrada: ${form.authority_type.trim()}`
    );
    setForm({
      modality: 'individual',
      currency: 'MXN',
      required_representatives: 1,
      identity_required: true,
    });
    setShowForm(false);
    setSuccess('Facultad enviada a validación interna.');
    await load();
  };
  const setStatus = async (item: Row, status: string) => {
    if (!canManage) return;
    setError('');
    const result = await supabase
      .from('organization_authorities')
      .update({
        status,
        ...(status === 'active'
          ? { approved_by: userId, approved_at: new Date().toISOString() }
          : {}),
      })
      .eq('id', item.id)
      .eq('workspace_id', workspaceId);
    if (result.error) setError(result.error.message);
    else {
      await audit(
        `authority.${status}`,
        'organization_authority',
        item.id,
        `Facultad actualizada a ${status}`
      );
      await load();
    }
  };
  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <Header
        section="facultades"
        action={
          canManage && (
            <button
              onClick={() => setShowForm((value) => !value)}
              className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"
            >
              <Plus size={16} /> Nueva facultad
            </button>
          )
        }
      />
      <Notices error={error} success={success} />
      <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 text-sm text-blue-800 flex gap-3">
        <ShieldCheck size={18} className="shrink-0" />
        <p>
          Este control evalúa reglas definidas por la organización; no sustituye una revisión o
          dictamen jurídico.
        </p>
      </div>
      {showForm && (
        <form
          onSubmit={create}
          className={`${panelClass} p-5 grid md:grid-cols-2 xl:grid-cols-4 gap-4`}
        >
          <label>
            <span className="text-sm">Persona</span>
            <select
              required
              value={form.person_id || ''}
              onChange={(e) => setForm({ ...form, person_id: e.target.value })}
              className={inputClass}
            >
              <option value="">Selecciona una persona</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-sm">Tipo de facultad</span>
            <input
              required
              value={form.authority_type || ''}
              onChange={(e) => setForm({ ...form, authority_type: e.target.value })}
              className={inputClass}
              placeholder="Representación legal"
            />
          </label>
          <label>
            <span className="text-sm">Modalidad</span>
            <select
              value={form.modality}
              onChange={(e) => setForm({ ...form, modality: e.target.value })}
              className={inputClass}
            >
              <option value="individual">Individual</option>
              <option value="joint">Conjunta</option>
              <option value="several">Mancomunada</option>
            </select>
          </label>
          <label>
            <span className="text-sm">Representantes requeridos</span>
            <input
              type="number"
              min="1"
              value={form.required_representatives}
              onChange={(e) => setForm({ ...form, required_representatives: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="md:col-span-2">
            <span className="text-sm">Fundamento</span>
            <input
              value={form.legal_basis || ''}
              onChange={(e) => setForm({ ...form, legal_basis: e.target.value })}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-sm">Límite monetario</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.monetary_limit || ''}
              onChange={(e) => setForm({ ...form, monetary_limit: e.target.value })}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-sm">Moneda</span>
            <select
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className={inputClass}
            >
              <option>MXN</option>
              <option>USD</option>
              <option>EUR</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="text-sm">Tipos documentales, separados por coma</span>
            <input
              value={form.document_types || ''}
              onChange={(e) => setForm({ ...form, document_types: e.target.value })}
              className={inputClass}
              placeholder="Contrato, convenio, pagaré"
            />
          </label>
          <label className="md:col-span-2">
            <span className="text-sm">Áreas, separadas por coma</span>
            <input
              value={form.areas || ''}
              onChange={(e) => setForm({ ...form, areas: e.target.value })}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-sm">Desde</span>
            <input
              type="date"
              value={form.valid_from || ''}
              onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-sm">Hasta</span>
            <input
              type="date"
              value={form.valid_until || ''}
              onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="md:col-span-2">
            <span className="text-sm">Evidencia validada</span>
            <select
              required
              value={form.evidence_id || ''}
              onChange={(e) => setForm({ ...form, evidence_id: e.target.value })}
              className={inputClass}
            >
              <option value="">Selecciona evidencia probatoria</option>
              {evidence
                .filter((item) => item.person_id === form.person_id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name}
                    {item.valid_until ? ` · vence ${dateLabel(item.valid_until)}` : ''}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(form.identity_required)}
              onChange={(e) => setForm({ ...form, identity_required: e.target.checked })}
              className="w-4 h-4"
            />
            <span className="text-sm">Requerir identidad acreditada</span>
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-10 px-4 rounded-md border border-border text-sm"
            >
              Cancelar
            </button>
            <button className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium">
              Registrar facultad
            </button>
          </div>
        </form>
      )}
      <section className={panelClass}>
        {loading ? (
          <div className="py-14 text-center text-sm text-muted-foreground">
            Cargando facultades...
          </div>
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Persona y facultad</th>
                  <th className="px-4 py-3 text-left font-medium">Modalidad</th>
                  <th className="px-4 py-3 text-left font-medium">Alcance</th>
                  <th className="px-4 py-3 text-left font-medium">Vigencia</th>
                  <th className="px-4 py-3 text-left font-medium">Estado</th>
                  <th className="px-5 py-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((item) => {
                  const person = Array.isArray(item.organization_directory_people)
                    ? item.organization_directory_people[0]
                    : item.organization_directory_people;
                  return (
                    <tr key={item.id}>
                      <td className="px-5 py-3.5">
                        <p className="font-medium">
                          {person?.full_name || 'Persona no disponible'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {item.authority_type}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 capitalize">
                        {item.modality === 'joint'
                          ? 'Conjunta'
                          : item.modality === 'several'
                            ? 'Mancomunada'
                            : 'Individual'}
                      </td>
                      <td className="px-4 py-3.5">
                        <p>
                          {item.monetary_limit
                            ? `${Number(item.monetary_limit).toLocaleString('es-MX')} ${item.currency}`
                            : 'Sin límite monetario'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(item.document_types || []).join(', ') || 'Todos los tipos'}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {dateLabel(item.valid_until)}
                      </td>
                      <td className="px-4 py-3.5">
                        <Status value={item.status} />
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        {canManage && item.status === 'pending_validation' && (
                          <button
                            onClick={() => setStatus(item, 'active')}
                            className="text-primary text-sm"
                          >
                            Activar
                          </button>
                        )}
                        {canManage && item.status === 'active' && (
                          <button
                            onClick={() => setStatus(item, 'revoked')}
                            className="text-red-600 text-sm"
                          >
                            Revocar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Sin facultades"
            text="Registra una facultad cuando exista evidencia y una política interna definida."
          />
        )}
      </section>
    </div>
  );
}

const workflowStepTypes = [
  ['start', 'Inicio'],
  ['review', 'Revisión'],
  ['approval', 'Aprobación'],
  ['signature', 'Firma'],
  ['identity', 'Verificación de identidad'],
  ['condition', 'Condición'],
  ['notification', 'Notificación'],
  ['wait', 'Espera o vencimiento'],
  ['approved', 'Fin aprobado'],
  ['rejected', 'Fin rechazado'],
  ['cancelled', 'Fin cancelado'],
];

function WorkflowsView({ workspaceId, userId, canManage, audit }: ViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<Row>({ mode: 'sequential', step_type: 'review' });
  const [steps, setSteps] = useState<Row[]>([
    { type: 'start', label: 'Inicio' },
    { type: 'approval', label: 'Aprobación' },
    { type: 'approved', label: 'Fin aprobado' },
  ]);
  const load = useCallback(async () => {
    setLoading(true);
    const result = await supabase
      .from('organization_approval_workflows')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (result.error) setError(result.error.message);
    else setRows(result.data || []);
    setLoading(false);
  }, [supabase, workspaceId]);
  useEffect(() => {
    load();
  }, [load]);
  const addStep = () => {
    if (!form.step_label?.trim()) return;
    setSteps((current) => [...current, { type: form.step_type, label: form.step_label.trim() }]);
    setForm({ ...form, step_label: '' });
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !form.name?.trim()) return;
    const result = await supabase
      .from('organization_approval_workflows')
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        name: form.name.trim(),
        description: form.description?.trim() || null,
        document_type: form.document_type?.trim() || null,
        applicable_areas: String(form.areas || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        definition: {
          mode: form.mode,
          steps: steps.map((step, index) => ({
            id: crypto.randomUUID(),
            order: index + 1,
            ...step,
          })),
        },
      })
      .select('id')
      .single();
    if (result.error) {
      setError(result.error.message);
      return;
    }
    await audit(
      'workflow.created',
      'organization_approval_workflow',
      result.data.id,
      `Flujo creado: ${form.name.trim()}`
    );
    setShowForm(false);
    setForm({ mode: 'sequential', step_type: 'review' });
    setSteps([
      { type: 'start', label: 'Inicio' },
      { type: 'approval', label: 'Aprobación' },
      { type: 'approved', label: 'Fin aprobado' },
    ]);
    setSuccess('Flujo guardado como borrador.');
    await load();
  };
  const call = async (fn: string, item: Row, successMessage: string) => {
    setError('');
    const result = await supabase.rpc(fn, {
      ws_id: workspaceId,
      [fn.includes('version') ? 'source_workflow_id' : 'target_workflow_id']: item.id,
    });
    if (result.error) setError(result.error.message);
    else {
      setSuccess(successMessage);
      await load();
    }
  };
  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <Header
        section="flujos"
        action={
          canManage && (
            <button
              onClick={() => setShowForm((value) => !value)}
              className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"
            >
              <Plus size={16} /> Nuevo flujo
            </button>
          )
        }
      />
      <Notices error={error} success={success} />
      <DefaultGovernanceControl
        workspaceId={workspaceId}
        kind="workflow"
        rows={rows}
        canManage={canManage}
      />
      {showForm && (
        <form
          onSubmit={create}
          className="grid lg:grid-cols-[360px_minmax(0,1fr)] gap-5 items-start"
        >
          <section className={`${panelClass} p-5 space-y-4`}>
            <label>
              <span className="text-sm">Nombre</span>
              <input
                required
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
              />
            </label>
            <label>
              <span className="text-sm">Descripción</span>
              <textarea
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1.5 w-full min-h-20 rounded-md border border-border bg-background p-3 text-sm"
              />
            </label>
            <label>
              <span className="text-sm">Tipo documental</span>
              <input
                value={form.document_type || ''}
                onChange={(e) => setForm({ ...form, document_type: e.target.value })}
                className={inputClass}
              />
            </label>
            <label>
              <span className="text-sm">Áreas aplicables</span>
              <input
                value={form.areas || ''}
                onChange={(e) => setForm({ ...form, areas: e.target.value })}
                className={inputClass}
                placeholder="Legal, Finanzas"
              />
            </label>
            <label>
              <span className="text-sm">Ejecución</span>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
                className={inputClass}
              >
                <option value="sequential">Secuencial</option>
                <option value="parallel">Paralela</option>
              </select>
            </label>
          </section>
          <section className={panelClass}>
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-medium">Etapas del flujo</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                La versión publicada quedará inmutable.
              </p>
            </div>
            <div className="p-5 space-y-3">
              {steps.map((step, index) => (
                <div
                  key={`${step.type}-${index}`}
                  className="flex items-center gap-3 rounded-md border border-border p-3"
                >
                  <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs grid place-items-center">
                    {index + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{step.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {workflowStepTypes.find(([value]) => value === step.type)?.[1]}
                    </p>
                  </div>
                  {index > 0 && index < steps.length - 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setSteps((current) => current.filter((_, stepIndex) => stepIndex !== index))
                      }
                      className="w-8 h-8 grid place-items-center text-muted-foreground"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
              <div className="grid sm:grid-cols-[200px_minmax(0,1fr)_auto] gap-2">
                <select
                  value={form.step_type}
                  onChange={(e) => setForm({ ...form, step_type: e.target.value })}
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                >
                  {workflowStepTypes
                    .filter(
                      ([value]) => !['start', 'approved', 'rejected', 'cancelled'].includes(value)
                    )
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                </select>
                <input
                  value={form.step_label || ''}
                  onChange={(e) => setForm({ ...form, step_label: e.target.value })}
                  className="h-10 rounded-md border border-border px-3 text-sm"
                  placeholder="Nombre de la etapa"
                />
                <button
                  type="button"
                  onClick={addStep}
                  className="h-10 px-3 rounded-md border border-border text-sm"
                >
                  Agregar
                </button>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="h-10 px-4 rounded-md border border-border text-sm"
              >
                Cancelar
              </button>
              <button className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium">
                Guardar borrador
              </button>
            </div>
          </section>
        </form>
      )}
      <section className={panelClass}>
        {loading ? (
          <div className="py-14 text-center text-sm text-muted-foreground">Cargando flujos...</div>
        ) : rows.length ? (
          <div className="divide-y divide-border">
            {rows.map((item) => (
              <div
                key={item.id}
                className="px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-4"
              >
                <div className="w-10 h-10 rounded-md bg-primary/10 text-primary grid place-items-center">
                  <Workflow size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{item.name}</p>
                    <span className="text-xs text-muted-foreground">v{item.version}</span>
                    <Status value={item.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.document_type || 'Todos los tipos documentales'} ·{' '}
                    {item.definition?.steps?.length || 0} etapas
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-3 text-sm">
                    {item.status === 'draft' && (
                      <button
                        onClick={() =>
                          call('publish_organization_workflow', item, 'Flujo publicado.')
                        }
                        className="text-primary"
                      >
                        Publicar
                      </button>
                    )}
                    {item.status !== 'draft' && (
                      <button
                        onClick={() =>
                          call(
                            'create_organization_workflow_version',
                            item,
                            'Nueva versión creada como borrador.'
                          )
                        }
                        className="text-primary inline-flex items-center gap-1"
                      >
                        <Copy size={14} /> Nueva versión
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="Sin flujos"
            text="Crea un flujo con inicio, responsables y un resultado terminal."
          />
        )}
      </section>
    </div>
  );
}

const signatureMethods = [
  ['autografa', 'Autógrafa'],
  ['click_sign', 'Click & Sign'],
  ['otp', 'OTP'],
  ['biometrica', 'Biométrica'],
  ['efirma_sat', 'e.firma SAT'],
  ['csd', 'CSD'],
];
const evidenceOptions = [
  ['ip', 'Dirección IP'],
  ['user_agent', 'Dispositivo y navegador'],
  ['geolocation', 'Geolocalización con consentimiento'],
  ['document_hash', 'Hash del documento'],
  ['evidence_chain', 'Cadena de evidencia'],
  ['docubox_seal', 'Sello digital Docubox'],
  ['rfc3161', 'Estampa RFC 3161'],
  ['pades', 'PAdES'],
  ['nom151', 'NOM-151'],
  ['verification_qr', 'QR de verificación'],
];

function PoliciesView({ workspaceId, userId, canManage, audit }: ViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<Row>({
    security_level: 'basic',
    methods: ['autografa', 'click_sign'],
    evidence: ['ip', 'user_agent', 'document_hash'],
    resource_scope: ['documents'],
  });
  const load = useCallback(async () => {
    setLoading(true);
    const result = await supabase
      .from('organization_signature_policies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (result.error) setError(result.error.message);
    else setRows(result.data || []);
    setLoading(false);
  }, [supabase, workspaceId]);
  useEffect(() => {
    load();
  }, [load]);
  const toggle = (key: 'methods' | 'evidence', value: string) =>
    setForm((current) => ({
      ...current,
      [key]: (current[key] || []).includes(value)
        ? current[key].filter((item: string) => item !== value)
        : [...(current[key] || []), value],
    }));
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !form.name?.trim() || !form.methods.length) return;
    const result = await supabase
      .from('organization_signature_policies')
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        name: form.name.trim(),
        description: form.description?.trim() || null,
        security_level: form.security_level,
        allowed_signature_types: form.methods,
        resource_scope: form.resource_scope,
        requirements: {
          evidence: form.evidence,
          identity: { reuse_enrollment: true },
          operation: { reauthentication: form.security_level !== 'basic' },
          unavailable_capabilities: [],
        },
      })
      .select('id')
      .single();
    if (result.error) {
      setError(result.error.message);
      return;
    }
    await audit(
      'signature_policy.created',
      'organization_signature_policy',
      result.data.id,
      `Política creada: ${form.name.trim()}`
    );
    setShowForm(false);
    setForm({
      security_level: 'basic',
      methods: ['autografa', 'click_sign'],
      evidence: ['ip', 'user_agent', 'document_hash'],
      resource_scope: ['documents'],
    });
    setSuccess('Política guardada como borrador.');
    await load();
  };
  const call = async (fn: string, item: Row, message: string) => {
    const result = await supabase.rpc(fn, {
      ws_id: workspaceId,
      [fn.includes('version') ? 'source_policy_id' : 'target_policy_id']: item.id,
    });
    if (result.error) setError(result.error.message);
    else {
      setSuccess(message);
      await load();
    }
  };
  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <Header
        section="politicas-firma"
        action={
          canManage && (
            <button
              onClick={() => setShowForm((value) => !value)}
              className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"
            >
              <Plus size={16} /> Nueva política
            </button>
          )
        }
      />
      <Notices error={error} success={success} />
      <DefaultGovernanceControl
        workspaceId={workspaceId}
        kind="signature_policy"
        rows={rows}
        canManage={canManage}
      />
      {showForm && (
        <form
          onSubmit={create}
          className="grid lg:grid-cols-[360px_minmax(0,1fr)] gap-5 items-start"
        >
          <section className={`${panelClass} p-5 space-y-4`}>
            <label>
              <span className="text-sm">Nombre</span>
              <input
                required
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
              />
            </label>
            <label>
              <span className="text-sm">Nivel</span>
              <select
                value={form.security_level}
                onChange={(e) => setForm({ ...form, security_level: e.target.value })}
                className={inputClass}
              >
                <option value="basic">Básico</option>
                <option value="reinforced">Reforzado</option>
                <option value="advanced">Avanzado</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>
            <label>
              <span className="text-sm">Descripción</span>
              <textarea
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1.5 w-full min-h-24 rounded-md border border-border p-3 text-sm"
              />
            </label>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              La publicación se bloqueará si la política declara capacidades técnicas no
              disponibles.
            </div>
          </section>
          <section className={panelClass}>
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-medium">Métodos y evidencias</h3>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <p className="text-sm font-medium">Métodos permitidos</p>
                <div className="mt-2 grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {signatureMethods.map(([value, label]) => (
                    <label
                      key={value}
                      className="flex gap-3 rounded-md border border-border p-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={form.methods.includes(value)}
                        onChange={() => toggle('methods', value)}
                        className="mt-0.5 w-4 h-4"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium">Evidencia técnica requerida</p>
                <div className="mt-2 grid sm:grid-cols-2 gap-2">
                  {evidenceOptions.map(([value, label]) => (
                    <label
                      key={value}
                      className="flex gap-3 rounded-md border border-border p-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={form.evidence.includes(value)}
                        onChange={() => toggle('evidence', value)}
                        className="mt-0.5 w-4 h-4"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="h-10 px-4 rounded-md border border-border text-sm"
              >
                Cancelar
              </button>
              <button className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium">
                Guardar borrador
              </button>
            </div>
          </section>
        </form>
      )}
      <section className={panelClass}>
        {loading ? (
          <div className="py-14 text-center text-sm text-muted-foreground">
            Cargando políticas...
          </div>
        ) : rows.length ? (
          <div className="divide-y divide-border">
            {rows.map((item) => (
              <div
                key={item.id}
                className="px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-4"
              >
                <div className="w-10 h-10 rounded-md bg-primary/10 text-primary grid place-items-center">
                  <FileKey2 size={18} />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{item.name}</p>
                    <span className="text-xs text-muted-foreground">v{item.version}</span>
                    <Status value={item.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground capitalize">
                    Nivel{' '}
                    {String(item.security_level)
                      .replace('reinforced', 'reforzado')
                      .replace('advanced', 'avanzado')
                      .replace('basic', 'básico')}{' '}
                    · {(item.allowed_signature_types || []).length} métodos ·{' '}
                    {(item.requirements?.evidence || []).length} evidencias
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-3 text-sm">
                    {item.status === 'draft' && (
                      <button
                        onClick={() =>
                          call('publish_organization_signature_policy', item, 'Política publicada.')
                        }
                        className="text-primary"
                      >
                        Publicar
                      </button>
                    )}
                    {item.status !== 'draft' && (
                      <button
                        onClick={() =>
                          call(
                            'create_organization_signature_policy_version',
                            item,
                            'Nueva versión creada como borrador.'
                          )
                        }
                        className="text-primary inline-flex items-center gap-1"
                      >
                        <Copy size={14} /> Nueva versión
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="Sin políticas"
            text="Define un nivel de seguridad ejecutable antes de publicarlo."
          />
        )}
      </section>
    </div>
  );
}

function ResourcesView({ workspaceId, userId, canManage, audit }: ViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [workflows, setWorkflows] = useState<Row[]>([]);
  const [policies, setPolicies] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState('all');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<Row>({
    source: '',
    resource_type: 'clause',
    visibility: 'organization',
  });
  const load = useCallback(async () => {
    setLoading(true);
    const [catalog, available, workflowRows, policyRows] = await Promise.all([
      supabase.rpc('get_organization_resource_catalog', { ws_id: workspaceId }),
      canManage
        ? supabase.rpc('get_organization_resource_candidates', { ws_id: workspaceId })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('organization_approval_workflows')
        .select('id,name,version')
        .eq('workspace_id', workspaceId)
        .eq('status', 'published'),
      supabase
        .from('organization_signature_policies')
        .select('id,name,version')
        .eq('workspace_id', workspaceId)
        .eq('status', 'published'),
    ]);
    if (catalog.error) setError(catalog.error.message);
    else setRows(catalog.data || []);
    setCandidates(available.data || []);
    setWorkflows(workflowRows.data || []);
    setPolicies(policyRows.data || []);
    setLoading(false);
  }, [supabase, workspaceId, canManage]);
  useEffect(() => {
    load();
  }, [load]);
  const sourceChanged = (value: string) => {
    const candidate = candidates.find(
      (item) => `${item.resource_type}:${item.source_id}` === value
    );
    setForm({
      ...form,
      source: value,
      resource_type: candidate?.resource_type || value || 'clause',
      name: candidate?.name || '',
    });
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !form.name?.trim()) return;
    const candidate = candidates.find(
      (item) => `${item.resource_type}:${item.source_id}` === form.source
    );
    const result = await supabase
      .from('organization_shared_resources')
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        owner_user_id: userId,
        resource_type: form.resource_type,
        document_template_id:
          candidate?.resource_type === 'document_template' ? candidate.source_id : null,
        form_template_id: candidate?.resource_type === 'form' ? candidate.source_id : null,
        name: form.name.trim(),
        description: form.description?.trim() || null,
        visibility: form.visibility,
        workflow_id: form.workflow_id || null,
        signature_policy_id: form.signature_policy_id || null,
      })
      .select('id')
      .single();
    if (result.error) {
      setError(result.error.message);
      return;
    }
    await audit(
      'resource.shared',
      'organization_shared_resource',
      result.data.id,
      `Recurso incorporado: ${form.name.trim()}`
    );
    setShowForm(false);
    setForm({ source: '', resource_type: 'clause', visibility: 'organization' });
    setSuccess('Recurso incorporado al catálogo organizacional.');
    await load();
  };
  const update = async (item: Row, payload: Row, message: string) => {
    const result = await supabase
      .from('organization_shared_resources')
      .update(payload)
      .eq('id', item.id)
      .eq('workspace_id', workspaceId);
    if (result.error) setError(result.error.message);
    else {
      await audit('resource.updated', 'organization_shared_resource', item.id, message);
      await load();
    }
  };
  const lifecycle = async (
    fn: 'publish_organization_shared_resource' | 'create_organization_shared_resource_version',
    item: Row
  ) => {
    setError('');
    setSuccess('');
    const result = await supabase.rpc(fn, {
      ws_id: workspaceId,
      [fn.startsWith('publish') ? 'target_resource_id' : 'source_resource_id']: item.id,
    });
    if (result.error) setError(result.error.message);
    else {
      setSuccess(
        fn.startsWith('publish')
          ? 'Recurso publicado e inmovilizado.'
          : 'Nueva versión creada como borrador.'
      );
      await load();
    }
  };
  const tabs = [
    ['all', 'Todos'],
    ['document_template', 'Plantillas'],
    ['form', 'Formularios'],
    ['clause', 'Cláusulas'],
    ['custom_field', 'Campos'],
    ['taxonomy', 'Clasificaciones'],
  ];
  const filtered = tab === 'all' ? rows : rows.filter((item) => item.resource_type === tab);
  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      <Header
        section="recursos"
        action={
          canManage && (
            <button
              onClick={() => setShowForm((value) => !value)}
              className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium inline-flex items-center gap-2"
            >
              <Plus size={16} /> Incorporar recurso
            </button>
          )
        }
      />
      <Notices error={error} success={success} />
      {showForm && (
        <form
          onSubmit={create}
          className={`${panelClass} p-5 grid md:grid-cols-2 xl:grid-cols-4 gap-4`}
        >
          <label className="md:col-span-2">
            <span className="text-sm">Origen o tipo</span>
            <select
              value={form.source}
              onChange={(e) => sourceChanged(e.target.value)}
              className={inputClass}
            >
              <option value="">Crear recurso de gobierno</option>
              {candidates.length > 0 && (
                <optgroup label="Recursos existentes">
                  {candidates.map((item) => (
                    <option key={item.source_id} value={`${item.resource_type}:${item.source_id}`}>
                      {item.resource_type === 'form' ? 'Formulario' : 'Plantilla'} · {item.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Recursos internos">
                <option value="clause">Cláusula</option>
                <option value="custom_field">Campo personalizado</option>
                <option value="taxonomy">Clasificación o etiqueta</option>
              </optgroup>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="text-sm">Nombre</span>
            <input
              required
              disabled={Boolean(
                candidates.find((item) => `${item.resource_type}:${item.source_id}` === form.source)
              )}
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-sm">Visibilidad</span>
            <select
              value={form.visibility}
              onChange={(e) => setForm({ ...form, visibility: e.target.value })}
              className={inputClass}
            >
              <option value="organization">Organización</option>
              <option value="area">Área</option>
              <option value="team">Equipo</option>
              <option value="private">Privada</option>
            </select>
          </label>
          <label>
            <span className="text-sm">Flujo publicado</span>
            <select
              value={form.workflow_id || ''}
              onChange={(e) => setForm({ ...form, workflow_id: e.target.value })}
              className={inputClass}
            >
              <option value="">Sin flujo</option>
              {workflows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} v{item.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-sm">Política de firma</span>
            <select
              value={form.signature_policy_id || ''}
              onChange={(e) => setForm({ ...form, signature_policy_id: e.target.value })}
              className={inputClass}
            >
              <option value="">Sin política</option>
              {policies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} v{item.version}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-10 px-3 rounded-md border border-border text-sm"
            >
              Cancelar
            </button>
            <button className="h-10 px-4 rounded-md bg-primary text-white text-sm font-medium">
              Incorporar
            </button>
          </div>
        </form>
      )}
      <section className={panelClass}>
        <div className="px-4 border-b border-border flex gap-1 overflow-x-auto">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`h-12 px-3 whitespace-nowrap text-sm border-b-2 ${tab === value ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="py-14 text-center text-sm text-muted-foreground">
            Cargando recursos...
          </div>
        ) : filtered.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Recurso</th>
                  <th className="px-4 py-3 text-left font-medium">Visibilidad</th>
                  <th className="px-4 py-3 text-left font-medium">Gobierno</th>
                  <th className="px-4 py-3 text-left font-medium">Versión</th>
                  <th className="px-4 py-3 text-left font-medium">Estado</th>
                  <th className="px-5 py-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-md bg-primary/10 text-primary grid place-items-center">
                          {item.locked ? <LockKeyhole size={16} /> : <FileText size={16} />}
                        </span>
                        <div>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                            {item.resource_type.replaceAll('_', ' ')}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 capitalize">{item.visibility}</td>
                    <td className="px-4 py-3.5">
                      <p>{item.workflow_name || 'Sin flujo'}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.policy_name || 'Sin política de firma'}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">v{item.version}</td>
                    <td className="px-4 py-3.5">
                      <Status value={item.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-3">
                        {canManage && !['published', 'archived'].includes(item.status) && (
                          <button
                            onClick={() => lifecycle('publish_organization_shared_resource', item)}
                            className="text-primary"
                          >
                            Publicar
                          </button>
                        )}
                        {canManage && item.status === 'published' && (
                          <button
                            onClick={() =>
                              lifecycle('create_organization_shared_resource_version', item)
                            }
                            className="text-primary inline-flex items-center gap-1"
                          >
                            <Copy size={14} /> Nueva versión
                          </button>
                        )}
                        {canManage && item.status !== 'archived' && (
                          <button
                            onClick={() =>
                              update(
                                item,
                                { status: 'archived' },
                                `Recurso archivado: ${item.name}`
                              )
                            }
                            aria-label={`Archivar ${item.name}`}
                            className="text-muted-foreground"
                          >
                            <Archive size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Sin recursos en esta vista"
            text="Incorpora una plantilla o formulario existente, o crea un recurso de gobierno."
          />
        )}
      </section>
    </div>
  );
}

type ViewProps = {
  workspaceId: string;
  userId: string;
  canManage: boolean;
  audit: (
    eventType: string,
    resourceType: string,
    resourceId: string,
    summary: string
  ) => Promise<void>;
};

export default function OrganizationGovernance({ section }: { section: GovernanceSection }) {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [permissions, setPermissions] = useState<string[]>([]);
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    supabase
      .rpc('get_my_organization_permissions', { ws_id: activeWorkspace.id })
      .then(({ data }) => setPermissions((data || []).map((item: Row) => item.permission_key)));
  }, [activeWorkspace?.id, supabase]);
  if (!activeWorkspace?.id || !user?.id)
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Cargando gobierno organizacional...
      </div>
    );
  const canManage =
    ['owner', 'admin'].includes(activeWorkspace.role) ||
    permissions.includes(permissionBySection[section]);
  const audit = async (
    eventType: string,
    resourceType: string,
    resourceId: string,
    summary: string
  ) => {
    await supabase.from('organization_audit_events').insert({
      workspace_id: activeWorkspace.id,
      actor_user_id: user.id,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: resourceId,
      summary,
    });
  };
  const props = { workspaceId: activeWorkspace.id, userId: user.id, canManage, audit };
  if (section === 'directorio') return <DirectoryView {...props} />;
  if (section === 'facultades') return <AuthoritiesView {...props} />;
  if (section === 'flujos') return <WorkflowsView {...props} />;
  if (section === 'politicas-firma') return <PoliciesView {...props} />;
  return <ResourcesView {...props} />;
}
