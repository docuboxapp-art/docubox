import { NextRequest, NextResponse } from 'next/server';

/**
 * Sets the httpOnly cookie `docubox_session_start` with the current timestamp.
 * Called client-side after a successful login (SIGNED_IN event in AuthContext).
 * The middleware reads this cookie to enforce the 10-hour absolute session limit.
 */
export async function POST(_req: NextRequest) {
  const response = NextResponse.json({ success: true });

  const nowSeconds = Math.floor(Date.now() / 1000).toString();

  response.cookies.set('docubox_session_start', nowSeconds, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // 10 hours + 5 min buffer so the cookie outlives the absolute limit
    maxAge: 10 * 60 * 60 + 300,
  });

  return response;
}
