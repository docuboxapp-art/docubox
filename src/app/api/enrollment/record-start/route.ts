import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Only set started_at if not already set (first click on "Comenzar")
    const { error } = await supabase
      .from('enrollment_tokens')
      .update({ started_at: new Date().toISOString() })
      .eq('token', token)
      .is('started_at', null);

    if (error) {
      console.error('[record-start] Error:', error);
      return NextResponse.json({ error: 'Failed to record start time' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[record-start] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
