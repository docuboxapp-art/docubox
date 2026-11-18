'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  FolderKanban,
  Inbox,
  LayoutGrid,
  LayoutList,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Zap,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { ActivitySummary } from '@/components/documents/ActivitySummary';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import {
  ACTIVITY_STATE_LABELS,
  filterActivity,
  type ActivityAction,
  type ActivityItem,
  type ActivityKind,
  type ActivityMode,
  type ActivityState,
} from '@/lib/activity/model';
import ActivityTypeTabs from './ActivityTypeTabs';
import { activityErrorMessage } from '@/lib/activity/request-error';

const control =
  'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-card dark:text-foreground';
const date = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
const tones: Record<ActivityState, string> = {
  pending: 'bg-amber-50 text-amber-700',
  in_progress: 'bg-blue-50 text-blue-700',
  completed: 'bg-emerald-50 text-emerald-700',
  expired: 'bg-orange-50 text-orange-700',
  cancelled: 'bg-slate-100 text-slate-600',
  scheduled: 'bg-indigo-50 text-indigo-700',
  observed: 'bg-red-50 text-red-700',
  signature: 'bg-amber-50 text-amber-700',
  paused: 'bg-slate-100 text-slate-600',
  failed: 'bg-red-50 text-red-700',
};
async function activityRequest<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  if (!session) throw new Error('Inicia sesión para consultar tu bandeja.');
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    signal,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(activityErrorMessage(payload));
  return payload.data as T;
}

