import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'node:net';
import crypto from 'node:crypto';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

function requestIp(request: NextRequest) {
  const candidate = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || request.headers.get('x-real-ip')?.trim()
    || '';
  return isIP(candidate) ? candidate : null;
}

async function optionalUserId(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const { data: { user } } = await createAnonClient().auth.getUser(token);
  return user?.id || null;
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 128) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const issuedIp = requestIp(request);
    const authenticatedUserId = await optionalUserId(request);
    let userId: string | null = null;
    if (authenticatedUserId) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('id', authenticatedUserId)
        .maybeSingle();
      userId = profile?.id || null;
    }
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    if (issuedIp) {
      const { count } = await supabase
        .from('enrollment_tokens')
        .select('id', { head: true, count: 'exact' })
        .eq('issued_ip', issuedIp)
        .gte('created_at', oneHourAgo);
      if ((count || 0) >= 20) {
        return NextResponse.json({ error: 'Demasiados intentos. Intenta mas tarde.' }, { status: 429 });
      }
    }

    const { count: activeSessionTokens } = await supabase
      .from('enrollment_tokens')
      .select('id', { head: true, count: 'exact' })
      .eq('session_id', sessionId)
      .in('status', ['pending', 'captured', 'processing'])
      .gt('expires_at', new Date().toISOString());
    if ((activeSessionTokens || 0) >= 5) {
      return NextResponse.json({ error: 'Ya existen enlaces activos para esta sesion.' }, { status: 429 });
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex');

    // Token expires in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('enrollment_tokens')
      .insert({
        token,
        session_id: sessionId,
        user_id: userId,
        issued_ip: issuedIp,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) {
      console.error('[create-token] Supabase error:', error);
      return NextResponse.json({ error: 'Failed to create token' }, { status: 500 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
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
