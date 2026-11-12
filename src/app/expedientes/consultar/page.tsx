'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  FolderArchive,
  Loader2,
  RefreshCw,
  Search,
  Send,
  X,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { caseRequest } from '@/lib/case-files/runtime-client';
import { subscribeToCaseListReturn } from '@/lib/case-files/consultation-refresh';
import { CASE_STATUS_META, type CaseFileStatus } from '@/lib/case-files/schema';
import { caseSignatureLabels, type CaseSignatureType } from '@/lib/case-files/launch-settings';
import { CaseStatusBadge } from '../components/CaseUI';
import LaunchDialog from '../lanzar/LaunchDialog';
type Row = {
  isScheduled: boolean;
  id: string;
  title: string;
  folio: string;
  templateName: string;
  template_id: string;
  subject_name: string;
  ownerName: string;
  status: CaseFileStatus;
  progress: number;
  created_at: string;
  updated_at: string;
  canManage: boolean;
  participants: { id: string; name: string; email: string; role: string }[];
  delivery: { sent: number; total: number };
  launch: {
    access_mode: string;
    signature_type: CaseSignatureType;
    require_liveness: boolean;
    expiration_hours: number;
    scheduled_at: string | null;
    timezone: string;
  } | null;
};
type Result = {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
  templates: { id: string; name: string }[];
  stats: { total: number; completed: number; observed: number; active: number };
};
const control =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';
const date = (v: string, timezone = 'America/Mazatlan') =>
  new Date(v).toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  });
