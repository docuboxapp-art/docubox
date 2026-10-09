'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  FileText,
  Loader2,
  Mail,
  Maximize2,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import AppLogo from '@/components/ui/AppLogo';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAppModules } from '@/contexts/AppModulesContext';
import { createClient } from '@/lib/supabase/client';

type SignatureType = 'click_sign' | 'autografa_digital' | 'efirma_sat';
type FormChoice = {
  id: string;
  name: string;
  description: string | null;
  settings: Record<string, unknown> | null;
  allowed_signature_types: SignatureType[] | null;
};
type Participant = { id: string; name: string; email: string };
const signatureLabels: Record<SignatureType, string> = {
  click_sign: 'Click & Sign',
  autografa_digital: 'Firma autógrafa digital',
  efirma_sat: 'e.firma SAT',
};
const signatureIcons = {
  click_sign: CheckCircle2,
  autografa_digital: Edit3,
  efirma_sat: ShieldCheck,
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const launchSteps = [
  {
    label: 'Participante',
    icon: User,
    description: 'Elige quién responderá el formulario y cómo recibirá el enlace.',
  },
  {
    label: 'Firma',
    icon: CheckCircle2,
    description: 'Selecciona el tipo de firma requerido para esta respuesta.',
  },
  {
    label: 'Confirmar y enviar',
    icon: Send,
    description: 'Revisa los datos antes de enviar el enlace personal.',
  },
] as const;

function LaunchContent() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const initialId = useSearchParams().get('id');
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const { isModuleActive, loading: modulesLoading } = useAppModules();
  const supabase = useMemo(() => createClient(), []);
  const [forms, setForms] = useState<FormChoice[]>([]);
  const [contacts, setContacts] = useState<Participant[]>([]);
  const [selectedId, setSelectedId] = useState(initialId || '');
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [participantTab, setParticipantTab] = useState<'contacts' | 'search'>('contacts');
  const [searchCriteria, setSearchCriteria] = useState<'correo' | 'telefono' | 'rfc' | 'curp'>(
    'correo'
  );
  const [platformEmail, setPlatformEmail] = useState('');
  const [platformResults, setPlatformResults] = useState<Participant[]>([]);
  const [platformSearching, setPlatformSearching] = useState(false);
  const [platformSearched, setPlatformSearched] = useState(false);
  const [showManualParticipant, setShowManualParticipant] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [signatureType, setSignatureType] = useState<SignatureType | ''>('');
  const [requireLiveness, setRequireLiveness] = useState(false);
  const [expirationHours, setExpirationHours] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sentUrl, setSentUrl] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const syncFullscreen = () =>
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    if (!activeWorkspace?.id || !user?.id) return;
    let active = true;
    const load = async () => {
      const [formResult, contactResult] = await Promise.all([
        supabase
          .from('form_templates')
          .select('id,name,description,settings,allowed_signature_types')
          .eq('workspace_id', activeWorkspace.id)
          .eq('status', 'published')
          .order('name'),
        supabase
          .from('contacts')
          .select('id,nombre,apellido_paterno,apellido_materno,email')
          .eq('user_id', user.id)
          .order('nombre'),
      ]);
      if (!active) return;
      setForms(
        ((formResult.data || []) as FormChoice[]).filter(
          (item) => item.settings?.accessMode !== 'public'
        )
      );
      setContacts(
        (contactResult.data || [])
          .filter((item) => item.email)
          .map((item) => ({
            id: item.id,
            name: [item.nombre, item.apellido_paterno, item.apellido_materno]
              .filter(Boolean)
              .join(' '),
            email: item.email,
          }))
      );
      if (formResult.error) setError('No se pudieron cargar los formularios publicados.');
      setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [activeWorkspace?.id, user?.id, supabase]);

  const form = forms.find((item) => item.id === selectedId);
  const settingTypes = form?.settings?.allowedSignatureTypes;
  const allowedTypes =
    Array.isArray(form?.allowed_signature_types) && form.allowed_signature_types.length
      ? form.allowed_signature_types
      : Array.isArray(settingTypes)
        ? settingTypes
        : [];
  const signatureOptions = (
    allowedTypes?.length ? allowedTypes : ['click_sign', 'autografa_digital', 'efirma_sat']
  ).filter((type): type is SignatureType => type in signatureLabels);
  const hasConfiguredExpiration = form?.settings?.configureLinkExpiration === true;
  const configuredHours = Number(form?.settings?.expirationHours);
  const defaultHours =
    Number.isFinite(configuredHours) && configuredHours >= 1 / 60 && configuredHours <= 720
      ? configuredHours
      : 72;
  const effectiveExpirationHours = expirationHours ?? defaultHours;
  const selectedParticipant = participant;
  const filteredContacts = contacts.filter(
    (item) =>
      item.email.toLowerCase() !== user?.email?.toLowerCase() &&
      `${item.name} ${item.email}`.toLowerCase().includes(contactQuery.toLowerCase())
  );
  const showCurrentUser = Boolean(
    user?.email &&
    `${user.user_metadata?.full_name || user.email} ${user.email}`
      .toLowerCase()
      .includes(contactQuery.toLowerCase())
  );
  const chooseParticipant = (person: Participant) => {
    setParticipant(person);
    setSignatureType('');
    setRequireLiveness(false);
    setManualName('');
    setManualEmail('');
    setParticipantPickerOpen(false);
    setError('');
  };
  const addManualParticipant = () => {
    if (!manualName.trim() || !emailPattern.test(manualEmail.trim())) {
      setError('Escribe el nombre y un correo válido para añadir al participante.');
      return;
    }
    chooseParticipant({ id: 'new', name: manualName.trim(), email: manualEmail.trim() });
    setShowManualParticipant(false);
  };
  const activeStep = launchSteps[step - 1];
  const ActiveStepIcon = activeStep.icon;
  const progress = Math.round(((step - 1) / (launchSteps.length - 1)) * 100);

  const goBack = () => {
    setError('');
    if (step === 1) setSelectedId('');
    else setStep((step - 1) as 1 | 2);
  };
  const advance = () => {
    if (step === 1) next();
    else if (signatureType) {
      setError('');
      setStep(3);
    } else setError('Selecciona un tipo de firma.');
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch {
      setError('No fue posible cambiar a pantalla completa.');
    }
  };

  const next = () => {
    setError('');
    if (
      !selectedParticipant ||
      !selectedParticipant.name.trim() ||
      !emailPattern.test(selectedParticipant.email.trim())
    ) {
      setError('Selecciona un contacto o escribe el nombre y correo de un participante.');
      return;
    }
    setStep(2);
  };
  const searchPlatform = async () => {
    const query = platformEmail.trim();
    if (!query || (searchCriteria === 'correo' && !emailPattern.test(query))) {
      setError(
        searchCriteria === 'correo'
          ? 'Escribe un correo válido para buscar en Docubox.'
          : 'Escribe un dato para buscar en Docubox.'
      );
      return;
    }
    setPlatformSearching(true);
    setPlatformSearched(true);
    setPlatformResults([]);
    setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await fetch(
        `/api/documentos/buscar-participante?q=${encodeURIComponent(query)}&criteria=${searchCriteria}`,
        {
          headers: sessionData.session?.access_token
            ? { Authorization: `Bearer ${sessionData.session.access_token}` }
            : {},
        }
      );
      if (!response.ok) throw new Error('No se pudo buscar al participante.');
      const data = await response.json();
      setPlatformResults(
        (data.users || [])
          .filter((item: { email?: string }) => item.email)
          .map((item: { id: string; full_name?: string; email: string }) => ({
            id: item.id,
            name: item.full_name || item.email,
            email: item.email,
          }))
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo buscar al participante.');
    } finally {
      setPlatformSearching(false);
    }
  };
  const send = async () => {
    if (!form || !selectedParticipant || !signatureType) {
      setError('Completa los datos del lanzamiento antes de enviar.');
      return;
    }
    if (
      hasConfiguredExpiration &&
      (!Number.isFinite(effectiveExpirationHours) ||
        effectiveExpirationHours < 1 / 60 ||
        effectiveExpirationHours > 720)
    ) {
      setError('La vigencia debe estar entre 1 minuto y 720 horas.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-form-token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            template_id: form.id,
            recipient_email: selectedParticipant.email,
            recipient_name: selectedParticipant.name,
            signature_type: signatureType,
            require_liveness: requireLiveness,
            notification_method: 'email',
            ...(hasConfiguredExpiration ? { expiration_hours: effectiveExpirationHours } : {}),
          }),
        }
      );
      const result = await response.json();
      if (!response.ok || result.email_sent !== true)
        throw new Error(result.error || 'No se pudo enviar el correo.');
      setSentUrl(result.form_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo lanzar el formulario.');
    } finally {
      setBusy(false);
    }
  };

  if (!modulesLoading && !isModuleActive('formularios'))
    return (
      <AppLayout>
        <p className="p-8 text-sm text-slate-600">
          Activa Formularios en App Market para utilizar esta función.
        </p>
      </AppLayout>
    );

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-slate-50 text-slate-950"
    >
      <header className="grid min-h-16 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 sm:gap-4 sm:px-4 lg:px-6">
        <AppLogo size={34} imageClassName="max-sm:w-24" />
        <nav
          aria-label="Pasos de lanzamiento del formulario"
          className="mx-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100/80 p-1 sm:gap-1"
        >
          {launchSteps.map(({ label, icon: StepIcon }, index) => (
            <React.Fragment key={label}>
              <button
                type="button"
                aria-label={label}
                aria-current={step === index + 1 ? 'step' : undefined}
                title={label}
                disabled={busy || Boolean(sentUrl) || index + 1 >= step}
                onClick={() => {
                  setStep((index + 1) as 1 | 2);
                  setError('');
                }}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-sm transition-colors sm:px-2.5 ${step === index + 1 ? 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)]' : index + 1 < step ? 'text-slate-700 hover:bg-white hover:text-primary' : 'text-slate-400'} disabled:cursor-default`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${step === index + 1 ? 'bg-primary text-white' : index + 1 < step ? 'bg-primary/10 text-primary' : 'bg-slate-200/70 text-slate-400'}`}
                >
                  {index + 1 < step ? <CheckCircle2 size={13} /> : <StepIcon size={13} />}
                </span>
                <span className="hidden md:inline">{label}</span>
              </button>
              {index < launchSteps.length - 1 && (
                <span
                  className={`h-px w-1 shrink-0 sm:w-3 ${index + 1 < step ? 'bg-primary/50' : 'bg-slate-200'}`}
                />
              )}
            </React.Fragment>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={isFullscreen ? 'Restaurar pantalla' : 'Pantalla completa'}
            aria-label={isFullscreen ? 'Restaurar pantalla' : 'Pantalla completa'}
            onClick={() => void toggleFullscreen()}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-white sm:flex"
          >
            <Maximize2 size={17} />
          </button>
          <button
            type="button"
            title="Salir"
            aria-label="Salir"
            disabled={busy}
            onClick={() => router.push('/formularios')}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 sm:px-3"
          >
            <X size={16} />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>
      <section className="shrink-0 border-b border-slate-200 bg-[#edf3f8] px-4 py-2 lg:px-6">
        <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ActiveStepIcon size={16} />
            </span>
            <h1 className="text-[20px] font-normal">{activeStep.label}</h1>
            <span className="shrink-0 rounded-md bg-slate-200/70 px-1.5 py-0.5 text-sm text-slate-600">
              Paso {step} de {launchSteps.length}
            </span>
            <p className="hidden min-w-0 truncate text-sm text-slate-500 lg:block">
              {activeStep.description}
            </p>
          </div>
          <div className="flex w-full items-center gap-2 text-sm text-slate-500 sm:w-44">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-label="Progreso"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="w-8 text-right tabular-nums">{progress}%</span>
          </div>
          <p className="w-full truncate text-sm text-slate-500 lg:hidden">
            {activeStep.description}
          </p>
        </div>
      </section>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div
          className={`mx-auto w-full ${form && step === 3 && !sentUrl ? 'max-w-[1180px]' : 'max-w-4xl'}`}
        >
          <div
            className={
              form && step === 3 && !sentUrl
                ? 'pb-8'
                : 'rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-7'
            }
          >
            {!form && (
              <div
                className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) router.push('/formularios');
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Seleccionar formulario publicado"
                  className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-border dark:bg-card"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-base font-semibold">Selecciona un formulario publicado</h2>
                    <button
                      type="button"
                      onClick={() => router.push('/formularios')}
                      aria-label="Cerrar"
                      className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {loading ? (
                    <Loader2 size={20} className="animate-spin text-primary" />
                  ) : forms.length ? (
                    <div className="space-y-2">
                      {forms.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(item.id);
                            setExpirationHours(null);
                            setSignatureType('');
                            setRequireLiveness(false);
                            setError('');
                          }}
                          className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-4 text-left hover:border-primary hover:bg-blue-50/40"
                        >
                          <span>
                            <span className="block font-medium">{item.name}</span>
                            {item.description && (
                              <span className="mt-1 block text-xs text-slate-500">
                                {item.description}
                              </span>
                            )}
                          </span>
                          <ArrowRight size={17} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      No hay formularios publicados. Publica uno para poder lanzarlo.
                    </p>
                  )}
                </div>
              </div>
            )}
            {form && (
              <>
                <div className="space-y-5">
                  {(step !== 3 || sentUrl) && (
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                      <span className="text-slate-500">Formulario:</span>{' '}
                      <strong>{form.name}</strong>
                    </div>
                  )}
                  {sentUrl ? (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
                        <CheckCircle2 className="mb-2" size={25} />
                        <strong>Formulario enviado por correo</strong>
                        <p className="mt-1 text-sm">
                          {selectedParticipant?.name} recibirá el enlace personal.
                        </p>
                      </div>
                      <p className="break-all text-xs text-slate-500">{sentUrl}</p>
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(sentUrl)}
                        className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                      >
                        <Copy size={15} /> Copiar enlace
                      </button>
                    </div>
                  ) : (
                    <>
                      {step === 1 && (
                        <>
                          <div>
                            <h2 className="text-base font-semibold">Lista de participantes</h2>
                            <p className="mt-1 text-sm text-slate-500">
                              Añade una persona para recibir y completar este formulario.
                            </p>
                          </div>
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full min-w-[660px] text-left text-sm">
                              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                                <tr>
                                  <th className="px-4 py-3 font-medium">Nombre</th>
                                  <th className="px-4 py-3 font-medium">Tipo de Firma</th>
                                  <th className="px-4 py-3 font-medium">Notificación</th>
                                  <th className="px-4 py-3 font-medium">Configuración</th>
                                  <th className="px-4 py-3 font-medium">Acciones</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedParticipant ? (
                                  <tr>
                                    <td className="px-4 py-3">
                                      <p className="font-semibold">{selectedParticipant.name}</p>
                                      <p className="text-xs text-slate-500">
                                        {selectedParticipant.email}
                                      </p>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-600">
                                      {signatureType ? signatureLabels[signatureType] : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-600">
                                      Correo electrónico
                                    </td>
                                    <td className="px-4 py-3">
                                      <span
                                        className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${signatureType ? 'bg-emerald-500' : 'bg-red-500'}`}
                                      >
                                        {signatureType ? 'Configurado' : 'Sin configurar'}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3">
                                      <button
                                        type="button"
                                        title="Quitar participante"
                                        aria-label="Quitar participante"
                                        onClick={() => {
                                          setParticipant(null);
                                          setSignatureType('');
                                          setRequireLiveness(false);
                                        }}
                                        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </td>
                                  </tr>
                                ) : (
                                  <tr>
                                    <td
                                      colSpan={5}
                                      className="px-4 py-7 text-center text-sm text-slate-500"
                                    >
                                      No hay un participante seleccionado.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setParticipantTab('contacts');
                              setParticipantPickerOpen(true);
                              setError('');
                            }}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:border-primary hover:text-primary"
                          >
                            <UserPlus size={16} />{' '}
                            {selectedParticipant ? 'Cambiar participante' : 'Agregar participante'}
                          </button>
                          <div className="border-t border-slate-200 pt-5">
                            <h3 className="mb-2 text-sm font-semibold">Método de notificación</h3>
                            <div className="grid gap-2 sm:grid-cols-3">
                              <span className="flex items-center gap-2 rounded-md border border-primary bg-blue-50 p-3 text-sm text-primary">
                                <Mail size={16} /> Correo electrónico
                              </span>
                              <span className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm text-slate-400">
                                <Smartphone size={16} /> SMS · Próximamente
                              </span>
                              <span className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm text-slate-400">
                                <Smartphone size={16} /> WhatsApp · Próximamente
                              </span>
                            </div>
                          </div>
                          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 text-sm">
                            <input
                              type="checkbox"
                              checked={requireLiveness}
                              onChange={(event) => setRequireLiveness(event.target.checked)}
                              className="mt-0.5 h-4 w-4 accent-primary"
                            />
                            <span>
                              <strong className="block">Solicitar prueba de vida</strong>
                              <span className="mt-1 block text-xs text-slate-500">
                                Opcional. Esta solicitud quedará vinculada al participante y a la
                                firma del formulario.
                              </span>
                            </span>
                          </label>
                        </>
                      )}
                      {step === 2 && (
                        <>
                          <div>
                            <h2 className="font-semibold">Tipo de firma</h2>
                            <p className="mt-1 text-sm text-slate-500">
                              Elige cómo deberá firmar el participante después de completar el
                              formulario.
                            </p>
                          </div>
                          <div className="space-y-2">
                            {signatureOptions.map((type) => {
                              const Icon = signatureIcons[type];
                              return (
                                <button
                                  type="button"
                                  key={type}
                                  onClick={() => setSignatureType(type)}
                                  className={`flex w-full items-center justify-between rounded-lg border p-4 text-left text-sm ${signatureType === type ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200'}`}
                                >
                                  <span className="flex items-center gap-3">
                                    <Icon
                                      size={18}
                                      className={
                                        signatureType === type ? 'text-primary' : 'text-slate-400'
                                      }
                                    />
                                    {signatureLabels[type]}
                                  </span>
                                  {signatureType === type && <Check size={16} />}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                      {step === 3 && (
                        <div className="space-y-4">
                          <div className="flex flex-col gap-4 rounded-lg border border-emerald-200/80 bg-emerald-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                                <CheckCircle2 size={20} />
                              </span>
                              <div className="min-w-0">
                                <h2 className="text-lg font-semibold text-slate-950">
                                  Formulario listo para enviar
                                </h2>
                                <p className="mt-0.5 text-sm text-slate-600">
                                  Comprueba la información antes de enviar el enlace personal.
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center divide-x divide-emerald-200 text-center">
                              <div className="px-4 first:pl-0">
                                <p className="text-base font-semibold tabular-nums text-slate-950">
                                  1
                                </p>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                                  Formulario
                                </p>
                              </div>
                              <div className="px-4 pr-0">
                                <p className="text-base font-semibold tabular-nums text-slate-950">
                                  1
                                </p>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                                  Participante
                                </p>
                              </div>
                            </div>
                          </div>

                          <section className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm">
                            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                              <div>
                                <h2 className="text-base font-semibold text-slate-950">
                                  Formulario
                                </h2>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  Contenido que recibirá el participante
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedId('');
                                  setStep(1);
                                  setError('');
                                }}
                                aria-label="Cambiar formulario"
                                title="Cambiar formulario"
                                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-primary"
                              >
                                <Edit3 size={14} />
                              </button>
                            </div>
                            <div className="flex min-w-0 items-center gap-3 px-5 py-5">
                              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary">
                                <FileText size={20} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-950">
                                  {form.name}
                                </p>
                                {form.description && (
                                  <p className="mt-1 truncate text-xs text-slate-500">
                                    {form.description}
                                  </p>
                                )}
                              </div>
                              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 size={12} /> Publicado
                              </span>
                            </div>
                          </section>

                          <section className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm">
                            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                              <div>
                                <h2 className="text-base font-semibold text-slate-950">
                                  Participante
                                </h2>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  Persona que responderá y firmará el formulario
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setStep(1)}
                                aria-label="Editar participante"
                                title="Editar participante"
                                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-primary"
                              >
                                <Edit3 size={14} />
                              </button>
                            </div>
                            <div className="flex items-start gap-3 px-5 py-4">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-semibold text-blue-700">
                                {selectedParticipant?.name.charAt(0).toUpperCase() || '?'}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-950">
                                  {selectedParticipant?.name}
                                </p>
                                <p className="mt-0.5 break-all text-xs text-slate-500">
                                  {selectedParticipant?.email}
                                </p>
                              </div>
                            </div>
                            <div className="grid gap-4 border-t border-slate-100 px-5 py-4 sm:grid-cols-3">
                              <div className="flex items-start gap-2.5">
                                <Mail size={15} className="mt-0.5 shrink-0 text-slate-400" />
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                                    Notificación
                                  </p>
                                  <p className="mt-1 text-sm font-semibold text-slate-800">
                                    Correo electrónico
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-start gap-2.5">
                                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-slate-400" />
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                                    Prueba de vida
                                  </p>
                                  <p className="mt-1 text-sm font-semibold text-slate-800">
                                    {requireLiveness ? 'Solicitada' : 'No solicitada'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-start gap-2.5">
                                {signatureType &&
                                  React.createElement(signatureIcons[signatureType], {
                                    size: 15,
                                    className: 'mt-0.5 shrink-0 text-slate-400',
                                  })}
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                                    Firma
                                  </p>
                                  <p className="mt-1 text-sm font-semibold text-slate-800">
                                    {signatureType ? signatureLabels[signatureType] : 'Pendiente'}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setStep(2)}
                                  aria-label="Editar tipo de firma"
                                  title="Editar tipo de firma"
                                  className="ml-auto rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-primary"
                                >
                                  <Edit3 size={14} />
                                </button>
                              </div>
                            </div>
                          </section>

                          <section className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm">
                            <div className="border-b border-slate-200 px-5 py-4">
                              <h2 className="text-base font-semibold text-slate-950">
                                Momento del envío
                              </h2>
                              <p className="mt-0.5 text-xs text-slate-500">
                                El enlace personal se enviará por correo electrónico.
                              </p>
                            </div>
                            <div className="p-5">
                              <div className="inline-flex items-center gap-2 rounded-md border border-primary bg-blue-50 px-4 py-2.5 text-sm font-semibold text-primary">
                                <Mail size={16} /> Enviar ahora
                              </div>
                              {hasConfiguredExpiration && (
                                <label className="mt-4 block text-sm font-medium text-slate-700">
                                  Vigencia del enlace (horas)
                                  <input
                                    type="number"
                                    min={1 / 60}
                                    max={720}
                                    step="any"
                                    value={effectiveExpirationHours}
                                    onChange={(event) =>
                                      setExpirationHours(Number(event.target.value))
                                    }
                                    className="mt-1 block h-10 w-36 rounded-md border border-slate-200 px-3"
                                  />
                                </label>
                              )}
                              <p className="mt-4 text-xs text-slate-500">
                                El participante podrá responder una sola vez mediante el enlace
                                enviado a su correo.
                              </p>
                            </div>
                          </section>
                        </div>
                      )}
                      {error && (
                        <p role="alert" className="text-sm text-red-600">
                          {error}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
            {error && !form && (
              <p role="alert" className="px-6 pb-5 text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
        </div>
      </main>
      <footer className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2 lg:px-6">
        <button
          type="button"
          disabled={busy || Boolean(sentUrl)}
          onClick={goBack}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowLeft size={16} /> Atrás
        </button>
        {sentUrl ? (
          <button
            type="button"
            onClick={() => router.push('/formularios')}
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-white hover:bg-primary/90"
          >
            Volver a formularios
          </button>
        ) : step === 3 ? (
          <button
            type="button"
            disabled={busy || !form}
            onClick={() => void send()}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Confirmar y
            enviar
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !form}
            onClick={advance}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            Siguiente <ArrowRight size={16} />
          </button>
        )}
      </footer>
      {participantPickerOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="participant-picker-title"
            className="flex h-[min(680px,calc(100dvh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="shrink-0 px-6 pb-4 pt-6">
              <h2 id="participant-picker-title" className="text-xl font-semibold">
                Añadir Participante
              </h2>
              <p className="mt-0.5 text-sm text-slate-400">
                Selecciona un contacto o busca un usuario para enviarle el formulario.
              </p>
            </div>
            <div className="shrink-0 px-6">
              <div className="flex overflow-hidden rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setParticipantTab('contacts');
                    setError('');
                  }}
                  className={`flex flex-1 items-center justify-center gap-2 border-r border-slate-200 py-2.5 text-sm font-medium ${participantTab === 'contacts' ? 'bg-primary text-white' : 'bg-white text-slate-900 hover:bg-slate-50'}`}
                >
                  <Users size={16} /> Mis Contactos
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setParticipantTab('search');
                    setError('');
                  }}
                  className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-medium ${participantTab === 'search' ? 'bg-primary text-white' : 'bg-white text-slate-900 hover:bg-slate-50'}`}
                >
                  <Search size={16} /> Buscar Participante
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {participantTab === 'contacts' ? (
                <div className="space-y-4">
                  <label className="relative block">
                    <Search
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      type="search"
                      aria-label="Buscar en mis contactos"
                      value={contactQuery}
                      onChange={(event) => setContactQuery(event.target.value)}
                      placeholder="Buscar en mis contactos..."
                      className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </label>
                  {showCurrentUser && user?.email && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <User size={16} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {String(user.user_metadata?.full_name || user.email).toUpperCase()} (Tú)
                          </p>
                          <p className="truncate text-xs text-slate-400">{user.email}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          chooseParticipant({
                            id: user.id,
                            name: String(user.user_metadata?.full_name || user.email),
                            email: user.email!,
                          })
                        }
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
                      >
                        <UserPlus size={13} /> Agregar
                      </button>
                    </div>
                  )}
                  {filteredContacts.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <User size={16} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {item.name.toUpperCase()}
                          </p>
                          <p className="truncate text-xs text-slate-400">{item.email}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => chooseParticipant(item)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
                      >
                        <UserPlus size={13} /> Agregar
                      </button>
                    </div>
                  ))}
                  {!filteredContacts.length && !showCurrentUser && (
                    <p className="py-12 text-center text-sm text-slate-400">
                      No se encontraron contactos. Busca un participante en la plataforma.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <select
                      aria-label="Criterio de búsqueda"
                      value={searchCriteria}
                      onChange={(event) => {
                        setSearchCriteria(event.target.value as typeof searchCriteria);
                        setPlatformEmail('');
                        setPlatformResults([]);
                        setPlatformSearched(false);
                      }}
                      className="w-48 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
                    >
                      <option value="correo">Correo Electrónico</option>
                      <option value="telefono">Teléfono</option>
                      <option value="rfc">RFC</option>
                      <option value="curp">CURP</option>
                    </select>
                    <input
                      type={searchCriteria === 'correo' ? 'email' : 'text'}
                      aria-label="Buscar participante"
                      value={platformEmail}
                      onChange={(event) => {
                        const value = event.target.value;
                        setPlatformEmail(
                          searchCriteria === 'telefono'
                            ? value.replace(/\D/g, '').slice(0, 10)
                            : searchCriteria === 'rfc'
                              ? value
                                  .toUpperCase()
                                  .replace(/[^A-Z0-9]/g, '')
                                  .slice(0, 13)
                              : searchCriteria === 'curp'
                                ? value
                                    .toUpperCase()
                                    .replace(/[^A-Z0-9]/g, '')
                                    .slice(0, 18)
                                : value
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void searchPlatform();
                        }
                      }}
                      placeholder={
                        searchCriteria === 'correo'
                          ? 'ejemplo@correo.com'
                          : 'Escribe el dato de búsqueda'
                      }
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
                    />
                    <button
                      type="button"
                      title="Buscar participante"
                      aria-label="Buscar participante"
                      disabled={platformSearching}
                      onClick={() => void searchPlatform()}
                      className="flex w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-white disabled:opacity-50"
                    >
                      {platformSearching ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Search size={16} />
                      )}
                    </button>
                  </div>
                  {!platformSearched ? (
                    <p className="flex items-center gap-2 py-2 text-sm text-slate-400">
                      <Search size={16} /> Realiza una búsqueda para encontrar participantes en la
                      plataforma.
                    </p>
                  ) : !platformSearching && platformResults.length === 0 ? (
                    <p className="py-2 text-sm text-slate-500">
                      No encontramos participantes con ese dato. Puedes añadir uno nuevo con su
                      correo.
                    </p>
                  ) : (
                    platformResults.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {item.name.toUpperCase()}
                          </p>
                          <p className="truncate text-xs text-slate-400">{item.email}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => chooseParticipant(item)}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white"
                        >
                          <UserPlus size={13} /> Agregar
                        </button>
                      </div>
                    ))
                  )}
                  <div className="border-t border-slate-200 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setShowManualParticipant((open) => !open);
                        if (
                          searchCriteria === 'correo' &&
                          emailPattern.test(platformEmail.trim())
                        ) {
                          setManualEmail(platformEmail.trim());
                        }
                        setError('');
                      }}
                      className="inline-flex items-center gap-2 text-sm font-medium text-primary"
                    >
                      <UserPlus size={16} /> Nuevo participante
                    </button>
                    {showManualParticipant && (
                      <div className="mt-3 space-y-3 rounded-lg border border-slate-200 p-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            aria-label="Nombre del nuevo participante"
                            value={manualName}
                            onChange={(event) => setManualName(event.target.value)}
                            placeholder="Nombre completo"
                            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
                          />
                          <input
                            type="email"
                            aria-label="Correo del nuevo participante"
                            value={manualEmail}
                            onChange={(event) => setManualEmail(event.target.value)}
                            placeholder="correo@ejemplo.com"
                            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={addManualParticipant}
                          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white"
                        >
                          <UserPlus size={15} /> Agregar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {error && (
                <p role="alert" className="mt-4 text-sm text-red-600">
                  {error}
                </p>
              )}
            </div>
            <div className="flex shrink-0 justify-end border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  setParticipantPickerOpen(false);
                  setError('');
                }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LaunchFormPage() {
  return (
    <Suspense fallback={null}>
      <LaunchContent />
    </Suspense>
  );
}
