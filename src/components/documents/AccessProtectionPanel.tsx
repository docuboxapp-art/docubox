'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clipboard,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type AccessEvent = {
  id: string;
  action: string;
  result: string | null;
  reason: string | null;
  actor_id: string | null;
  actor_email: string | null;
  created_at: string;
};

type AccessResponse = {
  enabled: boolean;
  canManage: boolean;
  configuredAt: string | null;
  updatedAt: string | null;
  configuredBy: string | null;
  protectedParticipantCount: number;
  events: AccessEvent[];
};

type AuditFilter = 'all' | 'success' | 'failed' | 'configuration' | 'lockout';

const eventLabels: Record<string, string> = {
  VIEW_ACCESS_PROTECTION_ENABLED: 'Protección activada',
  VIEW_ACCESS_PROTECTION_REENABLED: 'Protección reactivada',
  VIEW_ACCESS_CHALLENGE_SHOWN: 'Challenge mostrado',
  VIEW_ACCESS_FAILED: 'Código incorrecto',
  VIEW_ACCESS_GRANTED: 'Documento desbloqueado',
  VIEW_ACCESS_TEMPORARILY_LOCKED: 'Bloqueo temporal',
  VIEW_ACCESS_CODE_CHANGED: 'Código modificado',
  VIEW_ACCESS_UNLOCKS_INVALIDATED: 'Desbloqueos invalidados',
  VIEW_ACCESS_PROTECTION_DISABLED: 'Protección desactivada',
  VIEW_ACCESS_SESSION_EXPIRED: 'Desbloqueo expirado',
};

const configurationEvents = new Set([
  'VIEW_ACCESS_PROTECTION_ENABLED',
  'VIEW_ACCESS_PROTECTION_REENABLED',
  'VIEW_ACCESS_CODE_CHANGED',
  'VIEW_ACCESS_UNLOCKS_INVALIDATED',
  'VIEW_ACCESS_PROTECTION_DISABLED',
]);

