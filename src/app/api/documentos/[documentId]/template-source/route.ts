import type { NextRequest } from 'next/server';
import { requireDocumentContentAccess } from '@/lib/security/document-content-access';
import { DocumentAccessError } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEMPLATE_SELECT =
  'id,nombre,descripcion,estado,estado_plantilla,version_publicada,source_template_id,root_template_id,updated_at,contenido_html,campos_insertados,hoja_tamano,hoja_orientacion,margenes,tipo_documento:tipo_documento_id(id,nombre)';

function fieldIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((field) =>
      field && typeof field === 'object' && typeof (field as { id?: unknown }).id === 'string'
        ? String((field as { id: string }).id)
        : ''
    )
    .filter(Boolean)
    .sort();
}

function sameFieldSet(left: string[], right: string[]) {
  return (
    left.length > 0 &&
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function isMissingSourceTemplateColumn(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string };
  return (
    ['42703', 'PGRST204'].includes(String(candidate.code || '')) &&
    /source_template_id/i.test(String(candidate.message || ''))
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const access = await requireDocumentContentAccess(request, documentId);
    const { service } = access;

    let documentResult = await service
      .from('documentos')
      .select('id,workspace_id,source_template_id,campos_solicitados')
      .eq('id', documentId)
      .maybeSingle();
    if (isMissingSourceTemplateColumn(documentResult.error)) {
      documentResult = await service
        .from('documentos')
        .select('id,workspace_id,campos_solicitados')
        .eq('id', documentId)
        .maybeSingle();
    }
    if (documentResult.error) throw documentResult.error;
    if (!documentResult.data) {
      return Response.json({ error: 'Documento no encontrado.' }, { status: 404 });
    }

    const document = documentResult.data as {
      workspace_id?: string | null;
      source_template_id?: string | null;
      campos_solicitados?: unknown;
    };
    let template: Record<string, unknown> | null = null;

    if (document.source_template_id) {
      const result = await service
        .from('plantillas')
        .select(TEMPLATE_SELECT)
        .eq('id', document.source_template_id)
        .eq('workspace_id', document.workspace_id)
        .maybeSingle();
      if (result.error) throw result.error;
      template = result.data as Record<string, unknown> | null;
    }

    // Compatibility for documents created before source_template_id existed:
    // template field IDs are immutable within a published version and provide
    // an exact, tenant-scoped match without exposing another workspace.
    if (!template && document.workspace_id) {
      const documentFieldIds = fieldIds(document.campos_solicitados);
      if (documentFieldIds.length > 0) {
        const candidates = await service
          .from('plantillas')
          .select(TEMPLATE_SELECT)
          .eq('workspace_id', document.workspace_id)
          .not('contenido_html', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(100);
        if (candidates.error) throw candidates.error;
        template =
          ((candidates.data || []).find((candidate) =>
            sameFieldSet(documentFieldIds, fieldIds(candidate.campos_insertados))
          ) as Record<string, unknown> | undefined) || null;
      }
    }

    if (!template) {
      return Response.json(
        { error: 'El documento no tiene una plantilla recuperable.' },
        { status: 404 }
      );
    }

    return Response.json(
      { template },
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      }
    );
  } catch (error) {
    if (error instanceof DocumentAccessError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[template-source] No fue posible resolver la plantilla:', error);
    return Response.json(
      { error: 'No fue posible cargar el documento de plantilla.' },
      { status: 500 }
    );
  }
}
