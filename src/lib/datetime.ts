const DEFAULT_LOCALE = 'es-MX';

function parseUtcTimestamp(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = value.trim();
  if (!raw) return null;

  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const utcValue = hasOffset
    ? normalized
    : /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T00:00:00Z`
      : `${normalized}Z`;
  const date = new Date(utcValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isSupportedTimeZone(value: string | null | undefined) {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function zoneOffsetMilliseconds(date: Date, timeZone: string) {
  const local = zonedParts(date, timeZone);
  return (
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) -
    date.getTime()
  );
}

export function getTimeZoneOffsetLabel(timeZone: string, at = new Date()) {
  if (!isSupportedTimeZone(timeZone)) return 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(at);
  return parts.find((part) => part.type === 'timeZoneName')?.value?.replace('GMT', 'UTC') || 'UTC';
}

export function dateInTimeZone(timeZone: string, at = new Date()) {
  const safeTimeZone = isSupportedTimeZone(timeZone) ? timeZone : 'UTC';
  const { year, month, day } = zonedParts(at, safeTimeZone);
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

export function addCalendarDaysInTimeZone(timeZone: string, days: number, at = new Date()) {
  const base = new Date(`${dateInTimeZone(timeZone, at)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Converts a creator-selected wall-clock date and IANA zone to the canonical UTC instant. */
export function zonedDateTimeToUtcIso(dateValue: string, timeValue: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(timeValue)) {
    return null;
  }
  if (!isSupportedTimeZone(timeZone)) return null;

  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute, second = 0] = timeValue.split(':').map(Number);
  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidateMs = wallClockMs - zoneOffsetMilliseconds(new Date(wallClockMs), timeZone);
  candidateMs = wallClockMs - zoneOffsetMilliseconds(new Date(candidateMs), timeZone);

  const resolved = zonedParts(new Date(candidateMs), timeZone);
  if (
    resolved.year !== year ||
    resolved.month !== month ||
    resolved.day !== day ||
    resolved.hour !== hour ||
    resolved.minute !== minute ||
    resolved.second !== second
  ) {
    return null;
  }
  return new Date(candidateMs).toISOString();
}

/** The browser zone is the effective zone for a user-facing timestamp. */
export function getEffectiveTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Stored timestamps are interpreted as UTC. Local output always discloses both
 * its offset and IANA zone so it cannot be confused with the original record.
 */
export function formatLocalTimestamp(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
) {
  const date = parseUtcTimestamp(value);
  if (!date) return 'No disponible';

  const timeZone = getEffectiveTimeZone();
  const offset = getTimeZoneOffsetLabel(timeZone, date);
  const formatted = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    ...options,
    timeZone,
  }).format(date);

  return `${formatted} (${timeZone}, ${offset})`;
}

/** Use for legal, cryptographic, and audit evidence that must expose UTC. */
export function formatUtcTimestamp(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
) {
  const date = parseUtcTimestamp(value);
  if (!date) return 'No disponible';

  return `${new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    ...options,
    timeZone: 'UTC',
  }).format(date)} UTC`;
}

export function toUtcIsoTimestamp(value: string | Date | null | undefined) {
  return parseUtcTimestamp(value)?.toISOString() || null;
}

/** Local display accompanied by the immutable UTC representation of the record. */
export function formatEvidenceTimestamp(value: string | Date | null | undefined) {
  const local = formatLocalTimestamp(value);
  const utcOriginal = toUtcIsoTimestamp(value);
  if (local === 'No disponible' || !utcOriginal) return local;
  return `${local} · UTC original: ${utcOriginal}`;
}
