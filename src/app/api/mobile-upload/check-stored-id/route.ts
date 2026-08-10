import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { captureEncryptionKey, decryptCapture } from '@/lib/identity/capture-crypto';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (!token) {
      return NextResponse.json({ hasStoredId: false }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Validate session token and get user_id from metadata
    const { data: session } = await supabase
      .from('mobile_upload_sessions')
      .select('user_id, metadata, status, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (
      !session ||
      session.status !== 'pending' ||
      new Date(session.expires_at) < new Date()
    ) {
      return NextResponse.json({ hasStoredId: false });
    }

    const userId: string | null = session.user_id || session.metadata?.user_id || null;
    if (!userId) {
      return NextResponse.json({ hasStoredId: false });
    }

    const key = captureEncryptionKey();
    if (!key) {
      return NextResponse.json({ hasStoredId: false, error: 'Cifrado no configurado.' }, { status: 503 });
    }

    // Check id_capture_logs first (most recent successful capture)
    const { data: idLog } = await supabase
      .from('id_capture_logs')
      .select('anverso_b64, curp_extracted, nombre_extracted')
      .eq('user_id', userId)
      .not('anverso_b64', 'is', null)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (idLog?.anverso_b64) {
      try {
        return NextResponse.json({
          hasStoredId: true,
          anverso_b64: decryptCapture(idLog.anverso_b64, key),
          curp_extracted: idLog.curp_extracted || null,
          nombre_extracted: idLog.nombre_extracted || null,
        }, { headers: { 'Cache-Control': 'no-store, private' } });
      } catch {
        return NextResponse.json({ hasStoredId: false });
      }
    }

    const { data: enrollData } = await supabase
      .from('enrollment_results')
      .select('enrollment_token_id')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (enrollData?.enrollment_token_id) {
      const { data: enrollment } = await supabase
        .from('enrollment_tokens')
        .select('anverso_encrypted')
        .eq('id', enrollData.enrollment_token_id)
        .maybeSingle();
      if (enrollment?.anverso_encrypted) {
        try {
          return NextResponse.json({
            hasStoredId: true,
            anverso_b64: decryptCapture(enrollment.anverso_encrypted, key),
            curp_extracted: null,
            nombre_extracted: null,
          }, { headers: { 'Cache-Control': 'no-store, private' } });
        } catch {
          return NextResponse.json({ hasStoredId: false });
        }
      }
    }

    return NextResponse.json({ hasStoredId: false });
  } catch {
    return NextResponse.json({ hasStoredId: false });
  }
}
