'use client';
import { BottomNotice } from '@/components/ui/BottomNotice';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  FileCheck2, Loader2, Maximize2, Minimize2, Save, ShieldCheck, X,
} from 'lucide-react';
import PublicTokenLayout from '@/components/PublicTokenLayout';
import AppLogo from '@/components/ui/AppLogo';
import FieldRenderer from '../../formularios/components/FieldRenderer';
import FormPreview from '../../formularios/components/FormPreview';
import { FormWebHeader } from '../../formularios/components/FormWebHeader';
import { normalizeFormTemplate, type FormField, type FormTemplate, type SignatureType } from '@/lib/forms/schema';
import { hasFormValue, isFormFieldRequired, isFormFieldVisible } from '@/lib/forms/field-behavior';
import { initialParticipantFormValues, type ParticipantFormProfile } from '@/lib/forms/participant-profile-prefill';
import { formFontFamily } from '@/lib/typography/font-families';
import { useFormTypography } from '@/hooks/useFormTypography';
import { createClient } from '@/lib/supabase/client';

type PageState = 'loading' | 'auth' | 'form' | 'review' | 'signing' | 'expired' | 'used' | 'error' | 'success';

interface RemoteFormSchema {
  templateId: string;
  name: string;
  description: string;
  fields: FormField[];
  settings: Record<string, any>;
  workspaceName: string;
  workspaceLogo?: string;
  expiresAt: string | null;
  recipientName?: string;
  signatureType?: SignatureType;
  participantProfile?: ParticipantFormProfile | null;
}

