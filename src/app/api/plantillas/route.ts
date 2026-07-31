import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    let query = supabase
      .from('plantillas')
      .select('*, tipo_documento:tipo_documento_id(id, nombre), grupo_tipo:grupo_tipo_id(id, nombre)')
      .eq('created_by', user.id)
      .order('updated_at', { ascending: false });

    if (status) query = query.eq('estado', status);
    if (search) query = query.ilike('nombre', `%${search}%`);

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching plantillas:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('Plantillas GET error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const body = await request.json();

    // Get workspace_id
    const { data: wsMember } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    const payload = {
      nombre: body.nombre || 'Nueva Plantilla',
      descripcion: body.descripcion || null,
      numero_oficio: body.numeroOficio || null,
      area_responsable: body.areaResponsable || null,
      tipo_plantilla: body.tipoPlantilla || null,
      etiquetas_ids: body.etiquetasIds || [],
      tipo_documento_id: body.tipoDocumentoId || null,
      grupo_tipo_id: body.grupotipoId || null,
      hoja_tamano: body.hojaTamano || 'Carta (Letter)',
      hoja_orientacion: body.hojaOrientacion || 'vertical',
      contenido_html: body.contenidoHtml || null,
      campos_insertados: body.camposInsertados || [],
      publicacion_opcion: body.publicacionOpcion || 'borrador',
      comentario_publicacion: body.comentarioPublicacion || null,
      estado_plantilla: body.estadoPlantilla || 'Borrador',
      version_publicada: body.versionPublicada || '1.0',
      estado: body.estado || 'draft',
      category: body.category || null,
      fields: body.fields || [],
      content: body.content || {},
      signer_roles: body.signerRoles || [],
      margenes: body.margenes || { top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 },
      show_header: body.showHeader || false,
      show_footer: body.showFooter || false,
      campo_coordenadas: body.camposCoordenadas || [],
      created_by: user.id,
      workspace_id: wsMember?.workspace_id || null,
    };

    const { data, error } = await supabase
      .from('plantillas')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('Error creating plantilla:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('Plantillas POST error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
