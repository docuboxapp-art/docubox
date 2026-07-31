import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CHUNK_SIZE = 800;        // characters per chunk
const CHUNK_OVERLAP = 150;     // overlap between consecutive chunks
const EMBEDDING_MODEL = 'text-embedding-3-small'; // 1536 dimensions
const EMBEDDING_BATCH = 20;    // chunks per OpenAI batch call

// ── Helpers ────────────────────────────────────────────────────────────────

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Splits raw text into overlapping chunks.
 * Tries to break on sentence/paragraph boundaries when possible.
 */
function chunkText(text: string): { content: string; chunkIndex: number }[] {
  const chunks: { content: string; chunkIndex: number }[] = [];
  let start = 0;
  let index = 0;

  // Normalise whitespace
  const cleaned = text.replace(/\r\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();

  while (start < cleaned.length) {
    let end = start + CHUNK_SIZE;

    if (end < cleaned.length) {
      // Try to break at a paragraph or sentence boundary
      const breakPoints = ['\n\n', '\n', '. ', '? ', '! ', '; '];
      for (const bp of breakPoints) {
        const idx = cleaned.lastIndexOf(bp, end);
        if (idx > start + CHUNK_SIZE / 2) {
          end = idx + bp.length;
          break;
        }
      }
    } else {
      end = cleaned.length;
    }

    const content = cleaned.slice(start, end).trim();
    if (content.length > 30) {
      chunks.push({ content, chunkIndex: index++ });
    }

    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
  }

  return chunks;
}

/**
 * Extracts plain text from a PDF buffer using a byte-level heuristic.
 * Extracts readable text from PDF Tj/TJ operators.
 */
function extractTextFromPdfBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('latin1');
  const raw = decoder.decode(bytes);

  const textBlocks: string[] = [];

  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;

  let match: RegExpExecArray | null;

  while ((match = tjRegex.exec(raw)) !== null) {
    const text = match[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    if (text.trim().length > 0) textBlocks.push(text);
  }

  while ((match = tjArrayRegex.exec(raw)) !== null) {
    const inner = match[1];
    const strRegex = /\(([^)]*)\)/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = strRegex.exec(inner)) !== null) {
      const text = strMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')');
      if (text.trim().length > 0) textBlocks.push(text);
    }
  }

  const result = textBlocks.join(' ').replace(/\s{3,}/g, '\n\n').trim();

  // Fallback: printable ASCII chars
  if (result.length < 100) {
    return raw
      .split('')
      .filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127)
      .join('')
      .replace(/\s{3,}/g, '\n\n')
      .trim()
      .slice(0, 50000);
  }

  return result.slice(0, 100000);
}

