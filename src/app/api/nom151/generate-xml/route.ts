import { NextRequest, NextResponse } from 'next/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Historical compatibility only. New evidence is generated automatically by
// the server-side Evidence V2 finalization orchestrator.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const documentId = String(body.documento_id || '').trim();
    if (!documentId) {
      return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });
    }
    const { document } = await requireDocumentAccess(request, documentId, {
      ownerOrAdminOnly: true,
    });
    if (document.xml_evidencia_path) {
      return NextResponse.json({
        already_generated: true,
        xml_evidencia_path: document.xml_evidencia_path,
        xml_hash_sha256: document.xml_hash_sha256,
        xml_generated_at: document.xml_generated_at,
        evidence_version: 1,
      });
    }
    return NextResponse.json(
      {
        error:
          'La generación V1 está deshabilitada para documentos nuevos. Evidence V2.1 se genera automáticamente al cierre.',
        code: 'EVIDENCE_V1_LEGACY_ONLY',
      },
      { status: 409 }
    );
  } catch (error) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
