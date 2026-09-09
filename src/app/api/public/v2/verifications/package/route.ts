import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { enforcePublicRateLimit } from '@/lib/public-verification/gateway';
import { verifyEvidenceV2Package } from '@/lib/evidence-v2/verifier';
import { createCertificationProviderSet } from '@/lib/certification/providers';
import { createOpenTimestampProvider } from '@/lib/blockchain-evidence/provider';
import { createNom151Provider } from '@/lib/nom151/provider';

export const runtime = 'nodejs';

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const ARTIFACT_TYPES = new Set([
  'pades_pdf',
  'rfc3161_token',
  'opentimestamps_proof',
  'nom151_constancia',
  'efirma_signature_bundle',
  'autograph_signature_image',
  'autograph_signature_strokes',
]);

function safePackagePath(path: string) {
  return (
    path.startsWith('artifacts/') &&
    !path.includes('..') &&
    !path.includes('\\') &&
    !path.startsWith('/')
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!(await enforcePublicRateLimit(request, 'EVIDENCE_V2_UPLOAD', 12))) {
      return response({ error: 'Demasiadas verificaciones. Intenta más tarde.' }, 429);
    }
  } catch {
    return response({ error: 'El servicio de verificación no está disponible temporalmente.' }, 503);
  }
  try {
    const form = await request.formData();
    const uploadedPackage = form.get('package');
    let xml = '';
    let pdfBytes = new Uint8Array();
    let artifacts: Array<{ type: string; bytes: Uint8Array; expectedSha256: string; metadata?: Record<string, unknown> }> = [];
    if (uploadedPackage instanceof File) {
      if (uploadedPackage.size > MAX_PACKAGE_BYTES) return response({ error: 'El paquete excede el límite permitido.' }, 413);
      const zip = await JSZip.loadAsync(await uploadedPackage.arrayBuffer());
      const xmlEntry = zip.file('evidence.xml');
      const manifestEntry = zip.file('manifest.json');
      if (!xmlEntry || !manifestEntry) return response({ error: 'El ZIP no contiene evidence.xml y manifest.json.' }, 400);
      xml = await xmlEntry.async('string');
      if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) return response({ error: 'El XML excede el límite permitido.' }, 413);
      const manifestText = await manifestEntry.async('string');
      if (Buffer.byteLength(manifestText, 'utf8') > MAX_MANIFEST_BYTES) return response({ error: 'El manifiesto excede el límite permitido.' }, 413);
      const manifest = JSON.parse(manifestText) as {
        artifacts?: Array<{ type: string; sha256: string; file: string; metadata?: Record<string, unknown> }>;
      };
      let expandedBytes = Buffer.byteLength(xml, 'utf8');
      const referencedFiles = new Set<string>();
      for (const item of manifest.artifacts || []) {
        if (!ARTIFACT_TYPES.has(item.type) || !safePackagePath(item.file)
          || !/^[a-f0-9]{64}$/i.test(item.sha256 || '') || referencedFiles.has(item.file)) {
          return response({ error: 'El manifiesto contiene una referencia no válida.' }, 400);
        }
        referencedFiles.add(item.file);
        const entry = zip.file(item.file);
        if (!entry) throw new Error(`PACKAGE_ARTIFACT_MISSING:${item.type}`);
        const bytes = await entry.async('uint8array');
        expandedBytes += bytes.byteLength;
        if (expandedBytes > MAX_EXPANDED_BYTES) return response({ error: 'El contenido expandido excede el límite permitido.' }, 413);
        if (item.type === 'pades_pdf') {
          if (bytes.byteLength > MAX_PDF_BYTES) return response({ error: 'El PDF excede el límite permitido.' }, 413);
          pdfBytes = new Uint8Array(bytes);
        }
        else artifacts.push({ type: item.type, bytes, expectedSha256: item.sha256, metadata: item.metadata });
      }
      if (!pdfBytes.byteLength) return response({ error: 'El paquete no contiene el PDF final PAdES.' }, 400);
    } else {
      const pdf = form.get('pdf');
      const evidence = form.get('evidence');
      if (!(pdf instanceof File) || !(evidence instanceof File)) {
        return response({ error: 'Adjunta el paquete ZIP o el PDF final y el XML v2.' }, 400);
      }
      if (pdf.size > MAX_PDF_BYTES || evidence.size > MAX_XML_BYTES) {
        return response({ error: 'Uno de los archivos excede el límite permitido.' }, 413);
      }
      xml = await evidence.text();
      pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    }
    const providers = createCertificationProviderSet();
    const pades = providers.independentVerification;
    const timestampAuthority = providers.timestampAuthority;
    const openTimestamps = createOpenTimestampProvider();
    const nom151 = createNom151Provider();
    const verification = await verifyEvidenceV2Package({
      xml,
      pdfBytes,
      artifacts,
      padesVerifier: (bytes) => pades.verifyPdf({ pdfBytes: bytes }),
      externalVerifiers: {
        rfc3161: async (bytes, expectedDigest) => {
          const checked = await timestampAuthority.verifyTimestamp(bytes, {
            expectedDigest: expectedDigest && /^[a-f0-9]{64}$/i.test(expectedDigest)
              ? Buffer.from(expectedDigest, 'hex')
              : undefined,
          });
          return checked.valid ? 'valid' : 'invalid';
        },
        openTimestamps: async (bytes, manifestHash) => {
          const checked = await openTimestamps.verifyProof({ proof: bytes, manifestHash: manifestHash || '' });
          return checked.bitcoinVerified ? 'valid' : checked.pending ? 'pending' : 'invalid';
        },
        nom151: async (bytes, pdf, documentHash) => {
          const checked = await nom151.verifyArtifact(bytes, pdf, documentHash);
          return checked.valid ? 'valid' : 'invalid';
        },
      },
    });
    pdfBytes.fill(0);
    return response({
      evidenceVersion: '2.0',
      status: verification.overall,
      valid: verification.valid,
      integrity: {
        document: verification.documentIntegrity,
        xml: verification.xmlIntegrity,
        schema: verification.schema,
        evidenceChain: verification.chainIntegrity,
        docuboxSignature: verification.docuboxSignature,
        pades: verification.pades,
        efirma: verification.efirma,
      },
      certifications: verification.certifications,
      verifiedAt: new Date().toISOString(),
      errors: verification.errors,
    });
  } catch {
    return response({ error: 'No fue posible procesar los archivos.' }, 400);
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
