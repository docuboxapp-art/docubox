import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CertificationOrchestrator } from '@/lib/certification/orchestrator';
import { createServiceClient } from '@/lib/supabase/server';
import { CertificationError } from '@/lib/certification/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  documentId: z.string().uuid(),
  actorId: z.string().uuid(),
  documentVersionId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().min(1).max(160),
  operation: z.enum(['execute', 'retry']).default('execute'),
});

function hasInternalCredential(request: NextRequest) {
  const configured = process.env.DOCUBOX_INTERNAL_CERTIFICATION_TOKEN;
  const received = request.headers.get('x-docubox-internal-token');
  if (!configured || !received) return false;
  const expectedBytes = Buffer.from(configured);
  const actualBytes = Buffer.from(received);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function errorResponse(error: unknown) {
  const failure = error instanceof CertificationError
    ? error
    : new CertificationError('CERTIFICATION_INTERNAL_API_ERROR', 'No fue posible procesar la certificacion.', 500);
  return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.httpStatus });
}

/** Backend-to-backend endpoint. Never accepts provider keys, certificates or timestamps from callers. */
export async function POST(request: NextRequest) {
  try {
    if (!hasInternalCredential(request)) {
      throw new CertificationError('INTERNAL_AUTH_REQUIRED', 'Operacion interna no autorizada.', 401);
    }
    const payload = requestSchema.parse(await request.json());
    const orchestrator = new CertificationOrchestrator(createServiceClient());
    const certification = payload.operation === 'retry'
      ? await orchestrator.retry(payload)
      : await orchestrator.execute(payload);
    return NextResponse.json({ certification }, { status: certification.status === 'COMPLETED' ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!hasInternalCredential(request)) {
      throw new CertificationError('INTERNAL_AUTH_REQUIRED', 'Operacion interna no autorizada.', 401);
    }
    const documentId = request.nextUrl.searchParams.get('documentId') || '';
    const actorId = request.nextUrl.searchParams.get('actorId') || '';
    const parsed = z.object({ documentId: z.string().uuid(), actorId: z.string().uuid() }).parse({ documentId, actorId });
    const certification = await new CertificationOrchestrator(createServiceClient()).getStatus(parsed.documentId, parsed.actorId);
    return NextResponse.json({ certification }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
