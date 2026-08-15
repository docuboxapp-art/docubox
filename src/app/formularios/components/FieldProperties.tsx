'use client';

import React, { useEffect, useState } from 'react';
import { FileCog, FileText, GitBranch, Plus, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
import { useFormBuilder, type FormField, type SignatureType } from '@/contexts/FormBuilderContext';
import { getFieldTypeLabel, getSignatureTypeLabel } from '@/lib/forms/schema';

type PanelTab = 'field' | 'form' | 'pdf' | 'signature';

export default function FieldProperties() {
  const { state, dispatch, selectedField, selectedSection, updateField, selectField } = useFormBuilder();
  const [tab, setTab] = useState<PanelTab>('form');

  useEffect(() => {
    if (selectedField) setTab('field');
  }, [selectedField?.id]);

  const update = (updates: Partial<FormField>) => {
    if (selectedField) updateField(selectedField.id, updates);
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-[#E2E8F0] bg-white dark:border-border dark:bg-card">
      <div className="border-b border-[#E2E8F0] px-3 pt-3 dark:border-border">
        <div className="flex items-center justify-between px-1 pb-3">
          <div>
            <p className="text-sm font-semibold text-[#0F172A] dark:text-foreground">Propiedades</p>
            <p className="mt-0.5 text-[11px] text-[#64748B] dark:text-muted-foreground">
              {selectedField ? getFieldTypeLabel(selectedField.type) : selectedSection ? selectedSection.title : 'Configuración del formulario'}
            </p>
          </div>
          {selectedField && (
            <button
              type="button"
              onClick={() => selectField(null)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#64748B] hover:bg-[#F8FAFC]"
              title="Cerrar propiedades del campo"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 gap-1 pb-2">
          <PanelTabButton active={tab === 'field'} disabled={!selectedField} label="Campo" icon={FileText} onClick={() => setTab('field')} />
          <PanelTabButton active={tab === 'form'} label="General" icon={Settings2} onClick={() => setTab('form')} />
          <PanelTabButton active={tab === 'pdf'} label="PDF" icon={FileCog} onClick={() => setTab('pdf')} />
          <PanelTabButton active={tab === 'signature'} label="Firma" icon={ShieldCheck} onClick={() => setTab('signature')} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'field' && selectedField && (
          <div className="space-y-5">
            <PanelSection title="Contenido">
              <ReadOnlyValue label="Tipo de campo" value={getFieldTypeLabel(selectedField.type)} />
              <Input label="Etiqueta" value={selectedField.label} onChange={(value) => update({ label: value, pdf: { ...selectedField.pdf, show: selectedField.pdf?.show ?? true, label: selectedField.pdf?.label || value } })} />
              <Input label="Descripción" value={selectedField.description || ''} onChange={(value) => update({ description: value })} multiline />
              <Input label="Placeholder" value={selectedField.placeholder || ''} onChange={(value) => update({ placeholder: value })} />
              <Input label="Nombre interno" value={selectedField.slug} onChange={(value) => update({ slug: value.toLowerCase().replace(/\s+/g, '_') })} mono />
            </PanelSection>

            <PanelSection title="Comportamiento">
              <Toggle label="Campo obligatorio" checked={selectedField.required} onChange={(value) => update({ required: value })} />
              <Toggle label="Solo lectura" checked={selectedField.readOnly} onChange={(value) => update({ readOnly: value })} />
              <Toggle label="Editable antes de firmar" checked={selectedField.editableBeforeSign ?? true} onChange={(value) => update({ editableBeforeSign: value })} />
              <Select
                label="Sección del formulario"
                value={selectedField.sectionId || ''}
                onChange={(value) => update({ sectionId: value, pdf: { ...selectedField.pdf, show: selectedField.pdf?.show ?? true, sectionId: value } })}
                options={state.template.sections.map((section) => ({ value: section.id, label: section.title }))}
              />
            </PanelSection>

            {['select', 'radio', 'checkbox_group', 'yes_no'].includes(selectedField.type) && (
              <PanelSection title="Opciones">
                <div className="space-y-2">
                  {(selectedField.options || []).map((option, index) => (
                    <div key={`${option.value}-${index}`} className="flex items-center gap-2">
                      <input
                        value={option.label}
                        onChange={(event) => {
                          const options = [...(selectedField.options || [])];
                          options[index] = {
                            label: event.target.value,
                            value: event.target.value.toLowerCase().replace(/\s+/g, '_'),
                          };
                          update({ options });
                        }}
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => update({ options: (selectedField.options || []).filter((_, itemIndex) => itemIndex !== index) })}
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-[#94A3B8] hover:bg-red-50 hover:text-red-600"
                        title="Eliminar opción"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => update({ options: [...(selectedField.options || []), { label: `Opción ${(selectedField.options?.length || 0) + 1}`, value: `opcion_${(selectedField.options?.length || 0) + 1}` }] })}
                    className="flex h-8 items-center gap-1.5 text-xs font-medium text-[#1E6BFF]"
                  >
                    <Plus size={13} /> Agregar opción
                  </button>
                </div>
              </PanelSection>
            )}

            <PanelSection title="Validación">
              <div className="grid grid-cols-2 gap-2">
                <NumberInput label="Mínimo" value={selectedField.minLength ?? selectedField.minValue} onChange={(value) => update(['number', 'currency'].includes(selectedField.type) ? { minValue: value } : { minLength: value })} />
                <NumberInput label="Máximo" value={selectedField.maxLength ?? selectedField.maxValue} onChange={(value) => update(['number', 'currency'].includes(selectedField.type) ? { maxValue: value } : { maxLength: value })} />
              </div>
              <Input label="Expresión regular" value={selectedField.regex || ''} onChange={(value) => update({ regex: value })} mono />
              {selectedField.regex && <Input label="Mensaje de validación" value={selectedField.regexError || ''} onChange={(value) => update({ regexError: value })} />}
            </PanelSection>

            <PanelSection title="Lógica condicional" icon={GitBranch}>
              <Toggle label="Aplicar condición de visibilidad" checked={selectedField.conditionalVisible} onChange={(value) => update({ conditionalVisible: value })} />
              {selectedField.conditionalVisible && (
                <>
                  <Select
                    label="Campo de referencia"
                    value={selectedField.conditionalRule?.fieldId || ''}
                    onChange={(value) => update({ conditionalRule: { fieldId: value, operator: selectedField.conditionalRule?.operator || 'eq', value: selectedField.conditionalRule?.value || '', action: 'show' } })}
                    options={state.template.schema.filter((field) => field.id !== selectedField.id).map((field) => ({ value: field.id, label: field.label }))}
                  />
                  <Select
                    label="Operador"
                    value={selectedField.conditionalRule?.operator || 'eq'}
                    onChange={(value) => update({ conditionalRule: { fieldId: selectedField.conditionalRule?.fieldId || '', operator: value as NonNullable<FormField['conditionalRule']>['operator'], value: selectedField.conditionalRule?.value || '', action: 'show' } })}
                    options={[
                      { value: 'eq', label: 'Es igual a' }, { value: 'neq', label: 'Es distinto de' },
                      { value: 'contains', label: 'Contiene' }, { value: 'empty', label: 'Está vacío' },
                      { value: 'not_empty', label: 'No está vacío' },
                    ]}
                  />
                  <Input label="Valor esperado" value={selectedField.conditionalRule?.value || ''} onChange={(value) => update({ conditionalRule: { fieldId: selectedField.conditionalRule?.fieldId || '', operator: selectedField.conditionalRule?.operator || 'eq', value, action: 'show' } })} />
                </>
              )}
            </PanelSection>

            <PanelSection title="Representación en PDF">
              <Toggle label="Mostrar en PDF espejo" checked={selectedField.pdf?.show ?? true} onChange={(value) => update({ pdf: { ...selectedField.pdf, show: value } })} />
              <Input label="Etiqueta en PDF" value={selectedField.pdf?.label || selectedField.label} onChange={(value) => update({ pdf: { ...selectedField.pdf, show: selectedField.pdf?.show ?? true, label: value } })} />
              <Select
                label="Sección destino en PDF"
                value={selectedField.pdf?.sectionId || selectedField.sectionId || ''}
                onChange={(value) => update({ pdf: { ...selectedField.pdf, show: selectedField.pdf?.show ?? true, sectionId: value } })}
                options={state.template.sections.map((section) => ({ value: section.id, label: section.title }))}
              />
              <Toggle label="Salto de página antes" checked={selectedField.pdf?.pageBreakBefore ?? false} onChange={(value) => update({ pdf: { ...selectedField.pdf, show: selectedField.pdf?.show ?? true, pageBreakBefore: value } })} />
            </PanelSection>
          </div>
        )}

        {tab === 'form' && (
          <div className="space-y-5">
            {selectedSection && !selectedField && (
              <PanelSection title="Sección seleccionada">
                <Input label="Título" value={selectedSection.title} onChange={(value) => dispatch({ type: 'UPDATE_SECTION', payload: { id: selectedSection.id, updates: { title: value } } })} />
                <Input label="Descripción" value={selectedSection.description || ''} onChange={(value) => dispatch({ type: 'UPDATE_SECTION', payload: { id: selectedSection.id, updates: { description: value } } })} multiline />
                <Toggle label="Mostrar sección en PDF" checked={selectedSection.showInPdf} onChange={(value) => dispatch({ type: 'UPDATE_SECTION', payload: { id: selectedSection.id, updates: { showInPdf: value } } })} />
                <Toggle label="Salto de página en PDF" checked={selectedSection.pageBreakBefore} onChange={(value) => dispatch({ type: 'UPDATE_SECTION', payload: { id: selectedSection.id, updates: { pageBreakBefore: value } } })} />
              </PanelSection>
            )}
            <PanelSection title="Experiencia del participante">
              <Toggle label="Mostrar por pasos" checked={state.template.settings.multiStep} onChange={(value) => dispatch({ type: 'SET_SETTINGS', payload: { multiStep: value, mode: value ? 'multistep' : 'scroll' } })} />
              <Toggle label="Permitir guardar avance" checked={state.template.settings.allowSaveProgress} onChange={(value) => dispatch({ type: 'SET_SETTINGS', payload: { allowSaveProgress: value } })} />
              <NumberInput label="Vigencia del enlace (horas)" value={state.template.settings.expirationHours} onChange={(value) => dispatch({ type: 'SET_SETTINGS', payload: { expirationHours: value || 72 } })} />
            </PanelSection>
            <PanelSection title="Control documental">
              <ReadOnlyValue label="Fuente de datos" value="form_schema v1" />
              <ReadOnlyValue label="Representación" value="Web + PDF espejo" />
              <p className="rounded-md border border-[#DBEAFE] bg-[#EFF6FF] p-3 text-[11px] leading-5 text-[#1D4ED8] dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                El PDF se genera desde las mismas secciones y campos. No existe un editor documental separado.
              </p>
            </PanelSection>
          </div>
        )}

        {tab === 'pdf' && (
          <div className="space-y-5">
            <PanelSection title="Identidad del documento">
              <Input label="Encabezado" value={state.template.settings.pdfSchema.header} onChange={(value) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { header: value } })} />
              <Input label="Pie de página" value={state.template.settings.pdfSchema.footer} onChange={(value) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { footer: value } })} multiline />
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium text-[#475569]">Color principal</span>
                <div className="flex h-9 items-center gap-2 rounded-md border border-[#E2E8F0] px-2 dark:border-border">
                  <input type="color" value={state.template.settings.pdfSchema.primaryColor} onChange={(event) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { primaryColor: event.target.value } })} className="h-5 w-7 cursor-pointer border-0 bg-transparent" />
                  <span className="font-mono text-xs text-[#475569]">{state.template.settings.pdfSchema.primaryColor}</span>
                </div>
              </label>
              <Select label="Tamaño de página" value={state.template.settings.pdfSchema.pageSize} onChange={(value) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { pageSize: value as 'letter' | 'a4' } })} options={[{ value: 'letter', label: 'Carta' }, { value: 'a4', label: 'A4' }]} />
            </PanelSection>
            <PanelSection title="Contenido automático">
              <PdfToggles />
            </PanelSection>
          </div>
        )}

        {tab === 'signature' && (
          <div className="space-y-5">
            <PanelSection title="Política de firma">
              <Toggle label="Este formulario requiere firma" checked={state.template.settings.requiresSignature} onChange={(value) => dispatch({ type: 'SET_SETTINGS', payload: { requiresSignature: value } })} />
              <Toggle label="Confirmación OTP" checked={state.template.settings.requireOtp} onChange={(value) => dispatch({ type: 'SET_SETTINGS', payload: { requireOtp: value } })} />
              <div className="space-y-2 pt-1">
                {(['efirma_sat', 'autografa_digital', 'click_sign'] as SignatureType[]).map((signatureType) => (
                  <label key={signatureType} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-[#E2E8F0] px-3 py-2.5 dark:border-border">
                    <input
                      type="checkbox"
                      checked={state.template.settings.allowedSignatureTypes.includes(signatureType)}
                      onChange={(event) => {
                        const current = state.template.settings.allowedSignatureTypes;
                        const next = event.target.checked ? [...current, signatureType] : current.filter((item) => item !== signatureType);
                        dispatch({ type: 'SET_SETTINGS', payload: { allowedSignatureTypes: next } });
                      }}
                      className="h-4 w-4 rounded border-[#CBD5E1] text-[#1E6BFF] focus:ring-[#1E6BFF]/20"
                    />
                    <span className="text-xs font-medium text-[#334155]">{getSignatureTypeLabel(signatureType)}</span>
                  </label>
                ))}
              </div>
            </PanelSection>
            <PanelSection title="Manejo seguro de e.firma">
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-[11px] leading-5 text-emerald-800">
                Los archivos .cer y .key y la contraseña se procesan temporalmente en memoria. La llave privada y su contraseña nunca forman parte del esquema ni se guardan en storage.
              </div>
            </PanelSection>
          </div>
        )}
      </div>
    </aside>
  );
}

