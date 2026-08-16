import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authorizeOrganizationRequest, OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';

export const runtime = 'nodejs';

const nullableHttpsUrl = z.union([z.literal(''), z.string().url().refine((value) => new URL(value).protocol === 'https:', 'La URL debe usar HTTPS.')]).optional();
const brandingSchema = z.object({
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logo_light_url: nullableHttpsUrl,
  logo_dark_url: nullableHttpsUrl,
  isotype_url: nullableHttpsUrl,
  sender_display_name: z.string().trim().max(120).optional(),
  support_email: z.union([z.literal(''), z.string().trim().email()]).optional(),
  welcome_text: z.string().trim().max(1000).optional(),
  cobranding: z.boolean().optional(),
}).strict();
const templateSchema = z.object({
  template_key: z.string().trim().toLowerCase().min(2).max(100).regex(/^[a-z0-9._-]+$/),
  name: z.string().trim().min(2).max(160),
  subject: z.string().trim().min(2).max(240),
  body_text: z.string().trim().min(2).max(20000),
});
const domainSchema = z.object({
  domain: z.string().trim().toLowerCase().min(3).max(253).regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  sender_name: z.string().trim().max(120).nullable().optional(),
  sender_email: z.union([z.literal(''), z.string().trim().toLowerCase().email()]).nullable().optional(),
  reply_to: z.union([z.literal(''), z.string().trim().toLowerCase().email()]).nullable().optional(),
}).superRefine((value, context) => {
  if (value.sender_email && value.sender_email.split('@')[1] !== value.domain) {
    context.addIssue({ code: 'custom', path: ['sender_email'], message: 'El correo remitente debe pertenecer al dominio registrado.' });
  }
});

function nullable(value?: string | null) {
  return value?.trim() || null;
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = z.string().uuid().parse(body.workspace_id);
    const action = String(body.action || '');
    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, 'branding.manage');
    let resourceType = 'workspace';
    let resourceId: string | null = workspaceId;
    let eventType = '';
    let summary = '';

    if (action === 'save_settings') {
      const settings = brandingSchema.parse(body.settings || {});
      const updated = await service.from('workspaces').update({ branding_settings: settings, updated_at: new Date().toISOString() }).eq('id', workspaceId).select('id').single();
      if (updated.error) throw updated.error;
      eventType = 'organization.branding_settings.updated'; summary = 'Identidad visual organizacional actualizada';
    } else if (action === 'create_template') {
      const template = templateSchema.parse(body.template || {});
      const inserted = await service.from('organization_communication_templates').insert({ workspace_id: workspaceId, ...template, variables: ['organization_name', 'recipient_name', 'action_url'], status: 'draft', created_by: user.id, updated_by: user.id }).select('id').single();
      if (inserted.error) throw inserted.error;
      resourceType = 'organization_communication_template'; resourceId = inserted.data.id;
      eventType = 'branding.communication_template.created'; summary = 'Plantilla de comunicación creada';
    } else if (action === 'create_domain') {
      const domain = domainSchema.parse(body.domain || {});
      const inserted = await service.from('organization_sender_domains').insert({ workspace_id: workspaceId, domain: domain.domain, sender_name: nullable(domain.sender_name), sender_email: nullable(domain.sender_email), reply_to: nullable(domain.reply_to), dns_status: 'pending', created_by: user.id }).select('id').single();
      if (inserted.error) throw inserted.error;
      resourceType = 'organization_sender_domain'; resourceId = inserted.data.id;
      eventType = 'branding.sender_domain.created'; summary = 'Dominio remitente registrado para verificación DNS';
    } else {
      throw new OrganizationApiError(400, 'unsupported_branding_action', 'La operación solicitada no está disponible.');
    }

    const audit = await service.from('organization_audit_events').insert({ workspace_id: workspaceId, actor_user_id: user.id, event_type: eventType, resource_type: resourceType, resource_id: resourceId, summary, payload: {}, outcome: 'success', severity: 'info', module: 'branding', origin: 'api', correlation_id: requestId, ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null, user_agent: request.headers.get('user-agent') });
    if (audit.error) throw audit.error;
    return Response.json({ success: true, id: resourceId });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
