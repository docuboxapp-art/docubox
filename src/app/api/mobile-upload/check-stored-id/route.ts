import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

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
      .select('metadata, status, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (
      !session ||
      session.status !== 'pending' ||
      new Date(session.expires_at) < new Date()
    ) {
      return NextResponse.json({ hasStoredId: false });
    }

    const userId: string | null = session.metadata?.user_id || null;
    if (!userId) {
      return NextResponse.json({ hasStoredId: false });
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
      return NextResponse.json({
        hasStoredId: true,
        anverso_b64: idLog.anverso_b64,
        curp_extracted: idLog.curp_extracted || null,
        nombre_extracted: idLog.nombre_extracted || null,
      });
    }

    // Fallback: check enrollment_results
    const { data: enrollData } = await supabase
      .from('enrollment_results')
      .select('raw_response')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (enrollData?.raw_response?.anverso_b64) {
      return NextResponse.json({
        hasStoredId: true,
        anverso_b64: enrollData.raw_response.anverso_b64,
        curp_extracted: null,
        nombre_extracted: null,
      });
    }

    return NextResponse.json({ hasStoredId: false });
  } catch {
    return NextResponse.json({ hasStoredId: false });
  }
}
