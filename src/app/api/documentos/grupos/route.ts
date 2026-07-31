import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('grupo_tipo_documento')
      .select('id, nombre, orden')
      .order('orden');

    if (error) {
      console.error('Error fetching grupos:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err: any) {
    console.error('Unexpected error fetching grupos:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
