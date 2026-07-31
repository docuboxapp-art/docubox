import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  '/sign-up-login-screen',
  '/registro',
  '/olvide-contrasena',
  '/verificar-correo',
  '/auth/totp-verification',
  '/register-device',
];

// Route prefixes that are always public (API, static, etc.)
const PUBLIC_PREFIXES = [
  '/api/',
  '/_next/',
  '/favicon',
  '/assets/',
  '/enrolamiento/',
  '/subir-movil/',
  '/captura-id-movil/',
];

// Absolute session limit: 10 hours in seconds
const ABSOLUTE_SESSION_LIMIT_SECONDS = 10 * 60 * 60;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public prefixes (API routes, static files, enrollment, mobile upload)
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // Allow exact public routes
  if (PUBLIC_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  // For all other routes, check authentication
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    const loginUrl = new URL('/sign-up-login-screen', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // ── Absolute session limit check (10 hours) ──────────────────────────────
  const sessionStartCookie = request.cookies.get('docubox_session_start')?.value;

  if (sessionStartCookie) {
    const sessionStartSeconds = parseInt(sessionStartCookie, 10);
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (
      !isNaN(sessionStartSeconds) &&
      nowSeconds - sessionStartSeconds > ABSOLUTE_SESSION_LIMIT_SECONDS
    ) {
      // Log the absolute timeout event asynchronously (fire-and-forget)
      // We use the internal API route so we don't block the redirect
      const logUrl = new URL('/api/security/log-session-timeout', request.url);
      fetch(logUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          eventType: 'session_timeout_absolute',
          userAgent: request.headers.get('user-agent') || 'unknown',
        }),
      }).catch(() => {/* non-blocking */});

      // Sign out via Supabase (invalidate server session)
      await supabase.auth.signOut();

      // Build redirect response and clear the session-start cookie
      const loginUrl = new URL('/sign-up-login-screen', request.url);
      const redirectResponse = NextResponse.redirect(loginUrl);
      redirectResponse.cookies.delete('docubox_session_start');
      return redirectResponse;
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|assets/).*)',
  ],
};
