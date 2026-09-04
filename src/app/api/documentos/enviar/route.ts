import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import {
  isEmailNotificationEnabled,
  sendParticipantInvitationEmails,
} from '@/lib/emailNotifications';
import { createNotificationServer } from '@/lib/notificationsInApp.server';
import { findUnsupportedOrganizationSignatureMethods } from '@/lib/organization/governance';
import { initializeCollaborationDocumentVersion } from '@/lib/collaboration/documents';
import {
  InternalSourceError,
  resolveInternalDocumentSource,
  type ResolvedInternalSource,
} from '@/lib/documents/internal-source';
import { getParticipantPortalUrl } from '@/lib/publicAppUrl';
import {
  documentEncryptionPolicy,
  encryptAndUploadDocumentObject,
  readDocumentStorageObject,
} from '@/lib/crypto/document-encryption';

type OrganizationGovernance = {
  workflow: Record<string, any> | null;
  signaturePolicy: Record<string, any> | null;
  snapshot: Record<string, any>;
};

const ADDITIONAL_METADATA_TYPES = new Set([
  'text',
  'number',
  'currency',
  'date',
  'datetime',
  'boolean',
  'list',
  'rfc',
  'curp',
  'email',
  'identifier',
  'reference',
]);

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

type NormalizedAdditionalMetadata = {
  id: string;
  name: string;
  dataType: string;
  value: string | boolean;
  scope: 'document' | 'management';
};

function isAdditionalMetadataSchemaMissing(
  error: { code?: string | null; message?: string | null } | null
) {
  if (!error) return false;
  const message = error.message || '';
  return (
    error.code === 'PGRST204' ||
    (/additional_metadata|document_additional_metadata/i.test(message) &&
      /schema cache|does not exist|relation/i.test(message))
  );
}

async function isAdditionalMetadataSchemaReady() {
  const documentColumn = await supabaseAdmin
    .from('documentos')
    .select('additional_metadata')
    .limit(1);

  if (documentColumn.error) {
    if (isAdditionalMetadataSchemaMissing(documentColumn.error)) return false;
    throw documentColumn.error;
  }

  const metadataTable = await supabaseAdmin
    .from('document_additional_metadata')
    .select('id')
    .limit(1);

  if (metadataTable.error) {
    if (isAdditionalMetadataSchemaMissing(metadataTable.error)) return false;
    throw metadataTable.error;
  }

  return true;
}

