import type { SupabaseClient } from '@supabase/supabase-js';

type InitializeDocumentVersionInput = {
  service: SupabaseClient;
  workspaceId: string;
  documentId: string;
  actorUserId: string;
  sha256: string;
  fileUrl?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  displayName?: string | null;
  sourceVersionId?: string | null;
  requireCollaborationEntitlement?: boolean;
  additionalDocumentMetadataSnapshot?: Array<{ name: string; dataType: string; value: string | boolean }>;
  additionalDocumentMetadataSnapshotHash?: string | null;
  requestedVersionId?: string | null;
};

export type CollaborationDocumentVersionResult =
  | { enabled: false; versionId: null; created: false }
  | { enabled: true; versionId: string; created: boolean };

const ACTIVE_ENTITLEMENT_STATUSES = ['trialing', 'active', 'past_due'];

export async function initializeCollaborationDocumentVersion({
  service,
  workspaceId,
  documentId,
  actorUserId,
  sha256,
  fileUrl = null,
  storagePath = null,
  mimeType = 'application/pdf',
  byteSize = null,
  displayName = null,
  sourceVersionId = null,
  requireCollaborationEntitlement = true,
  additionalDocumentMetadataSnapshot = [],
  additionalDocumentMetadataSnapshotHash = null,
  requestedVersionId = null,
}: InitializeDocumentVersionInput): Promise<CollaborationDocumentVersionResult> {
  if (requireCollaborationEntitlement) {
    const entitlement = await service
      .from('organization_entitlements')
      .select('id,status,ends_at,read_only_at')
      .eq('workspace_id', workspaceId)
      .eq('entitlement_key', 'collaboration_core')
      .in('status', ACTIVE_ENTITLEMENT_STATUSES)
      .maybeSingle();

    if (entitlement.error) throw entitlement.error;
    if (!entitlement.data) return { enabled: false, versionId: null, created: false };
  }

  const current = await service
    .from('document_versions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('document_id', documentId)
    .eq('version_number', 1)
    .maybeSingle();
  if (current.error) throw current.error;
  if (current.data) return { enabled: true, versionId: current.data.id, created: false };

  const normalizedHash = sha256.trim().toLowerCase();
  const inserted = await service
    .from('document_versions')
    .insert({
      ...(requestedVersionId ? { id: requestedVersionId } : {}),
      workspace_id: workspaceId,
      document_id: documentId,
      version_number: 1,
      status: 'sent',
      file_url: fileUrl,
      storage_path: storagePath,
      mime_type: mimeType || 'application/pdf',
      byte_size: byteSize,
      sha256: normalizedHash,
      change_reason: 'Version inicial enviada desde Docubox',
      source_version_id: sourceVersionId,
      created_by: actorUserId,
      frozen_at: new Date().toISOString(),
      metadata: {
        source: 'document_send',
        display_name: displayName,
        source_version_id: sourceVersionId,
        schema_version: 1,
        ...(additionalDocumentMetadataSnapshot.length > 0 ? {
          additional_document_metadata_snapshot: additionalDocumentMetadataSnapshot,
          additional_document_metadata_snapshot_sha256: additionalDocumentMetadataSnapshotHash,
        } : {}),
      },
    })
    .select('id')
    .single();

  if (inserted.error) {
    if (inserted.error.code === '23505') {
      const raced = await service
        .from('document_versions')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('document_id', documentId)
        .eq('version_number', 1)
        .single();
      if (raced.error) throw raced.error;
      return { enabled: true, versionId: raced.data.id, created: false };
    }
    throw inserted.error;
  }

  const activity = await service.from('collaboration_activity_events').insert({
    workspace_id: workspaceId,
    actor_user_id: actorUserId,
    event_type: 'document.version_initialized',
    resource_type: 'document_version',
    resource_id: inserted.data.id,
    summary: `Se registro la version inicial de ${displayName || 'un documento'}.`,
    metadata: {
      document_id: documentId,
      version_number: 1,
      sha256: normalizedHash,
      automation_depth: 0,
    },
  });
  if (activity.error) throw activity.error;

  return { enabled: true, versionId: inserted.data.id, created: true };
}
