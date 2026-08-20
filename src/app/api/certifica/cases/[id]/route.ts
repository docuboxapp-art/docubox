import { z } from 'zod';
import { authorizeOrganizationRequest } from '@/lib/organization/server';
import { appendCertificationEvent, certificaApiFailure, requireCertification } from '@/lib/certifica/server';

const patchSchema = z.object({
  workspace_id: z.string().uuid(),
  title: z.string().trim().min(3).max(180).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  purpose_key: z.enum(['prove_integrity', 'prove_existence', 'nom151_conservation', 'validate_signatures', 'complete_evidence']).nullable().optional(),
  service_key: z.enum(['integrity', 'certified_time', 'nom151', 'evidence_pro']).optional(),
  declared_date: z.string().date().nullable().optional(),
  retention_years: z.number().int().min(1).max(20).optional(),
  selected_addons: z.array(z.string().max(80)).max(20).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'certifications.view');
    const certification = await requireCertification(service, id, workspaceId);
    const [files, signatures, evidences, events, declaration, manifest] = await Promise.all([
      service.from('certification_files').select('*').eq('certification_id', id).order('created_at'),
      service.from('certification_signatures').select('*').eq('certification_id', id).order('created_at'),
      service.from('certification_evidences').select('*').eq('certification_id', id).order('created_at'),
      service.from('certification_case_events').select('*').eq('certification_id', id).order('sequence_number'),
      service.from('certification_declarations').select('text_version,accepted_at').eq('certification_id', id).maybeSingle(),
      service.from('certification_manifests').select('schema_version,canonical_sha256,created_at').eq('certification_id', id).maybeSingle(),
    ]);
    for (const result of [files, signatures, evidences, events, declaration, manifest]) if (result.error) throw result.error;
    return Response.json({
      success: true,
      case: certification,
      files: files.data || [],
      signatures: signatures.data || [],
      evidences: evidences.data || [],
      events: events.data || [],
      declaration: declaration.data,
      manifest: manifest.data,
    });
  } catch (error) {
    return certificaApiFailure(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = patchSchema.parse(await request.json());
    const { service, user } = await authorizeOrganizationRequest(request, input.workspace_id, 'certifications.create');
    const current = await requireCertification(service, id, input.workspace_id);
    if (!['draft', 'ready', 'requires_review'].includes(current.status)) {
      throw Object.assign(new Error('La certificacion ya no admite cambios.'), { status: 409, code: 'certification_locked' });
    }
    const { workspace_id: _, ...changes } = input;
    const updated = await service
      .from('certification_cases')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', input.workspace_id)
      .select('*')
      .single();
    if (updated.error) throw updated.error;
    await appendCertificationEvent({ service, certificationId: id, workspaceId: input.workspace_id, actorId: user.id, eventType: 'certification.updated', payload: { fields: Object.keys(changes) } });
    return Response.json({ success: true, case: updated.data });
  } catch (error) {
    return certificaApiFailure(error);
  }
}

