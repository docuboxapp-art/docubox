import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
  requireOrganizationReauthentication,
} from '@/lib/organization/server';

export const runtime = 'nodejs';

const workspaceIdSchema = z.string().uuid();
const securitySettingsSchema = z.object({
  require_mfa: z.boolean().optional(),
  critical_reauthentication: z.boolean().optional(),
  limit_concurrent_sessions: z.boolean().optional(),
  session_max_hours: z.number().int().min(1).max(168).optional(),
  max_concurrent_sessions: z.number().int().min(1).max(20).optional(),
  allowed_methods: z.array(z.enum(['totp', 'webauthn', 'otp_email'])).min(1).max(3).optional(),
  sso_enforced: z.boolean().optional(),
  emergency_access: z.boolean().optional(),
}).strict();
const networkSchema = z.object({
  name: z.string().trim().min(2).max(120),
  network_cidr: z.string().trim().min(3).max(64).regex(/^[0-9a-fA-F:.]+\/[0-9]{1,3}$/),
  mode: z.enum(['allow', 'block']).default('allow'),
});
const alertSchema = z.object({
  event_key: z.string().trim().min(2).max(120).regex(/^[a-z0-9._-]+$/),
  display_name: z.string().trim().min(2).max(160),
  severity: z.enum(['info', 'warning', 'high', 'critical']).default('warning'),
  channels: z.array(z.enum(['in_app', 'email'])).min(1).max(2).default(['in_app']),
  recipients: z.array(z.string().trim().email()).max(50).default([]),
});
const certificateSchema = z.object({
  alias: z.string().trim().min(2).max(120),
  certificate_type: z.string().trim().min(2).max(80).default('institutional'),
  subject_name: z.string().trim().min(2).max(300),
  rfc: z.string().trim().toUpperCase().regex(/^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$/).nullable().optional(),
  serial_number: z.string().trim().max(180).nullable().optional(),
  fingerprint_sha256: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  custody_type: z.enum(['metadata_only', 'local_temporary', 'kms', 'hsm', 'external']).default('metadata_only'),
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
  provider_name: z.string().trim().max(160).nullable().optional(),
  key_reference: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, context) => {
  const reference = value.key_reference || '';
  if (/BEGIN (RSA |EC )?PRIVATE KEY|PRIVATE KEY|\r|\n/i.test(reference)) {
    context.addIssue({ code: 'custom', path: ['key_reference'], message: 'Sólo se permite una referencia opaca; nunca material de llave privada.' });
  }
  if (value.valid_from && value.valid_until && value.valid_from > value.valid_until) {
    context.addIssue({ code: 'custom', path: ['valid_until'], message: 'La vigencia final debe ser posterior a la inicial.' });
  }
  if (value.environment === 'production' && value.custody_type === 'local_temporary') {
    context.addIssue({ code: 'custom', path: ['custody_type'], message: 'La custodia temporal local no es válida para producción.' });
  }
});

function nullable(value?: string | null) {
  return value?.trim() || null;
}

