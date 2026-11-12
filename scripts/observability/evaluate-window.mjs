import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERIES = new Set([
  'auth_token',
  'auth_jwks',
  'auth_health',
  'session_policy',
  'middleware',
  'documents',
  'viewer',
  'signatures',
  'evidence',
]);
const COOLDOWN_MS = 60 * 60 * 1000;
const HISTORY_MS = 30 * 24 * COOLDOWN_MS;
const SEVERITY = { info: 0, warning: 1, critical: 2 };

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function milliseconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function statusTotals(statuses) {
  let success = 0;
  let client = 0;
  let server = 0;
  for (const [key, value] of Object.entries(statuses || {})) {
    const status = Number(key);
    if (!Number.isInteger(status) || status < 100 || status > 599) continue;
    if (status >= 500) server += count(value);
    else if (status >= 400) client += count(value);
    else if (status >= 200 && status < 400) success += count(value);
  }
  return { success, client, server };
}

function addFinding(findings, key, severity, reason) {
  const previous = findings.get(key);
  if (!previous || SEVERITY[severity] > SEVERITY[previous.severity]) {
    findings.set(key, { key, severity, reason });
  }
}

function evaluateSeries(series, baseline, findings) {
  const key = SERIES.has(series.key) ? series.key : null;
  if (!key) return null;
  const totals = statusTotals(series.statuses);
  const networkFailures = count(series.networkFailures);
  const technicalFailures = totals.server + networkFailures;
  const requests = Math.max(
    count(series.requests),
    totals.success + totals.client + technicalFailures
  );
  const errorRate = requests > 0 ? technicalFailures / requests : 0;
  const failureStreak = count(series.failureStreak);
  const p50Ms = milliseconds(series.p50Ms);
  const p95Ms = milliseconds(series.p95Ms);
  const p99Ms = milliseconds(series.p99Ms);
  const latencySamples = count(series.latencySamples);

  if ((technicalFailures >= 10 && errorRate >= 0.2) || failureStreak >= 3) {
    addFinding(
      findings,
      `${key}:availability`,
      'critical',
      '5xx sostenidos o tres fallos consecutivos'
    );
  } else if ((technicalFailures >= 5 && errorRate >= 0.05) || failureStreak >= 2) {
    addFinding(findings, `${key}:availability`, 'warning', 'errores técnicos repetidos');
  }

  if (latencySamples >= 20 && p95Ms !== null) {
    const healthyP95 = milliseconds(baseline?.p95Ms);
    const warningLimit = healthyP95 === null ? 8_000 : Math.max(3_000, healthyP95 * 2);
    const criticalLimit = healthyP95 === null ? 15_000 : Math.max(8_000, healthyP95 * 3);
    if (p95Ms >= criticalLimit) {
      addFinding(findings, `${key}:latency`, 'critical', 'p95 sobre el umbral crítico');
    } else if (p95Ms >= warningLimit) {
      addFinding(findings, `${key}:latency`, 'warning', 'p95 sobre el umbral de advertencia');
    }
  }

  return {
    key,
    requests,
    success: totals.success,
    clientErrors: totals.client,
    serverErrors: totals.server,
    networkFailures,
    technicalFailures,
    errorRate: Number(errorRate.toFixed(4)),
    p50Ms,
    p95Ms,
    p99Ms,
    latencySamples,
  };
}

function evaluatePostgres(postgres, findings) {
  const connectionTimeouts = count(postgres?.connectionTimeouts);
  const statementTimeouts = count(postgres?.statementTimeouts);
  const lockWaits = count(postgres?.lockWaits);
  if (connectionTimeouts >= 10) {
    addFinding(findings, 'postgres:connectivity', 'critical', 'diez o más fallos de conexión');
  } else if (connectionTimeouts >= 3) {
    addFinding(findings, 'postgres:connectivity', 'warning', 'tres o más fallos de conexión');
  }
  if (statementTimeouts >= 10) {
    addFinding(
      findings,
      'postgres:statement_timeout',
      'critical',
      'diez o más consultas canceladas'
    );
  } else if (statementTimeouts >= 3) {
    addFinding(
      findings,
      'postgres:statement_timeout',
      'warning',
      'tres o más consultas canceladas'
    );
  }
  return { connectionTimeouts, statementTimeouts, lockWaits };
}

function updateIncidents(findings, coveredKeys, state, atMs, complete) {
  const notifications = [];
  const incidents = { ...(state.incidents || {}) };
  if (!complete) {
    const gapWindows = count(state.gapWindows) + 1;
    if (gapWindows === 2 || (gapWindows > 2 && gapWindows % 4 === 0)) {
      notifications.push({
        key: 'observability:data_gap',
        severity: 'warning',
        type: 'opened',
        reason: 'faltan datos de proveedores en ventanas consecutivas',
      });
    }
    return { incidents, notifications, gapWindows };
  }

  for (const finding of findings.values()) {
    const previous = incidents[finding.key];
    if (!previous || previous.status === 'resolved') {
      incidents[finding.key] = {
        status: 'open',
        severity: finding.severity,
        firstSeen: new Date(atMs).toISOString(),
        lastSeen: new Date(atMs).toISOString(),
        lastNotifiedAt: new Date(atMs).toISOString(),
        healthyWindows: 0,
      };
      notifications.push({ ...finding, type: 'opened' });
      continue;
    }
    const escalated = SEVERITY[finding.severity] > SEVERITY[previous.severity];
    const lastNoticeMs = Date.parse(previous.lastNotifiedAt || previous.firstSeen);
    const cooledDown = !Number.isFinite(lastNoticeMs) || atMs - lastNoticeMs >= COOLDOWN_MS;
    incidents[finding.key] = {
      ...previous,
      status: 'open',
      severity: finding.severity,
      lastSeen: new Date(atMs).toISOString(),
      healthyWindows: 0,
      lastNotifiedAt:
        escalated || cooledDown ? new Date(atMs).toISOString() : previous.lastNotifiedAt,
    };
    if (escalated || cooledDown) {
      notifications.push({ ...finding, type: escalated ? 'escalated' : 'reminder' });
    }
  }

  for (const [key, incident] of Object.entries(incidents)) {
    if (findings.has(key) || !coveredKeys.has(key) || incident.status !== 'open') continue;
    const healthyWindows = count(incident.healthyWindows) + 1;
    if (healthyWindows < 2) {
      incidents[key] = { ...incident, healthyWindows };
      continue;
    }
    incidents[key] = {
      ...incident,
      status: 'resolved',
      healthyWindows,
      resolvedAt: new Date(atMs).toISOString(),
    };
    notifications.push({
      key,
      severity: 'info',
      type: 'resolved',
      reason: 'dos ventanas completas consecutivas sin superar el umbral',
    });
  }

  for (const [key, incident] of Object.entries(incidents)) {
    if (incident.status === 'resolved' && atMs - Date.parse(incident.resolvedAt) > HISTORY_MS) {
      delete incidents[key];
    }
  }
  return { incidents, notifications, gapWindows: 0 };
}

