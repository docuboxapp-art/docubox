import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));
    const { documentId, userId, hasEnrollment } = body;

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const { data, error } = await supabase
      .from('mobile_upload_sessions')
      .insert({
        token: sessionToken,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        metadata: {
          mode: 'id_capture',
          document_id: documentId || null,
          user_id: userId || null,
          has_enrollment: !!hasEnrollment,
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
  } catch (err: any) {
    console.error('[create-id-capture-session] Unexpected error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
