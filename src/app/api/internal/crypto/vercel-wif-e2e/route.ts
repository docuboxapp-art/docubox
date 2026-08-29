import { constants, createHash, randomUUID, timingSafeEqual, verify } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { GoogleCloudKmsProvider } from '@/lib/certification/key-management';
import { createServiceClient } from '@/lib/supabase/server';
import { CertificationError } from '@/lib/certification/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function enabled() {
  return process.env.VERCEL_CRYPTO_E2E_ENABLED?.trim().toLowerCase() === 'true';
}

function authorized(request: NextRequest) {
  const expected = process.env.DOCUBOX_INTERNAL_CERTIFICATION_TOKEN;
  const received = request.headers.get('x-docubox-internal-token');
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
  );
}

function failureResponse(error: unknown) {
  const failure =
    error instanceof CertificationError
      ? error
      : new CertificationError(
          'VERCEL_WIF_E2E_FAILED',
          'No fue posible verificar Workload Identity Federation.',
          503
        );
  return NextResponse.json(
    {
      status: 'denied',
      code: failure.code,
      environment: process.env.VERCEL_ENV || 'unknown',
    },
    { status: failure.httpStatus, headers: { 'Cache-Control': 'no-store' } }
  );
}

function isSignatureField(field: unknown) {
  if (!field || typeof field !== 'object') return false;
  const row = field as Record<string, unknown>;
  const type = String(row.type || row.fieldType || row.tipo || '').toLowerCase();
  return type.includes('signature') || type.includes('firma');
}

