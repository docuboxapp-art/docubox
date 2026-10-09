import { NextRequest, NextResponse } from 'next/server';
import { OrganizationApiError } from '@/lib/organization/server';
import { resolveTemplatePublicationContext } from '@/lib/templates/publication-server';
import { formPublicationPermissions } from '@/lib/forms/publication-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id') || '';
    const formId = request.nextUrl.searchParams.get('form_id');
    const context = await resolveTemplatePublicationContext(request, workspaceId);
    let form: { created_by: string; status: string; published_at: string | null } | null = null;
    if (formId) {
      const result = await context.service
        .from('form_templates')
        .select('created_by,status,published_at')
        .eq('workspace_id', workspaceId)
        .eq('id', formId)
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data)
        throw new OrganizationApiError(404, 'form_not_found', 'Formulario no encontrado.');
      form = result.data;
      if (form.created_by !== context.user.id && !context.canManageResources) {
        throw new OrganizationApiError(
          403,
          'form_access_denied',
          'No tienes permiso para administrar este formulario.'
        );
      }
    }
    const ownsForm = !form || form.created_by === context.user.id;
    const personalOwner =
      context.workspace.workspace_type === 'personal' &&
      context.workspace.owner_id === context.user.id;
    const canManage = context.canManageResources || personalOwner;
    let canExecute = false;
    if (context.approvalRequired && (!form || form.status === 'draft') && (ownsForm || canManage)) {
      const permission = await context.userClient.rpc('has_organization_permission', {
        ws_id: workspaceId,
        requested_permission: 'workflows.execute',
      });
      if (permission.error) throw permission.error;
      canExecute = permission.data === true;
    }
    return NextResponse.json(
      {
        workspaceType: context.workspace.workspace_type,
        approvalWorkflow: context.approvalWorkflow,
        permissions: formPublicationPermissions({
          workspaceType: context.workspace.workspace_type,
          personalOwner,
          ownsForm,
          canManageResources: context.canManageResources,
          hasApprovalWorkflow: context.approvalRequired,
          canExecuteWorkflow: canExecute,
          formStatus: form?.status,
          publishedAt: form?.published_at,
        }),
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    const error = cause as { status?: number; code?: string; message?: string };
    const status = typeof error.status === 'number' ? error.status : 500;
    return NextResponse.json(
      {
        error: status >= 500 ? 'No se pudo validar la política de formularios.' : error.message,
        code: error.code || 'form_publication_context_failed',
      },
      { status }
    );
  }
}
