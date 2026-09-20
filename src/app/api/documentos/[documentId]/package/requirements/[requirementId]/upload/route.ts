import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import {
  documentEncryptionPolicy,
  encryptAndUploadDocumentObject,
} from '@/lib/crypto/document-encryption';
import {
  PackageFileValidationError,
  validatePackageFile,
} from '@/lib/document-package/file-validation';
import { appendPackageEvent, resolveParticipantReference } from '@/lib/document-package/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import {
  consumeServerRateLimit,
  ServerRateLimitUnavailableError,
} from '@/lib/security/server-rate-limit';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string; requirementId: string }> }
) {
  let uploadedPath: string | null = null;
  try {
    const { documentId, requirementId } = await context.params;
    const access = await requireDocumentAccess(request, documentId);
    const participant = await resolveParticipantReference({
      service: access.service,
      documentId,
      user: access.user,
    });
    if (!participant) return Response.json({ error: 'Requisito no encontrado.' }, { status: 404 });
    const allowed = await consumeServerRateLimit({
      scope: 'participant-requirement-upload',
      identifiers: [documentId, participant.id],
      limit: 12,
      windowSeconds: 900,
    });
    if (!allowed)
      return Response.json(
        { error: 'Espera antes de volver a cargar un archivo.' },
        { status: 429 }
      );

    const requirementResult = await access.service
      .from('participant_document_requirements')
      .select(
        'id,package_id,workspace_id,document_id,document_version_id,participant_reference_id,allowed_mime_types,max_size_bytes,status'
      )
      .eq('id', requirementId)
      .eq('document_id', documentId)
      .eq('participant_reference_id', participant.id)
      .maybeSingle();
    if (requirementResult.error) throw requirementResult.error;
    const requirement = requirementResult.data;
    if (!requirement) return Response.json({ error: 'Requisito no encontrado.' }, { status: 404 });
    if (['accepted', 'waived'].includes(requirement.status)) {
      return Response.json({ error: 'Este requisito ya no admite reemplazos.' }, { status: 409 });
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File))
      return Response.json({ error: 'Selecciona un archivo.' }, { status: 400 });
    const validated = await validatePackageFile(
      file,
      requirement.allowed_mime_types,
      Number(requirement.max_size_bytes)
    );
    const resourceId = randomUUID();
    const encryption = documentEncryptionPolicy();
    uploadedPath = encryption.enabled
      ? `tenants/${requirement.workspace_id}/documents/${documentId}/participants/${participant.id}/${resourceId}/payload.enc`
      : `tenants/${requirement.workspace_id}/documents/${documentId}/participants/${participant.id}/${resourceId}/${validated.safeName}`;
    if (encryption.enabled) {
      if (!requirement.document_version_id) throw new Error('PACKAGE_DOCUMENT_VERSION_REQUIRED');
      await encryptAndUploadDocumentObject({
        service: access.service,
        plaintext: validated.bytes,
        tenantId: requirement.workspace_id,
        documentId,
        documentVersionId: requirement.document_version_id,
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
    const resourceInsert = await access.service
      .from('document_package_resources')
      .insert({
        id: resourceId,
        package_id: requirement.package_id,
        workspace_id: requirement.workspace_id,
        document_id: documentId,
        document_version_id: requirement.document_version_id,
        resource_kind: 'participant_attachment',
        interaction_mode: 'informative',
        title: file.name,
        storage_bucket: 'documents',
        storage_path: uploadedPath,
        original_name: file.name,
        mime_type: validated.detectedMime,
        byte_size: file.size,
        sha256: validated.sha256,
        malware_scan_status: 'pending',
        created_by: access.user.id,
      })
      .select('id,title,mime_type,byte_size,malware_scan_status')
      .single();
    if (resourceInsert.error) throw resourceInsert.error;
    const requirementUpdate = await access.service
      .from('participant_document_requirements')
      .update({
        status: 'provided',
        provided_resource_id: resourceId,
        provided_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq('id', requirementId)
      .eq('participant_reference_id', participant.id)
      .in('status', ['pending', 'provided', 'rejected'])
      .select('id,status,provided_at')
      .maybeSingle();
    if (requirementUpdate.error) throw requirementUpdate.error;
    if (!requirementUpdate.data)
      return Response.json({ error: 'El requisito cambió durante la carga.' }, { status: 409 });
    await appendPackageEvent({
      service: access.service,
      workspaceId: requirement.workspace_id,
      documentId,
      participantReferenceId: participant.id,
      actorUserId: access.user.id,
      eventType: 'participant.requirement.provided',
      eventKey: `participant-requirement:${requirementId}:resource:${resourceId}:provided`,
      payload: { requirement_id: requirementId, resource_id: resourceId },
    });
    return Response.json(
      {
        success: true,
        data: { requirement: requirementUpdate.data, resource: resourceInsert.data },
      },
      { status: 201 }
    );
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
    if (error instanceof ServerRateLimitUnavailableError) {
      return Response.json(
        { error: 'La carga no está disponible temporalmente.' },
        { status: 503 }
      );
    }
    const response = documentAccessResponse(error);
    return Response.json(response.body, { status: response.status });
  }
}
