import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LEGAL_HOLD_REASONS = new Set([
  'litigio',
  'requerimiento_autoridad',
  'auditoria_investigacion',
  'prevencion_eliminacion',
  'otro',
]);

function getLegalHoldReason(value: unknown) {
  return typeof value === 'string' && LEGAL_HOLD_REASONS.has(value) ? value : null;
}

function isAdditionalMetadataColumnMissing(
  error: { code?: string | null; message?: string | null } | null
) {
  if (!error) return false;
  const message = error.message || '';
  return (
    error.code === 'PGRST204' ||
    (/additional_metadata/i.test(message) && /schema cache|does not exist/i.test(message))
  );
}

async function isAdditionalMetadataColumnReady() {
  const result = await supabaseAdmin.from('documentos').select('additional_metadata').limit(1);

  if (result.error) {
    if (isAdditionalMetadataColumnMissing(result.error)) return false;
    throw result.error;
  }

  return true;
}

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

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
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
      impedirImpresion,
      evitarCopiaTexto,
      impedirModificacion,
      impedirExtraccion,
      evitarMontaje,
      legalHoldEnabled,
      legalHoldReason,
      recordatorioFrecuencia,
      urgente,
      publico,
      selloDigital,
      estampaAutenticacion,
      metadatosAdicionales,
      additionalMetadata,
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

    const resolvedOtherDocumentType =
      tipoDocumentoId === '__otros__'
        ? otroTipoDocumento || null
        : tipoDocumentoId
          ? null
          : 'No especificado';
    const normalizedAdditionalMetadata = Array.isArray(additionalMetadata)
      ? additionalMetadata
      : [];
    const requestedLegalHold = legalHoldEnabled === true;
    const validLegalHoldReason = getLegalHoldReason(legalHoldReason);

    if (requestedLegalHold && !validLegalHoldReason) {
      return NextResponse.json(
        {
          error: 'Selecciona un motivo válido para aplicar Legal Hold.',
          code: 'LEGAL_HOLD_REASON_REQUIRED',
        },
        { status: 400 }
      );
    }

    let legalHoldAlreadyActive = false;
    if (requestedLegalHold && draftDbId) {
      const existing = await supabaseAdmin
        .from('documentos')
        .select('legal_hold,legal_hold_status')
        .eq('id', draftDbId)
        .eq('owner_id', user.id)
        .maybeSingle();
      if (existing.error) throw existing.error;
      legalHoldAlreadyActive =
        existing.data?.legal_hold === true || existing.data?.legal_hold_status === 'ACTIVE';
    }

    if (normalizedAdditionalMetadata.length > 0 && !(await isAdditionalMetadataColumnReady())) {
      return NextResponse.json(
        {
          error:
            'Los metadatos adicionales requieren actualizar la base de datos antes de guardar el borrador.',
          code: 'ADDITIONAL_METADATA_MIGRATION_REQUIRED',
        },
        { status: 503 }
      );
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
      otro_tipo_documento: resolvedOtherDocumentType,
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
      impedir_impresion: impedirImpresion ?? false,
      evitar_copia_texto: evitarCopiaTexto ?? false,
      impedir_modificacion: impedirModificacion ?? false,
      impedir_extraccion: impedirExtraccion ?? false,
      evitar_montaje: evitarMontaje ?? false,
      recordatorio_frecuencia: recordatorioFrecuencia || null,
      es_urgente: urgente ?? false,
      priority: urgente === true ? 'urgent' : 'normal',
      es_publico: publico ?? false,
      sello_digital: selloDigital ?? false,
      estampa_autenticacion: estampaAutenticacion ?? false,
      metadatos_adicionales: metadatosAdicionales ?? false,
      campos_solicitados: camposSolicitados || [],
    };
    if (normalizedAdditionalMetadata.length > 0) {
      payload.additional_metadata = normalizedAdditionalMetadata;
    }
    if (requestedLegalHold && !legalHoldAlreadyActive) {
      const now = new Date().toISOString();
      payload.legal_hold = true;
      payload.legal_hold_status = 'ACTIVE';
      payload.legal_hold_reason = validLegalHoldReason;
      payload.legal_hold_created_at = now;
      payload.legal_hold_created_by = user.id;
      payload.legal_hold_released_at = null;
      payload.legal_hold_released_by = null;
      payload.legal_hold_release_reason = null;
    }

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

    if (requestedLegalHold && !legalHoldAlreadyActive && data) {
      const document = data as { id: string; workspace_id?: string | null };
      const { error: auditError } = await supabaseAdmin
        .from('document_lifecycle_audit_events')
        .insert({
          workspace_id: document.workspace_id || resolvedWorkspaceId,
          document_id: document.id,
          actor_id: user.id,
          actor_email: user.email || null,
          action: 'LEGAL_HOLD_ACTIVATED',
          previous_state: { legal_hold: false, legal_hold_status: 'NONE' },
          new_state: {
            legal_hold: true,
            legal_hold_status: 'ACTIVE',
            reason: validLegalHoldReason,
          },
          reason: validLegalHoldReason,
          result: 'success',
          request_id: req.headers.get('x-request-id') || null,
          ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
          user_agent: req.headers.get('user-agent') || null,
        });
      if (auditError) {
        console.error('[DOCUBOX][borrador] Legal Hold audit failed:', auditError.message);
        return NextResponse.json(
          {
            error: 'No fue posible registrar la auditoría de Legal Hold.',
            code: 'LEGAL_HOLD_AUDIT_FAILED',
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ data, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[DOCUBOX][borrador] Unexpected error saving borrador:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
