import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { hashCapabilityToken } from '@/lib/security/capability-token';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

const SESSION_TTL_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const documentId = typeof body.documentId === 'string' ? body.documentId : '';
    if (!documentId) {
      return NextResponse.json({ error: 'Documento requerido.' }, { status: 400 });
    }

    const { user, document } = await requireDocumentAccess(request, documentId);
    const service = createServiceClient();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    const { count } = await service
      .from('mobile_upload_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());
    if ((count || 0) >= 5) {
      return NextResponse.json({ error: 'Ya existen sesiones móviles activas. Espera a que expiren o completa una de ellas.' }, { status: 429 });
    }

    const { data, error } = await service
      .from('mobile_upload_sessions')
      .insert({
        token,
        token_hash: hashCapabilityToken(token),
        user_id: user.id,
        status: 'pending',
        expires_at: expiresAt,
        metadata: {
          mode: 'signature_capture',
          document_id: documentId,
          document_name: document.nombre || document.nombre_archivo || document.name || 'Documento',
        },
      })
      .select('id')
      .single();

    if (error || !data) {
      console.error('[mobile-signature/create] Could not create session', error);
      return NextResponse.json({ error: 'No fue posible generar el enlace móvil.' }, { status: 500 });
    }

    return NextResponse.json(
      { token, expiresAt, sessionId: data.id },
      { headers: { 'Cache-Control': 'no-store, private' } },
    );
  } catch (error) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
