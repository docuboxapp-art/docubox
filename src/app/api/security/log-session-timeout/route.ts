import { NextResponse } from 'next/server';

// Timeout events are written only by the server-side session policy RPC.
export async function POST() {
  return NextResponse.json(
    { error: 'SESSION_POLICY_REPLACED', message: 'El evento se registra automáticamente.' },
    { status: 410 }
  );
}
