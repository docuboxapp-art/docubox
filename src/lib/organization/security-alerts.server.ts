import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emitDomainEvent } from '@/lib/notifications/service';

export type OrganizationSecurityEvent =
  | 'auth.anomaly'
  | 'auth.multiple_failures'
  | 'privilege.escalation'
  | 'download.bulk'
  | 'certificate.changed';

const descriptions: Record<OrganizationSecurityEvent, string> = {
  'auth.anomaly': 'Se detectó un acceso desde un dispositivo o una ubicación inusual.',
  'auth.multiple_failures': 'Se alcanzó el límite de intentos de verificación de acceso.',
  'privilege.escalation': 'Un administrador actualizó los roles y permisos de un miembro.',
  'download.bulk': 'Se generó una exportación de auditoría con al menos 100 registros.',
  'certificate.changed': 'Se modificó un certificado o sus permisos de uso.',
};

// Dispatch through the existing notification outbox. Never turn a committed
// administration change into an apparent failure if a notification is unavailable.
export async function notifyOrganizationSecurityEvent(
  service: SupabaseClient,
  input: {
    event: OrganizationSecurityEvent;
    eventId: string;
    workspaceId?: string;
    affectedUserId?: string;
    actorUserId?: string;
  }
) {
  try {
    let workspaceIds: string[];
    if (input.workspaceId) workspaceIds = [input.workspaceId];
    else if (input.affectedUserId) {
      const membership = await service
        .from('workspace_members')
        .select('workspace_id,access_expires_at,workspaces!inner(workspace_type)')
        .eq('user_id', input.affectedUserId)
        .eq('status', 'active')
        .eq('workspaces.workspace_type', 'business');
      if (membership.error) throw membership.error;
      workspaceIds = (membership.data || [])
        .filter((row) => !row.access_expires_at || Date.parse(row.access_expires_at) > Date.now())
        .map((row) => row.workspace_id);
    } else return;

    for (const workspaceId of [...new Set(workspaceIds)]) {
      const rules = await service
        .from('organization_security_alert_rules')
        .select('id,display_name,severity,channels,recipients')
        .eq('workspace_id', workspaceId)
        .eq('event_key', input.event)
        .eq('enabled', true);
      if (rules.error) throw rules.error;
      if (!rules.data?.length) continue;
      const members = await service
        .from('workspace_members')
        .select(
          'user_id,role,access_expires_at,user_profiles!workspace_members_user_id_fkey(email)'
        )
        .eq('workspace_id', workspaceId)
        .eq('status', 'active');
      if (members.error) throw members.error;
      const active = (members.data || []).filter(
        (row) =>
          row.user_id && (!row.access_expires_at || Date.parse(row.access_expires_at) > Date.now())
      );
      const administrators = active.filter((row) => ['owner', 'admin'].includes(row.role));
      for (const rule of rules.data) {
        const addresses: string[] = Array.isArray(rule.recipients) ? rule.recipients : [];
        const recipients = addresses.length
          ? addresses.map((email) => {
              const member = active.find((row) => {
                const profile = Array.isArray(row.user_profiles)
                  ? row.user_profiles[0]
                  : row.user_profiles;
                return profile?.email?.toLowerCase() === email.toLowerCase();
              });
              // Explicitly configured external destinations receive email only;
              // the organization owner retains the corresponding audit notice.
              return {
                userId: member?.user_id || administrators[0]?.user_id,
                email,
                external: !member,
              };
            })
          : administrators.map((row) => ({
              userId: row.user_id,
              external: false,
              email: undefined,
            }));
        for (const recipient of recipients) {
          if (!recipient.userId) continue;
          const channels = (Array.isArray(rule.channels) ? rule.channels : ['in_app'])
            .filter((value): value is 'in_app' | 'email' => value === 'in_app' || value === 'email')
            .filter((value) => !recipient.external || value === 'email');
          if (!channels.length) continue;
          const destination = createHash('sha256')
            .update(recipient.email?.toLowerCase() || recipient.userId)
            .digest('hex');
          await emitDomainEvent({
            type: `organization.security.${input.event}`,
            title: rule.display_name,
            description: descriptions[input.event],
            category: 'SECURITY',
            severity: rule.severity === 'high' ? 'warning' : rule.severity,
            workspaceId,
            actorUserId: input.actorUserId,
            recipients: [{ userId: recipient.userId, email: recipient.email }],
            channels,
            actionUrl: '/organizacion/seguridad',
            actionLabel: 'Revisar seguridad',
            deduplicationKey: `organization.security:${workspaceId}:${rule.id}:${input.eventId}:${destination}`,
            metadata: { event: input.event, rule_id: rule.id },
          });
        }
      }
    }
  } catch {
    // Do not include provider errors, email addresses or security evidence in logs.
    console.error('[organization-security] notification_dispatch_failed');
  }
}
