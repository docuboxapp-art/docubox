import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

type AccessLevel = 'view' | 'download' | 'evidence';
const levels = new Set<AccessLevel>(['view', 'download', 'evidence']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const email = (value: unknown) => String(value || '').trim().toLowerCase();

async function authorize(request: NextRequest, documentId: string) {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return { response: NextResponse.json({ error: 'Debes iniciar sesión.' }, { status: 401 }) };
  const { data, error: authError } = await createAnonClient().auth.getUser(token);
  const user = data.user;
  if (authError || !user?.email) {
    return { response: NextResponse.json({ error: 'La sesión no es válida.' }, { status: 401 }) };
  }
  const service = createServiceClient();
  const { data: document, error: documentError } = await service.from('documentos')
    .select('id,owner_id,workspace_id,current_custodian_workspace_id,estado,nombre,participantes')
    .eq('id', documentId).is('deleted_at', null).maybeSingle();
  if (documentError) throw documentError;
  if (!document) return { response: NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 }) };
  const workspaceId = document.current_custodian_workspace_id || document.workspace_id;
  let workspaceManager = false;
  if (workspaceId && document.owner_id !== user.id) {
    const { data: member, error } = await service.from('workspace_members')
      .select('role,access_expires_at').eq('workspace_id', workspaceId)
      .eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (error) throw error;
    workspaceManager = Boolean(member) &&
      ['owner', 'admin', 'workspace_admin'].includes(String(member?.role).toLowerCase()) &&
      (!member?.access_expires_at || Date.parse(member.access_expires_at) > Date.now());
  }
  if (document.owner_id !== user.id && !workspaceManager) {
    return { response: NextResponse.json({ error: 'Solo el propietario o un administrador autorizado puede gestionar accesos.' }, { status: 403 }) };
  }
  return { user, service, document, workspaceId };
}

type Authorized = Exclude<Awaited<ReturnType<typeof authorize>>, { response: NextResponse }>;

async function inheritedAccessReason(access: Authorized, userId: string, userEmail: string) {
  if (access.document.owner_id === userId) return 'Propietario';
  if (Array.isArray(access.document.participantes) &&
      access.document.participantes.some((item: Record<string, unknown>) =>
        item.id === userId || item.user_id === userId || email(item.email) === userEmail)) {
    return 'Participante';
  }
  if (access.workspaceId) {
    const { data, error } = await access.service.from('workspace_members')
      .select('role,access_expires_at').eq('workspace_id', access.workspaceId)
      .eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (error) throw error;
    if (data && ['owner', 'admin', 'workspace_admin'].includes(String(data.role).toLowerCase()) &&
        (!data.access_expires_at || Date.parse(data.access_expires_at) > Date.now())) {
      return 'Administrador del espacio';
    }
  }
  return null;
}

async function audit(access: Authorized, request: NextRequest, action: string, metadata: Record<string, unknown>) {
  const { error } = await access.service.from('document_lifecycle_audit_events').insert({
    workspace_id: access.document.workspace_id || null,
    document_id: access.document.id,
    actor_id: access.user.id,
    actor_email: access.user.email || null,
    action,
    previous_state: {},
    new_state: metadata,
    result: 'success',
    request_id: request.headers.get('x-request-id') || null,
    ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: request.headers.get('user-agent') || null,
    metadata,
  });
  if (error) console.error('[document permissions] Audit failed', error);
}

