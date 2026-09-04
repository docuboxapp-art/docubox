import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveLegacyDocumentStoragePath } from '@/lib/documents/internal-source';
import { readDocumentStorageObject } from '@/lib/crypto/document-encryption';
import { DocumentEncryptionError } from '@/lib/crypto/document-encryption/errors';
import { createCertificationProviderSet } from '@/lib/certification/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const privateErrorHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
};

function documentEncryptionResponse(error: DocumentEncryptionError) {
  if (error.code === 'DOCUMENT_LEGACY_PLAINTEXT_BLOCKED') {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 409, headers: privateErrorHeaders }
    );
  }
  if (error.code === 'DOCUMENT_ENCRYPTION_STORAGE_FAILED') {
    return NextResponse.json(
      {
        error: 'El archivo solicitado no está disponible.',
        code: 'DOCUMENT_STORAGE_OBJECT_MISSING',
      },
      { status: 404, headers: privateErrorHeaders }
    );
  }
  if (
    [
      'DOCUMENT_ENCRYPTION_METADATA_MISSING',
      'DOCUMENT_UNSUPPORTED_ENCRYPTION_VERSION',
      'DOCUMENT_INTEGRITY_FAILURE',
      'DOCUMENT_DECRYPTION_AUTH_FAILURE',
      'DOCUMENT_DECRYPTION_FAILED',
      'DOCUMENT_KEY_UNWRAP_FAILED',
    ].includes(error.code)
  ) {
    return NextResponse.json(
      {
        error: 'La evidencia criptográfica del documento no es válida.',
        code: error.code,
      },
      { status: 422, headers: privateErrorHeaders }
    );
  }
  return NextResponse.json(
    { error: 'No se pudo abrir el documento.', code: error.code },
    { status: 500, headers: privateErrorHeaders }
  );
}

