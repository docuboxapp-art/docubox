import { createHash, randomBytes } from 'crypto';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

const COOKIE_PREFIX = 'docubox_document_view_';
const ACCESS_TTL_SECONDS = 60 * 30;

export type ViewAccessDocument = { id: string; owner_id: string; workspace_id?: string | null };
export type ViewAccessIdentity = { id: string; email?: string | null };

export function documentViewCookieName(documentId: string) {
  return `${COOKIE_PREFIX}${documentId}`;
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function createOpaqueDocumentViewToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token) };
}

export function authSessionId(accessToken: string) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    return String(payload.session_id || payload.sid || sha256(accessToken));
  } catch {
    return sha256(accessToken);
  }
}

function authTokenExpiry(accessToken: string) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

export function viewAccessTenantId(document: ViewAccessDocument) {
  return document.workspace_id || document.owner_id;
}

export function requestFingerprint(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  return {
    ip,
    ipHash: sha256(ip),
    userAgent,
    userAgentHash: sha256(userAgent),
    requestId: request.headers.get('x-request-id'),
  };
}

export function unlockExpiry(accessToken: string) {
  const now = Math.floor(Date.now() / 1000);
  const authExpiry = authTokenExpiry(accessToken);
  const expiresAt = Math.min(
    now + ACCESS_TTL_SECONDS,
    authExpiry > now ? authExpiry : now + ACCESS_TTL_SECONDS,
  );
  return new Date(expiresAt * 1000).toISOString();
}

export async function getDocumentViewProtection(service: SupabaseClient, document: ViewAccessDocument) {
  const result = await service
    .from('document_security_settings')
    .select('codigo_acceso_enabled,view_access_revision,view_access_configured_at,codigo_acceso_updated_at,view_access_configured_by,view_access_updated_by')
    .eq('documento_id', document.id)
    .maybeSingle();
  if (result.error) throw result.error;
  return {
    enabled: result.data?.codigo_acceso_enabled === true,
    revision: Number(result.data?.view_access_revision || 1),
    configuredAt: result.data?.view_access_configured_at || null,
    updatedAt: result.data?.codigo_acceso_updated_at || null,
    configuredBy: result.data?.view_access_configured_by || null,
    updatedBy: result.data?.view_access_updated_by || null,
  };
}

export async function hasDocumentViewAccess(args: {
  request: NextRequest;
  service: SupabaseClient;
  document: ViewAccessDocument;
  user: ViewAccessIdentity;
  accessToken: string;
}) {
  const protection = await getDocumentViewProtection(args.service, args.document);
  if (!protection.enabled) return { allowed: true, protection, reason: 'NOT_REQUIRED' };
  const token = args.request.cookies.get(documentViewCookieName(args.document.id))?.value;
  if (!token) return { allowed: false, protection, reason: 'ACCESS_CODE_REQUIRED' };

  const result = await args.service
    .from('document_view_access_sessions')
    .select('id,expires_at')
    .eq('tenant_id', viewAccessTenantId(args.document))
    .eq('document_id', args.document.id)
    .eq('user_id', args.user.id)
    .eq('auth_session_id', authSessionId(args.accessToken))
    .eq('protection_revision', protection.revision)
    .eq('token_hash', sha256(token))
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return { allowed: false, protection, reason: 'ACCESS_SESSION_EXPIRED' };

  void args.service.from('document_view_access_sessions')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', result.data.id);
  return { allowed: true, protection, reason: 'ACCESS_GRANTED' };
}

export async function auditViewAccess(args: {
  service: SupabaseClient;
  request: NextRequest;
  document: ViewAccessDocument;
  user: ViewAccessIdentity;
  action: string;
  result?: 'success' | 'denied' | 'failed';
  reason?: string;
}) {
  const fingerprint = requestFingerprint(args.request);
  await args.service.from('document_lifecycle_audit_events').insert({
    workspace_id: args.document.workspace_id || null,
    document_id: args.document.id,
    actor_id: args.user.id,
    actor_email: args.user.email || null,
    action: args.action,
    result: args.result || 'success',
    reason: args.reason || null,
    request_id: fingerprint.requestId,
    ip_address: fingerprint.ip === 'unknown' ? null : fingerprint.ip,
    user_agent: fingerprint.userAgent,
    metadata: { tenant_id: viewAccessTenantId(args.document) },
  });
}

export const DOCUMENT_VIEW_ACCESS_TTL_SECONDS = ACCESS_TTL_SECONDS;
