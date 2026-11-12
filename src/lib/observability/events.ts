/** Small, allowlisted runtime events. Never pass raw URLs, headers, errors, or user data. */

export type ObservedService = 'auth' | 'session_policy' | 'next';
export type ObservedOutcome = 'unavailable' | 'invalid' | 'expired' | 'slow' | 'error';

type EventInput = {
  service: ObservedService;
  outcome: ObservedOutcome;
  route: string;
  status?: number;
  durationMs?: number;
  claimsMs?: number;
  policyMs?: number;
  code?: string | null;
  correlationId?: string;
  upstreamRequestIds?: string[];
  upstreamStatuses?: number[];
};

const KNOWN_CODES = new Set([
  'PGRST002',
  'PGRST301',
  '57014',
  '08006',
  '08P01',
  'AUTH_RETRYABLE_FETCH',
  'request_timeout',
  'unexpected_failure',
  'ABORT',
  'POLICY_BUSY',
  'INVALID_SESSION',
  'SESSION_NOT_FOUND',
  'UNAUTHENTICATED',
  'INACTIVITY_TIMEOUT',
  'ABSOLUTE_TIMEOUT',
  'MIDDLEWARE_DEADLINE',
]);

const EXACT_ROUTES = new Set([
  '/login',
  '/inicio',
  '/mi-espacio',
  '/mis-documentos',
  '/api/auth/totp/check',
  '/api/auth/session-probe',
  '/api/documentos/read-bootstrap',
  '/api/documentos/list-metadata',
  '/api/documentos/listar',
  '/api/documentos/mis-participaciones',
  '/api/documentos/enviar',
  '/api/firma/completion',
  '/api/firma/persist-evidence',
]);

export function observedRoute(path: string): string {
  const pathname = path
    .split(/[?#]/, 1)[0]
    .replace(/^\/app(?=\/)/, '')
    .replace(/\/route$/, '');
  if (EXACT_ROUTES.has(pathname)) return pathname;
  if (/^\/visor-documento\/[^/]+$/.test(pathname)) return '/visor-documento/[id]';
  if (/^\/api\/documentos\/[^/]+\/viewer-file$/.test(pathname)) {
    return '/api/documentos/[id]/viewer-file';
  }
  if (/^\/api\/documentos\/[^/]+\/evidence(?:-v2)?$/.test(pathname)) {
    return '/api/documentos/[id]/evidence';
  }
  if (pathname.startsWith('/api/internal/')) return '/api/internal/[job]';
  if (pathname.startsWith('/api/')) return '/api/other';
  return '/other';
}

function duration(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(120_000, Math.round(value)))
    : undefined;
}

export function observedCode(value: string | null | undefined): string {
  if (!value) return 'UNKNOWN';
  if (KNOWN_CODES.has(value)) return value;
  if (value === 'AuthRetryableFetchError') return 'AUTH_RETRYABLE_FETCH';
  if (value === 'AbortError') return 'ABORT';
  return 'UNKNOWN';
}

export function buildObservedEvent(input: EventInput) {
  const deployment = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    marker: 'docubox.observability.v1',
    at: new Date().toISOString(),
    service: input.service,
    outcome: input.outcome,
    route: observedRoute(input.route),
    status: input.status && input.status >= 100 && input.status <= 599 ? input.status : undefined,
    duration_ms: duration(input.durationMs),
    claims_ms: duration(input.claimsMs),
    policy_ms: duration(input.policyMs),
    code: observedCode(input.code),
    correlation_id:
      input.correlationId && /^[0-9a-f-]{36}$/i.test(input.correlationId)
        ? input.correlationId
        : undefined,
    upstream_request_ids: input.upstreamRequestIds
      ?.filter((id) => /^[a-zA-Z0-9:_-]{6,100}$/.test(id))
      .slice(0, 4),
    upstream_statuses: input.upstreamStatuses
      ?.filter((status) => Number.isInteger(status) && status >= 100 && status <= 599)
      .slice(0, 4),
    deployment:
      deployment && /^[0-9a-f]{7,64}$/i.test(deployment) ? deployment.slice(0, 12) : 'local',
  };
}

export function emitObservedEvent(input: EventInput): void {
  const event = buildObservedEvent(input);
  const line = JSON.stringify(event);
  if (input.outcome === 'unavailable' || input.outcome === 'error') console.error(line);
  else console.warn(line);
}
