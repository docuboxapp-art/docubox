import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex');

    // Token expires in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('enrollment_tokens')
      .insert({
        token,
        session_id: sessionId,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) {
      console.error('[create-token] Supabase error:', error);
      return NextResponse.json({ error: 'Failed to create token' }, { status: 500 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://firmamax4272.builtwithrocket.new';
    const enrollmentUrl = `${siteUrl}/enrolamiento/${token}`;

    return NextResponse.json({
      success: true,
      token,
      enrollmentUrl,
      expiresAt,
      id: data.id,
    });
  } catch (err) {
    console.error('[create-token] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
