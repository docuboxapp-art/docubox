import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/nom151/constancia?documento_id=xxx
// Returns the NOM-151 constancia record for a given documentos.id
// Also returns processing records so the UI can show "Generando..." state
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const documentoId = searchParams.get('documento_id');

  if (!documentoId) {
    return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });
  }

  try {
    // First try to get an issued record
    const { data: issued, error: issuedError } = await supabaseAdmin
      .from('nom151_constancias_doc')
      .select('id, status, nubarium_codigo_validacion, nubarium_hash, constancia_sha256, constancia_path, nubarium_request_payload, nubarium_response_payload, created_at, updated_at, error_detail')
      .eq('documento_id', documentoId)
      .eq('status', 'issued')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (issuedError) {
      console.error('[nom151/constancia] Error fetching issued:', issuedError);
      return NextResponse.json({ error: issuedError.message }, { status: 500 });
    }

    if (issued) {
      return NextResponse.json({ data: issued, processing: false });
    }

    // Check if there's a processing record
    const { data: processing } = await supabaseAdmin
      .from('nom151_constancias_doc')
      .select('id, status, created_at')
      .eq('documento_id', documentoId)
      .eq('status', 'processing')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (processing) {
      return NextResponse.json({ data: null, processing: true });
    }

    // No record at all
    return NextResponse.json({ data: null, processing: false });
  } catch (err: any) {
    console.error('[nom151/constancia] Unexpected error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
