import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { hashCapabilityToken } from '@/lib/security/capability-token';
import { captureEncryptionKey } from '@/lib/identity/capture-crypto';
import { findStoredIdentity } from '@/lib/identity/stored-identity';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (!token) {
      return NextResponse.json({ hasStoredId: false }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Validate session token and get user_id from metadata
    const { data: session } = await supabase
      .from('mobile_upload_sessions')
      .select('user_id, metadata, status, expires_at')
      .eq('token_hash', hashCapabilityToken(token))
      .maybeSingle();

    if (!session || session.status !== 'pending' || new Date(session.expires_at) < new Date()) {
      return NextResponse.json({ hasStoredId: false });
    }

    const userId: string | null = session.user_id || session.metadata?.user_id || null;
    if (!userId) {
      return NextResponse.json({ hasStoredId: false });
    }

    const key = captureEncryptionKey();
    if (!key) {
      return NextResponse.json(
        { hasStoredId: false, error: 'Cifrado no configurado.' },
        { status: 503 }
      );
    }

    const stored = await findStoredIdentity(supabase, userId, key);
    return NextResponse.json(
      stored
        ? {
            hasStoredId: true,
            anverso_b64: stored.front,
            curp_extracted: stored.curp,
            nombre_extracted: stored.nombre,
          }
        : { hasStoredId: false },
      { headers: { 'Cache-Control': 'no-store, private' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'No fue posible comprobar la identificación registrada.' },
      { status: 503, headers: { 'Cache-Control': 'no-store, private' } }
    );
  }
}
