import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ valid: false, error: 'Token required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('enrollment_tokens')
      .select('id, status, expires_at, user_id, curp, nombre, apellido_paterno')
      .eq('token', token)
      .single();

    if (error || !data) {
      return NextResponse.json({ valid: false, error: 'Token not found' });
    }

    if (new Date(data.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, expired: true });
    }

    if (data.status === 'completed') {
      return NextResponse.json({ valid: false, used: true });
    }

    if (data.status === 'cancelled') {
      return NextResponse.json({ valid: false, cancelled: true });
    }

    // Return user data for identity verification (only if token has user-linked data)
    const userData = (data.user_id || data.curp || data.nombre)
      ? {
          userId: data.user_id || null,
          curp: data.curp || null,
          nombre: data.nombre || null,
          apellidoPaterno: data.apellido_paterno || null,
        }
      : null;

    return NextResponse.json({ valid: true, userData });
  } catch (err) {
    console.error('[validate-token] Error:', err);
    return NextResponse.json({ valid: false, error: 'Internal error' }, { status: 500 });
  }
}
