import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { readBlockchainArtifact } from '@/lib/blockchain-evidence/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ publicToken: string; artifact: string }> }
) {
  const { publicToken, artifact } = await context.params;
  if (!/^[a-f0-9]{48}$/.test(publicToken) || !['proof', 'certificate'].includes(artifact))
    return new NextResponse(null, { status: 404 });
  const service = createServiceClient();
  const result = await service
    .from('document_blockchain_evidence')
    .select(
      'id,document_id,document_hash,status,proof_storage_path,proof_sha256,certificate_storage_path,certificate_sha256'
    )
    .eq('public_token', publicToken)
    .maybeSingle();
  if (result.error || !result.data) return new NextResponse(null, { status: 404 });
  const isProof = artifact === 'proof';
  const path = isProof ? result.data.proof_storage_path : result.data.certificate_storage_path;
  const hash = isProof ? result.data.proof_sha256 : result.data.certificate_sha256;
  if (!path || !hash || (!isProof && result.data.status !== 'VERIFIED'))
    return NextResponse.json({ error: 'Artefacto aún no disponible.' }, { status: 409 });
  try {
    const bytes = await readBlockchainArtifact(service, path, hash);
    if (isProof) {
      await service.rpc('append_legal_evidence_event', {
        p_document_id: result.data.document_id,
        p_event_type: 'BLOCKCHAIN_PROOF_DOWNLOADED',
        p_event_category: 'ACCESS',
        p_event_result: 'SUCCESS',
        p_actor_id: null,
        p_actor_type: 'ANONYMOUS',
        p_payload: { evidence_id: result.data.id },
        p_document_sha256: result.data.document_hash,
        p_idempotency_key: null,
        p_source_system: 'DOCUBOX_BLOCKCHAIN_EVIDENCE',
        p_source_record_id: result.data.id,
      });
    }
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': isProof ? 'application/vnd.opentimestamps.ots' : 'application/pdf',
        'Content-Disposition': `attachment; filename="${isProof ? 'document.ots' : 'constancia-anclaje-bitcoin.pdf'}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'No fue posible recuperar el artefacto.' }, { status: 500 });
  }
}
