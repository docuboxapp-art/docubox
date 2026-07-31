import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

// =============================================================================
// MÓDULO: analyzePdfMetadata
// Plataforma: DOCUBOX — Análisis de metadatos PDF
// =============================================================================
//
// Analiza los metadatos de un PDF ya sanitizado usando únicamente pdf-lib.
// Cada análisis individual está aislado en su propio try/catch para garantizar
// que un fallo parcial no detenga el flujo principal de upload.
// =============================================================================

// Prefijo estándar para todos los logs de este módulo
const LOG_PREFIX = "[DOCUBOX][metadata]";

// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------

/** Resultado del análisis de metadatos PDF listo para INSERT en document_metadata */
export interface PdfMetadataResult {
  document_id: string;
  pdf_page_count: number | null;
  pdf_is_native: boolean | null;
  pdf_has_acroform: boolean | null;
  pdf_has_prior_sigs: boolean | null;
  pdf_author: string | null;
  pdf_creator_software: string | null;
  pdf_created_at: string | null;
  pdf_modified_at: string | null;
  pdf_metadata_raw: Record<string, unknown> | null;
  analysis_version: string;
}

// ---------------------------------------------------------------------------
// FUNCIÓN PRINCIPAL
// ---------------------------------------------------------------------------

/**
 * Analiza los metadatos de un PDF sanitizado usando pdf-lib.
 *
 * @param pdfBytes   - Bytes del PDF ya validado y sanitizado
 * @param documentId - UUID del registro en la tabla documents
 * @returns          - Objeto con todos los campos listos para INSERT en document_metadata
 */
