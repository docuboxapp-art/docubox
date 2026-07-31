import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    // Verify authenticated user
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json();
    const { documentos_id, file_name, file_size, mime_type, page_count, pdf_title, pdf_author, pdf_creation_date } = body;

    if (!documentos_id) {
      return NextResponse.json({ error: 'documentos_id es requerido' }, { status: 400 });
    }

    // Verify the user owns this document
    const { data: docRow, error: docError } = await supabaseAdmin
      .from('documentos')
      .select('id, owner_id')
      .eq('id', documentos_id)
      .single();

    if (docError || !docRow) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    if (docRow.owner_id !== user.id) {
      return NextResponse.json({ error: 'No tienes acceso a este documento' }, { status: 403 });
    }

    // Build metadata object
    const metadata: Record<string, unknown> = {
      documentos_id,
      // document_id is nullable since this is the documentos flow
      document_id: null,
      analyzed_at: new Date().toISOString(),
      analysis_version: '1.0',
    };

    // Add PDF-specific fields if available
    if (mime_type === 'application/pdf') {
      if (page_count != null) metadata.pdf_page_count = page_count;
      // pdf_is_native, pdf_has_acroform, etc. require server-side PDF parsing
      // We store what we know from the client
      metadata.pdf_metadata_raw = {
        file_name: file_name ?? null,
        file_size_bytes: file_size ?? null,
        mime_type: mime_type ?? null,
        pdf_title: pdf_title ?? null,
        pdf_author: pdf_author ?? null,
        pdf_creation_date: pdf_creation_date ?? null,
        analyzed_from: 'client_upload',
      };
    } else {
      // Non-PDF: store basic info
      metadata.pdf_metadata_raw = {
        file_name: file_name ?? null,
        file_size_bytes: file_size ?? null,
        mime_type: mime_type ?? null,
        analyzed_from: 'client_upload',
      };
    }

    // Upsert metadata (in case it already exists for this document)
    const { data: upsertData, error: upsertError } = await supabaseAdmin
      .from('document_metadata')
      .upsert(metadata, { onConflict: 'documentos_id' })
      .select()
      .single();

    if (upsertError) {
      console.error('[DOCUBOX][metadata] Error al guardar metadatos:', upsertError.message);
      return NextResponse.json(
        { error: 'Error al guardar metadatos', detail: upsertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, metadata: upsertData }, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[DOCUBOX][metadata] Error inesperado:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const documentosId = searchParams.get('documentos_id');

    if (!documentosId) {
      return NextResponse.json({ error: 'documentos_id es requerido' }, { status: 400 });
    }

    // Verify ownership
    const { data: docRow, error: docError } = await supabaseAdmin
      .from('documentos')
      .select('id, owner_id')
      .eq('id', documentosId)
      .single();

    if (docError || !docRow) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    if (docRow.owner_id !== user.id) {
      return NextResponse.json({ error: 'No tienes acceso a este documento' }, { status: 403 });
    }

    const { data: metaData, error: metaError } = await supabaseAdmin
      .from('document_metadata')
      .select('*')
      .eq('documentos_id', documentosId)
      .maybeSingle();

    if (metaError) {
      return NextResponse.json({ error: metaError.message }, { status: 500 });
    }

    if (!metaData) {
      return NextResponse.json({ error: 'No se encontraron metadatos para este documento' }, { status: 404 });
    }

    return NextResponse.json({ metadata: metaData }, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
