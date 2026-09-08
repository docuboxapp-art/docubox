import { NextResponse } from 'next/server';

// Kept as a safe compatibility endpoint for older browser bundles.
// Session lifetime is now enforced from auth.sessions on the server.
export async function POST() {
  return NextResponse.json(
    { error: 'SESSION_POLICY_REPLACED', message: 'La sesión se administra automáticamente.' },
    { status: 410 }
  );
}