export async function analyzePdfMetadata(
  pdfBytes: Uint8Array,
  documentId: string
): Promise<PdfMetadataResult> {
  // Resultado base con todos los campos en null (defensivo)
  const result: PdfMetadataResult = {
    document_id: documentId,
    pdf_page_count: null,
    pdf_is_native: null,
    pdf_has_acroform: null,
    pdf_has_prior_sigs: null,
    pdf_author: null,
    pdf_creator_software: null,
    pdf_created_at: null,
    pdf_modified_at: null,
    pdf_metadata_raw: null,
    analysis_version: "1.0",
  };

  // Cargar el documento PDF una sola vez
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (err) {
    console.warn(`${LOG_PREFIX} No se pudo cargar el PDF para análisis:`, err);
    return result;
  }

  // ─── ANÁLISIS 1: Número de páginas ────────────────────────────────────────
  try {
    result.pdf_page_count = doc.getPageCount();
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error al obtener número de páginas:`, err);
  }

  // ─── ANÁLISIS 2: PDF nativo vs escaneado ──────────────────────────────────
  // Detecta la presencia de operadores de texto (Tj, TJ, Tf) en los content
  // streams de las primeras 3 páginas. pdf-lib no extrae texto directamente,
  // pero permite inspeccionar el stream de contenido como string.
  try {
    const pagesToCheck = Math.min(3, doc.getPageCount());
    let foundText = false;

    for (let i = 0; i < pagesToCheck; i++) {
      try {
        const page = doc.getPage(i);
        // Obtener el nodo de la página para inspeccionar sus streams
        const pageNode = page.node;
        const contentsRef = pageNode.get(pageNode.context.obj("Contents") as any);

        if (contentsRef) {
          // Intentar obtener el stream como bytes y convertir a string
          try {
            const contentsObj = doc.context.lookup(contentsRef as any) as any;
            if (contentsObj) {
              let streamBytes: Uint8Array | null = null;

              // Puede ser un array de streams o un stream único
              if (typeof contentsObj.asArray === "function") {
                const arr = contentsObj.asArray();
                for (const ref of arr) {
                  try {
                    const stream = doc.context.lookup(ref) as any;
                    if (stream && typeof stream.getContents === "function") {
                      streamBytes = stream.getContents();
                      break;
                    }
                  } catch { /* continuar con el siguiente */ }
                }
              } else if (typeof contentsObj.getContents === "function") {
                streamBytes = contentsObj.getContents();
              }

              if (streamBytes) {
                // Decodificar los bytes del stream como texto ASCII
                const streamText = new TextDecoder("latin1").decode(streamBytes);
                // Buscar operadores de texto PDF: Tj (mostrar texto), TJ (mostrar array de texto), Tf (seleccionar fuente)
                if (/\bTj\b|\bTJ\b|\bTf\b/.test(streamText)) {
                  foundText = true;
                  break;
                }
              }
            }
          } catch { /* ignorar errores de stream individual */ }
        }
      } catch { /* ignorar errores de página individual */ }
    }

    result.pdf_is_native = foundText;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error al detectar tipo de PDF (nativo/escaneado):`, err);
  }

  // ─── ANÁLISIS 3: AcroForm ─────────────────────────────────────────────────
  // Verifica si el PDF tiene un formulario AcroForm con campos interactivos.
  const rawMetadata: Record<string, unknown> = {};

  try {
    const form = doc.getForm();
    const fields = form.getFields();
    result.pdf_has_acroform = fields.length > 0;
    // Guardar conteo de campos en raw para referencia
    rawMetadata.acroform_field_count = fields.length;
    rawMetadata.acroform_field_names = fields.map((f) => {
      try { return f.getName(); } catch { return null; }
    }).filter(Boolean);
  } catch {
    // getForm() lanza si no hay AcroForm — es comportamiento esperado
    result.pdf_has_acroform = false;
    rawMetadata.acroform_field_count = 0;
  }

  // ─── ANÁLISIS 4: Firmas previas ───────────────────────────────────────────
  // Busca campos de tipo /Sig en el catálogo AcroForm del PDF.
  try {
    const catalog = doc.context.lookup(doc.context.trailerInfo.Root) as any;
    let hasSig = false;

    if (catalog) {
      const acroFormRef = catalog.get(catalog.context.obj("AcroForm") as any);
      if (acroFormRef) {
        const acroForm = doc.context.lookup(acroFormRef as any) as any;
        if (acroForm) {
          const fieldsRef = acroForm.get(acroForm.context.obj("Fields") as any);
          if (fieldsRef) {
            const fieldsArray = doc.context.lookup(fieldsRef as any) as any;
            if (fieldsArray && typeof fieldsArray.asArray === "function") {
              for (const fieldRef of fieldsArray.asArray()) {
                try {
                  const field = doc.context.lookup(fieldRef) as any;
                  if (field) {
                    const ftRef = field.get(field.context.obj("FT") as any);
                    if (ftRef) {
                      const ftStr = ftRef.toString();
                      if (ftStr === "/Sig" || ftStr === "Sig") {
                        hasSig = true;
                        break;
                      }
                    }
                  }
                } catch { /* ignorar campo individual */ }
              }
            }
          }
        }
      }
    }

    result.pdf_has_prior_sigs = hasSig;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error al detectar firmas previas:`, err);
  }

  // ─── ANÁLISIS 5: Metadatos embebidos ──────────────────────────────────────
  // Extrae todos los metadatos estándar del PDF y los mapea a columnas.

  // Autor del documento
  try {
    const author = doc.getAuthor();
    result.pdf_author = author ?? null;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error al obtener autor:`, err);
  }

  // Software creador
  try {
    const creator = doc.getCreator();
    result.pdf_creator_software = creator ?? null;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error al obtener software creador:`, err);
  }

  // Fecha de creación embebida
  try {
    const creationDate = doc.getCreationDate();
    result.pdf_created_at = creationDate ? creationDate.toISOString() : null;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error al obtener fecha de creación:`, err);
  }

  // Fecha de modificación embebida
  try {
    const modDate = doc.getModificationDate();
    result.pdf_modified_at = modDate ? modDate.toISOString() : null;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error al obtener fecha de modificación:`, err);
  }

  // Metadatos adicionales → pdf_metadata_raw
  try {
    const title = doc.getTitle();
    if (title) rawMetadata.title = title;
  } catch { /* ignorar */ }

  try {
    const subject = doc.getSubject();
    if (subject) rawMetadata.subject = subject;
  } catch { /* ignorar */ }

  try {
    const keywords = doc.getKeywords();
    if (keywords) rawMetadata.keywords = keywords;
  } catch { /* ignorar */ }

  try {
    const producer = doc.getProducer();
    if (producer) rawMetadata.producer = producer;
  } catch { /* ignorar */ }

  // Guardar raw solo si tiene contenido
  result.pdf_metadata_raw = Object.keys(rawMetadata).length > 0 ? rawMetadata : null;

  return result;
}
