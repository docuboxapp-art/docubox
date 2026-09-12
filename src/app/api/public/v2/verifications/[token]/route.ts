import { NextRequest, NextResponse } from 'next/server';
import { enforcePublicRateLimit } from '@/lib/public-verification/gateway';
import { createServiceClient } from '@/lib/supabase/server';
import { verifyEvidenceV2Package } from '@/lib/evidence-v2/verifier';
import { createCertificationProviderSet } from '@/lib/certification/providers';
import { createOpenTimestampProvider } from '@/lib/blockchain-evidence/provider';
import { createNom151Provider } from '@/lib/nom151/provider';
import { parseEvidenceV2Xml } from '@/lib/evidence-v2/parser';
import { verifyEvidenceSealAgainstRegistry } from '@/lib/evidence-v2/trust-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function xmlText(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)<\\/${name}>`));
  return match?.[1]?.trim() || null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    if (!(await enforcePublicRateLimit(request, 'EVIDENCE_V2_TOKEN', 30))) {
      return response({ error: 'Demasiadas consultas. Intenta más tarde.' }, 429);
    }
  } catch {
    return response({ error: 'El servicio de verificación no está disponible temporalmente.' }, 503);
  }
  const { token } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(token || '')) {
    return response({ error: 'Identificador de verificación no válido.' }, 400);
  }
  try {
    const service = createServiceClient();
    const packageResult = await service.from('evidence_packages').select(
      'id,package_id,evidence_version,status,document_id,document_final_sha256,evidence_root_sha256,xml_storage_bucket,xml_storage_path,xml_sha256,generated_at,closed_at'
    ).eq('public_verification_token', token).in('evidence_version', ['2.0', '2.1']).maybeSingle();
    if (packageResult.error) throw packageResult.error;
    if (!packageResult.data) return response({ error: 'No se encontró la evidencia solicitada.' }, 404);
    const packageRow = packageResult.data;
    const artifactsResult = await service.from('evidence_package_artifacts').select(
      'artifact_type,artifact_status,object_sha256,storage_bucket,storage_path,provider,issued_at,validated_at,metadata'
    ).eq('package_id', packageRow.id).order('created_at', { ascending: true });
    if (artifactsResult.error) throw artifactsResult.error;
    const pdfArtifact = artifactsResult.data?.find((artifact) => artifact.artifact_type === 'pades_pdf');
    if (!pdfArtifact) return response({ error: 'El PDF final del paquete no está disponible.' }, 409);
    const [xmlDownload, pdfDownload, ...artifactDownloads] = await Promise.all([
      service.storage.from(packageRow.xml_storage_bucket).download(packageRow.xml_storage_path),
      service.storage.from(pdfArtifact.storage_bucket).download(pdfArtifact.storage_path),
      ...(artifactsResult.data || [])
        .filter((artifact) => artifact.artifact_type !== 'pades_pdf')
        .map((artifact) => service.storage.from(artifact.storage_bucket).download(artifact.storage_path)),
    ]);
    if (xmlDownload.error || !xmlDownload.data || pdfDownload.error || !pdfDownload.data) {
      throw xmlDownload.error || pdfDownload.error || new Error('EVIDENCE_ARTIFACT_NOT_FOUND');
    }
    const xml = await xmlDownload.data.text();
    const pdfBytes = new Uint8Array(await pdfDownload.data.arrayBuffer());
    const externalRows = (artifactsResult.data || []).filter((artifact) => artifact.artifact_type !== 'pades_pdf');
    const externalArtifacts = await Promise.all(externalRows.map(async (artifact, index) => {
      const downloaded = artifactDownloads[index];
      if (downloaded?.error || !downloaded?.data) {
        throw downloaded?.error || new Error(`EVIDENCE_ARTIFACT_NOT_FOUND:${artifact.artifact_type}`);
      }
      const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
      return {
        type: artifact.artifact_type,
        bytes,
        expectedSha256: artifact.object_sha256,
        metadata: artifact.metadata as Record<string, unknown>,
      };
    }));
    const providers = createCertificationProviderSet();
    const openTimestampsProvider = createOpenTimestampProvider();
    const nom151Provider = createNom151Provider();
    const verification = await verifyEvidenceV2Package({
      xml,
      pdfBytes,
      artifacts: externalArtifacts,
      padesVerifier: (bytes) => providers.independentVerification.verifyPdf({ pdfBytes: bytes }),
      externalVerifiers: {
        rfc3161: async (bytes, expectedDigest) => {
          const checked = await providers.timestampAuthority.verifyTimestamp(bytes, {
            expectedDigest: expectedDigest && /^[a-f0-9]{64}$/i.test(expectedDigest)
              ? Buffer.from(expectedDigest, 'hex')
              : undefined,
          });
          return checked.valid ? 'valid' : 'invalid';
        },
        openTimestamps: async (bytes, manifestHash) => {
          const checked = await openTimestampsProvider.verifyProof({ proof: bytes, manifestHash: manifestHash || '' });
          return checked.bitcoinVerified ? 'valid' : checked.pending ? 'pending' : 'invalid';
        },
        nom151: async (bytes, pdf, documentHash) => {
          const checked = await nom151Provider.verifyArtifact(bytes, pdf, documentHash);
          return checked.valid ? 'valid' : 'invalid';
        },
      },
    });
    const registrySealValid = packageRow.evidence_version === '2.1'
      ? await verifyEvidenceSealAgainstRegistry(service, parseEvidenceV2Xml(xml))
      : verification.docuboxSignature === 'valid';
    if (!registrySealValid) {
      verification.docuboxSignature = 'invalid';
      verification.overall = 'invalid';
      verification.valid = false;
      verification.errors.push('Evidence seal is not trusted by the signing key registry');
    }
    pdfBytes.fill(0);
    return response({
      packageId: packageRow.package_id,
      evidenceVersion: packageRow.evidence_version,
      document: {
        id: xmlText(xml, 'DocumentID'),
        folio: xmlText(xml, 'ExternalID'),
        sha256: packageRow.document_final_sha256,
      },
      closedAt: packageRow.closed_at,
      signatureCount: (xml.match(/<Firma\s/g) || []).length,
      status: verification.overall,
      integrity: {
        document: verification.documentIntegrity,
        xml: verification.xmlIntegrity,
        schema: verification.schema,
        evidenceChain: verification.chainIntegrity,
        docuboxSignature: verification.docuboxSignature,
        pades: verification.pades,
        efirma: verification.efirma,
      },
      certifications: {
        rfc3161: verification.certifications.rfc3161,
        openTimestamps: verification.certifications.openTimestamps,
        nom151: verification.certifications.nom151,
      },
      artifacts: (artifactsResult.data || []).map((artifact) => ({
        type: artifact.artifact_type,
        status: artifact.artifact_status,
        sha256: artifact.object_sha256,
        provider: artifact.provider,
        issuedAt: artifact.issued_at,
        validatedAt: artifact.validated_at,
      })),
      verifiedAt: new Date().toISOString(),
      errors: verification.errors,
    });
  } catch (error) {
    console.error('[evidence-v2-public] Verification failed', error instanceof Error ? error.message : 'unknown');
    return response({ error: 'No fue posible verificar el paquete de evidencia.' }, 503);
  }
}

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });
}
