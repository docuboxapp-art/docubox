import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Agent, createServer, get } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { createNotificationRefresh } from '../src/lib/notifications/realtime.ts';

const baseline = process.argv[2];
if (!baseline)
  throw new Error('Usage: node scripts/benchmark-workspace-hot-paths.mjs <baseline-commit>');
const root = fileURLToPath(new URL('../', import.meta.url));
const enginePath = 'src/lib/reporting/engine.ts';
const baselineSource = execFileSync('git', ['show', `${baseline}:${enginePath}`], {
  cwd: root,
  encoding: 'utf8',
});
const candidateSource = await readFile(new URL(`../${enginePath}`, import.meta.url), 'utf8');

async function loadEngine(contents) {
  const { outputFiles } = await build({
    stdin: {
      contents,
      loader: 'ts',
      resolveDir: fileURLToPath(new URL('../src/lib/reporting/', import.meta.url)),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
  );
}

const engines = await Promise.all([loadEngine(baselineSource), loadEngine(candidateSource)]);
const percentile = (values, p) =>
  values.toSorted((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const round = (value) => Math.round(value * 100) / 100;
const cpuMs = (sample) => (sample.user + sample.system) / 1000;
const summarize = (samples) => ({
  medianMs: round(
    percentile(
      samples.map(({ elapsed }) => elapsed),
      0.5
    )
  ),
  p95Ms: round(
    percentile(
      samples.map(({ elapsed }) => elapsed),
      0.95
    )
  ),
  medianCpuMs: round(
    percentile(
      samples.map(({ cpu }) => cpu),
      0.5
    )
  ),
});

const fields = ['nombre', 'estado', 'fecha', 'cantidad', 'urgente'].map((id, index) => ({
  id,
  label: id,
  type: ['text', 'text', 'date', 'number', 'boolean'][index],
}));
const statuses = ['en_proceso', 'completado', 'pendiente', 'en_revision'];
const rows = Array.from({ length: 10_000 }, (_, id) => ({
  id,
  nombre: `Revisión de expediente ${(id * 1237) % 10_003}`,
  estado: statuses[id % statuses.length],
  fecha: new Date(Date.UTC(2026, 0, 1) + ((id * 7919) % 10007) * 70_000).toISOString(),
  cantidad: id % 600,
  urgente: id % 3 === 0,
}));
const conditions = [
  { field: 'nombre', operator: 'contains', value: ' revision de  expediente ' },
  { field: 'estado', operator: 'neq', value: 'Pendiente' },
  { field: 'fecha', operator: 'gte', value: '2025-01-01' },
  { field: 'cantidad', operator: 'gte', value: '10' },
  { field: 'urgente', operator: 'neq', value: 'Sí' },
];
const reports = [];
for (const [label, source, sortBy, predicates] of [
  ['filtered-date-10000', rows, 'fecha', conditions],
  ['filtered-text-10000', rows, 'nombre', conditions],
  ['default-text-50', rows.slice(0, 50), 'nombre', []],
]) {
  const config = {
    period: 'all',
    dateField: 'fecha',
    conditions: predicates,
    match: 'all',
    sortBy,
    sortDirection: 'asc',
  };
  const run = (index) => engines[index].runReport(source, config, fields);
  const expected = run(0).map(({ id }) => id);
  assert.deepEqual(
    run(1).map(({ id }) => id),
    expected
  );
  for (let warm = 0; warm < 3; warm++) {
    run(0);
    run(1);
  }
  const samples = [[], []];
  for (let repeat = 0; repeat < 14; repeat++) {
    for (const index of repeat % 2 ? [1, 0] : [0, 1]) {
      const startCpu = process.cpuUsage();
      const started = performance.now();
      const count = run(index).length;
      samples[index].push({
        elapsed: performance.now() - started,
        cpu: cpuMs(process.cpuUsage(startCpu)),
      });
      assert.equal(count, expected.length);
    }
  }
  reports.push({
    label,
    outputRows: expected.length,
    before: summarize(samples[0]),
    after: summarize(samples[1]),
  });
}

const browserCount = 24;
const updates = 12;
const fixtures = Array.from({ length: 200 }, (_, id) => ({
  id,
  title: `Documento ${id}`,
  description: 'Notificación sintética para una vista de trabajo.',
  read: false,
}));

function readJson(url, agent, signal) {
  return new Promise((resolve, reject) => {
    const request = get(url, { agent, signal }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 200);
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

let currentBurst;
const server = createServer((req, res) => {
  const burst = currentBurst;
  const limit = req.url.endsWith('/20') ? 20 : 200;
  const body = JSON.stringify({
    revision: burst.revision,
    notifications: fixtures.slice(0, limit),
  });
  burst.active++;
  burst.reads++;
  burst.peak = Math.max(burst.peak, burst.active);
  burst.bytes += Buffer.byteLength(body);
  setTimeout(() => {
    res.end(body);
    burst.active--;
  }, 20);
});
await new Promise((done) => server.listen({ port: 0, host: '127.0.0.1' }, done));
const address = `http://127.0.0.1:${server.address().port}`;
const agent = new Agent({ keepAlive: true, maxSockets: 64 });

async function notificationBurst(coalesced) {
  const burst = { revision: 0, active: 0, peak: 0, bytes: 0, reads: 0 };
  currentBurst = burst;
  const pending = new Set();
  const failures = [];
  const views = Array.from({ length: browserCount }, () => [20, 200])
    .flat()
    .map((size, index) => {
      const view = { latest: 0, observed: 0 };
      const read = (signal) => {
        const task = readJson(`${address}/${index}/${size}`, agent, signal).then((record) => {
          assert.equal(record.notifications.length, size);
          view.latest = record.revision;
          view.observed = Math.max(view.observed, record.revision);
        });
        pending.add(task);
        void task.then(
          () => pending.delete(task),
          (error) => {
            failures.push(error);
            pending.delete(task);
          }
        );
        return task;
      };
      const refresh = coalesced
        ? createNotificationRefresh(read)
        : { request: () => void read(), dispose() {} };
      return { view, ...refresh };
    });

  const startCpu = process.cpuUsage();
  const started = performance.now();
  try {
    for (let index = 1; index <= updates; index++) {
      burst.revision = index;
      for (const view of views) view.request();
      await delay(2);
    }
    while (pending.size) await Promise.allSettled([...pending]);
    if (failures.length) throw failures[0];
    assert.equal(views.filter(({ view }) => view.observed === updates).length, views.length);
    const latestViews = views.filter(({ view }) => view.latest === updates).length;
    if (coalesced) assert.equal(latestViews, views.length);
    return {
      elapsed: performance.now() - started,
      cpu: cpuMs(process.cpuUsage(startCpu)),
      bytes: burst.bytes,
      reads: burst.reads,
      peak: burst.peak,
      latestViews,
    };
  } finally {
    for (const view of views) view.dispose();
  }
}

const feedSamples = [[], []];
try {
  await notificationBurst(false);
  await notificationBurst(true);
  for (let repeat = 0; repeat < 6; repeat++) {
    for (const index of repeat % 2 ? [1, 0] : [0, 1])
      feedSamples[index].push(await notificationBurst(Boolean(index)));
  }
} finally {
  agent.destroy();
  await new Promise((done) => server.close(done));
}
const summarizeFeed = (samples) => ({
  ...summarize(samples),
  ...Object.fromEntries(
    ['bytes', 'reads', 'peak', 'latestViews'].map((key) => [
      key,
      percentile(
        samples.map((sample) => sample[key]),
        0.5
      ),
    ])
  ),
});
console.log(
  JSON.stringify(
    {
      baseline,
      reportRuns: 14,
      reports,
      notificationBurst: {
        browserCount,
        updates,
        runs: 6,
        before: summarizeFeed(feedSamples[0]),
        after: summarizeFeed(feedSamples[1]),
      },
    },
    null,
    2
  )
);
