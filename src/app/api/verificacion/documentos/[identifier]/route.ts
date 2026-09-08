import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { documentEncryptionPolicy } from '@/lib/crypto/document-encryption';
import { enforcePublicRateLimit } from '@/lib/public-verification/gateway';

type PublicDocumentRow = {
  id: string;
  documento_id: string;
  folio_interno?: string | null;
  nombre: string;
  descripcion?: string | null;
  estado: string;
  es_publico: boolean;
  owner_id: string;
  file_name?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  file_url?: string | null;
  file_hash_sha256?: string | null;
  sealed_pdf_path?: string | null;
  sealed_pdf_hash?: string | null;
  sealed_at?: string | null;
  xml_hash_sha256?: string | null;
  xml_generated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  fecha_completado?: string | null;
  participantes?: Array<Record<string, unknown>> | null;
};

type PublicEvidenceRow = {
  id: string;
  evidence_type: string;
  captured_at: string;
  participant_name?: string | null;
  participant_role?: string | null;
  signature_hash?: string | null;
  efirma_nombre?: string | null;
  efirma_rfc?: string | null;
  cert_rfc?: string | null;
};

type PublicVerificationBundle = {
  document: PublicDocumentRow;
  owner_full_name?: string | null;
  evidence?: PublicEvidenceRow[] | null;
};

function publicResponse(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function sanitizeParticipants(participants: PublicDocumentRow['participantes']) {
  if (!Array.isArray(participants)) return [];

  return participants.map((participant) => ({
    name: String(participant.nombre || participant.name || 'Participante')
      .replace(/\s*\(Tú\)\s*$/i, '')
      .trim(),
    role: String(participant.acto || participant.rolDocumento || 'Participante'),
    status: String(participant.sub_estado || participant.estado || 'completado'),
    signatureMethods: Array.isArray(participant.tipoFirma)
      ? participant.tipoFirma.map((method) => String(method))
      : [],
  }));
}

function extractStorageReference(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.+)$/
    );
    if (!match) return null;
    return {
      bucket: decodeURIComponent(match[1]),
      path: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

async function createTemporaryDocumentUrl(
  supabase: ReturnType<typeof createServiceClient>,
  document: PublicDocumentRow
) {
  if (documentEncryptionPolicy().enabled) {
    return `/api/verificacion/documentos/${document.id}/archivo`;
  }
  const candidates: Array<{ bucket: string; path: string }> = [];

  if (document.sealed_pdf_path) {
    candidates.push(
      { bucket: 'documents-signed', path: document.sealed_pdf_path },
      { bucket: 'documents', path: document.sealed_pdf_path }
    );
  }

  if (document.file_url) {
    const reference = extractStorageReference(document.file_url);
    if (reference) {
      candidates.push(reference);
    } else if (!/^https?:\/\//i.test(document.file_url)) {
      candidates.push({ bucket: 'documents', path: document.file_url });
    }
  }

  for (const candidate of candidates) {
    const { data, error } = await supabase.storage
      .from(candidate.bucket)
      .createSignedUrl(candidate.path, 10 * 60);

    if (!error && data?.signedUrl) return data.signedUrl;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl && document.file_url?.startsWith(supabaseUrl)) {
    return document.file_url;
  }

  return null;
}

async function findCompletedDocument(identifier: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('get_public_document_verification_bundle', {
    p_identifier: identifier,
  });
  if (error) throw error;
  return { supabase, bundle: data as PublicVerificationBundle | null };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  try {
    if (!(await enforcePublicRateLimit(request, 'completed-document', 30))) {
      return publicResponse({ error: 'Demasiadas consultas. Intenta mas tarde.' }, 429);
    }
  } catch {
    return publicResponse(
      { error: 'El servicio de verificación no está disponible temporalmente.' },
      503
    );
  }

  try {
    const { identifier: rawIdentifier } = await params;
    const identifier = decodeURIComponent(rawIdentifier || '').trim();

    if (!identifier || identifier.length > 120) {
      return publicResponse({ error: 'Ingresa un folio o ID de documento válido.' }, 400);
    }

    const { supabase, bundle } = await findCompletedDocument(identifier);
    const document = bundle?.document || null;

    if (!document) {
      return publicResponse(
        {
          error: 'No encontramos un documento completado con ese identificador.',
        },
        404
      );
    }

    const documentUrl = document.es_publico
      ? await createTemporaryDocumentUrl(supabase, document)
      : null;
    const verificationHash =
      document.sealed_pdf_hash || document.file_hash_sha256 || document.xml_hash_sha256 || null;

    return publicResponse({
      valid: true,
      verificationUrl: `/verificar-documento/${document.id}`,
      document: {
        id: document.id,
        documentId: document.documento_id,
        folio: document.folio_interno || document.documento_id,
        name: document.nombre,
        description: document.descripcion || null,
        status: document.estado,
        isPublic: document.es_publico,
        issuer: bundle?.owner_full_name || 'Cuenta Docubox',
        createdAt: document.created_at,
        completedAt: document.fecha_completado || document.sealed_at || document.updated_at,
        fileName: document.file_name,
        fileSize: document.file_size,
        fileType: document.file_type,
        documentUrl,
        hash: verificationHash,
        hashSource: document.sealed_pdf_hash
          ? 'PDF final sellado'
          : document.file_hash_sha256
            ? 'Archivo registrado'
            : document.xml_hash_sha256
              ? 'Evidencia XML'
              : null,
        xmlHash: document.xml_hash_sha256 || null,
        participants: sanitizeParticipants(document.participantes),
        signatures: (bundle?.evidence || []).map((item) => ({
          id: item.id,
          type: item.evidence_type,
          capturedAt: item.captured_at,
          signer: item.efirma_nombre || item.participant_name || 'Firmante verificado',
          role: item.participant_role || 'Firmante',
          rfc: item.efirma_rfc || item.cert_rfc || null,
          hash: item.signature_hash || null,
        })),
      },
    });
  } catch (error) {
    console.error('[public-document-verification] Error:', error);
    return publicResponse({ error: 'No fue posible consultar el servicio de verificación.' }, 500);
  }
}
