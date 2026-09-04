import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  encryptAndUploadDocumentObject,
  readDocumentStorageObject,
} from '../src/lib/crypto/document-encryption/index.ts';

type StageAuditPayload = {
  migration_id: string;
  document_id: string;
  document_version_id: string;
  source_path: string;
  encrypted_path: string;
  plaintext_sha256: string;
  ciphertext_sha256: string;
  kms_provider: string;
  kms_key_version: string;
  result: 'staged';
};

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function requiredOption(name: string) {
  const value = option(name)?.trim();
  if (!value) throw new Error(`${name.toUpperCase()}_REQUIRED`);
  return value;
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isPdf(bytes: Uint8Array) {
  return Buffer.from(bytes).subarray(0, 5).toString('ascii') === '%PDF-';
}

async function appendAudit(
  service: SupabaseClient,
  input: {
    workspaceId: string;
    actorUserId: string;
    migrationId: string;
    eventType: string;
    documentId: string;
    summary: string;
    payload: Record<string, unknown>;
    outcome?: 'success' | 'failed';
    severity?: 'info' | 'high';
  }
) {
  const result = await service.from('organization_audit_events').insert({
    workspace_id: input.workspaceId,
    actor_user_id: input.actorUserId,
    event_type: input.eventType,
    resource_type: 'document',
    resource_id: input.documentId,
    summary: input.summary,
    payload: input.payload,
    outcome: input.outcome || 'success',
    severity: input.severity || 'info',
    module: 'document-encryption',
    origin: 'system',
    correlation_id: input.migrationId,
    evidence_refs: [],
  });
  if (result.error) throw result.error;
}

async function removeStagedTarget(
  service: SupabaseClient,
  storagePath: string,
  metadataId: string | null
) {
  if (metadataId) {
    const deletedMetadata = await service
      .from('document_encryption_metadata')
      .delete()
      .eq('id', metadataId);
    if (deletedMetadata.error) throw deletedMetadata.error;
  }
  const removed = await service.storage.from('documents').remove([storagePath]);
  if (removed.error) throw removed.error;
}

async function loadStageAudit(service: SupabaseClient, migrationId: string) {
  const result = await service
    .from('organization_audit_events')
    .select('workspace_id,actor_user_id,resource_id,payload,occurred_at')
    .eq('correlation_id', migrationId)
    .eq('event_type', 'LEGACY_DOCUMENT_ENCRYPTION_CANARY_STAGED')
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('CANARY_STAGE_AUDIT_NOT_FOUND');
  return {
    ...result.data,
    payload: result.data.payload as StageAuditPayload,
  };
}

export async function stageLegacyDocumentCanary(
  service: SupabaseClient,
  input?: {
    documentId: string;
    versionId: string;
    actorUserId: string;
    workspaceId?: string;
    migrationId?: string;
  }
) {
  const documentId = input?.documentId || requiredOption('document');
  const versionId = input?.versionId || requiredOption('version');
  const actorUserId = input?.actorUserId || requiredOption('actor');
  const migrationId = input?.migrationId || option('migration-id') || randomUUID();

  const documentResult = await service
    .from('documentos')
    .select('id,owner_id,workspace_id,file_name,file_type,storage_path,file_hash_sha256,deleted_at')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle();
  if (documentResult.error) throw documentResult.error;
  if (!documentResult.data) throw new Error('CANARY_DOCUMENT_NOT_FOUND');
  const document = documentResult.data;
  if (!document.workspace_id || !document.storage_path)
    throw new Error('CANARY_SOURCE_UNAVAILABLE');
  if (input?.workspaceId && document.workspace_id !== input.workspaceId) {
    throw new Error('CANARY_WORKSPACE_ASSOCIATION_INVALID');
  }
  if (!/^[0-9a-f]{64}$/i.test(String(document.file_hash_sha256 || ''))) {
    throw new Error('CANARY_REGISTERED_SHA256_INVALID');
  }

  const actor = await service
    .from('workspace_members')
    .select('status')
    .eq('workspace_id', document.workspace_id)
    .eq('user_id', actorUserId)
    .eq('status', 'active')
    .maybeSingle();
  if (actor.error) throw actor.error;
  if (!actor.data) throw new Error('CANARY_ACTOR_WORKSPACE_MEMBERSHIP_REQUIRED');

  const versionResult = await service
    .from('document_versions')
    .select('id,document_id,workspace_id,sha256')
    .eq('id', versionId)
    .eq('document_id', document.id)
    .eq('workspace_id', document.workspace_id)
    .maybeSingle();
  if (versionResult.error) throw versionResult.error;
  if (!versionResult.data) throw new Error('CANARY_VERSION_ASSOCIATION_INVALID');
  if (versionResult.data.sha256?.toLowerCase() !== document.file_hash_sha256.toLowerCase()) {
    throw new Error('CANARY_VERSION_SHA256_MISMATCH');
  }

  const sourcePath = document.storage_path;
  const existingSourceMetadata = await service
    .from('document_encryption_metadata')
    .select('id')
    .eq('storage_bucket', 'documents')
    .eq('storage_path', sourcePath)
    .eq('status', 'active')
    .maybeSingle();
  if (existingSourceMetadata.error) throw existingSourceMetadata.error;
  if (existingSourceMetadata.data) throw new Error('CANARY_SOURCE_ALREADY_ENCRYPTED');

  const sourceObject = await service.storage.from('documents').download(sourcePath);
  if (sourceObject.error || !sourceObject.data) throw new Error('CANARY_SOURCE_MISSING');
  const plaintext = Buffer.from(await sourceObject.data.arrayBuffer());
  const plaintextSha256 = sha256(plaintext);
  if (!isPdf(plaintext)) {
    plaintext.fill(0);
    throw new Error('CANARY_SOURCE_NOT_PDF');
  }
  if (plaintextSha256 !== document.file_hash_sha256.toLowerCase()) {
    plaintext.fill(0);
    throw new Error('CANARY_SOURCE_SHA256_MISMATCH');
  }

  const encryptedPath = `tenants/${document.workspace_id}/documents/${document.id}/versions/${versionId}/legacy-canary/${migrationId}.enc`;
  let metadataId: string | null = null;
  let switched = false;
  try {
    const encrypted = await encryptAndUploadDocumentObject({
      service,
      plaintext,
      tenantId: document.workspace_id,
      documentId: document.id,
      documentVersionId: versionId,
      artifactKind: 'document',
      storageBucket: 'documents',
      storagePath: encryptedPath,
      originalFileName: document.file_name,
      originalMimeType: document.file_type || 'application/pdf',
      userId: actorUserId,
      requestId: `legacy-canary:${migrationId}:stage`,
    });
    metadataId = String(encrypted.metadataId || '');

    const stored = await service.storage.from('documents').download(encryptedPath);
    if (stored.error || !stored.data) throw new Error('CANARY_CIPHERTEXT_MISSING');
    const ciphertext = Buffer.from(await stored.data.arrayBuffer());
    const ciphertextSha256 = sha256(ciphertext);
    const ciphertextNotPdf = !isPdf(ciphertext);
    ciphertext.fill(0);
    if (!ciphertextNotPdf) throw new Error('CANARY_CIPHERTEXT_HAS_PDF_HEADER');
    if (ciphertextSha256 !== encrypted.metadata.ciphertext_sha256) {
      throw new Error('CANARY_CIPHERTEXT_SHA256_MISMATCH');
    }

    const decrypted = await readDocumentStorageObject({
      service,
      storageBucket: 'documents',
      storagePath: encryptedPath,
      expectedPlaintextSha256: plaintextSha256,
      userId: actorUserId,
      requestId: `legacy-canary:${migrationId}:verify`,
    });
    const decryptedSha256 = sha256(decrypted.plaintext);
    const decryptedMatches = decrypted.plaintext.equals(plaintext);
    decrypted.plaintext.fill(0);
    if (!decryptedMatches || decryptedSha256 !== plaintextSha256) {
      throw new Error('CANARY_DECRYPTED_SHA256_MISMATCH');
    }

    const pointer = await service
      .from('documentos')
      .update({ storage_path: encryptedPath })
      .eq('id', document.id)
      .eq('workspace_id', document.workspace_id)
      .eq('storage_path', sourcePath)
      .select('id,storage_path')
      .maybeSingle();
    if (pointer.error || pointer.data?.storage_path !== encryptedPath) {
      throw pointer.error || new Error('CANARY_ATOMIC_SWITCH_CONFLICT');
    }
    switched = true;

    const payload: StageAuditPayload = {
      migration_id: migrationId,
      document_id: document.id,
      document_version_id: versionId,
      source_path: sourcePath,
      encrypted_path: encryptedPath,
      plaintext_sha256: plaintextSha256,
      ciphertext_sha256: ciphertextSha256,
      kms_provider: encrypted.metadata.kms_provider,
      kms_key_version: encrypted.metadata.kms_key_version,
      result: 'staged',
    };
    await appendAudit(service, {
      workspaceId: document.workspace_id,
      actorUserId,
      migrationId,
      eventType: 'LEGACY_DOCUMENT_ENCRYPTION_CANARY_STAGED',
      documentId: document.id,
      summary:
        'Canary legacy cifrado y conmutado; plaintext conservado hasta validar la aplicacion.',
      payload,
    });

    return {
      status: 'CANARY_STAGED',
      migration_id: migrationId,
      document_id: document.id,
      document_version_id: versionId,
      source_sha_match: true,
      ciphertext_not_pdf_header: true,
      kms_wrap_unwrap: true,
      decrypted_sha_match: true,
      atomic_switch: true,
      old_plaintext_deleted: false,
    };
  } catch (error) {
    let rollbackCode: string | null = null;
    if (switched) {
      const pointerRollback = await service
        .from('documentos')
        .update({ storage_path: sourcePath })
        .eq('id', document.id)
        .eq('storage_path', encryptedPath)
        .select('id')
        .maybeSingle();
      if (pointerRollback.error || !pointerRollback.data) {
        rollbackCode = pointerRollback.error?.code || 'CANARY_POINTER_ROLLBACK_FAILED';
      }
    }
    if (!rollbackCode && metadataId) {
      try {
        await removeStagedTarget(service, encryptedPath, metadataId);
      } catch (cleanupError) {
        rollbackCode =
          cleanupError instanceof Error ? cleanupError.message : 'CANARY_TARGET_CLEANUP_FAILED';
      }
    }
    await appendAudit(service, {
      workspaceId: document.workspace_id,
      actorUserId,
      migrationId,
      eventType: 'LEGACY_DOCUMENT_ENCRYPTION_CANARY_FAILED',
      documentId: document.id,
      summary: 'El canary legacy fallo; el plaintext se conservo.',
      payload: {
        migration_id: migrationId,
        document_id: document.id,
        source_path: sourcePath,
        encrypted_path: encryptedPath,
        failure_code: error instanceof Error ? error.message : 'CANARY_STAGE_FAILED',
        rollback_code: rollbackCode,
        source_preserved: true,
      },
      outcome: 'failed',
      severity: rollbackCode ? 'high' : 'info',
    }).catch(() => undefined);
    const code = error instanceof Error ? error.message : 'CANARY_STAGE_FAILED';
    throw new Error(rollbackCode ? `${code}:${rollbackCode}` : code);
  } finally {
    plaintext.fill(0);
  }
}

export async function rollbackLegacyDocumentCanary(
  service: SupabaseClient,
  input?: { migrationId: string; actorUserId?: string }
) {
  const migrationId = input?.migrationId || requiredOption('migration-id');
  const audit = await loadStageAudit(service, migrationId);
  if (input?.actorUserId && audit.actor_user_id !== input.actorUserId) {
    throw new Error('CANARY_OPERATOR_MISMATCH');
  }
  const payload = audit.payload;
  const pointer = await service
    .from('documentos')
    .update({ storage_path: payload.source_path })
    .eq('id', payload.document_id)
    .eq('storage_path', payload.encrypted_path)
    .select('id')
    .maybeSingle();
  if (pointer.error || !pointer.data) {
    throw pointer.error || new Error('CANARY_POINTER_ROLLBACK_CONFLICT');
  }
  const metadata = await service
    .from('document_encryption_metadata')
    .select('id')
    .eq('storage_bucket', 'documents')
    .eq('storage_path', payload.encrypted_path)
    .eq('status', 'active')
    .maybeSingle();
  if (metadata.error) throw metadata.error;
  await removeStagedTarget(service, payload.encrypted_path, metadata.data?.id || null);
  await appendAudit(service, {
    workspaceId: audit.workspace_id,
    actorUserId: audit.actor_user_id,
    migrationId,
    eventType: 'LEGACY_DOCUMENT_ENCRYPTION_CANARY_ROLLED_BACK',
    documentId: payload.document_id,
    summary: 'Canary legacy revertido; el plaintext original permanece activo.',
    payload: {
      migration_id: migrationId,
      document_id: payload.document_id,
      source_path: payload.source_path,
      source_preserved: true,
      encrypted_target_removed: true,
    },
  });
  return { status: 'CANARY_ROLLED_BACK', migration_id: migrationId, source_preserved: true };
}

export async function finalizeLegacyDocumentCanary(
  service: SupabaseClient,
  input?: { migrationId: string; actorUserId?: string; unauthorizedAccessDenied?: boolean }
) {
  const migrationId = input?.migrationId || requiredOption('migration-id');
  const audit = await loadStageAudit(service, migrationId);
  if (input?.actorUserId && audit.actor_user_id !== input.actorUserId) {
    throw new Error('CANARY_OPERATOR_MISMATCH');
  }
  const unauthorizedAccessDenied =
    input?.unauthorizedAccessDenied || option('unauthorized-denied') === 'true';
  if (!unauthorizedAccessDenied) throw new Error('CANARY_UNAUTHORIZED_ACCESS_NOT_VERIFIED');
  const payload = audit.payload;

  const completed = await service
    .from('organization_audit_events')
    .select('id')
    .eq('correlation_id', migrationId)
    .eq('event_type', 'LEGACY_DOCUMENT_ENCRYPTION_CANARY_COMPLETED')
    .maybeSingle();
  if (completed.error) throw completed.error;
  if (completed.data) {
    return {
      status: 'LEGACY_CANARY_PASS',
      migration_id: migrationId,
      document_id: payload.document_id,
      source_sha_match: true,
      ciphertext_not_pdf_header: true,
      kms_wrap_unwrap: true,
      decrypted_sha_match: true,
      atomic_switch: true,
      authorized_preview_download: true,
      unauthorized_access_denied: unauthorizedAccessDenied,
      old_plaintext_deleted: true,
      already_completed: true,
    };
  }

  const document = await service
    .from('documentos')
    .select('id,workspace_id,storage_path,file_hash_sha256')
    .eq('id', payload.document_id)
    .eq('storage_path', payload.encrypted_path)
    .maybeSingle();
  if (document.error) throw document.error;
  if (!document.data) throw new Error('CANARY_ENCRYPTED_POINTER_NOT_ACTIVE');
  if (document.data.file_hash_sha256?.toLowerCase() !== payload.plaintext_sha256) {
    throw new Error('CANARY_LOGICAL_SHA256_CHANGED');
  }

  const accessEvents = await service
    .from('document_encryption_security_events')
    .select('event_type,user_id,result,occurred_at')
    .eq('document_id', payload.document_id)
    .eq('document_version_id', payload.document_version_id)
    .eq('user_id', audit.actor_user_id)
    .eq('result', 'success')
    .gte('occurred_at', audit.occurred_at)
    .in('event_type', ['DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED']);
  if (accessEvents.error) throw accessEvents.error;
  const eventTypes = new Set((accessEvents.data || []).map((event) => event.event_type));
  if (!eventTypes.has('DOCUMENT_VIEWED') || !eventTypes.has('DOCUMENT_DOWNLOADED')) {
    throw new Error('CANARY_AUTHORIZED_PREVIEW_DOWNLOAD_NOT_VERIFIED');
  }

  const sourceObject = await service.storage.from('documents').download(payload.source_path);
  const sourceExists = !sourceObject.error && Boolean(sourceObject.data);
  if (sourceExists) {
    const source = Buffer.from(await sourceObject.data!.arrayBuffer());
    const sourceMatches = isPdf(source) && sha256(source) === payload.plaintext_sha256;
    source.fill(0);
    if (!sourceMatches) throw new Error('CANARY_SOURCE_CHANGED_BEFORE_DELETE');
  } else {
    const checkpoint = await service
      .from('organization_audit_events')
      .select('id')
      .eq('correlation_id', migrationId)
      .eq('event_type', 'LEGACY_DOCUMENT_ENCRYPTION_CANARY_FINALIZING')
      .maybeSingle();
    if (checkpoint.error) throw checkpoint.error;
    if (!checkpoint.data) throw new Error('CANARY_SOURCE_MISSING_BEFORE_DELETE');
  }

  const encryptedObject = await service.storage.from('documents').download(payload.encrypted_path);
  if (encryptedObject.error || !encryptedObject.data) throw new Error('CANARY_CIPHERTEXT_MISSING');
  const ciphertext = Buffer.from(await encryptedObject.data.arrayBuffer());
  const ciphertextValid = !isPdf(ciphertext) && sha256(ciphertext) === payload.ciphertext_sha256;
  ciphertext.fill(0);
  if (!ciphertextValid) throw new Error('CANARY_CIPHERTEXT_CHANGED');

  const decrypted = await readDocumentStorageObject({
    service,
    storageBucket: 'documents',
    storagePath: payload.encrypted_path,
    expectedPlaintextSha256: payload.plaintext_sha256,
    userId: audit.actor_user_id,
    requestId: `legacy-canary:${migrationId}:finalize`,
  });
  const decryptedMatches = sha256(decrypted.plaintext) === payload.plaintext_sha256;
  decrypted.plaintext.fill(0);
  if (!decryptedMatches) throw new Error('CANARY_FINAL_DECRYPTED_SHA256_MISMATCH');

  if (sourceExists) {
    await appendAudit(service, {
      workspaceId: audit.workspace_id,
      actorUserId: audit.actor_user_id,
      migrationId,
      eventType: 'LEGACY_DOCUMENT_ENCRYPTION_CANARY_FINALIZING',
      documentId: payload.document_id,
      summary: 'Canary validado por la aplicacion; listo para retirar el plaintext original.',
      payload: {
        migration_id: migrationId,
        document_id: payload.document_id,
        source_path: payload.source_path,
        encrypted_path: payload.encrypted_path,
        authorized_preview: true,
        authorized_download: true,
        ciphertext_verified: true,
        decrypted_sha256_verified: true,
      },
    });

    const removed = await service.storage.from('documents').remove([payload.source_path]);
    if (removed.error) throw removed.error;
  }

  await appendAudit(service, {
    workspaceId: audit.workspace_id,
    actorUserId: audit.actor_user_id,
    migrationId,
    eventType: 'LEGACY_DOCUMENT_ENCRYPTION_CANARY_COMPLETED',
    documentId: payload.document_id,
    summary: 'Canary legacy completado y plaintext original retirado.',
    payload: {
      ...payload,
      authorized_preview_download: true,
      unauthorized_access_denied: unauthorizedAccessDenied,
      old_plaintext_deleted: true,
      result: 'completed',
    },
  });

  return {
    status: 'LEGACY_CANARY_PASS',
    migration_id: migrationId,
    document_id: payload.document_id,
    source_sha_match: true,
    ciphertext_not_pdf_header: true,
    kms_wrap_unwrap: true,
    decrypted_sha_match: true,
    atomic_switch: true,
    authorized_preview_download: true,
    unauthorized_access_denied: unauthorizedAccessDenied,
    old_plaintext_deleted: true,
  };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/migrate-legacy-document-canary.ts')) {
  const mode = option('mode');
  if (!['stage', 'finalize', 'rollback'].includes(String(mode))) {
    throw new Error('MODE_MUST_BE_STAGE_FINALIZE_OR_ROLLBACK');
  }
  const service = createClient(
    requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const result =
    mode === 'stage'
      ? await stageLegacyDocumentCanary(service)
      : mode === 'finalize'
        ? await finalizeLegacyDocumentCanary(service)
        : await rollbackLegacyDocumentCanary(service);
  console.info(JSON.stringify(result, null, 2));
}