/**
 * Generates embeddings for an array of text strings using OpenAI Embeddings API (fetch).
 * Processes in batches to respect rate limits.
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH);

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI Embeddings API error: ${response.status} — ${errText}`);
    }

    const json = await response.json();
    for (const item of json.data) {
      embeddings.push(item.embedding);
    }
  }

  return embeddings;
}

// ── Route Handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  console.log('[embed-document] START');

  try {
    // ── 1. Auth ──────────────────────────────────────────────
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Token inválido o sesión expirada' }, { status: 401 });
    }

    // ── 2. Parse body ────────────────────────────────────────
    const body = await request.json();
    const { documentId, workspaceId, storagePath, forceReembed = false } = body;

    if (!documentId || !workspaceId) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: documentId, workspaceId' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // ── 3. Verify workspace membership ───────────────────────
    const { data: member } = await supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ error: 'No tienes acceso a este workspace' }, { status: 403 });
    }

    // ── 4. Verify document belongs to workspace ───────────────
    const { data: doc, error: docError } = await supabase
      .from('documentos')
      .select('id, nombre, file_name, workspace_id')
      .eq('id', documentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (docError || !doc) {
      return NextResponse.json({ error: 'Documento no encontrado en este workspace' }, { status: 404 });
    }

    // ── 5. Check if already embedded (unless forceReembed) ───
    if (!forceReembed) {
      const { count } = await supabase
        .from('ai_document_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', documentId)
        .eq('workspace_id', workspaceId);

      if (count && count > 0) {
        console.log(`[embed-document] Already embedded: ${count} chunks for doc ${documentId}`);
        return NextResponse.json({
          success: true,
          message: 'Documento ya vectorizado',
          chunksCount: count,
          documentId,
          alreadyEmbedded: true,
        });
      }
    }

    // ── 6. Resolve storage path ──────────────────────────────
    const filePath = storagePath || doc.file_name;
    if (!filePath) {
      return NextResponse.json(
        { error: 'No se encontró la ruta del archivo PDF en el documento' },
        { status: 422 }
      );
    }

    // ── 7. Download PDF from Supabase Storage ────────────────
    console.log(`[embed-document] Downloading: ${filePath}`);
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(filePath);

    if (downloadError || !fileData) {
      console.error('[embed-document] Download error:', downloadError);
      return NextResponse.json(
        { error: `No se pudo descargar el archivo: ${downloadError?.message ?? 'unknown'}` },
        { status: 422 }
      );
    }

    // ── 8. Extract text from PDF ─────────────────────────────
    const buffer = await fileData.arrayBuffer();
    const rawText = extractTextFromPdfBuffer(buffer);

    if (!rawText || rawText.length < 50) {
      return NextResponse.json(
        { error: 'No se pudo extraer texto del PDF. El archivo puede estar escaneado o protegido.' },
        { status: 422 }
      );
    }

    console.log(`[embed-document] Extracted ${rawText.length} chars from PDF`);

    // ── 9. Chunk text ────────────────────────────────────────
    const chunks = chunkText(rawText);
    console.log(`[embed-document] Created ${chunks.length} chunks`);

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: 'No se generaron chunks del documento' },
        { status: 422 }
      );
    }

    // ── 10. Generate embeddings via OpenAI Embeddings API ────
    const texts = chunks.map(c => c.content);
    console.log(`[embed-document] Generating embeddings for ${texts.length} chunks...`);
    const embeddings = await generateEmbeddings(texts);

    // ── 11. Delete existing chunks if forceReembed ───────────
    if (forceReembed) {
      await supabase
        .from('ai_document_chunks')
        .delete()
        .eq('document_id', documentId)
        .eq('workspace_id', workspaceId);
      console.log(`[embed-document] Deleted existing chunks for re-embed`);
    }

    // ── 12. Store chunks + embeddings in Supabase ────────────
    const rows = chunks.map((chunk, i) => ({
      workspace_id: workspaceId,
      document_id: documentId,
      content: chunk.content,
      embedding: embeddings[i],
      chunk_index: chunk.chunkIndex,
      page_number: null,
      metadata: {
        document_name: doc.nombre,
        char_count: chunk.content.length,
        embedding_model: EMBEDDING_MODEL,
      },
    }));

    // Insert in batches of 50
    const INSERT_BATCH = 50;
    let insertedCount = 0;
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH);
      const { error: insertError } = await supabase
        .from('ai_document_chunks')
        .insert(batch);

      if (insertError) {
        console.error(`[embed-document] Insert error at batch ${i}:`, insertError);
        throw new Error(`Error al guardar chunks: ${insertError.message}`);
      }
      insertedCount += batch.length;
    }

    console.log(`[embed-document] Stored ${insertedCount} chunks for document ${documentId}`);

    return NextResponse.json({
      success: true,
      message: `Documento vectorizado exitosamente`,
      documentId,
      documentName: doc.nombre,
      chunksCount: insertedCount,
      textLength: rawText.length,
      embeddingModel: EMBEDDING_MODEL,
    });

  } catch (err) {
    console.error('[embed-document] Error:', err);
    return NextResponse.json(
      {
        error: 'Error interno al vectorizar el documento',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
