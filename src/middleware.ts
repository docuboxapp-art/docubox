import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
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
];

// This endpoint runs immediately after sign-in and validates the freshly issued
// Bearer token itself before the browser has completed its session handoff.
const SESSION_POLICY_BOOTSTRAP_API_ROUTES = new Set(['/api/auth/totp/check']);

type SessionPolicyRow = { active?: unknown };

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

function expiredSessionResponse(request: NextRequest, response: NextResponse, isApiRequest: boolean) {
  const expiredResponse = isApiRequest
    ? NextResponse.json(
        { error: 'SESSION_EXPIRED', message: 'La sesión expiró por inactividad o por su límite máximo.' },
        { status: 401 }
      )
    : NextResponse.redirect(new URL('/login?reason=session-expired', request.url));

  for (const cookie of response.cookies.getAll()) {
    expiredResponse.cookies.set(cookie);
  }
  clearSessionCookies(request, expiredResponse);
  return expiredResponse;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isLegacyAdminPath =
    (pathname === '/admin' || pathname.startsWith('/admin/')) &&
    !pathname.startsWith('/admin/security/crypto-e2e');
  if (isLegacyAdminPath || pathname === '/superadmin' || pathname.startsWith('/superadmin/')) {
    const panelUrl = request.nextUrl.clone();
    const legacyPrefix = pathname.startsWith('/superadmin') ? '/superadmin' : '/admin';
    panelUrl.pathname = `/panel${pathname.slice(legacyPrefix.length)}`;
    return NextResponse.redirect(panelUrl, 307);
  }

  if (pathname === '/auth/totp-verification') {
    const verificationUrl = request.nextUrl.clone();
    verificationUrl.pathname = '/login/totp-verification';
    return NextResponse.redirect(verificationUrl, 308);
  }

  if (pathname === '/sign-up-login-screen' || pathname === '/auth') {
    const authUrl = request.nextUrl.clone();
    authUrl.pathname = '/login';
    return NextResponse.redirect(authUrl, 308);
  }

  if (pathname === '/documents-dashboard') {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/inicio';
    return NextResponse.redirect(homeUrl, 308);
  }

  if (pathname === '/participation-requests') {
    const requestsUrl = request.nextUrl.clone();
    requestsUrl.pathname = '/mis-solicitudes';
    return NextResponse.redirect(requestsUrl, 308);
  }

  if (pathname === '/pending-tasks') {
    const tasksUrl = request.nextUrl.clone();
    tasksUrl.pathname = '/mis-tareas';
    return NextResponse.redirect(tasksUrl, 308);
  }

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const isApiRequest = pathname.startsWith('/api/');
  const isPublicPage = PUBLIC_ROUTES.includes(pathname);
  if (isApiRequest && SESSION_POLICY_BOOTSTRAP_API_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request: { headers: request.headers } });
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (isApiRequest || isPublicPage) return response;
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { data: policyData, error: policyError } = await supabase.rpc(
    'enforce_docubox_session_policy',
    { p_record_user_activity: false }
  );
  const policy = getPolicyRow(policyData);

  // Fail closed: server-side session validation is mandatory for authenticated traffic.
  if (policyError || policy?.active !== true) {
    await supabase.auth.signOut();
    return expiredSessionResponse(request, response, isApiRequest);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)'],
};
