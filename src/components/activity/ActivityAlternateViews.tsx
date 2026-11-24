'use client';

import { useMemo, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import {
  ACTIVITY_STATE_LABELS,
  type ActivityDateField,
  type ActivityItem,
  type ActivityKind,
  type ActivityMode,
  type ActivityState,
} from '@/lib/activity/model';
import {
  activityCalendarDays,
  activityDayKey,
  groupActivityDays,
  moveActivityCalendar,
  type ActivityCalendarView,
} from '@/lib/activity/views';

type RenderItem = (item: ActivityItem, compact?: boolean) => ReactNode;
const button =
  'inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50 dark:border-border dark:bg-card dark:text-foreground';

const activityColumns: Record<ActivityState, string> = {
  in_progress: 'border-t-blue-400 bg-blue-50/40 dark:bg-blue-950/25',
  pending: 'border-t-purple-400 bg-purple-50/40 dark:bg-purple-950/25',
  signature: 'border-t-amber-400 bg-amber-50/40 dark:bg-amber-950/25',
  completed: 'border-t-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/25',
  expired: 'border-t-orange-300 bg-orange-50/40 dark:bg-orange-950/25',
  observed: 'border-t-red-400 bg-red-50/40 dark:bg-red-950/25',
  cancelled: 'border-t-gray-400 bg-gray-50/40 dark:bg-muted/30',
  scheduled: 'border-t-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/25',
  paused: 'border-t-slate-400 bg-slate-50/40 dark:bg-muted/30',
  failed: 'border-t-red-400 bg-red-50/40 dark:bg-red-950/25',
};

export function ActivityBoard({
  items,
  kind,
  mode,
  renderItem,
}: {
  items: ActivityItem[];
  kind: ActivityKind;
  mode: ActivityMode;
  renderItem: (item: ActivityItem) => ReactNode;
}) {
  const columns = useMemo(() => {
    const grouped = new Map<ActivityState, ActivityItem[]>();
    for (const item of items) {
      const column = grouped.get(item.state) || [];
      column.push(item);
      grouped.set(item.state, column);
    }
    const defaultStates: ActivityState[] = ['in_progress', 'completed', 'expired', 'cancelled'];
    defaultStates.push(kind === 'formularios' ? 'pending' : 'observed');
    return (Object.keys(activityColumns) as ActivityState[])
      .filter((state) => grouped.has(state) || defaultStates.includes(state))
      .map((state) => ({
        state,
        label: ACTIVITY_STATE_LABELS[state],
        items: grouped.get(state) ?? [],
      }));
  }, [items, kind]);
  return (
    <div
      aria-label="Tablero por estado"
      className="flex min-h-[520px] max-w-full gap-3 overflow-x-auto pb-4"
    >
      {columns.map((column) => (
        <section
          key={column.state}
          aria-label={`${column.label}: ${column.items.length}`}
          className={`flex min-h-[480px] min-w-[220px] flex-1 flex-col rounded-lg border border-slate-200/90 border-t-2 dark:border-x-border dark:border-b-border ${activityColumns[column.state]}`}
        >
          <header className="flex items-center justify-between gap-2 rounded-t-md border-b border-slate-200/70 bg-white/70 px-3 py-2.5 dark:border-border dark:bg-card/80">
            <h2 className="text-xs font-semibold text-slate-700 dark:text-foreground">
              {column.label}
            </h2>
            <span className="flex h-5 min-w-5 items-center justify-center rounded bg-white px-1.5 text-xs font-semibold text-slate-500 dark:bg-muted dark:text-muted-foreground">
              {column.items.length}
            </span>
          </header>
          {column.items.length ? (
            <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
              {column.items.map(renderItem)}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
              <Inbox size={32} strokeWidth={1.5} className="opacity-30" aria-hidden="true" />
              {mode === 'sent' ? 'Sin solicitudes' : 'Sin participaciones'}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export function ActivityCalendar({
  items,
  field,
  anchor,
  view,
  onDateChange,
  onViewChange,
  renderItem,
}: {
  items: ActivityItem[];
  field?: ActivityDateField;
  anchor: Date;
  view: ActivityCalendarView;
  onDateChange: (date: Date) => void;
  onViewChange: (view: ActivityCalendarView) => void;
  renderItem: RenderItem;
}) {
  const grouped = useMemo(() => groupActivityDays(items, field), [items, field]);
  const days = activityCalendarDays(anchor, view);
  const today = activityDayKey(new Date());
  const total = days.reduce(
    (sum, day) => sum + (grouped.days.get(activityDayKey(day))?.length || 0),
    0
  );
  const label =
    view === 'mes'
      ? anchor.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
      : view === 'dia'
        ? anchor.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
        : `${days[0].toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  function openDay(day: Date) {
    onDateChange(day);
    onViewChange('dia');
  }
  return (
    <div aria-label="Calendario de actividad">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-border">
        <div>
          <h2 className="text-sm font-medium capitalize text-slate-800 dark:text-foreground">
            {label}
          </h2>
          <p className="mt-1 text-xs text-slate-500">{total} registros en las fechas visibles</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => onDateChange(new Date())} className={button}>
            Hoy
          </button>
          <button
            type="button"
            aria-label="Periodo anterior"
            onClick={() => onDateChange(moveActivityCalendar(anchor, view, -1))}
            className={button}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label="Periodo siguiente"
            onClick={() => onDateChange(moveActivityCalendar(anchor, view, 1))}
            className={button}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>
      {grouped.undated.length > 0 && (
        <p className="border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-xs text-slate-500 dark:border-border dark:bg-muted/30">
          {grouped.undated.length} registros sin fecha para este filtro.
        </p>
      )}
      {view === 'dia' ? (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {(grouped.days.get(activityDayKey(anchor)) || []).map((item) => renderItem(item))}
          {!total && (
            <p className="py-8 text-sm text-slate-500">
              No hay registros para este día con los filtros actuales.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[840px] grid-cols-7">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => (
              <div
                key={day}
                className="border-b border-slate-200 bg-slate-50/70 py-2 text-center text-xs text-slate-500 dark:border-border dark:bg-muted/30"
              >
                {day}
              </div>
            ))}
            {days.map((day) => {
              const key = activityDayKey(day);
              const entries = grouped.days.get(key) || [];
              return (
                <section
                  key={key}
                  aria-label={day.toLocaleDateString('es-MX', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  className={`min-h-36 min-w-0 border-b border-r border-slate-100 p-2 dark:border-border ${view === 'mes' && day.getMonth() !== anchor.getMonth() ? 'bg-slate-50/70 dark:bg-muted/20' : ''}`}
                >
                  <button
                    type="button"
                    aria-label={`Ver día ${day.toLocaleDateString('es-MX')}`}
                    onClick={() => openDay(day)}
                    className={`mb-2 flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs ${key === today ? 'bg-primary text-white' : 'text-slate-600 hover:bg-blue-50 dark:text-slate-300'}`}
                  >
                    {day.getDate()}
                  </button>
                  <div className="space-y-2">
                    {entries.slice(0, view === 'mes' ? 2 : 4).map((item) => renderItem(item, true))}
                  </div>
                  {entries.length > (view === 'mes' ? 2 : 4) && (
                    <button
                      type="button"
                      onClick={() => openDay(day)}
                      className="mt-2 text-xs text-primary hover:underline"
                    >
                      Ver {entries.length - (view === 'mes' ? 2 : 4)} más
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
