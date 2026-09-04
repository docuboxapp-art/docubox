import { createPublicKey } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { requireApiUser } from '@/lib/certification/auth';
import { CertificationOrchestrator } from '@/lib/certification/orchestrator';
import { CertificationError } from '@/lib/certification/types';
import { createCertificationProviderSet } from '@/lib/certification/providers';
import { isCryptoCertificationE2eEnabled } from '@/lib/certification/feature-flags';
import { getCryptoProviderMode, isProductionCertificationEnabled } from '@/lib/certification/provider-mode';
import { getRequiredPadesLevel } from '@/lib/certification/product-integration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function padesReadiness() {
  const providers = createCertificationProviderSet();
  const [kms, x509, pades, tsa, independent] = await Promise.all([
    providers.keyManagement.healthCheck(),
    providers.certificate.healthCheck(),
    providers.pdfSignature.healthCheck(),
    providers.timestampAuthority.healthCheck(),
    providers.independentVerification.healthCheck(),
  ]);
  let protectionLevel: string | null = null;
  if (kms.ready && kms.keyId) {
    try {
      protectionLevel = (await providers.keyManagement.getKeyMetadata(kms.keyId)).protectionLevel;
    } catch {
      protectionLevel = null;
    }
  }
  const requiredLevel = getRequiredPadesLevel();
  const productionEnabled = providers.mode !== 'production' || providers.productionEnabled;
  const hsmRequired = providers.mode === 'production';
  const hsmReady = !hsmRequired || protectionLevel === 'hsm';
  const ready = requiredLevel === 'B-T'
    && productionEnabled
    && hsmReady
    && kms.ready
    && x509.ready
    && pades.ready
    && tsa.ready
    && independent.ready;
  const failureCodes = [...new Set([
    ...(requiredLevel === 'B-T' ? [] : ['PADES_REQUIRED_LEVEL_NOT_B_T']),
    ...(productionEnabled ? [] : ['PRODUCTION_CERTIFICATION_DISABLED']),
    ...(hsmReady ? [] : ['PRODUCTION_HSM_REQUIRED']),
    ...kms.missing,
    ...x509.missing,
    ...pades.missing,
    ...tsa.missing,
    ...independent.missing,
  ])];
  return {
    ready,
    requiredLevel,
    cryptoProfile: providers.mode === 'production' ? 'production-hsm' : 'development',
    kms: { ...kms, protectionLevel },
    x509,
    tsa,
    pades,
    independent,
    failureCodes,
  };
}

function errorResponse(error: unknown) {
  const failure = error instanceof CertificationError
    ? error
    : new CertificationError('CERTIFICATION_API_ERROR', error instanceof Error ? error.message : 'Error inesperado.', 500);
  return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.httpStatus });
}

async function enrichViewerEvidence(
  supabase: SupabaseClient,
  documentId: string,
  certification: Awaited<ReturnType<CertificationOrchestrator['getStatus']>> | null,
) {
  if (!certification) return null;
  const evidence = await supabase
    .from('document_certifications')
    .select('provider_metadata')
    .eq('document_id', documentId)
    .eq('certification_uuid', certification.certificationUuid)
    .maybeSingle();
  const kms = evidence.data?.provider_metadata?.kms;
  const certificate = evidence.data?.provider_metadata?.certificate;
  if (evidence.error || !kms?.document_key_id || !kms?.document_key_version) {
    return certification;
  }

  const key = await supabase
    .from('cryptographic_keys')
    .select(
      'kms_key_id,kms_key_version,algorithm,protection_level,public_key_pem,public_key_fingerprint_sha256,certificate_fingerprint_sha256,certificate_chain_status,certificate_environment',
    )
    .eq('kms_key_id', kms.document_key_id)
    .eq('kms_key_version', kms.document_key_version)
    .maybeSingle();
  if (key.error || !key.data) return certification;

  let kmsKeySizeBits: number | null = null;
  try {
    kmsKeySizeBits = createPublicKey(key.data.public_key_pem).asymmetricKeyDetails?.modulusLength || null;
  } catch {
    // An unreadable persisted public key must never produce a positive UI claim.
  }
  const publicKeyFingerprint = String(key.data.public_key_fingerprint_sha256 || '').toLowerCase();
  const certificatePublicKeyFingerprint = String(
    certificate?.public_key_fingerprint_sha256 || '',
  ).toLowerCase();
  const certificateKeyMatches = certificate?.key_matches === true
    && Boolean(publicKeyFingerprint)
    && publicKeyFingerprint === certificatePublicKeyFingerprint;
  const timestampTrustStatus = certification.padesProfile === 'PAdES-B-T'
    && certification.timestampStatus === 'valid'
    && Boolean(certification.timestampTrustBundleId)
    && Boolean(certification.timestampTrustRootFingerprintSha256)
      ? 'valid'
      : null;

  return {
    ...certification,
    kmsKeySizeBits,
    certificateKeyMatches,
    certificateChainStatus: key.data.certificate_chain_status || null,
    certificateEnvironment: key.data.certificate_environment || null,
    timestampTrustStatus,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { documentId } = await params;
    const supabase = createServiceClient();
    const orchestrator = new CertificationOrchestrator(supabase);
    const summary = await orchestrator.getStatus(documentId, user.id);
    const certification = await enrichViewerEvidence(supabase, documentId, summary);
    const hasVerifiedPades = certification?.status === 'COMPLETED'
      && certification.pdfSignatureStatus === 'valid'
      && certification.certificateStatus === 'valid'
      && certification.verificationStatus === 'valid';
    const readiness = hasVerifiedPades ? null : await padesReadiness();
    const providerStatus = hasVerifiedPades
      ? { ready: true, missing: [], checked: false }
      : {
          ready: Boolean(readiness?.ready),
          missing: readiness?.failureCodes || [],
          checked: true,
        };
    return NextResponse.json(
      {
        certification,
        providerStatus: {
          ...providerStatus,
          missing: [...new Set(providerStatus.missing)],
        },
        e2eEnabled: isCryptoCertificationE2eEnabled(),
        providerMode: getCryptoProviderMode(),
        productionEnabled: isProductionCertificationEnabled(),
        padesReadiness: readiness,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { documentId } = await params;
    if (!isCryptoCertificationE2eEnabled()) {
      throw new CertificationError(
        'CRYPTO_CERTIFICATION_E2E_DISABLED',
        'La certificacion criptografica integral esta deshabilitada en este entorno.',
        503,
      );
    }
    if (getCryptoProviderMode() === 'production' && !isProductionCertificationEnabled()) {
      throw new CertificationError(
        'PRODUCTION_CERTIFICATION_DISABLED',
        'La certificacion de produccion requiere una activacion controlada en backend.',
        503,
      );
    }
    const idempotencyKey = request.headers.get('idempotency-key') || crypto.randomUUID();
    if (idempotencyKey.length > 160) throw new CertificationError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key no es valido.', 400);
    const body = await request.json().catch(() => ({})) as { documentVersionId?: unknown };
    const documentVersionId = typeof body.documentVersionId === 'string' && body.documentVersionId.trim()
      ? body.documentVersionId.trim()
      : null;
    const certification = await new CertificationOrchestrator(createServiceClient()).execute({
      documentId,
      actorId: user.id,
      idempotencyKey,
      documentVersionId,
    });
    return NextResponse.json({ certification }, { status: certification.status === 'COMPLETED' ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
