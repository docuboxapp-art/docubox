import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {
  emitObservedEvent,
  type ObservedOutcome,
  type ObservedService,
} from '@/lib/observability/events';

const PUBLIC_ROUTES = [
  '/api/public/case-portal',
  '/api/public/case-entry',
  '/',
  '/login',
  '/registro',
  '/olvide-contrasena',
  '/verificar-correo',
  '/auth/confirm',
  '/login/totp-verification',
  '/register-device',
  '/verificar-documento',
  '/verificar-certificacion',
];

const PUBLIC_PREFIXES = [
  '/_next/',
  '/favicon',
  '/assets/',
  '/enrolamiento/',
  '/subir-movil/',
  '/captura-id-movil/',
  '/firma-movil/',
  '/firma-presencial/',
  '/portal-participante/',
  '/portal-formulario/',
  '/registro-participante/',
  '/form/',
  '/formulario-publico/',
  '/expediente/',
  '/sala/',
  '/solicitud/',
  '/notificacion/',
  '/verificar-documento/',
  '/verificar-certificacion/',
  '/verificar-evidencia/',
  '/validar-formulario/',
  '/api/public/v1/verifications/',
  '/api/public/v2/verifications/',
  '/v/',
  '/verify/promissory-note/',
  '/verify/blockchain/',
];

// This endpoint runs immediately after sign-in and validates the freshly issued
// Bearer token itself before the browser has completed its session handoff.
const SESSION_POLICY_BOOTSTRAP_API_ROUTES = new Set(['/api/auth/totp/check']);
const KIOSK_COOKIE_NAME = 'docubox_kiosk_session';
const SESSION_RETRY_COOKIE_NAME = 'docubox_session_check_retry';
const SESSION_PROBE_PATH = '/api/auth/session-probe';
const KIOSK_AUTH_API_ROUTES = new Set([
  '/api/auth/check-login-options',
  '/api/auth/send-login-otp',
  '/api/auth/set-session-start',
  '/api/auth/totp/check',
  '/api/auth/totp/setup',
  '/api/auth/totp/verify-login',
  '/api/auth/totp/verify-setup',
  '/api/auth/verify-login-otp',
  '/api/security/check-device',
  '/api/security/log-access',
  '/api/webauthn/auth-options',
  '/api/webauthn/auth-verify',
  '/api/webauthn/register-options',
  '/api/webauthn/register-verify',
  '/api/webauthn/stepup-options',
  '/api/webauthn/stepup-verify',
]);

type KioskMiddlewareScope = {
  id: string;
  workspaceId: string;
  documentId: string;
  participantReferenceId: string;
  status: string;
  expiresAt: string;
  revokedAt: string | null;
  portalToken: string;
};

async function kioskTokenHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function loadKioskMiddlewareScope(token: string): Promise<KioskMiddlewareScope | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('KIOSK_CONFIGURATION_UNAVAILABLE');
  const tokenHash = await kioskTokenHash(token);
  const sessionResponse = await fetch(
    `${supabaseUrl}/rest/v1/in_person_signing_sessions?select=id,workspace_id,document_id,participant_reference_id,status,expires_at,revoked_at&token_hash=eq.${tokenHash}&limit=1`,
    {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      cache: 'no-store',
    }
  );
  if (!sessionResponse.ok) throw new Error('KIOSK_SESSION_LOOKUP_FAILED');
  const sessions = (await sessionResponse.json()) as Array<Record<string, unknown>>;
  const session = sessions[0];
  if (!session) return null;
  const participantResponse = await fetch(
    `${supabaseUrl}/rest/v1/document_participant_references?select=snapshot&id=eq.${encodeURIComponent(String(session.participant_reference_id))}&document_id=eq.${encodeURIComponent(String(session.document_id))}&limit=1`,
    {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      cache: 'no-store',
    }
  );
  if (!participantResponse.ok) throw new Error('KIOSK_PARTICIPANT_LOOKUP_FAILED');
  const participants = (await participantResponse.json()) as Array<{ snapshot?: unknown }>;
  const snapshot =
    participants[0]?.snapshot && typeof participants[0].snapshot === 'object'
      ? (participants[0].snapshot as Record<string, unknown>)
      : {};
  return {
    id: String(session.id),
    workspaceId: String(session.workspace_id),
    documentId: String(session.document_id),
    participantReferenceId: String(session.participant_reference_id),
    status: String(session.status),
    expiresAt: String(session.expires_at),
    revokedAt: session.revoked_at ? String(session.revoked_at) : null,
    portalToken: String(snapshot.portal_token || ''),
  };
}