function normalizeAdditionalMetadata(value: unknown): NormalizedAdditionalMetadata[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 30) throw new Error('Puedes agregar hasta 30 metadatos adicionales.');

  const names = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object')
      throw new Error(`El metadato ${index + 1} no es válido.`);
    const raw = entry as Record<string, unknown>;
    const name = String(raw.name || '').trim();
    const dataType = String(raw.dataType || '')
      .trim()
      .toLowerCase();
    const scope =
      raw.scope === 'management' ? 'management' : raw.scope === 'document' ? 'document' : null;
    const metadataValue =
      typeof raw.value === 'boolean' ? raw.value : String(raw.value ?? '').trim();
    const id = String(raw.id || randomUUID()).trim();

    if (!name || name.length > 120)
      throw new Error(`El nombre del metadato ${index + 1} no es válido.`);
    if (!ADDITIONAL_METADATA_TYPES.has(dataType))
      throw new Error(`El tipo de dato de "${name}" no es válido.`);
    if (!scope) throw new Error(`El alcance de "${name}" no es válido.`);
    if (dataType !== 'boolean' && !metadataValue)
      throw new Error(`Indica un valor para "${name}".`);
    if (typeof metadataValue === 'string' && metadataValue.length > 2000)
      throw new Error(`El valor de "${name}" es demasiado largo.`);
    if (
      ['number', 'currency'].includes(dataType) &&
      (typeof metadataValue !== 'string' || !Number.isFinite(Number(metadataValue)))
    )
      throw new Error(`El valor de "${name}" debe ser numérico.`);
    if (
      dataType === 'date' &&
      (typeof metadataValue !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(metadataValue) ||
        Number.isNaN(Date.parse(`${metadataValue}T00:00:00Z`)))
    )
      throw new Error(`La fecha de "${name}" no es válida.`);
    if (
      dataType === 'datetime' &&
      (typeof metadataValue !== 'string' || Number.isNaN(Date.parse(metadataValue)))
    )
      throw new Error(`La fecha y hora de "${name}" no es válida.`);
    if (
      dataType === 'email' &&
      (typeof metadataValue !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(metadataValue))
    )
      throw new Error(`El correo de "${name}" no es válido.`);
    if (
      dataType === 'rfc' &&
      (typeof metadataValue !== 'string' || !/^[A-Z&Ñ]{3,4}\d{6}[A-Z\d]{3}$/i.test(metadataValue))
    )
      throw new Error(`El RFC de "${name}" no es válido.`);
    if (
      dataType === 'curp' &&
      (typeof metadataValue !== 'string' ||
        !/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d$/i.test(metadataValue))
    )
      throw new Error(`La CURP de "${name}" no es válida.`);

    const normalizedName = name.toLocaleLowerCase();
    if (names.has(normalizedName)) throw new Error(`El metadato "${name}" está duplicado.`);
    names.add(normalizedName);
    return { id, name, dataType, value: metadataValue, scope };
  });
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Reliable two-step workspace lookup
async function resolvePersonalWorkspace(userId: string): Promise<string | null> {
  try {
    let { data: memberships, error: memberErr } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (memberErr?.message?.includes('status')) {
      const legacy = await supabaseAdmin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', userId);
      memberships = legacy.data;
      memberErr = legacy.error;
    }

    if (memberErr || !memberships || memberships.length === 0) return null;

    const workspaceIds = memberships.map((m: any) => m.workspace_id);

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

async function resolveOrganizationGovernance(
  workspaceId: string
): Promise<OrganizationGovernance | null> {
  const workspace = await supabaseAdmin
    .from('workspaces')
    .select('workspace_type,organization_enabled,organization_settings')
    .eq('id', workspaceId)
    .maybeSingle();

  // Compatibility while the incremental organization migrations are pending.
  if (workspace.error?.message?.includes('organization_')) return null;
  if (workspace.error) throw workspace.error;
  if (
    !workspace.data ||
    workspace.data.workspace_type !== 'business' ||
    !workspace.data.organization_enabled
  ) {
    return null;
  }

  const settings = (workspace.data.organization_settings || {}) as Record<string, unknown>;
  const workflowId =
    typeof settings.default_workflow_id === 'string' ? settings.default_workflow_id : null;
  const policyId =
    typeof settings.default_signature_policy_id === 'string'
      ? settings.default_signature_policy_id
      : null;
  if (!workflowId && !policyId) return null;

  const [workflowResult, policyResult] = await Promise.all([
    workflowId
      ? supabaseAdmin
          .from('organization_approval_workflows')
          .select('id,name,version,definition,document_type,applicable_areas,status')
          .eq('workspace_id', workspaceId)
          .eq('id', workflowId)
          .eq('status', 'published')
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    policyId
      ? supabaseAdmin
          .from('organization_signature_policies')
          .select(
            'id,name,version,security_level,allowed_signature_types,resource_scope,requirements,status'
          )
          .eq('workspace_id', workspaceId)
          .eq('id', policyId)
          .eq('status', 'published')
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (workflowResult.error) throw workflowResult.error;
  if (policyResult.error) throw policyResult.error;
  if (workflowId && !workflowResult.data) {
    throw new Error(
      'El flujo predeterminado ya no está publicado. Actualiza el gobierno de la organización.'
    );
  }
  if (policyId && !policyResult.data) {
    throw new Error(
      'La política de firma predeterminada ya no está publicada. Actualiza el gobierno de la organización.'
    );
  }

  const appliedAt = new Date().toISOString();
  return {
    workflow: workflowResult.data,
    signaturePolicy: policyResult.data,
    snapshot: {
      schema_version: 1,
      applied_at: appliedAt,
      source: 'organization_defaults',
      precedence: ['document', 'template', 'unit', 'organization', 'docubox_default'],
      workflow: workflowResult.data,
      signature_policy: policyResult.data,
    },
  };
}

function validateSignaturePolicy(participants: any[], policy: Record<string, any> | null) {
  if (!policy) return;
  const unsupported = findUnsupportedOrganizationSignatureMethods(
    participants,
    policy.allowed_signature_types || []
  );
  if (unsupported.length) {
    throw new Error(
      `La política "${policy.name}" no permite los métodos seleccionados: ${unsupported.join(', ')}.`
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // Verify authenticated user via JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const metaRaw = formData.get('meta') as string | null;

    if (!metaRaw) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    const {
      documentoId,
      fileName,
      fileSize,
      fileType,
      fileHashSha256,
      nombre,
      descripcion,
      numeroOficio,
      grupotipoId,
      tipoDocumentoId,
      ruta,
      etiquetasIds,
      participantes,
      camposSolicitados,
      workspaceId,
      otroTipoDocumento,
      participationOrder,
      gruposFirma,
      publico,
      selloDigital,
      estampaAutenticacion,
      legalHoldEnabled,
      legalHoldReason,
      urgente,
      metadatosAdicionales,
      additionalMetadata,
      docuboxSource,
    } = JSON.parse(metaRaw);

    if (!documentoId || !fileName || !fileHashSha256) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

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
    if (requestedLegalHold) {
      const existing = await supabaseAdmin
        .from('documentos')
        .select('legal_hold,legal_hold_status')
        .eq('documento_id', documentoId)
        .maybeSingle();
      if (existing.error) throw existing.error;
      legalHoldAlreadyActive =
        existing.data?.legal_hold === true || existing.data?.legal_hold_status === 'ACTIVE';
    }

    let normalizedAdditionalMetadata: NormalizedAdditionalMetadata[];
    try {
      normalizedAdditionalMetadata = normalizeAdditionalMetadata(additionalMetadata);
    } catch (metadataError) {
      return NextResponse.json(
        {
          error:
            metadataError instanceof Error
              ? metadataError.message
              : 'Los metadatos adicionales no son válidos.',
        },
        { status: 400 }
      );
    }

    const hasAdditionalMetadata = normalizedAdditionalMetadata.length > 0;
    if (hasAdditionalMetadata && !(await isAdditionalMetadataSchemaReady())) {
      return NextResponse.json(
        {
          error:
            'Los metadatos adicionales requieren actualizar la base de datos antes de crear el documento.',
          code: 'ADDITIONAL_METADATA_MIGRATION_REQUIRED',
        },
        { status: 503 }
      );
    }

    // Resolve workspace_id using reliable two-step lookup
    let resolvedWorkspaceId: string | null = workspaceId || null;

    // Verify provided workspaceId actually belongs to this user
    if (resolvedWorkspaceId) {
      let { data: wCheck, error: membershipError } = await supabaseAdmin
        .from('workspace_members')
        .select('workspace_id')
        .eq('workspace_id', resolvedWorkspaceId)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (membershipError?.message?.includes('status')) {
        const legacy = await supabaseAdmin
          .from('workspace_members')
          .select('workspace_id')
          .eq('workspace_id', resolvedWorkspaceId)
          .eq('user_id', user.id)
          .maybeSingle();
        wCheck = legacy.data;
        membershipError = legacy.error;
      }
      if (!wCheck) resolvedWorkspaceId = null;
    }

    // If no valid workspace provided, find the user's personal workspace
    if (!resolvedWorkspaceId) {
      resolvedWorkspaceId = await resolvePersonalWorkspace(user.id);
    }

    let resolvedInternalSource: ResolvedInternalSource | null = null;
    if (docuboxSource) {
      if (!resolvedWorkspaceId || docuboxSource.workspaceId !== resolvedWorkspaceId) {
        return NextResponse.json(
          { error: 'El documento de origen no pertenece al espacio de trabajo activo.' },
          { status: 403 }
        );
      }
      resolvedInternalSource = await resolveInternalDocumentSource(supabaseAdmin, user, {
        workspaceId: resolvedWorkspaceId,
        documentId: docuboxSource.documentId,
        versionId: docuboxSource.versionId || null,
        variant: docuboxSource.variant,
      });
      if (
        docuboxSource.expectedSha256 &&
        resolvedInternalSource.sha256 !== String(docuboxSource.expectedSha256).toLowerCase()
      ) {
        return NextResponse.json(
          { error: 'La version de origen cambio desde que fue seleccionada. Vuelve a elegirla.' },
          { status: 409 }
        );
      }
    }

    const effectiveFileName = resolvedInternalSource?.fileName || fileName;
    let effectiveFileSize = resolvedInternalSource?.fileSize ?? fileSize;
    const effectiveFileType =
      resolvedInternalSource?.fileType || fileType || 'application/octet-stream';
    let effectiveFileHash = resolvedInternalSource?.sha256 || String(fileHashSha256).toLowerCase();
    let uploadedFileBuffer: ArrayBuffer | null = null;

    if (!resolvedInternalSource) {
      if (!file) {
        return NextResponse.json(
          { error: 'El archivo a enviar no está disponible.' },
          { status: 400 }
        );
      }

      // The server is the source of truth: the hash must describe the exact
      // bytes persisted in Storage, including any client-side PDF sanitization.
      uploadedFileBuffer = await file.arrayBuffer();
      effectiveFileSize = uploadedFileBuffer.byteLength;
      effectiveFileHash = createHash('sha256')
        .update(Buffer.from(uploadedFileBuffer))
        .digest('hex');
    }

    const governance = resolvedWorkspaceId
      ? await resolveOrganizationGovernance(resolvedWorkspaceId)
      : null;
    validateSignaturePolicy(participantes || [], governance?.signaturePolicy || null);

    // Upsert document record using service role (bypasses RLS)
    // ── Determine initial visible participants based on participation order ──
    const TERMINAL_SUB_ESTADOS_ENVIAR = [
      'firmo',
      'firmado',
      'aprobo',
      'aprobado',
      'rechazo',
      'rechazado',
      'cancelo',
      'cancelado',
    ];
    function isTerminalEnviar(sub: string): boolean {
      return TERMINAL_SUB_ESTADOS_ENVIAR.includes((sub ?? '').toLowerCase());
    }

    function getInitialVisibleParticipants(parts: any[], order: string, grupos: any[]): any[] {
      const nonOwner = parts.filter((p: any) => !p.isCurrentUser);
      if (!order || order === 'paralelo') {
        return nonOwner;
      }
      if (order === 'secuencial') {
        const first = nonOwner[0];
        return first ? [first] : [];
      }
      if (order === 'mixto' && grupos && grupos.length > 0) {
        const firstGrupo = grupos[0];
        const grupoTipo = firstGrupo?.tipo ?? 'paralelo';
        const grupoIds: string[] = firstGrupo?.participantIds ?? [];
        const grupoParticipants = parts.filter(
          (p: any) => grupoIds.includes(p.id) && !p.isCurrentUser
        );
        if (grupoTipo === 'paralelo') return grupoParticipants;
        if (grupoTipo === 'secuencial') {
          const ordered = grupoIds
            .map((id: string) => parts.find((p: any) => p.id === id))
            .filter(Boolean);
          const first = ordered.find((p: any) => !p.isCurrentUser);
          return first ? [first] : [];
        }
        return grupoParticipants;
      }
      return nonOwner;
    }

    const participantesConPortal = (participantes || []).map((participant: any) => {
      if (participant.isCurrentUser) return participant;
      return {
        ...participant,
        portal_token: participant.portal_token || randomUUID(),
      };
    });

    const effectiveOrder: string = participationOrder || 'paralelo';
    const effectiveGrupos: any[] = gruposFirma || [];
    const initialVisibleIds = new Set(
      getInitialVisibleParticipants(participantesConPortal, effectiveOrder, effectiveGrupos).map(
        (p: any) => p.id
      )
    );

    // Visibility controls workflow access. Notification delivery is confirmed later.
    const participantesConVisibilidad = participantesConPortal.map((p: any) => ({
      ...p,
      visible: p.isCurrentUser ? true : initialVisibleIds.has(p.id),
      notificado: p.isCurrentUser ? true : false,
    }));

    const resolvedOtherDocumentType =
      tipoDocumentoId === '__otros__'
        ? otroTipoDocumento || null
        : tipoDocumentoId
          ? null
          : 'No especificado';

    const documentRecord: Record<string, unknown> = {
      documento_id: documentoId,
      owner_id: user.id,
      workspace_id: resolvedWorkspaceId,
      file_name: effectiveFileName,
      file_size: effectiveFileSize,
      file_type: effectiveFileType,
      file_hash_sha256: effectiveFileHash,
      nombre: nombre || effectiveFileName.replace(/\.[^/.]+$/, ''),
      descripcion: descripcion || null,
      numero_oficio: numeroOficio || null,
      grupo_tipo_documento_id: grupotipoId || null,
      tipo_documento_id: tipoDocumentoId || null,
      otro_tipo_documento: resolvedOtherDocumentType,
      ruta_guardado: ruta || 'raiz',
      etiquetas_ids: etiquetasIds || [],
      estado: 'en_proceso',
      participantes: participantesConVisibilidad,
      campos_solicitados: camposSolicitados || [],
      participation_order: effectiveOrder,
      grupos_firma: effectiveGrupos.length > 0 ? effectiveGrupos : null,
      priority: urgente === true ? 'urgent' : 'normal',
      es_urgente: urgente === true,
      es_publico: publico ?? false,
      sello_digital: selloDigital ?? false,
      estampa_autenticacion: estampaAutenticacion ?? false,
      metadatos_adicionales: metadatosAdicionales ?? false,
    };
    if (hasAdditionalMetadata) {
      documentRecord.additional_metadata = normalizedAdditionalMetadata;
    }
    if (requestedLegalHold && !legalHoldAlreadyActive) {
      const now = new Date().toISOString();
      documentRecord.legal_hold = true;
      documentRecord.legal_hold_status = 'ACTIVE';
      documentRecord.legal_hold_reason = validLegalHoldReason;
      documentRecord.legal_hold_created_at = now;
      documentRecord.legal_hold_created_by = user.id;
      documentRecord.legal_hold_released_at = null;
      documentRecord.legal_hold_released_by = null;
      documentRecord.legal_hold_release_reason = null;
    }
    if (governance) {
      documentRecord.organization_workflow_id = governance.workflow?.id || null;
      documentRecord.organization_signature_policy_id = governance.signaturePolicy?.id || null;
      documentRecord.organization_governance_snapshot = governance.snapshot;
      documentRecord.organization_governance_applied_at = governance.snapshot.applied_at;
    }

    const { error: upsertError } = await supabaseAdmin
      .from('documentos')
      .upsert(documentRecord, { onConflict: 'documento_id' });

    if (upsertError) {
      console.error('[DOCUBOX][enviar] Error en upsert documentos:', upsertError.message);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // Retrieve the DB UUID for the document
    const { data: docRow, error: selectError } = await supabaseAdmin
      .from('documentos')
      .select('id')
      .eq('documento_id', documentoId)
      .single();

    if (selectError || !docRow) {
      console.error('[DOCUBOX][enviar] Error al obtener id del documento:', selectError?.message);
      return NextResponse.json(
        { error: 'No se pudo obtener el id del documento' },
        { status: 500 }
      );
    }

    const dbDocumentId = docRow.id;

    if (requestedLegalHold && !legalHoldAlreadyActive) {
      const { error: auditError } = await supabaseAdmin
        .from('document_lifecycle_audit_events')
        .insert({
          workspace_id: resolvedWorkspaceId,
          document_id: dbDocumentId,
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
          request_id: req.headers.get('x-request-id') || randomUUID(),
          ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
          user_agent: req.headers.get('user-agent') || null,
        });
      if (auditError) {
        console.error('[DOCUBOX][enviar] Legal Hold audit failed:', auditError.message);
        return NextResponse.json(
          {
            error: 'No fue posible registrar la auditoría de Legal Hold.',
            code: 'LEGAL_HOLD_AUDIT_FAILED',
          },
          { status: 500 }
        );
      }
    }

    const documentMetadataSnapshot = normalizedAdditionalMetadata
      .filter((metadata) => metadata.scope === 'document')
      .map(({ name, dataType, value }) => ({ name, dataType, value }));
    const hasDocumentScopedAdditionalMetadata = documentMetadataSnapshot.length > 0;
    const documentMetadataSnapshotHash = hasDocumentScopedAdditionalMetadata
      ? createHash('sha256').update(JSON.stringify(documentMetadataSnapshot)).digest('hex')
      : null;
    const encryptionPolicy = documentEncryptionPolicy();
    const requestId = req.headers.get('x-request-id') || randomUUID();
    let targetVersionId: string | null = null;
    let encryptedVersionCreated = false;

    if (encryptionPolicy.enabled) {
      if (!resolvedWorkspaceId) {
        return NextResponse.json(
          { error: 'El cifrado documental requiere un espacio de trabajo valido.' },
          { status: 503 }
        );
      }
      const requestedVersionId = randomUUID();
      const plannedStoragePath = `tenants/${resolvedWorkspaceId}/documents/${dbDocumentId}/versions/${requestedVersionId}/payload.enc`;
      const versionResult = await initializeCollaborationDocumentVersion({
        service: supabaseAdmin,
        workspaceId: resolvedWorkspaceId,
        documentId: dbDocumentId,
        actorUserId: user.id,
        sha256: effectiveFileHash,
        fileUrl: `/api/documentos/${dbDocumentId}/viewer-file`,
        storagePath: plannedStoragePath,
        mimeType: effectiveFileType,
        byteSize: effectiveFileSize || null,
        displayName: nombre || effectiveFileName,
        sourceVersionId: resolvedInternalSource?.versionId || null,
        requireCollaborationEntitlement: false,
        additionalDocumentMetadataSnapshot: documentMetadataSnapshot,
        additionalDocumentMetadataSnapshotHash: documentMetadataSnapshotHash,
        requestedVersionId,
      });
      if (!versionResult.versionId) {
        return NextResponse.json(
          { error: 'No se pudo reservar la version cifrada del documento.' },
          { status: 500 }
        );
      }
      targetVersionId = versionResult.versionId;
      encryptedVersionCreated = versionResult.created;
    }

    // Upload file to storage using service role (bypasses storage RLS)
    let uploadedStoragePath: string | null = null;
    let uploadedFileUrl: string | null = null;
    if (encryptionPolicy.enabled && targetVersionId) {
      const storagePath = `tenants/${resolvedWorkspaceId}/documents/${dbDocumentId}/versions/${targetVersionId}/payload.enc`;
      let plaintext: Buffer;
      if (resolvedInternalSource) {
        const source = await readDocumentStorageObject({
          service: supabaseAdmin,
          storageBucket: 'documents',
          storagePath: resolvedInternalSource.storagePath,
          expectedPlaintextSha256: resolvedInternalSource.sha256,
          userId: user.id,
          requestId,
        });
        plaintext = source.plaintext;
      } else {
        plaintext = Buffer.from(uploadedFileBuffer || (await file!.arrayBuffer()));
      }
      try {
        const encrypted = await encryptAndUploadDocumentObject({
          service: supabaseAdmin,
          plaintext,
          tenantId: resolvedWorkspaceId!,
          documentId: dbDocumentId,
          documentVersionId: targetVersionId,
          artifactKind: 'document',
          storageBucket: 'documents',
          storagePath,
          originalFileName: effectiveFileName,
          originalMimeType: effectiveFileType,
          userId: user.id,
          requestId,
        });
        if (encrypted.metadata.plaintext_sha256 !== effectiveFileHash) {
          throw new Error('DOCUMENT_PLAINTEXT_HASH_MISMATCH');
        }
      } catch (error) {
        if (encryptedVersionCreated) {
          await supabaseAdmin.storage.from('documents').remove([storagePath]);
          await supabaseAdmin
            .from('document_encryption_metadata')
            .delete()
            .eq('document_version_id', targetVersionId);
          await supabaseAdmin.from('document_versions').delete().eq('id', targetVersionId);
        }
        throw error;
      } finally {
        plaintext.fill(0);
      }
      uploadedStoragePath = storagePath;
      uploadedFileUrl = `/api/documentos/${dbDocumentId}/viewer-file`;
      const documentFileUpdate = await supabaseAdmin
        .from('documentos')
        .update({ file_url: uploadedFileUrl, storage_path: storagePath })
        .eq('id', dbDocumentId);
      if (documentFileUpdate.error) throw documentFileUpdate.error;
    } else if (resolvedInternalSource) {
      uploadedStoragePath = resolvedInternalSource.storagePath;
      const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
        .from('documents')
        .createSignedUrl(resolvedInternalSource.storagePath, 60 * 60 * 24 * 365);
      if (signedUrlError) throw signedUrlError;
      uploadedFileUrl = signedUrlData?.signedUrl || resolvedInternalSource.storagePath;
      const reusedFileUpdate = await supabaseAdmin
        .from('documentos')
        .update({ file_url: uploadedFileUrl, storage_path: resolvedInternalSource.storagePath })
        .eq('id', dbDocumentId);
      if (reusedFileUpdate.error) throw reusedFileUpdate.error;
    } else if (file) {
      const safeFileName = effectiveFileName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9.\-_]/g, '_');

      const wsId = resolvedWorkspaceId || user.id;
      const storagePath = `${wsId}/${dbDocumentId}/${safeFileName}`;
      uploadedStoragePath = storagePath;

      const fileBuffer = uploadedFileBuffer || (await file.arrayBuffer());

      const { error: uploadError } = await supabaseAdmin.storage
        .from('documents')
        .upload(storagePath, fileBuffer, {
          upsert: true,
          contentType: file.type || effectiveFileType,
        });

      if (uploadError) {
        console.error('[DOCUBOX][enviar] Error al subir archivo:', uploadError.message);
        return NextResponse.json(
          { error: uploadError.message || 'Error al subir el archivo' },
          { status: 500 }
        );
      }

      // Save the storage path as file_url so mis-documentos can display/download it
      const { data: signedUrlData } = await supabaseAdmin.storage
        .from('documents')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year

      uploadedFileUrl = signedUrlData?.signedUrl || storagePath;

      const documentFileUpdate = await supabaseAdmin
        .from('documentos')
        .update({ file_url: uploadedFileUrl, storage_path: storagePath })
        .eq('id', dbDocumentId);
      if (documentFileUpdate.error?.message?.includes('storage_path')) {
        await supabaseAdmin
          .from('documentos')
          .update({ file_url: uploadedFileUrl })
          .eq('id', dbDocumentId);
      } else if (documentFileUpdate.error) {
        throw documentFileUpdate.error;
      }
    }

    if (resolvedWorkspaceId && !targetVersionId) {
      try {
        const versionResult = await initializeCollaborationDocumentVersion({
          service: supabaseAdmin,
          workspaceId: resolvedWorkspaceId,
          documentId: dbDocumentId,
          actorUserId: user.id,
          sha256: effectiveFileHash,
          fileUrl: uploadedFileUrl,
          storagePath: uploadedStoragePath,
          mimeType: effectiveFileType,
          byteSize: effectiveFileSize || null,
          displayName: nombre || effectiveFileName,
          sourceVersionId: resolvedInternalSource?.versionId || null,
          // Document-scoped metadata must be attached to a concrete immutable
          // version even when the optional Colabora entitlement is not active.
          requireCollaborationEntitlement: !hasDocumentScopedAdditionalMetadata,
          additionalDocumentMetadataSnapshot: documentMetadataSnapshot,
          additionalDocumentMetadataSnapshotHash: documentMetadataSnapshotHash,
        });
        targetVersionId = versionResult.versionId;
      } catch (collaborationError) {
        // Colabora is additive: a pending migration must not interrupt the signature flow.
        console.error('[DOCUBOX][enviar] No se pudo inicializar Colabora:', collaborationError);
      }
    }

    if (normalizedAdditionalMetadata.length > 0 && resolvedWorkspaceId) {
      const signingStartedAt = new Date().toISOString();
      const metadataRows = normalizedAdditionalMetadata.map((metadata) => {
        const valueJson = metadata.value;
        const valueDisplay =
          metadata.value === true ? 'Sí' : metadata.value === false ? 'No' : metadata.value;
        const snapshotPayload =
          metadata.scope === 'document'
            ? JSON.stringify({
                name: metadata.name,
                data_type: metadata.dataType,
                value: valueJson,
                version: targetVersionId || 1,
              })
            : null;
        return {
          document_id: dbDocumentId,
          workspace_id: resolvedWorkspaceId,
          document_version_id: targetVersionId,
          document_version_number: 1,
          metadata_scope: metadata.scope,
          data_type: metadata.dataType,
          name: metadata.name,
          value_json: valueJson,
          value_display: valueDisplay,
          snapshot_value: metadata.scope === 'document' ? valueJson : null,
          snapshot_hash: snapshotPayload
            ? createHash('sha256').update(snapshotPayload).digest('hex')
            : null,
          locked_at: metadata.scope === 'document' ? signingStartedAt : null,
          client_reference: metadata.id,
          created_by: user.id,
          updated_by: user.id,
        };
      });

      const metadataInsert = await supabaseAdmin
        .from('document_additional_metadata')
        .upsert(metadataRows, {
          onConflict: 'document_id,client_reference',
          ignoreDuplicates: true,
        });
      if (metadataInsert.error) {
        console.error(
          '[DOCUBOX][enviar] Error al registrar metadatos adicionales:',
          metadataInsert.error.message
        );
        return NextResponse.json(
          { error: 'No se pudieron registrar los metadatos adicionales.' },
          { status: 500 }
        );
      }

      await supabaseAdmin.from('document_activity_log').insert({
        documento_id: dbDocumentId,
        actor_id: user.id,
        actor_nombre: user.user_metadata?.full_name || null,
        actor_email: user.email || null,
        action: 'DOCUMENT_ADDITIONAL_METADATA_SNAPSHOTTED',
        category: 'metadatos',
        details: {
          document_metadata_count: metadataRows.filter((item) => item.metadata_scope === 'document')
            .length,
          management_metadata_count: metadataRows.filter(
            (item) => item.metadata_scope === 'management'
          ).length,
          document_version_id: targetVersionId,
          locked_at: signingStartedAt,
        },
      });
    }

    if (resolvedInternalSource && resolvedWorkspaceId) {
      const relation = await supabaseAdmin.from('document_relations').insert({
        workspace_id: resolvedWorkspaceId,
        source_document_id: resolvedInternalSource.documentId,
        source_version_id: resolvedInternalSource.versionId,
        target_document_id: dbDocumentId,
        target_version_id: targetVersionId,
        relation_type: 'derived_from',
        source_sha256: resolvedInternalSource.sha256,
        target_initial_sha256: effectiveFileHash,
        created_by: user.id,
        metadata: {
          schema_version: 1,
          source_variant: resolvedInternalSource.variant,
          source_version_number: resolvedInternalSource.versionNumber,
          source_version_status: resolvedInternalSource.versionStatus,
          storage_reused: true,
        },
      });
      if (relation.error) {
        await supabaseAdmin
          .from('documentos')
          .update({ estado: 'borrador' })
          .eq('id', dbDocumentId);
        throw new Error(
          `No se pudo registrar la procedencia del documento: ${relation.error.message}`
        );
      }

      const activity = await supabaseAdmin.from('document_activity_log').insert({
        documento_id: dbDocumentId,
        actor_id: user.id,
        actor_nombre: user.user_metadata?.full_name || null,
        actor_email: user.email || null,
        action: 'DOCUMENT_INTERNAL_IMPORT',
        category: 'versionado',
        details: {
          source_document_id: resolvedInternalSource.documentId,
          source_documento_id: resolvedInternalSource.documentoId,
          source_version_id: resolvedInternalSource.versionId,
          source_variant: resolvedInternalSource.variant,
          source_version_number: resolvedInternalSource.versionNumber,
          source_sha256: resolvedInternalSource.sha256,
          target_initial_sha256: effectiveFileHash,
          relation_type: 'derived_from',
        },
      });
      if (activity.error) {
        await supabaseAdmin
          .from('documentos')
          .update({ estado: 'borrador' })
          .eq('id', dbDocumentId);
        throw new Error(
          `No se pudo registrar la auditoria de la importacion: ${activity.error.message}`
        );
      }
    }

    if (governance?.workflow?.id) {
      const userClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        }
      );
      const workflow = await userClient.rpc('start_organization_workflow_instance', {
        ws_id: resolvedWorkspaceId,
        target_workflow_id: governance.workflow.id,
        requested_subject_type: 'document',
        requested_subject_id: dbDocumentId,
        requested_context: {
          documento_id: documentoId,
          governance_schema_version: 1,
        },
        requested_idempotency_key: dbDocumentId,
      });
      if (workflow.error) {
        await supabaseAdmin
          .from('documentos')
          .update({ estado: 'borrador' })
          .eq('id', dbDocumentId);
        return NextResponse.json(
          { error: 'No se pudo iniciar el flujo organizacional. Revisa su configuración.' },
          { status: 409 }
        );
      }
      await supabaseAdmin
        .from('documentos')
        .update({ organization_workflow_instance_id: workflow.data })
        .eq('id', dbDocumentId);
    }

    // ── Send the initial invitation to every participant who selected email ──
    let invitationSummary = { attempted: 0, sent: 0, failed: 0 };

    try {
      type EmailInvitationParticipant = {
        email?: string;
        name?: string;
        isCurrentUser?: boolean;
        tipoNotificacion?: string[];
        portal_token?: string;
        [key: string]: unknown;
      };

      const emailParticipants: EmailInvitationParticipant[] = (
        participantesConVisibilidad || []
      ).filter((p: EmailInvitationParticipant) => {
        if (!p.visible || !p.email || p.isCurrentUser) return false;
        if (!p.email.includes('@')) return false;
        return isEmailNotificationEnabled(p.tipoNotificacion);
      });
      const allEmailParticipants = Array.from(
        new Map<string, EmailInvitationParticipant>(
          emailParticipants.map((participant) => [
            participant.email!.trim().toLowerCase(),
            participant,
          ])
        ).values()
      );

      const { data: senderProfile } = await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();
      const senderName = senderProfile?.full_name || user.email || 'Un usuario';

      // ── In-app notification: notify each participant who has a user_id ────
      for (const p of participantesConVisibilidad || []) {
        if (p.isCurrentUser) continue;
        // Only notify visible participants (first batch)
        if (!p.visible) continue;
        const participantUserId = (p as any).user_id;
        if (participantUserId) {
          createNotificationServer({
            userId: participantUserId,
            type: 'document',
            eventType: 'signature.requested',
            category: 'SIGNATURE',
            severity: 'warning',
            workspaceId: resolvedWorkspaceId,
            actorUserId: user.id,
            entityType: 'document',
            entityId: dbDocumentId,
            actionUrl: getParticipantPortalUrl((p as any).portal_token || dbDocumentId),
            actionLabel: 'Revisar y firmar',
            deduplicationKey: `signature.requested:${dbDocumentId}:${(p as any).id || participantUserId}`,
            title: urgente === true
              ? 'Documento urgente: se requiere tu participación'
              : 'Has sido invitado a participar en un documento',
            description: urgente === true
              ? `${senderName} te ha invitado a participar con prioridad en "${nombre || fileName}".`
              : `${senderName} te ha invitado a participar en "${nombre || fileName}".`,
            priority: 'alta',
            metadata: {
              documentoId: dbDocumentId,
              documentName: nombre || fileName,
              senderName,
              role: (p as any).acto || 'Participante',
              priority: urgente === true ? 'urgent' : 'normal',
            },
          }).catch(() => {});
        }
      }

      // Parallel workflows notify everyone. Sequential and mixed workflows only
      // notify the participants enabled in the first turn.
      if (allEmailParticipants.length > 0) {
        console.log(
          `[DOCUBOX][enviar] Sending invitation emails to ${allEmailParticipants.length} participants`
        );

        // Build a stable portal URL per participant. The document UUID remains
        // a compatibility fallback for records created before portal tokens.
        const participantsWithPortalUrl = allEmailParticipants.map((p: any) => {
          const portalToken = p.portal_token || dbDocumentId;
          return {
            ...p,
            documentUrl: getParticipantPortalUrl(portalToken),
          };
        });

        const delivery = await sendParticipantInvitationEmails({
          participants: participantsWithPortalUrl,
          documentName: nombre || fileName,
          documentDescription: descripcion || undefined,
          senderName,
          documentUrl: getParticipantPortalUrl(dbDocumentId),
        });

        invitationSummary = {
          attempted: delivery.attempted,
          sent: delivery.sent.length,
          failed: delivery.failed.length,
        };

        const deliveryByEmail = new Map(
          delivery.sent.map((item) => [item.email.trim().toLowerCase(), item])
        );
        allEmailParticipants.splice(
          0,
          allEmailParticipants.length,
          ...allEmailParticipants
            .filter((participant) => deliveryByEmail.has(participant.email!.trim().toLowerCase()))
            .map((participant) => ({
              ...participant,
              providerMessageId: deliveryByEmail.get(participant.email!.trim().toLowerCase())
                ?.providerMessageId,
            }))
        );

        if (delivery.failed.length > 0) {
          console.error(
            `[DOCUBOX][enviar] ${delivery.failed.length} invitation emails were rejected`,
            delivery.failed.map((item) => ({ email: item.email, error: item.error }))
          );
        }
      } else {
        console.log(
          '[DOCUBOX][enviar] No participants selected email notifications — skipping invitations'
        );
      }

      const allNotifiedParticipants = allEmailParticipants;

      if (allNotifiedParticipants.length > 0) {
        // ── Stamp fecha_notificacion on each participant in JSONB ──────────
        try {
          const { data: docRow2 } = await supabaseAdmin
            .from('documentos')
            .select('participantes')
            .eq('id', dbDocumentId)
            .single();

          if (docRow2?.participantes) {
            const now = new Date().toISOString();
            const updatedParticipantes = (docRow2.participantes as any[]).map((p: any) => {
              const isNotified = allNotifiedParticipants.some(
                (ep) =>
                  ep.email &&
                  ep.email.trim().toLowerCase() ===
                    String(p.email || '')
                      .trim()
                      .toLowerCase()
              );
              if (isNotified) {
                return { ...p, notificado: true, fecha_notificacion: now };
              }
              return p;
            });
            await supabaseAdmin
              .from('documentos')
              .update({ participantes: updatedParticipantes })
              .eq('id', dbDocumentId);
          }
        } catch (stampErr) {
          console.error('[DOCUBOX][enviar] Error al marcar fecha_notificacion:', stampErr);
        }

        // ── Log audit trail: invitacion_enviada per participant ────────────
        try {
          const auditRows = allNotifiedParticipants.map((p) => ({
            documento_id: dbDocumentId,
            actor_id: user.id,
            action: 'invitacion_enviada',
            category: 'notificacion',
            details: {
              participant_email: p.email,
              participant_name: p.name,
              channel: 'email',
              email_type: 'participant_invitation',
              delivery_status: 'accepted',
              provider_message_id: p.providerMessageId || null,
            },
          }));
          await supabaseAdmin.from('audit_trail').insert(auditRows);
        } catch (auditErr) {
          console.error('[DOCUBOX][enviar] Error al registrar audit trail:', auditErr);
        }
      }
    } catch (emailErr) {
      console.error('[DOCUBOX][enviar] Error al enviar notificaciones de firma:', emailErr);
      // Non-blocking: document was already saved successfully
    }

    return NextResponse.json(
      { success: true, dbDocumentId, invitations: invitationSummary },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof InternalSourceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[DOCUBOX][enviar] Error inesperado:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
