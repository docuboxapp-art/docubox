import { NextRequest, NextResponse } from 'next/server';
import { authorizedEvidence } from '@/lib/blockchain-evidence/access';
import { readBlockchainArtifact } from '@/lib/blockchain-evidence/storage';
import { readDocumentStorageObject } from '@/lib/crypto/document-encryption';
import { createStoredZip } from '@/lib/certification/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await context.params;
  const access = await authorizedEvidence(request, documentId);
  if (!access.user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
  if (!access.authorized || !access.service || !access.evidence)
    return NextResponse.json({ error: 'Sin permiso o evidencia inexistente.' }, { status: 403 });
  const row = access.evidence as Record<string, any>;
  if (row.status !== 'VERIFIED' || !row.certificate_storage_path)
    return NextResponse.json(
      { error: 'La evidencia todavía no está verificada.' },
      { status: 409 }
    );
  const certification = await access.service
    .from('document_certifications')
    .select('certified_pdf_path,certified_pdf_sha256')
    .eq('id', row.document_certification_id)
    .single();
  if (certification.error)
    return NextResponse.json({ error: 'PDF final no disponible.' }, { status: 409 });
  const [document, manifest, proof, certificate] = await Promise.all([
    readDocumentStorageObject({
      service: access.service,
      storageBucket: 'certification-artifacts',
      storagePath: certification.data.certified_pdf_path,
      expectedPlaintextSha256: certification.data.certified_pdf_sha256,
      userId: access.user.id,
      accessEvent: 'DOCUMENT_DOWNLOADED',
    }),
    readBlockchainArtifact(access.service, row.manifest_storage_path),
    readBlockchainArtifact(access.service, row.proof_storage_path, row.proof_sha256),
    readBlockchainArtifact(access.service, row.certificate_storage_path, row.certificate_sha256),
  ]);
  const zip = createStoredZip([
    { name: 'documento-final.pdf', data: new Uint8Array(document.plaintext) },
    { name: 'constancia-blockchain.pdf', data: certificate },
    { name: 'document.ots', data: proof },
    { name: 'blockchain-evidence-manifest.json', data: manifest },
  ]);
  document.plaintext.fill(0);
  const folio = `DBX-BTC-${new Date(row.verified_at).getUTCFullYear()}-${row.public_token.slice(0, 8).toUpperCase()}`;
  return new NextResponse(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Docubox-Evidence-${folio}.zip"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
