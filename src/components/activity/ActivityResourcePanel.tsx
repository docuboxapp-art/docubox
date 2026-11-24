'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Calendar,
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
  ArrowUpDown,
  Search,
  Send,
  User,
  Zap,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { ActivitySummary } from '@/components/documents/ActivitySummary';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import {
  ACTIVITY_STATE_LABELS,
  filterActivity,
  matchesActivityState,
  type ActivityAction,
  type ActivityItem,
  type ActivityKind,
  type ActivityMode,
  type ActivityState,
} from '@/lib/activity/model';
import ActivityTypeTabs from './ActivityTypeTabs';
import ActivityViewTabs from './ActivityViewTabs';
import { ActivityBoard, ActivityCalendar } from './ActivityAlternateViews';
import {
  ACTIVITY_TERMINAL_STATES,
  activityStateDateField,
  activityTimelineDate,
  initialActivityPeriod,
  moveActivityCalendar,
  type ActivityCalendarView,
} from '@/lib/activity/views';
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
const activityActionStyle =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';
const inlineActionStyle =
  'border border-slate-200 bg-white font-medium text-primary hover:bg-blue-50 dark:border-border dark:bg-card';
const boardActionStyle = 'w-full bg-primary font-semibold text-white hover:bg-primary/90';
const boardCardTones: Partial<Record<ActivityState, string>> = {
  completed: 'border-emerald-200/70 from-emerald-50/50 dark:from-emerald-950/30',
  expired: 'border-amber-200/70 from-amber-50/50 dark:from-amber-950/30',
  observed: 'border-red-200/70 from-red-50/50 dark:from-red-950/30',
  failed: 'border-red-200/70 from-red-50/50 dark:from-red-950/30',
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
  const [view, setView] = useState<'lista' | 'tablero' | 'calendario'>('lista');
  const [calendarView, setCalendarView] = useState<ActivityCalendarView>('mes');
  const [selectedCalendarDate, setCalendarDate] = useState<Date | null>(null);
  const [selectedBoardDate, setBoardDate] = useState<Date | null>(null);
  const [calendarState, setCalendarState] = useState('');
  const [page, setPage] = useState(1);
  const [criteria, setCriteria] = useState({
    search: '',
    state: '',
    from: '',
    to: '',
    sort: 'recent',
    period: 'all',
  });
  const items = data?.userId === user?.id ? data?.items || [] : [];
  const Icon = kind === 'formularios' ? ClipboardList : FolderKanban;
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
  const filtered = filterActivity(items, {
    ...criteria,
    dateField: criteria.period === 'all' ? 'sent' : activityStateDateField(criteria.state),
    from: criteria.period === 'custom' ? criteria.from : '',
    to: criteria.period === 'custom' ? criteria.to : '',
    period: criteria.period === 'custom' ? 'all' : criteria.period,
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const states = [
    ['', 'Todos'],
    ['in_progress', 'En progreso'],
    ...(kind === 'expedientes' ? [['urgent', 'Urgentes']] : []),
    ['due', 'Próximos a vencer'],
    ...(kind === 'formularios' ? [['pending', 'Pendientes']] : []),
    ['completed', 'Completados'],
    ['expired', 'Vencidos'],
    ['cancelled', 'Cancelados'],
    ...(['signature', 'observed', 'scheduled', 'paused', 'failed'] as const)
      .filter((state) => items.some((item) => item.state === state))
      .map((state) => [state, ACTIVITY_STATE_LABELS[state]]),
  ];
  const boardDate =
    selectedBoardDate ?? initialActivityPeriod(view === 'tablero' ? items : [], 'mes');
  const boardItems =
    view === 'tablero'
      ? items.filter((item) => {
          const day = activityTimelineDate(item);
          return (
            day?.getMonth() === boardDate.getMonth() &&
            day.getFullYear() === boardDate.getFullYear()
          );
        })
      : [];
  const calendarField = calendarState === 'due' ? 'expires' : undefined;
  const calendarItems =
    view === 'calendario' ? items.filter((item) => matchesActivityState(item, calendarState)) : [];
  const calendarDate =
    selectedCalendarDate ?? initialActivityPeriod(calendarItems, calendarView, calendarField);
  const activeFilters = !!(criteria.search || criteria.state || criteria.period !== 'all');
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
  const actions = (item: ActivityItem, board = false) => (
    <div className="flex flex-wrap items-center gap-2">
      {item.actions.map((action, index) => {
        const style =
          board && index === 0 && !action.disabledReason ? boardActionStyle : inlineActionStyle;
        return action.href ? (
          <Link
            key={action.label}
            href={action.href}
            prefetch={false}
            className={`${activityActionStyle} ${style}`}
          >
            {action.label}
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        ) : (
          <button
            key={action.label}
            type="button"
            disabled={busy !== null || !!action.disabledReason}
            title={action.disabledReason}
            onClick={() => void open(item, action)}
            className={`${activityActionStyle} ${style} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {busy === item.id ? <Loader2 size={14} className="animate-spin" /> : null}
            {action.label}
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        );
      })}
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
  const card = (item: ActivityItem, compact = false) => (
    <article
      key={item.id}
      className={`min-w-0 rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card ${compact ? 'p-2' : 'p-4'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!compact && <Icon size={18} className="shrink-0 text-primary" />}
        {stateBadge(item)}
      </div>
      <h3
        className={`mt-2 break-words font-medium text-slate-900 dark:text-foreground ${compact ? 'text-xs' : 'text-sm'}`}
      >
        {item.title}
      </h3>
      {item.priority === 'urgent' && (
        <span className="mt-1 inline-flex items-center gap-1 text-xs text-orange-600">
          <Zap size={12} />
          Urgente
        </span>
      )}
      <p className="mt-2 break-words text-xs text-slate-500">{item.person}</p>
      {!compact && (
        <>
          <p className="mt-1 break-words text-xs text-slate-400">{item.role}</p>
          <p className="mt-1 break-all text-xs text-slate-400">
            {item.reference || item.workspace}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            {mode === 'sent' ? 'Envío' : 'Recibido'}: {date(item.sentAt)}
          </p>
          {item.scheduledAt && (
            <p className="mt-1 text-xs text-indigo-600">Programado: {date(item.scheduledAt)}</p>
          )}
          {item.expiresAt && (
            <p className="mt-1 text-xs text-slate-500">Vence: {date(item.expiresAt)}</p>
          )}
          <div className="my-3">{progress(item)}</div>
        </>
      )}
      <div className="mt-3">{actions(item)}</div>
    </article>
  );
  const boardCard = (item: ActivityItem) => {
    const expiresSoon = matchesActivityState(item, 'due');
    const timing =
      item.state === 'scheduled' && item.scheduledAt
        ? `Programado: ${date(item.scheduledAt)}`
        : item.state === 'completed'
          ? `Última actividad: ${date(item.updatedAt)}`
          : item.expiresAt
            ? `${item.state === 'expired' ? 'Venció' : 'Vence'}: ${date(item.expiresAt)}`
            : 'Sin vencimiento';
    return (
      <article
        key={item.id}
        className={`flex min-w-0 flex-col gap-3 rounded-lg border bg-gradient-to-br via-white to-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300 dark:border-border dark:via-card dark:to-card ${boardCardTones[item.state] ?? 'border-slate-200/90 from-primary/5'}`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tones[item.state]}`}
          >
            <Icon size={18} aria-hidden="true" />
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${expiresSoon ? 'bg-amber-100 text-amber-800' : tones[item.state]}`}
          >
            {expiresSoon && <Clock size={12} aria-hidden="true" />}
            {expiresSoon ? 'Próximo a vencer' : item.stateLabel}
          </span>
          {item.priority === 'urgent' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[11px] text-red-600">
              <AlertTriangle size={11} aria-hidden="true" /> Urgente
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h3
            className="line-clamp-2 break-words text-sm font-semibold leading-snug text-foreground"
            title={item.title}
          >
            {item.title}
          </h3>
          <p className="mt-1 break-words text-[11px] text-muted-foreground">
            {[
              item.reference || item.workspace,
              `${mode === 'sent' ? 'Envío' : 'Recibido'}: ${date(item.sentAt)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="space-y-2 border-t border-slate-200/70 pt-3 dark:border-border">
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <User size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">
              {item.person}
              {item.role && <span className="block">{item.role}</span>}
            </span>
          </p>
          {progress(item)}
        </div>
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Calendar size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{timing}</span>
        </p>
        {actions(item, true)}
      </article>
    );
  };
  return (
    <AppLayout noPadding>
      <div className="app-page-bleed app-page-frame bg-[#f6f8fb] dark:bg-background">
        <div className="app-page-width">
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
          <ActivitySummary
            id={`${mode}-${kind}-summary`}
            title={mode === 'sent' ? 'Resumen de solicitudes' : 'Resumen de participaciones'}
            description={
              mode === 'received'
                ? kind === 'formularios'
                  ? 'Respuestas y firmas de formularios independientes. Los vinculados a un expediente se atienden desde su expediente.'
                  : 'Invitaciones recibidas y responsabilidades de administración, revisión, aprobación o cierre que tienes asignadas.'
                : kind === 'formularios'
                  ? 'Consulta las respuestas y firmas de los formularios que enviaste. Los formularios vinculados se consultan desde su expediente.'
                  : 'Consulta el avance de los expedientes que lanzaste y el estado de las invitaciones a sus participantes.'
            }
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
            className="mb-4 overflow-visible rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card"
          >
            <div className="flex flex-col items-start justify-between gap-3 p-3 sm:flex-row sm:items-center">
              <ActivityViewTabs value={view} onChange={setView} />
              {view === 'lista' && (
                <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
                  <div className="relative min-w-32 flex-1 lg:w-72">
                    <Search
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      aria-label={`Buscar ${kind}`}
                      placeholder="Buscar..."
                      value={criteria.search}
                      onChange={(event) => change('search', event.target.value)}
                      className={`${control} w-full bg-slate-50/70 pl-9`}
                    />
                  </div>
                  <div className="relative">
                    <ArrowUpDown
                      size={15}
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                      aria-hidden="true"
                    />
                    <select
                      aria-label="Ordenar por fecha"
                      value={criteria.sort}
                      onChange={(event) => change('sort', event.target.value)}
                      className={`${control} pl-8`}
                    >
                      <option value="recent">Más recientes</option>
                      <option value="oldest">Más antiguos</option>
                    </select>
                  </div>
                  <div className="flex h-9 items-center rounded-md border border-slate-200 p-0.5 dark:border-border">
                    <button
                      type="button"
                      aria-label="Vista lista"
                      aria-pressed={!grid}
                      onClick={() => setGrid(false)}
                      className={`flex h-7 w-8 items-center justify-center rounded ${!grid ? 'bg-muted text-foreground' : 'text-slate-400 hover:bg-muted/50'}`}
                    >
                      <LayoutList size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Vista cuadrícula"
                      aria-pressed={grid}
                      onClick={() => setGrid(true)}
                      className={`flex h-7 w-8 items-center justify-center rounded ${grid ? 'bg-primary text-white' : 'text-slate-400 hover:bg-muted/50'}`}
                    >
                      <LayoutGrid size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
              {view === 'tablero' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">Periodo</span>
                  <div className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-card px-2 dark:border-border">
                    <button
                      type="button"
                      aria-label="Mes anterior"
                      onClick={() =>
                        setBoardDate((current) =>
                          moveActivityCalendar(current ?? boardDate, 'mes', -1)
                        )
                      }
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span
                      className="min-w-[110px] text-center text-xs font-medium"
                      aria-live="polite"
                    >
                      {boardDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
                    </span>
                    <button
                      type="button"
                      aria-label="Mes siguiente"
                      onClick={() =>
                        setBoardDate((current) =>
                          moveActivityCalendar(current ?? boardDate, 'mes', 1)
                        )
                      }
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
              {view === 'calendario' && (
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Periodo
                  <select
                    aria-label="Periodo del calendario"
                    value={calendarView}
                    onChange={(event) =>
                      setCalendarView(event.target.value as ActivityCalendarView)
                    }
                    className={control}
                  >
                    <option value="mes">Mes</option>
                    <option value="semana">Semana</option>
                    <option value="dia">Día</option>
                  </select>
                </label>
              )}
            </div>
            {view !== 'tablero' && (
              <div className="activity-filters flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5 dark:border-border dark:bg-muted/20">
                <div
                  role="group"
                  aria-label="Estados de la bandeja"
                  className="flex flex-wrap items-center gap-1.5"
                >
                  {states.map(([value, label]) => {
                    const selected = (view === 'lista' ? criteria.state : calendarState) === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          if (view === 'calendario') {
                            if (value !== calendarState) setCalendarDate(null);
                            setCalendarState(value);
                            return;
                          }
                          setCriteria((current) => ({
                            ...current,
                            state: value,
                            period: 'all',
                            from: '',
                            to: '',
                          }));
                          setPage(1);
                        }}
                        className={`flex min-h-8 items-center rounded-md border px-2.5 text-xs font-normal transition-colors ${selected ? 'border-primary/25 bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-border dark:bg-card dark:text-muted-foreground'}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {view === 'lista' && ACTIVITY_TERMINAL_STATES.includes(criteria.state) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Periodo
                      <select
                        aria-label="Periodo del estado"
                        value={criteria.period}
                        onChange={(event) => change('period', event.target.value)}
                        className={`${control} h-8 text-xs`}
                      >
                        <option value="all">Cualquier fecha</option>
                        <option value="365">Último año</option>
                        <option value="30">Últimos 30 días</option>
                        <option value="7">Últimos 7 días</option>
                        <option value="today">Hoy</option>
                        <option value="custom">Rango personalizado</option>
                      </select>
                    </label>
                    {criteria.period === 'custom' && (
                      <>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          Desde
                          <input
                            type="date"
                            value={criteria.from}
                            max={criteria.to || undefined}
                            onChange={(event) => change('from', event.target.value)}
                            className={`${control} h-8 text-xs`}
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          Hasta
                          <input
                            type="date"
                            value={criteria.to}
                            min={criteria.from || undefined}
                            onChange={(event) => change('to', event.target.value)}
                            className={`${control} h-8 text-xs`}
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
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
            className={
              view === 'tablero' && !loading && !error && boardItems.length
                ? 'min-w-0'
                : 'min-h-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card'
            }
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
            ) : view === 'tablero' && boardItems.length ? (
              <ActivityBoard items={boardItems} kind={kind} mode={mode} renderItem={boardCard} />
            ) : view === 'calendario' ? (
              <ActivityCalendar
                items={calendarItems}
                field={calendarField}
                anchor={calendarDate}
                view={calendarView}
                onDateChange={setCalendarDate}
                onViewChange={setCalendarView}
                renderItem={card}
              />
            ) : view === 'tablero' || !visible.length ? (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
                <Icon size={30} className="mb-3 text-slate-300" />
                <h2 className="text-sm font-medium text-slate-900 dark:text-foreground">
                  {view === 'tablero'
                    ? `No hay ${kind} en este periodo`
                    : activeFilters
                      ? 'No hay resultados con estos filtros'
                      : `Aún no tienes ${kind} ${mode === 'sent' ? 'enviados' : 'en esta bandeja'}`}
                </h2>
                <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
                  {view === 'tablero'
                    ? 'Selecciona otro mes para consultar su actividad.'
                    : activeFilters
                      ? 'Ajusta los criterios para consultar otros registros.'
                      : mode === 'sent'
                        ? `Los lanzamientos de ${kind} aparecerán aquí para darles seguimiento.`
                        : `Aquí aparecerán las invitaciones y participaciones de ${kind} asociadas a tu cuenta.`}
                </p>
              </div>
            ) : grid ? (
              <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
                {visible.map((item) => card(item))}
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
          {!loading && !error && view !== 'calendario' && (
            <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <span>
                {view !== 'lista'
                  ? `${boardItems.length} ${kind} en este periodo`
                  : filtered.length
                    ? `Mostrando ${(currentPage - 1) * 20 + 1}–${Math.min(currentPage * 20, filtered.length)} de ${filtered.length} ${kind}`
                    : `0 ${kind}`}
              </span>
              {view === 'lista' && (
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
              )}
            </footer>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
