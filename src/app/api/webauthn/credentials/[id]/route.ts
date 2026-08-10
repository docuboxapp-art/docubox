import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    }

    const {
      data: { user },
      error: authError,
    } = await createAnonClient().auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'La sesión no es válida.' }, { status: 401 });
    }

    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'El dispositivo no es válido.' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: credential, error: credentialError } = await supabase
      .from('webauthn_credentials')
      .select(
        'id, credential_id, device_name, device_type, device_category, context, registered_from, is_active'
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (credentialError) {
      console.error('[webauthn/credentials] lookup failed:', credentialError.message);
      return NextResponse.json(
        { error: 'No fue posible consultar el dispositivo.' },
        { status: 500 }
      );
    }
    if (!credential) {
      return NextResponse.json({ error: 'Dispositivo no encontrado.' }, { status: 404 });
    }

    if (credential.is_active) {
      const { error: revokeError } = await supabase
        .from('webauthn_credentials')
        .update({ is_active: false })
        .eq('id', credential.id)
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (revokeError) {
        console.error('[webauthn/credentials] revoke failed:', revokeError.message);
        return NextResponse.json(
          { error: 'No fue posible revocar el dispositivo.' },
          { status: 500 }
        );
      }

      const forwardedFor = request.headers.get('x-forwarded-for');
      const { error: auditError } = await supabase.from('webauthn_audit').insert({
        user_id: user.id,
        credential_id: credential.credential_id,
        event_type: 'device_revoked',
        device_name: credential.device_name,
        device_type: credential.device_type,
        device_category: credential.device_category,
        context: credential.context,
        registered_from: credential.registered_from,
        ip: forwardedFor?.split(',')[0]?.trim() || null,
        user_agent: request.headers.get('user-agent'),
        success: true,
        metadata: { credential_record_id: credential.id },
      });

      if (auditError) {
        console.error('[webauthn/credentials] audit failed:', auditError.message);
      }
    }

    return NextResponse.json(
      { success: true, credentialId: credential.id, revoked: true },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('[webauthn/credentials] unexpected error:', error);
    return NextResponse.json({ error: 'No fue posible revocar el dispositivo.' }, { status: 500 });
  }
}
