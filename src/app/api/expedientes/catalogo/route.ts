import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { caseIdentity, runtimeFailure, runtimeHeaders } from '@/lib/case-files/runtime.server';
import { requireCaseWorkspace } from '@/lib/case-files/consultation.server';
export async function GET(request: NextRequest) {
  try {
    const actor = await caseIdentity(request),
      service = createServiceClient(),
      workspace = request.nextUrl.searchParams.get('workspaceId');
    await requireCaseWorkspace(service, workspace, actor.id);
    const r = await service
      .from('case_file_templates')
      .select('id,name,description,case_type,publication_version,updated_at')
      .eq('workspace_id', workspace)
      .eq('status', 'active')
      .gt('publication_version', 0)
      .order('name');
    if (r.error) throw r.error;
    return NextResponse.json({ data: r.data || [] }, { headers: runtimeHeaders });
  } catch (cause) {
    const f = runtimeFailure(cause);
    return NextResponse.json(f.body, { status: f.status, headers: runtimeHeaders });
  }
}
