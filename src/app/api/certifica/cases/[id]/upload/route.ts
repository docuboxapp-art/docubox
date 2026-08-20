import { randomUUID } from 'crypto';
import { authorizeOrganizationRequest, OrganizationApiError } from '@/lib/organization/server';
import { scanWithMetaDefender } from '@/lib/security/metadefender';
import { appendCertificationEvent, certificaApiFailure, requireCertification, safeFilename, sha256 } from '@/lib/certifica/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'application/xml', 'text/xml']);
const MAX_SIZE = 25 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const form = await request.formData();
    const workspaceId = String(form.get('workspace_id') || '');
    const file = form.get('file');
    if (!(file instanceof File)) throw new OrganizationApiError(400, 'file_required', 'Selecciona un archivo.');
    if (!ALLOWED_TYPES.has(file.type)) throw new OrganizationApiError(415, 'unsupported_file', 'Carga un PDF, PNG, JPG o XML.');
    if (file.size <= 0 || file.size > MAX_SIZE) throw new OrganizationApiError(413, 'file_too_large', 'El archivo debe pesar menos de 25 MB.');
    const { service, user } = await authorizeOrganizationRequest(request, workspaceId, 'certifications.create');
    const certification = await requireCertification(service, id, workspaceId);
    if (certification.original_storage_path) throw new OrganizationApiError(409, 'original_already_uploaded', 'El original ya fue cargado y es inmutable. Crea otra certificacion para usar un archivo distinto.');
    const bytes = Buffer.from(await file.arrayBuffer());
    const digest = sha256(bytes);
    const duplicate = await service.from('certification_cases').select('id,human_folio,title').eq('workspace_id', workspaceId).eq('original_sha256', digest).neq('id', id).limit(1).maybeSingle();
    if (duplicate.error) throw duplicate.error;

    let malwareStatus: 'clean' | 'infected' | 'unavailable' | 'failed' = 'unavailable';
    let scanMetadata: Record<string, unknown> = { reason: 'scanner_not_configured' };
    const apiKey = process.env.METADEFENDER_API_KEY;
    if (apiKey) {
      try {
        const scan = await scanWithMetaDefender({ bytes, filename: file.name, apiKey });
        malwareStatus = scan.clean ? 'clean' : 'infected';
        scanMetadata = scan;
      } catch (error) {
        malwareStatus = 'failed';
        scanMetadata = { reason: error instanceof Error ? error.message : 'scanner_failed' };
      }
    }
    if (malwareStatus === 'infected') throw new OrganizationApiError(422, 'malware_detected', 'El archivo no supero el analisis de seguridad.');
    if (process.env.NODE_ENV === 'production' && malwareStatus !== 'clean') throw new OrganizationApiError(503, 'malware_scanner_unavailable', 'El analizador no esta disponible. El archivo no fue almacenado.');

    const path = `${workspaceId}/${id}/${randomUUID()}-${safeFilename(file.name)}`;
    const uploaded = await service.storage.from('certification-originals').upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploaded.error) throw uploaded.error;
    const fileRow = await service.from('certification_files').insert({
      certification_id: id,
      workspace_id: workspaceId,
      category: 'original',
      storage_bucket: 'certification-originals',
      storage_path: path,
      original_name: file.name,
      immutable_name: path.split('/').pop(),
      mime_type: file.type,
      size_bytes: file.size,
      sha256: digest,
      scan_status: malwareStatus,
      metadata: { security_scan: scanMetadata },
      created_by: user.id,
    }).select('*').single();
    if (fileRow.error) {
      await service.storage.from('certification-originals').remove([path]);
      throw fileRow.error;
    }
    const warnings = [
      ...(Array.isArray(certification.warnings) ? certification.warnings : []),
      ...(malwareStatus === 'clean' ? [] : ['Analisis antimalware no disponible en el entorno local.']),
      ...(duplicate.data ? [`Coincide con ${duplicate.data.human_folio}.`] : []),
    ];
    const updated = await service.from('certification_cases').update({
      original_sha256: digest,
      original_storage_path: path,
      original_filename: file.name,
      original_mime_type: file.type,
      original_size_bytes: file.size,
      malware_status: malwareStatus,
      warnings,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select('*').single();
    if (updated.error) throw updated.error;
    await appendCertificationEvent({ service, certificationId: id, workspaceId, actorId: user.id, eventType: 'certification.original_uploaded', payload: { sha256: digest, size_bytes: file.size, malware_status: malwareStatus, duplicate_of: duplicate.data?.id || null } });
    return Response.json({ success: true, case: updated.data, file: fileRow.data, duplicate: duplicate.data || null });
  } catch (error) {
    return certificaApiFailure(error);
  }
}

