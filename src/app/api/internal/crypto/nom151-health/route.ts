import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createNom151Provider } from '@/lib/nom151/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest) {
  const expected = process.env.DOCUBOX_INTERNAL_CERTIFICATION_TOKEN;
  const received = request.headers.get('x-docubox-internal-token');
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: 'Operacion interna no autorizada.', code: 'INTERNAL_AUTH_REQUIRED' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  try {
    const health = await createNom151Provider().healthCheck();
    return NextResponse.json(
      { health },
      {
        status: health.ready ? 200 : 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch {
    return NextResponse.json(
      { error: 'No fue posible evaluar el proveedor NOM-151.', code: 'NOM151_HEALTH_FAILED' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
