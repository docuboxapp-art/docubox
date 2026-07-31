import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const grupoId = searchParams.get('grupo_id');

    const supabase = await createClient();

    let query = supabase
      .from('tipo_documento')
      .select('id, grupo_id, nombre, descripcion')
      .order('nombre');

    if (grupoId) {
      query = query.eq('grupo_id', grupoId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching tipos:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err: any) {
    console.error('Unexpected error fetching tipos:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
