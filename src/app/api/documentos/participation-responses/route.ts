import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentoId = searchParams.get('id');

    if (!documentoId) {
      return NextResponse.json({ error: 'ID de documento requerido' }, { status: 400 });
    }

    // Authenticate via Authorization header (Bearer token sent by client)
    const authHeader = request.headers.get('authorization');
    let user: any = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user: tokenUser }, error: tokenError } = await supabaseAdmin.auth.getUser(token);
      if (!tokenError && tokenUser) {
        user = tokenUser;
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    // Verify access: user must be owner or participant of the document
    const { data: doc } = await supabaseAdmin
      .from('documentos')
      .select('owner_id, participantes')
      .eq('id', documentoId)
      .single();

    if (!doc) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    const isOwner = doc.owner_id === user.id;
    const participantes: any[] = doc.participantes || [];
    const userEmail = user.email?.toLowerCase() || '';
    const isParticipant = participantes.some(
      (p: any) =>
        (p.email && p.email.toLowerCase() === userEmail) ||
        p.id === user.id
    );

    if (!isOwner && !isParticipant) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    }

    // Fetch all participation responses using service role (bypasses RLS)
    const { data: responses, error } = await supabaseAdmin
      .from('participation_responses')
      .select('participante_email, participante_nombre, campos_completados, firma_data, firma_completada, aprobacion_completada')
      .eq('documento_id', documentoId);

    if (error) {
      console.error('[api/participation-responses] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: responses || [] });
  } catch (err: any) {
    console.error('[api/participation-responses] Error:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
