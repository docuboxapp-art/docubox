import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  caseIdentity,
  caseSnapshot,
  executeCaseControl,
  isUuid,
  publicCaseRuntime,
  record,
  refreshCaseControl,
  runtimeFailure,
  runtimeHeaders,
  textValue,
} from '@/lib/case-files/runtime.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await caseIdentity(request),
      { id } = await context.params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Expediente inválido.' }, { status: 422 });
    const snapshot = await caseSnapshot(createServiceClient(), id, actor.id);
    return NextResponse.json(
      { data: publicCaseRuntime(snapshot, actor.id) },
      { headers: runtimeHeaders }
    );
  } catch (error) {
    const failure = runtimeFailure(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: runtimeHeaders });
  }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await caseIdentity(request),
      { id } = await context.params;
    const raw = await request.text();
    if (raw.length > 20_000)
      return NextResponse.json({ error: 'Solicitud demasiado grande.' }, { status: 413 });
    const body = record(JSON.parse(raw));
    if (!isUuid(id) || !isUuid(body.operationKey))
      return NextResponse.json(
        { error: 'Actualiza la página para iniciar una operación válida.' },
        { status: 422 }
      );
    const service = createServiceClient();
    const action = textValue(body.action);
    if (['attach', 'verify', 'assign', 'applicability', 'metadata'].includes(action)) {
      const snapshot = await caseSnapshot(service, id, actor.id);
      if (body.revision !== snapshot.revision)
        return NextResponse.json(
          {
            error: 'La evidencia cambió. Actualiza el expediente.',
            code: 'CASE_REVISION_CONFLICT',
          },
          { status: 409 }
        );
      if (action === 'attach') {
        if (!isUuid(body.sourceId) || !['document', 'form'].includes(textValue(body.kind)))
          return NextResponse.json({ error: 'Selecciona una fuente válida.' }, { status: 422 });
        const result = await service.rpc('case_control_attach', {
          p_case: id,
          p_actor: actor.id,
          p_revision: snapshot.revision,
          p_item: body.itemId,
          p_source: body.sourceId,
          p_kind: body.kind,
          p_operation: body.operationKey,
          p_issue_date:
            typeof body.issueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.issueDate)
              ? body.issueDate
              : null,
        });
        if (result.error) throw result.error;
      } else {
        const result = await service.rpc('case_control_configure', {
          p_case: id,
          p_actor: actor.id,
          p_revision: snapshot.revision,
          p_action: action,
          p_input: body,
          p_operation: body.operationKey,
        });
        if (result.error) throw result.error;
      }
      await refreshCaseControl(service, id, actor.id);
    } else await executeCaseControl(service, id, actor.id, action, body.operationKey, body);
    return NextResponse.json(
      { data: publicCaseRuntime(await caseSnapshot(service, id, actor.id), actor.id) },
      { headers: runtimeHeaders }
    );
  } catch (error) {
    const failure = runtimeFailure(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: runtimeHeaders });
  }
}
