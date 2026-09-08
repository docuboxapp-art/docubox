import { NextRequest, NextResponse } from 'next/server';
import { buildLuciaAuthorizationContext } from '@/lib/ai/luciaAuthorization';
import { computeChunkContentHash } from '@/lib/ai/documentIntelligence';
import { saveQueryLog } from '@/lib/ai/luciaQueries';
import { readDocumentStorageObject } from '@/lib/crypto/document-encryption';
import { resolveInternalDocumentSource } from '@/lib/documents/internal-source';
import { createServiceClient } from '@/lib/supabase/server';
import {
  AI_BODY_LIMITS,
  aiErrorResponse,
  EMBEDDING_MODEL,
  enforceAiRateLimits,
  readLimitedJson,
  requireAiUser,
} from '@/lib/ai/security';

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

function chunkText(text: string) {
  const chunks: Array<{ content: string; chunkIndex: number }> = [];
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + CHUNK_SIZE, cleaned.length);
    if (end < cleaned.length) {
      for (const boundary of ['\n\n', '\n', '. ', '? ', '! ', '; ']) {
        const index = cleaned.lastIndexOf(boundary, end);
        if (index > start + CHUNK_SIZE / 2) {
          end = index + boundary.length;
          break;
        }
      }
    }
    const content = cleaned.slice(start, end).trim();
    if (content.length > 30) chunks.push({ content, chunkIndex: chunks.length });
    if (end >= cleaned.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function extractPdfText(buffer: ArrayBuffer) {
  const raw = new TextDecoder('latin1').decode(new Uint8Array(buffer));
  const blocks: string[] = [];
  for (const match of raw.matchAll(/\(([^)]*)\)\s*Tj/g)) blocks.push(match[1]);
  for (const match of raw.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    for (const nested of match[1].matchAll(/\(([^)]*)\)/g)) blocks.push(nested[1]);
  }
  return blocks
    .join(' ')
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\s{3,}/g, '\n\n')
    .trim()
    .slice(0, 100_000);
}

async function generateEmbeddings(texts: string[]) {
  const embeddings: number[][] = [];
  for (let index = 0; index < texts.length; index += 20) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.slice(index, index + 20) }),
    });
    if (!response.ok) throw new Error('EMBEDDING_PROVIDER_FAILED');
    const payload = await response.json();
    embeddings.push(...payload.data.map((item: { embedding: number[] }) => item.embedding));
  }
  return embeddings;
}

