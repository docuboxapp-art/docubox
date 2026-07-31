import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('id, nombre, apellido_paterno, apellido_materno, email')
      .order('nombre', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const users = (data || []).map((u) => ({
      id: u.id,
      name: [u.nombre, u.apellido_paterno, u.apellido_materno].filter(Boolean).join(' ') || 'Sin nombre',
      email: u.email || '',
    })).filter((u) => u.email && u.email.includes('@'));

    return NextResponse.json({ users });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error inesperado' }, { status: 500 });
  }
}
