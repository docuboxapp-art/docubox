'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  buildTemplatePagePreviewDocumentFromSnapshot,
  getTemplatePageCount,
  getTemplatePageDimensions,
  resolveTemplatePreviewSnapshot,
  splitTemplateHtml,
  type PublishedTemplateDocument,
  type TemplatePreviewSnapshot,
} from '@/lib/templates/preview';

export type TemplatePreviewFieldMeasurement = {
  id: string;
  label: string;
  fieldType: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function TemplateHtmlPreview({
  template,
  pageIndex = 0,
  className = '',
  title,
  onFieldsMeasured,
  onPageCountChange,
}: {
  template: PublishedTemplateDocument;
  pageIndex?: number;
  className?: string;
  title?: string;
  onFieldsMeasured?: (fields: TemplatePreviewFieldMeasurement[]) => void;
  onPageCountChange?: (pageCount: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const { width, height } = getTemplatePageDimensions(template);
  const serializedSnapshot = useMemo(
    () => splitTemplateHtml(template.contenido_html || ''),
    [template]
  );
  const [snapshot, setSnapshot] = useState<TemplatePreviewSnapshot>(serializedSnapshot);
  const srcDoc = useMemo(
    () => buildTemplatePagePreviewDocumentFromSnapshot(template, snapshot, pageIndex),
    [pageIndex, snapshot, template]
  );
  const scale = containerWidth > 0 ? containerWidth / width : 1;

  useEffect(() => {
    let cancelled = false;
    setSnapshot(serializedSnapshot);
    onPageCountChange?.(Math.max(serializedSnapshot.pages.length, getTemplatePageCount(template)));
    void resolveTemplatePreviewSnapshot(template).then((resolved) => {
      if (cancelled) return;
      setSnapshot(resolved);
      onPageCountChange?.(resolved.pages.length);
    });
    return () => {
      cancelled = true;
    };
  }, [onPageCountChange, serializedSnapshot, template]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden bg-white ${className}`}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        tabIndex={-1}
        title={title || `Vista previa de ${template.nombre}`}
        onLoad={async (event) => {
          if (!onFieldsMeasured) return;
          const frame = event.currentTarget;
          const frameDocument = frame.contentDocument;
          const page = frameDocument?.querySelector('.template-preview-page');
          if (!frameDocument || !page) return;
          await frameDocument.fonts?.ready;
          await Promise.all(
            Array.from(frameDocument.images).map(async (image) => {
              if (image.complete) return;
              await new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true });
                image.addEventListener('error', () => resolve(), { once: true });
              });
            })
          );
          if (!frame.isConnected || frame.contentDocument !== frameDocument) return;
          const pageRect = page.getBoundingClientRect();
          if (pageRect.width <= 0 || pageRect.height <= 0) return;
          const fields = Array.from(page.querySelectorAll<HTMLElement>('[data-field-id]')).map(
            (field) => {
              const rect = field.getBoundingClientRect();
              return {
                id: field.dataset.fieldId || '',
                label: field.dataset.fieldLabel || field.textContent?.trim() || 'Campo',
                fieldType: field.dataset.fieldType || 'text',
                pageIndex,
                x: ((rect.left - pageRect.left) / pageRect.width) * 100,
                y: ((rect.top - pageRect.top) / pageRect.height) * 100,
                width: (rect.width / pageRect.width) * 100,
                height: (rect.height / pageRect.height) * 100,
              };
            }
          );
          onFieldsMeasured(fields.filter((field) => field.id));
        }}
        className="pointer-events-none absolute left-0 top-0 border-0 bg-white"
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

export function TemplatePreviewModal({
  template,
  onClose,
}: {
  template: PublishedTemplateDocument;
  onClose: () => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(() => getTemplatePageCount(template));

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[1px]">
      <section className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <header className="shrink-0 border-b border-slate-200 px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-950">Vista previa</h2>
            <p className="truncate text-xs text-slate-500">{template.nombre}</p>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-slate-100 p-6">
          <div className="w-full max-w-[816px] border border-slate-200 bg-white shadow-lg">
            <TemplateHtmlPreview
              template={template}
              pageIndex={pageIndex}
              onPageCountChange={setPageCount}
            />
          </div>
        </div>
        <footer className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-slate-200 px-5 py-3">
          <span />
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
              disabled={pageIndex === 0}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
              aria-label="Página anterior"
              title="Página anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-24 text-center text-xs font-medium text-slate-600">
              Página {pageIndex + 1} de {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
              disabled={pageIndex >= pageCount - 1}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
              aria-label="Página siguiente"
              title="Página siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="justify-self-end h-9 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cerrar
          </button>
        </footer>
      </section>
    </div>
  );
}
