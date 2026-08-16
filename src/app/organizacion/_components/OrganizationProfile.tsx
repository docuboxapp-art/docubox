'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CircleAlert,
  Download,
  FileCheck2,
  FileText,
  History,
  Home,
  Loader2,
  LockKeyhole,
  Save,
  ShieldCheck,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type Row = Record<string, any>;
type Tab = 'general' | 'address' | 'representative' | 'kyb' | 'history';

const tabs: Array<[Tab, string, typeof Building2]> = [
  ['general', 'Información general', Building2],
  ['address', 'Domicilio fiscal', Home],
  ['representative', 'Representación legal', UserRound],
  ['kyb', 'Expediente KYB', FileCheck2],
  ['history', 'Historial', History],
];
const documentTypes: Array<[string, string]> = [
  ['tax_status', 'Constancia de situación fiscal'],
  ['articles_of_incorporation', 'Acta constitutiva'],
  ['notarial_power', 'Poder notarial'],
  ['representative_id', 'Identificación del representante'],
  ['proof_of_address', 'Comprobante de domicilio'],
  ['beneficial_owner', 'Beneficiario controlador'],
  ['other', 'Documento adicional'],
];
const input =
  'mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:bg-muted';

function value(record: Row, key: string) {
  return record?.[key] ?? '';
}
function formatDate(date?: string | null) {
  return date
    ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(date)
      )
    : '—';
}
function statusLabel(status?: string) {
  return (
    (
      {
        pending: 'Pendiente',
        in_review: 'En revisión',
        verified: 'Verificado',
        rejected: 'Rechazado',
        expired: 'Vencido',
        superseded: 'Sustituido',
        not_started: 'No iniciada',
        capturing: 'En captura',
        update_required: 'Requiere actualización',
        suspended: 'Suspendida',
      } as Row
    )[status || ''] ||
    status ||
    'Sin estado'
  );
}
function Status({ status }: { status?: string }) {
  const positive = status === 'verified';
  const warning = ['pending', 'in_review', 'capturing', 'update_required'].includes(status || '');
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${positive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : warning ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-border bg-muted text-muted-foreground'}`}
    >
      {statusLabel(status)}
    </span>
  );
}

