import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runKeyManagementHealthCheck } from '@/lib/certification/key-management-health';
import { createServiceClient } from '@/lib/supabase/server';
import { CertificationError } from '@/lib/certification/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({ tenantId: z.string().uuid() });

function authorized(request: NextRequest) {
  const expected = process.env.DOCUBOX_INTERNAL_CERTIFICATION_TOKEN;
  const received = request.headers.get('x-docubox-internal-token');
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  try {
    if (!authorized(request)) throw new CertificationError('INTERNAL_AUTH_REQUIRED', 'Operacion interna no autorizada.', 401);
    const { tenantId } = requestSchema.parse(await request.json());
    const result = await runKeyManagementHealthCheck(createServiceClient(), tenantId);
    return NextResponse.json({ result }, { status: result.ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const failure = error instanceof CertificationError
      ? error
      : new CertificationError('CRYPTO_PROVIDER_HEALTH_ERROR', 'No fue posible probar el proveedor de llaves.', 500);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.httpStatus });
  }
}
