import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const built = await build({
  stdin: {
    contents: "export * from './src/lib/activity/model'; export * from './src/lib/activity/views';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const file = resolve('.tmp/activity-views-fixture.mjs');
await writeFile(file, built.outputFiles[0].text);
const api = await import(pathToFileURL(file).href);
const now = new Date(2026, 10, 23, 12).getTime();
const base = { search: '', state: '', access: '', workspace: '', from: '', to: '', sort: 'recent' };
const item = (id, patch = {}) => ({
  id,
  kind: 'expedientes',
  title: `Expediente ${id}`,
  reference: id,
  workspace: 'Equipo',
  workspaceId: 'workspace',
  person: 'Participante',
  email: 'synthetic@example.invalid',
  role: 'Revisor',
  state: 'in_progress',
  stateLabel: 'En integración',
  sentAt: new Date(2026, 10, 23, 9).toISOString(),
  updatedAt: new Date(2026, 10, 23, 10).toISOString(),
  expiresAt: null,
  access: 'private',
  priority: 'normal',
  progress: 25,
  detail: '',
  actions: [],
  ...patch,
});
const ids = (rows) => rows.map((row) => row.id);

test('quick filters separate follow-up, urgency and future 72-hour deadlines from terminal records', () => {
  const rows = [
    item('normal'),
    item('urgent', { priority: 'urgent' }),
    item('due', { expiresAt: new Date(now + 72 * 3600000).toISOString() }),
    item('late', { expiresAt: new Date(now - 1).toISOString() }),
    item('later', { expiresAt: new Date(now + 72 * 3600000 + 1).toISOString() }),
    item('done', {
      state: 'completed',
      priority: 'urgent',
      expiresAt: new Date(now + 1000).toISOString(),
    }),
    item('cancelled', { state: 'cancelled', priority: 'urgent' }),
    item('paused', { state: 'paused' }),
    item('sign', { state: 'signature' }),
  ];
  assert.deepEqual(ids(api.filterActivity(rows, { ...base, state: 'urgent' }, now)), ['urgent']);
  assert.deepEqual(ids(api.filterActivity(rows, { ...base, state: 'due' }, now)), ['due']);
  assert.ok(
    !ids(api.filterActivity(rows, { ...base, state: 'active' }, now)).some((id) =>
      ['done', 'cancelled', 'paused'].includes(id)
    )
  );
  assert.ok(ids(api.filterActivity(rows, { ...base, state: 'active' }, now)).includes('sign'));
});

test('priority, access, workspace, search and exact states intersect without changing the input', () => {
  const rows = [
    item('A', { title: 'Evaluación fiscal' }),
    item('B', { priority: 'urgent', access: 'public' }),
    item('C', { state: 'completed' }),
  ];
  assert.deepEqual(
    ids(
      api.filterActivity(
        rows,
        {
          ...base,
          priority: 'normal',
          state: 'in_progress',
          search: 'evaluacion',
          workspace: 'workspace',
          access: 'private',
        },
        now
      )
    ),
    ['A']
  );
  assert.deepEqual(ids(api.filterActivity(rows, { ...base, priority: 'urgent' }, now)), ['B']);
  assert.equal(
    api.filterActivity(rows, { ...base, priority: 'normal', state: 'urgent' }, now).length,
    0
  );
  assert.deepEqual(ids(rows), ['A', 'B', 'C']);
});

test('date ranges use the selected date and exclude records missing that date, including to-only ranges', () => {
  const rows = [
    item('A', { expiresAt: new Date(2026, 10, 25, 23, 59, 59).toISOString() }),
    item('B'),
    item('C', { expiresAt: new Date(2026, 10, 26).toISOString() }),
  ];
  assert.deepEqual(
    ids(
      api.filterActivity(
        rows,
        { ...base, dateField: 'expires', from: '2026-11-25', to: '2026-11-25' },
        now
      )
    ),
    ['A']
  );
  assert.deepEqual(
    ids(api.filterActivity(rows, { ...base, dateField: 'expires', to: '2026-11-25' }, now)),
    ['A']
  );
  assert.deepEqual(
    ids(
      api.filterActivity(
        rows,
        { ...base, dateField: 'sent', from: '2026-11-23', to: '2026-11-23' },
        now
      )
    ),
    ['A', 'B', 'C']
  );
});

test('relative date filters use local calendar days and exclude future dates', () => {
  const rows = [
    item('today'),
    item('last', { sentAt: new Date(2026, 10, 17, 0).toISOString() }),
    item('old', { sentAt: new Date(2026, 10, 16, 23, 59).toISOString() }),
    item('future', { sentAt: new Date(now + 1000).toISOString() }),
  ];
  assert.deepEqual(ids(api.filterActivity(rows, { ...base, period: 'today' }, now)), ['today']);
  assert.deepEqual(ids(api.filterActivity(rows, { ...base, period: '7' }, now)).sort(), [
    'last',
    'today',
  ]);
  assert.equal(
    api.filterActivity(rows, { ...base, dateField: 'expires', period: '30' }, now).length,
    0
  );
});

test('calendar buckets preserve all records beyond list pagination and report absent or invalid dates separately', () => {
  const rows = Array.from({ length: 47 }, (_, i) => item(String(i)));
  const grouped = api.groupActivityDays(rows, 'sent');
  assert.equal(grouped.days.get('2026-11-23').length, 47);
  const invalid = api.groupActivityDays(
    [
      item('none'),
      item('bad', { expiresAt: 'invalid' }),
      item('valid', { expiresAt: new Date(2026, 10, 23, 23, 59).toISOString() }),
    ],
    'expires'
  );
  assert.deepEqual(ids(invalid.undated), ['none', 'bad']);
  assert.deepEqual(ids(invalid.days.get('2026-11-23')), ['valid']);
});

test('month, week and day periods handle leap years and boundaries without rolling over a short month', () => {
  const days = api.activityCalendarDays(new Date(2024, 1, 29), 'mes');
  assert.equal(days.length, 42);
  assert.equal(days[0].getDay(), 1);
  assert.ok(days.some((d) => api.activityDayKey(d) === '2024-02-29'));
  assert.equal(
    api.activityDayKey(api.moveActivityCalendar(new Date(2026, 0, 31), 'mes', 1)),
    '2026-02-01'
  );
  const week = api.activityCalendarDays(new Date(2027, 0, 1), 'semana');
  assert.equal(api.activityDayKey(week[0]), '2026-12-28');
  assert.equal(api.activityDayKey(week[6]), '2027-01-03');
  assert.equal(api.activityCalendarDays(new Date(2026, 10, 23), 'dia').length, 1);
  assert.equal(
    api.activityDayKey(api.moveActivityCalendar(new Date(2026, 11, 31), 'dia', 1)),
    '2027-01-01'
  );
});

test('calendar date sources remain distinct and sorting preserves current ordering semantics', () => {
  const row = item('A', { scheduledAt: new Date(2026, 11, 1).toISOString() });
  assert.equal(api.activityDate(row, 'scheduled'), row.scheduledAt);
  assert.equal(api.activityDate(row, 'updated'), row.updatedAt);
  assert.equal(api.activityDate(row, 'expires'), null);
  const rows = [
    row,
    item('B', { priority: 'urgent', sentAt: new Date(2026, 10, 22).toISOString() }),
  ];
  assert.deepEqual(ids(api.filterActivity(rows, { ...base, sort: 'urgent' }, now)), ['B', 'A']);
  assert.deepEqual(ids(api.filterActivity(rows, { ...base, sort: 'oldest' }, now)), ['B', 'A']);
});

test('date sorting follows the selected date source and leaves missing dates last', () => {
  const rows = [
    item('late', { expiresAt: new Date(2026, 10, 28).toISOString() }),
    item('none'),
    item('early', { expiresAt: new Date(2026, 10, 24).toISOString() }),
  ];
  assert.deepEqual(
    ids(api.filterActivity(rows, { ...base, dateField: 'expires', sort: 'oldest' }, now)),
    ['early', 'late', 'none']
  );
  assert.deepEqual(
    ids(api.filterActivity(rows, { ...base, dateField: 'expires', sort: 'recent' }, now)),
    ['late', 'early', 'none']
  );
});

test('activity list orders across the filtered records using each displayed field', () => {
  const rows = [
    item('a', { title: 'Expediente 1', progress: null, state: 'in_progress' }),
    item('b', { title: 'Expediente 10', progress: 10, state: 'in_progress' }),
    item('c', { title: 'Expediente 2', progress: 2, state: 'in_progress' }),
    item('d', { title: 'Expediente 3', progress: 100, state: 'completed' }),
  ];
  const criteria = { ...base, state: 'in_progress' };
  assert.deepEqual(ids(api.filterActivity(rows, { ...criteria, sort: 'title_asc' }, now)), ['a', 'c', 'b']);
  assert.deepEqual(ids(api.filterActivity(rows, { ...criteria, sort: 'progress_desc' }, now)), ['b', 'c', 'a']);
  assert.deepEqual(ids(api.filterActivity(rows, { ...criteria, sort: 'progress_asc' }, now)), ['c', 'b', 'a']);
});

test('an empty current period opens on the most recent historical record', () => {
  const older = new Date(2026, 8, 17, 10).toISOString();
  const recent = new Date(2026, 9, 21, 10).toISOString();
  const rows = [
    item('old', { sentAt: older }),
    item('recent', { sentAt: recent }),
    item('another-old', { sentAt: older }),
  ];
  const today = new Date(2026, 10, 23, 12);

  for (const view of ['mes', 'semana', 'dia']) {
    const anchor = api.initialActivityPeriod(rows, view, undefined, today);
    assert.equal(api.activityDayKey(anchor), '2026-10-21');
    assert.ok(
      api.activityCalendarDays(anchor, view).some((day) => api.activityDayKey(day) === '2026-10-21')
    );
  }
  assert.equal(
    api.activityDayKey(
      api.initialActivityPeriod([...rows, item('current')], 'mes', undefined, today)
    ),
    '2026-11-23'
  );
});

test('the opening period and calendar use the same scheduled or completion date', () => {
  const sentAt = new Date(2026, 8, 17, 10).toISOString();
  const scheduledAt = new Date(2026, 11, 2, 10).toISOString();
  const updatedAt = new Date(2026, 9, 21, 10).toISOString();
  const scheduled = item('scheduled', { state: 'scheduled', sentAt, scheduledAt });
  const completed = item('completed', { state: 'completed', sentAt, updatedAt });
  const today = new Date(2026, 10, 23, 12);
  assert.equal(
    api.activityDayKey(api.initialActivityPeriod([scheduled], 'mes', undefined, today)),
    '2026-12-02'
  );
  assert.equal(
    api.activityDayKey(api.initialActivityPeriod([completed], 'mes', undefined, today)),
    '2026-10-21'
  );
  const { days } = api.groupActivityDays([scheduled, completed]);
  assert.deepEqual(ids(days.get('2026-12-02')), ['scheduled']);
  assert.deepEqual(ids(days.get('2026-10-21')), ['completed']);
});
