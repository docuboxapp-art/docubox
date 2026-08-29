import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import { Nom151ServiceError, revalidateNom151 } from '@/lib/nom151/service';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const certificationId = String(body.certification_id || '').trim();
    if (!certificationId) {
      return NextResponse.json({ error: 'certification_id requerido' }, { status: 400 });
    }
    const record = await supabaseAdmin
      .from('nom151_constancias_doc')
      .select('documento_id')
      .eq('id', certificationId)
      .single();
    if (record.error || !record.data) {
      return NextResponse.json({ error: 'Constancia NOM-151 no encontrada' }, { status: 404 });
    }
    await requireDocumentAccess(req, record.data.documento_id, { ownerOrAdminOnly: true });
    const result = await revalidateNom151(supabaseAdmin, certificationId);
    return NextResponse.json(result, { status: result.valid ? 200 : 422 });
  } catch (error) {
    if (error instanceof Nom151ServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