export function evaluateWindow(input, previousState = {}) {
  const startedAt = Date.parse(input.windowStart);
  const endedAt = Date.parse(input.windowEnd);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    endedAt <= startedAt ||
    endedAt - startedAt > 60 * 60 * 1000
  ) {
    throw new Error('La ventana debe tener fechas ISO válidas y durar como máximo una hora.');
  }
  const complete = input.complete === true;
  const findings = new Map();
  const coveredKeys = new Set();
  const consecutiveWindow =
    previousState.lastWindowEnd === input.windowStart && previousState.lastWindowComplete === true;
  const failureStreaks =
    complete && consecutiveWindow ? { ...(previousState.failureStreaks || {}) } : {};
  const metrics = complete
    ? (input.series || [])
        .map((series) => {
          if (!SERIES.has(series.key)) return null;
          coveredKeys.add(`${series.key}:availability`);
          coveredKeys.add(`${series.key}:latency`);
          const totals = statusTotals(series.statuses);
          const technicalFailures = totals.server + count(series.networkFailures);
          const requests = count(series.requests);
          failureStreaks[series.key] =
            requests > 0 && technicalFailures >= requests
              ? count(failureStreaks[series.key]) + 1
              : 0;
          return evaluateSeries(
            {
              ...series,
              failureStreak: Math.max(count(series.failureStreak), failureStreaks[series.key]),
            },
            input.baseline?.[series.key],
            findings
          );
        })
        .filter(Boolean)
    : [];
  const postgres = complete && input.postgres ? evaluatePostgres(input.postgres, findings) : null;
  if (postgres) {
    coveredKeys.add('postgres:connectivity');
    coveredKeys.add('postgres:statement_timeout');
  }
  const deployment = /^[0-9a-f]{7,64}$/i.test(input.deployment || '')
    ? input.deployment.slice(0, 12)
    : null;
  if (
    complete &&
    deployment &&
    consecutiveWindow &&
    previousState.lastDeployment &&
    deployment !== previousState.lastDeployment
  ) {
    for (const current of metrics) {
      const before = previousState.lastMetrics?.[current.key];
      if (!before || current.requests < 20 || before.requests < 20) continue;
      if (
        current.serverErrors >= 5 &&
        current.errorRate >= Math.max(0.05, before.errorRate * 2, before.errorRate + 0.05)
      ) {
        addFinding(
          findings,
          'deployment:regression',
          'warning',
          'tasa 5xx aumentó tras el despliegue'
        );
      }
      if (
        current.latencySamples >= 20 &&
        before.latencySamples >= 20 &&
        current.p95Ms !== null &&
        before.p95Ms !== null &&
        current.p95Ms >= Math.max(3_000, before.p95Ms * 1.5)
      ) {
        addFinding(findings, 'deployment:regression', 'warning', 'p95 aumentó tras el despliegue');
      }
    }
  }
  coveredKeys.add('deployment:regression');
  const updated = updateIncidents(findings, coveredKeys, previousState, endedAt, complete);

  return {
    report: {
      windowStart: new Date(startedAt).toISOString(),
      windowEnd: new Date(endedAt).toISOString(),
      complete,
      deployment,
      metrics,
      postgres,
      findings: [...findings.values()],
      notifications: updated.notifications,
    },
    state: {
      version: 1,
      incidents: updated.incidents,
      gapWindows: updated.gapWindows,
      lastWindowEnd: new Date(endedAt).toISOString(),
      lastWindowComplete: complete,
      failureStreaks,
      lastDeployment: deployment || previousState.lastDeployment || null,
      lastMetrics: complete
        ? Object.fromEntries(metrics.map((metric) => [metric.key, metric]))
        : previousState.lastMetrics || {},
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf('--input');
  const stateIndex = args.indexOf('--state');
  if (inputIndex < 0 || !args[inputIndex + 1]) {
    throw new Error('Uso: node evaluate-window.mjs --input ventana.json [--state incidentes.json]');
  }
  const input = JSON.parse(await readFile(resolve(args[inputIndex + 1]), 'utf8'));
  const statePath = stateIndex >= 0 ? resolve(args[stateIndex + 1]) : null;
  let previousState = {};
  if (statePath) {
    try {
      previousState = JSON.parse(await readFile(statePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const result = evaluateWindow(input, previousState);
  if (statePath) {
    const temporaryPath = `${statePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(result.state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, statePath);
  }
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Error de evaluación'}\n`);
    process.exitCode = 1;
  });
}
