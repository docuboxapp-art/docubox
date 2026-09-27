import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return NextResponse.json({ error: 'Debes iniciar sesión.' }, { status: 401 });
  const { data, error } = await createAnonClient().auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  try {
    const service = createServiceClient();
    const permissions = await service.from('document_access_permissions')
      .select('document_id,access_level,created_at')
      .eq('grantee_user_id', data.user.id)
      .order('created_at', { ascending: false });
    if (permissions.error) throw permissions.error;
    const ids = (permissions.data || []).map((permission) => permission.document_id);
    if (!ids.length) return NextResponse.json({ documents: [] });
    const documents = await service.from('documentos')
      .select('id,nombre,estado,owner_id,fecha_completado')
      .in('id', ids).eq('estado', 'completado').is('deleted_at', null);
    if (documents.error) throw documents.error;
    const ownerIds = [...new Set((documents.data || []).map((document) => document.owner_id))];
    const owners = ownerIds.length
      ? await service.from('user_profiles').select('id,full_name').in('id', ownerIds)
      : { data: [], error: null };
    if (owners.error) throw owners.error;
    const names = new Map((owners.data || []).map((owner) => [owner.id, owner.full_name]));
    const documentMap = new Map((documents.data || []).map((document) => [document.id, document]));
    return NextResponse.json({ documents: (permissions.data || []).flatMap((permission) => {
      const document = documentMap.get(permission.document_id);
      return document ? [{
        id: document.id,
        name: document.nombre,
        completedAt: document.fecha_completado,
        ownerName: names.get(document.owner_id) || 'Propietario del documento',
        accessLevel: permission.access_level,
      }] : [];
    }) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[shared documents] Failed to load:', error);
    return NextResponse.json({ error: 'No fue posible cargar los documentos compartidos.' }, { status: 500 });
  }
}
