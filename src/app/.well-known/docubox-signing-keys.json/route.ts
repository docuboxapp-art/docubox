import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await createServiceClient().from('cryptographic_keys')
    .select('key_purpose,kms_key_id,kms_key_version,algorithm,public_key_pem,public_key_fingerprint_sha256,certificate_pem,certificate_fingerprint_sha256,status,activated_at,retired_at,revoked_at,revocation_reason')
    .order('activated_at', { ascending: false });
  if (error) return NextResponse.json({ keys: [], error: 'Directorio de llaves no disponible.' }, { status: 503 });
  return NextResponse.json({ schema: 'DOCUBOX_SIGNING_KEYS', schema_version: '1.0', keys: data || [] }, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}

