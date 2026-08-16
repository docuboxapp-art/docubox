import { createHash } from 'crypto';
import { z } from 'zod';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
  recordCollaborationAudit,
} from '@/lib/collaboration/server';

export const runtime = 'nodejs';

const bodySchema = z.object({ workspace_id: z.string().uuid() });
const scannerResponseSchema = z.object({
  clean: z.boolean().optional(),
  status: z.enum(['clean', 'infected', 'quarantined']).optional(),
  threat: z.string().max(500).optional(),
  engine: z.string().max(120).optional(),
  signature_version: z.string().max(120).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const input = bodySchema.parse(await request.json());
    const { fileId } = await context.params;
    const { service, user } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      'requests.review_items',
      true
    );
    const scannerUrl = process.env.COLABORA_MALWARE_SCAN_URL;
    const scannerToken = process.env.COLABORA_MALWARE_SCAN_TOKEN;
    if (!scannerUrl || !scannerToken) {
      throw new OrganizationApiError(
        503,
        'malware_scanner_not_configured',
        'El servicio de analisis de archivos no esta configurado. El archivo permanece bloqueado.'
      );
    }

    const fileResult = await service
      .from('collaboration_request_files')
      .select(
        'id,workspace_id,request_item_id,original_name,storage_path,mime_type,sha256,metadata'
      )
      .eq('id', fileId)
      .eq('workspace_id', input.workspace_id)
      .maybeSingle();
    if (fileResult.error) throw fileResult.error;
    if (!fileResult.data)
      throw new OrganizationApiError(404, 'request_file_not_found', 'El archivo no existe.');

    const downloaded = await service.storage
      .from('documents')
      .download(fileResult.data.storage_path);
    if (downloaded.error || !downloaded.data)
      throw new OrganizationApiError(
        503,
        'request_file_unavailable',
        'No se pudo leer el archivo privado.'
      );
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== fileResult.data.sha256) {
      await service
        .from('collaboration_request_files')
        .update({
          malware_scan_status: 'quarantined',
          metadata: {
            ...(fileResult.data.metadata || {}),
            security_scan: {
              checked_at: new Date().toISOString(),
              result: 'integrity_mismatch',
            },
          },
        })
        .eq('id', fileId);
      throw new OrganizationApiError(
        409,
        'request_file_integrity_mismatch',
        'La huella del archivo no coincide. El archivo fue puesto en cuarentena.'
      );
    }

    let scanResponse: Response;
    try {
      scanResponse = await fetch(scannerUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${scannerToken}`,
          'Content-Type': fileResult.data.mime_type,
          'X-File-Name': encodeURIComponent(fileResult.data.original_name),
          'X-Content-SHA256': actualHash,
        },
        body: bytes,
        signal: AbortSignal.timeout(30_000),
        cache: 'no-store',
      });
    } catch {
      await service
        .from('collaboration_request_files')
        .update({ malware_scan_status: 'failed' })
        .eq('id', fileId);
      throw new OrganizationApiError(
        503,
        'malware_scanner_unavailable',
        'El analizador no respondio. El archivo permanece bloqueado.'
      );
    }
    if (!scanResponse.ok) {
      await service
        .from('collaboration_request_files')
        .update({ malware_scan_status: 'failed' })
        .eq('id', fileId);
      throw new OrganizationApiError(
        503,
        'malware_scanner_failed',
        'El analizador no pudo completar la revision. El archivo permanece bloqueado.'
      );
    }
    const result = scannerResponseSchema.parse(await scanResponse.json());
    const clean = result.clean === true || result.status === 'clean';
    const status = clean ? 'clean' : 'quarantined';
    const checkedAt = new Date().toISOString();
    const updated = await service
      .from('collaboration_request_files')
      .update({
        malware_scan_status: status,
        metadata: {
          ...(fileResult.data.metadata || {}),
          security_scan: {
            checked_at: checkedAt,
            engine: result.engine || 'configured-provider',
            signature_version: result.signature_version || null,
            result: status,
            threat: result.threat || null,
          },
        },
      })
      .eq('id', fileId);
    if (updated.error) throw updated.error;
    await recordCollaborationAudit(service, {
      workspaceId: input.workspace_id,
      actorUserId: user.id,
      eventType: 'collaboration.request_file_scanned',
      resourceType: 'request_file',
      resourceId: fileId,
      summary: clean
        ? 'El archivo supero el analisis de seguridad.'
        : 'El archivo fue puesto en cuarentena por el analizador.',
      payload: { result: status, request_item_id: fileResult.data.request_item_id },
      outcome: clean ? 'success' : 'denied',
    });
    return Response.json({ success: true, status, checked_at: checkedAt });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
