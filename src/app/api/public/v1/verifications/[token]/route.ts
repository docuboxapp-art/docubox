import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { attachTemporaryDocumentUrl, enforcePublicRateLimit, logVerificationRun } from '@/lib/public-verification/gateway';
import { verifyLocatedDocument } from '@/lib/public-verification/orchestrator';
import { locateVerificationDocument } from '@/lib/public-verification/repository';

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!enforcePublicRateLimit(request, 'public-document', 30)) return json({ error: 'Demasiadas consultas. Intenta mas tarde.' }, 429);
  const startedAt = Date.now();
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken || '').trim();
  if (!token || token.length > 160) return json({ error: 'Identificador no valido.' }, 400);

  try {
    const supabase = createServiceClient();
    const document = await locateVerificationDocument(supabase, token);
    if (!document) return json({ error: 'No se encontro una verificacion publica disponible.' }, 404);

    const method = /^([A-Z0-9]{4}-){2}[A-Z0-9]{4}$/i.test(token)
      ? 'CODE'
      : /^(DBX|DOC)-/i.test(token)
        ? 'FOLIO'
        : 'TOKEN';
    let result = await verifyLocatedDocument({ supabase, document, method });
    result = await attachTemporaryDocumentUrl(supabase, document, result);
    await logVerificationRun({ supabase, request, result, documentId: document.id, publicVerificationId: document.publicLinkId, durationMs: Date.now() - startedAt });
    return json(result);
  } catch (error) {
    console.error('[public-verification] lookup failed', error);
    return json({ error: 'El servicio de verificacion no esta disponible temporalmente.' }, 503);
  }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