function PdfToggles() {
  const { state, dispatch } = useFormBuilder();
  const pdf = state.template.settings.pdfSchema;
  const items: Array<[keyof typeof pdf, string]> = [
    ['coverPage', 'Portada'], ['showPageNumbers', 'Numeración de páginas'],
    ['showFolio', 'Folio único'], ['showDate', 'Fecha de generación'],
    ['showRespondentEmail', 'Correo del participante'], ['showIp', 'Dirección IP'],
    ['showQr', 'QR de validación'], ['showHash', 'Hash SHA-256'],
    ['showAttachments', 'Anexos'], ['showAuditTrail', 'Bitácora'],
    ['showEvidenceSheet', 'Hoja de evidencia legal'], ['consentPage', 'Hoja de consentimiento'],
  ];
  return <>{items.map(([key, label]) => <Toggle key={key} label={label} checked={Boolean(pdf[key])} onChange={(value) => dispatch({ type: 'SET_PDF_SCHEMA', payload: { [key]: value } })} />)}</>;
}

const inputClass = 'h-9 w-full rounded-md border border-[#E2E8F0] bg-white px-3 text-xs text-[#0F172A] outline-none transition focus:border-[#1E6BFF] focus:ring-2 focus:ring-[#1E6BFF]/10 dark:border-border dark:bg-background dark:text-foreground';

