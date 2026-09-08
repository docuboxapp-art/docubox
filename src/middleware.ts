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
  '/v/',
  '/verify/promissory-note/',
  '/verify/blockchain/',
];

// This endpoint runs immediately after sign-in and validates the freshly issued
// Bearer token itself before the browser has completed its session handoff.
const SESSION_POLICY_BOOTSTRAP_API_ROUTES = new Set(['/api/auth/totp/check']);

type SessionPolicyRow = { active?: unknown; reason?: unknown };
type SessionPolicyError = { code?: string; message?: string; status?: number };

const INVALID_SESSION_ERROR_CODES = new Set(['refresh_token_not_found', 'bad_jwt', 'PGRST301']);

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
    (error.code === '42501' &&
      message.includes('permission denied for function enforce_docubox_session_policy')) ||
    message.includes('invalid refresh token') ||
    message.includes('refresh token not found') ||
    message.includes('jwt expired') ||
    message.includes('invalid jwt')
  );
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

function withMiddlewareTiming(response: NextResponse, startedAt: number) {
  const duration = performance.now() - startedAt;
  response.headers.set('Server-Timing', `middleware;dur=${duration.toFixed(1)}`);
  if (duration >= 1_000) {
    console.warn('[performance] Slow middleware request', {
      middleware_ms: Math.round(duration),
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
    return NextResponse.json(
      {
        error: 'SESSION_POLICY_UNAVAILABLE',
        message: 'No fue posible validar la sesión. Inténtalo de nuevo.',
      },
      { status: 503 }
    );
  }

  const unavailableResponse = NextResponse.redirect(
    new URL('/login?reason=session-check-unavailable', request.url)
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
      global: authorization ? { headers: { authorization } } : undefined,
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

  let policyData: unknown = null;
  let policyError: SessionPolicyError | null = null;
  try {
    const result = await supabase.rpc('enforce_docubox_session_policy', {
      p_record_user_activity: false,
    });
    policyData = result.data;
    policyError = result.error;
  } catch (error) {
    policyError = error instanceof Error ? { message: error.message } : { message: String(error) };
  }
  const policy = getPolicyRow(policyData);

  if (policyError) {
    if (isInvalidSessionError(policyError)) {
      return withMiddlewareTiming(
        unauthenticatedResponse(request, response, isApiRequest, isPublicPage),
        startedAt
      );
    }
    console.error('[session-policy] Middleware validation unavailable', {
      policyErrorCode: policyError.code,
      policyErrorMessage: policyError.message,
    });
    return withMiddlewareTiming(
      unavailableSessionPolicyResponse(request, response, isApiRequest),
      startedAt
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
        startedAt
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
    return withMiddlewareTiming(expiredSessionResponse(request, response, isApiRequest), startedAt);
  }

  response.headers.set('Cache-Control', 'private, no-store');
  return withMiddlewareTiming(response, startedAt);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)'],
};
