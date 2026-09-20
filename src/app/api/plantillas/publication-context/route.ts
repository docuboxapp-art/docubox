import { NextRequest, NextResponse } from 'next/server';
import {
  nextTemplateVersion,
  resolveTemplatePublicationContext,
  templateApiFailure,
} from '@/lib/templates/publication-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id') || '';
    const templateId = searchParams.get('template_id');
    const context = await resolveTemplatePublicationContext(request, workspaceId, templateId);
    const rootTemplateId = context.template?.root_template_id || context.template?.id;

    const [areasResult, typesResult, versionsResult] = await Promise.all([
      context.workspace.workspace_type === 'business'
        ? context.service
            .from('organization_units')
            .select('id,name')
            .eq('workspace_id', workspaceId)
            .eq('status', 'active')
            .order('name')
        : Promise.resolve({ data: [], error: null }),
      context.service.from('tipo_documento').select('id,nombre').order('nombre'),
      rootTemplateId && context.canCreateVersion
        ? context.service
            .from('plantillas')
            .select('version_publicada')
            .eq('workspace_id', workspaceId)
            .or(`id.eq.${rootTemplateId},root_template_id.eq.${rootTemplateId}`)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (areasResult.error) throw areasResult.error;
    if (typesResult.error) throw typesResult.error;
    if (versionsResult.error) throw versionsResult.error;

    const currentVersion = context.template?.version_publicada || '1.0';
    const nextVersion = context.canCreateVersion
      ? nextTemplateVersion((versionsResult.data || []).map((item) => item.version_publicada))
      : currentVersion;

    return NextResponse.json(
      {
        workspaceType: context.workspace.workspace_type,
        workspaceName: context.workspace.name,
        role: context.membership.role,
        policy: context.approvalRequired ? 'APPROVAL_REQUIRED' : 'DIRECT_PUBLISH',
        approvalWorkflow: context.approvalWorkflow,
        permissions: {
          canSaveDraft: context.canSaveDraft,
          canPublish: context.canPublish,
          canSubmitApproval: context.canSubmitApproval,
          canCreateVersion: context.canCreateVersion,
        },
        template: context.template
          ? {
              id: context.template.id,
              status: context.template.estado,
              displayStatus: context.template.estado_plantilla,
              currentVersion,
              nextVersion,
            }
          : null,
        areas: areasResult.data || [],
        templateTypes: typesResult.data || [],
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    return templateApiFailure(cause);
  }
}
