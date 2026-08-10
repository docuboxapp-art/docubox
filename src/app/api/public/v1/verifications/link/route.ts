import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!bearer) return json({ error: 'Autenticacion requerida.' }, 401);
    const { data: auth, error: authError } = await createAnonClient().auth.getUser(bearer);
    if (authError || !auth.user) return json({ error: 'Sesion no valida.' }, 401);

    const body = await request.json();
    const documentId = String(body.documentId || '');
    const supabase = createServiceClient();
    const { data: document } = await supabase.from('documentos').select('id,owner_id,workspace_id,estado,es_publico').eq('id', documentId).maybeSingle();
    if (!document || document.owner_id !== auth.user.id || document.estado !== 'completado' || !document.es_publico) return json({ error: 'El documento no esta disponible para publicacion.' }, 403);

    const token = randomBytes(18).toString('base64url');
    const codeRaw = randomBytes(6).toString('hex').toUpperCase();
    const code = `${codeRaw.slice(0, 4)}-${codeRaw.slice(4, 8)}-${codeRaw.slice(8, 12)}`;
    const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
    await supabase.from('public_verifications').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('document_id', document.id).eq('status', 'active');
    const { error } = await supabase.from('public_verifications').insert({
      workspace_id: document.workspace_id,
      document_id: document.id,
      public_token_hash: digest(token),
      verification_code_hash: digest(code),
      visibility_level: 'document',
      status: 'active',
      created_by: auth.user.id,
    });
    if (error) throw error;

    return json({ token, verificationCode: code, path: `/v/${token}` }, 201);
  } catch (error) {
    console.error('[public-verification] issue link failed', error);
    return json({ error: 'No fue posible crear el enlace publico.' }, 500);
  }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

