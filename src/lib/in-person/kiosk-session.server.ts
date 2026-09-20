import 'server-only';

import type { NextRequest } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { appendPackageEvent, sha256 } from '@/lib/document-package/server';
import { createServiceClient } from '@/lib/supabase/server';

export const KIOSK_COOKIE_NAME = 'docubox_kiosk_session';
export const KIOSK_SESSION_SECONDS = 15 * 60;
const KIOSK_CONTAINMENT_COOKIE_SECONDS = 24 * 60 * 60;

export type KioskSessionRow = {
  id: string;
  workspace_id: string;
  document_id: string;
  participant_reference_id: string;
  created_by: string;
  status: string;
  allowed_actions: string[];
  correlation_id: string;
  expires_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  revoked_at: string | null;
};

export function kioskCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    // Keep the browser contained after the 15-minute authorization expires.
    // The cookie is cleared only when secure owner recovery begins.
    maxAge: KIOSK_CONTAINMENT_COOKIE_SECONDS,
  };
}

export async function loadKioskSessionByToken(token: string) {
  const service = createServiceClient();
  const result = await service
    .from('in_person_signing_sessions')
    .select(
      'id,workspace_id,document_id,participant_reference_id,created_by,status,allowed_actions,correlation_id,expires_at,started_at,completed_at,cancelled_at,revoked_at'
    )
    .eq('token_hash', sha256(token))
    .maybeSingle();
  if (result.error) throw result.error;
  return { service, session: result.data as KioskSessionRow | null };
}

export async function loadKioskSessionFromRequest(request: NextRequest) {
  const token = request.cookies.get(KIOSK_COOKIE_NAME)?.value || '';
  if (!token) return { token: '', service: createServiceClient(), session: null };
  const loaded = await loadKioskSessionByToken(token);
  return { token, ...loaded };
}

export async function expireKioskSessionIfNeeded(
  service: SupabaseClient,
  session: KioskSessionRow
) {
  if (session.revoked_at || new Date(session.expires_at).getTime() > Date.now()) return session;
  const expiredAt = new Date().toISOString();
  const updated = await service
    .from('in_person_signing_sessions')
    .update({ status: 'expired', revoked_at: expiredAt, updated_at: expiredAt })
    .eq('id', session.id)
    .in('status', ['created', 'started'])
    .is('revoked_at', null)
    .select(
      'id,workspace_id,document_id,participant_reference_id,created_by,status,allowed_actions,correlation_id,expires_at,started_at,completed_at,cancelled_at,revoked_at'
    )
    .maybeSingle();
  if (updated.error) throw updated.error;
  const expired = (updated.data as KioskSessionRow | null) || {
    ...session,
    status: 'expired',
    revoked_at: expiredAt,
  };
  if (updated.data) {
    await appendPackageEvent({
      service,
      workspaceId: session.workspace_id,
      documentId: session.document_id,
      participantReferenceId: session.participant_reference_id,
      eventType: 'in_person_session.expired',
      eventKey: `in-person:${session.id}:expired`,
      correlationId: session.correlation_id,
      payload: { session_id: session.id },
    });
  }
  return expired;
}

export async function kioskParticipantMatchesUser(
  service: SupabaseClient,
  session: KioskSessionRow,
  user: User
) {
  const result = await service
    .from('document_participant_references')
    .select('id,participant_user_id,participant_email_normalized,snapshot')
    .eq('id', session.participant_reference_id)
    .eq('document_id', session.document_id)
    .eq('workspace_id', session.workspace_id)
    .eq('active', true)
    .maybeSingle();
  if (result.error) throw result.error;
  const normalizedEmail = user.email?.trim().toLowerCase() || '';
  return {
    matches: Boolean(
      result.data &&
      (result.data.participant_user_id === user.id ||
        (normalizedEmail && result.data.participant_email_normalized === normalizedEmail))
    ),
    participant: result.data,
  };
}

export function isKioskDocumentRequest(request: NextRequest) {
  return Boolean(request.cookies.get(KIOSK_COOKIE_NAME)?.value);
}

export async function assertKioskDocumentScope(request: NextRequest, documentId: string) {
  if (!isKioskDocumentRequest(request)) return null;
  const loaded = await loadKioskSessionFromRequest(request);
  if (!loaded.session) throw new Error('KIOSK_SESSION_INVALID');
  const session = await expireKioskSessionIfNeeded(loaded.service, loaded.session);
  if (session.status !== 'started' || session.revoked_at || session.document_id !== documentId) {
    throw new Error('KIOSK_SCOPE_DENIED');
  }
  return session;
}
