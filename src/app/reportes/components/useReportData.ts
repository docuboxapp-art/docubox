'use client';

import { useEffect, useState } from 'react';
import type { DatasetId, ReportConfig } from '@/lib/reporting/catalog';
import { fetchReportData, type ReportClient, type ReportData } from '@/lib/reporting/client';

export function useReportData(
  db: ReportClient,
  workspaceId: string,
  dataset: DatasetId,
  { formId, period, dateField }: Pick<ReportConfig, 'formId' | 'period' | 'dateField'>
) {
  const [revision, setRevision] = useState(0);
  const key = [workspaceId, dataset, formId, period, dateField, revision].join(':');
  const [result, setResult] = useState<{
    key: string;
    data?: ReportData;
    error?: string;
  } | null>(null);
  const [formOptions, setFormOptions] = useState<NonNullable<ReportData['formOptions']>>([]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchReportData(db, workspaceId, dataset, { formId, period, dateField }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setResult({ key, data });
        if (data.formOptions) setFormOptions(data.formOptions);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error: cause instanceof Error ? cause.message : 'No se pudo cargar el informe.',
          });
      });
    return () => controller.abort();
  }, [db, workspaceId, key, dataset, formId, period, dateField]);

  return {
    data: result?.key === key ? result.data : undefined,
    error: result?.key === key ? result.error : undefined,
    loading: result?.key !== key,
    formOptions,
    reload: () => setRevision((value) => value + 1),
  };
}
