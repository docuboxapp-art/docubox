import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Reliable two-step workspace lookup: first get all workspace_ids for user,
// then find which one is personal type.
async function resolvePersonalWorkspace(userId: string): Promise<string | null> {
  try {
    // Step 1: get all workspace_ids the user belongs to
    const { data: memberships, error: memberErr } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId);

    if (memberErr || !memberships || memberships.length === 0) return null;

    const workspaceIds = memberships.map((m: any) => m.workspace_id);

    // Step 2: find the personal workspace among those
    const { data: personalWs, error: wsErr } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .in('id', workspaceIds)
      .eq('workspace_type', 'personal')
      .limit(1)
      .maybeSingle();

    if (wsErr || !personalWs) return null;
    return personalWs.id;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Verify authenticated user via JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await req.json();
    const {
      documentoId,
      draftDbId,
      fileName,
      fileSize,
      fileType,
      fileHash,
      nombre,
      descripcion,
      numeroOficio,
      grupotipoId,
      tipoDocumentoId,
      ruta,
      etiquetasIds,
      currentStep,
      participationOrder,
      participantMode,
      participants,
      workspaceId,
      // Security
      vencimientoEnabled,
      fechaVencimiento,
      codigoAccesoEnabled,
      proteccionAdicionalEnabled,
      legalHoldEnabled,
      impedirImpresion,
      evitarCopiaTexto,
      impedirModificacion,
      impedirExtraccion,
      evitarMontaje,
      recordatorioFrecuencia,
      urgente,
      publico,
      selloDigital,
      estampaAutenticacion,
      metadatosAdicionales,
      otroTipoDocumento,
      camposSolicitados,
    } = body;

    // Resolve workspace_id using reliable two-step lookup
    let resolvedWorkspaceId: string | null = workspaceId || null;

    // Verify provided workspaceId actually belongs to this user
    if (resolvedWorkspaceId) {
      const { data: wCheck } = await supabaseAdmin
        .from('workspace_members')
        .select('workspace_id')
        .eq('workspace_id', resolvedWorkspaceId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!wCheck) resolvedWorkspaceId = null;
    }

    // If no valid workspace provided, find the user's personal workspace
    if (!resolvedWorkspaceId) {
      resolvedWorkspaceId = await resolvePersonalWorkspace(user.id);
    }

    const payload: Record<string, unknown> = {
      owner_id: user.id,
      workspace_id: resolvedWorkspaceId,
      file_name: fileName,
      file_size: fileSize,
      file_type: fileType || 'application/octet-stream',
      nombre: nombre || fileName?.replace(/\.[^/.]+$/, '') || 'Sin nombre',
      descripcion: descripcion || null,
      numero_oficio: numeroOficio || null,
      grupo_tipo_documento_id: grupotipoId || null,
      tipo_documento_id: tipoDocumentoId || null,
      otro_tipo_documento: (tipoDocumentoId === '__otros__' ? (body.otroTipoDocumento || null) : null),
      ruta_guardado: ruta || 'raiz',
      etiquetas_ids: etiquetasIds || [],
      estado: 'borrador',
      ultimo_paso: currentStep || 1,
      participation_order: participationOrder || null,
      participant_mode: participantMode || null,
      participantes: participants || [],
      tiene_vencimiento: vencimientoEnabled ?? false,
      fecha_vencimiento: fechaVencimiento || null,
      tiene_codigo_acceso: codigoAccesoEnabled ?? false,
      proteccion_firmado: proteccionAdicionalEnabled ?? false,
      legal_hold: legalHoldEnabled ?? false,
      impedir_impresion: impedirImpresion ?? false,
      evitar_copia_texto: evitarCopiaTexto ?? false,
      impedir_modificacion: impedirModificacion ?? false,
      impedir_extraccion: impedirExtraccion ?? false,
      evitar_montaje: evitarMontaje ?? false,
      recordatorio_frecuencia: recordatorioFrecuencia || null,
      es_urgente: urgente ?? false,
      es_publico: publico ?? false,
      sello_digital: selloDigital ?? false,
      estampa_autenticacion: estampaAutenticacion ?? false,
      metadatos_adicionales: metadatosAdicionales ?? false,
      campos_solicitados: camposSolicitados || [],
    };

    let result: { data: unknown; error: any } = { data: null, error: null };

    if (draftDbId) {
      // Update existing draft
      result = await supabaseAdmin
        .from('documentos')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', draftDbId)
        .eq('owner_id', user.id)
        .select()
        .single();
    } else {
      // Insert new draft
      result = await supabaseAdmin
        .from('documentos')
        .insert({
          ...payload,
          documento_id: documentoId,
          file_hash_sha256: fileHash || 'draft',
        })
        .select()
        .single();
    }

    const { data, error } = result;

    if (error) {
      console.error('[DOCUBOX][borrador] Error saving borrador:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[DOCUBOX][borrador] Unexpected error saving borrador:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