export default function FormResponsePage() {
  const params = useParams();
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
  const [documentId, setDocumentId] = useState('');
  const [documentNotice, setDocumentNotice] = useState('');
  const [preparingSignature, setPreparingSignature] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  useFormTypography(template?.settings.appearance.typography);

  const draftKey = `docubox_form_draft_${token}`;

  useEffect(() => {
    const load = async () => {
      if (!token) { setPageState('error'); return; }
      try {
        const { data: { session } } = await createClient().auth.getSession();
        if (!session?.access_token) { setPageState('auth'); return; }
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-form-schema?token=${encodeURIComponent(token)}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` } });
        const data = await response.json();
        if (!response.ok) {
          if (data.code === 'AUTH_REQUIRED') setPageState('auth');
          else if (data.code === 'TOKEN_EXPIRED') setPageState('expired');
          else if (data.code === 'TOKEN_USED') {
            setResponseId(typeof data.response_id === 'string' ? data.response_id : '');
            setDocumentId(typeof data.document_id === 'string' ? data.document_id : '');
            const documentState = String(data.document_state || '').toLowerCase();
            const signingPending = data.response_id && data.response_status !== 'signed' &&
              (!documentState || ['en_proceso', 'en_progreso'].includes(documentState));
            setPageState(signingPending ? 'signing' : 'used');
          }
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
        const initialValues = initialParticipantFormValues(normalized.schema, data.participantProfile);
        if (normalized.settings.allowSaveProgress) {
          try {
            const stored = localStorage.getItem(draftKey);
            const draft = stored ? JSON.parse(stored) : null;
            if (draft && (!draft.templateId || draft.templateId === normalized.id)) {
              const allowedIds = new Set(normalized.schema.map((field) => field.id));
              const restored = Object.fromEntries(Object.entries(draft.values || {}).filter(([id]) => allowedIds.has(id)));
              setValues(initialParticipantFormValues(normalized.schema, data.participantProfile, restored));
              if (Number.isInteger(draft.currentStep) && draft.currentStep >= 0) setCurrentStep(draft.currentStep);
            } else setValues(initialValues);
          } catch { setValues(initialValues); }
        } else setValues(initialValues);
        setPageState('form');
      } catch {
        setMessage('No se pudo conectar con el servicio de formularios.');
        setPageState('error');
      }
    };
    load();
  }, [token, draftKey]);

  const visibleFields = useMemo(() => {
    if (!template) return [];
    return template.schema.filter((field) => isFormFieldVisible(field, values));
  }, [template, values]);

  const steps = useMemo(() => {
    if (!template) return [];
    const sectionSteps = template.sections.map((section) => ({
      section,
      fields: visibleFields.filter((field) => field.sectionId === section.id),
    })).filter((step) => step.fields.length > 0);
    return template.settings.multiStep ? sectionSteps : [{ section: { ...template.sections[0], title: template.name, description: template.description }, fields: visibleFields }];
  }, [template, visibleFields]);

  const activeStep = Math.min(currentStep, Math.max(steps.length - 1, 0));
  const current = steps[activeStep];
  const answerFields = visibleFields.filter((field) => field.type !== 'signature_block');
  const answered = answerFields.filter((field) => {
    const value = values[field.id];
    return hasFormValue(value);
  }).length;
  const progress = answerFields.length ? Math.round((answered / answerFields.length) * 100) : 0;

  const validateField = (field: FormField): string => {
    if (field.type === 'signature_block') return '';
    const value = values[field.id];
    if (isFormFieldRequired(field, values) && (!hasFormValue(value) || (['checkbox', 'consentimiento', 'declaration', 'firma_click'].includes(field.type) && value !== true))) return 'Este campo es obligatorio.';
    if (field.type === 'fiscal_address' && isFormFieldRequired(field, values) && value && typeof value === 'object') {
      const address = value as Record<string, unknown>;
      if (['street', 'exteriorNumber', 'neighborhood', 'city', 'state'].some((key) => !String(address[key] || '').trim())) return 'Completa calle, número exterior, colonia, ciudad y estado.';
    }
    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return 'Ingresa un correo electrónico válido.';
    if (field.type === 'phone' && value && String(value).replace(/\D/g, '').length !== 10) return 'El teléfono debe tener 10 dígitos.';
    if (['number', 'currency'].includes(field.type) && hasFormValue(value)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 'Ingresa un número válido.';
      if (field.minValue !== undefined && numeric < field.minValue) return `Mínimo ${field.minValue}.`;
      if (field.maxValue !== undefined && numeric > field.maxValue) return `Máximo ${field.maxValue}.`;
    }
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
    if (activeStep < steps.length - 1) { setCurrentStep(activeStep + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (validateFields(visibleFields)) setPageState('review');
  };

  const saveDraft = () => {
    if (!template?.settings.allowSaveProgress) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ templateId: template.id, values, currentStep: activeStep, savedAt: new Date().toISOString() }));
      setMessage('Avance guardado en este navegador. Puedes retomarlo con el mismo enlace.');
    } catch {
      setMessage('No se pudo guardar el avance en este navegador. Revisa el espacio disponible o la navegación privada.');
    }
  };

  const promoteResponse = async (id: string, accessToken: string): Promise<string> => {
    const promotion = await fetch(`/api/formularios/respuestas/${id}/documento`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!promotion.ok) throw new Error('No se pudo preparar el documento para la firma.');
    const result = await promotion.json();
    if (typeof result.document_id !== 'string' || !result.document_id) {
      throw new Error('El documento todavía no está disponible para la firma.');
    }
    return result.document_id;
  };

  const retrySignature = async () => {
    if (!responseId || preparingSignature) return;
    setPreparingSignature(true);
    setDocumentNotice('');
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session?.access_token) throw new Error('Vuelve a iniciar sesión para continuar con la firma.');
      const id = await promoteResponse(responseId, session.access_token);
      setDocumentId(id);
      setPageState('signing');
    } catch (error) {
      setDocumentNotice(error instanceof Error ? error.message : 'No se pudo preparar la firma.');
    } finally {
      setPreparingSignature(false);
    }
  };

  const submit = async () => {
    if (honeypot || !validateFields(visibleFields)) return;
    setSubmitting(true);
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session?.access_token) { setPageState('auth'); return; }
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/form-submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ token, response_data: Object.fromEntries(visibleFields.map((field) => [field.id, values[field.id] ?? null])) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo enviar el formulario.');
      let generatedDocumentId = typeof data.document_id === 'string' ? data.document_id : '';
      let promotionFailed = false;
      if (data.response_id && !generatedDocumentId) {
        try {
          generatedDocumentId = await promoteResponse(data.response_id, session.access_token);
        } catch { promotionFailed = true; }
      }
      localStorage.removeItem(draftKey);
      setResponseId(data.response_id || '');
      setDocumentId(generatedDocumentId);
      if (data.signature_required) {
        if (promotionFailed || !generatedDocumentId) {
          setDocumentNotice('Tus respuestas quedaron guardadas. Reintenta preparar el PDF para continuar con la firma.');
        }
        setPageState('signing');
      } else setPageState('success');
    } catch (submitError) {
      setMessage(submitError instanceof Error ? submitError.message : 'No se pudo enviar el formulario.');
    } finally { setSubmitting(false); }
  };

  if (pageState === 'loading') return <StatusLayout><Loader2 size={28} className="animate-spin text-[#1E6BFF]" /><p>Cargando formulario seguro...</p></StatusLayout>;
  if (pageState === 'auth') return <StatusLayout><div className="w-full max-w-sm rounded-md border border-[#EBEBF0] bg-white p-8 text-center shadow-sm"><ShieldCheck size={28} className="mx-auto text-[#1E6BFF]" /><h1 className="mt-4 text-lg font-semibold">Accede a tu cuenta</h1><p className="mt-2 text-sm">Necesitas iniciar sesión con el correo asociado al formulario para responder.</p><a href={`/login?redirect=${encodeURIComponent(`/form/${token}`)}`} className="mt-5 inline-flex rounded-md bg-[#1E6BFF] px-4 py-2 text-sm font-medium text-white">Iniciar sesión</a></div></StatusLayout>;
  if (pageState === 'expired') return <StatusCard icon={Clock} title="Enlace expirado" message="Este formulario ya no está disponible. Solicita un nuevo enlace al remitente." />;
  if (pageState === 'used') return <UsedFormStatus documentId={documentId} />;
  if (pageState === 'error') return <StatusCard icon={AlertCircle} title="No se pudo abrir" message={message || 'Verifica el enlace e intenta nuevamente.'} />;
  if (pageState === 'signing') return <SigningHandoff documentId={documentId} responseId={responseId} onRetrySignature={retrySignature} preparingSignature={preparingSignature} documentNotice={documentNotice} />;
  if (pageState === 'success') return <SuccessScreen responseId={responseId} confirmationMessage={template?.settings.appearance.confirmationMessage} />;
  if (!template || !remoteSchema) return null;

  if (pageState === 'review') {
    return (
      <PublicTokenLayout token={token} luciaScope="public_form">
        <div className="min-h-screen bg-[#F1F1F5]" style={{ backgroundColor: template.settings.appearance.backgroundColor }}>
          <PublicHeader />
          <main className="mx-auto max-w-[1000px] px-4 py-8">
            {template.settings.appearance.showProgressBar && <FormProgress progress={100} label="Respuestas completas · falta firmar" accentColor={template.settings.appearance.accentColor} />}
            <div className="mb-5 flex flex-col gap-3 rounded-md border border-[#EBEBF0] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 size={16} className="text-[#1E6BFF]" /> Revisa tus respuestas antes de firmar</div><p className="mt-1 text-xs text-[#71717A]">Este mismo formulario se convertirá en PDF para la firma. No tendrás que llenar otro formulario.</p></div>
              <button type="button" onClick={() => setPageState('form')} className="flex h-9 items-center gap-2 rounded-md border border-[#EBEBF0] px-3 text-xs font-medium"><ArrowLeft size={13} /> Corregir respuestas</button>
            </div>
            <FormPreview template={template} mode="pdf" values={values} signatureType={remoteSchema.signatureType || 'click_sign'} />
            <div className="sticky bottom-0 mt-5 flex items-center justify-between gap-3 border border-[#EBEBF0] bg-white p-3 shadow-lg">
              <p className="hidden text-xs text-[#71717A] sm:block">Tus respuestas se guardarán antes de continuar con el consentimiento y la firma.</p>
              <button type="button" onClick={submit} disabled={submitting} style={{ backgroundColor: template.settings.appearance.accentColor }} className="ml-auto flex h-10 items-center gap-2 rounded-md bg-[#1E6BFF] px-5 text-sm font-semibold text-white disabled:opacity-50">{submitting ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Guardar respuestas y continuar</button>
            </div>
          </main>
        </div>
      </PublicTokenLayout>
    );
  }

  return (
    <PublicTokenLayout token={token} luciaScope="public_form">
      <div className="min-h-screen bg-[#F8F8FB]" style={{ backgroundColor: template.settings.appearance.backgroundColor }}>
        <PublicHeader />
        <main className="mx-auto px-4 py-8" style={{ maxWidth: template.settings.appearance.width === 'wide' ? 1000 : 768, fontFamily: formFontFamily(template.settings.appearance.typography) }}>
          {template.settings.appearance.showProgressBar && <FormProgress progress={progress} label={steps.length > 1 ? `Sección ${activeStep + 1} de ${steps.length} · ${progress}% de respuestas` : `${progress}% de respuestas`} accentColor={template.settings.appearance.accentColor} />}
          <div className="overflow-hidden rounded-md border border-[#EBEBF0] bg-white shadow-sm">
            {template.settings.appearance.showAccentBar && <div className="h-1.5" style={{ backgroundColor: template.settings.appearance.accentColor }} />}
            <FormWebHeader template={template} headingLevel={1} />
            <div className={`${template.settings.appearance.compactSpacing ? 'space-y-3' : 'space-y-6'} p-6`} style={{ accentColor: template.settings.appearance.accentColor }}>
              {current && <div><h2 className="text-sm font-semibold">{template.settings.appearance.showSectionNumbers ? `${activeStep + 1}. ` : ''}{current.section.title}</h2>{template.settings.appearance.showSectionDescriptions && current.section.description && <p className="mt-1 text-xs text-slate-500">{current.section.description}</p>}</div>}
              {current?.fields.map((field) => <FieldRenderer key={field.id} field={field} value={values[field.id]} requiredOverride={isFormFieldRequired(field, values)} onChange={(value) => { setValues((currentValues) => ({ ...currentValues, [field.id]: value })); setErrors((currentErrors) => ({ ...currentErrors, [field.id]: '' })); }} error={errors[field.id]} formToken={token} signatureType={remoteSchema.signatureType || 'click_sign'} />)}
            </div>
            {template.settings.appearance.showFooter && template.settings.appearance.footerText && (
              <footer className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500" style={{ textAlign: template.settings.appearance.footerAlignment }}>
                {template.settings.appearance.footerText}
              </footer>
            )}
          </div>

          <input type="text" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} className="hidden" tabIndex={-1} autoComplete="off" />
          {message && <BottomNotice message={message} onClose={() => setMessage('')} />}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {activeStep > 0 && <button type="button" onClick={() => setCurrentStep(activeStep - 1)} className="flex h-10 items-center gap-2 rounded-md border border-[#EBEBF0] bg-white px-4 text-sm font-medium text-[#3F3F46]"><ChevronLeft size={15} /> Anterior</button>}
            {template.settings.allowSaveProgress && <button type="button" onClick={saveDraft} className="flex h-10 items-center gap-2 rounded-md border border-[#EBEBF0] bg-white px-4 text-sm font-medium text-[#3F3F46]"><Save size={14} /> Guardar avance</button>}
            <button type="button" onClick={goNext} style={{ backgroundColor: template.settings.appearance.accentColor }} className="ml-auto flex h-10 items-center gap-2 rounded-md bg-[#1E6BFF] px-5 text-sm font-semibold text-white">{activeStep < steps.length - 1 ? <>Siguiente sección <ChevronRight size={15} /></> : <>Revisar PDF <FileCheck2 size={15} /></>}</button>
          </div>
          <p className="mt-6 text-center text-[11px] text-[#A1A1AA]">Tus datos se transmiten de forma segura y quedan asociados al folio y evidencia del documento.</p>
        </main>
      </div>
    </PublicTokenLayout>
  );
}

function PublicHeader() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // The browser may block fullscreen; keep the form usable.
    }
  };

  return <header className="sticky top-0 z-40 border-b border-[#EBEBF0] bg-white/95 backdrop-blur">
    <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
      <AppLogo variant="dark" imageClassName="h-7 w-auto sm:h-8" />
      <div className="flex items-center gap-2">
        <button type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Maximizar pantalla'} title={isFullscreen ? 'Salir de pantalla completa' : 'Maximizar pantalla'} className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[#64748B] transition-colors hover:bg-[#F3F6FB] hover:text-[#1E6BFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E6BFF]">
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <a href="/inicio" className="inline-flex h-10 items-center gap-2 rounded-md border border-[#DCE4F0] bg-white px-3 text-sm font-medium text-[#334155] transition-colors hover:bg-[#F3F6FB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E6BFF]"><X size={16} /> Salir</a>
      </div>
    </div>
  </header>;
}

function FormProgress({ progress, label, accentColor }: { progress: number; label: string; accentColor: string }) {
  return <div className="mb-5" aria-label="Avance de respuestas">
    <div className="mb-2 flex items-center justify-end text-xs font-medium text-[#64748B]">{label}</div>
    <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Respuestas completadas" className="h-1.5 overflow-hidden rounded-full bg-[#E4E9F2]">
      <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: accentColor }} />
    </div>
  </div>;
}
function StatusLayout({ children }: { children: React.ReactNode }) { return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F8F8FB] text-sm text-[#71717A]">{children}</div>; }
function StatusCard({ icon: Icon, title, message, success }: { icon: React.ElementType; title: string; message: string; success?: boolean }) { return <StatusLayout><div className="w-full max-w-sm rounded-md border border-[#EBEBF0] bg-white p-8 text-center shadow-sm"><span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${success ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}><Icon size={24} /></span><h1 className="mt-4 text-lg font-semibold text-[#18181B]">{title}</h1><p className="mt-2 text-sm leading-6 text-[#71717A]">{message}</p></div></StatusLayout>; }
function SigningHandoff({ documentId, responseId, onRetrySignature, preparingSignature, documentNotice }: { documentId: string; responseId: string; onRetrySignature: () => void; preparingSignature: boolean; documentNotice: string }) {
  return <div className="min-h-screen bg-[#F8F8FB] text-[#18181B]">
    <PublicHeader />
    <main className="mx-auto max-w-xl px-4 py-12">
      <div className="rounded-xl border border-[#DCE4F0] bg-white p-6 shadow-sm sm:p-8">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><CheckCircle2 size={23} /></span>
        <h1 className="mt-5 text-xl font-semibold">Tus respuestas están guardadas</h1>
        <p className="mt-2 text-sm leading-6 text-[#64748B]">Ahora firmarás el PDF generado con este mismo formulario. No necesitas llenar otro. Tu firma se colocará en el campo previsto.</p>
        <ol className="mt-6 space-y-3 border-y border-[#E2E8F0] py-5 text-sm">
          <li className="flex items-center gap-3 text-emerald-700"><CheckCircle2 size={18} /> Formulario enviado</li>
          <li className="flex items-center gap-3 text-[#334155]"><span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[#94A3B8] text-[10px]">2</span> Revisar y aceptar el consentimiento</li>
          <li className="flex items-center gap-3 text-[#334155]"><span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[#94A3B8] text-[10px]">3</span> Confirmar la firma y generar el PDF final</li>
        </ol>
        {documentId ? <a href={`/firmar-documento/${documentId}`} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#1E6BFF] px-5 py-3 text-sm font-semibold text-white">Continuar a la firma <ChevronRight size={16} /></a>
          : responseId ? <button type="button" onClick={onRetrySignature} disabled={preparingSignature} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#1E6BFF] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{preparingSignature && <Loader2 size={16} className="animate-spin" />} Preparar PDF para firmar</button>
          : <p className="mt-5 text-sm text-amber-700">No encontramos el documento para firma. Consulta tus documentos o solicita ayuda al remitente.</p>}
        {documentNotice && <p role="alert" className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800">{documentNotice}</p>}
      </div>
    </main>
  </div>;
}
function UsedFormStatus({ documentId }: { documentId: string }) {
  return <div className="min-h-screen bg-[#F8F8FB]"><PublicHeader /><main className="mx-auto max-w-md px-4 py-12"><div className="rounded-xl border border-[#DCE4F0] bg-white p-8 text-center shadow-sm">
    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={24} /></span>
    <h1 className="mt-4 text-lg font-semibold text-[#18181B]">Formulario respondido</h1>
    <p className="mt-2 text-sm leading-6 text-[#64748B]">Las respuestas ya están registradas. Si firmaste, puedes consultar el estado del PDF final.</p>
    {documentId && <a href={`/visor-documento/${documentId}`} className="mt-5 inline-flex rounded-md bg-[#1E6BFF] px-5 py-2.5 text-sm font-semibold text-white">Consultar documento</a>}
  </div></main></div>;
}
function SuccessScreen({ responseId, confirmationMessage }: { responseId: string; confirmationMessage?: string }) {
  return <StatusLayout><div className="w-full max-w-md rounded-md border border-[#EBEBF0] bg-white p-8 text-center shadow-sm">
    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={28} /></span>
    <h1 className="mt-5 text-xl font-semibold text-[#18181B]">Respuesta registrada</h1>
    {confirmationMessage && <p className="mt-2 text-sm leading-6 text-[#52525B]">{confirmationMessage}</p>}
    <p className="mt-2 text-sm leading-6 text-[#71717A]">La información y su evidencia de envío quedaron registradas correctamente.</p>
    {responseId && <p className="mt-4 rounded-md bg-[#F8F8FB] px-3 py-2 font-mono text-[10px] text-[#71717A]">ID {responseId}</p>}
    <div className="mt-5 flex items-center justify-center gap-2 text-xs font-medium text-emerald-700"><ShieldCheck size={14} /> Huella de respuestas registrada</div>
  </div></StatusLayout>;
}
