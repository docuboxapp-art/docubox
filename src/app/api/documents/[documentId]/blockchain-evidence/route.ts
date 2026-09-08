import { NextRequest, NextResponse } from 'next/server';
import { authorizedEvidence } from '@/lib/blockchain-evidence/access';
import {
  createBlockchainEvidenceForFinalDocument,
  retryBlockchainEvidenceSubmission,
} from '@/lib/blockchain-evidence/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dto(row: Record<string, any> | null) {
  if (!row) return null;
  return {
    id: row.id,
    public_token: row.public_token,
    protocol: row.protocol,
    blockchain: row.blockchain,
    status: row.status,
    document_hash: row.document_hash,
    manifest_hash: row.manifest_hash,
    proof_sha256: row.proof_sha256,
    bitcoin_block_height: row.bitcoin_block_height,
    bitcoin_block_hash: row.bitcoin_block_hash,
    bitcoin_attested_at: row.bitcoin_attested_at,
    submitted_at: row.submitted_at,
    verified_at: row.verified_at,
    upgrade_attempts: row.upgrade_attempts,
    error_code: row.verification_error_code,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await context.params;
  const access = await authorizedEvidence(request, documentId);
  if (!access.user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
  if (!access.authorized) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 });
  return NextResponse.json(
    { evidence: dto(access.evidence) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await context.params;
  const access = await authorizedEvidence(request, documentId);
  if (!access.user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
  if (!access.authorized || !access.manageable || !access.service)
    return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 });
  try {
    if (
      access.evidence &&
      !['SUBMISSION_FAILED', 'UPGRADE_FAILED', 'VERIFICATION_FAILED', 'STORAGE_ERROR'].includes(
        access.evidence.status
      )
    ) {
      return NextResponse.json({ evidence: dto(access.evidence), idempotent: true });
    }
    if (access.evidence) {
      if (!access.evidence.proof_storage_path) {
        const evidence = await retryBlockchainEvidenceSubmission(access.service, access.evidence);
        return NextResponse.json({ evidence: dto(evidence), retried: true }, { status: 202 });
      }
      await access.service
        .from('document_blockchain_evidence')
        .update({
          status: 'PENDING_BITCOIN',
          next_upgrade_attempt_at: new Date().toISOString(),
          verification_error_code: null,
          last_error_message: null,
        })
        .eq('id', access.evidence.id);
      return NextResponse.json(
        { evidence: dto({ ...access.evidence, status: 'PENDING_BITCOIN' }), retry_scheduled: true },
        { status: 202 }
      );
    }
    const evidence = await createBlockchainEvidenceForFinalDocument(access.service, {
      documentId,
      actorId: access.user.id,
    });
    return NextResponse.json({ evidence: dto(evidence) }, { status: evidence ? 201 : 409 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No fue posible crear la evidencia.' },
      { status: 500 }
    );
  }
}