export async function GET(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const access = await authorize(request, documentId);
    if ('response' in access) return access.response;
    if (access.document.estado !== 'completado') {
      return NextResponse.json({ permissions: [], capabilities: { canManage: true, canInvite: false, canEdit: true } });
    }
    const query = request.nextUrl.searchParams.get('q')?.trim() || '';
    if (query) {
      const normalized = email(query);
      let profiles: Array<{ id: string; full_name: string | null; email: string | null }> = [];
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        const result = await access.service.from('user_profiles')
          .select('id,full_name,email').eq('is_active', true).eq('email', normalized).limit(1);
        if (result.error) throw result.error;
        profiles = result.data || [];
      } else if (query.length >= 3 && access.workspaceId) {
        const members = await access.service.from('workspace_members')
          .select('user_id').eq('workspace_id', access.workspaceId).eq('status', 'active').limit(100);
        if (members.error) throw members.error;
        const memberIds = (members.data || []).map((member) => member.user_id).filter(Boolean);
        if (memberIds.length) {
          const safeName = query.replace(/[%_\\]/g, '');
          if (safeName.trim().length < 3) return NextResponse.json({ users: [] });
          const result = await access.service.from('user_profiles')
            .select('id,full_name,email').eq('is_active', true).in('id', memberIds)
            .ilike('full_name', `%${safeName}%`).limit(8);
          if (result.error) throw result.error;
          profiles = result.data || [];
        }
      }
      const { data: existing, error: existingError } = await access.service
        .from('document_access_permissions').select('grantee_user_id').eq('document_id', documentId);
      if (existingError) throw existingError;
      const existingIds = new Set((existing || []).map((item) => item.grantee_user_id));
      const users = await Promise.all(profiles.map(async (profile) => ({
        id: profile.id,
        name: profile.full_name || profile.email || 'Usuario registrado',
        email: profile.email || '',
        unavailableReason: existingIds.has(profile.id)
          ? 'Ya tiene acceso adicional'
          : await inheritedAccessReason(access, profile.id, email(profile.email)),
      })));
      return NextResponse.json({ users }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const { data, error } = await access.service.from('document_access_permissions')
      .select('id,grantee_user_id,access_level,created_by,created_at,updated_at')
      .eq('document_id', documentId).order('created_at', { ascending: true });
    if (error) throw error;
    const ids = [...new Set((data || []).flatMap((item) => [item.grantee_user_id, item.created_by]).filter(Boolean))];
    const result = ids.length
      ? await access.service.from('user_profiles').select('id,full_name,email').in('id', ids)
      : { data: [], error: null };
    if (result.error) throw result.error;
    const profiles = new Map((result.data || []).map((profile) => [profile.id, profile]));
    return NextResponse.json({
      permissions: (data || []).map((permission) => ({
        ...permission,
        grantee_name: profiles.get(permission.grantee_user_id)?.full_name || null,
        grantee_email: profiles.get(permission.grantee_user_id)?.email || null,
        created_by_name: profiles.get(permission.created_by)?.full_name || null,
      })),
      capabilities: { canManage: true, canInvite: false, canEdit: false },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[document permissions] GET failed', error);
    return NextResponse.json({ error: 'No fue posible consultar los accesos.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const access = await authorize(request, documentId);
    if ('response' in access) return access.response;
    if (access.document.estado !== 'completado') {
      return NextResponse.json({ error: 'Los accesos adicionales se habilitan al completar el documento.' }, { status: 409 });
    }
    const body = await request.json();
    const userId = String(body.userId || '');
    const level = String(body.accessLevel || '');
    if (!uuidPattern.test(userId) || !levels.has(level as AccessLevel) || body.canInvite === true) {
      return NextResponse.json({ error: 'Selecciona un usuario registrado y un permiso válido.' }, { status: 400 });
    }
    const { data: profile, error: profileError } = await access.service.from('user_profiles')
      .select('id,email,is_active').eq('id', userId).maybeSingle();
    if (profileError) throw profileError;
    const account = await access.service.auth.admin.getUserById(userId);
    if (!profile?.is_active || account.error || !account.data.user ||
        email(account.data.user.email) !== email(profile.email)) {
      return NextResponse.json({ error: 'Selecciona una cuenta activa de Docubox.' }, { status: 404 });
    }
    if (userId === access.user.id || await inheritedAccessReason(access, userId, email(profile.email))) {
      return NextResponse.json({ error: 'Esta persona ya tiene acceso por su función en el documento.' }, { status: 409 });
    }
    const { data: existing, error: existingError } = await access.service.from('document_access_permissions')
      .select('id').eq('document_id', documentId).eq('grantee_user_id', userId).maybeSingle();
    if (existingError) throw existingError;
    const result = existing
      ? await access.service.from('document_access_permissions')
          .update({ access_level: level, can_invite: false, updated_at: new Date().toISOString() })
          .eq('id', existing.id).select('id,grantee_user_id,access_level,created_at,updated_at').single()
      : await access.service.from('document_access_permissions')
          .insert({ document_id: documentId, grantee_user_id: userId, access_level: level,
            can_invite: false, created_by: access.user.id })
          .select('id,grantee_user_id,access_level,created_at,updated_at').single();
    if (result.error) throw result.error;
    await audit(access, request, existing ? 'DOCUMENT_PERMISSION_UPDATED' : 'DOCUMENT_PERMISSION_GRANTED', {
      grantee_user_id: userId, access_level: level,
    });
    return NextResponse.json({ permission: result.data });
  } catch (error) {
    console.error('[document permissions] POST failed', error);
    return NextResponse.json({ error: 'No fue posible guardar el acceso.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const access = await authorize(request, documentId);
    if ('response' in access) return access.response;
    if (access.document.estado !== 'completado') {
      return NextResponse.json({ error: 'Los accesos adicionales se habilitan al completar el documento.' }, { status: 409 });
    }
    const permissionId = request.nextUrl.searchParams.get('permissionId');
    if (!permissionId || !uuidPattern.test(permissionId)) {
      return NextResponse.json({ error: 'Acceso requerido.' }, { status: 400 });
    }
    const { data: target, error: targetError } = await access.service.from('document_access_permissions')
      .select('id,grantee_user_id').eq('id', permissionId).eq('document_id', documentId).maybeSingle();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: 'Acceso no encontrado.' }, { status: 404 });
    const { error } = await access.service.from('document_access_permissions').delete().eq('id', target.id);
    if (error) throw error;
    await audit(access, request, 'DOCUMENT_PERMISSION_REVOKED', { grantee_user_id: target.grantee_user_id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[document permissions] DELETE failed', error);
    return NextResponse.json({ error: 'No fue posible retirar el acceso.' }, { status: 500 });
  }
}
