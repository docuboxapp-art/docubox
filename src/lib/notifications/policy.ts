export const NOTIFICATION_CATEGORIES = [
  'DOCUMENT',
  'SIGNATURE',
  'WORKFLOW',
  'APPROVAL',
  'SECURITY',
  'ORGANIZATION',
  'BILLING',
  'CERTIFICATION',
  'RETENTION',
  'SYSTEM',
  'ACCOUNT',
  'REMINDER',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';
export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'whatsapp' | 'push' | 'webhook';
export type NotificationLegacyType = 'document' | 'task' | 'request' | 'alert' | 'info';
export type NotificationLegacyPriority = 'alta' | 'media' | 'baja';

export const NOTIFICATION_TYPE_DEFINITIONS: Record<
  NotificationLegacyType,
  { label: string; description: string }
> = {
  document: {
    label: 'Documento',
    description: 'Cambios o eventos relacionados directamente con un documento.',
  },
  task: {
    label: 'Tarea',
    description: 'Una acción concreta asignada al usuario.',
  },
  request: {
    label: 'Solicitud',
    description: 'Una petición de firma, aprobación, revisión, acceso o información.',
  },
  alert: {
    label: 'Alerta',
    description: 'Un riesgo, vencimiento, error o situación que requiere atención.',
  },
  info: {
    label: 'Información',
    description: 'Un hecho relevante que normalmente no requiere una acción inmediata.',
  },
};

type NotificationEventPolicy = {
  legacyType: NotificationLegacyType;
  legacyPriority: NotificationLegacyPriority;
  category: NotificationCategory;
  severity: NotificationSeverity;
  channels: NotificationChannel[];
};

// Event rules are intentionally compact: the emitting service remains the source
// of the human-readable message while this table keeps delivery semantics uniform.
export const NOTIFICATION_EVENT_POLICIES: Record<string, NotificationEventPolicy> = {
  'signature.requested': {
    legacyType: 'request',
    legacyPriority: 'media',
    category: 'SIGNATURE',
    severity: 'info',
    channels: ['in_app', 'email'],
  },
  'document.priority.changed': {
    legacyType: 'document',
    legacyPriority: 'alta',
    category: 'DOCUMENT',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'document.legal_hold.applied': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'RETENTION',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'document.legal_hold.released': {
    legacyType: 'document',
    legacyPriority: 'media',
    category: 'RETENTION',
    severity: 'info',
    channels: ['in_app'],
  },
  'document.purge.blocked': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'RETENTION',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'security.suspicious_login': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'SECURITY',
    severity: 'critical',
    channels: ['in_app', 'email'],
  },
  'security.mfa.disabled': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'SECURITY',
    severity: 'critical',
    channels: ['in_app', 'email'],
  },
  'billing.payment_failed': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'BILLING',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'document.completed': {
    legacyType: 'info',
    legacyPriority: 'baja',
    category: 'DOCUMENT',
    severity: 'success',
    channels: ['in_app'],
  },
  'document.expiring': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'DOCUMENT',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'document.expired': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'DOCUMENT',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'document.rejected': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'SIGNATURE',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'workflow.cancelled': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'WORKFLOW',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'document.participation.completed': {
    legacyType: 'document',
    legacyPriority: 'media',
    category: 'SIGNATURE',
    severity: 'success',
    channels: ['in_app', 'email'],
  },
  'workflow.step_available': {
    legacyType: 'request',
    legacyPriority: 'alta',
    category: 'WORKFLOW',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'task.assigned': {
    legacyType: 'task',
    legacyPriority: 'media',
    category: 'WORKFLOW',
    severity: 'info',
    channels: ['in_app', 'email'],
  },
  'task.reassigned': {
    legacyType: 'task',
    legacyPriority: 'media',
    category: 'WORKFLOW',
    severity: 'info',
    channels: ['in_app', 'email'],
  },
  'task.blocked': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'WORKFLOW',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'task.unblocked': {
    legacyType: 'task',
    legacyPriority: 'media',
    category: 'WORKFLOW',
    severity: 'info',
    channels: ['in_app'],
  },
  'task.completed': {
    legacyType: 'info',
    legacyPriority: 'baja',
    category: 'WORKFLOW',
    severity: 'success',
    channels: ['in_app'],
  },
  'task.cancelled': {
    legacyType: 'alert',
    legacyPriority: 'media',
    category: 'WORKFLOW',
    severity: 'warning',
    channels: ['in_app'],
  },
  'security.new_device': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'SECURITY',
    severity: 'critical',
    channels: ['in_app', 'email'],
  },
  'organization.invitation.created': {
    legacyType: 'request',
    legacyPriority: 'media',
    category: 'ORGANIZATION',
    severity: 'info',
    channels: ['in_app', 'email'],
  },
  'organization.invitation.resent': {
    legacyType: 'request',
    legacyPriority: 'media',
    category: 'ORGANIZATION',
    severity: 'info',
    channels: ['in_app', 'email'],
  },
  'organization.invitation.revoked': {
    legacyType: 'alert',
    legacyPriority: 'alta',
    category: 'ORGANIZATION',
    severity: 'warning',
    channels: ['in_app', 'email'],
  },
  'organization.invitation.accepted': {
    legacyType: 'info',
    legacyPriority: 'baja',
    category: 'ORGANIZATION',
    severity: 'success',
    channels: ['in_app'],
  },
};

export function notificationEventPolicy(type: string | undefined) {
  return type ? NOTIFICATION_EVENT_POLICIES[type] : undefined;
}

export const SECURITY_CATEGORIES = new Set<NotificationCategory>(['SECURITY', 'ACCOUNT']);

export function isMandatoryNotification(
  category: NotificationCategory,
  severity: NotificationSeverity
) {
  return SECURITY_CATEGORIES.has(category) && severity === 'critical';
}

export function categoryForLegacyType(type: string | undefined): NotificationCategory {
  switch (type) {
    case 'document':
      return 'DOCUMENT';
    case 'task':
      return 'WORKFLOW';
    case 'request':
      return 'APPROVAL';
    case 'alert':
      return 'SYSTEM';
    default:
      return 'SYSTEM';
  }
}

export function severityForLegacyPriority(priority: string | undefined): NotificationSeverity {
  if (priority === 'alta') return 'warning';
  if (priority === 'baja') return 'success';
  return 'info';
}

export function sanitizeNotificationMetadata(value: unknown): Record<string, unknown> {
  const prohibited =
    /(?:password|passphrase|secret|token|private[_-]?key|api[_-]?key|credential|dek|kek|otp|authorization|bearer)/i;

  const visit = (input: unknown, depth: number): unknown => {
    if (depth > 4 || input === null || input === undefined) return null;
    if (typeof input === 'string') return input.slice(0, 512);
    if (typeof input === 'number' || typeof input === 'boolean') return input;
    if (Array.isArray(input)) return input.slice(0, 20).map((item) => visit(item, depth + 1));
    if (typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([key]) => !prohibited.test(key))
          .slice(0, 30)
          .map(([key, item]) => [key.slice(0, 80), visit(item, depth + 1)])
      );
    }
    return String(input).slice(0, 512);
  };

  const sanitized = visit(value, 0);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}
