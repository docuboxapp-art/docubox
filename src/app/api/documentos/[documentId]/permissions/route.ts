import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

type AccessLevel = 'view' | 'edit';

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function normalizedEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function authorize(request: NextRequest, documentId: string) {
  const token = bearerToken(request);
  if (!token) return { response: NextResponse.json({ error: 'Debes iniciar sesión.' }, { status: 401 }) };

  const { data: auth, error: authError } = await createAnonClient().auth.getUser(token);
  const user = auth.user;
  if (authError || !user?.email) {
    return { response: NextResponse.json({ error: 'La sesión no es válida.' }, { status: 401 }) };
  }

  const service = createServiceClient();
  const { data: document, error: documentError } = await service
    .from('documentos')
    .select('id,owner_id,workspace_id,estado,nombre')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle();
  if (documentError || !document) {
    return { response: NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 }) };
  }

  let workspaceManager = false;
  if (document.workspace_id && document.owner_id !== user.id) {
    const { data: membership, error: membershipError } = await service
      .from('workspace_members')
      .select('role,status,access_expires_at')
      .eq('workspace_id', document.workspace_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (membershipError) throw membershipError;
    const expiresAt = membership?.access_expires_at
      ? new Date(membership.access_expires_at).getTime()
      : null;
    workspaceManager = Boolean(membership) &&
      ['owner', 'admin', 'workspace_admin'].includes(String(membership?.role).toLowerCase()) &&
      (expiresAt === null || expiresAt > Date.now());
  }

  const email = normalizedEmail(user.email);
  const { data: permission, error: permissionError } = await service
    .from('document_access_permissions')
    .select('id,access_level,can_invite,created_by')
    .eq('document_id', documentId)
    .or(`grantee_user_id.eq.${user.id},grantee_email.eq.${email}`)
    .limit(1)
    .maybeSingle();
  if (permissionError) throw permissionError;

  return {
    user,
    service,
    document,
    canManage: document.owner_id === user.id || workspaceManager,
    canInvite: document.owner_id === user.id || workspaceManager || permission?.can_invite === true,
    permission,
  };
}

async function audit(
  context: Exclude<Awaited<ReturnType<typeof authorize>>, { response: NextResponse }> & { user: NonNullable<Awaited<ReturnType<typeof authorize>>['user']> },
  request: NextRequest,
  action: string,
  metadata: Record<string, unknown>
) {
  await context.service.from('document_lifecycle_audit_events').insert({
    workspace_id: context.document.workspace_id || null,
    document_id: context.document.id,
    actor_id: context.user.id,
    actor_email: context.user.email || null,
    action,
    previous_state: {},
    new_state: metadata,
    result: 'success',
    request_id: request.headers.get('x-request-id') || null,
    ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: request.headers.get('user-agent') || null,
    metadata,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const access = await authorize(request, documentId);
    if ('response' in access) return access.response;
    if (!access.canManage && !access.canInvite) {
      return NextResponse.json({ error: 'No tienes permisos para consultar los permisos del documento.' }, { status: 403 });
    }

    const { data, error } = await access.service
      .from('document_access_permissions')
      .select('id,grantee_user_id,grantee_email,access_level,can_invite,created_by,created_at,updated_at')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      permissions: data || [],
      capabilities: {
        canManage: access.canManage,
        canInvite: access.canInvite,
        canEdit: access.canManage || access.permission?.access_level === 'edit',
      },
    });
  } catch (error) {
    console.error('[document permissions] GET failed', error);
    return NextResponse.json({ error: 'No fue posible consultar los permisos.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const access = await authorize(request, documentId);
    if ('response' in access) return access.response;
    if (!access.canInvite) {
      return NextResponse.json({ error: 'No tienes permisos para invitar lectores.' }, { status: 403 });
    }

    const body = await request.json();
    const email = normalizedEmail(body.email);
    const accessLevel: AccessLevel = body.accessLevel === 'edit' ? 'edit' : 'view';
    const canInvite = body.canInvite === true;
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Ingresa un correo electrónico válido.' }, { status: 400 });
    }
    if (!access.canManage && (accessLevel !== 'view' || canInvite)) {
      return NextResponse.json({ error: 'Sólo puedes invitar lectores sin permisos para invitar a otras personas.' }, { status: 403 });
    }
    if (email === normalizedEmail(access.user.email)) {
      return NextResponse.json({ error: 'No es necesario asignarte permisos a ti mismo.' }, { status: 409 });
    }

    const { data: existing, error: existingError } = await access.service
      .from('document_access_permissions')
      .select('id,created_by')
      .eq('document_id', documentId)
      .eq('grantee_email', email)
      .maybeSingle();
    if (existingError) throw existingError;

    let result;
    if (existing) {
      if (!access.canManage && existing.created_by !== access.user.id) {
        return NextResponse.json({ error: 'No puedes modificar permisos creados por otra persona.' }, { status: 403 });
      }
      result = await access.service
        .from('document_access_permissions')
        .update({ access_level: accessLevel, can_invite: canInvite, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('id,grantee_user_id,grantee_email,access_level,can_invite,created_by,created_at,updated_at')
        .single();
    } else {
      result = await access.service
        .from('document_access_permissions')
        .insert({
          document_id: documentId,
          grantee_email: email,
          access_level: accessLevel,
          can_invite: canInvite,
          created_by: access.user.id,
        })
        .select('id,grantee_user_id,grantee_email,access_level,can_invite,created_by,created_at,updated_at')
        .single();
    }
    if (result.error) throw result.error;
    await audit(access as never, request, existing ? 'DOCUMENT_PERMISSION_UPDATED' : 'DOCUMENT_PERMISSION_GRANTED', {
      grantee_email: email,
      access_level: accessLevel,
      can_invite: canInvite,
    });
    return NextResponse.json({ permission: result.data });
  } catch (error) {
    console.error('[document permissions] POST failed', error);
    return NextResponse.json({ error: 'No fue posible guardar el permiso.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const access = await authorize(request, documentId);
    if ('response' in access) return access.response;
    if (!access.canInvite) {
      return NextResponse.json({ error: 'No tienes permisos para retirar accesos.' }, { status: 403 });
    }
    const permissionId = request.nextUrl.searchParams.get('permissionId');
    if (!permissionId) return NextResponse.json({ error: 'Permiso requerido.' }, { status: 400 });
    const { data: target, error: targetError } = await access.service
      .from('document_access_permissions')
      .select('id,created_by,access_level,can_invite,grantee_email')
      .eq('id', permissionId)
      .eq('document_id', documentId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: 'Permiso no encontrado.' }, { status: 404 });
    if (!access.canManage && (target.created_by !== access.user.id || target.access_level !== 'view' || target.can_invite)) {
      return NextResponse.json({ error: 'No puedes retirar este permiso.' }, { status: 403 });
    }
    const { error } = await access.service.from('document_access_permissions').delete().eq('id', target.id);
    if (error) throw error;
    await audit(access as never, request, 'DOCUMENT_PERMISSION_REVOKED', { grantee_email: target.grantee_email });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[document permissions] DELETE failed', error);
    return NextResponse.json({ error: 'No fue posible retirar el permiso.' }, { status: 500 });
  }
}
