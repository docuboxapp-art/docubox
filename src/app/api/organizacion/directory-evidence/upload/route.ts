import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
} from '@/lib/organization/server';
import {
  evidenceUploadSchema,
  createEvidenceUploadTicket,
  verifyEvidenceUploadTicket,
  evidenceContentMatches,
} from '@/lib/organization/evidence-upload-ticket';
export const runtime = 'nodejs';
const bucket = 'organization-evidence';
function failure(error: unknown) {
  if (error instanceof Error && error.message.startsWith('organization_upload_'))
    return Response.json(
      {
        success: false,
        error:
          error.message === 'organization_upload_key_unavailable'
            ? 'No se pudo preparar la carga segura.'
            : 'La autorización de carga venció o no es válida. Selecciona el archivo nuevamente.',
      },
      { status: error.message === 'organization_upload_key_unavailable' ? 503 : 403 }
    );
  return organizationApiFailure(error);
}
export async function POST(request: Request) {
  try {
    const values = evidenceUploadSchema.parse(await request.json());
    const { user, service, userClient } = await authorizeOrganizationRequest(
      request,
      values.workspace_id,
      'directory.manage'
    );
    const ready = await userClient.rpc('organization_directory_upload_available', {
      ws_id: values.workspace_id,
    });
    if (ready.error || ready.data !== true)
      throw new OrganizationApiError(
        503,
        'organization_upload_unavailable',
        'No se pudo comprobar la disponibilidad de carga. Intenta nuevamente.'
      );
    const person = await service
      .from('organization_directory_people')
      .select('id')
      .eq('workspace_id', values.workspace_id)
      .eq('id', values.person_id)
      .maybeSingle();
    if (person.error) throw person.error;
    if (!person.data)
      throw new OrganizationApiError(
        404,
        'directory_person_not_found',
        'No se encontró la persona del directorio.'
      );
    const id = randomUUID(),
      name =
        values.file_name
          .normalize('NFKD')
          .replace(/[^a-zA-Z0-9._-]+/g, '-')
          .slice(0, 120) || 'evidence';
    const path = `${values.workspace_id}/${values.person_id}/${id}-${name}`;
    const ticket = createEvidenceUploadTicket({
      version: 1,
      actor_id: user.id,
      evidence_id: id,
      storage_path: path,
      expires_at: Date.now() + 15 * 60000,
      values,
    });
    const upload = await service.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: false });
    if (upload.error) throw upload.error;
    return Response.json(
      { success: true, ticket, path, token: upload.data.token, bucket },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return failure(error);
  }
}
export async function PUT(request: Request) {
  try {
    const body = z
      .object({ workspace_id: z.string().uuid(), ticket: z.string().min(1).max(8000) })
      .parse(await request.json());
    const ticket = verifyEvidenceUploadTicket(body.ticket);
    const { user, service } = await authorizeOrganizationRequest(
      request,
      body.workspace_id,
      'directory.manage'
    );
    if (ticket.actor_id !== user.id || ticket.values.workspace_id !== body.workspace_id)
      throw new OrganizationApiError(
        403,
        'organization_upload_ticket_invalid',
        'La carga no pertenece a tu sesión u organización.'
      );
    const values = ticket.values;
    const existing = await service
      .from('organization_directory_evidence')
      .select('id,sha256_hash')
      .eq('id', ticket.evidence_id)
      .eq('workspace_id', body.workspace_id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data)
      return Response.json(
        { success: true, ...existing.data },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    const file = await service.storage.from(bucket).download(ticket.storage_path);
    if (file.error) throw file.error;
    if (file.data.size !== values.size_bytes) {
      await service.storage.from(bucket).remove([ticket.storage_path]);
      throw new OrganizationApiError(
        422,
        'evidence_size_mismatch',
        'El archivo recibido tiene un tamaño distinto. Cárgalo nuevamente.'
      );
    }
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== values.sha256_hash || !evidenceContentMatches(bytes, values.mime_type)) {
      await service.storage.from(bucket).remove([ticket.storage_path]);
      throw new OrganizationApiError(
        422,
        'evidence_content_mismatch',
        'El contenido o la huella del archivo no coincide. Cárgalo nuevamente.'
      );
    }
    const result = await service.rpc('finalize_organization_directory_evidence', {
      ws: body.workspace_id,
      actor: user.id,
      evidence_id: ticket.evidence_id,
      evidence_values: { ...values, storage_path: ticket.storage_path },
    });
    if (result.error) throw result.error;
    return Response.json(
      { success: true, id: ticket.evidence_id, sha256_hash: hash },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return failure(error);
  }
}
