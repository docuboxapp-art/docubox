import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { hashCapabilityToken } from '@/lib/security/capability-token';

function validToken(token: string) {
  return /^[a-f0-9]{64}$/i.test(token);
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!validToken(token)) return NextResponse.json({ error: 'Enlace no válido o vencido.' }, { status: 404 });

  const service = createServiceClient();
  const { data: session } = await service
    .from('mobile_upload_sessions')
    .select('status,expires_at,metadata')
    .eq('token_hash', hashCapabilityToken(token))
    .maybeSingle();
  const metadata = session?.metadata as Record<string, unknown> | null;

  if (!session || metadata?.mode !== 'signature_capture' || new Date(session.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Enlace no válido o vencido.' }, { status: 404 });
  }

  return NextResponse.json(
    {
      status: session.status,
      expiresAt: session.expires_at,
      documentName: typeof metadata.document_name === 'string' ? metadata.document_name : 'Documento',
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
