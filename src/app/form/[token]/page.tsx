'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  FileCheck2, Loader2, Save, Send, ShieldCheck,
} from 'lucide-react';
import PublicTokenLayout from '@/components/PublicTokenLayout';
import FieldRenderer from '../../formularios/components/FieldRenderer';
import FormPreview from '../../formularios/components/FormPreview';
import { normalizeFormTemplate, type FormField, type FormTemplate } from '@/lib/forms/schema';

type PageState = 'loading' | 'form' | 'review' | 'expired' | 'used' | 'error' | 'success';

interface RemoteFormSchema {
  templateId: string;
  name: string;
  description: string;
  fields: FormField[];
  settings: Record<string, any>;
  workspaceName: string;
  workspaceLogo?: string;
  expiresAt: string;
  recipientName?: string;
}

export default function FormResponsePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const [pageState, setPageState] = useState<PageState>('loading');
  const [remoteSchema, setRemoteSchema] = useState<RemoteFormSchema | null>(null);
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [responseId, setResponseId] = useState('');
  const [signatureRequired, setSignatureRequired] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  const draftKey = `docubox_form_draft_${token}`;

  useEffect(() => {
    if (!token) { setPageState('error'); return; }
    const load = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-form-schema?token=${encodeURIComponent(token)}`, { headers: { 'Content-Type': 'application/json' } });
        const data = await response.json();
        if (!response.ok) {
          if (data.code === 'TOKEN_EXPIRED') setPageState('expired');
          else if (data.code === 'TOKEN_USED') setPageState('used');
          else { setMessage(data.error || 'No se pudo cargar el formulario.'); setPageState('error'); }
          return;
        }
        const normalized = normalizeFormTemplate({
          id: data.templateId,
          name: data.name,
          description: data.description,
          status: 'published',
          schema: data.fields,
          sections: data.settings?.sections,
          settings: data.settings,
        });
        setRemoteSchema(data);
        setTemplate(normalized);
        if (normalized.settings.allowSaveProgress) {
          try {
            const stored = localStorage.getItem(draftKey);
            if (stored) setValues(JSON.parse(stored).values || {});
          } catch { /* ignore invalid local drafts */ }
        }
        setPageState('form');
      } catch {
        setMessage('No se pudo conectar con el servicio de formularios.');
        setPageState('error');
      }
    };
    load();
  }, [token]);

  const visibleFields = useMemo(() => {
    if (!template) return [];
    return template.schema.filter((field) => {
      if (!field.conditionalVisible || !field.conditionalRule) return true;
      const currentValue = values[field.conditionalRule.fieldId];
      const expected = field.conditionalRule.value;
      switch (field.conditionalRule.operator) {
        case 'eq': return String(currentValue) === expected;
        case 'neq': return String(currentValue) !== expected;
        case 'contains': return String(currentValue || '').includes(expected);
        case 'empty': return currentValue === undefined || currentValue === null || currentValue === '';
        case 'not_empty': return currentValue !== undefined && currentValue !== null && currentValue !== '';
        default: return true;
      }
    });
  }, [template, values]);

  const steps = useMemo(() => {
    if (!template) return [];
    const sectionSteps = template.sections.map((section) => ({
      section,
      fields: visibleFields.filter((field) => field.sectionId === section.id),
    })).filter((step) => step.fields.length > 0);
    return template.settings.multiStep ? sectionSteps : [{ section: { ...template.sections[0], title: template.name, description: template.description }, fields: visibleFields }];
  }, [template, visibleFields]);

  const current = steps[currentStep];
  const answered = visibleFields.filter((field) => {
    const value = values[field.id];
    return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
  }).length;
  const progress = visibleFields.length ? Math.round((answered / visibleFields.length) * 100) : 0;

  const validateField = (field: FormField): string => {
    const value = values[field.id];
    if (field.required && (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length))) return 'Este campo es obligatorio.';
    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return 'Ingresa un correo electrónico válido.';
    if (field.type === 'phone' && value && String(value).replace(/\D/g, '').length !== 10) return 'El teléfono debe tener 10 dígitos.';
    if (field.minLength && typeof value === 'string' && value.length < field.minLength) return `Mínimo ${field.minLength} caracteres.`;
    if (field.maxLength && typeof value === 'string' && value.length > field.maxLength) return `Máximo ${field.maxLength} caracteres.`;
    if (field.regex && value) { try { if (!new RegExp(field.regex).test(String(value))) return field.regexError || 'El formato no es válido.'; } catch { /* invalid author regex */ } }
    return '';
  };

  const validateFields = (fields: FormField[]) => {
    const nextErrors: Record<string, string> = {};
    fields.forEach((field) => { const error = validateField(field); if (error) nextErrors[field.id] = error; });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = () => {
    if (!current || !validateFields(current.fields)) return;
    if (currentStep < steps.length - 1) { setCurrentStep((step) => step + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (validateFields(visibleFields)) setPageState('review');
  };

  const saveDraft = () => {
    localStorage.setItem(draftKey, JSON.stringify({ values, savedAt: new Date().toISOString() }));
    setMessage('Avance guardado en este dispositivo.');
    window.setTimeout(() => setMessage(''), 2500);
  };

  const submit = async () => {
    if (honeypot || !validateFields(visibleFields)) return;
    setSubmitting(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/form-submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, response_data: values }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo enviar el formulario.');
      localStorage.removeItem(draftKey);
      setResponseId(data.response_id || '');
      setSignatureRequired(Boolean(data.signature_required || data.redirect_to_sign));
      setPageState('success');
      if (data.document_id && data.redirect_to_sign) window.setTimeout(() => router.push(`/firmar-documento/${data.document_id}`), 1800);
    } catch (submitError) {
      setMessage(submitError instanceof Error ? submitError.message : 'No se pudo enviar el formulario.');
    } finally { setSubmitting(false); }
  };

  if (pageState === 'loading') return <StatusLayout><Loader2 size={28} className="animate-spin text-[#4F46E5]" /><p>Cargando formulario seguro...</p></StatusLayout>;
  if (pageState === 'expired') return <StatusCard icon={Clock} title="Enlace expirado" message="Este formulario ya no está disponible. Solicita un nuevo enlace al remitente." />;
  if (pageState === 'used') return <StatusCard icon={CheckCircle2} title="Formulario respondido" message="Este enlace ya fue utilizado y la respuesta quedó registrada." success />;
  if (pageState === 'error') return <StatusCard icon={AlertCircle} title="No se pudo abrir" message={message || 'Verifica el enlace e intenta nuevamente.'} />;
  if (pageState === 'success') return <SuccessScreen signatureRequired={signatureRequired} responseId={responseId} />;
  if (!template || !remoteSchema) return null;

  if (pageState === 'review') {
    return (
      <PublicTokenLayout token={token} luciaScope="public_form">
        <div className="min-h-screen bg-[#F1F1F5]">
          <PublicHeader schema={remoteSchema} progress={100} label="Revisión final" />
          <main className="mx-auto max-w-[1000px] px-4 py-8">
            <div className="mb-5 flex flex-col gap-3 rounded-md border border-[#EBEBF0] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 size={16} className="text-[#4F46E5]" /> Revisa el PDF espejo</div><p className="mt-1 text-xs text-[#71717A]">Este contenido será la base del documento final y su evidencia de firma.</p></div>
              <button type="button" onClick={() => setPageState('form')} className="flex h-9 items-center gap-2 rounded-md border border-[#EBEBF0] px-3 text-xs font-medium"><ArrowLeft size={13} /> Corregir respuestas</button>
            </div>
            <FormPreview template={template} mode="pdf" values={values} />
            <div className="sticky bottom-0 mt-5 flex items-center justify-between gap-3 border border-[#EBEBF0] bg-white p-3 shadow-lg">
              <p className="hidden text-xs text-[#71717A] sm:block">Al continuar se registrará el hash y la bitácora de envío.</p>
              <button type="button" onClick={submit} disabled={submitting} className="ml-auto flex h-10 items-center gap-2 rounded-md bg-[#4F46E5] px-5 text-sm font-semibold text-white disabled:opacity-50">{submitting ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} {template.settings.requiresSignature ? 'Confirmar y continuar a firma' : 'Confirmar y enviar'}</button>
            </div>
          </main>
        </div>
      </PublicTokenLayout>
    );
  }

  return (
    <PublicTokenLayout token={token} luciaScope="public_form">
      <div className="min-h-screen bg-[#F8F8FB]">
        <PublicHeader schema={remoteSchema} progress={progress} label={steps.length > 1 ? `Paso ${currentStep + 1} de ${steps.length}` : `${progress}% completado`} />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <div className="overflow-hidden rounded-md border border-[#EBEBF0] bg-white shadow-sm">
            <div className="h-1.5 bg-[#4F46E5]" />
            <div className="border-b border-[#EBEBF0] px-6 py-6">
              <p className="text-[11px] font-semibold uppercase text-[#4F46E5]">{currentStep + 1}. {current?.section.title}</p>
              <h1 className="mt-2 text-xl font-semibold text-[#18181B]">{template.name}</h1>
              <p className="mt-2 text-sm leading-6 text-[#52525B]">{current?.section.description || template.description}</p>
            </div>
            <div className="space-y-6 p-6">
              {current?.fields.map((field) => <FieldRenderer key={field.id} field={field} value={values[field.id]} onChange={(value) => { setValues((currentValues) => ({ ...currentValues, [field.id]: value })); setErrors((currentErrors) => ({ ...currentErrors, [field.id]: '' })); }} error={errors[field.id]} formToken={token} />)}
            </div>
          </div>

          <input type="text" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} className="hidden" tabIndex={-1} autoComplete="off" />
          {message && <p className="mt-3 rounded-md border border-[#E0E7FF] bg-[#F7F7FF] px-3 py-2 text-xs text-[#4338CA]">{message}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {currentStep > 0 && <button type="button" onClick={() => setCurrentStep((step) => step - 1)} className="flex h-10 items-center gap-2 rounded-md border border-[#EBEBF0] bg-white px-4 text-sm font-medium text-[#3F3F46]"><ChevronLeft size={15} /> Anterior</button>}
            {template.settings.allowSaveProgress && <button type="button" onClick={saveDraft} className="flex h-10 items-center gap-2 rounded-md border border-[#EBEBF0] bg-white px-4 text-sm font-medium text-[#3F3F46]"><Save size={14} /> Guardar avance</button>}
            <button type="button" onClick={goNext} className="ml-auto flex h-10 items-center gap-2 rounded-md bg-[#4F46E5] px-5 text-sm font-semibold text-white">{currentStep < steps.length - 1 ? <>Siguiente <ChevronRight size={15} /></> : <>Revisar PDF <FileCheck2 size={15} /></>}</button>
          </div>
          <p className="mt-6 text-center text-[11px] text-[#A1A1AA]">Tus datos se transmiten de forma segura y quedan asociados al folio y evidencia del documento.</p>
        </main>
      </div>
    </PublicTokenLayout>
  );
}

function PublicHeader({ schema, progress, label }: { schema: RemoteFormSchema; progress: number; label: string }) { return <header className="sticky top-0 z-40 border-b border-[#EBEBF0] bg-white/95 backdrop-blur"><div className="h-1 bg-[#E4E4E7]"><div className="h-full bg-[#4F46E5] transition-all" style={{ width: `${progress}%` }} /></div><div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">{schema.workspaceLogo ? <img src={schema.workspaceLogo} alt={schema.workspaceName} className="h-8 w-auto" /> : <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#EEF2FF] text-[#4F46E5]"><FileCheck2 size={17} /></span>}<div><p className="text-sm font-semibold text-[#18181B]">{schema.workspaceName}</p><p className="text-[11px] text-[#71717A]">Documento seguro</p></div><span className="ml-auto text-xs font-medium text-[#52525B]">{label}</span></div></header>; }
function StatusLayout({ children }: { children: React.ReactNode }) { return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F8F8FB] text-sm text-[#71717A]">{children}</div>; }
function StatusCard({ icon: Icon, title, message, success }: { icon: React.ElementType; title: string; message: string; success?: boolean }) { return <StatusLayout><div className="w-full max-w-sm rounded-md border border-[#EBEBF0] bg-white p-8 text-center shadow-sm"><span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${success ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}><Icon size={24} /></span><h1 className="mt-4 text-lg font-semibold text-[#18181B]">{title}</h1><p className="mt-2 text-sm leading-6 text-[#71717A]">{message}</p></div></StatusLayout>; }
function SuccessScreen({ signatureRequired, responseId }: { signatureRequired: boolean; responseId: string }) { return <StatusLayout><div className="w-full max-w-md rounded-md border border-[#EBEBF0] bg-white p-8 text-center shadow-sm"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={28} /></span><h1 className="mt-5 text-xl font-semibold text-[#18181B]">Respuesta registrada</h1><p className="mt-2 text-sm leading-6 text-[#71717A]">{signatureRequired ? 'El PDF espejo fue preparado y el proceso continuará con la firma configurada.' : 'La información y su evidencia de envío quedaron registradas correctamente.'}</p>{responseId && <p className="mt-4 rounded-md bg-[#F8F8FB] px-3 py-2 font-mono text-[10px] text-[#71717A]">ID {responseId}</p>}<div className="mt-5 flex items-center justify-center gap-2 text-xs font-medium text-emerald-700"><ShieldCheck size={14} /> Hash y bitácora generados</div></div></StatusLayout>; }
