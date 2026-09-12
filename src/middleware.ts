import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_ROUTES = [
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
  '/portal-participante/',
  '/registro-participante/',
  '/form/',
  '/expediente/',
  '/sala/',
  '/solicitud/',
  '/notificacion/',
  '/verificar-documento/',
  '/verificar-certificacion/',
  '/verificar-evidencia/',
  '/api/public/v2/verifications/',
  '/v/',
  '/verify/promissory-note/',
  '/verify/blockchain/',
];

// This endpoint runs immediately after sign-in and validates the freshly issued
// Bearer token itself before the browser has completed its session handoff.
const SESSION_POLICY_BOOTSTRAP_API_ROUTES = new Set(['/api/auth/totp/check']);

type SessionPolicyRow = { active?: unknown; reason?: unknown };
type SessionPolicyError = { code?: string; message?: string; name?: string; status?: number };

const INVALID_SESSION_ERROR_CODES = new Set(['refresh_token_not_found', 'bad_jwt', 'PGRST301']);
const TRANSIENT_SESSION_POLICY_ERROR_CODES = new Set(['PGRST002']);
const TRANSIENT_SESSION_HTTP_STATUSES = new Set([0, 502, 503, 504]);
const SESSION_POLICY_RETRY_DELAY_MS = 350;
const SESSION_VALIDATION_TIMEOUT_MS = 8_000;

function normalizeSessionPolicyError(error: unknown): SessionPolicyError {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const candidate = error as Record<string, unknown>;
  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    message:
      typeof candidate.message === 'string' ? candidate.message : String(candidate.message || error),
    name: typeof candidate.name === 'string' ? candidate.name : undefined,
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
  };
}

async function fetchWithSessionValidationTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener('abort', forwardAbort, { once: true });

  const timeout = setTimeout(() => controller.abort(), SESSION_VALIDATION_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', forwardAbort);
  }
}

function getPolicyRow(value: unknown): SessionPolicyRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? (row as SessionPolicyRow) : null;
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

