import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getPublicCertification } from '@/lib/certification/engine';
import { CertificationError } from '@/lib/certification/types';
import { enforcePublicRateLimit } from '@/lib/public-verification/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ verificationUuid: string }> }
) {
  try {
    if (!(await enforcePublicRateLimit(request, 'certification', 30))) {
      return NextResponse.json({ error: 'Demasiadas consultas.' }, { status: 429 });
    }
  } catch {
    return NextResponse.json(
      { error: 'El servicio de verificacion no esta disponible temporalmente.' },
      { status: 503 }
    );
  }

  try {
    const { verificationUuid } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(verificationUuid))
      throw new CertificationError('CERTIFICATION_NOT_FOUND', 'Certificacion no encontrada.', 404);
    const result = await getPublicCertification(createServiceClient(), verificationUuid);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  } catch (error) {
    const failure =
      error instanceof CertificationError
        ? error
        : new CertificationError(
            'VERIFY_FAILED',
            'No fue posible verificar la certificacion.',
            500
          );
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.httpStatus }
    );
  }
}
