import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authorizeOrganizationRequest, OrganizationApiError } from '@/lib/organization/server';
import { isCertificationService } from '@/lib/certifica/domain';
import { appendCertificationEvent, certificaApiFailure, createCertificationFolio } from '@/lib/certifica/server';

export const runtime = 'nodejs';

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(1000).optional(),
  service_key: z.string().default('integrity'),
  purpose_key: z.string().max(80).optional(),
  source_type: z.enum(['upload', 'document', 'contract', 'expedient', 'batch']).default('upload'),
  source_document_id: z.string().uuid().optional(),
  provider_mode: z.enum(['sandbox', 'production']).default('sandbox'),
  idempotency_key: z.string().trim().min(8).max(180).optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id') || '';
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'certifications.view');
    let query = service
      .from('certification_cases')
      .select('id,human_folio,public_id,title,service_key,status,provider_mode,original_filename,original_sha256,file_classification,malware_status,total_amount,currency,created_at,updated_at,issued_at,validated_at,warnings')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100);
    const status = url.searchParams.get('status');
    if (status) query = query.eq('status', status);
    const result = await query;
    if (result.error) throw result.error;
    return Response.json({ success: true, cases: result.data || [] });
  } catch (error) {
    return certificaApiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    if (!isCertificationService(input.service_key)) {
      throw new OrganizationApiError(400, 'invalid_service', 'Selecciona un servicio de certificacion valido.');
    }
    const { service, user } = await authorizeOrganizationRequest(request, input.workspace_id, 'certifications.create');
    const idempotencyKey = input.idempotency_key || randomUUID();
    const insert = await service
      .from('certification_cases')
      .insert({
        workspace_id: input.workspace_id,
        created_by: user.id,
        human_folio: createCertificationFolio(),
        idempotency_key: idempotencyKey,
        source_type: input.source_type,
        source_document_id: input.source_document_id || null,
        title: input.title,
        description: input.description || null,
        service_key: input.service_key,
        purpose_key: input.purpose_key || null,
        provider_mode: input.provider_mode,
      })
      .select('*')
      .single();
    if (insert.error?.code === '23505') {
      const existing = await service
        .from('certification_cases')
        .select('*')
        .eq('workspace_id', input.workspace_id)
        .eq('idempotency_key', idempotencyKey)
        .single();
      if (existing.error) throw existing.error;
      return Response.json({ success: true, case: existing.data, idempotent: true });
    }
    if (insert.error) throw insert.error;
    await appendCertificationEvent({
      service,
      certificationId: insert.data.id,
      workspaceId: input.workspace_id,
      actorId: user.id,
      eventType: 'certification.created',
      payload: { service_key: input.service_key, provider_mode: input.provider_mode },
    });
    return Response.json({ success: true, case: insert.data }, { status: 201 });
  } catch (error) {
    return certificaApiFailure(error);
  }
}

