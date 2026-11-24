export type NotificationPresentationInput = {
  type?: string | null;
  category?: string | null;
  event_type?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  action_url?: string | null;
  metadata?: Record<string, unknown> | null;
};

export const NOTIFICATION_AREAS = [
  { value: 'documentos', label: 'Documentos' },
  { value: 'solicitudes', label: 'Solicitudes y participaciones' },
  { value: 'formularios', label: 'Formularios' },
  { value: 'expedientes', label: 'Expedientes' },
  { value: 'contactos', label: 'Contactos' },
  { value: 'organizacion', label: 'Organización' },
  { value: 'seguridad', label: 'Seguridad' },
  { value: 'sistema', label: 'Sistema' },
] as const;

export type NotificationArea = (typeof NOTIFICATION_AREAS)[number]['value'];

/** A retired task event has no destination in the current product. */
export function isRetiredNotification(notification: NotificationPresentationInput): boolean {
  return notification.event_type?.startsWith('task.') === true ||
    notification.action_url?.startsWith('/mis-tareas') === true ||
    (notification.type === 'task' &&
      notification.entity_type !== 'document' &&
      !notification.metadata?.documentoId &&
      !notification.metadata?.documentId &&
      !notification.metadata?.document_id);
}

export function notificationArea(notification: NotificationPresentationInput): NotificationArea {
  const event = notification.event_type ?? '';
  const entity = notification.entity_type ?? '';
  const category = notification.category ?? '';
  if (event.startsWith('form.') || entity === 'form' || entity === 'form_response') return 'formularios';
  if (event.startsWith('case_file.') || entity === 'case_file') return 'expedientes';
  if (event.startsWith('contact.') || entity === 'contact') return 'contactos';
  if (category === 'SECURITY' || category === 'ACCOUNT' || event.startsWith('security.')) return 'seguridad';
  if (category === 'ORGANIZATION' || event.startsWith('organization.')) return 'organizacion';
  if (category === 'SIGNATURE' || category === 'WORKFLOW' || category === 'APPROVAL' ||
      event.startsWith('signature.') || event.startsWith('workflow.') || notification.type === 'request' ||
      notification.type === 'task') return 'solicitudes';
  if (category === 'DOCUMENT' || category === 'RETENTION' || category === 'CERTIFICATION' ||
      event.startsWith('document.') || notification.type === 'document') return 'documentos';
  return 'sistema';
}

export function notificationAreaLabel(notification: NotificationPresentationInput): string {
  const area = notificationArea(notification);
  return NOTIFICATION_AREAS.find((item) => item.value === area)?.label ?? 'Sistema';
}

export function notificationDestination(notification: NotificationPresentationInput): string {
  const url = notification.action_url;
  if (url?.startsWith('/') && !url.startsWith('//') && !url.startsWith('/mis-tareas')) return url;
  const documentId = [
    notification.entity_type === 'document' ? notification.entity_id : null,
    notification.metadata?.documentoId,
    notification.metadata?.documentId,
    notification.metadata?.document_id,
  ]
    .find((value): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value));
  if (documentId) return `/visor-documento/${documentId}`;
  switch (notificationArea(notification)) {
    case 'documentos': return '/mi-espacio';
    case 'solicitudes': return '/mis-participaciones';
    case 'formularios': return '/formularios';
    case 'expedientes': return '/expedientes';
    case 'contactos': return '/contactos';
    case 'organizacion': return '/organizacion';
    case 'seguridad': return '/mi-perfil';
    default: return '/inicio';
  }
}