function formatDateTime(value?: string | null) {
  if (!value) return 'Sin registro';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function resultLabel(result?: string | null) {
  if (result === 'success') return 'Correcto';
  if (result === 'denied' || result === 'failed') return 'Fallido';
  return 'Informativo';
}

function resultClass(result?: string | null) {
  return result === 'success'
    ? 'text-emerald-700'
    : result === 'denied' || result === 'failed'
      ? 'text-red-600'
      : 'text-slate-500';
}

async function authHeaders(json = false) {
  const { data } = await createClient().auth.getSession();
  if (!data.session?.access_token) throw new Error('Tu sesión no está disponible.');
  return {
    Authorization: `Bearer ${data.session.access_token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

export function AccessProtectionPanel({
  documentId,
  initialSection = 'configuration',
  onChanged,
}: {
  documentId: string;
  initialSection?: 'configuration' | 'audit';
  onChanged?: (summary: { enabled: boolean; canManage: boolean }) => void;
}) {
  const [section, setSection] = useState<'configuration' | 'audit'>(initialSection);
  const [data, setData] = useState<AccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [codeMode, setCodeMode] = useState<'enable' | 'change' | null>(null);
  const [showDisable, setShowDisable] = useState(false);
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealedCode, setRevealedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/documentos/${documentId}/view-access`, {
        headers: await authHeaders(),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error || 'No fue posible consultar la protección.');
      const next = payload as AccessResponse;
      setData(next);
      onChanged?.({ enabled: next.enabled, canManage: next.canManage });
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'No fue posible consultar la protección.'
      );
    } finally {
      setLoading(false);
    }
  }, [documentId, onChanged]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredEvents = useMemo(
    () =>
      (data?.events || []).filter((event) => {
        if (auditFilter === 'all') return true;
        if (auditFilter === 'success') return event.action === 'VIEW_ACCESS_GRANTED';
        if (auditFilter === 'failed') return event.action === 'VIEW_ACCESS_FAILED';
        if (auditFilter === 'configuration') return configurationEvents.has(event.action);
        return event.action === 'VIEW_ACCESS_TEMPORARILY_LOCKED';
      }),
    [auditFilter, data?.events]
  );

  const closeCodeModal = () => {
    if (saving) return;
    setCodeMode(null);
    setCode('');
    setConfirmation('');
    setError('');
  };

  const saveCode = async () => {
    if (code.length < 8 || code.length > 128) {
      setError('El código debe tener entre 8 y 128 caracteres.');
      return;
    }
    if (code !== confirmation) {
      setError('Los códigos no coinciden.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/documentos/${documentId}/view-access`, {
        method: 'PUT',
        headers: await authHeaders(true),
        body: JSON.stringify({ code, confirmation }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'No fue posible guardar el código.');
      const oneTimeCode = code;
      setCodeMode(null);
      setCode('');
      setConfirmation('');
      setRevealedCode(oneTimeCode);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'No fue posible guardar el código.'
      );
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/documentos/${documentId}/view-access`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error || 'No fue posible desactivar la protección.');
      setShowDisable(false);
      await load();
    } catch (disableError) {
      setError(
        disableError instanceof Error
          ? disableError.message
          : 'No fue posible desactivar la protección.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return <div className="p-5 text-sm text-slate-500">Cargando Protección de acceso...</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex border-b border-slate-200 bg-white px-4">
        <button
          type="button"
          onClick={() => setSection('configuration')}
          className={`border-b-2 px-3 py-3 text-xs font-medium ${section === 'configuration' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Configuración
        </button>
        <button
          type="button"
          onClick={() => setSection('audit')}
          className={`border-b-2 px-3 py-3 text-xs font-medium ${section === 'audit' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Bitácora
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && !codeMode && !showDisable && (
          <div
            role="alert"
            className="mb-4 flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {section === 'configuration' ? (
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4">
              <div className="flex min-w-0 gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${data?.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}
                >
                  <Lock size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Protección de visualización
                  </h3>
                  <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">
                    Solicita un código a los participantes antes de permitirles visualizar el
                    contenido del documento.
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${data?.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
              >
                {data?.enabled ? 'Activa' : 'Inactiva'}
              </span>
            </div>

            {data?.enabled ? (
              <div className="p-4">
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] font-medium uppercase text-slate-400">
                      Configurada por
                    </dt>
                    <dd className="mt-1 break-all text-xs text-slate-800">
                      {data.configuredBy || 'Usuario autorizado'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase text-slate-400">
                      Fecha de activación
                    </dt>
                    <dd className="mt-1 text-xs text-slate-800">
                      {formatDateTime(data.configuredAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase text-slate-400">
                      Última modificación
                    </dt>
                    <dd className="mt-1 text-xs text-slate-800">
                      {formatDateTime(data.updatedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase text-slate-400">
                      Participantes protegidos
                    </dt>
                    <dd className="mt-1 text-xs text-slate-800">
                      {data.protectedParticipantCount}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 rounded-md bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">
                  Todos los participantes autorizados deberán proporcionar el código para visualizar
                  este documento.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setCodeMode('change');
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-white hover:bg-primary/90"
                  >
                    <KeyRound size={14} /> Cambiar código
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setShowDisable(true);
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    <Lock size={14} /> Desactivar protección
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setCodeMode('enable');
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-white hover:bg-primary/90"
                >
                  <ShieldCheck size={14} /> Activar protección
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Bitácora de acceso</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Eventos exclusivos de la protección y los desbloqueos.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={auditFilter}
                  onChange={(event) => setAuditFilter(event.target.value as AuditFilter)}
                  aria-label="Filtrar bitácora de acceso"
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
                >
                  <option value="all">Todos</option>
                  <option value="success">Accesos exitosos</option>
                  <option value="failed">Intentos fallidos</option>
                  <option value="configuration">Configuración</option>
                  <option value="lockout">Bloqueos</option>
                </select>
                <button
                  type="button"
                  onClick={() => void load()}
                  title="Actualizar bitácora"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
            {filteredEvents.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                No hay actividad de Protección de acceso registrada.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Fecha / hora</th>
                      <th className="px-4 py-2.5 font-medium">Evento</th>
                      <th className="px-4 py-2.5 font-medium">Actor / participante</th>
                      <th className="px-4 py-2.5 font-medium">Resultado</th>
                      <th className="px-4 py-2.5 font-medium">Detalles</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEvents.map((event) => (
                      <tr key={event.id}>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {formatDateTime(event.created_at)}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {eventLabels[event.action] || event.action}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {event.actor_email || 'Sistema'}
                        </td>
                        <td className={`px-4 py-3 font-medium ${resultClass(event.result)}`}>
                          {resultLabel(event.result)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {event.reason || 'Sin observaciones'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      {codeMode && (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="access-code-title"
        >
          <section className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="border-b border-slate-100 px-5 py-4">
              <div>
                <h3 id="access-code-title" className="text-base font-semibold text-slate-900">
                  {codeMode === 'change'
                    ? 'Cambiar código de acceso'
                    : 'Activar protección de acceso'}
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {codeMode === 'change'
                    ? 'El código anterior dejará de funcionar y los participantes deberán utilizar el nuevo código.'
                    : 'Define el código que los participantes deberán introducir para visualizar el documento.'}
                </p>
              </div>
            </header>
            <div className="space-y-4 px-5 py-4">
              <label className="block text-xs font-medium text-slate-700">
                {codeMode === 'change' ? 'Nuevo código' : 'Código de acceso'}{' '}
                <span className="text-red-500">*</span>
                <span className="relative mt-1.5 block">
                  <input
                    type={showCode ? 'text' : 'password'}
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value);
                      setError('');
                    }}
                    autoFocus
                    placeholder="Mínimo 8 caracteres"
                    className="h-10 w-full rounded-md border border-slate-200 px-3 pr-10 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCode((visible) => !visible)}
                    aria-label={showCode ? 'Ocultar código' : 'Mostrar código'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showCode ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </span>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                {codeMode === 'change' ? 'Confirmar nuevo código' : 'Confirmar código'}{' '}
                <span className="text-red-500">*</span>
                <span className="relative mt-1.5 block">
                  <input
                    type={showConfirmation ? 'text' : 'password'}
                    value={confirmation}
                    onChange={(event) => {
                      setConfirmation(event.target.value);
                      setError('');
                    }}
                    placeholder="Repite el código"
                    className="h-10 w-full rounded-md border border-slate-200 px-3 pr-10 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmation((visible) => !visible)}
                    aria-label={showConfirmation ? 'Ocultar confirmación' : 'Mostrar confirmación'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showConfirmation ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </span>
              </label>
              {error && (
                <div
                  role="alert"
                  className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  <AlertTriangle size={14} className="shrink-0" />
                  {error}
                </div>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={closeCodeModal}
                disabled={saving}
                className="h-9 rounded-md border border-slate-200 px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void saveCode()}
                disabled={saving}
                className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {saving
                  ? 'Guardando...'
                  : codeMode === 'change'
                    ? 'Guardar nuevo código'
                    : 'Activar protección'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {showDisable && (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disable-access-title"
        >
          <section className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="border-b border-slate-100 px-5 py-4">
              <div>
                <h3 id="disable-access-title" className="text-base font-semibold text-slate-900">
                  ¿Desactivar la protección de acceso?
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Los participantes autorizados podrán visualizar el documento sin introducir un
                  código de acceso.
                </p>
              </div>
            </header>
            {error && (
              <div
                role="alert"
                className="mx-5 mt-4 flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                <AlertTriangle size={14} className="shrink-0" />
                {error}
              </div>
            )}
            <footer className="mt-4 flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setShowDisable(false)}
                disabled={saving}
                className="h-9 rounded-md border border-slate-200 px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void disable()}
                disabled={saving}
                className="h-9 rounded-md bg-red-500 px-4 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
              >
                {saving ? 'Desactivando...' : 'Desactivar protección'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {revealedCode && (
        <div
          className="fixed inset-0 z-[410] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revealed-access-title"
        >
          <section className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="border-b border-slate-100 px-5 py-4">
              <h3 id="revealed-access-title" className="text-base font-semibold text-slate-900">
                Código de acceso configurado
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Guarda o comparte este código ahora. Por seguridad, Docubox no podrá volver a
                mostrarlo.
              </p>
            </header>
            <div className="px-5 py-5">
              <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
                <code className="min-w-0 break-all text-sm font-semibold text-blue-900">
                  {revealedCode}
                </code>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(revealedCode);
                    setCopied(true);
                  }}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                >
                  <Clipboard size={13} />
                  {copied ? 'Copiado' : 'Copiar código'}
                </button>
              </div>
            </div>
            <footer className="flex justify-end border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setRevealedCode(null);
                  setCopied(false);
                }}
                className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90"
              >
                Cerrar
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
