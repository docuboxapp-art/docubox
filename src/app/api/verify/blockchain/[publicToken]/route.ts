import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { verifyBlockchainEvidenceArtifacts } from '@/lib/blockchain-evidence/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicDto(row: Record<string, any>) {
  return {
    public_id: row.public_token,
    protocol: row.protocol,
    blockchain: row.blockchain,
    status: row.status,
    document_sha256: row.document_hash,
    manifest_sha256: row.manifest_hash,
    proof_sha256: row.proof_sha256,
    bitcoin_block_height: row.bitcoin_block_height,
    bitcoin_block_hash: row.bitcoin_block_hash,
    bitcoin_attested_at: row.bitcoin_attested_at,
    submitted_at: row.submitted_at,
    verified_at: row.verified_at,
    validations: {
      document_integrity: row.status === 'VERIFIED',
      sha256_matches: row.status === 'VERIFIED',
      manifest_matches: row.status === 'VERIFIED',
      opentimestamps_proof_valid: row.status === 'VERIFIED',
      bitcoin_attestation_found: ['ANCHORED', 'VERIFIED'].includes(row.status),
      bitcoin_anchor_verified: row.status === 'VERIFIED',
    },
  };
}

async function findEvidence(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const service = createServiceClient();
  const result = await service
    .from('document_blockchain_evidence')
    .select('*')
    .eq('public_token', token)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ? { service, row: result.data as Record<string, any> } : null;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ publicToken: string }> }
) {
  const found = await findEvidence((await context.params).publicToken);
  if (!found) return NextResponse.json({ error: 'Evidencia no encontrada.' }, { status: 404 });
  return NextResponse.json(publicDto(found.row), {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ publicToken: string }> }
) {
  const found = await findEvidence((await context.params).publicToken);
  if (!found) return NextResponse.json({ error: 'Evidencia no encontrada.' }, { status: 404 });
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'Selecciona un PDF válido.' }, { status: 400 });
  }
  if (file.size > 50 * 1024 * 1024)
    return NextResponse.json({ error: 'El PDF excede 50 MB.' }, { status: 413 });
  try {
    const result = await verifyBlockchainEvidenceArtifacts(
      found.service,
      found.row,
      new Uint8Array(await file.arrayBuffer())
    );
    return NextResponse.json(result, {
      status: result.status === 'VERIFICATION_FAILED' ? 422 : 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'No fue posible verificar la evidencia.',
        code: error instanceof Error ? error.name : 'VERIFICATION_FAILED',
      },
      { status: 500 }
    );
  }
}
