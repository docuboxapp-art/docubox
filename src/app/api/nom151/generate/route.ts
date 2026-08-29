import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import {
  issueNom151ForVerifiedPadesBt,
  Nom151ServiceError,
} from '@/lib/nom151/service';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function participantCompleted(
  participants: unknown,
  user: { id: string; email?: string | null }
) {
  if (!Array.isArray(participants)) return false;
  const email = String(user.email || '').trim().toLowerCase();
  return participants.some((participant: Record<string, unknown>) => {
    const matchesUser =
      participant.id === user.id ||
      String(participant.email || '').trim().toLowerCase() === email;
    const state = String(participant.sub_estado || participant.estado || '').toLowerCase();
    return matchesUser && ['firmo', 'firmado', 'aprobo', 'aprobado', 'completado'].includes(state);
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const documentId = String(body.documento_id || '').trim();
    if (!documentId) {
      return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });
    }

    const access = await requireDocumentAccess(req, documentId);
    if (
      access.role === 'AUTHORIZED' &&
      !participantCompleted(access.document.participantes, access.user)
    ) {
      return NextResponse.json(
        {
          error: 'Solo el participante que completó su intervención puede iniciar esta emisión.',
          code: 'PARTICIPATION_NOT_COMPLETED',
        },
        { status: 403 }
      );
    }

    const result = await issueNom151ForVerifiedPadesBt(supabaseAdmin, {
      documentId,
      requestedBy: access.user.id,
    });

    return NextResponse.json({
      already_issued: result.alreadyIssued,
      record_id: result.recordId,
      status: result.status,
      verification_status: result.verificationStatus,
      provider: result.provider,
      psc_name: result.pscName,
      environment: result.environment,
      operation_id: result.operationId,
      folio: result.folio,
      document_digest: result.documentDigest,
      constancia_sha256: result.artifactSha256,
      constancia_path: result.artifactPath,
      verification: result.verification,
    });
  } catch (error) {
    if (error instanceof Nom151ServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    const response = documentAccessResponse(error);
    console.error('[nom151/generate] Error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(response.body, { status: response.status });
  }
}
