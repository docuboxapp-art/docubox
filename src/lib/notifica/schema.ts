export type NotificationStatus =
  | 'draft'
  | 'published'
  | 'available'
  | 'notice_sent'
  | 'delivered'
  | 'authenticated'
  | 'accessed'
  | 'acknowledged'
  | 'in_progress'
  | 'responded'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'expired'
  | 'cancelled';

export type EvidenceLevel = 'E0' | 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6';

export interface CertifiedNotificationSummary {
  id: string;
  folio: string;
  subject: string;
  documentName: string;
  recipientName: string;
  recipientEmail: string;
  category: string;
  status: NotificationStatus;
  evidenceLevel: EvidenceLevel;
  dueAt?: string;
  updatedAt: string;
  lastEvent: string;
}

export const NOTIFICATION_STATUS_META: Record<NotificationStatus, { label: string; tone: 'gray' | 'blue' | 'amber' | 'green' | 'red' }> = {
  draft: { label: 'Borrador', tone: 'gray' },
  published: { label: 'Publicada', tone: 'blue' },
  available: { label: 'Disponible', tone: 'blue' },
  notice_sent: { label: 'Aviso enviado', tone: 'blue' },
  delivered: { label: 'Aviso entregado', tone: 'green' },
  authenticated: { label: 'Identidad validada', tone: 'green' },
  accessed: { label: 'Consultada', tone: 'green' },
  acknowledged: { label: 'Acuse emitido', tone: 'green' },
  in_progress: { label: 'En progreso', tone: 'amber' },
  responded: { label: 'Respondida', tone: 'green' },
  accepted: { label: 'Aceptada', tone: 'green' },
  rejected: { label: 'Rechazada', tone: 'red' },
  completed: { label: 'Completada', tone: 'green' },
  expired: { label: 'Vencida', tone: 'red' },
  cancelled: { label: 'Cancelada', tone: 'gray' },
};

export const EVIDENCE_META: Record<EvidenceLevel, { label: string; description: string }> = {
  E0: { label: 'Documento fijado', description: 'La version canonica y su hash quedaron registrados.' },
  E1: { label: 'Notificacion creada', description: 'La configuracion y el destinatario quedaron vinculados.' },
  E2: { label: 'Puesta a disposicion', description: 'Existe un acceso seguro y verificable al documento.' },
  E3: { label: 'Aviso emitido', description: 'Se registro el intento de aviso por un canal configurado.' },
  E4: { label: 'Acceso acreditado', description: 'El destinatario se autentico y consulto el documento.' },
  E5: { label: 'Acuse generado', description: 'Se emitio evidencia de recepcion o conocimiento.' },
  E6: { label: 'Actuacion concluida', description: 'Existe respuesta, aceptacion, rechazo o cumplimiento.' },
};

export const NOTIFICATION_CATEGORIES = [
  'Cobranza',
  'Requerimiento de pago',
  'Aviso de adeudo',
  'Ultimo requerimiento',
  'Convenio',
  'Aviso de incumplimiento',
  'Requerimiento de subsanacion',
  'Terminacion',
  'No renovacion',
  'Comunicacion contractual',
  'Requerimiento extrajudicial',
  'Comunicacion corporativa',
];

export const DEMO_NOTIFICATIONS: CertifiedNotificationSummary[] = [
  {
    id: 'demo-cobranza',
    folio: 'NTF-2026-000184',
    subject: 'Requerimiento de pago de factura vencida',
    documentName: 'Requerimiento_pago_agosto.pdf',
    recipientName: 'Comercializadora del Norte, S.A. de C.V.',
    recipientEmail: 'legal@comercializadoranorte.mx',
    category: 'Requerimiento de pago',
    status: 'acknowledged',
    evidenceLevel: 'E5',
    dueAt: '2026-08-14T23:59:00.000Z',
    updatedAt: '2026-08-08T15:42:00.000Z',
    lastEvent: 'Acuse de recepcion generado',
  },
  {
    id: 'demo-contrato',
    folio: 'NTF-2026-000183',
    subject: 'Aviso de no renovacion contractual',
    documentName: 'Aviso_no_renovacion.pdf',
    recipientName: 'Servicios Integrales MZ',
    recipientEmail: 'administracion@serviciosmz.mx',
    category: 'No renovacion',
    status: 'delivered',
    evidenceLevel: 'E3',
    dueAt: '2026-08-12T23:59:00.000Z',
    updatedAt: '2026-08-08T13:18:00.000Z',
    lastEvent: 'Aviso entregado por correo',
  },
  {
    id: 'demo-borrador',
    folio: 'NTF-2026-000182',
    subject: 'Comunicacion corporativa',
    documentName: 'Circular_proveedores.pdf',
    recipientName: 'Distribuciones Rivera',
    recipientEmail: 'contacto@rivera.mx',
    category: 'Comunicacion corporativa',
    status: 'draft',
    evidenceLevel: 'E1',
    updatedAt: '2026-08-07T20:30:00.000Z',
    lastEvent: 'Borrador actualizado',
  },
];

export function mapNotificationRow(row: any): CertifiedNotificationSummary {
  const recipient = Array.isArray(row.notification_recipients)
    ? row.notification_recipients[0]
    : row.notification_recipients;
  return {
    id: row.id,
    folio: row.folio,
    subject: row.subject,
    documentName: row.document_snapshot?.name || row.document_name || 'Documento',
    recipientName: recipient?.name || row.recipient_name || 'Sin destinatario',
    recipientEmail: recipient?.email || row.recipient_email || '',
    category: row.category,
    status: row.status,
    evidenceLevel: row.evidence_level,
    dueAt: row.due_at || undefined,
    updatedAt: row.updated_at,
    lastEvent: row.last_event_label || 'Notificacion actualizada',
  };
}
