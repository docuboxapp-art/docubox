import 'server-only';

import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { appendLegalHoldEvidenceSupplement } from '@/lib/evidence-v2/supplements';

export const LEGAL_HOLD_REASON_LABELS = {
  litigio: 'Litigio / procedimiento judicial',
  requerimiento_autoridad: 'Requerimiento de autoridad',
  auditoria: 'Auditoría',
  investigacion_interna: 'Investigación interna',
  controversia_contractual: 'Controversia contractual',
  cumplimiento_regulatorio_fiscal: 'Cumplimiento regulatorio/fiscal',
  solicitud_cliente: 'Solicitud del cliente',
  preservacion_preventiva: 'Preservación preventiva',
  otro: 'Otro',
} as const;

export type LegalHoldReasonCode = keyof typeof LEGAL_HOLD_REASON_LABELS;

export type LegalHoldInput = {
  reasonCode: LegalHoldReasonCode;
  caseReference?: string | null;
  notes?: string | null;
  reviewAt?: string | null;
  expectedEndAt?: string | null;
};

export type LegalHoldRecord = {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  document_id: string;
  status: 'ACTIVE' | 'RELEASED';
  reason_code: LegalHoldReasonCode;
  reason_label: string;
  case_reference: string | null;
  notes: string | null;
  review_at: string | null;
  expected_end_at: string | null;
  activated_by: string;
  activated_at: string;
  released_by: string | null;
  released_at: string | null;
  release_reason: string | null;
  release_notes: string | null;
  created_at: string;
  updated_at: string;
};

export function parseLegalHoldInput(value: unknown): LegalHoldInput | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const reasonCode = String(source.reasonCode || source.reason || '') as LegalHoldReasonCode;
  if (!(reasonCode in LEGAL_HOLD_REASON_LABELS)) return null;
  const optionalText = (item: unknown) => {
    const text = typeof item === 'string' ? item.trim() : '';
    return text ? text.slice(0, 2000) : null;
  };
  const optionalDate = (item: unknown) => {
    if (typeof item !== 'string' || !item.trim()) return null;
    const date = new Date(item);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };
  const reviewAt = optionalDate(source.reviewAt);
  const expectedEndAt = optionalDate(source.expectedEndAt);
  if (reviewAt === undefined || expectedEndAt === undefined) return null;
  return {
    reasonCode,
    caseReference: optionalText(source.caseReference),
    notes: optionalText(source.notes),
    reviewAt,
    expectedEndAt,
  };
}

function requestRpcMetadata(request?: NextRequest) {
  return {
    p_request_id: request?.headers.get('x-request-id') || null,
    p_ip_address: request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    p_user_agent: request?.headers.get('user-agent') || null,
  };
}

export async function activateLegalHold(input: {
  service: SupabaseClient;
  documentId: string;
  actor: Pick<User, 'id' | 'email'>;
  hold: LegalHoldInput;
  request?: NextRequest;
}) {
  const { service, documentId, actor, hold, request } = input;
  const result = await service.rpc('activate_document_legal_hold', {
    p_document_id: documentId,
    p_reason_code: hold.reasonCode,
    p_reason_label: LEGAL_HOLD_REASON_LABELS[hold.reasonCode],
    p_actor_id: actor.id,
    p_actor_email: actor.email || null,
    p_case_reference: hold.caseReference || null,
    p_notes: hold.notes || null,
    p_review_at: hold.reviewAt || null,
    p_expected_end_at: hold.expectedEndAt || null,
    ...requestRpcMetadata(request),
  });
  if (result.error) throw result.error;
  const created = result.data as LegalHoldRecord;
  await appendLegalHoldEvidenceSupplement(
    service,
    documentId,
    created.id,
    'LEGAL_HOLD_ACTIVATED'
  ).catch((error) => console.error('[legal-hold] Evidence V2 supplement failed', error));
  return created;
}

export async function updateLegalHold(input: {
  service: SupabaseClient;
  holdId: string;
  actor: Pick<User, 'id' | 'email'>;
  hold: LegalHoldInput;
  request?: NextRequest;
}) {
  const { service, holdId, actor, hold, request } = input;
  const result = await service.rpc('update_document_legal_hold', {
    p_hold_id: holdId,
    p_actor_id: actor.id,
    p_actor_email: actor.email || null,
    p_reason_code: hold.reasonCode,
    p_reason_label: LEGAL_HOLD_REASON_LABELS[hold.reasonCode],
    p_case_reference: hold.caseReference || null,
    p_notes: hold.notes || null,
    p_review_at: hold.reviewAt || null,
    p_expected_end_at: hold.expectedEndAt || null,
    ...requestRpcMetadata(request),
  });
  if (result.error) throw result.error;
  return result.data as LegalHoldRecord;
}

export async function releaseLegalHold(input: {
  service: SupabaseClient;
  holdId: string;
  actor: Pick<User, 'id' | 'email'>;
  reason: string;
  notes?: string | null;
  request?: NextRequest;
}) {
  const { service, holdId, actor, reason, notes, request } = input;
  const result = await service.rpc('release_document_legal_hold', {
    p_hold_id: holdId,
    p_actor_id: actor.id,
    p_actor_email: actor.email || null,
    p_release_reason: reason.trim(),
    p_release_notes: notes?.trim() || null,
    ...requestRpcMetadata(request),
  });
  if (result.error) throw result.error;
  const released = result.data as LegalHoldRecord;
  await appendLegalHoldEvidenceSupplement(
    service,
    released.document_id,
    released.id,
    'LEGAL_HOLD_RELEASED'
  ).catch((error) => console.error('[legal-hold] Evidence V2 supplement failed', error));
  return released;
}

export async function listLegalHolds(service: SupabaseClient, documentId: string) {
  const result = await service
    .from('document_legal_holds')
    .select('*')
    .eq('document_id', documentId)
    .order('activated_at', { ascending: false });
  if (result.error) throw result.error;
  return (result.data || []) as LegalHoldRecord[];
}
