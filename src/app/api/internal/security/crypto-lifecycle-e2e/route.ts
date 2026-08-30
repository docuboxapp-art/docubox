import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { NextRequest, NextResponse } from 'next/server';
import { buildAuditClosureCertificate } from '@/lib/documents/audit-closure-certificate';
import { buildGeneralSignatureCertificate } from '@/lib/documents/general-signature-certificate';
import { createNom151Certificate } from '@/lib/documents/nom151-certificate';
import { integratePadesFinalDocument } from '@/lib/certification/product-integration';
import { issueNom151ForVerifiedPadesBt, type IssueNom151Result } from '@/lib/nom151/service';
import { createNom151Provider } from '@/lib/nom151/provider';
import { requireApiUser } from '@/lib/certification/auth';
import { createServiceClient } from '@/lib/supabase/server';
import {
  getRequestCookieUser,
  lifecycleRunnerEnabled,
  requireCryptoLifecycleE2EAccess,
} from '@/lib/security/crypto-lifecycle-e2e-access';
import {
  encryptAndUploadDocumentObject,
  readDocumentStorageObject,
} from '@/lib/crypto/document-encryption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOCUMENT_BUCKET = 'documents';
const CERTIFICATION_BUCKET = 'certification-artifacts';
const MAX_BODY_BYTES = 4096;
const MIN_RETRY_INTERVAL_MS = 30_000;

let activeRun = false;
const lastRunByUser = new Map<string, number>();

class LifecycleE2eError extends Error {
  constructor(
    readonly code: string,
    message = code
  ) {
    super(message);
    this.name = 'LifecycleE2eError';
  }
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function publicOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const requestOrigin = new URL(request.url).origin;
  const allowed = new Set([requestOrigin]);
  if (configured) {
    try {
      allowed.add(new URL(configured).origin);
    } catch {
      return null;
    }
  }
  return allowed;
}

function passesSameOrigin(request: NextRequest) {
  const allowed = publicOrigin(request);
  const origin = request.headers.get('origin');
  if (!allowed || !origin || !allowed.has(origin)) return false;
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      if (!allowed.has(new URL(referer).origin)) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'same-site';
}

async function requireLifecycleOperator(
  user: Awaited<ReturnType<typeof requireApiUser>>,
  service: ReturnType<typeof createServiceClient>
) {
  const access = await requireCryptoLifecycleE2EAccess(user, service);
  if (!access.allowed) throw new LifecycleE2eError(access.reason);
  return access.workspaceId;
}

