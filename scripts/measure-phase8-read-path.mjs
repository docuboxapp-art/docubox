import { performance } from 'node:perf_hooks';

const token = process.env.DOCUBOX_PHASE8_BEARER_TOKEN?.trim();
const baseUrl = new URL(process.env.DOCUBOX_PHASE8_BASE_URL || 'http://localhost:4028');
const samples = Math.min(20, Math.max(1, Number(process.env.DOCUBOX_PHASE8_SAMPLES || 3)));

if (!token) {
  console.error('Set DOCUBOX_PHASE8_BEARER_TOKEN to a dedicated test account access token.');
  process.exitCode = 2;
} else if (!['localhost', '127.0.0.1'].includes(baseUrl.hostname) &&
    process.env.DOCUBOX_PHASE8_ALLOW_REMOTE !== '1') {
  console.error('Remote measurement requires DOCUBOX_PHASE8_ALLOW_REMOTE=1. Never run load tests against production.');
  process.exitCode = 2;
} else if (!Number.isInteger(samples)) {
  console.error('DOCUBOX_PHASE8_SAMPLES must be an integer.');
  process.exitCode = 2;
} else {
  const paths = {
    inicio: ['/inicio', '/api/documentos/mis-participaciones?view=dashboard'],
    mis_documentos: [
      '/mis-documentos',
      '/api/documentos/listar?tipo=todos',
      '/api/documentos/mis-participaciones?exclude_owned=true&view=list',
      '/api/documentos/carpetas',
      '/api/documentos/etiquetas',
    ],
  };

  const percentile = (values, p) => {
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.min(ordered.length - 1, Math.ceil(p * ordered.length) - 1)] ?? null;
  };
  const timing = (header, name) => {
    const match = header?.match(new RegExp(`(?:^|,)\\s*${name};dur=([0-9.]+)`));
    return match ? Number(match[1]) : null;
  };
  const request = async (path) => {
    const startedAt = performance.now();
    const response = await fetch(new URL(path, baseUrl), {
      headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' },
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
    const headersAt = performance.now();
    const bytes = (await response.arrayBuffer()).byteLength;
    const serverTiming = response.headers.get('server-timing');
    const redirectedToLogin = response.redirected && new URL(response.url).pathname === '/login';
    return {
      path,
      status: redirectedToLogin ? 401 : response.status,
      ttfbMs: Math.round(headersAt - startedAt),
      totalMs: Math.round(performance.now() - startedAt),
      bytes,
      authClaimsMs: timing(serverTiming, 'auth_claims'),
      sessionPolicyMs: timing(serverTiming, 'session_policy'),
      middlewareMs: timing(serverTiming, 'middleware'),
    };
  };

  const result = {};
  for (const [name, group] of Object.entries(paths)) {
    const runs = [];
    for (let index = 0; index < samples; index += 1) {
      const startedAt = performance.now();
      const page = await request(group[0]);
      const api = await Promise.all(group.slice(1).map(request));
      const requests = [page, ...api];
      if (requests.some((item) => item.status < 200 || item.status >= 400)) {
        throw new Error(`${name} sample ${index + 1} returned non-success status. Details: ${requests.map((item) => `${item.path}=${item.status}`).join(', ')}`);
      }
      if (requests.some((item) => item.sessionPolicyMs === null)) {
        throw new Error(`${name} sample ${index + 1} lacks session_policy Server-Timing; it cannot serve as an authenticated baseline.`);
      }
      runs.push({
        elapsedMs: Math.round(performance.now() - startedAt),
        requestCount: requests.length,
        sessionPolicyCount: requests.filter((item) => item.sessionPolicyMs !== null).length,
        sessionPolicyTotalMs: Math.round(requests.reduce((sum, item) => sum + (item.sessionPolicyMs || 0), 0)),
        apiJsonBytes: api.reduce((sum, item) => sum + item.bytes, 0),
        requests,
      });
    }
    result[name] = {
      samples,
      elapsedP50Ms: percentile(runs.map((run) => run.elapsedMs), 0.5),
      elapsedP95Ms: percentile(runs.map((run) => run.elapsedMs), 0.95),
      sessionPolicyP50Ms: percentile(runs.flatMap((run) => run.requests.map((item) => item.sessionPolicyMs).filter((value) => value !== null)), 0.5),
      sessionPolicyP95Ms: percentile(runs.flatMap((run) => run.requests.map((item) => item.sessionPolicyMs).filter((value) => value !== null)), 0.95),
      runs,
    };
  }
  // No token, cookies, document contents, or user identifiers are printed.
  process.stdout.write(`${JSON.stringify({ base: baseUrl.origin, result }, null, 2)}\n`);
}