function PanelTabButton({ active, disabled, label, icon: Icon, onClick }: { active: boolean; disabled?: boolean; label: string; icon: React.ElementType; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`flex h-9 flex-col items-center justify-center rounded-md text-[9px] font-medium transition ${active ? 'bg-[#EFF6FF] text-[#1E6BFF]' : 'text-[#64748B] hover:bg-[#F8FAFC]'} disabled:cursor-not-allowed disabled:opacity-35`}><Icon size={13} /><span className="mt-0.5">{label}</span></button>;
}

function PanelSection({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return <section><div className="mb-3 flex items-center gap-2 border-b border-[#E2E8F0] pb-2 text-[11px] font-semibold uppercase text-[#64748B] dark:border-border">{Icon && <Icon size={13} />}{title}</div><div className="space-y-3">{children}</div></section>;
}

function Input({ label, value, onChange, multiline, mono }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; mono?: boolean }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-[#475569] dark:text-muted-foreground">{label}</span>{multiline ? <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClass} h-auto resize-none py-2 ${mono ? 'font-mono' : ''}`} /> : <input value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClass} ${mono ? 'font-mono' : ''}`} />}</label>;
}

function NumberInput({ label, value, onChange }: { label: string; value?: number; onChange: (value?: number) => void }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-[#475569] dark:text-muted-foreground">{label}</span><input type="number" value={value ?? ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)} className={inputClass} /></label>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-[#475569] dark:text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}><option value="">Seleccionar</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-3 py-0.5"><span className="text-xs text-[#334155] dark:text-foreground">{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" /><span className="relative h-5 w-9 flex-shrink-0 rounded-full bg-[#CBD5E1] transition peer-checked:bg-[#1E6BFF] after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:after:translate-x-4" /></label>;
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return <div><span className="mb-1 block text-[11px] font-medium text-[#475569] dark:text-muted-foreground">{label}</span><div className="rounded-md border border-[#E2E8F0] bg-[#F6F8FB] px-3 py-2 text-xs text-[#475569] dark:border-border dark:bg-muted dark:text-muted-foreground">{value}</div></div>;
}
