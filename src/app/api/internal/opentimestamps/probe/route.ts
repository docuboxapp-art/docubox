import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { blockchainEvidenceConfig } from '@/lib/blockchain-evidence/config';
import { isAuthorizedOpenTimestampsWorker } from '@/lib/blockchain-evidence/internal-auth';
import { createBlockchainEvidenceManifest, hashBytes } from '@/lib/blockchain-evidence/manifest';
import { createOpenTimestampProvider } from '@/lib/blockchain-evidence/provider';
import { BLOCKCHAIN_EVIDENCE_BUCKET } from '@/lib/blockchain-evidence/storage';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isAuthorizedOpenTimestampsWorker(request)) return new NextResponse(null, { status: 404 });
  const service = createServiceClient();
  const provider = createOpenTimestampProvider();
  const config = blockchainEvidenceConfig();
  const testFile = Buffer.from('docubox-ots-test-v1\n', 'utf8');
  const documentHash = createHash('sha256').update(testFile).digest('hex');
  const evidenceHash = createHash('sha256')
    .update('docubox-ots-controlled-evidence-v1\n', 'utf8')
    .digest('hex');
  const manifest = createBlockchainEvidenceManifest({ documentHash, evidenceHash });
  try {
    const created = await provider.createProof({
      canonicalManifest: manifest.canonical,
      manifestHash: manifest.manifestHash,
      calendars: config.calendars,
    });
    const proofSha256 = hashBytes(created.proof);
    const inspection = await provider.getProofStatus(created.proof);
    const probeId = randomUUID();
    const root = `runtime-probes/${new Date().toISOString().slice(0, 10)}/${probeId}`;
    const report = {
      schema: 'docubox.opentimestamps-runtime-probe',
      version: '1.0',
      test_file_hash: documentHash,
      manifest_hash: manifest.manifestHash,
      proof_sha256: proofSha256,
      proof_size: created.proof.byteLength,
      calendars: created.calendarsSucceeded,
      calendars_failed: created.calendarsFailed,
      status: inspection.bitcoinAttestationFound ? 'ANCHORED' : 'PENDING_BITCOIN',
      created_at: new Date().toISOString(),
    };
    const uploads = await Promise.all([
      service.storage
        .from(BLOCKCHAIN_EVIDENCE_BUCKET)
        .upload(`${root}/docubox-ots-test.txt`, testFile, {
          contentType: 'application/octet-stream',
          upsert: false,
        }),
      service.storage
        .from(BLOCKCHAIN_EVIDENCE_BUCKET)
        .upload(`${root}/blockchain-evidence-manifest.json`, manifest.canonical, {
          contentType: 'application/json',
          upsert: false,
        }),
      service.storage
        .from(BLOCKCHAIN_EVIDENCE_BUCKET)
        .upload(`${root}/document.ots`, created.proof, {
          contentType: 'application/vnd.opentimestamps.ots',
          upsert: false,
        }),
      service.storage
        .from(BLOCKCHAIN_EVIDENCE_BUCKET)
        .upload(`${root}/result.json`, JSON.stringify(report), {
          contentType: 'application/json',
          upsert: false,
        }),
    ]);
    if (uploads.some((upload) => upload.error)) throw new Error('OTS_STORAGE_FAILED');
    return NextResponse.json(
      { ...report, persisted_private_storage: true },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'No fue posible completar la prueba real.',
        code: error instanceof Error ? error.name : 'OTS_STAMP_FAILED',
      },
      { status: 500 }
    );
  }
}