function isTransientSessionPolicyError(error: SessionPolicyError | null) {
  if (!error) return false;
  if (error.code && TRANSIENT_SESSION_POLICY_ERROR_CODES.has(error.code)) return true;
  if (typeof error.status === 'number' && TRANSIENT_SESSION_HTTP_STATUSES.has(error.status)) {
    return true;
  }
  if (error.name === 'AuthRetryableFetchError') return true;
  const message = error.message?.toLowerCase() || '';
  return (
    message.includes('schema cache') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('aborted')
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
  if (isApiRequest || isPublicPage) return response;
  const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
  for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
  return redirectResponse;
}

type MiddlewareTiming = {
  claimsMs?: number;
  sessionPolicyMs?: number;
};

function withMiddlewareTiming(
  response: NextResponse,
  startedAt: number,
  timing: MiddlewareTiming = {}
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
  if (duration >= 1_000) {
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

function unavailableSessionPolicyResponse(response: NextResponse, isApiRequest: boolean) {
  if (isApiRequest) {
    return NextResponse.json(
      {
        error: 'SESSION_POLICY_UNAVAILABLE',
        message: 'No fue posible validar la sesión. Inténtalo de nuevo.',
      },
      { status: 503 }
    );
  }

  const unavailableResponse = new NextResponse(
    `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verificación temporalmente no disponible</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #f5f7fa; color: #111827; font-family: Arial, sans-serif; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      section { width: min(100%, 440px); padding: 28px; border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; box-shadow: 0 12px 32px rgba(15, 23, 42, .08); }
      h1 { margin: 0; font-size: 20px; line-height: 1.35; font-weight: 600; }
      p { margin: 10px 0 22px; color: #64748b; font-size: 14px; line-height: 1.55; }
      a { display: inline-flex; min-height: 40px; align-items: center; padding: 0 16px; border-radius: 8px; background: #246bfd; color: #fff; font-size: 14px; font-weight: 400; text-decoration: none; }
      a:hover { background: #1859dc; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>No fue posible verificar la sesión</h1>
        <p>Tu sesión continúa activa. La conexión tardó más de lo esperado. Intenta nuevamente.</p>
        <a href="">Reintentar</a>
      </section>
    </main>
  </body>
</html>`,
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'Retry-After': '5',
      },
    }
  );
  for (const cookie of response.cookies.getAll()) {
    unavailableResponse.cookies.set(cookie);
  }
  return unavailableResponse;
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const startedAt = performance.now();
  const { pathname } = request.nextUrl;

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

  if (pathname === '/pending-tasks') {
    const tasksUrl = request.nextUrl.clone();
    tasksUrl.pathname = '/mis-tareas';
    return withMiddlewareTiming(NextResponse.redirect(tasksUrl, 308), startedAt);
  }

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return withMiddlewareTiming(NextResponse.next(), startedAt);
  }

  const isApiRequest = pathname.startsWith('/api/');
  const isPublicPage = PUBLIC_ROUTES.includes(pathname);
  if (isApiRequest && SESSION_POLICY_BOOTSTRAP_API_ROUTES.has(pathname)) {
    return withMiddlewareTiming(NextResponse.next(), startedAt);
  }

  const response = NextResponse.next();
  if (!hasSessionMaterial(request)) {
    const result =
      isApiRequest || isPublicPage
        ? response
        : NextResponse.redirect(new URL('/login', request.url));
    return withMiddlewareTiming(result, startedAt);
  }

  if (hasMalformedSessionCookie(request)) {
    return withMiddlewareTiming(
      unauthenticatedResponse(request, response, isApiRequest, isPublicPage),
      startedAt
    );
  }

  const authorization = request.headers.get('authorization');
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: fetchWithSessionValidationTimeout,
        ...(authorization ? { headers: { authorization } } : {}),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const accessToken = authorization?.replace(/^Bearer\s+/i, '');
  let claimsError: SessionPolicyError | null = null;
  const claimsStartedAt = performance.now();
  try {
    let result = await supabase.auth.getClaims(accessToken);
    if (isTransientSessionPolicyError(result.error)) {
      await waitForSessionPolicyRetry();
      result = await supabase.auth.getClaims(accessToken);
    }
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
        { claimsMs }
      );
    }
    console.error('[session-policy] Middleware token validation unavailable', {
      policyErrorCode: claimsError.code,
      policyErrorMessage: claimsError.message,
      policyErrorName: claimsError.name,
      policyErrorStatus: claimsError.status,
    });
    return withMiddlewareTiming(
      unavailableSessionPolicyResponse(response, isApiRequest),
      startedAt,
      { claimsMs }
    );
  }

  let policyData: unknown = null;
  let policyError: SessionPolicyError | null = null;
  const sessionPolicyStartedAt = performance.now();
  try {
    let result = await supabase.rpc('enforce_docubox_session_policy', {
      p_record_user_activity: false,
    });
    if (isTransientSessionPolicyError(result.error)) {
      // PostgREST can briefly return PGRST002 while rebuilding its schema cache.
      // Retry once only; a persistent failure still blocks protected traffic.
      await waitForSessionPolicyRetry();
      result = await supabase.rpc('enforce_docubox_session_policy', {
        p_record_user_activity: false,
      });
    }
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
        { claimsMs, sessionPolicyMs }
      );
    }
    console.error('[session-policy] Middleware validation unavailable', {
      policyErrorCode: policyError.code,
      policyErrorMessage: policyError.message,
      policyErrorName: policyError.name,
      policyErrorStatus: policyError.status,
    });
    return withMiddlewareTiming(
      unavailableSessionPolicyResponse(response, isApiRequest),
      startedAt,
      { claimsMs, sessionPolicyMs }
    );
  }

  // Fail closed: server-side session validation is mandatory for authenticated traffic.
  if (policy?.active !== true) {
    const reason = typeof policy?.reason === 'string' ? policy.reason : null;
    if (
      reason === 'UNAUTHENTICATED' ||
      reason === 'INVALID_SESSION' ||
      reason === 'SESSION_NOT_FOUND'
    ) {
      return withMiddlewareTiming(
        unauthenticatedResponse(request, response, isApiRequest, isPublicPage),
        startedAt,
        { claimsMs, sessionPolicyMs }
      );
    }
    console.warn('[session-policy] Middleware sign-out requested', {
      policyReason: reason,
    });
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
      }
    );
  }

  response.headers.set('Cache-Control', 'private, no-store');
  return withMiddlewareTiming(response, startedAt, { claimsMs, sessionPolicyMs });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)'],
};
