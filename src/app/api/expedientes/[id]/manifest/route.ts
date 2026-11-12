import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import {
  caseIdentity,
  isUuid,
  runtimeFailure,
  runtimeHeaders,
} from '@/lib/case-files/runtime.server';
export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await caseIdentity(request),
      { id } = await context.params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Expediente inválido.' }, { status: 422 });
    const result = await createServiceClient().rpc('case_control_manifest', {
      p_case: id,
      p_actor: actor.id,
    });
    if (result.error) throw result.error;
    const { content, sha256 } = result.data as { content: string; sha256: string };
    if (createHash('sha256').update(content).digest('hex') !== sha256)
      throw new Error('CASE_MANIFEST_INTEGRITY');
    return new NextResponse(content, {
      headers: {
        ...runtimeHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="expediente-${id}.json"`,
        'X-Content-SHA256': sha256,
      },
    });
  } catch (error) {
    const failure = runtimeFailure(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: runtimeHeaders });
  }
}
