import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { sendParticipationReminderEmail } from '@/lib/emailNotifications';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Returns true if the given ISO date string is today (UTC date comparison) */
function isToday(isoDate: string): boolean {
  const d = new Date(isoDate);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await req.json();
    const { participantEmail, participantName, documentName, documentId } = body;

    if (!participantEmail || !documentName) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    // ── 1-per-day limit: check existing fecha_recordatorio in JSONB ──────────
    if (documentId) {
      const { data: docCheck } = await supabaseAdmin
        .from('documentos')
        .select('participantes')
        .eq('id', documentId)
        .single();

      if (docCheck?.participantes) {
        const participant = (docCheck.participantes as any[]).find(
          (p: any) => p.email === participantEmail
        );
        if (participant?.fecha_recordatorio && isToday(participant.fecha_recordatorio)) {
          return NextResponse.json(
            { error: 'Ya se envió un recordatorio a este participante hoy. Solo se permite uno por día.' },
            { status: 429 }
          );
        }
      }
    }

    // Get sender profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      .maybeSingle();

    const senderName = profile?.full_name || user.email || 'Un usuario';

    // Build portal URL: prefer participant's portal_token, fall back to documentId (DB UUID)
    let portalToken = documentId;
    let participantRole = 'Participante';
    let signatureMethod = 'Firma electr\u00f3nica';
    let expiryDate: string | undefined;
    if (documentId) {
      const { data: docForToken } = await supabaseAdmin
        .from('documentos')
        .select('participantes, fecha_vencimiento')
        .eq('id', documentId)
        .single();
      expiryDate = docForToken?.fecha_vencimiento || undefined;
      if (docForToken?.participantes) {
        const participant = (docForToken.participantes as any[]).find(
          (p: any) => p.email === participantEmail
        );
        if (participant?.portal_token) {
          portalToken = participant.portal_token;
        }
        participantRole = participant?.acto || participant?.role || 'Participante';
        const methods = Array.isArray(participant?.tipoFirma) ? participant.tipoFirma : [];
        const labels: Record<string, string> = {
          autografa: 'Firma aut\u00f3grafa digital',
          efirma: 'e.firma SAT',
          biometria: 'Biometr\u00eda',
          click: 'Click & Sign',
        };
        signatureMethod = methods.map((method: string) => labels[method] || method).join(', ') || 'Firma electr\u00f3nica';
      }
    }

    const documentUrl = portalToken
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/portal-participante/${portalToken}`
      : `${process.env.NEXT_PUBLIC_SITE_URL}/mis-participaciones`;

    // Send reminder email via Resend
    await sendParticipationReminderEmail({
      participantEmail,
      participantName,
      documentName,
      senderName,
      documentUrl,
      participantRole,
      signatureMethod,
      expiryDate,
    });

    // ── Update fecha_recordatorio in participant JSONB (non-blocking) ──────
    if (documentId) {
      try {
        const { data: docRow } = await supabaseAdmin
          .from('documentos')
          .select('participantes')
          .eq('id', documentId)
          .single();

        if (docRow?.participantes) {
          const now = new Date().toISOString();
          const updatedParticipantes = (docRow.participantes as any[]).map((p: any) => {
            if (p.email === participantEmail) {
              return { ...p, fecha_recordatorio: now };
            }
            return p;
          });
          await supabaseAdmin
            .from('documentos')
            .update({ participantes: updatedParticipantes })
            .eq('id', documentId);
        }

        // Log audit trail: recordatorio_enviado
        await supabaseAdmin.from('audit_trail').insert({
          documento_id: documentId,
          actor_id: user.id,
          action: 'recordatorio_enviado',
          category: 'notificacion',
          details: {
            participant_email: participantEmail,
            participant_name: participantName,
            channel: 'email',
          },
        });
      } catch (updateErr) {
        console.error('[send-reminder] Error al actualizar fecha_recordatorio:', updateErr);
        // Non-blocking
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: 500 });
  }
}
