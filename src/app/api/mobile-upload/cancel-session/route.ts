import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/mobile-upload/cancel-session
 * Marks a mobile_upload_session as cancelled (too many failed attempts).
 * Body: { token: string, reason?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { token, reason } = await req.json();

    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('mobile_upload_sessions')
      .update({
        status: 'cancelled',
        metadata: supabase.rpc ? undefined : undefined, // keep existing metadata
      })
      .eq('token', token)
      .eq('status', 'pending');

    if (error) {
      console.error('[cancel-session] Error:', error);
      return NextResponse.json({ error: 'Failed to cancel session' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[cancel-session] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