async function writeAudit(service: any, values: Record<string, unknown>) {
  const result = await service.from('organization_audit_events').insert(values);
  if (result.error) throw result.error;
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = workspaceIdSchema.parse(body.workspace_id);
    const action = String(body.action || '');
    const permission = action === 'create_certificate' ? 'certificates.manage' : 'security.manage';
    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, permission);
    await requireOrganizationReauthentication(request, workspaceId, user.id, permission);

    let resourceType = 'workspace';
    let resourceId: string | null = workspaceId;
    let eventType = '';
    let summary = '';
    let payload: Record<string, unknown> = {};

    if (action === 'save_security_settings') {
      const settings = securitySettingsSchema.parse(body.settings || {});
      if (settings.sso_enforced) {
        const provider = await service.from('organization_integrations')
          .select('id')
          .eq('workspace_id', workspaceId)
          .in('integration_type', ['sso', 'scim'])
          .eq('status', 'connected')
          .limit(1)
          .maybeSingle();
        if (provider.error) throw provider.error;
        if (!provider.data || settings.emergency_access !== true) {
          throw new OrganizationApiError(409, 'sso_lockout_risk', 'Conecta un proveedor SSO operativo y habilita el acceso de emergencia antes de exigir SSO.');
        }
      }
      const updated = await service.from('workspaces').update({ security_settings: settings, updated_at: new Date().toISOString() }).eq('id', workspaceId).select('id').single();
      if (updated.error) throw updated.error;
      eventType = 'organization.security_settings.updated';
      summary = 'Configuración de seguridad organizacional actualizada';
      payload = { changed_keys: Object.keys(settings) };
    } else if (action === 'save_network') {
      const network = networkSchema.parse(body.network || {});
      const inserted = await service.from('organization_trusted_networks').insert({ workspace_id: workspaceId, ...network, created_by: user.id }).select('id').single();
      if (inserted.error) throw inserted.error;
      resourceType = 'organization_trusted_network'; resourceId = inserted.data.id;
      eventType = 'security.network.created'; summary = 'Red de confianza registrada'; payload = { mode: network.mode };
    } else if (action === 'save_alert') {
      const rule = alertSchema.parse(body.rule || {});
      const saved = await service.from('organization_security_alert_rules').upsert({ workspace_id: workspaceId, ...rule, enabled: true, created_by: user.id }, { onConflict: 'workspace_id,event_key' }).select('id').single();
      if (saved.error) throw saved.error;
      resourceType = 'organization_security_alert_rule'; resourceId = saved.data.id;
      eventType = 'security.alert_rule.saved'; summary = 'Regla de alerta actualizada'; payload = { event_key: rule.event_key, severity: rule.severity };
    } else if (action === 'revoke_session') {
      const sessionId = z.string().uuid().parse(body.session_id);
      const session = await service.from('user_sessions').select('id,user_id').eq('id', sessionId).maybeSingle();
      if (session.error) throw session.error;
      if (!session.data) throw new OrganizationApiError(404, 'organization_session_not_found', 'La sesión ya no existe.');
      const member = await service.from('workspace_members').select('id').eq('workspace_id', workspaceId).eq('user_id', session.data.user_id).eq('status', 'active').maybeSingle();
      if (member.error) throw member.error;
      if (!member.data) throw new OrganizationApiError(404, 'organization_session_not_found', 'La sesión no pertenece a esta organización.');
      const revoked = await service.from('user_sessions').update({ expires_at: new Date().toISOString(), is_current: false, session_token: `revoked:${sessionId}:${Date.now()}` }).eq('id', sessionId);
      if (revoked.error) throw revoked.error;
      const evidence = await service.from('organization_session_revocations').insert({ workspace_id: workspaceId, member_id: member.data.id, session_id: sessionId, scope: 'single', reason: 'Revocación administrativa', revoked_by: user.id });
      if (evidence.error) throw evidence.error;
      resourceType = 'user_session'; resourceId = sessionId;
      eventType = 'security.session.revoked'; summary = 'Sesión organizacional revocada';
    } else if (action === 'create_certificate') {
      const certificate = certificateSchema.parse(body.certificate || {});
      const inserted = await service.from('organization_certificates').insert({
        workspace_id: workspaceId,
        alias: certificate.alias,
        certificate_type: certificate.certificate_type,
        subject_name: certificate.subject_name,
        rfc: nullable(certificate.rfc),
        serial_number: nullable(certificate.serial_number),
        fingerprint_sha256: nullable(certificate.fingerprint_sha256),
        valid_from: certificate.valid_from || null,
        valid_until: certificate.valid_until || null,
        custody_type: certificate.custody_type,
        environment: certificate.environment,
        provider_name: nullable(certificate.provider_name),
        key_reference: nullable(certificate.key_reference),
        status: 'pending',
        created_by: user.id,
      }).select('id').single();
      if (inserted.error) throw inserted.error;
      resourceType = 'organization_certificate'; resourceId = inserted.data.id;
      eventType = 'certificate.metadata.created'; summary = 'Metadatos públicos de certificado registrados';
      payload = { custody_type: certificate.custody_type, environment: certificate.environment };
    } else {
      throw new OrganizationApiError(400, 'unsupported_security_action', 'La operación solicitada no está disponible.');
    }

    await writeAudit(service, {
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: resourceId,
      summary,
      payload,
      outcome: 'success',
      severity: 'high',
      module: action === 'create_certificate' ? 'certificates' : 'security',
      origin: 'api',
      correlation_id: requestId,
      ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: request.headers.get('user-agent'),
    });

    return Response.json({ success: true, id: resourceId });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
