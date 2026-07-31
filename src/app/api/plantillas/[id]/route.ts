import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data, error } = await supabase
      .from('plantillas')
      .select('*, tipo_documento:tipo_documento_id(id, nombre), grupo_tipo:grupo_tipo_id(id, nombre)')
      .eq('id', id)
      .eq('created_by', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('Plantilla GET by ID error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const body = await request.json();

    const payload: Record<string, unknown> = {};

    if (body.nombre !== undefined) payload.nombre = body.nombre;
    if (body.descripcion !== undefined) payload.descripcion = body.descripcion;
    if (body.numeroOficio !== undefined) payload.numero_oficio = body.numeroOficio;
    if (body.areaResponsable !== undefined) payload.area_responsable = body.areaResponsable;
    if (body.tipoPlantilla !== undefined) payload.tipo_plantilla = body.tipoPlantilla;
    if (body.etiquetasIds !== undefined) payload.etiquetas_ids = body.etiquetasIds;
    if (body.tipoDocumentoId !== undefined) payload.tipo_documento_id = body.tipoDocumentoId || null;
    if (body.grupotipoId !== undefined) payload.grupo_tipo_id = body.grupotipoId || null;
    if (body.hojaTamano !== undefined) payload.hoja_tamano = body.hojaTamano;
    if (body.hojaOrientacion !== undefined) payload.hoja_orientacion = body.hojaOrientacion;
    if (body.contenidoHtml !== undefined) payload.contenido_html = body.contenidoHtml;
    if (body.camposInsertados !== undefined) payload.campos_insertados = body.camposInsertados;
    if (body.publicacionOpcion !== undefined) payload.publicacion_opcion = body.publicacionOpcion;
    if (body.comentarioPublicacion !== undefined) payload.comentario_publicacion = body.comentarioPublicacion;
    if (body.estadoPlantilla !== undefined) payload.estado_plantilla = body.estadoPlantilla;
    if (body.versionPublicada !== undefined) payload.version_publicada = body.versionPublicada;
    if (body.estado !== undefined) payload.estado = body.estado;
    if (body.category !== undefined) payload.category = body.category;
    if (body.fields !== undefined) payload.fields = body.fields;
    if (body.content !== undefined) payload.content = body.content;
    if (body.signerRoles !== undefined) payload.signer_roles = body.signerRoles;
    if (body.margenes !== undefined) payload.margenes = body.margenes;
    if (body.showHeader !== undefined) payload.show_header = body.showHeader;
    if (body.showFooter !== undefined) payload.show_footer = body.showFooter;
    if (body.camposCoordenadas !== undefined) payload.campo_coordenadas = body.camposCoordenadas;

    const { data, error } = await supabase
      .from('plantillas')
      .update(payload)
      .eq('id', id)
      .eq('created_by', user.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating plantilla:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('Plantilla PUT error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { error } = await supabase
      .from('plantillas')
      .delete()
      .eq('id', id)
      .eq('created_by', user.id);

    if (error) {
      console.error('Error deleting plantilla:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Plantilla DELETE error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
