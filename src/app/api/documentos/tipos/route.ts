import { NextResponse } from 'next/server';
import { createAnonClient } from '@/lib/supabase/server';
import { readDocumentTypes } from '@/lib/catalog/document-reads';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const grupoId = searchParams.get('grupo_id');

    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer '))
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const supabase = createAnonClient(authorization.slice(7));

    const { data, error } = await readDocumentTypes(supabase, grupoId);

    if (error) {
      return NextResponse.json(
        { error: 'No se pudieron cargar los tipos documentales.' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { data: data || [] },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'No se pudieron cargar los tipos documentales.' },
      { status: 503 }
    );
  }
}
