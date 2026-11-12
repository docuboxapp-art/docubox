import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  caseIdentity,
  isUuid,
  record,
  runtimeFailure,
  runtimeHeaders,
  runtimePublication,
} from '@/lib/case-files/runtime.server';
import type { StoredCaseTemplate } from '@/lib/case-files/template-builder';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const actor = await caseIdentity(request),
      raw = await request.text();
    if (raw.length > 500_000)
      return NextResponse.json({ error: 'Configuración demasiado grande.' }, { status: 413 });
    const body = record(JSON.parse(raw));
    if (!isUuid(body.workspaceId) || !body.template)
      return NextResponse.json(
        { error: 'Selecciona el espacio y la configuración.' },
        { status: 422 }
      );
    const data = await runtimePublication(
      createServiceClient(),
      actor.id,
      body.workspaceId,
      body.template as StoredCaseTemplate,
      null,
      false
    );
    return NextResponse.json(data, { headers: runtimeHeaders });
  } catch (error) {
    const failure = runtimeFailure(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: runtimeHeaders });
  }
}
