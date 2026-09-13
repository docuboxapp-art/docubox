'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Edit3,
  Plus,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Hold = {
  id: string;
  status: 'ACTIVE' | 'RELEASED';
  reason_code?: string;
  reason_label?: string;
  case_reference?: string | null;
  notes?: string | null;
  review_at?: string | null;
  activated_by?: string;
  activated_by_name?: string;
  activated_at: string;
  released_at?: string | null;
  release_reason?: string | null;
  release_notes?: string | null;
  released_by_name?: string | null;
};

type Response = {
  hasHistory: boolean;
  activeCount: number;
  canViewDetails: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canRelease: boolean;
  holds: Hold[];
  events: Array<{ id: string; action: string; created_at: string; reason?: string }>;
};

const reasons = [
  ['litigio', 'Litigio / procedimiento judicial'],
  ['requerimiento_autoridad', 'Requerimiento de autoridad'],
  ['auditoria', 'Auditoría'],
  ['investigacion_interna', 'Investigación interna'],
  ['controversia_contractual', 'Controversia contractual'],
  ['cumplimiento_regulatorio_fiscal', 'Cumplimiento regulatorio/fiscal'],
  ['solicitud_cliente', 'Solicitud del cliente'],
  ['preservacion_preventiva', 'Preservación preventiva'],
  ['otro', 'Otro'],
] as const;

const emptyForm = { reasonCode: '', caseReference: '', reviewAt: '', notes: '' };

function dateTime(value?: string | null) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

