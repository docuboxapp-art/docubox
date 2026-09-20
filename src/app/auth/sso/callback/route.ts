import { createHash } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isPhaseEFeatureEnabled, PHASE_E_FEATURES } from '@/lib/phase-e/feature-flags';

export const dynamic = 'force-dynamic';

function safeNext(value: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/inicio';
}

function ssoProviderId(user: { app_metadata?: Record<string, unknown> } | null) {
  return String(
    user?.app_metadata?.sso_provider_id ||
      user?.app_metadata?.provider_id ||
      user?.app_metadata?.providerId ||
      ''
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const testToken = url.searchParams.get('test');
  const next = safeNext(url.searchParams.get('next'));
  const redirect = NextResponse.redirect(new URL(next, url.origin));
  redirect.headers.set('Cache-Control', 'private, no-store');
  if (!code) return NextResponse.redirect(new URL('/login?error=sso_callback_invalid', url.origin));
  const service = createServiceClient();
  if (!(await isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.organizationSso))) {
    return NextResponse.redirect(new URL('/login?error=sso_disabled', url.origin));
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value, options }) => redirect.cookies.set(name, value, options));
        },
      },
    }
  );
  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error || !exchanged.data.user) {
    return NextResponse.redirect(new URL('/login?error=sso_auth_failed', url.origin));
  }
  const providerId = ssoProviderId(exchanged.data.user);
  if (testToken) {
    const tokenHash = createHash('sha256').update(testToken).digest('hex');
    const test = await service
      .from('organization_sso_test_sessions')
      .select('id,workspace_id,integration_id,initiated_by,expected_provider_id,expected_domain,expires_at,consumed_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    const valid = Boolean(
      test.data &&
        !test.data.consumed_at &&
        new Date(test.data.expires_at).getTime() > Date.now() &&
        providerId &&
        providerId === test.data.expected_provider_id
    );
    if (!test.data || !valid) {
      if (test.data) {
        await service
          .from('organization_sso_test_sessions')
          .update({ consumed_at: new Date().toISOString(), result: 'failed' })
          .eq('id', test.data.id)
          .is('consumed_at', null);
      }
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login?error=sso_test_failed', url.origin));
    }
    const membership = await service
      .from('workspace_members')
      .select('id,status')
      .eq('workspace_id', test.data.workspace_id)
      .eq('user_id', exchanged.data.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!membership.data) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login?error=sso_membership_required', url.origin));
    }
    const integration = await service
      .from('organization_integrations')
      .select('configuration')
      .eq('id', test.data.integration_id)
      .eq('workspace_id', test.data.workspace_id)
      .single();
    const configuration = (integration.data?.configuration || {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    await service
      .from('organization_integrations')
      .update({
        status: 'connected',
        last_health_check_at: now,
        last_error_code: null,
        configuration: { ...configuration, test_status: 'succeeded', tested_at: now },
      })
      .eq('id', test.data.integration_id)
      .eq('workspace_id', test.data.workspace_id);
    await service
      .from('organization_sso_test_sessions')
      .update({ consumed_at: now, result: 'succeeded' })
      .eq('id', test.data.id)
      .is('consumed_at', null);
    await service.from('organization_audit_events').insert({
      workspace_id: test.data.workspace_id,
      actor_user_id: exchanged.data.user.id,
      event_type: 'security.sso.test_succeeded',
      resource_type: 'organization_integration',
      resource_id: test.data.integration_id,
      summary: 'Prueba de inicio de sesion SSO completada.',
      severity: 'high',
      module: 'security',
    });
    return NextResponse.redirect(
      new URL('/organizacion?section=seguridad&tab=sso&sso_test=success', url.origin)
    );
  }

  const integrations = await service
    .from('organization_integrations')
    .select('id,workspace_id,configuration')
    .eq('integration_type', 'sso')
    .eq('status', 'connected');
  const matched = (integrations.data || []).find(
    (item) => String((item.configuration as Record<string, unknown>)?.provider_id || '') === providerId
  );
  if (!matched) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=sso_provider_not_allowed', url.origin));
  }
  const membership = await service
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', matched.workspace_id)
    .eq('user_id', exchanged.data.user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership.data) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=sso_membership_required', url.origin));
  }
  return redirect;
}
