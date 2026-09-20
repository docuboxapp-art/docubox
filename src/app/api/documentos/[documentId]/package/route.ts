import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import {
  documentEncryptionPolicy,
  encryptAndUploadDocumentObject,
} from '@/lib/crypto/document-encryption';
import {
  appendPackageEvent,
  canUserViewPackageResource,
  ensureDocumentPackage,
  isPhaseBFeatureEnabled,
  PHASE_B_FEATURE_KEYS,
  phaseBUnavailableResponse,
  resolveParticipantReference,
} from '@/lib/document-package/server';
import {
  PackageFileValidationError,
  validatePackageFile,
} from '@/lib/document-package/file-validation';
import {
  DEFAULT_REQUIREMENT_MIME_TYPES,
  isSupplementalResourceType,
} from '@/lib/document-package/types';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readPackageContext(request: NextRequest, documentId: string, ownerOnly = false) {
  const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: ownerOnly });
  if (!access.document.workspace_id) throw new Error('PACKAGE_WORKSPACE_REQUIRED');
  return access;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const access = await readPackageContext(request, documentId);
    if (!(await isPhaseBFeatureEnabled(access.service, PHASE_B_FEATURE_KEYS.packages))) {
      return phaseBUnavailableResponse();
    }
    const packageResult = await access.service
      .from('document_packages')
      .select('id,document_id,workspace_id,created_at,updated_at')
      .eq('document_id', documentId)
      .maybeSingle();
    if (packageResult.error) throw packageResult.error;
    if (!packageResult.data) {
      return Response.json({
        success: true,
        data: {
          package: null,
          resources: [],
          requirements: [],
          interactions: [],
          participantReferenceId: null,
          readiness: { ready: true, blockers: [] },
        },
      });
    }

    const participant =
      access.role === 'AUTHORIZED'
        ? await resolveParticipantReference({
            service: access.service,
            documentId,
            user: access.user,
          })
        : null;
    const [resourcesResult, visibilityResult, requirementsResult, interactionsResult] =
      await Promise.all([
        access.service
          .from('document_package_resources')
          .select(
            'id,resource_kind,interaction_mode,title,description,original_name,mime_type,byte_size,sha256,malware_scan_status,created_at'
          )
          .eq('package_id', packageResult.data.id)
          .is('deleted_at', null)
          .order('created_at'),
        access.service
          .from('document_resource_visibility')
          .select('resource_id,participant_reference_id,visibility_mode,valid_from,valid_until')
          .eq('document_id', documentId),
        access.service
          .from('participant_document_requirements')
          .select(
            'id,participant_reference_id,name,description,required,allowed_mime_types,max_size_bytes,status,provided_resource_id,provided_at,created_at'
          )
          .eq('document_id', documentId)
          .order('created_at'),
        access.service
          .from('document_resource_interactions')
          .select('resource_id,participant_reference_id,interaction_type,occurred_at')
          .eq('document_id', documentId),
      ]);
    if (resourcesResult.error) throw resourcesResult.error;
    if (visibilityResult.error) throw visibilityResult.error;
    if (requirementsResult.error) throw requirementsResult.error;
    if (interactionsResult.error) throw interactionsResult.error;

    const now = Date.now();
    const visibility = visibilityResult.data || [];
    const resources = (resourcesResult.data || []).filter((resource) => {
      if (access.role !== 'AUTHORIZED') return true;
      if (!participant) return false;
      const configured = visibility.filter((item) => item.resource_id === resource.id);
      if (configured.length === 0) return true;
      return configured.some(
        (item) =>
          item.participant_reference_id === participant.id &&
          item.visibility_mode === 'allow' &&
          (!item.valid_from || Date.parse(item.valid_from) <= now) &&
          (!item.valid_until || Date.parse(item.valid_until) > now)
      );
    });
    const requirements = (requirementsResult.data || []).filter(
      (requirement) =>
        access.role !== 'AUTHORIZED' || requirement.participant_reference_id === participant?.id
    );
    const interactions = (interactionsResult.data || []).filter(
      (interaction) =>
        access.role !== 'AUTHORIZED' || interaction.participant_reference_id === participant?.id
    );
    const blockers = participant
      ? [
          ...resources.flatMap((resource) => {
            const interactionTypes = interactions
              .filter((interaction) => interaction.resource_id === resource.id)
              .map((interaction) => interaction.interaction_type);
            if (
              resource.interaction_mode === 'read_required' &&
              !interactionTypes.includes('viewed')
            ) {
              return [{ type: 'resource', id: resource.id, reason: 'read_required' }];
            }
            if (
              resource.interaction_mode === 'acceptance_required' &&
              !interactionTypes.includes('accepted')
            ) {
              return [{ type: 'resource', id: resource.id, reason: 'acceptance_required' }];
            }
            return [];
          }),
          ...requirements
            .filter(
              (requirement) =>
                requirement.required &&
                !['provided', 'accepted', 'waived'].includes(requirement.status)
            )
            .map((requirement) => ({
              type: 'requirement',
              id: requirement.id,
              reason: 'required_upload',
            })),
        ]
      : [];
    return Response.json({
      success: true,
      data: {
        package: packageResult.data,
        resources,
        requirements,
        visibility: access.role === 'AUTHORIZED' ? [] : visibility,
        interactions,
        participantReferenceId: participant?.id || null,
        readiness: { ready: blockers.length === 0, blockers },
      },
    });
  } catch (error) {
    const response = documentAccessResponse(error);
    if (response.status !== 500) return Response.json(response.body, { status: response.status });
    return Response.json(
      {
        error:
          error instanceof Error && error.message === 'PACKAGE_WORKSPACE_REQUIRED'
            ? 'El documento no tiene un espacio de trabajo válido.'
            : 'No fue posible consultar el paquete.',
      },
      {
        status:
          error instanceof Error && error.message === 'PACKAGE_WORKSPACE_REQUIRED' ? 409 : 500,
      }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  let uploadedPath: string | null = null;
  try {
    const { documentId } = await context.params;
    const contentType = request.headers.get('content-type') || '';
    const ownerOnly = contentType.includes('multipart/form-data');
    const access = await readPackageContext(request, documentId, ownerOnly);
    if (!(await isPhaseBFeatureEnabled(access.service, PHASE_B_FEATURE_KEYS.packages))) {
      return phaseBUnavailableResponse();
    }
    const workspaceId = String(access.document.workspace_id);
    const packageRow = await ensureDocumentPackage({
      service: access.service,
      documentId,
      workspaceId,
      actorUserId: access.user.id,
    });

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      const metaRaw = String(form.get('meta') || '');
      if (!(file instanceof File) || !metaRaw) {
        return Response.json(
          { error: 'Selecciona un archivo y completa su configuración.' },
          { status: 400 }
        );
      }
      const meta = JSON.parse(metaRaw) as Record<string, unknown>;
      if (!isSupplementalResourceType(meta.type)) {
        return Response.json({ error: 'El tipo de recurso no es válido.' }, { status: 400 });
      }
      const title = String(meta.title || '').trim();
      if (!title || title.length > 180) {
        return Response.json({ error: 'El nombre del recurso no es válido.' }, { status: 400 });
      }
      const validated = await validatePackageFile(file, DEFAULT_REQUIREMENT_MIME_TYPES);
      const versionResult = await access.service
        .from('document_versions')
        .select('id')
        .eq('document_id', documentId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (versionResult.error) throw versionResult.error;
      const resourceId = randomUUID();
      const versionId = versionResult.data?.id || null;
      const encryption = documentEncryptionPolicy();
      uploadedPath = encryption.enabled
        ? `tenants/${workspaceId}/documents/${documentId}/package/${resourceId}/payload.enc`
        : `tenants/${workspaceId}/documents/${documentId}/package/${resourceId}/${validated.safeName}`;
      if (encryption.enabled) {
        if (!versionId) throw new Error('PACKAGE_DOCUMENT_VERSION_REQUIRED');
        await encryptAndUploadDocumentObject({
          service: access.service,
          plaintext: validated.bytes,
          tenantId: workspaceId,
          documentId,
          documentVersionId: versionId,
          artifactKind: 'attachment',
          storageBucket: 'documents',
          storagePath: uploadedPath,
          originalFileName: file.name,
          originalMimeType: validated.detectedMime,
          userId: access.user.id,
          requestId: request.headers.get('x-request-id') || randomUUID(),
        });
      } else {
        const upload = await access.service.storage
          .from('documents')
          .upload(uploadedPath, validated.bytes, {
            contentType: validated.detectedMime,
            cacheControl: '0',
            upsert: false,
          });
        if (upload.error) throw upload.error;
      }
      validated.bytes.fill(0);
      const inserted = await access.service
        .from('document_package_resources')
        .insert({
          id: resourceId,
          package_id: packageRow.id,
          workspace_id: workspaceId,
          document_id: documentId,
          document_version_id: versionId,
          resource_kind: 'supplemental',
          interaction_mode: meta.type,
          title,
          description: String(meta.description || '').trim() || null,
          storage_bucket: 'documents',
          storage_path: uploadedPath,
          original_name: file.name,
          mime_type: validated.detectedMime,
          byte_size: file.size,
          sha256: validated.sha256,
          malware_scan_status: 'pending',
          created_by: access.user.id,
        })
        .select('id,title,interaction_mode,mime_type,byte_size,malware_scan_status')
        .single();
      if (inserted.error) throw inserted.error;
      const visibleParticipantReferences = Array.isArray(meta.visibleParticipantReferences)
        ? meta.visibleParticipantReferences.filter(
            (id): id is string => typeof id === 'string' && uuidPattern.test(id)
          )
        : [];
      if (visibleParticipantReferences.length > 0) {
        const rows = visibleParticipantReferences.map((participantReferenceId) => ({
          workspace_id: workspaceId,
          document_id: documentId,
          resource_id: resourceId,
          participant_reference_id: participantReferenceId,
          visibility_mode: 'allow',
          created_by: access.user.id,
        }));
        const visibilityInsert = await access.service
          .from('document_resource_visibility')
          .insert(rows);
        if (visibilityInsert.error) throw visibilityInsert.error;
      }
      await appendPackageEvent({
        service: access.service,
        documentId,
        workspaceId,
        actorUserId: access.user.id,
        eventType: 'package.resource.created',
        eventKey: `package-resource:${resourceId}:created`,
        payload: { resource_id: resourceId, interaction_mode: meta.type },
      });
      return Response.json({ success: true, data: inserted.data }, { status: 201 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    if (body.operation === 'create_requirement') {
      const participantReferenceId = String(body.participantReferenceId || '');
      const name = String(body.name || '').trim();
      const allowedMimeTypes = Array.isArray(body.allowedMimeTypes)
        ? body.allowedMimeTypes.filter((item): item is string =>
            DEFAULT_REQUIREMENT_MIME_TYPES.includes(item as never)
          )
        : [...DEFAULT_REQUIREMENT_MIME_TYPES];
      if (
        !uuidPattern.test(participantReferenceId) ||
        !name ||
        name.length > 180 ||
        allowedMimeTypes.length === 0
      ) {
        return Response.json(
          { error: 'La configuración del requisito no es válida.' },
          { status: 400 }
        );
      }
      if (access.role === 'AUTHORIZED')
        return Response.json({ error: 'No autorizado.' }, { status: 403 });
      const inserted = await access.service
        .from('participant_document_requirements')
        .insert({
          package_id: packageRow.id,
          workspace_id: workspaceId,
          document_id: documentId,
          participant_reference_id: participantReferenceId,
          requirement_type: 'document',
          name,
          description: String(body.description || '').trim() || null,
          required: body.required !== false,
          allowed_mime_types: allowedMimeTypes,
          max_size_bytes: Math.min(Number(body.maxSizeBytes) || 26214400, 26214400),
          created_by: access.user.id,
        })
        .select('id,name,required,status')
        .single();
      if (inserted.error) throw inserted.error;
      await appendPackageEvent({
        service: access.service,
        documentId,
        workspaceId,
        participantReferenceId,
        actorUserId: access.user.id,
        eventType: 'participant.requirement.created',
        eventKey: `participant-requirement:${inserted.data.id}:created`,
        payload: { requirement_id: inserted.data.id, required: inserted.data.required },
      });
      return Response.json({ success: true, data: inserted.data }, { status: 201 });
    }

    if (body.operation === 'record_interaction') {
      const participant = await resolveParticipantReference({
        service: access.service,
        documentId,
        user: access.user,
      });
      const resourceId = String(body.resourceId || '');
      const interactionType = String(body.interactionType || '');
      if (!participant || !uuidPattern.test(resourceId) || interactionType !== 'accepted') {
        return Response.json({ error: 'La interacción no es válida.' }, { status: 400 });
      }
      const resource = await access.service
        .from('document_package_resources')
        .select('id,interaction_mode')
        .eq('id', resourceId)
        .eq('document_id', documentId)
        .is('deleted_at', null)
        .maybeSingle();
      if (resource.error) throw resource.error;
      if (!resource.data)
        return Response.json({ error: 'Recurso no encontrado.' }, { status: 404 });
      const visibility = await canUserViewPackageResource({
        service: access.service,
        documentId,
        resourceId,
        user: access.user,
        privileged: access.role !== 'AUTHORIZED',
      });
      if (!visibility.allowed)
        return Response.json({ error: 'Recurso no encontrado.' }, { status: 404 });
      if (resource.data.interaction_mode !== 'acceptance_required') {
        return Response.json({ error: 'Este recurso no requiere aceptación.' }, { status: 409 });
      }
      const viewed = await access.service
        .from('document_resource_interactions')
        .select('id')
        .eq('document_id', documentId)
        .eq('resource_id', resourceId)
        .eq('participant_reference_id', participant.id)
        .eq('interaction_type', 'viewed')
        .maybeSingle();
      if (viewed.error) throw viewed.error;
      if (!viewed.data) {
        return Response.json(
          { error: 'Consulta el documento antes de registrar su aceptación.' },
          { status: 409 }
        );
      }
      const eventKey = `resource:${resourceId}:${participant.id}:${interactionType}`;
      const inserted = await access.service.from('document_resource_interactions').upsert(
        {
          workspace_id: workspaceId,
          document_id: documentId,
          resource_id: resourceId,
          participant_reference_id: participant.id,
          interaction_type: interactionType,
          event_key: eventKey,
        },
        { onConflict: 'document_id,event_key', ignoreDuplicates: true }
      );
      if (inserted.error) throw inserted.error;
      await appendPackageEvent({
        service: access.service,
        documentId,
        workspaceId,
        participantReferenceId: participant.id,
        actorUserId: access.user.id,
        eventType: `package.resource.${interactionType}`,
        eventKey,
        payload: { resource_id: resourceId },
      });
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Operación no soportada.' }, { status: 400 });
  } catch (error) {
    if (uploadedPath) {
      try {
        const { createServiceClient } = await import('@/lib/supabase/server');
        await createServiceClient().storage.from('documents').remove([uploadedPath]);
      } catch (cleanupError) {
        void cleanupError;
      }
    }
    if (error instanceof PackageFileValidationError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const response = documentAccessResponse(error);
    if (response.status !== 500) return Response.json(response.body, { status: response.status });
    return Response.json({ error: 'No fue posible actualizar el paquete.' }, { status: 500 });
  }
}