export function LegalHoldPanel({
  documentId,
  openCreateInitially = false,
  onChanged,
}: {
  documentId: string;
  openCreateInitially?: boolean;
  onChanged?: (summary: { hasHistory: boolean; activeCount: number }) => void;
}) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(openCreateInitially);
  const [editing, setEditing] = useState<Hold | null>(null);
  const [releasing, setReleasing] = useState<Hold | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [additionalFieldsOpen, setAdditionalFieldsOpen] = useState(false);
  const [releaseReason, setReleaseReason] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const request = useCallback(
    async (method = 'GET', body?: unknown) => {
      const { data: auth } = await createClient().auth.getSession();
      if (!auth.session?.access_token) throw new Error('Tu sesión no está disponible.');
      const response = await fetch(`/api/documentos/${documentId}/legal-hold`, {
        method,
        headers: {
          Authorization: `Bearer ${auth.session.access_token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No fue posible gestionar Legal Hold.');
      return payload;
    },
    [documentId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = (await request()) as Response;
      setData(result);
      onChanged?.({ hasHistory: result.hasHistory, activeCount: result.activeCount });
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'No fue posible consultar Legal Hold.'
      );
    } finally {
      setLoading(false);
    }
  }, [onChanged, request]);

  useEffect(() => {
    let active = true;
    request()
      .then((result) => {
        if (!active) return;
        const response = result as Response;
        setData(response);
        onChanged?.({ hasHistory: response.hasHistory, activeCount: response.activeCount });
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : 'No fue posible consultar Legal Hold.'
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onChanged, request]);

  const save = async () => {
    if (!form.reasonCode) return;
    setSaving(true);
    setError('');
    try {
      await request(editing ? 'PATCH' : 'POST', {
        ...(editing ? { holdId: editing.id } : {}),
        ...form,
        reviewAt: form.reviewAt || null,
      });
      setForm(emptyForm);
      setEditing(null);
      setShowCreate(false);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'No fue posible guardar Legal Hold.'
      );
    } finally {
      setSaving(false);
    }
  };

  const release = async () => {
    if (!releasing || !releaseReason.trim()) return;
    setSaving(true);
    setError('');
    try {
      await request('DELETE', {
        holdId: releasing.id,
        confirmation: 'LIBERAR',
        reason: releaseReason,
        notes: releaseNotes,
      });
      setReleasing(null);
      setReleaseReason('');
      setReleaseNotes('');
      await load();
    } catch (releaseError) {
      setError(
        releaseError instanceof Error ? releaseError.message : 'No fue posible liberar Legal Hold.'
      );
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (hold: Hold) => {
    setEditing(hold);
    setShowCreate(true);
    setForm({
      reasonCode: hold.reason_code || '',
      caseReference: hold.case_reference || '',
      reviewAt: hold.review_at?.slice(0, 10) || '',
      notes: hold.notes || '',
    });
    setAdditionalFieldsOpen(false);
  };

  if (loading && !data)
    return <div className="p-5 text-sm text-slate-500">Cargando Legal Hold...</div>;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <ShieldCheck
                size={20}
                className={data?.activeCount ? 'text-amber-600' : 'text-slate-400'}
              />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {data?.activeCount ? 'Legal Hold activo' : 'Sin Legal Hold activo'}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {data?.activeCount
                    ? `${data.activeCount} conservación${data.activeCount === 1 ? '' : 'es'} vigente${data.activeCount === 1 ? '' : 's'}. El documento y su historia no pueden destruirse.`
                    : 'Este documento estuvo sujeto anteriormente a conservación legal.'}
                </p>
              </div>
            </div>
            {data?.canCreate && !showCreate && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex shrink-0 items-center gap-1 rounded-md border border-blue-200 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
              >
                <Plus size={13} /> Activar nuevo
              </button>
            )}
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {showCreate && data?.canCreate && (
          <section className="rounded-lg border border-blue-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">
                {editing ? 'Actualizar Legal Hold' : 'Activar Legal Hold'}
              </p>
              <button
                title="Cancelar"
                onClick={() => {
                  setShowCreate(false);
                  setEditing(null);
                  setForm(emptyForm);
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-700">
                Motivo *
                <select
                  value={form.reasonCode}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, reasonCode: event.target.value }))
                  }
                  className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
                >
                  <option value="">Selecciona un motivo</option>
                  {reasons.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="overflow-hidden rounded-md border border-slate-200">
                <button
                  type="button"
                  aria-expanded={additionalFieldsOpen}
                  aria-controls="legal-hold-panel-additional-fields"
                  onClick={() => setAdditionalFieldsOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <span>Información adicional</span>
                  <ChevronDown
                    size={15}
                    className={`shrink-0 transition-transform ${additionalFieldsOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {additionalFieldsOpen && (
                  <div
                    id="legal-hold-panel-additional-fields"
                    className="space-y-3 border-t border-slate-200 p-3"
                  >
                    <label className="block text-xs font-medium text-slate-700">
                      Referencia / expediente
                      <input
                        value={form.caseReference}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, caseReference: event.target.value }))
                        }
                        className="mt-1 h-9 w-full rounded-md border border-slate-200 px-3 text-xs font-normal"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-700">
                      Fecha de revisión
                      <input
                        type="date"
                        value={form.reviewAt}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, reviewAt: event.target.value }))
                        }
                        className="mt-1 h-9 w-full rounded-md border border-slate-200 px-3 text-xs font-normal"
                      />
                      <span className="mt-1 block text-[11px] font-normal text-slate-500">
                        Es informativa y nunca libera el Legal Hold automáticamente.
                      </span>
                    </label>
                    <label className="block text-xs font-medium text-slate-700">
                      Observaciones
                      <textarea
                        rows={3}
                        value={form.notes}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, notes: event.target.value }))
                        }
                        className="mt-1 w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-xs font-normal"
                      />
                    </label>
                  </div>
                )}
              </div>
              <button
                disabled={!form.reasonCode || saving}
                onClick={save}
                className="w-full rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Activar Legal Hold'}
              </button>
            </div>
          </section>
        )}

        <section>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Historial</p>
          <div className="space-y-3">
            {(data?.holds || []).map((hold) => (
              <article key={hold.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex gap-2">
                    {hold.status === 'ACTIVE' ? (
                      <ShieldCheck size={16} className="text-amber-600" />
                    ) : (
                      <CheckCircle2 size={16} className="text-emerald-600" />
                    )}
                    <div>
                      <p className="text-xs font-semibold text-slate-900">
                        {hold.reason_label ||
                          (hold.status === 'ACTIVE'
                            ? 'Conservación legal activa'
                            : 'Legal Hold liberado')}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Activado: {dateTime(hold.activated_at)}
                      </p>
                      {hold.activated_by_name && (
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Por: {hold.activated_by_name}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${hold.status === 'ACTIVE' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}
                  >
                    {hold.status === 'ACTIVE' ? 'ACTIVO' : 'LIBERADO'}
                  </span>
                </div>
                {data?.canViewDetails && (
                  <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                    {hold.case_reference && (
                      <p>
                        <span className="font-medium">Referencia:</span> {hold.case_reference}
                      </p>
                    )}
                    {hold.review_at && (
                      <p className="flex items-center gap-1">
                        <Clock size={12} /> Revisión: {dateTime(hold.review_at)}
                      </p>
                    )}
                    {hold.notes && <p className="whitespace-pre-wrap">{hold.notes}</p>}
                    {hold.released_at && (
                      <p>
                        Liberado: {dateTime(hold.released_at)}. {hold.release_reason}
                      </p>
                    )}
                  </div>
                )}
                {hold.status === 'ACTIVE' && !releasing && (
                  <div className="mt-3 flex gap-2">
                    {data?.canUpdate && (
                      <button
                        onClick={() => beginEdit(hold)}
                        className="flex items-center gap-1 text-xs font-medium text-blue-700"
                      >
                        <Edit3 size={12} /> Actualizar
                      </button>
                    )}
                    {data?.canRelease && (
                      <button
                        onClick={() => setReleasing(hold)}
                        className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-600"
                      >
                        <Unlock size={12} /> Liberar Legal Hold
                      </button>
                    )}
                  </div>
                )}
                {releasing?.id === hold.id && (
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                    <input
                      value={releaseReason}
                      onChange={(event) => setReleaseReason(event.target.value)}
                      placeholder="Motivo de liberación *"
                      className="h-9 w-full rounded-md border border-slate-200 px-3 text-xs"
                    />
                    <textarea
                      rows={2}
                      value={releaseNotes}
                      onChange={(event) => setReleaseNotes(event.target.value)}
                      placeholder="Observaciones opcionales"
                      className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-xs"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setReleasing(null)}
                        className="rounded-md border border-slate-200 px-3 py-1.5 text-xs"
                      >
                        Cancelar
                      </button>
                      <button
                        disabled={!releaseReason.trim() || saving}
                        onClick={release}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Confirmar liberación
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
        {(data?.events || []).length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="mb-3 text-xs font-semibold uppercase text-slate-500">Movimientos</p>
            <div className="space-y-3">
              {data!.events.map((event) => (
                <div key={event.id} className="flex gap-2 text-xs">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <div>
                    <p className="font-medium text-slate-800">
                      {event.action === 'LEGAL_HOLD_ACTIVATED'
                        ? 'Legal Hold activado'
                        : event.action === 'LEGAL_HOLD_UPDATED'
                          ? 'Información actualizada'
                          : 'Legal Hold liberado'}
                    </p>
                    <p className="text-[11px] text-slate-500">{dateTime(event.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
