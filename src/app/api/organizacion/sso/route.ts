import { createHash, randomBytes } from 'node:crypto';
import {
  authorizeOrganizationRequest,
  organizationApiFailure,
  requireOrganizationReauthentication,
} from '@/lib/organization/server';
import { isPhaseEFeatureEnabled, PHASE_E_FEATURES } from '@/lib/phase-e/feature-flags';

export const runtime = 'nodejs';

function normalizeDomain(value: unknown) {
  const domain = String(value || '').trim().toLowerCase().replace(/^@/, '');
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)
    ? domain
    : '';
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspace_id || '');
    const action = String(body.action || '');
    const { user, service } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'integrations.manage'
    );
    if (!(await isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.organizationSso))) {
      return Response.json({ success: false, error: 'SSO no esta habilitado.' }, { status: 503 });
    }
    if (action === 'configure') {
      await requireOrganizationReauthentication(request, workspaceId, user.id, 'integrations.manage');
      const protocol = body.protocol === 'oidc' ? 'oidc' : 'saml';
      const providerId = String(body.provider_id || '').trim();
      const domain = normalizeDomain(body.domain);
      const displayName = String(body.display_name || '').trim();
      if (!providerId || providerId.length > 200 || !domain || !displayName || displayName.length > 120) {
        return Response.json({ success: false, error: 'Completa proveedor, dominio y nombre.' }, { status: 400 });
      }
      const saved = await service
        .from('organization_integrations')
        .upsert(
          {
            workspace_id: workspaceId,
            provider_key: `sso:${providerId}`,
            display_name: displayName,
            integration_type: 'sso',
            environment: 'production',
            status: 'not_configured',
            configuration: {
              protocol,
              provider_id: providerId,
              domain,
              test_status: 'pending',
              jit_provisioning: false,
            },
            secret_reference: null,
            created_by: user.id,
          },
          { onConflict: 'workspace_id,provider_key' }
        )
        .select('id,workspace_id,provider_key,display_name,status,configuration,updated_at')
        .single();
      if (saved.error) throw saved.error;
      await service.from('organization_audit_events').insert({
        workspace_id: workspaceId,
        actor_user_id: user.id,
        event_type: 'security.sso.configured',
        resource_type: 'organization_integration',
        resource_id: saved.data.id,
        summary: `Proveedor SSO configurado: ${displayName}`,
        severity: 'high',
        module: 'security',
        payload: { protocol, domain, provider_id_suffix: providerId.slice(-8) },
      });
      return Response.json({ success: true, data: saved.data });
    }
    if (action === 'begin_test') {
      const integrationId = String(body.integration_id || '');
      const integration = await service
        .from('organization_integrations')
        .select('id,status,configuration')
        .eq('id', integrationId)
        .eq('workspace_id', workspaceId)
        .eq('integration_type', 'sso')
        .maybeSingle();
      if (integration.error) throw integration.error;
      const configuration = integration.data?.configuration as Record<string, unknown> | undefined;
      const providerId = String(configuration?.provider_id || '');
      const domain = normalizeDomain(configuration?.domain);
      if (!integration.data || !providerId || !domain) {
        return Response.json({ success: false, error: 'El proveedor SSO no esta configurado.' }, { status: 409 });
      }
      const token = randomBytes(32).toString('base64url');
      const created = await service.from('organization_sso_test_sessions').insert({
        workspace_id: workspaceId,
        integration_id: integrationId,
        initiated_by: user.id,
        token_hash: createHash('sha256').update(token).digest('hex'),
        expected_provider_id: providerId,
        expected_domain: domain,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (created.error) throw created.error;
      return Response.json({
        success: true,
        test_token: token,
        provider_id: providerId,
        expires_in: 600,
      });
    }
    return Response.json({ success: false, error: 'Accion SSO invalida.' }, { status: 400 });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