export default function ActivityResourcePanel({
  mode,
  kind,
}: {
  mode: ActivityMode;
  kind: ActivityKind;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<{
    key: string;
    userId: string;
    items: ActivityItem[];
    error: string;
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const requestKey = `${user?.id}:${mode}:${kind}:${refresh}`;
  const loading = !user?.id || data?.key !== requestKey;
  const error = data?.key === requestKey ? data.error : '';
  const [grid, setGrid] = useState(false);
  const [page, setPage] = useState(1);
  const [criteria, setCriteria] = useState({
    search: '',
    state: '',
    access: '',
    workspace: '',
    from: '',
    to: '',
    sort: 'recent',
  });
  const items = data?.userId === user?.id ? data?.items || [] : [];
  const Icon = kind === 'formularios' ? ClipboardList : FolderKanban;
  const singular = kind === 'formularios' ? 'formulario' : 'expediente';
  const title = mode === 'sent' ? 'Solicitudes enviadas' : 'Mis participaciones';
  useEffect(() => {
    if (!user?.id) return;
    const abort = new AbortController();
    let live = true;
    activityRequest<{ items: ActivityItem[] }>(
      `/api/activity?mode=${mode}&kind=${kind}`,
      undefined,
      abort.signal
    )
      .then((result) => {
        if (live) setData({ key: requestKey, userId: user.id, items: result.items, error: '' });
      })
      .catch((cause) => {
        if (live)
          setData({
            key: requestKey,
            userId: user.id,
            items: [],
            error: cause instanceof Error ? cause.message : 'No se pudo cargar la bandeja.',
          });
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, [user?.id, mode, kind, requestKey]);
  function change(key: keyof typeof criteria, value: string) {
    setCriteria((current) => ({ ...current, [key]: value }));
    setPage(1);
  }
  const filtered = filterActivity(items, criteria);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const states = Object.entries(ACTIVITY_STATE_LABELS).filter(([state]) =>
    items.some((item) => item.state === state)
  );
  const workspaces = [
    ...new Map(items.map((item) => [item.workspaceId, item.workspace])).entries(),
  ];
  const activeFilters = Object.entries(criteria).some(([key, value]) => key !== 'sort' && !!value);
  async function open(item: ActivityItem, action: ActivityAction) {
    if (!action.open || action.disabledReason) return;
    setBusy(item.id);
    setActionError('');
    try {
      const result = await activityRequest<{ url: string }>('/api/activity/open', action.open);
      if (
        !/^\/(form\/|formulario-publico\/|expediente\/|firmar-documento\/|visor-documento\/)/.test(
          result.url
        )
      )
        throw new Error('No se pudo abrir la participación.');
      router.push(result.url);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo abrir la participación.');
    } finally {
      setBusy(null);
    }
  }
  const actions = (item: ActivityItem) => (
    <div className="flex flex-wrap items-center gap-2">
      {item.actions.map((action) =>
        action.href ? (
          <Link
            key={action.label}
            href={action.href}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-blue-50 dark:border-border dark:bg-card"
          >
            {action.label}
            <ChevronRight size={14} />
          </Link>
        ) : (
          <button
            key={action.label}
            type="button"
            disabled={busy !== null || !!action.disabledReason}
            title={action.disabledReason}
            onClick={() => void open(item, action)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-70 dark:border-border dark:bg-card"
          >
            {busy === item.id ? <Loader2 size={14} className="animate-spin" /> : null}
            {action.label}
            <ChevronRight size={14} />
          </button>
        )
      )}
    </div>
  );
  const stateBadge = (item: ActivityItem) => (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones[item.state]}`}
    >
      {item.stateLabel}
    </span>
  );
  const progress = (item: ActivityItem) =>
    item.progress !== null ? (
      <div className="min-w-24">
        <span className="text-xs text-slate-600">{item.progress}%</span>
        <div
          role="progressbar"
          aria-label={`Avance de ${item.title}`}
          aria-valuenow={item.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-1.5 h-1.5 rounded-full bg-slate-100"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
          />
        </div>
      </div>
    ) : (
      <span className="text-xs text-slate-500">{item.detail}</span>
    );
  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100dvh-4rem)] bg-[#f6f8fb] px-4 py-4 sm:px-5 md:-my-6 md:py-5 lg:px-6 dark:bg-background">
        <div className="mx-auto w-full max-w-[1600px]">
          <header className="mb-4 border-b border-slate-200/80 pb-4">
            <h1 className="text-2xl font-600 leading-tight text-slate-950 dark:text-foreground">
              {title}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {mode === 'sent'
                ? 'Monitorea los documentos, formularios y expedientes que has enviado.'
                : 'Consulta y atiende tus documentos, formularios y expedientes.'}
            </p>
          </header>
          <ActivityTypeTabs mode={mode} active={kind} />
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            <span
              className={`rounded-lg p-2 ${kind === 'formularios' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-primary'}`}
            >
              <Icon size={19} />
            </span>
            <div>
              <h2 className="text-sm font-medium text-slate-900 dark:text-foreground">
                {kind === 'formularios' ? 'Formularios' : 'Expedientes'}{' '}
                {mode === 'sent' ? 'enviados' : 'en los que participas'}
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {kind === 'formularios'
                  ? 'Respuestas y firmas de formularios independientes. Los vinculados a un expediente se atienden desde su expediente.'
                  : mode === 'received'
                    ? 'Invitaciones recibidas y responsabilidades de administración, revisión, aprobación o cierre que tienes asignadas.'
                    : 'Seguimiento de los expedientes que lanzaste y de sus invitaciones a participantes.'}
              </p>
            </div>
          </div>
          <ActivitySummary
            id={`${mode}-${kind}-summary`}
            title={mode === 'sent' ? 'Resumen de solicitudes' : 'Resumen de participaciones'}
            description={`Estado de tus ${kind}.`}
            metrics={[
              {
                label: mode === 'sent' ? 'Solicitudes enviadas' : 'Participaciones',
                value: items.length,
                icon: mode === 'sent' ? Send : Inbox,
                tone: 'blue',
              },
              {
                label: 'Pendientes y en progreso',
                value: items.filter((item) =>
                  ['pending', 'in_progress', 'signature', 'observed'].includes(item.state)
                ).length,
                icon: Clock,
                tone: 'amber',
              },
              {
                label: kind === 'formularios' ? 'Respuestas completadas' : 'Expedientes cerrados',
                value: items.filter((item) => item.state === 'completed').length,
                icon: CheckCircle2,
                tone: 'emerald',
              },
              {
                label: 'Vencidos',
                value: items.filter((item) => item.state === 'expired').length,
                icon: Clock,
                tone: 'indigo',
              },
            ]}
          />
          <section
            aria-label={`Filtros de ${kind}`}
            className="mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-border dark:bg-card"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-40 flex-1">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
                />
                <input
                  aria-label={`Buscar ${kind}`}
                  placeholder={`Buscar por ${singular}, nombre, correo o folio…`}
                  value={criteria.search}
                  onChange={(event) => change('search', event.target.value)}
                  className={`${control} w-full pl-9`}
                />
              </div>
              <select
                aria-label="Ordenar"
                value={criteria.sort}
                onChange={(event) => change('sort', event.target.value)}
                className={control}
              >
                <option value="recent">Más recientes</option>
                <option value="oldest">Más antiguos</option>
                <option value="name">Nombre A–Z</option>
                {kind === 'expedientes' && <option value="urgent">Urgentes primero</option>}
              </select>
              <div className="flex rounded-md border border-slate-200 p-0.5">
                <button
                  type="button"
                  aria-label="Vista lista"
                  aria-pressed={!grid}
                  onClick={() => setGrid(false)}
                  className={`rounded p-2 ${!grid ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}
                >
                  <LayoutList size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Vista cuadrícula"
                  aria-pressed={grid}
                  onClick={() => setGrid(true)}
                  className={`rounded p-2 ${grid ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}
                >
                  <LayoutGrid size={16} />
                </button>
              </div>
              <button
                type="button"
                aria-label="Actualizar bandeja"
                disabled={loading}
                onClick={() => setRefresh((value) => value + 1)}
                className={`${control} px-2.5`}
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Estado
                <select
                  value={criteria.state}
                  onChange={(event) => change('state', event.target.value)}
                  className={control}
                >
                  <option value="">Todos los estados</option>
                  {states.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Acceso
                <select
                  value={criteria.access}
                  onChange={(event) => change('access', event.target.value)}
                  className={control}
                >
                  <option value="">Todas las modalidades</option>
                  <option value="private">Privado</option>
                  <option value="public">Con código</option>
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-500">
                Espacio de trabajo
                <select
                  value={criteria.workspace}
                  onChange={(event) => change('workspace', event.target.value)}
                  className={`${control} max-w-60`}
                >
                  <option value="">Todos mis espacios</option>
                  {workspaces.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                {mode === 'sent' ? 'Envío desde' : 'Recibido desde'}
                <input
                  type="date"
                  value={criteria.from}
                  max={criteria.to || undefined}
                  onChange={(event) => change('from', event.target.value)}
                  className={control}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Hasta
                <input
                  type="date"
                  value={criteria.to}
                  min={criteria.from || undefined}
                  onChange={(event) => change('to', event.target.value)}
                  className={control}
                />
              </label>
              {activeFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setCriteria({
                      search: '',
                      state: '',
                      access: '',
                      workspace: '',
                      from: '',
                      to: '',
                      sort: 'recent',
                    });
                    setPage(1);
                  }}
                  className="min-h-9 px-2 text-xs text-primary hover:underline"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </section>
          {actionError && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {actionError}
            </p>
          )}
          <section
            aria-label={`Listado de ${kind}`}
            className="min-h-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card"
          >
            {loading ? (
              <p
                role="status"
                className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500"
              >
                <Loader2 size={19} className="animate-spin" />
                Cargando {kind}…
              </p>
            ) : error ? (
              <div role="alert" className="p-8 text-center">
                <p className="text-sm text-red-600">{error}</p>
                <button
                  type="button"
                  onClick={() => setRefresh((value) => value + 1)}
                  className="mt-3 text-sm text-primary hover:underline"
                >
                  Reintentar
                </button>
              </div>
            ) : !visible.length ? (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
                <Icon size={30} className="mb-3 text-slate-300" />
                <h2 className="text-sm font-medium text-slate-900 dark:text-foreground">
                  {activeFilters
                    ? 'No hay resultados con estos filtros'
                    : `Aún no tienes ${kind} ${mode === 'sent' ? 'enviados' : 'en esta bandeja'}`}
                </h2>
                <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
                  {activeFilters
                    ? 'Ajusta los criterios para consultar otros registros.'
                    : mode === 'sent'
                      ? `Los lanzamientos de ${kind} aparecerán aquí para darles seguimiento.`
                      : `Aquí aparecerán las invitaciones y participaciones de ${kind} asociadas a tu cuenta.`}
                </p>
              </div>
            ) : grid ? (
              <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
                {visible.map((item) => (
                  <article
                    key={item.id}
                    className="min-w-0 rounded-lg border border-slate-200 p-4 dark:border-border"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Icon size={20} className="shrink-0 text-primary" />
                      {stateBadge(item)}
                    </div>
                    <h3 className="mt-3 break-words text-sm font-medium">{item.title}</h3>
                    {item.reference && (
                      <p className="mt-1 break-all text-xs text-slate-400">{item.reference}</p>
                    )}
                    <p className="mt-3 break-words text-xs text-slate-600">{item.person}</p>
                    <p className="mt-1 break-words text-xs text-slate-400">{item.role}</p>
                    <p className="mt-3 text-xs text-slate-500">{date(item.sentAt)}</p>
                    {item.state === 'scheduled' && item.scheduledAt && (
                      <p className="mt-1 text-xs text-indigo-600">
                        Programado: {date(item.scheduledAt)}
                      </p>
                    )}
                    <div className="my-3">{progress(item)}</div>
                    {actions(item)}
                  </article>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="responsive-data-table w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
                    <tr>
                      {[
                        kind === 'formularios' ? 'Formulario' : 'Expediente',
                        mode === 'sent' ? 'Destinatario' : 'Emisor',
                        mode === 'sent'
                          ? kind === 'formularios'
                            ? 'Participación'
                            : 'Participantes'
                          : 'Mi participación',
                        'Estado',
                        'Acceso',
                        mode === 'sent' ? 'Envío' : 'Recibido',
                        kind === 'expedientes' ? 'Avance' : 'Respuesta',
                        'Acciones',
                      ].map((label) => (
                        <th key={label} className="whitespace-nowrap px-4 py-4 font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((item) => (
                      <tr key={item.id} className="hover:bg-blue-50/25">
                        <td className="min-w-48 px-4 py-4">
                          <span className="inline-flex items-start gap-2">
                            <Icon size={16} className="mt-0.5 shrink-0 text-primary" />
                            <span className="font-medium">{item.title}</span>
                          </span>
                          {item.priority === 'urgent' && (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs text-orange-600">
                              <Zap size={12} />
                              Urgente
                            </span>
                          )}
                          <p className="mt-1 text-xs text-slate-400">
                            {item.reference || item.workspace}
                          </p>
                        </td>
                        <td
                          data-label={mode === 'sent' ? 'Destinatario' : 'Emisor'}
                          className="px-4 py-4 text-xs text-slate-600"
                        >
                          {item.person}
                          {item.email && (
                            <p className="mt-1 break-all text-xs text-slate-400">{item.email}</p>
                          )}
                        </td>
                        <td
                          data-label={
                            mode === 'sent'
                              ? kind === 'formularios'
                                ? 'Participación'
                                : 'Participantes'
                              : 'Mi participación'
                          }
                          className="px-4 py-4 text-xs text-slate-500"
                        >
                          {item.role}
                        </td>
                        <td data-label="Estado" className="px-4 py-4">
                          {stateBadge(item)}
                        </td>
                        <td data-label="Acceso" className="px-4 py-4 text-xs text-slate-500">
                          {item.access === 'public' ? 'Con código' : 'Privado'}
                        </td>
                        <td
                          data-label={mode === 'sent' ? 'Envío' : 'Recibido'}
                          className="px-4 py-4 text-xs text-slate-500"
                        >
                          {date(item.sentAt)}
                          {item.state === 'scheduled' && item.scheduledAt && (
                            <p className="mt-1 text-indigo-600">
                              Programado: {date(item.scheduledAt)}
                            </p>
                          )}
                          {item.expiresAt && (
                            <p className="mt-1 text-slate-400">Vence: {date(item.expiresAt)}</p>
                          )}
                        </td>
                        <td
                          data-label={kind === 'expedientes' ? 'Avance' : 'Respuesta'}
                          className="px-4 py-4"
                        >
                          {progress(item)}
                        </td>
                        <td data-label="Acciones" className="px-4 py-4">
                          {actions(item)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {!loading && !error && (
            <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <span>
                {filtered.length
                  ? `Mostrando ${(currentPage - 1) * 20 + 1}–${Math.min(currentPage * 20, filtered.length)} de ${filtered.length} ${kind}`
                  : `0 ${kind}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Página anterior"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                  className={`${control} px-2 disabled:opacity-40`}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {currentPage} de {totalPages}
                </span>
                <button
                  type="button"
                  aria-label="Página siguiente"
                  disabled={currentPage === totalPages}
                  onClick={() => setPage(currentPage + 1)}
                  className={`${control} px-2 disabled:opacity-40`}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </footer>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
