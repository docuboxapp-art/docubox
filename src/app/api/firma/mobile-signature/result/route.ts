import { NextRequest, NextResponse } from 'next/server';
import { captureEncryptionKey, decryptCapture } from '@/lib/identity/capture-crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { hashCapabilityToken } from '@/lib/security/capability-token';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export async function GET(request: NextRequest) {
  try {
    const token = new URL(request.url).searchParams.get('token') || '';
    if (!/^[a-f0-9]{64}$/i.test(token)) return NextResponse.json({ error: 'Sesión no encontrada.' }, { status: 404 });

    const service = createServiceClient();
    const { data: session } = await service
      .from('mobile_upload_sessions')
      .select('status,user_id,file_data,metadata,expires_at')
      .eq('token_hash', hashCapabilityToken(token))
      .maybeSingle();
    const metadata = session?.metadata as Record<string, unknown> | null;
    const documentId = typeof metadata?.document_id === 'string' ? metadata.document_id : '';
    if (!session || !documentId || metadata?.mode !== 'signature_capture') {
      return NextResponse.json({ error: 'Sesión no encontrada.' }, { status: 404 });
    }

    const { user } = await requireDocumentAccess(request, documentId);
    if (session.user_id !== user.id) return NextResponse.json({ error: 'Sesión no encontrada.' }, { status: 404 });
    if (session.status === 'pending' && new Date(session.expires_at).getTime() > Date.now()) {
      return NextResponse.json({ status: 'pending' }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (session.status !== 'completed' || !session.file_data) {
      return NextResponse.json({ status: 'expired' }, { status: 410 });
    }

    const key = captureEncryptionKey();
    if (!key) return NextResponse.json({ error: 'La evidencia cifrada no está disponible.' }, { status: 503 });
    const capture = JSON.parse(decryptCapture(session.file_data, key));
    return NextResponse.json({ status: 'completed', capture }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
