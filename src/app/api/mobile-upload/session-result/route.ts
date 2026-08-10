import { NextRequest, NextResponse } from 'next/server';
import { captureEncryptionKey, decryptCapture } from '@/lib/identity/capture-crypto';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token') || '';
  const accessToken = bearerToken(request);
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return NextResponse.json({ error: 'Sesion no encontrada.' }, { status: 404 });
  }
  if (!accessToken) {
    return NextResponse.json({ error: 'Debes iniciar sesion.' }, { status: 401 });
  }

  const { data: { user }, error: authError } = await createAnonClient().auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: 'La sesion no es valida.' }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: session } = await service
    .from('mobile_upload_sessions')
    .select('status,user_id,file_data,metadata')
    .eq('token', token)
    .maybeSingle();
  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: 'Sesion no encontrada.' }, { status: 404 });
  }
  if (session.status !== 'completed' && session.status !== 'identity_failed') {
    return NextResponse.json({ status: session.status }, {
      status: 202,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  }

  const key = captureEncryptionKey();
  if (!key || !session.file_data) {
    return NextResponse.json({ error: 'La evidencia cifrada no esta disponible.' }, { status: 503 });
  }

  try {
    return NextResponse.json({
      status: session.status,
      selfie: decryptCapture(session.file_data, key),
      metadata: session.metadata || {},
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch {
    return NextResponse.json({ error: 'No fue posible descifrar la evidencia.' }, { status: 500 });
  }
}
