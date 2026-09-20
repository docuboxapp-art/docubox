import { performance } from 'perf_hooks';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildTemplateImportId,
  parseTemplateDocx,
  TemplateDocxImportError,
} from '@/lib/template-import/docx/parser';
import {
  appendTemplateAuditEvent,
  resolveTemplatePublicationContext,
  templateApiFailure,
} from '@/lib/templates/publication-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ACCEPTED_MIME_TYPES = new Set([DOCX_MIME, 'application/zip', 'application/octet-stream', '']);

function safeFilename(value: string) {
  const basename = value.replace(/\\/g, '/').split('/').pop() || '';
  return (
    [...basename]
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127;
      })
      .join('')
      .trim() || 'documento.docx'
  );
}

function hasZipSignature(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  return (
    (bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[2] === 0x07 && bytes[3] === 0x08)
  );
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  let auditContext: Awaited<ReturnType<typeof resolveTemplatePublicationContext>> | null = null;
  let importId: string | null = null;
  let filename = 'documento.docx';
  let fileSize = 0;

  try {
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      throw new TemplateDocxImportError(413, 'FILE_TOO_LARGE', 'El archivo no debe superar 15 MB.');
    }

    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    auditContext = await resolveTemplatePublicationContext(request, workspaceId);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new TemplateDocxImportError(400, 'IMPORT_FAILED', 'No fue posible recibir el archivo.');
    }
    const file = formData.get('file');
    if (!(file instanceof File)) {
      throw new TemplateDocxImportError(
        400,
        'UNSUPPORTED_FILE_TYPE',
        'Selecciona un archivo .docx.'
      );
    }

    filename = safeFilename(file.name);
    fileSize = file.size;
    if (
      !filename.toLowerCase().endsWith('.docx') ||
      !ACCEPTED_MIME_TYPES.has(file.type.toLowerCase())
    ) {
      throw new TemplateDocxImportError(
        415,
        'UNSUPPORTED_FILE_TYPE',
        'Solo se admiten archivos Microsoft Word .docx.'
      );
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      throw new TemplateDocxImportError(413, 'FILE_TOO_LARGE', 'El archivo no debe superar 15 MB.');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasZipSignature(bytes)) {
      throw new TemplateDocxImportError(
        422,
        'INVALID_DOCX',
        'El archivo seleccionado no contiene un paquete DOCX válido.'
      );
    }

    importId = buildTemplateImportId(auditContext.user.id, workspaceId, bytes);
    console.info('[template-docx-import] import started', {
      importId,
      workspaceId,
      size: file.size,
    });

    const result = await parseTemplateDocx({ bytes, filename, workspaceId, importId });
    await appendTemplateAuditEvent(auditContext, {
      eventType: 'template.docx.imported',
      templateId: importId,
      summary: 'Documento Word preparado para crear una plantilla',
      request,
      payload: {
        filename,
        size_bytes: file.size,
        duration_ms: Math.round(performance.now() - startedAt),
        warnings: result.warnings,
        stats: result.stats,
      },
    });

    console.info('[template-docx-import] import completed', {
      importId,
      workspaceId,
      size: file.size,
      durationMs: Math.round(performance.now() - startedAt),
      warnings: result.warnings.length,
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (cause) {
    const candidate = cause as { status?: number; code?: string; message?: string };
    const failure =
      typeof candidate.status === 'number'
        ? cause
        : new TemplateDocxImportError(
            500,
            'IMPORT_FAILED',
            'No fue posible importar el documento Word.'
          );
    const error = failure as { code?: string; message?: string };
    console.error('[template-docx-import] import failed', {
      importId,
      size: fileSize,
      durationMs: Math.round(performance.now() - startedAt),
      code: error.code || 'IMPORT_FAILED',
    });
    if (auditContext && importId) {
      await appendTemplateAuditEvent(auditContext, {
        eventType: 'template.docx.import_failed',
        templateId: importId,
        summary: 'No fue posible preparar el documento Word',
        request,
        payload: {
          filename,
          size_bytes: fileSize,
          duration_ms: Math.round(performance.now() - startedAt),
          error_code: error.code || 'IMPORT_FAILED',
        },
      }).catch(() => undefined);
    }
    return templateApiFailure(failure);
  }
}
