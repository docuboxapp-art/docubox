import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Token requerido' }, { status: 400 });
  }

  try {
    // Strategy 1: token matches a portal_token stored in a participant's JSONB
    const { data: allDocs, error: scanError } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, participantes')
      .not('participantes', 'is', null);

    if (!scanError && allDocs) {
      for (const doc of allDocs) {
        const parts = doc.participantes as any[];
        if (!Array.isArray(parts)) continue;
        const match = parts.find((p: any) => p.portal_token === token);
        if (match) {
          return NextResponse.json({
            documentName: doc.nombre || 'el documento',
            acto: match.acto || 'firmar',
            participantName: match.nombre || match.name || null,
          });
        }
      }
    }

    // Strategy 2: token is the document's UUID (used by send-reminder and enviar)
    const { data: docById, error: byIdError } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, participantes')
      .eq('id', token)
      .maybeSingle();

    if (!byIdError && docById) {
      // Try to determine acto from participants (use first non-owner participant)
      const parts = docById.participantes as any[];
      const firstParticipant = Array.isArray(parts) ? parts.find((p: any) => !p.isCurrentUser) : null;
      return NextResponse.json({
        documentName: docById.nombre || 'el documento',
        acto: firstParticipant?.acto || 'firmar',
        participantName: firstParticipant?.nombre || firstParticipant?.name || null,
      });
    }

    // Strategy 3: token matches documento_id (the client-side UUID)
    const { data: docByDocId, error: byDocIdError } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, participantes')
      .eq('documento_id', token)
      .maybeSingle();

    if (!byDocIdError && docByDocId) {
      const parts = docByDocId.participantes as any[];
      const firstParticipant = Array.isArray(parts) ? parts.find((p: any) => !p.isCurrentUser) : null;
      return NextResponse.json({
        documentName: docByDocId.nombre || 'el documento',
        acto: firstParticipant?.acto || 'firmar',
        participantName: firstParticipant?.nombre || firstParticipant?.name || null,
      });
    }

    // Token not found — return generic fallback (don't 404, still show the portal)
    return NextResponse.json({
      documentName: 'el documento',
      acto: 'firmar',
      participantName: null,
    });
  } catch (err: any) {
    console.error('[portal-participante/info] Error:', err?.message);
    return NextResponse.json({
      documentName: 'el documento',
      acto: 'firmar',
      participantName: null,
    });
  }
}
