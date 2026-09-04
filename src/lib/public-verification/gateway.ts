import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocatedVerificationDocument, PublicVerificationResult } from './types';
import { VERIFIER_VERSION } from './types';
import { documentEncryptionPolicy } from '@/lib/crypto/document-encryption';

const attempts = new Map<string, { count: number; expiresAt: number }>();

export function enforcePublicRateLimit(request: NextRequest, scope: string, limit = 30) {
  const now = Date.now();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = createHash('sha256').update(`${scope}:${ip}`).digest('hex');
  const current = attempts.get(key);
  if (!current || current.expiresAt <= now) {
    attempts.set(key, { count: 1, expiresAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
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
  const secret = process.env.VERIFICATION_LOG_HASH_SECRET || process.env.DOCUBOX_INTERNAL_SIGNING_KEY;
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
  result: PublicVerificationResult
) {
  if (!document.isPublic || !result.document) return result;
  if (documentEncryptionPolicy().enabled) {
    return {
      ...result,
      document: {
        ...result.document,
        documentUrl: `/api/verificacion/documentos/${document.id}/archivo`,
      },
    };
  }
  const candidates: Array<{ bucket: string; path: string }> = [];
  if (document.sealedPdfPath) {
    candidates.push({ bucket: 'documents-signed', path: document.sealedPdfPath });
    candidates.push({ bucket: 'documents', path: document.sealedPdfPath });
  }
  if (document.fileUrl) {
    const reference = extractStorageReference(document.fileUrl);
    if (reference) candidates.push(reference);
    else if (!/^https?:\/\//i.test(document.fileUrl))
      candidates.push({ bucket: 'documents', path: document.fileUrl });
  }
  for (const candidate of candidates) {
    const { data } = await supabase.storage
      .from(candidate.bucket)
      .createSignedUrl(candidate.path, 5 * 60);
    if (data?.signedUrl)
      return { ...result, document: { ...result.document, documentUrl: data.signedUrl } };
  }
  return result;
}

function extractStorageReference(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.+)$/
    );
    return match
      ? { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) }
      : null;
  } catch {
    return null;
  }
}
