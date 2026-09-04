import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();

    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
      return NextResponse.json({ error: 'Token requerido' }, { status: 400 });
    }

    const supabaseAdmin = createServiceClient();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { data: tokenRecord, error: tokenError } = await supabaseAdmin
      .from('email_verification_tokens')
      .select('*')
      .in('token', [tokenHash, token])
      .single();

    if (tokenError || !tokenRecord) {
      return NextResponse.json({ error: 'Token inválido o no encontrado' }, { status: 400 });
    }

    // Check if already used
    if (tokenRecord.used_at) {
      return NextResponse.json({ error: 'Este enlace ya fue utilizado', alreadyUsed: true }, { status: 400 });
    }

    // Check expiry
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Este enlace ha expirado', expired: true }, { status: 400 });
    }

    const { data: target, error: userError } = await supabaseAdmin.auth.admin.getUserById(
      tokenRecord.user_id
    );
    if (
      userError ||
      !target.user ||
      target.user.email?.trim().toLowerCase() !== tokenRecord.email.trim().toLowerCase()
    ) {
      return NextResponse.json({ error: 'El enlace ya no corresponde al correo registrado' }, { status: 400 });
    }

    const verifiedAt = new Date().toISOString();

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      tokenRecord.user_id,
      { email_confirm: true }
    );
    if (authError) {
      console.error('[verify-email] Error confirming auth user:', authError);
      return NextResponse.json({ error: 'Error al confirmar el correo' }, { status: 500 });
    }

    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .update({
        email_verified: true,
        email_verified_at: verifiedAt,
      })
      .eq('id', tokenRecord.user_id);

    if (profileError) {
      console.error('[verify-email] Error updating user_profiles:', profileError);
      return NextResponse.json({ error: 'Error al actualizar el estado de verificación' }, { status: 500 });
    }

    const { error: verificationError } = await supabaseAdmin
      .from('user_verification_status')
      .update({ email_verified: true, email_verified_at: verifiedAt })
      .eq('user_id', tokenRecord.user_id);
    if (verificationError) {
      console.error('[verify-email] Error updating verification status:', verificationError);
      return NextResponse.json({ error: 'Error al actualizar el estado de verificación' }, { status: 500 });
    }

    const { error: consumeError } = await supabaseAdmin
      .from('email_verification_tokens')
      .update({ used_at: verifiedAt })
      .eq('id', tokenRecord.id)
      .is('used_at', null);
    if (consumeError) {
      console.error('[verify-email] Error consuming verification link:', consumeError);
      return NextResponse.json({ error: 'Error al finalizar la verificación' }, { status: 500 });
    }

    console.info('[verify-email] Email verified', { userId: tokenRecord.user_id });
    return NextResponse.json({ success: true, userId: tokenRecord.user_id });
  } catch (err) {
    console.error('[verify-email] Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
