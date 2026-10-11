import { NextRequest, NextResponse } from 'next/server';
import { finalDeliverableReady } from '@/lib/nom151/final-deliverable';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ responseId: string }> }
) {
  try {
    const { responseId } = await context.params;
    if (!uuidPattern.test(responseId)) {
      return NextResponse.json(
        { error: 'Respuesta inválida.' },
        { status: 400, headers: privateHeaders }
      );
    }

    const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) {
      return NextResponse.json(
        { error: 'No autenticado.' },
        { status: 401, headers: privateHeaders }
      );
    }

    const userClient = createAnonClient(bearer);
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(bearer);
    if (authError || !user || user.is_anonymous || !user.email_confirmed_at) {
      return NextResponse.json(
        { error: 'No autenticado.' },
        { status: 401, headers: privateHeaders }
      );
    }

    // Use the same RLS visibility as the response list before reading private details.
    const visible = await userClient
      .from('form_responses')
      .select('id')
      .eq('id', responseId)
      .maybeSingle();
    if (visible.error) throw visible.error;
    if (!visible.data) {
      return NextResponse.json(
        { error: 'Respuesta no disponible.' },
        { status: 404, headers: privateHeaders }
      );
    }

    const service = createServiceClient();
    const response = await service
      .from('form_responses')
      .select('id,template_id,token_id,document_id')
      .eq('id', responseId)
      .single();
    if (response.error || !response.data)
      throw response.error || new Error('Respuesta no disponible.');

    const tokenResult = await service
      .from('form_tokens')
      .select('template_id,recipient_email,access_mode,created_at')
      .eq('id', response.data.token_id)
      .single();
    if (
      tokenResult.error ||
      !tokenResult.data ||
      tokenResult.data.template_id !== response.data.template_id
    ) {
      throw tokenResult.error || new Error('Invitación no disponible.');
    }

    const token = tokenResult.data;
    let sentAt: string | null = null;
    if (token.access_mode === 'public') {
      const invitation = await service
        .from('form_public_invitees')
        .select('invited_at')
        .eq('form_id', response.data.template_id)
        .eq('recipient_email', token.recipient_email.trim().toLowerCase())
        .maybeSingle();
      if (invitation.error) throw invitation.error;
      sentAt = invitation.data?.invited_at || null;
    } else {
      const scheduled = await service
        .from('form_send_schedules')
        .select('sent_at')
        .eq('token_id', response.data.token_id)
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (scheduled.error) throw scheduled.error;
      sentAt = scheduled.data?.sent_at || token.created_at || null;
    }

    let documentId = response.data.document_id;
    if (!documentId) {
      const linked = await service
        .from('documentos')
        .select('id')
        .eq('source_form_response_id', responseId)
        .limit(1)
        .maybeSingle();
      if (linked.error) throw linked.error;
      documentId = linked.data?.id || null;
    }

    const signedPdfReady = documentId ? await finalDeliverableReady(service, documentId) : false;
    return NextResponse.json(
      { document_id: documentId, signed_pdf_ready: signedPdfReady, sent_at: sentAt },
      { headers: privateHeaders }
    );
  } catch (error) {
    console.error('[form-response-detail] Could not load response document state:', error);
    return NextResponse.json(
      { error: 'No se pudo consultar el estado de esta respuesta.' },
      { status: 500, headers: privateHeaders }
    );
  }
}
