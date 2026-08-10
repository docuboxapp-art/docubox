export type PromissoryNoteStatus =
  | 'draft'
  | 'preparing'
  | 'awaiting_signature'
  | 'signed'
  | 'issued'
  | 'active'
  | 'partially_paid'
  | 'overdue'
  | 'paid'
  | 'cancelled'
  | 'voided';

export type PromissoryNoteKind =
  'simple' | 'interest' | 'guaranteed' | 'installments' | 'series' | 'contract';

export interface PromissoryNoteSummary {
  id: string;
  folio: string;
  publicToken: string;
  kind: PromissoryNoteKind;
  kindLabel?: string;
  subscriberName: string;
  subscriberRfc: string;
  beneficiaryName: string;
  currentHolderName: string;
  amount: number;
  balance: number;
  currency: string;
  issuedAt?: string;
  maturityDate: string;
  status: PromissoryNoteStatus;
  canonicalHash: string;
  updatedAt: string;
}

export const STATUS_META: Record<
  PromissoryNoteStatus,
  { label: string; tone: 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'indigo' }
> = {
  draft: { label: 'Borrador', tone: 'gray' },
  preparing: { label: 'En preparacion', tone: 'blue' },
  awaiting_signature: { label: 'En firma', tone: 'amber' },
  signed: { label: 'Firmado', tone: 'indigo' },
  issued: { label: 'Emitido', tone: 'indigo' },
  active: { label: 'Vigente', tone: 'green' },
  partially_paid: { label: 'Parcialmente pagado', tone: 'blue' },
  overdue: { label: 'Vencido', tone: 'red' },
  paid: { label: 'Liquidado', tone: 'green' },
  cancelled: { label: 'Cancelado', tone: 'gray' },
  voided: { label: 'Anulado', tone: 'red' },
};

export const ALLOWED_TRANSITIONS: Record<PromissoryNoteStatus, PromissoryNoteStatus[]> = {
  draft: ['preparing', 'awaiting_signature', 'voided'],
  preparing: ['draft', 'awaiting_signature', 'voided'],
  awaiting_signature: ['signed', 'cancelled', 'voided'],
  signed: ['issued', 'voided'],
  issued: ['active'],
  active: ['partially_paid', 'overdue', 'paid', 'cancelled'],
  partially_paid: ['overdue', 'paid', 'cancelled'],
  overdue: ['partially_paid', 'paid', 'cancelled'],
  paid: ['cancelled'],
  cancelled: [],
  voided: [],
};

export function canTransition(from: PromissoryNoteStatus, to: PromissoryNoteStatus) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export const DEMO_PROMISSORY_NOTES: PromissoryNoteSummary[] = [
  {
    id: 'demo-active',
    folio: 'PG-MX-2026-00000182',
    publicToken: 'demo-pg-mx-2026-00000182',
    kind: 'interest',
    subscriberName: 'Comercializadora del Norte, S.A. de C.V.',
    subscriberRfc: 'CNO190214KQ3',
    beneficiaryName: 'Docubox Capital, S.A. de C.V.',
    currentHolderName: 'Docubox Capital, S.A. de C.V.',
    amount: 500000,
    balance: 300000,
    currency: 'MXN',
    issuedAt: '2026-08-07T18:32:00.000Z',
    maturityDate: '2027-02-07',
    status: 'partially_paid',
    canonicalHash: '7c52f8f0fb3fe4fe1d268a9f0952f26db184d412bd114bda8af37f7b6d6a0d81',
    updatedAt: '2026-08-08T16:20:00.000Z',
  },
  {
    id: 'demo-signature',
    folio: 'BORRADOR-000183',
    publicToken: 'demo-pg-signature-000183',
    kind: 'guaranteed',
    subscriberName: 'Servicios Industriales Rivera',
    subscriberRfc: 'SIR2203158N2',
    beneficiaryName: 'Luis Alberto Hernandez Beltran',
    currentHolderName: 'Luis Alberto Hernandez Beltran',
    amount: 185000,
    balance: 185000,
    currency: 'MXN',
    maturityDate: '2026-10-15',
    status: 'awaiting_signature',
    canonicalHash: '',
    updatedAt: '2026-08-08T14:06:00.000Z',
  },
  {
    id: 'demo-overdue',
    folio: 'PG-MX-2026-00000174',
    publicToken: 'demo-pg-mx-2026-00000174',
    kind: 'simple',
    subscriberName: 'Proveedora Pacifico, S.A. de C.V.',
    subscriberRfc: 'PPA180902DM7',
    beneficiaryName: 'Docubox Capital, S.A. de C.V.',
    currentHolderName: 'Docubox Capital, S.A. de C.V.',
    amount: 92000,
    balance: 92000,
    currency: 'MXN',
    issuedAt: '2026-04-12T19:10:00.000Z',
    maturityDate: '2026-08-03',
    status: 'overdue',
    canonicalHash: 'a3fe08ca78b37ee0c1fc4d4d153ad62dc44eb011746c174f189b869c358e39d4',
    updatedAt: '2026-08-08T09:45:00.000Z',
  },
];

export function mapPromissoryNoteRow(row: any): PromissoryNoteSummary {
  const parties = Array.isArray(row.title_parties) ? row.title_parties : [];
  const subscriber = parties.find((party: any) => party.role === 'subscriber');
  const beneficiary = parties.find((party: any) => party.role === 'beneficiary');
  return {
    id: row.id,
    folio: row.folio || `BORRADOR-${String(row.id).slice(0, 8).toUpperCase()}`,
    publicToken: row.public_token || '',
    kind: row.promissory_notes?.note_kind || row.note_kind || 'simple',
    subscriberName: subscriber?.display_name || row.subscriber_name || 'Sin suscriptor',
    subscriberRfc: subscriber?.tax_id_masked || row.subscriber_rfc || '',
    beneficiaryName: beneficiary?.display_name || row.beneficiary_name || 'Sin beneficiario',
    currentHolderName: row.current_holder_name || beneficiary?.display_name || 'Pendiente',
    amount: Number(row.nominal_amount || row.promissory_notes?.principal_amount || 0),
    balance: Number(row.outstanding_balance ?? row.nominal_amount ?? 0),
    currency: row.currency || 'MXN',
    issuedAt: row.issued_at || undefined,
    maturityDate: row.maturity_date || row.promissory_notes?.maturity_date || '',
    status: row.status || 'draft',
    canonicalHash: row.canonical_hash || '',
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

export function readLocalPromissoryNotes(): PromissoryNoteSummary[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem('docubox_credit_titles_drafts') || '[]');
  } catch {
    return [];
  }
}

export function formatMoney(value: number, currency = 'MXN') {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
