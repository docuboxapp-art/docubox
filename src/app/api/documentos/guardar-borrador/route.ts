import { NextRequest, NextResponse } from 'next/server';
import { isSupportedTimeZone, toUtcIsoTimestamp } from '@/lib/datetime';
import { createClient } from '@supabase/supabase-js';
import {
  activateLegalHold,
  LEGAL_HOLD_REASON_LABELS,
  type LegalHoldReasonCode,
} from '@/lib/documents/legal-hold';
import { requestFingerprint } from '@/lib/security/document-view-access';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getLegalHoldReason(value: unknown) {
  return typeof value === 'string' && value in LEGAL_HOLD_REASON_LABELS
    ? (value as LegalHoldReasonCode)
    : null;
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
      fechaVencimientoTimezone,
      codigoAccesoEnabled,
      codigoAcceso,
      proteccionAdicionalEnabled,
      impedirImpresion,
      evitarCopiaTexto,
      impedirModificacion,
      impedirExtraccion,
      evitarMontaje,
      legalHoldEnabled,
      legalHoldReason,
      legalHoldCaseReference,
      legalHoldReviewAt,
      legalHoldNotes,
      recordatorioFrecuencia,
      urgente,
      publico,
      selloDigital,
      selloUbicacion,
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
    const expirationTimezone =
      typeof fechaVencimientoTimezone === 'string' && isSupportedTimeZone(fechaVencimientoTimezone)
        ? fechaVencimientoTimezone
        : 'UTC';
    const expirationAt =
      vencimientoEnabled && fechaVencimiento ? toUtcIsoTimestamp(fechaVencimiento) : null;

    if (vencimientoEnabled && !expirationAt) {
      return NextResponse.json(
        {
          error: 'La fecha y hora de vencimiento debe definir un instante UTC válido.',
          code: 'INVALID_EXPIRATION',
        },
        { status: 400 }
      );
    }

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
        .from('document_legal_holds')
        .select('id')
        .eq('document_id', draftDbId)
        .eq('status', 'ACTIVE')
        .limit(1)
        .maybeSingle();
      if (existing.error) throw existing.error;
      legalHoldAlreadyActive = Boolean(existing.data);
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
      fecha_vencimiento: expirationAt,
      fecha_vencimiento_timezone: expirationAt ? expirationTimezone : null,
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
      sello_ubicacion: selloUbicacion === 'libre' ? 'libre' : 'calce',
      estampa_autenticacion: estampaAutenticacion ?? false,
      blockchain_evidence_enabled: true,
      metadatos_adicionales: metadatosAdicionales ?? false,
      campos_solicitados: camposSolicitados || [],
    };
    if (normalizedAdditionalMetadata.length > 0) {
      payload.additional_metadata = normalizedAdditionalMetadata;
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
      await activateLegalHold({
        service: supabaseAdmin,
        documentId: document.id,
        actor: user,
        request: req,
        hold: {
          reasonCode: validLegalHoldReason!,
          caseReference: legalHoldCaseReference,
          notes: legalHoldNotes,
          reviewAt: legalHoldReviewAt || null,
        },
      });
    }

    if (codigoAccesoEnabled === true && typeof codigoAcceso === 'string' && codigoAcceso) {
      const document = data as { id: string; owner_id: string; workspace_id?: string | null };
      const fingerprint = requestFingerprint(req);
      const protection = await supabaseAdmin.rpc('configure_document_view_access', {
        p_document_id: document.id,
        p_tenant_id: document.workspace_id || document.owner_id,
        p_document_owner_id: document.owner_id,
        p_actor_id: user.id,
        p_actor_email: user.email || null,
        p_code: codigoAcceso,
        p_request_id: fingerprint.requestId,
        p_ip_address: fingerprint.ip === 'unknown' ? null : fingerprint.ip,
        p_user_agent: fingerprint.userAgent,
      });
      if (protection.error) throw protection.error;
    }

    return NextResponse.json({ data, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[DOCUBOX][borrador] Unexpected error saving borrador:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
