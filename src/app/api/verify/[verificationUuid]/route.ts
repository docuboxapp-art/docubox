import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getPublicCertification } from '@/lib/certification/engine';
import { CertificationError } from '@/lib/certification/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const attempts = new Map<string, { count: number; expiresAt: number }>();

export async function GET(request: NextRequest, { params }: { params: Promise<{ verificationUuid: string }> }) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = `${forwarded}:${new Date().toISOString().slice(0, 16)}`;
  const current = attempts.get(key) || { count: 0, expiresAt: Date.now() + 60_000 };
  current.count += 1;
  attempts.set(key, current);
  if (current.count > 30) return NextResponse.json({ error: 'Demasiadas consultas.' }, { status: 429 });

  try {
    const { verificationUuid } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(verificationUuid)) throw new CertificationError('CERTIFICATION_NOT_FOUND', 'Certificacion no encontrada.', 404);
    const result = await getPublicCertification(createServiceClient(), verificationUuid);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  } catch (error) {
    const failure = error instanceof CertificationError ? error : new CertificationError('VERIFY_FAILED', 'No fue posible verificar la certificacion.', 500);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.httpStatus });
  }
}

