import 'server-only';
import {assertCasePortalEntry} from './entry.server';
import { createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
import {
  encryptAndUploadDocumentObject,
  documentEncryptionPolicy,
} from '@/lib/crypto/document-encryption';
import {
  safePackageFileName,
  validatePackageFile,
  PackageFileValidationError,
} from '@/lib/document-package/file-validation';
import {
  hashInvitationToken,
  encryptInvitationSecret,
  decryptInvitationSecret,
} from './invitations';
import { CaseRuntimeError, isUuid, record, refreshCaseControl } from './runtime.server';
import { portalFileRules } from './portal';

const stagingBucket = 'case-portal-staging';
export async function portalAccess(request: NextRequest, write: boolean) {
  const token = request.headers.get('x-case-invitation') || '';
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new CaseRuntimeError('CASE_PORTAL_INVALID', 'La invitación no está disponible.', 403);
  if (
    write &&
    request.headers.get('origin') &&
    request.headers.get('origin') !== request.nextUrl.origin
  )
    throw new CaseRuntimeError('CASE_PORTAL_ORIGIN', 'Solicitud no permitida.', 403);
  const hash = hashInvitationToken(token);
  if (
    !(await consumeServerRateLimit({
      scope: write ? 'case-portal-write' : 'case-portal-read',
      identifiers: [hash],
      limit: write ? 60 : 120,
      windowSeconds: 600,
    }))
  )
    throw new CaseRuntimeError(
      'CASE_PORTAL_RATE',
      'Espera un momento antes de volver a intentarlo.',
      429
    );
  const service = createServiceClient();
  const response = await service.rpc('case_portal_context', { p_hash: hash, p_write: write });
  if (response.error) throw response.error;
  const ctx = response.data as {
    case: { id: string; workspace_id: string; owner_user_id: string; status: string };
    invitation: { id: string };
    participant: { id: string };
  };
  await assertCasePortalEntry(hash,request);
  return { service, hash, ctx };
}
export async function readCasePortal(
  access: Awaited<ReturnType<typeof portalAccess>>,
  refresh = false
) {
  if (refresh && !['sealed', 'cancelled'].includes(access.ctx.case.status)) {
    // Evidence is durable even if a transient projection refresh fails. The
    // existing task queue and subsequent refresh retry the same evaluation.
    await refreshCaseControl(access.service, access.ctx.case.id, access.ctx.case.owner_user_id);
  }
  const result = await access.service.rpc('case_invitation_portal', { p_hash: access.hash });
  if (result.error) throw result.error;
  if (!result.data)
    throw new CaseRuntimeError('CASE_PORTAL_INVALID', 'La invitación ya no está disponible.', 403);
  return result.data;
}
export async function preparePortalUpload(
  access: Awaited<ReturnType<typeof portalAccess>>,
  body: Record<string, unknown>
) {
  const expired = await access.service
    .from('case_portal_uploads')
    .select('id')
    .eq('invitation_id', access.ctx.invitation.id)
    .lt('expires_at', new Date().toISOString())
    .neq('status', 'completed')
    .limit(3);
  if (expired.data?.length)
    await access.service.storage
      .from(stagingBucket)
      .remove(expired.data.map((row) => `${access.ctx.case.id}/${row.id}.enc`));
  if (
    !isUuid(body.requirementId) ||
    !isUuid(body.operationKey) ||
    typeof body.name !== 'string' ||
    typeof body.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.sha256) ||
    !Number.isSafeInteger(body.size) ||
    Number(body.size) <= 0
  )
    throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Selecciona un archivo válido.', 422);
  if (
    body.issueDate &&
    (typeof body.issueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.issueDate))
  )
    throw new CaseRuntimeError(
      'CASE_ISSUE_DATE_REQUIRED',
      'Indica una fecha de emisión válida.',
      422
    );
  const row = await access.service
    .from('case_file_requirements')
    .select('settings')
    .eq('id', body.requirementId)
    .eq('case_file_id', access.ctx.case.id)
    .maybeSingle();
  if (row.error) throw row.error;
  const rules = portalFileRules(record(row.data?.settings));
  const mime = String(body.mime || '');
  if (!row.data || !rules.mimes.includes(mime) || Number(body.size) > rules.maxBytes)
    throw new CaseRuntimeError(
      'CASE_FILE_INVALID',
      'Revisa el formato y el tamaño permitido del archivo.',
      422
    );
  const key = randomBytes(32).toString('base64'),
    nonce = randomBytes(12).toString('base64');
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const result = await access.service.rpc('case_portal_prepare_upload', {
    p_hash: access.hash,
    p_requirement: body.requirementId,
    p_operation: body.operationKey,
    p_meta: {
      name: safePackageFileName(body.name),
      mime,
      size: body.size,
      sha256: body.sha256,
      issueDate: body.issueDate || null,
      keyCiphertext: encryptInvitationSecret(key, secret),
      nonce,
    },
  });
  if (result.error) throw result.error;
  const upload = result.data;
  if (upload.status === 'completed') return { id: upload.id, completed: true };
  if (Date.parse(upload.expires_at) <= Date.now())
    throw new CaseRuntimeError(
      'CASE_UPLOAD_STALE',
      'La carga venció. Selecciona de nuevo el archivo.',
      409
    );
  const path = `${access.ctx.case.id}/${upload.id}.enc`;
  const signed = await access.service.storage.from(stagingBucket).createSignedUploadUrl(path);
  if (signed.error) throw signed.error;
  return {
    id: upload.id,
    completed: false,
    bucket: stagingBucket,
    path,
    uploadToken: signed.data.token,
    key: decryptInvitationSecret(upload.key_ciphertext, secret),
    nonce: upload.nonce,
  };
}
export async function finishPortalUpload(
  access: Awaited<ReturnType<typeof portalAccess>>,
  uploadId: unknown
) {
  if (!isUuid(uploadId)) throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Carga inválida.', 422);
  const service = access.service;
  const found = await service
    .from('case_portal_uploads')
    .select('*')
    .eq('id', uploadId)
    .eq('invitation_id', access.ctx.invitation.id)
    .maybeSingle();
  if (found.error) throw found.error;
  if (!found.data)
    throw new CaseRuntimeError(
      'CASE_PORTAL_SCOPE',
      'Esta carga no corresponde a tu invitación.',
      403
    );
  if (found.data.status === 'completed') return { id: uploadId, completed: true };
  const encrypted = documentEncryptionPolicy().enabled;
  const path = `tenants/${access.ctx.case.workspace_id}/documents/${found.data.document_id}/versions/${found.data.version_id}/payload.${encrypted ? 'enc' : found.data.file_name.split('.').pop()}`;
  const claim = randomUUID();
  const claimed = await service.rpc('case_portal_claim_upload', {
    p_hash: access.hash,
    p_upload: uploadId,
    p_claim: claim,
    p_path: path,
  });
  if (claimed.error) throw claimed.error;
  const upload = claimed.data;
  if (upload.status === 'completed') return { id: uploadId, completed: true };
  const stagePath = `${access.ctx.case.id}/${uploadId}.enc`;
  let bytes: Buffer | undefined;
  try {
    const stored = await service.storage.from(stagingBucket).download(stagePath);
    if (stored.error)
      throw new CaseRuntimeError(
        'CASE_UPLOAD_MISSING',
        'No se recibió el archivo completo. Vuelve a intentar la carga.',
        409
      );
    const encryptedBytes = Buffer.from(await stored.data.arrayBuffer());
    if (encryptedBytes.length !== Number(upload.byte_size) + 16)
      throw new CaseRuntimeError('CASE_FILE_INVALID', 'El archivo recibido está incompleto.', 422);
    const key = Buffer.from(
      decryptInvitationSecret(upload.key_ciphertext, process.env.SUPABASE_SERVICE_ROLE_KEY!),
      'base64'
    );
    try {
      const decrypt = createDecipheriv('aes-256-gcm', key, Buffer.from(upload.nonce, 'base64'));
      decrypt.setAAD(Buffer.from(upload.id));
      decrypt.setAuthTag(encryptedBytes.subarray(-16));
      bytes = Buffer.concat([decrypt.update(encryptedBytes.subarray(0, -16)), decrypt.final()]);
    } catch {
      throw new CaseRuntimeError(
        'CASE_FILE_INVALID',
        'No se pudo validar la integridad del archivo. Selecciónalo de nuevo.',
        422
      );
    } finally {
      key.fill(0);
      encryptedBytes.fill(0);
    }
    const req = await service
      .from('case_file_requirements')
      .select('settings')
      .eq('id', upload.requirement_id)
      .eq('case_file_id', access.ctx.case.id)
      .single();
    if (req.error) throw req.error;
    const rules = portalFileRules(record(req.data.settings));
    const checked = await validatePackageFile(
      new File([new Uint8Array(bytes)], upload.file_name, { type: upload.mime_type }),
      rules.mimes,
      rules.maxBytes
    );
    try {
      if (checked.sha256 !== upload.sha256)
        throw new CaseRuntimeError(
          'CASE_FILE_INVALID',
          'El contenido no coincide con la carga iniciada.',
          422
        );
      if (encrypted)
        await encryptAndUploadDocumentObject({
          service,
          plaintext: bytes,
          tenantId: access.ctx.case.workspace_id,
          documentId: upload.document_id,
          documentVersionId: upload.version_id,
          artifactKind: 'document',
          storageBucket: 'documents',
          storagePath: path,
          originalFileName: upload.file_name,
          originalMimeType: checked.detectedMime,
          userId: null,
          requestId: upload.id,
        });
      else {
        const saved = await service.storage
          .from('documents')
          .upload(path, bytes, { contentType: checked.detectedMime, upsert: false });
        if (
          saved.error &&
          !['409', 'Duplicate'].includes(String(saved.error.statusCode)) &&
          !/already exists/i.test(saved.error.message)
        )
          throw saved.error;
      }
      const committed = await service.rpc('case_portal_commit_upload', {
        p_hash: access.hash,
        p_upload: upload.id,
        p_claim: claim,
      });
      if (committed.error) throw committed.error;
      // Never delete canonical evidence after an ambiguous commit. Retrying the
      // receipt is idempotent; only the encrypted temporary copy is disposable.
      await service.storage.from(stagingBucket).remove([stagePath]);
      return committed.data;
    } finally {
      checked.bytes.fill(0);
    }
  } catch (cause) {
    await service
      .from('case_portal_uploads')
      .update({ claim_expires_at: new Date().toISOString() })
      .eq('id', uploadId)
      .eq('claim_id', claim)
      .neq('status', 'completed');
    if (cause instanceof PackageFileValidationError)
      throw new CaseRuntimeError(cause.code, cause.message, cause.status);
    throw cause;
  } finally {
    bytes?.fill(0);
  }
}