function normalizeEmail(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isParticipant(participants: unknown, userId: string, userEmail: string) {
  if (!Array.isArray(participants)) return false;
  return participants.some((participant) => {
    if (!participant || typeof participant !== 'object') return false;
    const row = participant as Record<string, unknown>;
    return (
      row.id === userId ||
      row.user_id === userId ||
      (userEmail && normalizeEmail(row.email) === userEmail)
    );
  });
}

async function authenticatedUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  const service = createServiceClient();
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    const auth = await service.auth.getUser(token);
    if (!auth.error && auth.data.user) return auth.data.user;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => undefined,
      },
    }
  );
  const auth = await supabase.auth.getUser();
  return auth.error ? null : auth.data.user;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const user = await authenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    const { documentId } = await context.params;
    const service = createServiceClient();
    const documentResult = await service
      .from('documentos')
      .select(
        'id,owner_id,workspace_id,participantes,storage_path,file_url,sealed_pdf_path,sealed_pdf_hash,file_hash_sha256,file_name,nombre,estado'
      )
      .eq('id', documentId)
      .is('deleted_at', null)
      .maybeSingle();

    if (documentResult.error) throw documentResult.error;
    const document = documentResult.data;
    if (!document) {
      return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
    }

    const email = normalizeEmail(user.email);
    const owner = document.owner_id === user.id;
    let participant = isParticipant(document.participantes, user.id, email);
    let workspaceManager = false;

    if (!owner && !participant) {
      const participationById = await service
        .from('participation_responses')
        .select('id')
        .eq('documento_id', document.id)
        .eq('participante_id', user.id)
        .limit(1)
        .maybeSingle();
      if (participationById.error) throw participationById.error;
      participant = Boolean(participationById.data);

      if (!participant && email) {
        const participationByEmail = await service
          .from('participation_responses')
          .select('id')
          .eq('documento_id', document.id)
          .ilike('participante_email', email)
          .limit(1)
          .maybeSingle();
        if (participationByEmail.error) throw participationByEmail.error;
        participant = Boolean(participationByEmail.data);
      }
    }

    if (!owner && !participant && document.workspace_id) {
      const membership = await service
        .from('workspace_members')
        .select('role,status,access_expires_at')
        .eq('workspace_id', document.workspace_id)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (membership.error) throw membership.error;
      const expiresAt = membership.data?.access_expires_at
        ? new Date(membership.data.access_expires_at).getTime()
        : null;
      workspaceManager =
        Boolean(membership.data) &&
        ['owner', 'admin'].includes(String(membership.data?.role)) &&
        (expiresAt === null || expiresAt > Date.now());
    }

    if (!owner && !participant && !workspaceManager) {
      return NextResponse.json({ error: 'No tienes acceso a este documento.' }, { status: 403 });
    }

    const requestedVariant = request.nextUrl.searchParams.get('variant') || 'original';
    const supportedVariants = new Set(['original', 'visual', 'certified', 'pades-bt', 'final']);
    if (!supportedVariants.has(requestedVariant)) {
      return NextResponse.json(
        {
          error: 'La variante solicitada no está disponible.',
          code: 'DOCUMENT_VARIANT_UNSUPPORTED',
        },
        { status: 400, headers: privateErrorHeaders }
      );
    }
    const requestsFinalPdf = ['certified', 'pades-bt', 'final'].includes(requestedVariant);
    let finalCertification: {
      certified_pdf_sha256: string | null;
      pades_certificate_fingerprint_sha256: string | null;
      provider_metadata: {
        product_integration?: {
          pades_bt?: { final_pdf_path?: unknown };
        };
      } | null;
    } | null = null;
    if (requestsFinalPdf) {
      const verifiedCertificationResult = await service
        .from('document_certifications')
        .select('certified_pdf_sha256,pades_certificate_fingerprint_sha256,provider_metadata')
        .eq('document_id', document.id)
        .eq('status', 'COMPLETED')
        .eq('execution_status', 'completed')
        .eq('pades_profile', 'PAdES-B-T')
        .eq('integrity_status', 'valid')
        .eq('pdf_signature_status', 'valid')
        .eq('certificate_status', 'valid')
        .eq('timestamp_status', 'valid')
        .eq('verification_status', 'valid')
        .order('pades_verified_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (verifiedCertificationResult.error) throw verifiedCertificationResult.error;
      finalCertification = verifiedCertificationResult.data;

      if (!finalCertification || !document.sealed_pdf_path || !document.sealed_pdf_hash) {
        const latestCertificationResult = await service
          .from('document_certifications')
          .select('execution_status,error_code')
          .eq('document_id', document.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestCertificationResult.error) throw latestCertificationResult.error;
        const latest = latestCertificationResult.data;
        const processing = ['pending', 'processing', 'retrying'].includes(
          String(latest?.execution_status || '').toLowerCase()
        );
        const failed =
          String(latest?.execution_status || '').toLowerCase() === 'failed' ||
          Boolean(latest?.error_code);
        return NextResponse.json(
          {
            error: processing
              ? 'Estamos preparando la versión firmada y certificada.'
              : failed
                ? 'No se pudo completar la certificación PAdES.'
                : 'La versión final PAdES-B-T aún no está disponible.',
            code: processing
              ? 'PADES_CERTIFICATION_IN_PROGRESS'
              : failed
                ? 'PADES_CONFIGURATION_ERROR'
                : 'PADES_CERTIFICATION_REQUIRED',
          },
          { status: 409, headers: privateErrorHeaders }
        );
      }

      const persistedFinalPath = String(
        finalCertification.provider_metadata?.product_integration?.pades_bt?.final_pdf_path || ''
      );
      const certificationSha256 = String(
        finalCertification.certified_pdf_sha256 || ''
      ).toLowerCase();
      if (
        !persistedFinalPath ||
        persistedFinalPath !== document.sealed_pdf_path ||
        certificationSha256 !== String(document.sealed_pdf_hash).toLowerCase()
      ) {
        return NextResponse.json(
          {
            error:
              'La referencia del PDF final no coincide con la certificación PAdES-B-T verificada.',
            code: 'PADES_BT_FINAL_ARTIFACT_MISMATCH',
          },
          { status: 409, headers: privateErrorHeaders }
        );
      }
    }
    const storagePath = requestsFinalPdf
      ? String(document.sealed_pdf_path || '')
      : resolveLegacyDocumentStoragePath(document.storage_path, document.file_url);

    if (!storagePath) {
      return NextResponse.json(
        { error: 'El archivo solicitado no esta disponible.' },
        { status: 404 }
      );
    }

    const file = await readDocumentStorageObject({
      service,
      storageBucket: 'documents',
      storagePath,
      expectedPlaintextSha256: requestsFinalPdf
        ? document.sealed_pdf_hash
        : document.file_hash_sha256,
      userId: user.id,
      requestId: request.headers.get('x-request-id'),
      accessEvent:
        request.nextUrl.searchParams.get('download') === '1'
          ? 'DOCUMENT_DOWNLOADED'
          : 'DOCUMENT_VIEWED',
    });
    if (requestsFinalPdf && finalCertification) {
      const expectedCertificateFingerprintSha256 = String(
        finalCertification.pades_certificate_fingerprint_sha256 || ''
      );
      const providers = createCertificationProviderSet();
      const [primary, independent] = await Promise.all([
        providers.pdfSignature.verifyPdf({
          pdfBytes: file.plaintext,
          expectedCertificateFingerprintSha256,
        }),
        providers.independentVerification.verifyPdf({
          pdfBytes: file.plaintext,
          expectedCertificateFingerprintSha256,
        }),
      ]);
      const verificationPassed = [primary, independent].every(
        (result) =>
          result.valid &&
          result.profile === 'PAdES-B-T' &&
          result.byteRangeValid &&
          result.cmsValid &&
          result.certificateValid &&
          result.certificateKeyMatches &&
          result.timestamp?.valid &&
          result.timestamp.messageImprintValid &&
          result.timestamp.cmsValid &&
          result.timestamp.certificateValid &&
          result.timestamp.chainValid
      );
      if (!verificationPassed) {
        file.plaintext.fill(0);
        return NextResponse.json(
          {
            error: 'El PDF final no superó la verificación PAdES-B-T previa a la entrega.',
            code: 'PADES_BT_FINAL_ARTIFACT_VERIFICATION_FAILED',
          },
          { status: 422, headers: privateErrorHeaders }
        );
      }
    }
    const total = file.plaintext.byteLength;
    const range = request.headers.get('range');
    let status = 200;
    let responseBytes = file.plaintext;
    let contentRange: string | null = null;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) {
        file.plaintext.fill(0);
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${total}` },
        });
      }
      const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2] || 0));
      const end = match[1]
        ? Math.min(total - 1, match[2] ? Number(match[2]) : total - 1)
        : total - 1;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        start > end ||
        start >= total
      ) {
        file.plaintext.fill(0);
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${total}` },
        });
      }
      responseBytes = file.plaintext.subarray(start, end + 1);
      contentRange = `bytes ${start}-${end}/${total}`;
      status = 206;
    }

    const response = new NextResponse(responseBytes, { status });
    response.headers.set('Content-Type', file.mimeType || 'application/octet-stream');
    response.headers.set('Content-Length', String(responseBytes.byteLength));
    response.headers.set('Accept-Ranges', 'bytes');
    if (contentRange) response.headers.set('Content-Range', contentRange);
    const disposition =
      request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const requestedFileName = requestsFinalPdf
      ? `${String(document.nombre || document.file_name || 'documento').replace(/\.pdf$/i, '')}_firmado_PAdES-B-T.pdf`
      : String(file.fileName || document.file_name || 'documento.pdf');
    const safeFileName = requestedFileName.replace(/[\r\n"]/g, '_');
    response.headers.set('Content-Disposition', `${disposition}; filename="${safeFileName}"`);
    const responseSha256 = requestsFinalPdf
      ? String(document.sealed_pdf_hash || '').toLowerCase()
      : String(document.file_hash_sha256 || '').toLowerCase();
    if (responseSha256) response.headers.set('ETag', `"sha256-${responseSha256}"`);
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    response.headers.set('CDN-Cache-Control', 'no-store');
    response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
    response.headers.set('Surrogate-Control', 'no-store');
    response.headers.set('Expires', '0');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Vary', 'Authorization, Cookie');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return response;
  } catch (error) {
    console.error('[DOCUBOX][viewer-file] No se pudo abrir el documento:', error);
    if (error instanceof DocumentEncryptionError) {
      return documentEncryptionResponse(error);
    }
    return NextResponse.json(
      { error: 'No se pudo abrir el documento.', code: 'DOCUMENT_VIEWER_INTERNAL_ERROR' },
      {
        status: 500,
        headers: privateErrorHeaders,
      }
    );
  }
}
