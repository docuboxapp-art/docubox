import { NextResponse } from 'next/server';
import { readDocumentTypeGroups } from '@/lib/catalog/document-reads';
import { createAnonClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const authorization = request.headers.get('authorization');
    const supabase = createAnonClient(
      authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
    );
    const { data, error } = await readDocumentTypeGroups(supabase);

    if (error) {
      return NextResponse.json({ error: 'No se pudieron cargar los grupos.' }, { status: 503 });
    }

    return NextResponse.json(
      { data: data || [] },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return NextResponse.json({ error: 'No se pudieron cargar los grupos.' }, { status: 503 });
  }
}
