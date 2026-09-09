import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashSecret } from '@/lib/ai/security';

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
    const tokenHash = hashSecret(token);
    const { data: matchingDocs, error: scanError } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, estado, participantes')
      .contains('participantes', JSON.stringify([{ portal_token_hash: tokenHash }]))
      .limit(2);

    let participantEmail: string | null = null;
    let documentId: string | null = null;
    let documentName: string | null = null;
    let acto: string = 'firmar';
    let participantNombre: string | null = null;
    let participantApellidoPaterno: string | null = null;
    let participantApellidoMaterno: string | null = null;
    let participantTelefono: string | null = null;
    let participantTipoPersona: string | null = null;

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
          participantEmail = match.email || match.correo || null;
          documentId = doc.id;
          documentName = doc.nombre || 'el documento';
          acto = match.acto || 'firmar';
          participantNombre = match.nombre || match.name || null;
          participantApellidoPaterno = match.apellidoPaterno || match.apellido_paterno || null;
          participantApellidoMaterno = match.apellidoMaterno || match.apellido_materno || null;
          participantTelefono = match.telefono || match.phone || null;
          participantTipoPersona = match.tipoPersona || match.tipo_persona || 'fisica';
          break;
        }
      }
    }

    if (!documentId)
      return NextResponse.json({ error: 'Token inválido o vencido' }, { status: 404 });

    // Complete only the participant identified by the validated capability.
    if (participantEmail) {
      const { data: unregParticipant } = await supabaseAdmin
        .from('unregistered_participants')
        .select('*')
        .eq('email', participantEmail)
        .maybeSingle();

      if (unregParticipant) {
        // Prefer data from unregistered_participants table
        participantNombre = unregParticipant.nombre || participantNombre;
        participantApellidoPaterno =
          unregParticipant.apellido_paterno || participantApellidoPaterno;
        participantApellidoMaterno =
          unregParticipant.apellido_materno || participantApellidoMaterno;
        participantTelefono = unregParticipant.telefono || participantTelefono;
        participantTipoPersona =
          unregParticipant.tipo_persona || participantTipoPersona || 'fisica';
      }
    }

    return NextResponse.json({
      email: participantEmail,
      nombre: participantNombre,
      apellidoPaterno: participantApellidoPaterno,
      apellidoMaterno: participantApellidoMaterno,
      telefono: participantTelefono,
      tipoPersona: participantTipoPersona || 'fisica',
      documentId,
      documentName,
      acto,
    });
  } catch (err: any) {
    console.error('[portal-participante/participant-data] Error:', err?.message);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
