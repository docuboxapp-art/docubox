import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'node:crypto';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId es requerido' }, { status: 400 });
    const { user } = await requireDocumentAccess(req, documentId);
    const { data: enrollment } = await supabase
      .from('enrollment_results')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .limit(1)
      .maybeSingle();

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const { data, error } = await supabase
      .from('mobile_upload_sessions')
      .insert({
        token: sessionToken,
        user_id: user.id,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        metadata: {
          mode: 'id_capture',
          document_id: documentId || null,
          user_id: user.id,
          has_enrollment: Boolean(enrollment),
        },
      })
      .select()
      .single();

    if (error) {
      console.error('[create-id-capture-session] Supabase error:', error);
      return NextResponse.json({ error: error.message, details: error }, { status: 500 });
    }

    return NextResponse.json({
      token: sessionToken,
      expiresAt: expiresAt.toISOString(),
      sessionId: data.id,
    });
  } catch (err: unknown) {
    console.error('[create-id-capture-session] Unexpected error:', err);
    const response = documentAccessResponse(err);
    return NextResponse.json(response.body, { status: response.status });
  }
}
