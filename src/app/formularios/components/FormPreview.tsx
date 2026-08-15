'use client';

import React, { useMemo, useState } from 'react';
import { CheckCircle2, FileCheck2, FileText, Hash, QrCode, ShieldCheck } from 'lucide-react';
import type { FormTemplate } from '@/contexts/FormBuilderContext';
import { sampleValueForField } from '@/lib/forms/schema';
import FieldRenderer from './FieldRenderer';

interface FormPreviewProps {
  template: FormTemplate;
  mode: 'web' | 'pdf';
  values?: Record<string, unknown>;
  interactive?: boolean;
  onValuesChange?: (values: Record<string, unknown>) => void;
}

export default function FormPreview({ template, mode, values: controlledValues, interactive = false, onValuesChange }: FormPreviewProps) {
  const [internalValues, setInternalValues] = useState<Record<string, unknown>>({});
  const values = controlledValues || internalValues;
  const setValue = (fieldId: string, value: unknown) => {
    const next = { ...values, [fieldId]: value };
    setInternalValues(next);
    onValuesChange?.(next);
  };

  if (mode === 'web') {
    return (
      <div className="mx-auto w-full max-w-2xl rounded-lg border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card">
        <div className="h-1.5 rounded-t-lg" style={{ backgroundColor: template.settings.pdfSchema.primaryColor }} />
        <div className="border-b border-[#E2E8F0] px-6 py-6 dark:border-border">
          <p className="text-[11px] font-semibold uppercase text-[#1E6BFF]">Formulario firmable</p>
          <h2 className="mt-2 text-xl font-semibold text-[#0F172A] dark:text-foreground">{template.name}</h2>
          <p className="mt-2 text-sm leading-6 text-[#475569] dark:text-muted-foreground">{template.description}</p>
        </div>
        <div className="space-y-6 p-6">
          {template.sections.map((section, index) => {
            const fields = template.schema.filter((field) => field.sectionId === section.id);
            if (!fields.length) return null;
            return (
              <section key={section.id}>
                <div className="mb-4 flex items-start gap-3">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-[#EFF6FF] text-xs font-semibold text-[#1E6BFF]">{index + 1}</span>
                  <div>
                    <h3 className="text-sm font-semibold text-[#0F172A] dark:text-foreground">{section.title}</h3>
                    {section.description && <p className="mt-1 text-xs text-[#64748B]">{section.description}</p>}
                  </div>
                </div>
                <div className="space-y-5 pl-10">
                  {fields.map((field) => interactive
                    ? <FieldRenderer key={field.id} field={field} value={values[field.id]} onChange={(value) => setValue(field.id, value)} />
                    : <StaticField key={field.id} field={field} />)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  return <PdfMirror template={template} values={values} />;
}

function StaticField({ field }: { field: FormTemplate['schema'][number] }) {
  const optionLabels = field.options?.map((option) => option.label).join('   ○   ');
  const isLegal = ['consentimiento', 'declaration', 'firma_click', 'signature_block', 'firma_efirma', 'firma_autografa'].includes(field.type);
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-medium text-[#1E293B] dark:text-foreground">{field.label}</p>
        {field.required && <span className="text-red-500">*</span>}
      </div>
      {field.description && <p className="mt-1 text-xs leading-5 text-[#64748B]">{field.description}</p>}
      <div className={`mt-2 min-h-10 rounded-md border px-3 py-2 text-xs ${isLegal ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8] dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300' : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#94A3B8] dark:border-border dark:bg-muted dark:text-muted-foreground'}`}>
        {isLegal ? 'Bloque de aceptación y evidencia legal' : optionLabels || field.placeholder || 'Respuesta del participante'}
      </div>
    </div>
  );
}

function PdfMirror({ template, values }: { template: FormTemplate; values: Record<string, unknown> }) {
  const pdf = template.settings.pdfSchema;
  const folio = useMemo(() => `FORM-${new Date().getFullYear()}-000123`, []);
  const hash = '8f3a9d74b19e7c641f42d2d57a3bb9f86f943d916e7036f1e85618c6c72a982b';

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-4">
      {pdf.coverPage && (
        <div className="aspect-[8.5/11] bg-white p-12 shadow-[0_10px_35px_rgba(24,24,27,0.10)]">
          <div className="flex h-full flex-col justify-between border border-[#E2E8F0] p-10">
            <div><p className="text-xs font-semibold uppercase" style={{ color: pdf.primaryColor }}>{pdf.header}</p></div>
            <div>
              <FileCheck2 size={36} style={{ color: pdf.primaryColor }} />
              <h2 className="mt-6 text-3xl font-semibold text-[#0F172A]">{template.name}</h2>
              <p className="mt-4 max-w-lg text-sm leading-6 text-[#475569]">{template.description}</p>
            </div>
            <div className="text-xs text-[#64748B]">{folio} · {new Date().toLocaleDateString('es-MX')}</div>
          </div>
        </div>
      )}

      <div className="min-h-[980px] bg-white p-10 shadow-[0_10px_35px_rgba(24,24,27,0.10)] sm:p-14">
        <header className="flex items-start justify-between gap-6 border-b border-[#E2E8F0] pb-5">
          <div>
            <p className="text-[10px] font-semibold uppercase" style={{ color: pdf.primaryColor }}>{pdf.header}</p>
            <h2 className="mt-2 text-xl font-semibold text-[#0F172A]">{template.name}</h2>
          </div>
          <div className="text-right text-[10px] leading-5 text-[#64748B]">
            {pdf.showFolio && <p>Folio: <span className="font-medium text-[#1E293B]">{folio}</span></p>}
            {pdf.showDate && <p>Fecha: {new Date().toLocaleDateString('es-MX')}</p>}
          </div>
        </header>

        <div className="mt-6 space-y-7">
          {template.sections.filter((section) => section.showInPdf).map((section, index) => {
            const fields = template.schema.filter((field) =>
              (field.pdf?.sectionId || field.sectionId) === section.id && field.pdf?.show !== false
            );
            if (!fields.length) return null;
            return (
              <section key={section.id} className={section.pageBreakBefore && index > 0 ? 'border-t-2 border-dashed border-[#CBD5E1] pt-6' : ''}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="h-5 w-1 rounded-full" style={{ backgroundColor: pdf.primaryColor }} />
                  <h3 className="text-sm font-semibold text-[#0F172A]">{index + 1}. {section.title}</h3>
                </div>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                  {fields.map((field) => (
                    <div key={field.id} className={['textarea', 'fiscal_address', 'declaration', 'consentimiento', 'signature_block'].includes(field.type) ? 'sm:col-span-2' : ''}>
                      <dt className="text-[10px] font-medium uppercase text-[#64748B]">{field.pdf?.label || field.label}</dt>
                      <dd className="mt-1 border-b border-[#CBD5E1] pb-2 text-xs leading-5 text-[#1E293B]">{formatPdfValue(values[field.id] ?? sampleValueForField(field))}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>

        {(pdf.showHash || pdf.showQr || pdf.showAuditTrail || pdf.showEvidenceSheet) && (
          <section className="mt-10 border-t border-[#E2E8F0] pt-5">
            <div className="flex items-start gap-5">
              {pdf.showQr && <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center border border-[#CBD5E1] bg-white"><QrCode size={54} className="text-[#0F172A]" /></div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-600" /><p className="text-xs font-semibold text-[#0F172A]">Evidencia e integridad</p></div>
                {pdf.showHash && <div className="mt-2 flex gap-2 text-[9px] leading-4 text-[#64748B]"><Hash size={11} className="mt-0.5 flex-shrink-0" /><span className="break-all">SHA-256 {hash}</span></div>}
                {pdf.showAuditTrail && <p className="mt-2 text-[9px] leading-4 text-[#64748B]">Bitácora: creación, apertura, llenado, generación de PDF y eventos de firma registrados.</p>}
              </div>
            </div>
          </section>
        )}

        <footer className="mt-8 flex items-center justify-between border-t border-[#E2E8F0] pt-3 text-[9px] text-[#94A3B8]">
          <span>{pdf.footer}</span>
          {pdf.showPageNumbers && <span>Página 1 de 1</span>}
        </footer>
      </div>
    </div>
  );
}

function formatPdfValue(value: unknown): string {
  if (value === true) return 'Sí, acepto';
  if (value === false) return 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return 'Evidencia capturada';
  return String(value ?? '—');
}
