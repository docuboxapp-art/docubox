import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, createAnonClient } from '@/lib/supabase/server';

const DOC_SELECT = 'id, nombre, descripcion, estado, etiquetas_ids, file_size, updated_at, ultimo_paso, is_favorite, fecha_vencimiento, file_url, scan_status, scan_threat, carpeta_id, created_at, fecha_completado, numero_oficio, folio_interno, ruta_guardado, es_urgente, participantes, tipo_documento_id, tipo_documento:tipo_documento_id(nombre), deleted_at, owner_id';

export async function GET(request: NextRequest) {
  try {
    // Authenticate user via Bearer token using anon client (proper JWT validation)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // Use anon client to validate the JWT properly
    const anonClient = createAnonClient();
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      console.error('[listar-documentos] Auth error:', authError?.message);
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
    }

    // Use service role client for the actual query (bypasses RLS, filters by owner_id)
    const supabase = createServiceClient();

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get('tipo') || 'todos';

    let query = supabase
      .from('documentos')
      .select(DOC_SELECT)
      .eq('owner_id', user.id);

    if (tipo === 'papelera') {
      query = query.not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
    } else if (tipo === 'favoritos') {
      query = query.eq('is_favorite', true).is('deleted_at', null).order('updated_at', { ascending: false });
    } else if (tipo === 'por_vencer') {
      const now = new Date();
      const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);
      query = query
        .is('deleted_at', null)
        .not('fecha_vencimiento', 'is', null)
        .lte('fecha_vencimiento', in72h.toISOString())
        .gte('fecha_vencimiento', now.toISOString())
        .order('fecha_vencimiento', { ascending: true });
    } else {
      query = query.is('deleted_at', null).order('updated_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      console.error('[listar-documentos] Query error:', error.message, '| code:', error.code, '| details:', error.details);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[listar-documentos] user=${user.id} tipo=${tipo} count=${data?.length ?? 0}`);
    return NextResponse.json({ data: data || [] });
  } catch (err: any) {
    console.error('[listar-documentos] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
