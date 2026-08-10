import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import crypto from 'node:crypto';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const authorization = req.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const { data: { user } } = await createAnonClient().auth.getUser(authorization.slice(7));
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { count: activeCount } = await supabase
      .from('mobile_upload_sessions')
      .select('id', { head: true, count: 'exact' })
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());
    if ((activeCount || 0) >= 5) {
      return NextResponse.json({ error: 'Ya existen sesiones moviles activas.' }, { status: 429 });
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const { data, error } = await supabase
      .from('mobile_upload_sessions')
      .insert({
        token: sessionToken,
        user_id: user.id,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ token: sessionToken, expiresAt: expiresAt.toISOString(), sessionId: data.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