async function createSafeProductCandidate(service: ReturnType<typeof createServiceClient>) {
  const sources = await service
    .from('documentos')
    .select('owner_id,workspace_id')
    .eq('estado', 'completado')
    .not('owner_id', 'is', null)
    .not('workspace_id', 'is', null)
    .order('fecha_completado', { ascending: false })
    .limit(25);
  if (sources.error) throw sources.error;

  let identity: { ownerId: string; workspaceId: string; email: string; name: string } | null = null;
  for (const source of sources.data || []) {
    const user = await service.auth.admin.getUserById(source.owner_id);
    if (!user.error && user.data.user?.email) {
      identity = {
        ownerId: source.owner_id,
        workspaceId: source.workspace_id,
        email: user.data.user.email,
        name: String(user.data.user.user_metadata?.full_name || 'Firmante E2E Docubox'),
      };
      break;
    }
  }
  if (!identity) {
    throw new CertificationError(
      'VERCEL_PRODUCT_E2E_IDENTITY_NOT_FOUND',
      'No existe una identidad productiva apta para crear el documento E2E.',
      404
    );
  }

  const documentId = randomUUID();
  const createdAt = new Date().toISOString();
  const folio = `DBX-E2E-${createdAt.slice(0, 10).replaceAll('-', '')}-${documentId.slice(0, 8).toUpperCase()}`;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Docubox - Documento E2E criptografico', {
    x: 54,
    y: 718,
    size: 20,
    font: bold,
    color: rgb(0.08, 0.12, 0.2),
  });
  page.drawText('Artefacto dedicado para validar Vercel WIF, Google Cloud HSM y PAdES-B-T.', {
    x: 54,
    y: 684,
    size: 10,
    font: regular,
    color: rgb(0.25, 0.3, 0.38),
  });
  page.drawText(`Folio: ${folio}`, { x: 54, y: 654, size: 10, font: regular });
  page.drawText(`Creado en Vercel Production: ${createdAt}`, {
    x: 54,
    y: 634,
    size: 10,
    font: regular,
  });
  page.drawRectangle({
    x: 54,
    y: 430,
    width: 504,
    height: 150,
    borderWidth: 1,
    borderColor: rgb(0.12, 0.42, 1),
  });
  page.drawText('Area de firma Click & Sign', {
    x: 70,
    y: 550,
    size: 12,
    font: bold,
    color: rgb(0.12, 0.42, 1),
  });
  const pdfBytes = new Uint8Array(await pdf.save({ useObjectStreams: false }));
  const pdfSha256 = createHash('sha256').update(pdfBytes).digest('hex');
  const storagePath = `e2e/${identity.workspaceId}/${documentId}/${pdfSha256}.pdf`;
  const upload = await service.storage
    .from('documents')
    .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: false });
  if (upload.error) throw upload.error;

  const participant = {
    id: identity.ownerId,
    user_id: identity.ownerId,
    email: identity.email,
    nombre: identity.name,
    acto: 'firmante',
    role: 'firmante',
    sub_estado: 'firmado',
  };
  const field = {
    id: `signature-${documentId}`,
    tipo: 'firma',
    label: 'Firma',
    participantId: identity.ownerId,
    participantName: identity.name,
    page: 1,
    x: 12,
    y: 30,
    width: 76,
    height: 20,
  };
  const inserted = await service
    .from('documentos')
    .insert({
      id: documentId,
      documento_id: folio,
      owner_id: identity.ownerId,
      workspace_id: identity.workspaceId,
      nombre: 'Prueba E2E Vercel WIF HSM PAdES-B-T',
      descripcion: 'Documento tecnico aislado creado por el arnes E2E productivo.',
      otro_tipo_documento: 'Prueba E2E',
      file_name: `${folio}.pdf`,
      file_size: pdfBytes.byteLength,
      file_type: 'application/pdf',
      file_hash_sha256: pdfSha256,
      storage_path: storagePath,
      estado: 'completado',
      fecha_completado: createdAt,
      participantes: [participant],
      campos_solicitados: [field],
      participation_order: 'paralelo',
      participant_mode: 'solo_yo',
      es_publico: false,
    })
    .select('id,owner_id,workspace_id,nombre,campos_solicitados,file_type')
    .single();
  if (inserted.error || !inserted.data) {
    await service.storage.from('documents').remove([storagePath]);
    throw inserted.error || new Error('VERCEL_PRODUCT_E2E_DOCUMENT_INSERT_FAILED');
  }
  const response = await service.from('participation_responses').insert({
    documento_id: documentId,
    participante_email: identity.email,
    participante_nombre: identity.name,
    participante_id: identity.ownerId,
    tipo_participacion: 'firmante',
    terminos_aceptados: true,
    terminos_aceptados_at: createdAt,
    firma_completada: true,
    firma_completada_at: createdAt,
    signature_method: 'clicksign',
    signature_stamp_style: 'CC1',
    signature_hash: createHash('sha256')
      .update(`DOCUBOX_E2E_CLICK_SIGN:${documentId}:${identity.ownerId}:${createdAt}`)
      .digest('hex'),
    signature_ip: 'vercel-production-e2e',
    signature_metadata: {
      e2e: true,
      assurance_level: 'test',
      verification_url: 'https://docubox-delta.vercel.app/verificar-documento',
    },
  });
  if (response.error) {
    await service.from('documentos').delete().eq('id', documentId);
    await service.storage.from('documents').remove([storagePath]);
    throw response.error;
  }
  return { service, document: inserted.data, ownerEmail: identity.email };
}

async function findSafeProductCandidate() {
  const service = createServiceClient();
  const result = await service
    .from('documentos')
    .select('id,owner_id,workspace_id,nombre,campos_solicitados,file_type')
    .eq('estado', 'completado')
    .is('deleted_at', null)
    .or('nombre.ilike.%prueba%,nombre.ilike.%test%,nombre.ilike.%demo%')
    .order('fecha_completado', { ascending: false })
    .limit(25);
  if (result.error) throw result.error;

  for (const document of result.data || []) {
    if (
      !document.owner_id ||
      !document.workspace_id ||
      document.file_type !== 'application/pdf' ||
      !(document.campos_solicitados || []).some(isSignatureField)
    ) {
      continue;
    }
    const [responses, verified, user] = await Promise.all([
      service
        .from('participation_responses')
        .select('id', { count: 'exact', head: true })
        .eq('documento_id', document.id)
        .eq('firma_completada', true),
      service
        .from('document_certifications')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', document.id)
        .eq('status', 'COMPLETED')
        .eq('pdf_signature_status', 'valid'),
      service.auth.admin.getUserById(document.owner_id),
    ]);
    if (
      !responses.error &&
      (responses.count || 0) > 0 &&
      !verified.error &&
      verified.count === 0 &&
      !user.error &&
      user.data.user?.email
    ) {
      return { service, document, ownerEmail: user.data.user.email };
    }
  }
  return createSafeProductCandidate(service);
}

