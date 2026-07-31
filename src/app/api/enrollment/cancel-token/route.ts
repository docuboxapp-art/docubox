import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/enrollment/cancel-token
 * Marks an enrollment_token as cancelled (too many failed attempts).
 * Body: { token: string }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { token } = await req.json();

    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('enrollment_tokens')
      .update({ status: 'cancelled' })
      .eq('token', token)
      .in('status', ['pending', 'started']);

    if (error) {
      console.error('[cancel-token] Error:', error);
      return NextResponse.json({ error: 'Failed to cancel token' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[cancel-token] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
