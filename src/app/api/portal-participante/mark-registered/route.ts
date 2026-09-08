import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessParticipantDocument } from '@/lib/documents/participant-visibility';
import { hashCapabilityToken } from '@/lib/security/capability-token';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { email, userId, token } = await req.json();

    if (!email || !userId || !token) {
      return NextResponse.json({ error: 'Datos de registro incompletos' }, { status: 400 });
    }

    const tokenHash = hashCapabilityToken(String(token));
    const { data: documents } = await supabaseAdmin
      .from('documentos')
      .select('id,workspace_id,estado,participantes')
      .contains('participantes', [{ portal_token_hash: tokenHash }])
      .limit(2);
    const normalizedEmail = String(email).trim().toLowerCase();
    const document = (documents || []).find((candidate) => {
      if (candidate.estado === 'cancelado' || !Array.isArray(candidate.participantes)) return false;
      return candidate.participantes.some((participant: Record<string, unknown>) => {
        const participantEmail = String(participant.email || participant.correo || '')
          .trim()
          .toLowerCase();
        const expiresAt = String(participant.portal_token_expires_at || '');
        return (
          participant.portal_token_hash === tokenHash &&
          participantEmail === normalizedEmail &&
          !participant.portal_token_invalidated_at &&
          (!expiresAt || new Date(expiresAt).getTime() > Date.now()) &&
          canAccessParticipantDocument(participant)
        );
      });
    });
    if (!document) {
      return NextResponse.json({ error: 'Enlace inválido o vencido' }, { status: 403 });
    }

    const { data: registeredUser } = await supabaseAdmin.auth.admin.getUserById(String(userId));
    if (registeredUser.user?.email?.trim().toLowerCase() !== normalizedEmail) {
      return NextResponse.json(
        { error: 'El usuario no corresponde a la invitación' },
        { status: 403 }
      );
    }

    const { error } = await supabaseAdmin
      .from('unregistered_participants')
      .update({
        registered_at: new Date().toISOString(),
      })
      .eq('email', email)
      .eq('workspace_id', document.workspace_id)
      .is('registered_at', null);

    if (error) {
      console.error('[mark-registered] Error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[mark-registered] Unexpected error:', err?.message);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