async function runProductE2e(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'production') {
    throw new CertificationError(
      'VERCEL_PRODUCTION_REQUIRED',
      'El E2E criptografico de producto solo puede ejecutarse en Production.',
      403
    );
  }
  const { service, document, ownerEmail } = await findSafeProductCandidate();
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email: ownerEmail });
  const tokenHash = link.data.properties?.hashed_token;
  if (link.error || !tokenHash) {
    throw new CertificationError(
      'VERCEL_PRODUCT_E2E_AUTH_FAILED',
      'No fue posible crear la sesion autenticada de prueba.',
      503
    );
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new CertificationError(
      'VERCEL_PRODUCT_E2E_AUTH_CONFIG_MISSING',
      'La autenticacion Supabase no esta configurada.',
      503
    );
  }
  const auth = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verifiedOtp = await auth.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  const accessToken = verifiedOtp.data.session?.access_token;
  if (verifiedOtp.error || !accessToken) {
    throw new CertificationError(
      'VERCEL_PRODUCT_E2E_AUTH_FAILED',
      'No fue posible verificar la sesion autenticada de prueba.',
      503
    );
  }

  const sealResponse = await fetch(
    new URL(`/api/documentos/${document.id}/seal-signatures`, request.nextUrl.origin),
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    }
  );
  const seal = (await sealResponse.json()) as Record<string, unknown>;
  if (!sealResponse.ok || seal.ok !== true || seal.pades_verified !== true) {
    throw new CertificationError(
      String(seal.code || 'VERCEL_PRODUCT_E2E_SEAL_FAILED'),
      String(seal.error || 'El documento real no completo el cierre PAdES.'),
      sealResponse.status >= 400 ? sealResponse.status : 503
    );
  }
  const certificationUuid = String(seal.certification_uuid || '');
  const certificationResult = await service
    .from('document_certifications')
    .select(
      'id,certification_uuid,status,execution_status,pades_profile,integrity_status,pdf_signature_status,certificate_status,timestamp_status,verification_status,pades_signature_algorithm,pades_digest_algorithm,pades_certificate_fingerprint_sha256,pades_verified_at,provider_metadata,certified_pdf_path,certified_pdf_sha256'
    )
    .eq('certification_uuid', certificationUuid)
    .maybeSingle();
  if (certificationResult.error || !certificationResult.data) {
    throw new CertificationError(
      'VERCEL_PRODUCT_E2E_EVIDENCE_MISSING',
      'No se encontro la evidencia criptografica persistida.',
      503
    );
  }
  const certification = certificationResult.data;
  const timestampResult = await service
    .from('timestamp_records')
    .select(
      'status,tsa_name,tsa_provider_role,tsa_policy_oid,tsa_serial_number,gen_time,trust_bundle_id,fallback_used'
    )
    .eq('document_certification_id', certification.id)
    .maybeSingle();
  const timestamp = timestampResult.data;
  const metadata = (certification.provider_metadata || {}) as Record<string, unknown>;
  const kms = (metadata.kms || {}) as Record<string, unknown>;
  const certificate = (metadata.certificate || {}) as Record<string, unknown>;
  const pades = (metadata.pades || {}) as Record<string, unknown>;
  const verification = (pades.verification_result || {}) as Record<string, unknown>;
  const primary = (verification.primary || {}) as Record<string, unknown>;
  const independent = (verification.independent || {}) as Record<string, unknown>;
  const valid =
    certification.status === 'COMPLETED' &&
    certification.execution_status === 'completed' &&
    certification.pades_profile === 'PAdES-B-T' &&
    certification.integrity_status === 'valid' &&
    certification.pdf_signature_status === 'valid' &&
    certification.certificate_status === 'valid' &&
    certification.timestamp_status === 'valid' &&
    certification.verification_status === 'valid' &&
    metadata.environment === 'production' &&
    kms.provider === 'gcp' &&
    String(kms.protection_level).toLowerCase() === 'hsm' &&
    certificate.key_matches === true &&
    primary.valid === true &&
    independent.valid === true &&
    timestamp?.status === 'VALID' &&
    ['freetsa', 'open-tsa'].includes(String(timestamp.tsa_name || '').toLowerCase());
  if (!valid) {
    throw new CertificationError(
      'VERCEL_PRODUCT_E2E_EVIDENCE_INVALID',
      'La evidencia persistida no acredita PAdES-B-T productivo completo.',
      503
    );
  }

  return NextResponse.json(
    {
      status: 'verified',
      marker: 'VERCEL PRODUCTION CRYPTO E2E VERIFIED',
      documentId: document.id,
      certificationUuid,
      padesProfile: certification.pades_profile,
      integrityStatus: certification.integrity_status,
      certificateStatus: certification.certificate_status,
      timestampStatus: certification.timestamp_status,
      verificationStatus: certification.verification_status,
      signatureAlgorithm: certification.pades_signature_algorithm,
      digestAlgorithm: certification.pades_digest_algorithm,
      kmsProvider: kms.provider,
      kmsProtectionLevel: kms.protection_level,
      kmsKeyVersion: kms.document_key_version,
      certificateKeyMatches: certificate.key_matches,
      primaryVerification: primary.valid,
      independentVerification: independent.valid,
      tsaProvider: timestamp?.tsa_name,
      tsaProviderRole: timestamp?.tsa_provider_role,
      tsaPolicyOid: timestamp?.tsa_policy_oid,
      tsaGenTime: timestamp?.gen_time,
      tsaTrustBundleId: timestamp?.trust_bundle_id,
      tsaFallbackUsed: timestamp?.fallback_used,
      nom151: 'NOM151_PROVIDER_NOT_PRODUCTION',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!enabled()) {
      throw new CertificationError('VERCEL_CRYPTO_E2E_DISABLED', 'Prueba E2E deshabilitada.', 404);
    }
    if (!authorized(request)) {
      throw new CertificationError(
        'INTERNAL_AUTH_REQUIRED',
        'Operacion interna no autorizada.',
        401
      );
    }
    if (process.env.VERCEL !== '1') {
      throw new CertificationError(
        'VERCEL_RUNTIME_REQUIRED',
        'Esta prueba solo puede ejecutarse dentro de Vercel.',
        403
      );
    }
    if (process.env.GCP_AUTH_MODE !== 'workload_identity') {
      throw new CertificationError(
        'GCP_WORKLOAD_IDENTITY_REQUIRED',
        'La prueba no permite fallback a ADC.',
        503
      );
    }

    const requestBody = (await request.json().catch(() => ({}))) as { operation?: unknown };
    if (requestBody.operation === 'product') return await runProductE2e(request);

    const provider = GoogleCloudKmsProvider.fromEnvironment('production');
    const keyId = process.env.GOOGLE_KMS_PRODUCTION_KEY_NAME || '';
    const metadata = await provider.getKeyMetadata(keyId);
    const payload = Buffer.from(
      `DOCUBOX_VERCEL_GCP_WIF_E2E_V1:${process.env.VERCEL_ENV || 'unknown'}`,
      'utf8'
    );
    const signature = await provider.signDigest({
      purpose: 'DOCUMENT_SEAL',
      canonicalBytes: payload,
      digestSha256: createHash('sha256').update(payload).digest('hex'),
      idempotencyKey: `vercel-wif-${process.env.VERCEL_DEPLOYMENT_ID || 'deployment'}`,
    });
    const verified = verify(
      'sha256',
      payload,
      { key: signature.publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(signature.signatureBase64, 'base64')
    );
    if (!verified || metadata.protectionLevel !== 'hsm') {
      throw new CertificationError(
        'VERCEL_WIF_HSM_VERIFICATION_FAILED',
        'La firma HSM no supero la verificacion independiente.',
        503
      );
    }

    return NextResponse.json(
      {
        status: 'verified',
        marker: 'VERCEL PRODUCTION GCP WIF VERIFIED',
        environment: process.env.VERCEL_ENV,
        authMode: 'workload_identity',
        provider: metadata.provider,
        protectionLevel: metadata.protectionLevel,
        algorithm: metadata.algorithm,
        keyVersion: metadata.keyVersion,
        publicKeyFingerprintSha256: signature.publicKeyFingerprintSha256,
        signatureSha256: signature.signatureSha256,
        cryptoVerify: true,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return failureResponse(error);
  }
}
