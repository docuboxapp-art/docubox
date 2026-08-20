import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireApiUser } from '@/lib/certification/auth';
import { createCertification, getCertificationSummary } from '@/lib/certification/engine';
import { CertificationError } from '@/lib/certification/types';
import { getCryptographicProviderStatus } from '@/lib/certification/adapters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  const failure = error instanceof CertificationError
    ? error
    : new CertificationError('CERTIFICATION_API_ERROR', error instanceof Error ? error.message : 'Error inesperado.', 500);
  return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.httpStatus });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { documentId } = await params;
    const certification = await getCertificationSummary(createServiceClient(), documentId, user.id);
    return NextResponse.json(
      { certification, providerStatus: getCryptographicProviderStatus() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { documentId } = await params;
    const idempotencyKey = request.headers.get('idempotency-key') || crypto.randomUUID();
    if (idempotencyKey.length > 160) throw new CertificationError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key no es valido.', 400);
    const body = await request.json().catch(() => ({})) as { documentVersionId?: unknown };
    const documentVersionId = typeof body.documentVersionId === 'string' && body.documentVersionId.trim()
      ? body.documentVersionId.trim()
      : null;
    const certification = await createCertification(
      createServiceClient(),
      documentId,
      user.id,
      idempotencyKey,
      documentVersionId,
    );
    return NextResponse.json({ certification }, { status: certification.status === 'COMPLETED' ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