type EmbedBody = {
  documentId?: unknown;
  workspaceId?: unknown;
  forceReembed?: unknown;
  provider?: unknown;
  model?: unknown;
  storagePath?: unknown;
};

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let activeJob: { id: string; service: ReturnType<typeof createServiceClient> } | null = null;
  try {
    const { user } = await requireAiUser(request);
    const body = await readLimitedJson<EmbedBody>(request, AI_BODY_LIMITS.embed);
    if (body.provider || (body.model && body.model !== EMBEDDING_MODEL) || body.storagePath) {
      return NextResponse.json(
        { error: 'CLIENT_PROVIDER_OR_STORAGE_OVERRIDE_FORBIDDEN' },
        { status: 400 }
      );
    }
    const documentId = typeof body.documentId === 'string' ? body.documentId : '';
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    if (!documentId || !workspaceId)
      return NextResponse.json({ error: 'DOCUMENT_AND_WORKSPACE_REQUIRED' }, { status: 400 });

    const authorization = await buildLuciaAuthorizationContext({
      user,
      workspaceId,
      documentId,
      currentRoute: `/visor-documento/${documentId}`,
    });
    if (authorization.denied_reason)
      return NextResponse.json({ error: authorization.denied_reason }, { status: 403 });
    if (!authorization.permissions.includes('manage_ai_index')) {
      return NextResponse.json({ error: 'AI_INDEX_PERMISSION_REQUIRED' }, { status: 403 });
    }
    await enforceAiRateLimits({
      request,
      route: '/api/ai/embed-document',
      userId: user.id,
      workspaceId,
      limit: 6,
      windowSeconds: 60,
    });

    const supabase = createServiceClient();
    const { data: document } = await supabase
      .from('documentos')
      .select('id,nombre,file_name,file_type,workspace_id')
      .eq('id', documentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!document?.file_name)
      return NextResponse.json({ error: 'DOCUMENT_FILE_NOT_FOUND' }, { status: 404 });

    const latestVersion = await supabase
      .from('document_versions')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('document_id', documentId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestVersion.error) throw latestVersion.error;
    const source = await resolveInternalDocumentSource(supabase, user, {
      workspaceId,
      documentId,
      versionId: latestVersion.data?.id || null,
      variant: latestVersion.data?.id ? 'version' : 'original',
    });

    if (body.forceReembed !== true) {
      const { count } = await supabase
        .from('ai_document_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', documentId)
        .eq('document_hash', source.sha256);
      if ((count || 0) > 0)
        return NextResponse.json({
          success: true,
          alreadyEmbedded: true,
          chunksCount: count,
          documentId,
        });
    }

    const stored = await readDocumentStorageObject({
      service: supabase,
      storageBucket: 'documents',
      storagePath: source.storagePath,
      expectedPlaintextSha256: source.sha256,
      userId: user.id,
      accessEvent: 'DOCUMENT_DECRYPTED',
    });
    const bytes = stored.plaintext;
    if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) {
      bytes.fill(0);
      return NextResponse.json({ error: 'DOCUMENT_FILE_INVALID_OR_TOO_LARGE' }, { status: 413 });
    }
    const mimeType = source.fileType || stored.mimeType || document.file_type;
    const extractionMethod =
      mimeType === 'application/pdf' ? 'pdf_operator_heuristic' : 'plain_text';
    if (mimeType !== 'application/pdf' && !mimeType.startsWith('text/')) {
      bytes.fill(0);
      return NextResponse.json({ error: 'DOCUMENT_FORMAT_REQUIRES_EXTRACTOR' }, { status: 415 });
    }
    const rawText =
      mimeType === 'application/pdf'
        ? extractPdfText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        : new TextDecoder('utf-8').decode(bytes).slice(0, 100_000);
    bytes.fill(0);
    if (rawText.length < 50)
      return NextResponse.json({ error: 'DOCUMENT_TEXT_NOT_EXTRACTABLE' }, { status: 422 });
    const chunks = chunkText(rawText);
    const job = await supabase
      .from('ai_document_processing_jobs')
      .insert({
        workspace_id: workspaceId,
        document_id: documentId,
        document_version_id: source.versionId,
        job_type: 'embed_document',
        status: 'processing',
        started_at: new Date().toISOString(),
        created_by: user.id,
      })
      .select('id')
      .single();
    if (job.error) throw job.error;
    activeJob = { id: job.data.id, service: supabase };
    const embeddings = await generateEmbeddings(chunks.map((chunk) => chunk.content));

    if (body.forceReembed === true) {
      let deletion = supabase.from('ai_document_chunks').delete().eq('document_id', documentId);
      deletion = source.versionId
        ? deletion.eq('document_version_id', source.versionId)
        : deletion.is('document_version_id', null);
      const deleted = await deletion;
      if (deleted.error) throw deleted.error;
    }
    const rows = chunks.map((chunk, index) => ({
      workspace_id: workspaceId,
      document_id: documentId,
      document_version_id: source.versionId,
      document_hash: source.sha256,
      content_hash: computeChunkContentHash(chunk.content),
      content: chunk.content,
      embedding: embeddings[index],
      chunk_index: chunk.chunkIndex,
      extraction_method: extractionMethod,
      metadata: {
        embedding_model: EMBEDDING_MODEL,
        char_count: chunk.content.length,
        version_id: source.versionId,
        source_mime_type: mimeType,
        page_number_unavailable: true,
      },
    }));
    for (let index = 0; index < rows.length; index += 50) {
      const { error } = await supabase
        .from('ai_document_chunks')
        .insert(rows.slice(index, index + 50));
      if (error) throw new Error('CHUNK_STORAGE_FAILED');
    }

    await supabase
      .from('ai_document_profiles')
      .update({ status: 'stale' })
      .eq('document_id', documentId)
      .neq('document_hash', source.sha256);
    await supabase
      .from('ai_document_processing_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', activeJob.id);
    activeJob = null;

    await saveQueryLog({
      workspaceId,
      userId: user.id,
      question: '[document indexing request]',
      intent: 'embed_document',
      scope: 'document_viewer',
      route: '/api/ai/embed-document',
      documentIds: [documentId],
      contextUsed: {
        chunks_count: rows.length,
        document_bytes: source.fileSize,
        document_version_id: source.versionId,
        document_hash_recorded: true,
        extraction_method: extractionMethod,
        page_numbers_available: false,
      },
      responseText: '[document content omitted from audit log]',
      durationMs: Date.now() - startedAt,
      hasEvidence: true,
    });
    return NextResponse.json({
      success: true,
      documentId,
      chunksCount: rows.length,
      embeddingModel: EMBEDDING_MODEL,
      documentVersionId: source.versionId,
      extractionMethod,
      pageNumbersAvailable: false,
    });
  } catch (error) {
    if (activeJob) {
      await activeJob.service
        .from('ai_document_processing_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_code: 'DOCUMENT_INDEXING_FAILED',
          error_message: 'La indexacion no pudo completarse.',
        })
        .eq('id', activeJob.id);
    }
    const formatted = aiErrorResponse(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
