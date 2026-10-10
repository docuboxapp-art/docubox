import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
const noStore = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token || !/^[a-f0-9]{64}$/i.test(token))
    return NextResponse.json({ error: 'Enlace inválido.' }, { status: 400, headers: noStore });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return NextResponse.json(
      { error: 'Servicio no disponible.' },
      { status: 503, headers: noStore }
    );
  const service = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: invitation, error } = await service
    .from('form_tokens')
    .select(
      'recipient_email,recipient_name,expires_at,used_at,access_mode,form_templates(name,status)'
    )
    .eq('token', token)
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { error: 'No se pudo consultar la invitación.' },
      { status: 503, headers: noStore }
    );
  const form = invitation?.form_templates as unknown as {
    name?: string;
    status?: string;
  } | null;
  if (
    !invitation ||
    invitation.access_mode !== 'private' ||
    !form ||
    form.status !== 'published'
  )
    return NextResponse.json(
      { error: 'La invitación no está disponible.' },
      { status: 404, headers: noStore }
    );
  if (invitation.used_at || (invitation.expires_at && new Date(invitation.expires_at).getTime() <= Date.now()))
    return NextResponse.json(
      { error: 'Esta invitación ya fue utilizada o venció.' },
      { status: 410, headers: noStore }
    );
  const { data: profile } = await service
    .from('user_profiles')
    .select('id')
    .eq('email', invitation.recipient_email.trim().toLowerCase())
    .maybeSingle();
  return NextResponse.json(
    {
      formName: form.name || 'Formulario',
      recipientName: invitation.recipient_name || null,
      email: invitation.recipient_email,
      isRegistered: Boolean(profile?.id),
      expiresAt: invitation.expires_at,
    },
    { headers: noStore }
  );
}
