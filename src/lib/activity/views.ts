import { activityDate, type ActivityDateField, type ActivityItem } from './model';

export type ActivityCalendarView = 'mes' | 'semana' | 'dia';
export const ACTIVITY_TERMINAL_STATES = ['completed', 'expired', 'cancelled'];

export function activityStateDateField(state: string): ActivityDateField {
  if (state === 'due' || state === 'expired') return 'expires';
  if (state === 'scheduled') return 'scheduled';
  return ACTIVITY_TERMINAL_STATES.includes(state) ? 'updated' : 'sent';
}

function parseActivityDate(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function activityTimelineDate(item: ActivityItem, field?: ActivityDateField) {
  if (field) return parseActivityDate(activityDate(item, field));
  return (
    parseActivityDate(activityDate(item, activityStateDateField(item.state))) ??
    parseActivityDate(item.sentAt) ??
    parseActivityDate(item.updatedAt)
  );
}

export function activityDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function activityCalendarDays(anchor: Date, view: ActivityCalendarView) {
  const start = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    view === 'mes' ? 1 : anchor.getDate()
  );
  if (view !== 'dia') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from(
    { length: view === 'mes' ? 42 : view === 'semana' ? 7 : 1 },
    (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
  );
}

export function moveActivityCalendar(anchor: Date, view: ActivityCalendarView, direction: number) {
  return view === 'mes'
    ? new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
    : new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        anchor.getDate() + direction * (view === 'semana' ? 7 : 1)
      );
}

export function initialActivityPeriod(
  items: ActivityItem[],
  view: ActivityCalendarView,
  field?: ActivityDateField,
  today = new Date()
) {
  const reference = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const first =
    view === 'mes'
      ? new Date(today.getFullYear(), today.getMonth(), 1)
      : activityCalendarDays(reference, view)[0];
  const next = moveActivityCalendar(first, view, 1);
  let latestPast: Date | null = null;
  let earliestFuture: Date | null = null;

  for (const item of items) {
    const date = activityTimelineDate(item, field);
    if (!date) continue;
    if (date >= first && date < next) return reference;
    if (date < first && (!latestPast || date > latestPast)) latestPast = date;
    if (date >= next && (!earliestFuture || date < earliestFuture)) earliestFuture = date;
  }

  return latestPast ?? earliestFuture ?? reference;
}

export function groupActivityDays(items: ActivityItem[], field?: ActivityDateField) {
  const days = new Map<string, ActivityItem[]>();
  const undated: ActivityItem[] = [];
  for (const item of items) {
    const date = activityTimelineDate(item, field);
    if (!date) {
      undated.push(item);
      continue;
    }
    const key = activityDayKey(date);
    const bucket = days.get(key) || [];
    bucket.push(item);
    days.set(key, bucket);
  }
  return { days, undated };
}