async function createArtificialPdf(runId: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Docubox cryptographic lifecycle E2E ${runId}`);
  pdf.setAuthor('Docubox internal security runner');
  pdf.setSubject('Temporary production lifecycle verification artifact');
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Docubox - cryptographic lifecycle E2E', {
    x: 48,
    y: 720,
    size: 18,
    font,
    color: rgb(0.08, 0.25, 0.55),
  });
  page.drawText(`Run ID: ${runId}`, { x: 48, y: 684, size: 10, font });
  page.drawText('Temporary server-generated verification document.', {
    x: 48,
    y: 660,
    size: 10,
    font,
  });
  page.drawText('This artifact contains no customer content.', { x: 48, y: 642, size: 10, font });
  return pdf.save();
}

async function audit(
  service: ReturnType<typeof createServiceClient>,
  input: {
    workspaceId: string;
    actorId: string;
    runId: string;
    eventType: string;
    resourceId?: string | null;
    summary: string;
    outcome: 'started' | 'completed' | 'failed';
    payload: Record<string, unknown>;
  }
) {
  const result = await service.from('organization_audit_events').insert({
    workspace_id: input.workspaceId,
    actor_user_id: input.actorId,
    event_type: input.eventType,
    resource_type: 'crypto_lifecycle_e2e',
    resource_id: input.resourceId || input.runId,
    summary: input.summary,
    payload: input.payload,
    outcome: input.outcome,
    severity: input.outcome === 'failed' ? 'high' : 'info',
    module: 'crypto',
    correlation_id: input.runId,
    origin: 'internal-security-runner',
  });
  if (result.error) throw new LifecycleE2eError('CRYPTO_LIFECYCLE_E2E_AUDIT_FAILED');
}

async function encryptedArtifact(
  service: ReturnType<typeof createServiceClient>,
  input: {
    bytes: Uint8Array;
    tenantId: string;
    documentId: string;
    documentVersionId: string;
    artifactKind: Parameters<typeof encryptAndUploadDocumentObject>[0]['artifactKind'];
    bucket: string;
    path: string;
    actorId: string;
    requestId: string;
    mimeType: string;
  }
) {
  const result = await encryptAndUploadDocumentObject({
    service,
    plaintext: input.bytes,
    tenantId: input.tenantId,
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    artifactKind: input.artifactKind,
    storageBucket: input.bucket,
    storagePath: input.path,
    originalFileName: path.basename(input.path),
    originalMimeType: input.mimeType,
    userId: input.actorId,
    requestId: input.requestId,
  });
  const direct = await service.storage.from(input.bucket).download(input.path);
  if (direct.error || !direct.data)
    throw new LifecycleE2eError('CRYPTO_LIFECYCLE_E2E_CIPHERTEXT_MISSING');
  const directBytes = new Uint8Array(await direct.data.arrayBuffer());
  if (
    directBytes.byteLength >= 5 &&
    Buffer.from(directBytes.subarray(0, 5)).toString('ascii') === '%PDF-'
  ) {
    throw new LifecycleE2eError('CRYPTO_LIFECYCLE_E2E_PLAINTEXT_STORAGE');
  }
  const decrypted = await readDocumentStorageObject({
    service,
    storageBucket: input.bucket,
    storagePath: input.path,
    expectedPlaintextSha256: sha256(input.bytes),
    userId: input.actorId,
    requestId: input.requestId,
  });
  const matches = Buffer.from(decrypted.plaintext).equals(Buffer.from(input.bytes));
  decrypted.plaintext.fill(0);
  if (!matches) throw new LifecycleE2eError('CRYPTO_LIFECYCLE_E2E_DECRYPT_MISMATCH');
  return {
    path: input.path,
    plaintextSha256: sha256(input.bytes),
    ciphertextSha256: result.metadata.ciphertext_sha256,
  };
}

async function runLifecycle(
  service: ReturnType<typeof createServiceClient>,
  user: Awaited<ReturnType<typeof requireApiUser>>,
  workspaceId: string,
  runId: string
) {
  const startedAt = new Date().toISOString();
  const visualPdf = await createArtificialPdf(runId);
  const visualHash = sha256(visualPdf);
  const documentId = randomUUID();
  const initialVersionId = randomUUID();
  const initialPath = `tenants/${workspaceId}/documents/${documentId}/versions/${initialVersionId}/source.enc`;
  const folio = `E2E-${runId.slice(0, 12).toUpperCase()}`;

  const document = await service
    .from('documentos')
    .insert({
      id: documentId,
      documento_id: folio,
      owner_id: user.id,
      workspace_id: workspaceId,
      file_name: `${folio}.pdf`,
      file_size: visualPdf.byteLength,
      file_type: 'application/pdf',
      file_hash_sha256: visualHash,
      nombre: `E2E ciclo criptográfico ${runId.slice(0, 8)}`,
      descripcion: 'Artefacto temporal generado por el runner interno de seguridad.',
      estado: 'completado',
      fecha_completado: startedAt,
      participantes: [],
      campos_solicitados: [],
      ultimo_paso: 4,
    })
    .select('id')
    .single();
  if (document.error || !document.data)
    throw new LifecycleE2eError('CRYPTO_LIFECYCLE_E2E_DOCUMENT_CREATE_FAILED');

  const version = await service
    .from('document_versions')
    .insert({
      id: initialVersionId,
      workspace_id: workspaceId,
      document_id: documentId,
      version_number: 1,
      status: 'approved',
      storage_path: initialPath,
      mime_type: 'application/pdf',
      byte_size: visualPdf.byteLength,
      sha256: visualHash,
      change_reason: 'E2E interno: documento fuente generado en backend',
      created_by: user.id,
      frozen_at: startedAt,
      metadata: { source: 'crypto_lifecycle_e2e', storage_bucket: DOCUMENT_BUCKET },
    })
    .select('id')
    .single();
  if (version.error || !version.data)
    throw new LifecycleE2eError('CRYPTO_LIFECYCLE_E2E_VERSION_CREATE_FAILED');

  await encryptedArtifact(service, {
    bytes: visualPdf,
    tenantId: workspaceId,
    documentId,
    documentVersionId: initialVersionId,
    artifactKind: 'document',
    bucket: DOCUMENT_BUCKET,
    path: initialPath,
    actorId: user.id,
    requestId: runId,
    mimeType: 'application/pdf',
  });

  const pades = await integratePadesFinalDocument(service, {
    documentId,
    documentOwnerId: user.id,
    workspaceId,
    triggeredBy: user.id,
    visualPdfBytes: visualPdf,
    visualPdfSha256: visualHash,
    completedAt: startedAt,
    signaturesApplied: 0,
    requiredLevel: 'B-T',
  });
  if (pades.profile !== 'PAdES-B-T' || !pades.timestamp)
    throw new LifecycleE2eError('CRYPTO_LIFECYCLE_E2E_PADES_NOT_VERIFIED');

  const nom151 = await issueNom151ForVerifiedPadesBt(
    service,
    { documentId, requestedBy: user.id },
    createNom151Provider()
  );
  if (nom151.verificationStatus !== 'verified')
    throw new LifecycleE2eError('CRYPTO_LIFECYCLE_E2E_NOM151_NOT_VERIFIED');

  const certification = await service
    .from('document_certifications')
    .select(
      'id,document_version_id,certification_uuid,certified_pdf_sha256,pades_profile,pades_signature_algorithm,pades_digest_algorithm,pades_certificate_serial,pades_certificate_fingerprint_sha256,pades_signing_time_declared,pades_verification_result,provider_metadata'
    )
    .eq('document_id', documentId)
    .eq('document_version_id', pades.documentVersionId)
    .maybeSingle();
  if (certification.error || !certification.data)
    throw new LifecycleE2eError('CRYPTO_LIFECYCLE_E2E_CERTIFICATION_READ_FAILED');
  const cert = certification.data as {
    certification_uuid: string;
    provider_metadata: { kms?: { provider?: string } } | null;
  };
  const nom: IssueNom151Result = nom151;
  const timestamp = pades.timestamp;
  const logoBytes = await readFile(
    path.join(process.cwd(), 'public/assets/images/docubox-logo-2026.png')
  ).catch(() => undefined);
  const now = new Date().toISOString();
  const auditPdf = await buildAuditClosureCertificate({
    documentId,
    documentFolio: folio,
    title: `E2E ciclo criptográfico ${runId.slice(0, 8)}`,
    workspaceName: workspaceId,
    status: 'COMPLETADO',
    createdAt: startedAt,
    completedAt: startedAt,
    originalHash: visualHash,
    finalHash: pades.sha256,
    auditChainHash: 'No aplica al runner interno',
    verificationUrl: `${process.env.NEXT_PUBLIC_SITE_URL || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://docubox.mx').origin}/verificar-documento?folio=${encodeURIComponent(folio)}`,
    events: [
      {
        occurredAt: startedAt,
        action: 'documento_creado',
        description: 'Documento E2E creado',
        actor: 'Docubox',
        result: 'exitoso',
        source: 'crypto_lifecycle_e2e',
      },
      {
        occurredAt: now,
        action: 'documento_completado',
        description: 'Documento E2E completado y certificado',
        actor: 'Docubox',
        result: 'exitoso',
        source: 'crypto_lifecycle_e2e',
      },
    ],
  });
  const generalPdf = await buildGeneralSignatureCertificate({
    folio,
    documentId,
    title: `E2E ciclo criptográfico ${runId.slice(0, 8)}`,
    workspaceName: workspaceId,
    originalHash: visualHash,
    finalHash: pades.sha256,
    evidenceHash: pades.sha256,
    createdAt: startedAt,
    completedAt: now,
    workflowMode: 'No aplica',
    participants: [],
    certificateId: cert.certification_uuid,
    verificationUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://docubox.mx'}/verificar-documento?folio=${encodeURIComponent(folio)}`,
    timestamp: {
      status: 'Válido',
      provider: timestamp.provider,
      identifier: timestamp.serialNumber,
      occurredAt: timestamp.genTime,
    },
    nom151: {
      status: 'Verificada',
      provider: nom.provider,
      identifier: nom.folio,
      occurredAt: now,
    },
    certification: {
      status: 'Verificada',
      provider: cert.provider_metadata?.kms?.provider || 'gcp',
      identifier: cert.certification_uuid,
      occurredAt: now,
    },
    events: [{ label: 'Ciclo criptográfico E2E completado', occurredAt: now, actor: 'Docubox' }],
  });
  const nom151Pdf = await createNom151Certificate({
    logoBytes,
    validationCode: String(nom.operationId),
    issuedAt: now,
    status: 'Verificada',
    documentName: `E2E ciclo criptográfico ${runId.slice(0, 8)}`,
    documentId,
    folio,
    documentStatus: 'completado',
    documentHash: pades.sha256,
    documentSize: `${visualPdf.byteLength} bytes`,
    provider: String(nom.pscName || nom.provider),
    endpoint: 'Integración backend Docubox con Nubarium',
    signers: [],
    providerStatus: 'OK',
    messageKey: '0 (éxito)',
    providerHash: String(nom.documentDigest),
    asn1Hash: String(nom.artifactSha256),
    standard: 'NOM-151-SCFI-2016',
    certificateType: 'Conservación de mensajes de datos (.asn1)',
    algorithm: 'SHA-256',
    verificationUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://docubox.mx'}/verificar-documento?folio=${encodeURIComponent(folio)}`,
    pscUrl: 'https://validatuconstancia.pscworld.com/',
    representationNotice: 'Representación informativa del artefacto original emitido por el PSC.',
  });

  const constancias = await Promise.all([
    encryptedArtifact(service, {
      bytes: auditPdf,
      tenantId: workspaceId,
      documentId,
      documentVersionId: pades.documentVersionId,
      artifactKind: 'evidence',
      bucket: CERTIFICATION_BUCKET,
      path: `crypto-lifecycle-e2e/${runId}/constancia-auditoria.pdf.enc`,
      actorId: user.id,
      requestId: `${runId}:audit`,
      mimeType: 'application/pdf',
    }),
    encryptedArtifact(service, {
      bytes: generalPdf,
      tenantId: workspaceId,
      documentId,
      documentVersionId: pades.documentVersionId,
      artifactKind: 'evidence',
      bucket: CERTIFICATION_BUCKET,
      path: `crypto-lifecycle-e2e/${runId}/constancia-general.pdf.enc`,
      actorId: user.id,
      requestId: `${runId}:general`,
      mimeType: 'application/pdf',
    }),
    encryptedArtifact(service, {
      bytes: nom151Pdf,
      tenantId: workspaceId,
      documentId,
      documentVersionId: pades.documentVersionId,
      artifactKind: 'evidence',
      bucket: CERTIFICATION_BUCKET,
      path: `crypto-lifecycle-e2e/${runId}/constancia-nom151.pdf.enc`,
      actorId: user.id,
      requestId: `${runId}:nom151-pdf`,
      mimeType: 'application/pdf',
    }),
  ]);

  const finalPdf = await encryptedArtifact(service, {
    bytes: await (async () => {
      const result = await readDocumentStorageObject({
        service,
        storageBucket: DOCUMENT_BUCKET,
        storagePath: pades.storagePath,
        expectedPlaintextSha256: pades.sha256,
        userId: user.id,
        requestId: `${runId}:final-download`,
      });
      return new Uint8Array(result.plaintext);
    })(),
    tenantId: workspaceId,
    documentId,
    documentVersionId: pades.documentVersionId,
    artifactKind: 'signed_pdf',
    bucket: DOCUMENT_BUCKET,
    path: pades.storagePath,
    actorId: user.id,
    requestId: `${runId}:final-pdf`,
    mimeType: 'application/pdf',
  });
  return {
    status: 'PRODUCTION_VERIFIED',
    runId,
    document: {
      id: documentId,
      folio,
      versionId: pades.documentVersionId,
      visualSha256: visualHash,
      finalSha256: pades.sha256,
      finalEncrypted: true,
      finalPath: pades.storagePath,
      finalArtifact: finalPdf,
    },
    pades: {
      profile: pades.profile,
      status: 'verified',
      certificateFingerprintSha256: pades.certificateFingerprintSha256,
      timestamp: {
        provider: timestamp.provider,
        policyOid: timestamp.policyOid,
        serialNumber: timestamp.serialNumber,
        genTime: timestamp.genTime,
        tokenSha256: timestamp.tokenSha256,
        status: 'verified',
      },
    },
    nom151: {
      status: 'verified',
      provider: nom.provider,
      folio: nom.folio,
      artifactSha256: nom.artifactSha256,
      productionTrusted: nom.productionTrusted,
    },
    constancias: constancias.map((item) => ({
      path: item.path,
      plaintextSha256: item.plaintextSha256,
      encrypted: true,
    })),
    failClosed: true,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

export async function GET() {
  return NextResponse.json(
    { error: 'Método no permitido.' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

export async function POST(request: NextRequest) {
  if (!lifecycleRunnerEnabled())
    return NextResponse.json({ error: 'Runner deshabilitado.' }, { status: 404 });
  if (!passesSameOrigin(request))
    return NextResponse.json({ error: 'Origen no autorizado.' }, { status: 403 });
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES)
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 413 });
  const body = (await request.text()).trim();
  if (body && body !== '{}')
    return NextResponse.json({ error: 'El runner no acepta parámetros.' }, { status: 400 });
  if (activeRun)
    return NextResponse.json({ error: 'Ya existe una ejecución en curso.' }, { status: 429 });

  let user: Awaited<ReturnType<typeof requireApiUser>>;
  try {
    const candidate = request.headers.get('authorization')
      ? await requireApiUser(request)
      : await getRequestCookieUser(request);
    if (!candidate) throw new Error('AUTH_REQUIRED');
    user = candidate;
  } catch {
    return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  }
  const lastRun = lastRunByUser.get(user.id) || 0;
  if (Date.now() - lastRun < MIN_RETRY_INTERVAL_MS)
    return NextResponse.json({ error: 'Reintento demasiado pronto.' }, { status: 429 });

  const service = createServiceClient();
  let workspaceId: string;
  try {
    workspaceId = await requireLifecycleOperator(user, service);
  } catch (error) {
    const code =
      error instanceof LifecycleE2eError ? error.code : 'CRYPTO_LIFECYCLE_E2E_OPERATOR_NOT_ALLOWED';
    if (code === 'CRYPTO_LIFECYCLE_E2E_DISABLED') {
      return NextResponse.json({ error: 'Runner deshabilitado.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Operador no autorizado.', code }, { status: 403 });
  }

  const runId = randomUUID();
  activeRun = true;
  lastRunByUser.set(user.id, Date.now());
  try {
    await audit(service, {
      workspaceId,
      actorId: user.id,
      runId,
      eventType: 'CRYPTO_LIFECYCLE_E2E_MANUAL_TRIGGERED',
      summary: 'Ejecución E2E disparada desde la consola administrativa temporal',
      outcome: 'started',
      payload: { run_id: runId, source: 'admin-ui', result: 'started' },
    });
    await audit(service, {
      workspaceId,
      actorId: user.id,
      runId,
      eventType: 'CRYPTO_LIFECYCLE_E2E_STARTED',
      summary: 'Inicio de ciclo criptográfico E2E productivo',
      outcome: 'started',
      payload: { run_id: runId, runner: 'backend-only', provider_parameters: false },
    });
    const result = await runLifecycle(service, user, workspaceId, runId);
    await audit(service, {
      workspaceId,
      actorId: user.id,
      runId,
      eventType: 'CRYPTO_LIFECYCLE_E2E_COMPLETED',
      resourceId: result.document.id,
      summary: 'Ciclo criptográfico E2E productivo completado',
      outcome: 'completed',
      payload: {
        run_id: runId,
        document_id: result.document.id,
        pades: result.pades.status,
        nom151: result.nom151.status,
        constancias: result.constancias.length,
      },
    });
    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof LifecycleE2eError ? error.code : 'CRYPTO_LIFECYCLE_E2E_FAILED';
    await audit(service, {
      workspaceId,
      actorId: user.id,
      runId,
      eventType: 'CRYPTO_LIFECYCLE_E2E_FAILED',
      summary: 'Ciclo criptográfico E2E productivo fallido',
      outcome: 'failed',
      payload: { run_id: runId, failure_code: code },
    }).catch(() => undefined);
    return NextResponse.json(
      { status: 'FAILED', runId, failureCode: code, failClosed: true },
      { status: 502 }
    );
  } finally {
    activeRun = false;
  }
}
