import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';


const supabaseAdmin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const { userId, eventType, userAgent } = await req.json();

    if (!userId || !eventType) {
      return NextResponse.json({ error: 'userId and eventType are required' }, { status: 400 });
    }

    const allowedEvents = ['session_timeout_inactivity', 'session_timeout_absolute'];
    if (!allowedEvents.includes(eventType)) {
      return NextResponse.json({ error: 'Invalid eventType' }, { status: 400 });
    }

    const ipAddress =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';

    const descriptionMap: Record<string, string> = {
      session_timeout_inactivity: 'Sesión cerrada automáticamente por inactividad (20 minutos)',
      session_timeout_absolute: 'Sesión cerrada automáticamente por límite absoluto (10 horas)',
    };

    await supabaseAdmin.from('auth_security_events').insert({
      user_id: userId,
      event_type: eventType,
      description: descriptionMap[eventType] || eventType,
      ip_address: ipAddress,
      user_agent: userAgent || req.headers.get('user-agent') || 'unknown',
      metadata: { source: 'session_timeout' },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[log-session-timeout]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