export default function ConsultCasePage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-slate-500">Cargando expedientes…</p>}>
      <Content />
    </Suspense>
  );
}
function Content() {
  const params = useSearchParams(),
    { activeWorkspace } = useWorkspace();
  const [type, setType] = useState(params.get('tipo') || ''),
    [status, setStatus] = useState(params.get('estado') || 'all'),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [sort, setSort] = useState('recent'),
    [scheduled, setScheduled] = useState(false),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [data, setData] = useState<Result | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<Row | null>(null),
    [access, setAccess] = useState<{ url: string; code: string } | null>(null),
    [cancel, setCancel] = useState<Row | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    return subscribeToCaseListReturn(() => setRetry((value) => value + 1));
  }, [activeWorkspace?.id]);
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let live = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      const p = new URLSearchParams({
        workspaceId: activeWorkspace.id,
        page: String(page),
        q: search,
        estado: status,
        orden: sort,
      });
      if (type) p.set('tipo', type);
      if (from) p.set('desde', from);
      if (to) p.set('hasta', to);
      if (scheduled) p.set('envio', 'scheduled');
      caseRequest<Result>(`/api/expedientes/consultar?${p}`)
        .then((v) => {
          if (live) setData(v);
        })
        .catch((c) => {
          if (live)
            setError(c instanceof Error ? c.message : 'No se pudieron consultar los expedientes.');
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [activeWorkspace?.id, type, status, search, from, to, sort, scheduled, page, retry]);
  function reset() {
    setType('');
    setStatus('all');
    setQuery('');
    setFrom('');
    setTo('');
    setScheduled(false);
    setPage(1);
  }
  async function publicAccess(row: Row) {
    setBusy(true);
    setError('');
    try {
      const v = await caseRequest<{ access: { url: string; code: string } }>(
        `/api/expedientes/${row.id}/lanzamiento`,
        { action: 'access' }
      );
      setAccess(v.access);
    } catch (c) {
      setError(c instanceof Error ? c.message : 'No se pudo consultar el acceso.');
    } finally {
      setBusy(false);
    }
  }
  async function cancelSchedule() {
    if (!cancel) return;
    setBusy(true);
    setError('');
    try {
      await caseRequest(`/api/expedientes/${cancel.id}/lanzamiento`, { action: 'cancel' });
      setCancel(null);
      setRetry((v) => v + 1);
    } catch (c) {
      setError(c instanceof Error ? c.message : 'No se pudo cancelar el envío.');
    } finally {
      setBusy(false);
    }
  }
  const filtered = !!(type || status !== 'all' || search || from || to || scheduled);
  return (
    <AppLayout>
      <div className="mx-auto max-w-[1800px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <Link
              href="/expedientes"
              className="mb-3 inline-flex items-center gap-2 text-xs text-slate-500"
            >
              <ArrowLeft size={14} />
              Expedientes
            </Link>
            <h1 className="text-2xl font-normal">Consultar expedientes</h1>
            <p className="mt-1 text-sm text-slate-500">
              Revisa los lanzamientos, las entregas y el avance de cada expediente.
            </p>
          </div>
          <Link
            href="/expedientes/lanzar"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white"
          >
            <Send size={16} />
            Lanzar expediente
          </Link>
        </header>
        {data && (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Expedientes', data.stats.total],
              ['En seguimiento', data.stats.active],
              ['Completados', data.stats.completed],
              ['Con observaciones', data.stats.observed],
            ].map(([name, count]) => (
              <div key={name} className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-2xl tabular-nums">{count}</p>
                <p className="mt-1 text-xs text-slate-500">{name}</p>
              </div>
            ))}
          </section>
        )}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap gap-3 p-4">
            <label className="relative min-w-52 flex-1">
              <Search size={17} className="absolute left-3 top-3 text-slate-400" />
              <input
                type="search"
                aria-label="Buscar expedientes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por expediente, folio o participante..."
                className={`${control} w-full pl-10`}
              />
            </label>
            <label className="relative">
              <ArrowUpDown size={15} className="absolute left-3 top-3 text-slate-500" />
              <select
                aria-label="Ordenar expedientes"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
                className={`${control} pl-9`}
              >
                <option value="recent">Más recientes</option>
                <option value="oldest">Más antiguos</option>
                <option value="name">Nombre A–Z</option>
              </select>
            </label>
            <button
              onClick={() => setRetry((v) => v + 1)}
              aria-label="Actualizar expedientes"
              disabled={loading}
              className={`${control} flex items-center gap-2 disabled:opacity-50`}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50/40 p-4">
            <select
              aria-label="Tipo de expediente"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              className={control}
            >
              <option value="">Todos los tipos</option>
              {data?.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Estado del expediente"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className={control}
            >
              <option value="all">Todos los estados</option>
              {Object.entries(CASE_STATUS_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Desde
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                className={control}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Hasta
              <input
                type="date"
                min={from || undefined}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                className={control}
              />
            </label>
            <label className="flex h-10 items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={scheduled}
                onChange={(e) => {
                  setScheduled(e.target.checked);
                  setPage(1);
                }}
                className="accent-primary"
              />
              Envíos programados
            </label>
            {filtered && (
              <button
                className="inline-flex items-center gap-1 text-sm text-primary"
                onClick={reset}
              >
                <X size={14} />
                Limpiar filtros
              </button>
            )}
          </div>
        </section>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {loading ? (
            <p
              role="status"
              className="flex items-center justify-center gap-2 p-16 text-sm text-slate-500"
            >
              <Loader2 size={20} className="animate-spin text-primary" />
              Consultando expedientes…
            </p>
          ) : !data?.items.length ? (
            <div className="p-16 text-center">
              <FolderArchive size={32} className="mx-auto mb-4 text-primary" />
              <h2 className="text-sm font-semibold">
                {filtered
                  ? 'No hay expedientes con estos filtros'
                  : 'Aún no hay expedientes lanzados'}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {filtered
                  ? 'Prueba con otra búsqueda o limpia los filtros.'
                  : 'Selecciona un expediente publicado para enviar la primera invitación.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
                  <tr>
                    {[
                      'Expediente',
                      'Tipo de expediente',
                      'Participante',
                      'Estado',
                      'Avance',
                      'Invitaciones',
                      'Última actividad',
                      'Acciones',
                    ].map((c) => (
                      <th key={c} className="whitespace-nowrap px-4 py-4 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((row) => (
                    <tr key={row.id} className="hover:bg-blue-50/25">
                      <td className="min-w-52 px-4 py-4">
                        <Link
                          href={`/expedientes/${row.id}`}
                          className="font-semibold hover:text-primary"
                        >
                          {row.title}
                        </Link>
                        <p className="mt-1 text-xs text-slate-500">{row.folio}</p>
                      </td>
                      <td className="max-w-52 px-4 py-4">
                        <p>{row.templateName}</p>
                        <p className="mt-1 text-xs text-slate-400">{row.ownerName}</p>
                      </td>
                      <td className="px-4 py-4">
                        {row.participants.find((p) => p.role === 'subject')?.name ||
                          row.subject_name}
                        <p className="mt-1 text-xs text-slate-500">
                          {row.participants.length} participante
                          {row.participants.length === 1 ? '' : 's'}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <CaseStatusBadge status={row.status} />
                        {row.launch?.scheduled_at &&
                          row.isScheduled &&
                          row.status !== 'cancelled' && (
                            <p className="mt-2 text-xs text-primary">
                              Programado · {date(row.launch.scheduled_at, row.launch.timezone)}
                            </p>
                          )}
                      </td>
                      <td className="min-w-32 px-4 py-4">
                        <p className="text-xs tabular-nums">{row.progress}%</p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(0, Math.min(100, row.progress))}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-500">
                        {row.delivery.sent} de {row.delivery.total} enviadas
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                        {date(row.updated_at)}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            aria-label={`Vista previa de ${row.title}`}
                            title="Vista previa"
                            onClick={() => setSelected(row)}
                            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-primary"
                          >
                            <Eye size={17} />
                          </button>
                          <Link
                            href={`/expedientes/${row.id}`}
                            className="rounded-md border border-slate-200 px-3 py-2 text-xs text-primary"
                          >
                            Consultar
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {data && data.total > 0 && (
          <footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
            <span>
              Mostrando {(data.page - 1) * data.pageSize + 1}–
              {Math.min(data.page * data.pageSize, data.total)} de {data.total} expedientes
            </span>
            <div className="flex items-center gap-2">
              <button
                aria-label="Página anterior"
                disabled={page <= 1 || loading}
                onClick={() => setPage((v) => v - 1)}
                className={`${control} disabled:opacity-40`}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-2">{page}</span>
              <button
                aria-label="Página siguiente"
                disabled={page * data.pageSize >= data.total || loading}
                onClick={() => setPage((v) => v + 1)}
                className={`${control} disabled:opacity-40`}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </footer>
        )}
        {selected && (
          <LaunchDialog
            title={selected.title}
            description={selected.folio}
            onClose={() => setSelected(null)}
            footer={
              <>
                <button onClick={() => setSelected(null)} className={control}>
                  Cerrar
                </button>
                <Link
                  href={`/expedientes/${selected.id}`}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
                >
                  Consultar expediente
                </Link>
              </>
            }
          >
            <div className="space-y-5">
              <CaseStatusBadge status={selected.status} />
              <p className="text-sm text-slate-500">
                Avance: {selected.progress}% · Responsable: {selected.ownerName}
              </p>
              <section>
                <h3 className="mb-3 text-sm font-semibold">Participantes</h3>
                {selected.participants.map((p) => (
                  <div key={p.id} className="border-t border-slate-100 py-3 text-sm">
                    <p className="font-medium">{p.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {p.email} ·{' '}
                      {p.role === 'subject'
                        ? 'Titular'
                        : p.role === 'representative'
                          ? 'Representante'
                          : 'Seguimiento'}
                    </p>
                  </div>
                ))}
              </section>
              {selected.launch && (
                <section className="space-y-2 border-t border-slate-100 pt-4 text-sm">
                  <h3 className="font-semibold">Configuración del lanzamiento</h3>
                  <p>
                    Acceso:{' '}
                    {selected.launch.access_mode === 'public' ? 'Público con código' : 'Privado'}
                  </p>
                  <p>Firma: {caseSignatureLabels[selected.launch.signature_type]}</p>
                  <p>
                    Prueba de vida:{' '}
                    {selected.launch.require_liveness ? 'Solicitada' : 'No solicitada'}
                  </p>
                  <p>Vigencia: {selected.launch.expiration_hours} horas</p>
                  {selected.launch.scheduled_at && (
                    <p>
                      Envío previsto: {date(selected.launch.scheduled_at, selected.launch.timezone)}{' '}
                      ({selected.launch.timezone})
                    </p>
                  )}
                  {selected.canManage &&
                    selected.launch.access_mode === 'public' &&
                    selected.status !== 'cancelled' && (
                      <button
                        disabled={busy}
                        className={`${control} mt-2 text-primary`}
                        onClick={() => void publicAccess(selected)}
                      >
                        Consultar enlace y código
                      </button>
                    )}
                  {selected.canManage &&
                    selected.launch.scheduled_at &&
                    selected.isScheduled &&
                    selected.status !== 'cancelled' && (
                      <button
                        className={`${control} ml-2 mt-2 text-red-600`}
                        onClick={() => {
                          setCancel(selected);
                          setSelected(null);
                        }}
                      >
                        Cancelar envío programado
                      </button>
                    )}
                </section>
              )}
            </div>
          </LaunchDialog>
        )}
        {access && (
          <LaunchDialog
            title="Acceso público del expediente"
            description="El enlace y el código corresponden al titular de esta invitación."
            onClose={() => setAccess(null)}
          >
            <div className="space-y-4">
              <label className="block text-sm">
                Enlace
                <input readOnly value={access.url} className={`${control} mt-2 w-full`} />
              </label>
              <label className="block text-sm">
                Código
                <input
                  readOnly
                  value={access.code}
                  className={`${control} mt-2 w-full font-mono`}
                />
              </label>
              <button
                className={control}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(access.code)
                    .catch(() => setError('No se pudo copiar el código.'))
                }
              >
                Copiar código
              </button>
            </div>
          </LaunchDialog>
        )}
        {cancel && (
          <LaunchDialog
            title="Cancelar envío programado"
            description={`Se revocarán los enlaces de «${cancel.title}» y no se enviarán sus invitaciones.`}
            onClose={() => !busy && setCancel(null)}
            footer={
              <>
                <button disabled={busy} className={control} onClick={() => setCancel(null)}>
                  Volver
                </button>
                <button
                  disabled={busy}
                  onClick={() => void cancelSchedule()}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? 'Cancelando…' : 'Cancelar envío'}
                </button>
              </>
            }
          >
            <p className="text-sm text-slate-500">
              El registro se conservará para auditoría. Podrás hacer un nuevo lanzamiento desde el
              expediente publicado.
            </p>
          </LaunchDialog>
        )}
      </div>
    </AppLayout>
  );
}
