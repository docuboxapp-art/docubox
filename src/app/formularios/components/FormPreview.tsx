'use client';

import React, { useMemo, useState } from 'react';
import { FileCheck2, Hash, QrCode, ShieldCheck } from 'lucide-react';
import type { FormTemplate } from '@/contexts/FormBuilderContext';
import type { SignatureType } from '@/lib/forms/schema';
import { sampleValueForField } from '@/lib/forms/schema';
import { formFontFamily } from '@/lib/typography/font-families';
import { useFormTypography } from '@/hooks/useFormTypography';
import { formatFormFieldValue, isFormFieldRequired, isFormFieldVisible } from '@/lib/forms/field-behavior';
import FieldRenderer from './FieldRenderer';
import { FormWebHeader } from './FormWebHeader';

interface FormPreviewProps {
  template: FormTemplate;
  mode: 'web' | 'pdf';
  values?: Record<string, unknown>;
  interactive?: boolean;
  onValuesChange?: (values: Record<string, unknown>) => void;
  designPreview?: boolean;
  documentTypeName?: string;
  signatureType?: SignatureType;
}

export default function FormPreview({ template, mode, values: controlledValues, interactive = false, onValuesChange, designPreview = false, documentTypeName, signatureType }: FormPreviewProps) {
  const [internalValues, setInternalValues] = useState<Record<string, unknown>>({});
  const values = controlledValues || internalValues;
  const appearance = template.settings.appearance;
  useFormTypography(mode === 'web' ? appearance.typography : template.settings.pdfSchema.typography);
  const setValue = (fieldId: string, value: unknown) => {
    const next = { ...values, [fieldId]: value };
    setInternalValues(next);
    onValuesChange?.(next);
  };

  if (mode === 'web') {
    return (
      <div className="mx-auto w-full max-w-2xl rounded-lg border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card" style={{ accentColor: appearance.accentColor, maxWidth: appearance.width === 'wide' ? 960 : 672, fontFamily: formFontFamily(appearance.typography) }}>
        {appearance.showAccentBar && <div className="h-1.5 rounded-t-lg" style={{ backgroundColor: appearance.accentColor }} />}
        {designPreview && appearance.showProgressBar && <div className="h-1 bg-slate-100"><div className="h-full w-1/3" style={{ backgroundColor: appearance.accentColor }} /></div>}
        <FormWebHeader template={template} documentTypeName={documentTypeName} />
        <div className={`${appearance.compactSpacing ? 'space-y-4' : 'space-y-6'} p-6`}>
          {designPreview && template.schema.length === 0 && (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Los campos que agregues en Contenido aparecerán aquí.
            </div>
          )}
          {template.sections.map((section, index) => {
            const fields = template.schema.filter((field) => field.sectionId === section.id && isFormFieldVisible(field, values));
            if (!fields.length) return null;
            return (
              <section key={section.id}>
                <div className="mb-4 flex items-start gap-3">
                  {appearance.showSectionNumbers && <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-[#EFF6FF] text-xs font-semibold" style={{ color: appearance.accentColor }}>{index + 1}</span>}
                  <div>
                    <h3 className="text-sm font-semibold text-[#0F172A] dark:text-foreground">{section.title}</h3>
                    {appearance.showSectionDescriptions && section.description && <p className="mt-1 text-xs text-[#64748B]">{section.description}</p>}
                  </div>
                </div>
                <fieldset disabled={!interactive} className={`${appearance.compactSpacing ? 'space-y-3' : 'space-y-5'} ${appearance.showSectionNumbers ? 'sm:pl-10' : ''} ${!interactive ? 'pointer-events-none' : ''}`}>
                  {fields.map((field) => <FieldRenderer key={field.id} field={field} value={values[field.id] ?? field.defaultValue} requiredOverride={isFormFieldRequired(field, values)} onChange={(value) => setValue(field.id, value)} />)}
                </fieldset>
              </section>
            );
          })}
        </div>
        {appearance.showFooter && appearance.footerText && (
          <footer className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500" style={{ textAlign: appearance.footerAlignment }}>
            {appearance.footerText}
          </footer>
        )}
      </div>
    );
  }

  return <PdfMirror template={template} values={values} example={controlledValues === undefined} designPreview={designPreview} signatureType={signatureType} />;
}

function PdfMirror({ template, values, example, designPreview, signatureType }: { template: FormTemplate; values: Record<string, unknown>; example: boolean; designPreview: boolean; signatureType?: SignatureType }) {
  const pdf = template.settings.pdfSchema;
  const folio = useMemo(() => `FORM-${new Date().getFullYear()}-000123`, []);
  const hash = '8f3a9d74b19e7c641f42d2d57a3bb9f86f943d916e7036f1e85618c6c72a982b';
  const signatureMethod = signatureType === 'efirma_sat' ? 'e.firma SAT' : signatureType === 'autografa_digital' ? 'Firma autógrafa digital' : 'Click & Sign';
  const hasVisibleSignatureBlock = template.sections.some((section) => section.showInPdf !== false && template.schema.some((field) =>
    field.type === 'signature_block' && (field.pdf?.sectionId || field.sectionId) === section.id && field.pdf?.show !== false && isFormFieldVisible(field, values)
  ));

  return (
    <div className="mx-auto w-full space-y-4" style={{ maxWidth: pdf.orientation === 'landscape' ? 980 : 760, fontFamily: formFontFamily(pdf.typography) }}>
      {pdf.coverPage && (
        <div className="bg-white p-12 shadow-[0_10px_35px_rgba(24,24,27,0.10)]" style={{ aspectRatio: pdf.orientation === 'landscape' ? (pdf.pageSize === 'a4' ? '297/210' : '11/8.5') : (pdf.pageSize === 'a4' ? '210/297' : '8.5/11') }}>
          <div className="flex h-full flex-col justify-between border border-[#E2E8F0] p-10">
            <div><p className="text-xs font-semibold uppercase" style={{ color: pdf.primaryColor }}>{pdf.header}</p></div>
            <div>
              <FileCheck2 size={36} style={{ color: pdf.primaryColor }} />
              <h2 className="mt-6 text-3xl font-semibold text-[#0F172A]">{template.name}</h2>
              {pdf.showDescription && <p className="mt-4 max-w-lg text-sm leading-6 text-[#475569]">{template.description}</p>}
            </div>
            <div className="text-xs text-[#64748B]">{[pdf.showFolio ? folio : '', pdf.showDate ? new Date().toLocaleDateString('es-MX') : ''].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
      )}

      <div className="bg-white shadow-[0_10px_35px_rgba(24,24,27,0.10)]" style={{ minHeight: pdf.orientation === 'landscape' ? 680 : 980, padding: pdf.margins === 'narrow' ? 24 : pdf.margins === 'wide' ? 72 : 48, aspectRatio: pdf.orientation === 'landscape' ? (pdf.pageSize === 'a4' ? '297/210' : '11/8.5') : (pdf.pageSize === 'a4' ? '210/297' : '8.5/11') }}>
        <header className="flex items-start justify-between gap-6 border-b border-[#E2E8F0] pb-5">
          <div className="flex-1" style={{ textAlign: pdf.headerAlignment }}>
            <p className="text-[10px] font-semibold uppercase" style={{ color: pdf.primaryColor }}>{pdf.header}</p>
            <h2 className="mt-2 text-xl font-semibold text-[#0F172A]">{template.name}</h2>
            {pdf.showDescription && template.description && <p className="mt-2 text-xs text-slate-500">{template.description}</p>}
          </div>
          <div className="text-right text-[10px] leading-5 text-[#64748B]">
            {pdf.showFolio && <p>Folio: <span className="font-medium text-[#1E293B]">{folio}</span></p>}
            {pdf.showDate && <p>Fecha: {new Date().toLocaleDateString('es-MX')}</p>}
          </div>
        </header>

        {(pdf.showRespondentEmail || pdf.showIp) && <div className="mt-4 space-y-1 text-[10px] text-[#64748B]">
          {pdf.showRespondentEmail && <p>Correo del participante: {String(template.schema.find((field) => field.type === 'email') ? 'participante@ejemplo.com' : 'No proporcionado')}</p>}
          {pdf.showIp && <p>Dirección IP: 192.0.2.1</p>}
        </div>}

        <div className="mt-6 space-y-7">
          {designPreview && template.schema.length === 0 && (
            <div className="rounded-md border border-dashed border-slate-200 px-4 py-10 text-center text-xs text-slate-500">
              Las respuestas y secciones aparecerán aquí al agregar campos.
            </div>
          )}
          {template.sections.filter((section) => section.showInPdf !== false).map((section, index) => {
            const fields = template.schema.filter((field) =>
              (field.pdf?.sectionId || field.sectionId) === section.id && field.pdf?.show !== false && isFormFieldVisible(field, values) && (field.type === 'signature_block' || example || pdf.showUnanswered || (values[field.id] !== undefined && values[field.id] !== null && values[field.id] !== ''))
            );
            if (!fields.length) return null;
            return (
              <section key={section.id} className={section.pageBreakBefore && index > 0 ? 'border-t-2 border-dashed border-[#CBD5E1] pt-6' : ''}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="h-5 w-1 rounded-full" style={{ backgroundColor: pdf.primaryColor }} />
                  <h3 className="text-sm font-semibold text-[#0F172A]">{pdf.showSectionNumbers ? `${index + 1}. ` : ''}{section.title}</h3>
                </div>
                <dl className={`grid grid-cols-1 gap-x-8 gap-y-3 ${pdf.columns === 'two' ? 'sm:grid-cols-2' : ''}`}>
                  {fields.map((field) => (
                    <div key={field.id} className={`${pdf.columns === 'two' && ['textarea', 'fiscal_address', 'declaration', 'consentimiento', 'signature_block'].includes(field.type) ? 'sm:col-span-2' : ''} ${field.pdf?.pageBreakBefore ? 'border-t-2 border-dashed border-[#CBD5E1] pt-3 sm:col-span-2' : ''}`}>
                      <dt className="text-[10px] font-medium uppercase text-[#64748B]">{field.pdf?.label || field.label}</dt>
                      <dd className={field.type === 'signature_block' ? 'mt-1 flex h-20 items-center justify-center border border-[#CBD5E1] text-xs text-[#64748B]' : 'mt-1 border-b border-[#CBD5E1] pb-2 text-xs leading-5 text-[#1E293B]'}>
                        {field.type === 'signature_block' ? (signatureType ? `Espacio reservado para ${signatureMethod}` : 'Espacio reservado para firma') : formatFormFieldValue(field, values[field.id] ?? (example ? sampleValueForField(field) : undefined))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
          {signatureType && !hasVisibleSignatureBlock && (
            <section>
              <p className="text-[10px] font-medium uppercase text-[#64748B]">Firma del participante</p>
              <div className="mt-1 flex h-20 items-center justify-center border border-[#CBD5E1] text-xs text-[#64748B]">Espacio reservado para {signatureMethod}</div>
            </section>
          )}
        </div>

        {signatureType && <p className="mt-5 text-[10px] text-[#64748B]">Vista previa antes de firmar. La estampa elegida y sus datos de firma aparecerán en el PDF final.{pdf.showQr ? ' El QR de verificación se incorporará a la evidencia.' : ''}</p>}

        {(pdf.showHash || pdf.showQr || pdf.showAuditTrail || pdf.showEvidenceSheet) && (
          <section className="mt-10 border-t border-[#E2E8F0] pt-5">
            <div className="flex items-start gap-5">
              {pdf.showQr && <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center border border-[#CBD5E1] bg-white"><QrCode size={54} className="text-[#0F172A]" /></div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-600" /><p className="text-xs font-semibold text-[#0F172A]">Evidencia e integridad</p></div>
                {pdf.showEvidenceSheet && <p className="mt-2 text-[9px] leading-4 text-[#64748B]">ID de respuesta · {pdf.showFolio ? `Folio ${folio} · ` : ''}fecha y dispositivo de envío</p>}
                {pdf.showHash && <div className="mt-2 flex gap-2 text-[9px] leading-4 text-[#64748B]"><Hash size={11} className="mt-0.5 flex-shrink-0" /><span className="break-all">SHA-256 de respuestas: {hash}</span></div>}
                {pdf.showAuditTrail && <p className="mt-2 text-[9px] leading-4 text-[#64748B]">Bitácora: eventos registrados para esta respuesta.</p>}
              </div>
            </div>
          </section>
        )}

        {pdf.consentPage && <section className="mt-8 border-t-2 border-dashed border-[#CBD5E1] pt-5 text-xs text-[#475569]">
          <p className="font-semibold text-[#0F172A]">Hoja de consentimiento y declaraciones</p>
          <p className="mt-2">Incluye las respuestas de los campos de consentimiento y declaración.</p>
        </section>}
        {pdf.showAttachments && template.schema.some((field) => field.type === 'imagen' || field.type === 'documento') && <section className="mt-8 border-t-2 border-dashed border-[#CBD5E1] pt-5 text-xs text-[#475569]">
          <p className="font-semibold text-[#0F172A]">Anexos</p>
          <p className="mt-2">Los archivos cargados se adjuntarán al PDF.</p>
        </section>}

        <footer className="mt-8 flex items-center justify-between border-t border-[#E2E8F0] pt-3 text-[9px] text-[#94A3B8]">
          <span>{pdf.footer}</span>
          {pdf.showPageNumbers && <span>{pdf.coverPage ? 'Página 2 de 2' : 'Página 1 de 1'}</span>}
        </footer>
      </div>
    </div>
  );
}