export default function OrganizationProfile() {
  const { activeWorkspace } = useWorkspace();
  const { session } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>('general');
  const [profile, setProfile] = useState<Row>({ fiscal_address: {}, legal_representative: {} });
  const [permissions, setPermissions] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<Row[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [documentType, setDocumentType] = useState('tax_status');
  const [file, setFile] = useState<File | null>(null);
  const [pendingSave, setPendingSave] = useState<{ action: string; values: Row } | null>(null);
  const [password, setPassword] = useState('');

  const elevated = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const canManage = elevated || permissions.includes('organization.profile.update');
  const canReadKyb = elevated || permissions.includes('kyb.read');
  const canManageKyb = elevated || permissions.includes('kyb.manage');
  const canDownloadKyb = elevated || permissions.includes('kyb.download');

  const load = useCallback(async () => {
    if (!activeWorkspace?.id || !session?.access_token) return;
    setLoading(true);
    setError('');
    const [workspace, permissionResult] = await Promise.all([
      supabase
        .from('workspaces')
        .select(
          'id,name,legal_name,trade_name,rfc,legal_person_type,tax_regime,industry,website,contact_email,contact_phone,timezone,locale,currency,fiscal_address,legal_representative,verification_status,kyb_status,verification_updated_at'
        )
        .eq('id', activeWorkspace.id)
        .single(),
      supabase.rpc('get_my_organization_permissions', { ws_id: activeWorkspace.id }),
    ]);
    if (workspace.error) setError(workspace.error.message);
    else setProfile(workspace.data || {});
    const keys = (permissionResult.data || []).map((item: Row) => item.permission_key);
    setPermissions(keys);
    if (elevated || keys.includes('kyb.read')) {
      const response = await fetch(
        `/api/organizacion/profile?workspace_id=${encodeURIComponent(activeWorkspace.id)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' }
      );
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        setEvidence(payload.evidence || []);
        setHistory(payload.history || []);
      }
    }
    setLoading(false);
  }, [activeWorkspace?.id, elevated, session?.access_token, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const apiSave = async (action: string, values: Row, reauthToken?: string) => {
    if (!activeWorkspace?.id || !session?.access_token) return false;
    const response = await fetch('/api/organizacion/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(reauthToken ? { 'X-Organization-Reauth': reauthToken } : {}),
      },
      body: JSON.stringify({ workspace_id: activeWorkspace.id, action, values }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (
        (payload.code === 'reauthentication_required' ||
          payload.code === 'reauthentication_invalid') &&
        !reauthToken
      ) {
        setPendingSave({ action, values });
        return false;
      }
      throw new Error(payload.error || 'No se pudieron guardar los cambios.');
    }
    return true;
  };

  const save = async (action: string, values: Row, reauthToken?: string) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const completed = await apiSave(action, values, reauthToken);
      if (completed) {
        setMessage('Los cambios se guardaron correctamente.');
        setPendingSave(null);
        setPassword('');
        await load();
      }
    } catch (cause: any) {
      setError(cause?.message || 'No se pudieron guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  const submitGeneral = (event: FormEvent) => {
    event.preventDefault();
    save(
      'save_general',
      Object.fromEntries(
        [
          'name',
          'legal_name',
          'trade_name',
          'rfc',
          'legal_person_type',
          'tax_regime',
          'industry',
          'website',
          'contact_email',
          'contact_phone',
          'timezone',
          'locale',
          'currency',
        ].map((key) => [key, profile[key] || ''])
      )
    );
  };
  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    save('save_address', profile.fiscal_address || {});
  };
  const submitRepresentative = (event: FormEvent) => {
    event.preventDefault();
    save('save_representative', profile.legal_representative || {});
  };

  const reauthenticate = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingSave || !activeWorkspace?.id || !session?.access_token) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/organizacion/reauthenticate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          password,
          scopes: ['organization.profile.update'],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo confirmar tu identidad.');
      await save(pendingSave.action, pendingSave.values, payload.token);
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo confirmar tu identidad.');
      setSaving(false);
    }
  };

  const uploadEvidence = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !activeWorkspace?.id || !session?.access_token) return;
    setSaving(true);
    setError('');
    setMessage('');
    const body = new FormData();
    body.append('workspace_id', activeWorkspace.id);
    body.append('document_type', documentType);
    body.append('file', file);
    try {
      const response = await fetch('/api/organizacion/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo almacenar la evidencia.');
      setFile(null);
      setMessage(`Evidencia almacenada como versión ${payload.version}.`);
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'No se pudo almacenar la evidencia.');
    } finally {
      setSaving(false);
    }
  };

  const downloadEvidence = async (id: string) => {
    if (!activeWorkspace?.id || !session?.access_token) return;
    setError('');
    const response = await fetch(
      `/api/organizacion/profile?workspace_id=${encodeURIComponent(activeWorkspace.id)}&evidence_id=${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error || 'No se pudo preparar la descarga.');
      return;
    }
    window.open(payload.url, '_blank', 'noopener,noreferrer');
  };

  const updateNested = (
    group: 'fiscal_address' | 'legal_representative',
    key: string,
    next: string
  ) =>
    setProfile((current) => ({ ...current, [group]: { ...(current[group] || {}), [key]: next } }));
  const notices = (
    <>
      {error && (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <CircleAlert size={17} />
          {error}
        </div>
      )}
      {message && (
        <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Check size={17} />
          {message}
        </div>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <header>
        <h2 className="text-xl font-medium text-foreground">Perfil y verificación</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Identidad fiscal, representación y expediente empresarial de la organización.
        </p>
      </header>
      {notices}
      <div className="overflow-x-auto border-b border-border">
        <div className="flex min-w-max gap-1">
          {tabs
            .filter(([key]) => !['kyb', 'history'].includes(key) || canReadKyb)
            .map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm ${tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
        </div>
      </div>

      {tab === 'general' && (
        <form
          onSubmit={submitGeneral}
          className="overflow-hidden rounded-lg border border-border bg-background"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h3 className="font-medium">Información general</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Datos fiscales y de contacto utilizados por Docubox.
              </p>
            </div>
            {canManage && (
              <button
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                <Save size={16} />
                Guardar
              </button>
            )}
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            {[
              ['name', 'Nombre del espacio'],
              ['legal_name', 'Razón social'],
              ['trade_name', 'Nombre comercial'],
              ['rfc', 'RFC'],
              ['tax_regime', 'Régimen fiscal'],
              ['industry', 'Actividad o sector'],
              ['website', 'Sitio web'],
              ['contact_email', 'Correo de contacto'],
              ['contact_phone', 'Teléfono'],
              ['timezone', 'Zona horaria'],
              ['locale', 'Idioma'],
              ['currency', 'Moneda'],
            ].map(([key, label]) => (
              <label key={key} className="text-sm">
                {label}
                <input
                  disabled={!canManage || loading}
                  value={value(profile, key)}
                  onChange={(event) => setProfile({ ...profile, [key]: event.target.value })}
                  className={input}
                />
              </label>
            ))}
            <label className="text-sm">
              Tipo de persona
              <select
                disabled={!canManage || loading}
                value={value(profile, 'legal_person_type')}
                onChange={(event) =>
                  setProfile({ ...profile, legal_person_type: event.target.value })
                }
                className={input}
              >
                <option value="">Sin definir</option>
                <option value="individual_business">
                  Persona física con actividad empresarial
                </option>
                <option value="legal_entity">Persona moral</option>
              </select>
            </label>
          </div>
        </form>
      )}

      {tab === 'address' && (
        <form
          onSubmit={submitAddress}
          className="overflow-hidden rounded-lg border border-border bg-background"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h3 className="font-medium">Domicilio fiscal</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Conserva el domicilio normalizado asociado al RFC.
              </p>
            </div>
            {canManage && (
              <button
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                <Save size={16} />
                Guardar
              </button>
            )}
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            {[
              ['postal_code', 'Código postal'],
              ['state', 'Estado'],
              ['municipality', 'Municipio o alcaldía'],
              ['locality', 'Localidad'],
              ['neighborhood', 'Colonia'],
              ['street', 'Calle'],
              ['exterior_number', 'Número exterior'],
              ['interior_number', 'Número interior'],
              ['country', 'País (ISO)'],
            ].map(([key, label]) => (
              <label key={key} className="text-sm">
                {label}
                <input
                  disabled={!canManage || loading}
                  value={value(profile.fiscal_address, key)}
                  onChange={(event) => updateNested('fiscal_address', key, event.target.value)}
                  className={input}
                />
              </label>
            ))}
          </div>
        </form>
      )}

      {tab === 'representative' && (
        <form
          onSubmit={submitRepresentative}
          className="overflow-hidden rounded-lg border border-border bg-background"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h3 className="font-medium">Representación legal</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Los cambios requieren confirmación de identidad y quedan auditados.
              </p>
            </div>
            {canManage && (
              <button
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                <Save size={16} />
                Guardar
              </button>
            )}
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            {[
              ['full_name', 'Nombre completo'],
              ['job_title', 'Cargo'],
              ['rfc', 'RFC'],
              ['curp', 'CURP'],
              ['email', 'Correo'],
              ['phone', 'Teléfono'],
              ['valid_from', 'Inicio de vigencia'],
              ['valid_until', 'Fin de vigencia'],
              ['instrument_reference', 'Poder o instrumento notarial'],
            ].map(([key, label]) => (
              <label
                key={key}
                className={`text-sm ${key === 'instrument_reference' ? 'md:col-span-2' : ''}`}
              >
                {label}
                <input
                  type={key.includes('valid_') ? 'date' : 'text'}
                  disabled={!canManage || loading}
                  value={value(profile.legal_representative, key)}
                  onChange={(event) =>
                    updateNested('legal_representative', key, event.target.value)
                  }
                  className={input}
                />
              </label>
            ))}
          </div>
        </form>
      )}

      {tab === 'kyb' && canReadKyb && (
        <div className="space-y-4">
          {canManageKyb && (
            <form
              onSubmit={uploadEvidence}
              className="overflow-hidden rounded-lg border border-border bg-background"
            >
              <div className="border-b border-border px-5 py-4">
                <h3 className="font-medium">Incorporar evidencia</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  PDF o imagen de hasta 10 MB. Cada reemplazo crea una nueva versión.
                </p>
              </div>
              <div className="grid gap-4 p-5 md:grid-cols-[minmax(220px,0.7fr)_1fr_auto] md:items-end">
                <label className="text-sm">
                  Tipo documental
                  <select
                    value={documentType}
                    onChange={(event) => setDocumentType(event.target.value)}
                    className={input}
                  >
                    {documentTypes.map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Archivo
                  <input
                    required
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                    className="mt-1.5 block h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
                <button
                  disabled={saving || !file}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Upload size={16} />
                  Cargar
                </button>
              </div>
            </form>
          )}
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="border-b border-border px-5 py-4">
              <h3 className="font-medium">Documentos empresariales</h3>
            </div>
            {evidence.length ? (
              <div className="divide-y divide-border">
                {evidence.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
                  >
                    <FileText size={19} className="text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.display_name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {documentTypes.find(([key]) => key === item.document_type)?.[1] ||
                          item.document_type}{' '}
                        · v{item.version} · {(Number(item.byte_size) / 1024).toFixed(0)} KB ·{' '}
                        {formatDate(item.created_at)}
                      </p>
                    </div>
                    <Status status={item.status} />
                    {canDownloadKyb && (
                      <button
                        onClick={() => downloadEvidence(item.id)}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm"
                      >
                        <Download size={15} />
                        Descargar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-14 text-center text-sm text-muted-foreground">
                Todavía no existe evidencia empresarial.
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'history' && canReadKyb && (
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h3 className="font-medium">Historial de verificación</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Resultados emitidos por procesos autorizados; no pueden editarse manualmente.
              </p>
            </div>
            <div className="flex gap-2">
              <Status status={profile.verification_status} />
              <Status status={profile.kyb_status} />
            </div>
          </div>
          {history.length ? (
            <div className="divide-y divide-border">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[150px_1fr_auto]"
                >
                  <div>
                    <Status status={item.status} />
                  </div>
                  <div>
                    <p className="font-medium">{item.provider || 'Docubox'}</p>
                    <p className="mt-1 text-muted-foreground">
                      {item.observations || item.result_code || 'Sin observaciones adicionales.'}
                    </p>
                  </div>
                  <time className="text-muted-foreground">{formatDate(item.occurred_at)}</time>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-14 text-center text-sm text-muted-foreground">
              La verificación aún no ha generado eventos.
            </div>
          )}
        </section>
      )}

      {pendingSave && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={reauthenticate}
            className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-background shadow-xl"
          >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div className="flex gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <LockKeyhole size={20} />
                </div>
                <div>
                  <h3 className="font-medium">Confirma tu identidad</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Este cambio afecta datos fiscales o de representación.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingSave(null);
                  setPassword('');
                }}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              <label className="text-sm">
                Contraseña
                <input
                  autoFocus
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={input}
                />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingSave(null)}
                  className="h-10 rounded-md border border-border px-4 text-sm"
                >
                  Cancelar
                </button>
                <button
                  disabled={saving}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white"
                >
                  {saving ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  Confirmar y guardar
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
