import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
} from '@/lib/organization/server';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function cleanFileName(value: string) {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 120) || 'evidence';
}

async function assertPerson(service: any, workspaceId: string, personId: string) {
  const result = await service.from('organization_directory_people')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('id', personId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new OrganizationApiError(404, 'directory_person_not_found', 'No se encontró la persona del directorio.');
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = z.string().uuid().parse(url.searchParams.get('workspace_id'));
    const evidenceId = z.string().uuid().parse(url.searchParams.get('evidence_id'));
    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, 'directory.sensitive.download');
    const evidence = await service.from('organization_directory_evidence')
      .select('id,person_id,display_name,storage_bucket,storage_path')
      .eq('workspace_id', workspaceId)
      .eq('id', evidenceId)
      .maybeSingle();
    if (evidence.error) throw evidence.error;
    if (!evidence.data?.storage_path) throw new OrganizationApiError(404, 'evidence_file_not_found', 'La evidencia no tiene un archivo disponible.');

    const signed = await service.storage
      .from(evidence.data.storage_bucket || 'organization-evidence')
      .createSignedUrl(evidence.data.storage_path, 90, { download: evidence.data.display_name });
    if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error('signed_url_failed');

    await service.from('organization_audit_events').insert({
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: 'directory.evidence.downloaded',
      resource_type: 'organization_directory_evidence',
      resource_id: evidenceId,
      summary: 'Se autorizó una descarga temporal de evidencia',
      payload: { person_id: evidence.data.person_id, ttl_seconds: 90 },
      module: 'directory',
    });
    return Response.json({ success: true, url: signed.data.signedUrl, expires_in: 90 });
  } catch (cause) {
    if (cause instanceof z.ZodError) return Response.json({ success: false, code: 'validation_error', error: 'La referencia de evidencia no es válida.' }, { status: 400 });
    return organizationApiFailure(cause);
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const workspaceId = z.string().uuid().parse(form.get('workspace_id'));
    const personId = z.string().uuid().parse(form.get('person_id'));
    const evidenceType = z.string().trim().min(2).max(80).parse(form.get('evidence_type'));
    const displayName = z.string().trim().min(2).max(180).parse(form.get('display_name'));
    const validFrom = z.string().date().nullable().parse(form.get('valid_from') || null);
    const validUntil = z.string().date().nullable().parse(form.get('valid_until') || null);
    const file = form.get('file');
    if (!(file instanceof File)) throw new OrganizationApiError(400, 'file_required', 'Selecciona un archivo probatorio.');
    if (!ALLOWED_TYPES.has(file.type)) throw new OrganizationApiError(415, 'file_type_not_allowed', 'Sólo se permiten archivos PDF, JPG o PNG.');
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new OrganizationApiError(413, 'file_size_invalid', 'El archivo debe pesar menos de 15 MB.');

    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, 'directory.manage');
    await assertPerson(service, workspaceId, personId);
    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    const bucket = 'organization-evidence';
    const path = `${workspaceId}/${personId}/${randomUUID()}-${cleanFileName(file.name)}`;
    const upload = await service.storage.from(bucket).upload(path, bytes, { contentType: file.type, upsert: false });
    if (upload.error) throw upload.error;

    const inserted = await service.from('organization_directory_evidence').insert({
      workspace_id: workspaceId,
      person_id: personId,
      created_by: user.id,
      evidence_type: evidenceType,
      display_name: displayName,
      storage_bucket: bucket,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      sha256_hash: hash,
      valid_from: validFrom,
      valid_until: validUntil,
      status: 'pending',
      metadata: { original_file_name: file.name },
    }).select('id').single();
    if (inserted.error) {
      await service.storage.from(bucket).remove([path]);
      throw inserted.error;
    }
    await service.from('organization_audit_events').insert({
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: 'directory.evidence.uploaded',
      resource_type: 'organization_directory_evidence',
      resource_id: inserted.data.id,
      summary: 'Documento probatorio cargado en almacenamiento privado',
      payload: { person_id: personId, sha256_hash: hash, size_bytes: file.size, mime_type: file.type },
      module: 'directory',
      severity: 'high',
    });
    return Response.json({ success: true, id: inserted.data.id, sha256_hash: hash }, { status: 201 });
  } catch (cause) {
    if (cause instanceof z.ZodError) return Response.json({ success: false, code: 'validation_error', error: 'Revisa los datos y la vigencia del archivo.' }, { status: 400 });
    return organizationApiFailure(cause);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = z.string().uuid().parse(body.workspace_id);
    const evidenceId = z.string().uuid().parse(body.evidence_id);
    const action = z.enum(['verify', 'revoke']).parse(body.action);
    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, 'directory.manage');
    const status = action === 'verify' ? 'verified' : 'revoked';
    const values = action === 'verify'
      ? { status, verified_by: user.id, verified_at: new Date().toISOString(), revoked_by: null, revoked_at: null }
      : { status, revoked_by: user.id, revoked_at: new Date().toISOString() };
    const result = await service.from('organization_directory_evidence')
      .update(values)
      .eq('workspace_id', workspaceId)
      .eq('id', evidenceId)
      .select('id,person_id')
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new OrganizationApiError(404, 'evidence_not_found', 'No se encontró la evidencia.');
    await service.from('organization_audit_events').insert({
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: `directory.evidence.${status}`,
      resource_type: 'organization_directory_evidence',
      resource_id: evidenceId,
      summary: action === 'verify' ? 'Evidencia validada por un administrador' : 'Evidencia revocada por un administrador',
      payload: { person_id: result.data.person_id },
      module: 'directory',
      severity: 'high',
    });
    return Response.json({ success: true });
  } catch (cause) {
    if (cause instanceof z.ZodError) return Response.json({ success: false, code: 'validation_error', error: 'La solicitud no es válida.' }, { status: 400 });
    return organizationApiFailure(cause);
  }
}
