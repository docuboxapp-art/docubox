import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { enforcePublicRateLimit, logVerificationRun } from '@/lib/public-verification/gateway';
import { verifyLocatedDocument } from '@/lib/public-verification/orchestrator';
import { findArtifactsByHash, normalizeSha256 } from '@/lib/public-verification/repository';

export async function POST(request: NextRequest) {
  if (!enforcePublicRateLimit(request, 'hash', 20)) return json({ error: 'Demasiadas consultas. Intenta mas tarde.' }, 429);
  const startedAt = Date.now();
  try {
    const body = await request.json();
    if (String(body.algorithm || 'SHA-256').toUpperCase() !== 'SHA-256') return json({ error: 'Por ahora solo se admite SHA-256.' }, 400);
    const hash = normalizeSha256(String(body.hash || ''));
    if (!hash) return json({ error: 'Ingresa una huella SHA-256 valida de 64 caracteres.' }, 400);

    const supabase = createServiceClient();
    const located = await findArtifactsByHash(supabase, hash);
    if (!located.document) return json({ error: 'No se encontro una coincidencia publica para esta huella.', status: 'NOT_FOUND' }, 404);
    const result = await verifyLocatedDocument({ supabase, document: located.document, method: body.method === 'DOCUMENT' ? 'DOCUMENT' : 'HASH', submittedHash: hash, artifactMatches: located.matches });
    await logVerificationRun({ supabase, request, result, documentId: located.document.id, publicVerificationId: located.document.publicLinkId, durationMs: Date.now() - startedAt });
    return json(result);
  } catch (error) {
    console.error('[public-verification] hash failed', error);
    return json({ error: 'No fue posible procesar la huella.' }, 400);
  }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