function kioskTerminalPath(request: NextRequest, scope: KioskMiddlewareScope | null) {
  const url = request.nextUrl.clone();
  url.pathname = `/firma-presencial/finalizada/${scope?.id || 'no-disponible'}`;
  url.search = '';
  return url;
}

function kioskDeniedResponse(request: NextRequest, scope: KioskMiddlewareScope | null) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'KIOSK_SCOPE_DENIED', message: 'La sesión presencial no autoriza este recurso.' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
  return NextResponse.redirect(kioskTerminalPath(request, scope), 307);
}

function collectRequestDocumentIds(value: unknown, output = new Set<string>()) {
  if (!value || typeof value !== 'object') return output;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (
      ['documentId', 'document_id', 'documentoId', 'documento_id'].includes(key) &&
      typeof nested === 'string'
    ) {
      output.add(nested);
    } else if (nested && typeof nested === 'object') {
      collectRequestDocumentIds(nested, output);
    }
  }
  return output;
}

async function kioskRequestBodyMatchesScope(request: NextRequest, documentId: string) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true;
  if (!request.headers.get('content-type')?.includes('application/json')) return true;
  try {
    const body = await request.clone().json();
    const documentIds = collectRequestDocumentIds(body);
    return [...documentIds].every((candidate) => candidate === documentId);
  } catch {
    return false;
  }
}

async function isAllowedKioskApi(request: NextRequest, scope: KioskMiddlewareScope) {
  const path = request.nextUrl.pathname;
  if (path === '/api/firma-presencial/context') return true;
  if (path === '/api/firma-presencial/recover') return true;
  if (path === `/api/firma-presencial/${request.cookies.get(KIOSK_COOKIE_NAME)?.value}`)
    return true;
  if (KIOSK_AUTH_API_ROUTES.has(path)) return true;
  if (path.startsWith('/api/portal-participante/')) {
    const queryToken = request.nextUrl.searchParams.get('token');
    return !queryToken || queryToken === scope.portalToken;
  }
  if (path === '/api/documentos/obtener') {
    return request.nextUrl.searchParams.get('id') === scope.documentId;
  }
  if (path.startsWith(`/api/documentos/${scope.documentId}/`)) {
    return /\/(package|viewer-file|seal-signatures)(\/|$)/.test(path);
  }
  if (
    path === '/api/documentos/advance-participation' ||
    path.startsWith('/api/firma/') ||
    path.startsWith('/api/efirma/') ||
    path.startsWith('/api/nubarium/') ||
    path.startsWith('/api/mobile-upload/')
  ) {
    return kioskRequestBodyMatchesScope(request, scope.documentId);
  }
  return false;
}

function isAllowedKioskPage(pathname: string, scope: KioskMiddlewareScope) {
  if (
    pathname === '/login' ||
    pathname === '/login/totp-verification' ||
    pathname === '/olvide-contrasena' ||
    pathname === '/verificar-correo' ||
    pathname === '/register-device' ||
    pathname === '/ayuda-firmado' ||
    pathname.startsWith('/auth/')
  ) {
    return true;
  }
  if (pathname === `/portal-participante/${scope.portalToken}`) return true;
  if (pathname === `/registro-participante/${scope.portalToken}`) return true;
  if (pathname === `/visor-documento/${scope.documentId}`) return true;
  if (pathname === `/firmar-documento/${scope.documentId}`) return true;
  if (pathname === `/firma-presencial/finalizada/${scope.id}`) return true;
  if (pathname === `/firma-presencial/recuperar/${scope.id}`) return true;
  return false;
}

