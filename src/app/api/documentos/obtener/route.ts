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
      const {
        data: { user: tokenUser },
        error: tokenError,
      } = await supabaseAdmin.auth.getUser(token);
      if (!tokenError && tokenUser) {
        user = tokenUser;
      }
    }

    // Fallback: try cookie-based session via anon client
    if (!user) {
      const anonClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
      );
      const cookieHeader = request.headers.get('cookie') || '';
      // Parse Supabase auth token from cookies
      const tokenMatch = cookieHeader.match(/sb-[^-]+-auth-token=([^;]+)/);
      if (tokenMatch) {
        try {
          const decoded = decodeURIComponent(tokenMatch[1]);
          const parsed = JSON.parse(decoded);
          const accessToken = parsed?.access_token || parsed?.[0]?.access_token;
          if (accessToken) {
            const {
              data: { user: cookieUser },
            } = await supabaseAdmin.auth.getUser(accessToken);
            if (cookieUser) user = cookieUser;
          }
        } catch (_) {}
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    // Fetch document using service role (bypasses RLS)
    const { data: doc, error: docError } = await supabaseAdmin
      .from('documentos')
      .select(
        'id, documento_id, nombre, estado, owner_id, file_url, file_size, file_type, file_hash_sha256, es_publico, legal_hold, legal_hold_status, created_at, updated_at, fecha_vencimiento, carpeta_id, campos_solicitados, workspace_id, cancelacion_motivo, cancelacion_descripcion, cancelado_at, fecha_completado, participantes, sealed_pdf_path, xml_evidencia_path, xml_hash_sha256, xml_generated_at'
      )
      .eq('id', documentoId)
      .single();

    if (docError || !doc) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    // Verify access: user must be owner or participant
    const isOwner = doc.owner_id === user.id;
    const participantes: any[] = doc.participantes || [];
    const userEmail = user.email?.toLowerCase() || '';
    const isParticipant = participantes.some(
      (p: any) => (p.email && p.email.toLowerCase() === userEmail) || p.id === user.id
    );

    if (!isOwner && !isParticipant) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    }

    return NextResponse.json({ data: doc });
  } catch (err: any) {
    console.error('[api/documentos/obtener] Error:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
