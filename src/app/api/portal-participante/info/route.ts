import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashSecret } from '@/lib/ai/security';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function resolveDocumentName(document: { nombre?: unknown; file_name?: unknown }) {
  const candidates = [document.nombre, document.file_name]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value && value.toLowerCase() !== 'el documento');

  return candidates[0] || 'Documento sin nombre';
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Token requerido' }, { status: 400 });
  }

  try {
    const tokenHash = hashSecret(token);
    const { data: matchingDocs, error: scanError } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, file_name, estado, participantes')
      .contains('participantes', [{ portal_token_hash: tokenHash }])
      .limit(2);

    if (!scanError && matchingDocs) {
      for (const doc of matchingDocs) {
        const parts = doc.participantes as any[];
        if (!Array.isArray(parts)) continue;
        const match = parts.find((p: any) => p.portal_token_hash === tokenHash);
        if (match) {
          if (
            doc.estado === 'cancelado' ||
            match.portal_token_invalidated_at ||
            (match.portal_token_expires_at &&
              new Date(match.portal_token_expires_at).getTime() <= Date.now()) ||
            match.current_access === false
          ) {
            return NextResponse.json(
              { error: 'Este enlace ya no está disponible.' },
              { status: 410 }
            );
          }
          return NextResponse.json(
            {
              documentName: resolveDocumentName(doc),
              acto: match.acto || 'firmar',
              participantName: match.nombre || match.name || null,
            },
            { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
          );
        }
      }
    }

    return NextResponse.json({ error: 'Token inválido o vencido' }, { status: 404 });
  } catch (err: any) {
    console.error('[portal-participante/info] Error:', err?.message);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
