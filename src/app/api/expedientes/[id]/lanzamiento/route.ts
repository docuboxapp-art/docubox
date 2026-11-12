import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  caseIdentity,
  isUuid,
  CaseRuntimeError,
  record,
  runtimeFailure,
  runtimeHeaders,
} from '@/lib/case-files/runtime.server';
import { requireCaseWorkspace } from '@/lib/case-files/consultation.server';
import { casePublicLaunchAccess } from '@/lib/case-files/launch-access.server';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await caseIdentity(request),
      { id } = await context.params;
    if (!isUuid(id)) throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Expediente inválido.', 422);
    const service = createServiceClient(),
      c = await service.from('case_files').select('workspace_id').eq('id', id).maybeSingle();
    if (c.error) throw c.error;
    await requireCaseWorkspace(service, c.data?.workspace_id, actor.id);
    const r = await service
      .from('case_launches')
      .select('access_mode,signature_type,require_liveness,expiration_hours,scheduled_at,timezone')
      .eq('case_file_id', id)
      .maybeSingle();
    if (r.error) throw r.error;
    return NextResponse.json({ data: r.data }, { headers: runtimeHeaders });
  } catch (cause) {
    const f = runtimeFailure(cause);
    return NextResponse.json(f.body, { status: f.status, headers: runtimeHeaders });
  }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await caseIdentity(request),
      { id } = await context.params,
      raw = await request.text();
    if (!isUuid(id) || raw.length > 1000)
      throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Solicitud inválida.', 422);
    const body = record(JSON.parse(raw)),
      service = createServiceClient();
    if (body.action === 'access') {
      const access = await casePublicLaunchAccess(
        service,
        id,
        actor.id,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      if (!access)
        throw new CaseRuntimeError(
          'CASE_PORTAL_INVALID',
          'No hay un acceso público vigente para este expediente.',
          409
        );
      return NextResponse.json({ data: { access } }, { headers: runtimeHeaders });
    }
    if (body.action === 'cancel') {
      const result = await service.rpc('case_cancel_scheduled_launch', {
        p_case: id,
        p_actor: actor.id,
      });
      if (result.error) throw result.error;
      return NextResponse.json({ data: result.data }, { headers: runtimeHeaders });
    }
    throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Acción no disponible.', 422);
  } catch (cause) {
    const f = runtimeFailure(cause);
    return NextResponse.json(f.body, { status: f.status, headers: runtimeHeaders });
  }
}
