import { NextResponse } from 'next/server';
import { createAnonClient } from '@/lib/supabase/server';
import { readDocumentTags } from '@/lib/catalog/document-reads';

export async function GET(request: Request) {
  try {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer '))
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const supabase = createAnonClient(authorization.slice(7));
    const { data, error } = await readDocumentTags(supabase);

    if (error) {
      return NextResponse.json({ error: 'No se pudieron cargar las etiquetas.' }, { status: 503 });
    }

    return NextResponse.json(
      { data: data || [] },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return NextResponse.json({ error: 'No se pudieron cargar las etiquetas.' }, { status: 503 });
  }
}