async function enforceKioskScope(request: NextRequest) {
  const token = request.cookies.get(KIOSK_COOKIE_NAME)?.value;
  if (!token) return null;
  let scope: KioskMiddlewareScope | null = null;
  try {
    scope = await loadKioskMiddlewareScope(token);
  } catch {
    return request.nextUrl.pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'KIOSK_SCOPE_UNAVAILABLE' }, { status: 503 })
      : NextResponse.redirect(kioskTerminalPath(request, null), 307);
  }
  if (!scope) return kioskDeniedResponse(request, null);
  const terminal =
    scope.revokedAt !== null ||
    ['completed', 'cancelled', 'expired'].includes(scope.status) ||
    new Date(scope.expiresAt).getTime() <= Date.now();
  const path = request.nextUrl.pathname;
  if (terminal) {
    if (
      path === `/firma-presencial/finalizada/${scope.id}` ||
      path === '/api/firma-presencial/context' ||
      path === '/api/firma-presencial/recover'
    ) {
      return NextResponse.next();
    }
    return kioskDeniedResponse(request, scope);
  }
  if (scope.status !== 'started') return kioskDeniedResponse(request, scope);
  const allowed = path.startsWith('/api/')
    ? await isAllowedKioskApi(request, scope)
    : isAllowedKioskPage(path, scope);
  if (!allowed) return kioskDeniedResponse(request, scope);
  const headers = new Headers(request.headers);
  headers.set('x-docubox-kiosk-session-id', scope.id);
  headers.set('x-docubox-kiosk-document-id', scope.documentId);
  headers.set('x-docubox-kiosk-participant-reference-id', scope.participantReferenceId);
  headers.set('x-docubox-kiosk-workspace-id', scope.workspaceId);
  return NextResponse.next({ request: { headers } });
}

type SessionPolicyRow = { active?: unknown; reason?: unknown };
type SessionPolicyError = { code?: string; message?: string; name?: string; status?: number };
type SessionPolicyValidationResult = {
  data: unknown;
  error: SessionPolicyError | null;
};

const INVALID_SESSION_ERROR_CODES = new Set(['refresh_token_not_found', 'bad_jwt', 'PGRST301']);
const SESSION_POLICY_RETRY_DELAY_MS = 350;
// The policy RPC's observed p99 is above eight seconds during gateway pressure.
const SESSION_VALIDATION_TIMEOUT_MS = 12_000;
const MIDDLEWARE_DEADLINE_MS = 20_000;
const SESSION_POLICY_FAILURE_BACKOFF_MS = 2_000;
const inFlightSessionPolicyValidations = new Map<string, Promise<SessionPolicyValidationResult>>();
const sessionPolicyFailureUntil = new Map<string, number>();

function normalizeSessionPolicyError(error: unknown): SessionPolicyError {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const candidate = error as Record<string, unknown>;
  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    message:
      typeof candidate.message === 'string'
        ? candidate.message
        : String(candidate.message || error),
    name: typeof candidate.name === 'string' ? candidate.name : undefined,
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
  };
}

async function fetchWithSessionValidationTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  requestSignal?: AbortSignal,
  onResponse?: (response: Response) => void
) {
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  const forwardRequestAbort = () => controller.abort(requestSignal?.reason);
  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener('abort', forwardAbort, { once: true });
  if (requestSignal?.aborted) forwardRequestAbort();
  else requestSignal?.addEventListener('abort', forwardRequestAbort, { once: true });

  const timeout = setTimeout(() => controller.abort(), SESSION_VALIDATION_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    onResponse?.(response);
    return response;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', forwardAbort);
    requestSignal?.removeEventListener('abort', forwardRequestAbort);
  }
}

function getPolicyRow(value: unknown): SessionPolicyRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? (row as SessionPolicyRow) : null;
}

function getSessionIdFromClaims(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const claims = (value as { claims?: unknown }).claims;
  if (!claims || typeof claims !== 'object') return null;
  const sessionId = (claims as { session_id?: unknown }).session_id;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}

function clearSessionCookies(request: NextRequest, response: NextResponse) {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name === 'docubox_session_start' || cookie.name.startsWith('sb-')) {
      response.cookies.set(cookie.name, '', { path: '/', maxAge: 0 });
    }
  }
}

function hasSessionMaterial(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) return true;
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token'));
}

