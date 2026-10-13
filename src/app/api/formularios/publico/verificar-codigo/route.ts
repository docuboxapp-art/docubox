import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { captureEncryptionKey } from '@/lib/identity/capture-crypto';
import { findStoredIdentity } from '@/lib/identity/stored-identity';
import { PublicCodeError, verifyPublicCode } from '@/lib/forms/public-code-access';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const service = createServiceClient();
    const access = await verifyPublicCode(service, request, body);
    let hasStoredId = false;
    if (access.userId) {
      const key = captureEncryptionKey();
      if (!key) throw new PublicCodeError('El servicio biométrico no está disponible.', 503);
      hasStoredId = Boolean((await findStoredIdentity(service, access.userId, key))?.back);
    }
    return NextResponse.json({ valid: true, accountExists: Boolean(access.userId), hasStoredId,
      canRegister: access.recipientBound },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const known = error instanceof PublicCodeError;
    return NextResponse.json({ error: known ? error.message : 'No se pudo comprobar el código.' },
      { status: known ? error.status : 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
