import type { SupabaseClient } from '@supabase/supabase-js';
import { wrapDocuboxEmail } from '@/lib/emailFooter';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  );
export const ORGANIZATION_COMMUNICATION_VARIABLES = [
  'organization_name',
  'recipient_name',
  'inviter_name',
  'action_url',
  'expires_at',
  'message',
] as const;

export async function renderOrganizationCommunication(
  service: SupabaseClient,
  input: {
    workspaceId: string;
    templateKey: string;
    variables: Record<string, string>;
    fallbackSubject: string;
    fallbackContentHtml: string;
    context: string;
  }
) {
  const [workspace, template, domain] = await Promise.all([
    service
      .from('workspaces')
      .select('name,branding_settings')
      .eq('id', input.workspaceId)
      .maybeSingle(),
    service
      .from('organization_communication_templates')
      .select('subject,body_text,legal_version')
      .eq('workspace_id', input.workspaceId)
      .eq('template_key', input.templateKey)
      .eq('status', 'active')
      .maybeSingle(),
    service
      .from('organization_sender_domains')
      .select('sender_name,sender_email,reply_to')
      .eq('workspace_id', input.workspaceId)
      .eq('dns_status', 'verified')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const replace = (text: string) =>
    text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) => input.variables[key] || '');
  const subject =
    template.error || !template.data
      ? input.fallbackSubject
      : replace(template.data.subject)
          .replace(/[\r\n]/g, ' ')
          .slice(0, 240);
  let content = input.fallbackContentHtml;
  if (!template.error && template.data) {
    const action = input.variables.action_url || '';
    const url = /^https?:\/\//.test(action) ? action : '';
    content = `<div style="font-size:15px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(replace(template.data.body_text))}</div>${url ? `<p style="margin:24px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#1E6BFF;color:#fff;border-radius:7px;text-decoration:none;font-weight:600;">Revisar invitación</a></p>` : ''}`;
  }
  const settings = (workspace.data?.branding_settings || {}) as Record<string, unknown>;
  const html = wrapDocuboxEmail(content, input.context, {
    name: workspace.data?.name,
    logoUrl: typeof settings.logo_light_url === 'string' ? settings.logo_light_url : undefined,
    primaryColor: typeof settings.primary_color === 'string' ? settings.primary_color : undefined,
    cobranding: settings.cobranding !== false,
  });
  const sender = domain.error ? null : domain.data;
  return {
    html,
    subject,
    from: sender?.sender_email
      ? `${String(sender.sender_name || workspace.data?.name || 'Docubox').replace(/[<>\r\n]/g, '')} <${sender.sender_email}>`
      : undefined,
    replyTo: sender?.reply_to || undefined,
    templateVersion: template.data?.legal_version || null,
  };
}
