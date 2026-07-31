import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/nom151/xml-evidence?documento_id=xxx
// Returns xml evidence data from documentos table
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const documentoId = searchParams.get('documento_id');

  if (!documentoId) {
    return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('documentos')
      .select('xml_evidencia_path, xml_hash_sha256, xml_generated_at')
      .eq('id', documentoId)
      .not('xml_evidencia_path', 'is', null)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