function hasMalformedSessionCookie(request: NextRequest) {
  if (request.headers.get('authorization')?.startsWith('Bearer ')) return false;
  const authCookie = request.cookies
    .getAll()
    .filter((cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cookie) => cookie.value)
    .join('');

  if (!authCookie) return false;
  return !/^(?:base64-|\{|\[|%7B|%5B)/i.test(authCookie);
}

function isInvalidSessionError(error: SessionPolicyError | null) {
  if (!error) return false;
  if (typeof error.status === 'number' && error.status >= 500) return false;
  if (error.code && INVALID_SESSION_ERROR_CODES.has(error.code)) return true;
  const message = error.message?.toLowerCase() || '';
  return (
    error.status === 401 ||
    message.includes('invalid refresh token') ||
    message.includes('refresh token not found') ||
    message.includes('jwt expired') ||
    message.includes('invalid jwt')
  );
}

function waitForSessionPolicyRetry() {
  return new Promise<void>((resolve) => setTimeout(resolve, SESSION_POLICY_RETRY_DELAY_MS));
}

function unauthenticatedResponse(
  request: NextRequest,
  response: NextResponse,
  isApiRequest: boolean,
  isPublicPage: boolean
) {
  clearSessionCookies(request, response);
  if (request.nextUrl.pathname === SESSION_PROBE_PATH) {
    const probeResponse = NextResponse.json(
      { ready: false },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
    );
    for (const cookie of response.cookies.getAll()) probeResponse.cookies.set(cookie);
    return probeResponse;
  }
  if (isApiRequest) {
    const denied = NextResponse.json(
      { error: 'SESSION_INVALID', message: 'La sesión no es válida.' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
    );
    for (const cookie of response.cookies.getAll()) denied.cookies.set(cookie);
    return denied;
  }
  if (isPublicPage) return response;
  const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
  for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
  return redirectResponse;
}

function readySessionProbeResponse(response: NextResponse) {
  const probeResponse = NextResponse.json(
    { ready: true },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
  for (const cookie of response.cookies.getAll()) probeResponse.cookies.set(cookie);
  return probeResponse;
}

type MiddlewareTiming = {
  claimsMs?: number;
  sessionPolicyMs?: number;
};

type SessionObservation = {
  route: string;
  correlationId: string;
  upstreamRequestIds: string[];
  upstreamStatuses: number[];
  service: ObservedService;
  outcome?: ObservedOutcome;
  code?: string | null;
};

function withMiddlewareTiming(
  response: NextResponse,
  startedAt: number,
  timing: MiddlewareTiming = {},
  observation?: SessionObservation
) {
  const duration = performance.now() - startedAt;
  const serverTiming = [`middleware;dur=${duration.toFixed(1)}`];
  if (typeof timing.claimsMs === 'number') {
    serverTiming.push(`auth_claims;dur=${timing.claimsMs.toFixed(1)}`);
  }
  if (typeof timing.sessionPolicyMs === 'number') {
    serverTiming.push(`session_policy;dur=${timing.sessionPolicyMs.toFixed(1)}`);
  }
  response.headers.set('Server-Timing', serverTiming.join(', '));
  if (observation) {
    response.headers.set('X-Docubox-Correlation-Id', observation.correlationId);
    if (observation.outcome || duration >= 3_000) {
      emitObservedEvent({
        service: observation.service,
        outcome: observation.outcome || 'slow',
        route: observation.route,
        status: observation.outcome === 'invalid' ? undefined : response.status,
        durationMs: duration,
        claimsMs: timing.claimsMs,
        policyMs: timing.sessionPolicyMs,
        code: observation.code,
        correlationId: observation.correlationId,
        upstreamRequestIds: observation.upstreamRequestIds,
        upstreamStatuses: observation.upstreamStatuses,
      });
    }
  } else if (duration >= 3_000) {
    console.warn('[performance] Slow middleware request', {
      middleware_ms: Math.round(duration),
      auth_claims_ms: timing.claimsMs === undefined ? undefined : Math.round(timing.claimsMs),
      session_policy_ms:
        timing.sessionPolicyMs === undefined ? undefined : Math.round(timing.sessionPolicyMs),
      status: response.status,
    });
  }
  return response;
}

function expiredSessionResponse(
  request: NextRequest,
  response: NextResponse,
  isApiRequest: boolean
) {
  const expiredResponse = isApiRequest
    ? NextResponse.json(
        {
          error: 'SESSION_EXPIRED',
          message: 'La sesión expiró por inactividad o por su límite máximo.',
        },
        { status: 401 }
      )
    : NextResponse.redirect(new URL('/login?reason=session-expired', request.url));

  for (const cookie of response.cookies.getAll()) {
    expiredResponse.cookies.set(cookie);
  }
  clearSessionCookies(request, expiredResponse);
  return expiredResponse;
}

function unavailableSessionPolicyResponse(
  request: NextRequest,
  response: NextResponse,
  isApiRequest: boolean
) {
  if (isApiRequest) {
    const unavailableResponse = NextResponse.json(
      {
        error: 'SESSION_POLICY_UNAVAILABLE',
        message: 'No fue posible validar la sesión. Inténtalo de nuevo.',
      },
      { status: 503, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '15' } }
    );
    for (const cookie of response.cookies.getAll()) unavailableResponse.cookies.set(cookie);
    return unavailableResponse;
  }

  const unavailableResponse = new NextResponse(
    `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Conectando con Docubox</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #f5f7fa; color: #172033; font-family: Arial, sans-serif; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      section { width: min(100%, 440px); padding: 30px; border: 1px solid #dbe3ee; border-radius: 12px; background: #fff; box-shadow: 0 12px 32px rgba(15, 23, 42, .06); }
      .brand { display: block; width: 144px; height: auto; margin-bottom: 30px; }
      .spinner { width: 28px; height: 28px; margin-bottom: 18px; border: 3px solid #dbeafe; border-top-color: #246bfd; border-radius: 50%; animation: spin .8s linear infinite; }
      h1 { margin: 0; font-size: 20px; line-height: 1.35; font-weight: 600; }
      p { margin: 10px 0 0; color: #64748b; font-size: 14px; line-height: 1.55; }
      button { display: inline-flex; min-height: 40px; align-items: center; margin-top: 22px; padding: 0 16px; border: 1px solid #cdddfc; border-radius: 8px; background: #fff; color: #246bfd; font: inherit; font-size: 14px; cursor: pointer; }
      button:hover:not(:disabled) { background: #f1f6ff; }
      button:disabled { cursor: progress; opacity: .65; }
      [hidden] { display: none !important; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
    </style>
  </head>
  <body>
    <main>
      <section>
        <img class="brand" src="/assets/images/docubox-logo-2026.png" alt="Docubox" width="144" height="28">
        <div class="spinner" aria-hidden="true"></div>
        <h1>Preparando tu espacio</h1>
        <p id="connection-status" role="status" aria-live="polite">Estamos verificando tu sesión de forma automática.</p>
        <button id="retry-now" type="button" hidden>Reintentar ahora</button>
        <noscript><p>Activa JavaScript para continuar o vuelve a cargar esta página.</p></noscript>
      </section>
    </main>
    <script>
      (function () {
        var status = document.getElementById('connection-status');
        var button = document.getElementById('retry-now');
        var timer;
        var checking = false;
        var failures = 0;
        var startedAt = Date.now();

        function scheduleRetry() {
          if (failures >= 5) {
            button.hidden = false;
            status.textContent = 'La conexión sigue sin responder. Puedes reintentar cuando vuelva el servicio.';
            return;
          }
          var delays = [3000, 7000, 15000, 30000];
          var delay = delays[Math.min(failures - 1, delays.length - 1)];
          timer = window.setTimeout(checkSession, delay + Math.floor(Math.random() * 1500));
          if (Date.now() - startedAt >= 15000) {
            button.hidden = false;
            status.textContent = 'La conexión está tardando más de lo habitual. Seguimos intentando.';
          } else {
            status.textContent = 'Estamos verificando tu sesión de forma automática.';
          }
        }

        async function checkSession() {
          if (checking) return;
          window.clearTimeout(timer);
          checking = true;
          button.disabled = true;
          button.textContent = 'Comprobando...';
          status.textContent = 'Comprobando la conexión...';
          var controller = new AbortController();
          var timeout = window.setTimeout(function () { controller.abort(); }, 25000);
          try {
            var response = await fetch('/api/auth/session-probe', {
              method: 'GET',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { Accept: 'application/json' },
              signal: controller.signal
            });
            if (response.status === 200) {
              window.location.replace(window.location.href);
              return;
            }
            if (response.status === 401) {
              window.location.replace('/login?reason=session-expired');
              return;
            }
          } catch (_) {
            // The next attempt runs without replacing this page.
          } finally {
            window.clearTimeout(timeout);
            checking = false;
            button.disabled = false;
            button.textContent = 'Reintentar ahora';
          }
          failures += 1;
          scheduleRetry();
        }

        button.addEventListener('click', checkSession);
        window.addEventListener('online', checkSession);
        window.setTimeout(function () { button.hidden = false; }, 15000);
        checkSession();
      })();
    </script>
  </body>
</html>`,
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'Retry-After': '15',
      },
    }
  );
  for (const cookie of response.cookies.getAll()) {
    unavailableResponse.cookies.set(cookie);
  }
  if (request.cookies.has(SESSION_RETRY_COOKIE_NAME)) {
    unavailableResponse.cookies.set(SESSION_RETRY_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  }
  return unavailableResponse;
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const correlationId = crypto.randomUUID();
  const startedAt = performance.now();
  const controller = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<NextResponse>((resolve) => {
    deadlineTimer = setTimeout(() => {
      controller.abort();
      const response = unavailableSessionPolicyResponse(
        request,
        NextResponse.next(),
        request.nextUrl.pathname.startsWith('/api/')
      );
      response.headers.set('X-Docubox-Correlation-Id', correlationId);
      emitObservedEvent({
        service: 'session_policy',
        outcome: 'unavailable',
        route: request.nextUrl.pathname,
        status: 503,
        durationMs: performance.now() - startedAt,
        code: 'MIDDLEWARE_DEADLINE',
        correlationId,
      });
      resolve(response);
    }, MIDDLEWARE_DEADLINE_MS);
  });
  try {
    return await Promise.race([
      handleMiddlewareRequest(request, event, controller.signal, correlationId),
      deadline,
    ]);
  } finally {
    clearTimeout(deadlineTimer);
  }
}

async function handleMiddlewareRequest(
  request: NextRequest,
  event: NextFetchEvent,
  requestSignal: AbortSignal,
  correlationId: string
) {
  const startedAt = performance.now();
  const { pathname } = request.nextUrl;
  const upstreamRequestIds: string[] = [];
  const upstreamStatuses: number[] = [];
  const observe = (
    service: ObservedService,
    outcome?: ObservedOutcome,
    code?: string | null
  ): SessionObservation => ({
    route: pathname,
    correlationId,
    upstreamRequestIds,
    upstreamStatuses,
    service,
    outcome,
    code,
  });
  const kioskResponse = await enforceKioskScope(request);
  if (kioskResponse) return withMiddlewareTiming(kioskResponse, startedAt);

  const isLegacyAdminPath =
    (pathname === '/admin' || pathname.startsWith('/admin/')) &&
    !pathname.startsWith('/admin/security/crypto-e2e');
  if (isLegacyAdminPath || pathname === '/superadmin' || pathname.startsWith('/superadmin/')) {
    const panelUrl = request.nextUrl.clone();
    const legacyPrefix = pathname.startsWith('/superadmin') ? '/superadmin' : '/admin';
    panelUrl.pathname = `/panel${pathname.slice(legacyPrefix.length)}`;
    return withMiddlewareTiming(NextResponse.redirect(panelUrl, 307), startedAt);
  }

  if (pathname === '/auth/totp-verification') {
    const verificationUrl = request.nextUrl.clone();
    verificationUrl.pathname = '/login/totp-verification';
    return withMiddlewareTiming(NextResponse.redirect(verificationUrl, 308), startedAt);
  }

  if (pathname === '/sign-up-login-screen' || pathname === '/auth') {
    const authUrl = request.nextUrl.clone();
    authUrl.pathname = '/login';
    return withMiddlewareTiming(NextResponse.redirect(authUrl, 308), startedAt);
  }

  if (pathname === '/documents-dashboard') {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/inicio';
    return withMiddlewareTiming(NextResponse.redirect(homeUrl, 308), startedAt);
  }

  if (pathname === '/participation-requests') {
    const requestsUrl = request.nextUrl.clone();
    requestsUrl.pathname = '/mis-solicitudes';
    return withMiddlewareTiming(NextResponse.redirect(requestsUrl, 308), startedAt);
  }

  if (
    pathname === '/pending-tasks' ||
    pathname === '/mis-tareas' ||
    pathname.startsWith('/mis-tareas/')
  ) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/inicio';
    homeUrl.search = '';
    return withMiddlewareTiming(NextResponse.redirect(homeUrl, 308), startedAt);
  }

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return withMiddlewareTiming(NextResponse.next(), startedAt);
  }

  const isApiRequest = pathname.startsWith('/api/');
  const isSessionProbe = pathname === SESSION_PROBE_PATH;
  const isPublicPage = PUBLIC_ROUTES.includes(pathname);
  if (isPublicPage) return withMiddlewareTiming(NextResponse.next(), startedAt);
  if (isApiRequest && SESSION_POLICY_BOOTSTRAP_API_ROUTES.has(pathname)) {
    return withMiddlewareTiming(NextResponse.next(), startedAt);
  }

  let response = NextResponse.next({ request });
  if (!hasSessionMaterial(request)) {
    if (isSessionProbe) {
      return withMiddlewareTiming(
        unauthenticatedResponse(request, response, true, false),
        startedAt
      );
    }
    const result =
      isApiRequest || isPublicPage
        ? response
        : NextResponse.redirect(new URL('/login', request.url));
    return withMiddlewareTiming(result, startedAt);
  }

  if (hasMalformedSessionCookie(request)) {
    return withMiddlewareTiming(
      unauthenticatedResponse(request, response, isApiRequest, isPublicPage),
      startedAt,
      {},
      observe('auth', 'invalid', 'INVALID_SESSION')
    );
  }

  const authorization = request.headers.get('authorization');
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: (input, init) =>
          fetchWithSessionValidationTimeout(input, init, requestSignal, (upstream) => {
            if (upstreamStatuses.length < 4) upstreamStatuses.push(upstream.status);
            const id =
              upstream.headers.get('x-request-id') ||
              upstream.headers.get('sb-request-id') ||
              upstream.headers.get('cf-ray');
            if (id && upstreamRequestIds.length < 4) upstreamRequestIds.push(id);
          }),
        ...(authorization ? { headers: { authorization } } : {}),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          // Forward the refreshed cookies to the current server render as well
          // as the browser. Reusing the response made before the refresh leaves
          // Server Components with the stale request cookies.
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const accessToken = authorization?.replace(/^Bearer\s+/i, '');
  let claimsData: unknown = null;
  let claimsError: SessionPolicyError | null = null;
  const claimsStartedAt = performance.now();
  try {
    const result = await supabase.auth.getClaims(accessToken);
    claimsData = result.data;
    claimsError = result.error;
  } catch (error) {
    claimsError = normalizeSessionPolicyError(error);
  }
  const claimsMs = performance.now() - claimsStartedAt;

  if (claimsError) {
    if (isInvalidSessionError(claimsError)) {
      return withMiddlewareTiming(
        unauthenticatedResponse(request, response, isApiRequest, isPublicPage),
        startedAt,
        { claimsMs },
        observe('auth', 'invalid', claimsError.code || claimsError.name)
      );
    }
    return withMiddlewareTiming(
      unavailableSessionPolicyResponse(request, response, isApiRequest),
      startedAt,
      { claimsMs },
      observe('auth', 'unavailable', claimsError.code || claimsError.name)
    );
  }

  if (!claimsData || !getSessionIdFromClaims(claimsData)) {
    return withMiddlewareTiming(
      unavailableSessionPolicyResponse(request, response, isApiRequest),
      startedAt,
      { claimsMs },
      observe('auth', 'unavailable', 'MISSING_SESSION_CLAIMS')
    );
  }

  let policyData: unknown = null;
  let policyError: SessionPolicyError | null = null;
  const sessionId = getSessionIdFromClaims(claimsData);
  const failureUntil = sessionId ? sessionPolicyFailureUntil.get(sessionId) : undefined;
  if (failureUntil && failureUntil > Date.now()) {
    return withMiddlewareTiming(
      unavailableSessionPolicyResponse(request, response, isApiRequest),
      startedAt,
      { claimsMs },
      observe('session_policy', 'unavailable')
    );
  }
  if (sessionId) sessionPolicyFailureUntil.delete(sessionId);
  const sessionPolicyStartedAt = performance.now();
  try {
    const validatePolicy = async (): Promise<SessionPolicyValidationResult> => {
      const firstAttemptAt = performance.now();
      let result = await supabase.rpc('enforce_docubox_session_policy', {
        p_record_user_activity: false,
      });
      if (
        !requestSignal.aborted &&
        result.error?.code === 'PGRST002' &&
        performance.now() - firstAttemptAt < 1_000
      ) {
        // Only a fast schema-cache miss gets one retry. Slow gateway failures
        // remain fail-closed and must not multiply load on an impaired backend.
        await waitForSessionPolicyRetry();
        if (!requestSignal.aborted) {
          result = await supabase.rpc('enforce_docubox_session_policy', {
            p_record_user_activity: false,
          });
        }
      }
      return { data: result.data, error: result.error };
    };

    let validation = sessionId ? inFlightSessionPolicyValidations.get(sessionId) : undefined;
    if (!validation) {
      validation = validatePolicy();
      if (sessionId) {
        inFlightSessionPolicyValidations.set(sessionId, validation);
        const clearValidation = () => {
          if (inFlightSessionPolicyValidations.get(sessionId) === validation) {
            inFlightSessionPolicyValidations.delete(sessionId);
          }
        };
        void validation.then(clearValidation, clearValidation);
      }
    }

    const result = await validation;
    policyData = result.data;
    policyError = result.error;
  } catch (error) {
    policyError = normalizeSessionPolicyError(error);
  }
  const sessionPolicyMs = performance.now() - sessionPolicyStartedAt;
  const policy = getPolicyRow(policyData);

  if (policyError) {
    if (isInvalidSessionError(policyError)) {
      return withMiddlewareTiming(
        unauthenticatedResponse(request, response, isApiRequest, isPublicPage),
        startedAt,
        { claimsMs, sessionPolicyMs },
        observe('session_policy', 'invalid', policyError.code || policyError.name)
      );
    }
    if (sessionId) {
      if (sessionPolicyFailureUntil.size >= 1_000) sessionPolicyFailureUntil.clear();
      sessionPolicyFailureUntil.set(sessionId, Date.now() + SESSION_POLICY_FAILURE_BACKOFF_MS);
    }
    return withMiddlewareTiming(
      unavailableSessionPolicyResponse(request, response, isApiRequest),
      startedAt,
      { claimsMs, sessionPolicyMs },
      observe('session_policy', 'unavailable', policyError.code || policyError.name)
    );
  }

  // Fail closed: server-side session validation is mandatory for authenticated traffic.
  if (policy?.active !== true) {
    const reason = typeof policy?.reason === 'string' ? policy.reason : null;
    if (reason === 'POLICY_BUSY') {
      return withMiddlewareTiming(
        unavailableSessionPolicyResponse(request, response, isApiRequest),
        startedAt,
        { claimsMs, sessionPolicyMs },
        observe('session_policy', 'unavailable', reason)
      );
    }
    if (
      reason === 'UNAUTHENTICATED' ||
      reason === 'INVALID_SESSION' ||
      reason === 'SESSION_NOT_FOUND'
    ) {
      return withMiddlewareTiming(
        unauthenticatedResponse(request, response, isApiRequest, isPublicPage),
        startedAt,
        { claimsMs, sessionPolicyMs },
        observe('session_policy', 'invalid', reason)
      );
    }
    if (reason !== 'ABSOLUTE_TIMEOUT' && reason !== 'INACTIVITY_TIMEOUT') {
      return withMiddlewareTiming(
        unavailableSessionPolicyResponse(request, response, isApiRequest),
        startedAt,
        { claimsMs, sessionPolicyMs },
        observe('session_policy', 'unavailable', reason || 'MALFORMED_POLICY_RESPONSE')
      );
    }
    event.waitUntil(
      supabase.auth
        .signOut({ scope: 'local' })
        .then(() => undefined)
        .catch((error) => {
          console.warn('[session-policy] Background sign-out failed', {
            code: error instanceof Error ? error.name : 'UNKNOWN',
          });
        })
    );
    return withMiddlewareTiming(
      expiredSessionResponse(request, response, isApiRequest),
      startedAt,
      {
        claimsMs,
        sessionPolicyMs,
      },
      observe('session_policy', 'expired', reason)
    );
  }

  response.headers.set('Cache-Control', 'private, no-store');
  if (request.cookies.has(SESSION_RETRY_COOKIE_NAME)) {
    response.cookies.set(SESSION_RETRY_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  }
  if (isSessionProbe) {
    return withMiddlewareTiming(
      readySessionProbeResponse(response),
      startedAt,
      {
        claimsMs,
        sessionPolicyMs,
      },
      observe('session_policy')
    );
  }
  return withMiddlewareTiming(
    response,
    startedAt,
    { claimsMs, sessionPolicyMs },
    observe('session_policy')
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)'],
};
