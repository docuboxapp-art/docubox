import { NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const startedAt = performance.now();
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const anonClient = createAnonClient();
  const {
    data: { user },
    error: authError,
  } = await anonClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Token invalido o expirado' }, { status: 401 });
  }

  const dbStartedAt = performance.now();
  const supabase = createServiceClient();
  const [foldersResult, labelsResult] = await Promise.all([
    supabase
      .from('carpetas')
      .select(
        'id, nombre, parent_id, created_at, descripcion, tipo_documento_id, tipo_documento:tipo_documento_id(id, nombre), grupo_tipo_documento_id, grupo_tipo_documento:grupo_tipo_documento_id(id, nombre)'
      )
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .order('nombre'),
    supabase.from('etiquetas').select('id, nombre, color').order('nombre'),
  ]);
  const dbMs = performance.now() - dbStartedAt;

  if (foldersResult.error)
    console.error('[list-metadata] Error loading folders:', foldersResult.error);
  if (labelsResult.error)
    console.error('[list-metadata] Error loading labels:', labelsResult.error);

  const response = NextResponse.json({
    carpetas: foldersResult.data ?? [],
    etiquetas: labelsResult.data ?? [],
  });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set(
    'Server-Timing',
    `bootstrap_db;dur=${dbMs.toFixed(1)}, bootstrap_total;dur=${(performance.now() - startedAt).toFixed(1)}`
  );
  return response;
}
