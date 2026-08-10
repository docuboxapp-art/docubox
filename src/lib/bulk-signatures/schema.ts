export type BulkCampaignStatus =
  | 'draft'
  | 'validating'
  | 'ready'
  | 'scheduled'
  | 'processing'
  | 'active'
  | 'partially_completed'
  | 'completed'
  | 'completed_with_exceptions'
  | 'paused'
  | 'expired'
  | 'cancelled'
  | 'closed';

export type BulkCampaignType =
  'multiple_documents' | 'template' | 'shared_document' | 'document_package';

export interface BulkCampaignSummary {
  id: string;
  name: string;
  description: string;
  campaignType: BulkCampaignType;
  ownerName: string;
  status: BulkCampaignStatus;
  totalItems: number;
  completedItems: number;
  pendingItems: number;
  failedItems: number;
  participantCount: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BulkCampaignDraft {
  name: string;
  description: string;
  ownerName: string;
  campaignType: BulkCampaignType;
  priority: 'normal' | 'high' | 'urgent';
  internalReference: string;
  expiresAt: string;
  timezone: string;
  sourceName: string;
  recipientCount: number;
  signatureMethod: 'autograph_otp' | 'efirma' | 'click_sign' | 'biometric';
  workflowType: 'parallel' | 'sequential';
  requireIdentity: boolean;
  sendReminders: boolean;
}

export interface BulkCampaignItem {
  id: string;
  documentId?: string;
  documentName: string;
  participantName: string;
  participantEmail: string;
  status:
    'pending' | 'generating' | 'sent' | 'viewed' | 'signed' | 'rejected' | 'expired' | 'failed';
  progress: number;
  errorMessage?: string;
  updatedAt: string;
}

export const BULK_STATUS_META: Record<
  BulkCampaignStatus,
  { label: string; tone: 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'indigo' }
> = {
  draft: { label: 'Borrador', tone: 'gray' },
  validating: { label: 'Validando', tone: 'amber' },
  ready: { label: 'Lista', tone: 'blue' },
  scheduled: { label: 'Programada', tone: 'indigo' },
  processing: { label: 'Procesando', tone: 'blue' },
  active: { label: 'Activa', tone: 'blue' },
  partially_completed: { label: 'Parcialmente completada', tone: 'amber' },
  completed: { label: 'Completada', tone: 'green' },
  completed_with_exceptions: { label: 'Completada con incidencias', tone: 'amber' },
  paused: { label: 'Pausada', tone: 'gray' },
  expired: { label: 'Vencida', tone: 'red' },
  cancelled: { label: 'Cancelada', tone: 'red' },
  closed: { label: 'Cerrada', tone: 'green' },
};

export const BULK_TYPE_LABELS: Record<BulkCampaignType, string> = {
  multiple_documents: 'Varios documentos',
  template: 'Desde plantilla',
  shared_document: 'Mismo documento',
  document_package: 'Paquete documental',
};

export const DEMO_BULK_CAMPAIGNS: BulkCampaignSummary[] = [
  {
    id: 'demo-onboarding-2026',
    name: 'Renovacion anual de contratos 2026',
    description: 'Contratos personalizados para colaboradores activos.',
    campaignType: 'template',
    ownerName: 'Luis Alberto Hernandez',
    status: 'active',
    totalItems: 248,
    completedItems: 181,
    pendingItems: 61,
    failedItems: 6,
    participantCount: 248,
    expiresAt: '2026-08-31T23:59:00.000Z',
    createdAt: '2026-08-03T16:20:00.000Z',
    updatedAt: '2026-08-08T18:45:00.000Z',
  },
  {
    id: 'demo-policies-2026',
    name: 'Aceptacion de politicas de seguridad',
    description: 'Instancias individuales de la politica TI.',
    campaignType: 'shared_document',
    ownerName: 'Luis Alberto Hernandez',
    status: 'completed',
    totalItems: 96,
    completedItems: 96,
    pendingItems: 0,
    failedItems: 0,
    participantCount: 96,
    createdAt: '2026-07-18T15:10:00.000Z',
    updatedAt: '2026-07-25T21:05:00.000Z',
  },
  {
    id: 'demo-suppliers-2026',
    name: 'Alta documental de proveedores',
    description: 'Paquete de contrato, aviso y consentimiento.',
    campaignType: 'document_package',
    ownerName: 'Luis Alberto Hernandez',
    status: 'completed_with_exceptions',
    totalItems: 54,
    completedItems: 49,
    pendingItems: 0,
    failedItems: 5,
    participantCount: 18,
    createdAt: '2026-07-05T17:30:00.000Z',
    updatedAt: '2026-07-19T20:12:00.000Z',
  },
];

export function mapBulkCampaignRow(row: any): BulkCampaignSummary {
  return {
    id: row.id,
    name: row.name || 'Campana sin nombre',
    description: row.description || '',
    campaignType: row.campaign_type || 'multiple_documents',
    ownerName: row.owner_name || row.metadata?.ownerName || 'Responsable del espacio',
    status: row.status || 'draft',
    totalItems: Number(row.total_items || 0),
    completedItems: Number(row.completed_items || 0),
    pendingItems: Number(
      row.pending_items ??
        Math.max(
          0,
          Number(row.total_items || 0) -
            Number(row.completed_items || 0) -
            Number(row.failed_items || 0)
        )
    ),
    failedItems: Number(row.failed_items || 0),
    participantCount: Number(row.participant_count || 0),
    expiresAt: row.expires_at || undefined,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

export function campaignProgress(campaign: BulkCampaignSummary) {
  return campaign.totalItems > 0
    ? Math.round((campaign.completedItems / campaign.totalItems) * 100)
    : 0;
}

const LOCAL_STORAGE_KEY = 'docubox_bulk_signature_campaigns';

export function readLocalBulkCampaigns(): BulkCampaignSummary[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveLocalBulkCampaign(campaign: BulkCampaignSummary) {
  if (typeof window === 'undefined') return;
  const campaigns = readLocalBulkCampaigns().filter((item) => item.id !== campaign.id);
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([campaign, ...campaigns]));
}

export function findBulkCampaign(id: string) {
  return [...readLocalBulkCampaigns(), ...DEMO_BULK_CAMPAIGNS].find((item) => item.id === id);
}

export function createDemoItems(campaign: BulkCampaignSummary): BulkCampaignItem[] {
  const count = Math.min(Math.max(campaign.totalItems, 8), 18);
  const names = [
    'Ana Lopez',
    'Carlos Ramirez',
    'Daniela Torres',
    'Eduardo Silva',
    'Fernanda Ruiz',
    'Gabriela Soto',
  ];
  return Array.from({ length: count }, (_, index) => {
    const signed = index < Math.min(campaign.completedItems, count - 3);
    const failed = !signed && index === count - 1 && campaign.failedItems > 0;
    return {
      id: `${campaign.id}-item-${index + 1}`,
      documentId: signed ? `DOC-2026-${String(9300 + index)}` : undefined,
      documentName: `${campaign.campaignType === 'document_package' ? 'Paquete' : 'Documento'} ${String(index + 1).padStart(3, '0')}`,
      participantName: names[index % names.length],
      participantEmail: `participante${index + 1}@ejemplo.com`,
      status: signed ? 'signed' : failed ? 'failed' : index % 3 === 0 ? 'viewed' : 'sent',
      progress: signed ? 100 : failed ? 35 : index % 3 === 0 ? 65 : 45,
      errorMessage: failed
        ? 'El correo del participante fue rechazado por el proveedor.'
        : undefined,
      updatedAt: new Date(Date.now() - index * 3_600_000).toISOString(),
    };
  });
}
