import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();

    if (!token) {
      return NextResponse.json({ error: 'Token requerido' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Configuración del servidor incompleta' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Look up the token
    const { data: tokenRecord, error: tokenError } = await supabaseAdmin
      .from('email_verification_tokens')
      .select('*')
      .eq('token', token)
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

    // Mark token as used
    await supabaseAdmin
      .from('email_verification_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenRecord.id);

    // Mark user_profiles as email_verified
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .update({
        email_verified: true,
        email_verified_at: new Date().toISOString(),
      })
      .eq('id', tokenRecord.user_id);

    if (profileError) {
      console.error('[verify-email] Error updating user_profiles:', profileError);
      return NextResponse.json({ error: 'Error al actualizar el estado de verificación' }, { status: 500 });
    }

    // Also confirm email in auth.users
    await supabaseAdmin.auth.admin.updateUserById(tokenRecord.user_id, {
      email_confirm: true,
    });

    console.log(`[verify-email] Email verified for user ${tokenRecord.user_id}`);
    return NextResponse.json({ success: true, userId: tokenRecord.user_id });
  } catch (err) {
    console.error('[verify-email] Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
