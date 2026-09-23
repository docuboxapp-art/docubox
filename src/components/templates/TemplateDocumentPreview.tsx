'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { applyTemplateFieldValues, type TemplateFieldValues } from '@/lib/templates/document-flow';
import { getTemplatePageDimensions, type PublishedTemplateDocument } from '@/lib/templates/preview';
import { TemplateHtmlPreview, type TemplatePreviewFieldMeasurement } from './TemplateHtmlPreview';

export function TemplateDocumentPreview({
  template,
  values,
  pageIndex = 0,
  zoom = 100,
  final = false,
  title,
  onPageCountChange,
  signatureStamp,
  signatureFieldIds,
}: {
  template: PublishedTemplateDocument;
  values: TemplateFieldValues;
  pageIndex?: number;
  zoom?: number;
  final?: boolean;
  title?: string;
  onPageCountChange?: (pageCount: number) => void;
  signatureStamp?: ReactNode;
  signatureFieldIds?: string[];
}) {
  const [measured, setMeasured] = useState<{
    pageIndex: number;
    fields: TemplatePreviewFieldMeasurement[];
  }>({
    pageIndex: -1,
    fields: [],
  });
  const handleFieldsMeasured = useCallback(
    (fields: TemplatePreviewFieldMeasurement[]) => {
      setMeasured((current) =>
        current.pageIndex === pageIndex && JSON.stringify(current.fields) === JSON.stringify(fields)
          ? current
          : { pageIndex, fields }
      );
    },
    [pageIndex]
  );
  const renderedTemplate = useMemo(
    () => applyTemplateFieldValues(template, values, { final }),
    [final, template, values]
  );
  const dimensions = getTemplatePageDimensions(renderedTemplate);
  const scale = Math.max(0.5, Math.min(2, zoom / 100));

  return (
    <div
      className="relative flex-shrink-0 overflow-hidden border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
      style={{ width: dimensions.width * scale }}
    >
      <TemplateHtmlPreview
        template={renderedTemplate}
        pageIndex={pageIndex}
        title={title}
        onPageCountChange={onPageCountChange}
        onFieldsMeasured={signatureStamp ? handleFieldsMeasured : undefined}
      />
      {signatureStamp &&
        measured.pageIndex === pageIndex &&
        measured.fields
          .filter((field) => signatureFieldIds?.includes(field.id))
          .map((field) => (
            <div
              key={field.id}
              className="pointer-events-none absolute overflow-hidden border border-blue-500 bg-white"
              style={{
                left: `${field.x}%`,
                top: `${field.y}%`,
                width: `${field.width}%`,
                height: `${field.height}%`,
              }}
            >
              {signatureStamp}
            </div>
          ))}
    </div>
  );
}
