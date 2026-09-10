import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocatedVerificationDocument, PublicVerificationResult } from './types';
import { VERIFIER_VERSION } from './types';
import { createServiceClient } from '@/lib/supabase/server';

export class PublicRateLimitUnavailableError extends Error {
  constructor() {
    super('PUBLIC_RATE_LIMIT_UNAVAILABLE');
    this.name = 'PublicRateLimitUnavailableError';
  }
}

export async function enforcePublicRateLimit(request: NextRequest, scope: string, limit = 30) {
  const ip =
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const key = createHash('sha256').update(`public-verification:${scope}:${ip}`).digest('hex');
  const { data, error } = await createServiceClient().rpc('consume_server_rate_limit', {
    p_key_hash: key,
    p_limit: limit,
    p_window_seconds: 60,
  });
  if (error) {
    console.error('[public-verification] Distributed rate limit unavailable', {
      scope,
      code: error.code || null,
    });
    throw new PublicRateLimitUnavailableError();
  }
  return data === true;
}

export async function logVerificationRun(input: {
  supabase: SupabaseClient;
  request: NextRequest;
  result: PublicVerificationResult;
  documentId?: string | null;
  publicVerificationId?: string | null;
  durationMs: number;
}) {
  const ip = input.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const userAgent = input.request.headers.get('user-agent') || 'unknown';
  const secret =
    process.env.VERIFICATION_LOG_HASH_SECRET || process.env.DOCUBOX_INTERNAL_SIGNING_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('VERIFICATION_LOG_HASH_SECRET_NOT_CONFIGURED');
  }
  const digest = (value: string) => createHash('sha256').update(`${secret}:${value}`).digest('hex');
  const { data: run } = await input.supabase
    .from('verification_runs')
    .insert({
      id: input.result.verificationId,
      public_verification_id: input.publicVerificationId || null,
      document_id: input.documentId || null,
      source: input.result.method,
      overall_status: input.result.overallStatus,
      validator_version: input.result.validatorVersion,
      duration_ms: input.durationMs,
      ip_hash_sha256: digest(ip),
      user_agent_hash_sha256: digest(userAgent),
    })
    .select('id')
    .maybeSingle();
  if (!run) return;
  await input.supabase.from('verification_checks').insert(
    input.result.checks.map((check) => ({
      verification_run_id: run.id,
      engine: check.engine,
      check_type: check.checkType,
      status: check.status,
      code: check.code,
      message: check.message,
      technical_details: check.technicalDetails || {},
      validator_version: VERIFIER_VERSION,
      checked_at: check.checkedAt,
    }))
  );
}

export async function attachTemporaryDocumentUrl(
  supabase: SupabaseClient,
  document: LocatedVerificationDocument,
  result: PublicVerificationResult,
  publicToken: string
) {
  void supabase;
  if (
    !document.isPublic ||
    !document.publicLinkId ||
    !document.sealedPdfPath ||
    !document.sealedPdfHash ||
    !result.document
  ) {
    return result;
  }
  const accessToken = encodeURIComponent(publicToken);
  return {
    ...result,
    document: {
      ...result.document,
      documentUrl: `/api/verificacion/documentos/${document.id}/archivo?token=${accessToken}`,
    },
  };
}
