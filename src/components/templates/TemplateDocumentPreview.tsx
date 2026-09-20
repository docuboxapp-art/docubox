'use client';

import { useMemo } from 'react';
import { applyTemplateFieldValues, type TemplateFieldValues } from '@/lib/templates/document-flow';
import { getTemplatePageDimensions, type PublishedTemplateDocument } from '@/lib/templates/preview';
import { TemplateHtmlPreview } from './TemplateHtmlPreview';

export function TemplateDocumentPreview({
  template,
  values,
  pageIndex = 0,
  zoom = 100,
  final = false,
  title,
  onPageCountChange,
}: {
  template: PublishedTemplateDocument;
  values: TemplateFieldValues;
  pageIndex?: number;
  zoom?: number;
  final?: boolean;
  title?: string;
  onPageCountChange?: (pageCount: number) => void;
}) {
  const renderedTemplate = useMemo(
    () => applyTemplateFieldValues(template, values, { final }),
    [final, template, values]
  );
  const dimensions = getTemplatePageDimensions(renderedTemplate);
  const scale = Math.max(0.5, Math.min(2, zoom / 100));

  return (
    <div
      className="flex-shrink-0 overflow-hidden border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
      style={{ width: dimensions.width * scale }}
    >
      <TemplateHtmlPreview
        template={renderedTemplate}
        pageIndex={pageIndex}
        title={title}
        onPageCountChange={onPageCountChange}
      />
    </div>
  );
}
