'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  FileText,
  Info,
  Loader2,
  Maximize2,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { BottomNotice } from '@/components/ui/BottomNotice';
import { caseRequest } from '@/lib/case-files/runtime-client';
import { createClient } from '@/lib/supabase/client';
import type { DeliverySummary } from '@/lib/case-files/invitations';
import { CaseInvitationPanel } from '../components/CaseInvitationPanel';
import {
  eligibleLaunchMembers,
  launchContactColumns,
  launchContactPerson,
  launchResponsibilities,
  normalizeLaunchParticipants,
  participantRoleLabels,
  validateLaunchStep,
  type LaunchOptions,
  type LaunchParticipant,
  type LaunchPerson,
} from '@/lib/case-files/launch';
import { CASE_CONTROL_ROLES } from '@/lib/case-files/review-policy';
import LaunchDialog from './LaunchDialog';
import ParticipantPicker from './ParticipantPicker';
import TemplateChooser from './TemplateChooser';
import { SignatureSettings, DeliverySettings } from './LaunchSettings';
import {
  caseSignatureLabels,
  normalizeCaseLaunchSettings,
  type CaseSignatureType,
} from '@/lib/case-files/launch-settings';
import { getEffectiveTimeZone, zonedDateTimeToUtcIso } from '@/lib/datetime';

const steps = [
  {
    label: 'Participantes',
    description: 'Selecciona al titular y las personas relacionadas con el expediente.',
    icon: Users,
  },
  {
    label: 'Responsables',
    description: 'Asigna quién revisa, aprueba y confirma el cierre.',
    icon: ShieldCheck,
  },
  {
    label: 'Firma',
    description: 'Selecciona el método de firma para los elementos que lo requieran.',
    icon: CheckCircle2,
  },
  {
    label: 'Confirmar y enviar',
    description: 'Revisa la información antes de iniciar el expediente.',
    icon: Send,
  },
];
const cardClass = 'rounded-lg border border-slate-200 bg-white p-5 sm:p-6';
const secondaryClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-primary hover:text-primary disabled:opacity-50';
const inputClass =
  'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const membershipLabel = (role: string) =>
  ({ owner: 'Propietario', admin: 'Administrador', member: 'Miembro' })[role] || 'Miembro';

export default function LaunchCasePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="animate-spin text-primary" aria-label="Cargando lanzamiento" />
        </div>
      }
    >
      <LaunchEntry />
    </Suspense>
  );
}
function LaunchEntry() {
  const search = useSearchParams();
  const templateId = search.get('tipo') || '';
  const contact = search.get('contact') || '';
  const contactId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(contact)
    ? contact
    : undefined;
  return templateId ? (
    <LaunchCase
      key={`${templateId}:${contactId || ''}`}
      templateId={templateId}
      initialContactId={contactId}
    />
  ) : (
    <TemplateChooser initialContactId={contactId} />
  );
}
function LaunchCase({
  templateId,
  initialContactId,
}: {
  templateId: string;
  initialContactId?: string;
}) {
  const router = useRouter();
  const [accessMode, setAccessMode] = useState<'private' | 'public'>('private');
  const [urgent, setUrgent] = useState(false);
  const [publicEmail, setPublicEmail] = useState('');
  const [signatureType, setSignatureType] = useState<CaseSignatureType | ''>('');
  const [requireLiveness, setRequireLiveness] = useState(false);
  const [expirationHours, setExpirationHours] = useState(168);
  const [deliveryMode, setDeliveryMode] = useState<'now' | 'scheduled'>('now');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [timezone] = useState(getEffectiveTimeZone);
  const [resultInfo, setResultInfo] = useState<{
    scheduledAt?: string;
    access?: { url: string; code: string };
  } | null>(null);
  const [data, setData] = useState<LaunchOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [launchedId, setLaunchedId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState<LaunchPerson | null>(null);
  const [participants, setParticipants] = useState<LaunchParticipant[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<'subject' | 'additional' | null>(null);
  const [responsibilityPicker, setResponsibilityPicker] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [exitOpen, setExitOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [operationKey] = useState(() => crypto.randomUUID());
  const containerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const stepTitleRef = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const initialContactApplied = useRef(false);

  useEffect(() => {
    let live = true;
    caseRequest<LaunchOptions>(
      `/api/expedientes/opciones?templateId=${encodeURIComponent(templateId)}`
    )
      .then(async (value) => {
        if (!live) return;
        setData(value);
        setTitle((current) => current || value.title);
        setAssignments((current) => {
          const next = { ...current };
          for (const role of launchResponsibilities(value))
            if (role.role === 'owner' && !next[role.key]) next[role.key] = value.actorId;
          return next;
        });
        if (initialContactId && !initialContactApplied.current) {
          const { data: contact } = await createClient()
            .from('contacts')
            .select(launchContactColumns)
            .eq('id', initialContactId)
            .eq('user_id', value.actorId)
            .maybeSingle();
          const person = contact && launchContactPerson(contact);
          if (live && person) {
            initialContactApplied.current = true;
            setSubject((current) => current || person);
            setPublicEmail((current) => current || person.email);
          }
        }
      })
      .catch((cause) => {
        if (live)
          setLoadError(
            cause instanceof Error ? cause.message : 'No se pudo cargar el tipo de expediente.'
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [templateId, retry, initialContactId]);
  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    stepTitleRef.current?.focus();
  }, [step]);

  const responsibilities = data ? launchResponsibilities(data) : [];
  const reviewers = responsibilities.filter((role) => !['approver', 'closer'].includes(role.key));
  const assignedCount = data
    ? responsibilities.filter((role) =>
        eligibleLaunchMembers(data, role, assignments).some(
          (member) => member.id === assignments[role.key]
        )
      ).length
    : 0;
  const activeStep = steps[step];
  const ActiveIcon = activeStep.icon;
  const progress = Math.round((step / (steps.length - 1)) * 100);
  const currentRole = responsibilities.find((role) => role.key === responsibilityPicker);
  const allowedMembers = !data
    ? []
    : responsibilityPicker === 'all-reviewers'
      ? data.members.filter((member) =>
          reviewers.every((role) =>
            eligibleLaunchMembers(data, role, assignments).some(
              (candidate) => candidate.id === member.id
            )
          )
        )
      : currentRole
        ? eligibleLaunchMembers(data, currentRole, assignments)
        : [];

  const changeStep = (next: number) => {
    setError('');
    setStep(next);
  };
  const requestExit = () => {
    if (subject || participants.length || (title && title !== data?.title)) setExitOpen(true);
    else router.push('/expedientes');
  };
  const selectParticipant = (person: LaunchPerson) => {
    try {
      if (picker === 'subject') {
        normalizeLaunchParticipants(participants, person);
        setSubject(person);
      } else
        setParticipants(
          normalizeLaunchParticipants(
            [...participants, { ...person, role: 'contact' }],
            subject || { name: '', email: '' }
          )
        );
      setPicker(null);
      setError('');
      return '';
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Revisa el participante seleccionado.';
    }
  };
  const assignMember = (id: string) => {
    setAssignments((current) => {
      const next = { ...current };
      if (responsibilityPicker === 'all-reviewers')
        reviewers.forEach((role) => {
          next[role.key] = id;
        });
      else if (currentRole) next[currentRole.key] = id;
      const approval = responsibilities.find((role) => role.key === 'approver');
      if (
        data &&
        approval &&
        !eligibleLaunchMembers(data, approval, next).some((member) => member.id === next.approver)
      )
        delete next.approver;
      return next;
    });
    setResponsibilityPicker(null);
    setError('');
  };
  const openResponsible = (key: string) => {
    setMemberQuery('');
    setResponsibilityPicker(key);
    setError('');
  };
  const effectiveSubject: LaunchPerson | null =
    accessMode === 'public'
      ? {
          id: publicEmail.trim().toLowerCase(),
          name: 'Participante invitado',
          email: publicEmail.trim().toLowerCase(),
        }
      : subject;
  const launchSettings = () =>
    normalizeCaseLaunchSettings({
      accessMode,
      urgent,
      signatureType,
      requireLiveness,
      expirationHours,
      timezone,
      subjectPrefill:
        accessMode === 'private' ? { ...subject?.details, full_name: subject?.name || '' } : {},
      scheduledAt:
        deliveryMode === 'scheduled'
          ? zonedDateTimeToUtcIso(scheduleDate, scheduleTime, timezone)
          : null,
    });
  const advance = () => {
    if (!data) return;
    const problem = validateLaunchStep(
      Math.min(step + 1, 3),
      data,
      title,
      effectiveSubject,
      participants,
      assignments
    );
    if (problem) {
      setError(problem);
      return;
    }
    if (step === 2 && !signatureType) {
      setError('Selecciona un tipo de firma.');
      return;
    }
    changeStep(step + 1);
  };
  const submit = async () => {
    if (submitting.current || !data) return;
    const problem = validateLaunchStep(3, data, title, effectiveSubject, participants, assignments);
    if (problem) {
      setError(problem);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const settings = launchSettings();
      if (deliveryMode === 'scheduled' && !settings.scheduledAt)
        throw new Error('Indica la fecha y la hora del envío.');
      const result = await caseRequest<{
        id: string;
        delivery: DeliverySummary | null;
        scheduledAt?: string;
        access?: { url: string; code: string };
      }>('/api/expedientes/iniciar', {
        templateId,
        title: title.trim(),
        subjectName: effectiveSubject!.name,
        subjectUserId: effectiveSubject!.userId || null,
        subjectEmail: effectiveSubject!.email,
        operationKey,
        settings,
        participants,
        assignments: {
          approver: assignments.approver || null,
          closer: assignments.closer || null,
          reviewers: Object.fromEntries(
            data.items
              .filter((item) => item.requiresReview)
              .map((item) => [item.id, assignments[item.id]])
          ),
        },
      });
      if (result.scheduledAt || result.access) {
        setLaunchedId(result.id);
        setResultInfo(result);
        submitting.current = false;
        setBusy(false);
        return;
      }
      if (
        result.delivery &&
        result.delivery.total > 0 &&
        result.delivery.sent === result.delivery.total
      )
        router.push(`/expedientes/${result.id}`);
      else {
        setLaunchedId(result.id);
        setError(
          'El expediente ya se creó. Hay invitaciones pendientes; reinténtalas sin volver a crearlo.'
        );
        submitting.current = false;
        setBusy(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo lanzar el expediente.');
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="docubox-wizard fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-slate-50 text-slate-950"
    >
      <header className="grid min-h-16 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:gap-4 sm:px-4 lg:px-6">
        <AppLogo size={34} imageClassName="max-sm:w-24" />
        <nav
          aria-label="Pasos de lanzamiento del expediente"
          className="mx-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100/80 p-1 sm:gap-1"
        >
          {steps.map(({ label, icon: Icon }, index) => (
            <React.Fragment key={label}>
              <button
                type="button"
                aria-label={label}
                aria-current={step === index ? 'step' : undefined}
                title={label}
                disabled={busy || Boolean(launchedId) || index >= step}
                onClick={() => changeStep(index)}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-sm transition-colors sm:px-2.5 ${step === index ? 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)]' : index < step ? 'text-slate-700 hover:bg-white hover:text-primary' : 'text-slate-400'} disabled:cursor-default`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${step === index ? 'bg-primary text-white' : index < step ? 'bg-primary/10 text-primary' : 'bg-slate-200/70 text-slate-400'}`}
                >
                  {index < step ? <CheckCircle2 size={13} /> : <Icon size={13} />}
                </span>
                <span className="hidden md:inline">{label}</span>
              </button>
              {index < steps.length - 1 && (
                <span
                  className={`h-px w-1 shrink-0 sm:w-3 ${index < step ? 'bg-primary/50' : 'bg-slate-200'}`}
                />
              )}
            </React.Fragment>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={fullscreen ? 'Restaurar pantalla' : 'Pantalla completa'}
            aria-label={fullscreen ? 'Restaurar pantalla' : 'Pantalla completa'}
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await containerRef.current?.requestFullscreen();
              } catch {
                setError('No se pudo ampliar la pantalla.');
              }
            }}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 sm:flex"
          >
            <Maximize2 size={17} />
          </button>
          <button
            type="button"
            title="Salir"
            aria-label="Salir"
            disabled={busy}
            onClick={() => (launchedId ? router.push(`/expedientes/${launchedId}`) : requestExit())}
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
              <ActiveIcon size={16} />
            </span>
            <h1 ref={stepTitleRef} tabIndex={-1} className="text-[20px] font-normal outline-none">
              {activeStep.label}
            </h1>
            <span className="shrink-0 rounded-md bg-slate-200/70 px-1.5 py-0.5 text-sm text-slate-600">
              Paso {step + 1} de {steps.length}
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
          <p className="w-full text-sm text-slate-500 lg:hidden">{activeStep.description}</p>
        </div>
      </section>
      <main ref={mainRef} className="app-page-frame min-h-0 flex-1 overflow-y-auto">
        {launchedId ? (
          <div className="mx-auto max-w-3xl space-y-4">
            <section className={cardClass}>
              <h2 className="text-lg font-semibold">
                {resultInfo?.scheduledAt ? 'Envío programado' : 'Expediente creado'}
              </h2>
              {resultInfo?.scheduledAt && (
                <p className="mt-3 text-sm text-slate-600">
                  Las invitaciones se enviarán el{' '}
                  {new Date(resultInfo.scheduledAt).toLocaleString('es-MX', { timeZone: timezone })}{' '}
                  ({timezone}).
                </p>
              )}
              {resultInfo?.access && (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-slate-500">
                    La invitación y el código se envían en correos separados. Puedes consultar su
                    entrega abajo.
                  </p>
                  <label className="block text-sm">
                    Enlace de acceso
                    <input readOnly value={resultInfo.access.url} className={inputClass} />
                  </label>
                  <label className="block text-sm">
                    Código de acceso
                    <input readOnly value={resultInfo.access.code} className={inputClass} />
                  </label>
                  <button
                    className={secondaryClass}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(resultInfo.access!.code)
                        .catch(() =>
                          setError('No se pudo copiar el código. Selecciona el texto manualmente.')
                        )
                    }
                  >
                    Copiar código
                  </button>
                </div>
              )}
              <p className="mt-2 text-sm text-slate-500">
                Las selecciones están guardadas. Puedes reintentar solo las invitaciones pendientes
                o continuar al expediente.
              </p>
            </section>
            <CaseInvitationPanel caseId={launchedId} />
          </div>
        ) : loading ? (
          <div role="status" className="flex justify-center gap-3 py-20 text-sm text-slate-500">
            <Loader2 className="animate-spin text-primary" size={20} />
            Preparando lanzamiento del expediente...
          </div>
        ) : loadError || !data ? (
          <section className={`${cardClass} mx-auto max-w-2xl`}>
            <h2 className="font-semibold">No se pudo preparar el lanzamiento</h2>
            <p role="alert" className="my-4 text-sm text-slate-600">
              {loadError || 'Selecciona un tipo de expediente disponible.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={secondaryClass}
                onClick={() => {
                  setLoading(true);
                  setLoadError('');
                  setRetry((value) => value + 1);
                }}
              >
                Reintentar
              </button>
              <button
                type="button"
                className={secondaryClass}
                onClick={() => router.push('/expedientes')}
              >
                Ir a expedientes
              </button>
            </div>
          </section>
        ) : (
          <div className="mx-auto grid w-full max-w-[1180px] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-5">
              {step === 0 && (
                <>
                  <section className={`${cardClass} space-y-5`}>
                    <div>
                      <h2 className="text-base font-semibold">Información del expediente</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        El expediente se iniciará con los requisitos de «{data.title}».
                      </p>
                    </div>
                    <label className="block space-y-2 text-sm">
                      <span>
                        Nombre del expediente <span className="text-red-500">*</span>
                      </span>
                      <input
                        required
                        maxLength={240}
                        className={inputClass}
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                      />
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 text-sm">
                      <input
                        type="checkbox"
                        checked={urgent}
                        onChange={(e) => setUrgent(e.target.checked)}
                        className="mt-0.5 accent-primary"
                      />
                      <span>
                        <strong className="font-medium">Marcar como urgente</strong>
                        <span className="mt-1 block text-xs text-slate-500">
                          Identifica este expediente con prioridad urgente en Mi Espacio.
                        </span>
                      </span>
                    </label>
                  </section>
                  <section className={cardClass}>
                    <h2 className="text-base font-semibold">Tipo de acceso</h2>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {(['private', 'public'] as const).map((mode) => (
                        <label
                          key={mode}
                          className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${accessMode === mode ? 'border-primary bg-blue-50/60' : 'border-slate-200'}`}
                        >
                          <input
                            type="radio"
                            name="case-access-mode"
                            checked={accessMode === mode}
                            onChange={() => {
                              setAccessMode(mode);
                              setError('');
                            }}
                            className="mt-1 accent-primary"
                          />
                          <span>
                            <strong className="block text-sm">
                              {mode === 'private' ? 'Privado' : 'Público con código'}
                            </strong>
                            <span className="mt-1 block text-xs leading-5 text-slate-500">
                              {mode === 'private'
                                ? 'Invitación personal con acceso mediante la cuenta destinataria.'
                                : 'Invitación y código separados, con acreditación de identidad.'}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                    {accessMode === 'public' && (
                      <label className="mt-4 block space-y-2 text-sm">
                        <span>Correo del participante</span>
                        <input
                          type="email"
                          value={publicEmail}
                          onChange={(e) => setPublicEmail(e.target.value)}
                          placeholder="correo@ejemplo.com"
                          className={inputClass}
                        />
                      </label>
                    )}
                  </section>
                  {accessMode === 'private' && (
                    <>
                      <section className={`${cardClass} space-y-4`}>
                        <div>
                          <h2 className="text-base font-semibold">Titular del expediente</h2>
                          <p className="mt-1 text-sm text-slate-500">
                            Persona o empresa a la que corresponden los documentos, formularios y
                            verificaciones.
                          </p>
                        </div>
                        {subject ? (
                          <PersonCard
                            person={subject}
                            label="Titular"
                            onChange={() => setPicker('subject')}
                            onRemove={() => setSubject(null)}
                          />
                        ) : (
                          <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                            <UserPlus size={18} className="shrink-0 text-slate-400" />
                            No hay un titular seleccionado.
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setPicker('subject')}
                          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:border-primary hover:text-primary"
                        >
                          <UserPlus size={16} />
                          {subject ? 'Cambiar titular' : 'Agregar titular'}
                        </button>
                      </section>
                    </>
                  )}
                  <section className={cardClass}>
                    <h2 className="text-base font-semibold">Método de notificación</h2>
                    <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                      <CheckCircle2 size={17} className="text-primary" />
                      Correo electrónico
                    </p>
                    <label className="mt-4 flex items-start justify-between gap-3 text-sm">
                      <span>
                        Solicitar prueba de vida
                        <span className="mt-1 block text-xs text-slate-500">
                          {accessMode === 'public'
                            ? 'Obligatoria para el acceso público con código.'
                            : 'El participante acreditará su identidad antes de abrir el expediente.'}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        disabled={accessMode === 'public'}
                        checked={accessMode === 'public' || requireLiveness}
                        onChange={(e) => setRequireLiveness(e.target.checked)}
                        className="accent-primary"
                      />
                    </label>
                  </section>
                  <section className={`${cardClass} space-y-4`}>
                    <div>
                      <h2 className="text-base font-semibold">
                        Participantes adicionales{' '}
                        <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          {participants.length}
                        </span>
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Añade representantes o contactos de seguimiento cuando los necesites.
                      </p>
                    </div>
                    {participants.map((person, index) => (
                      <div
                        key={person.id}
                        className="space-y-2 rounded-lg border border-slate-200 p-3"
                      >
                        <PersonCard
                          person={person}
                          onRemove={() =>
                            setParticipants((current) => current.filter((_, i) => i !== index))
                          }
                          compact
                        />
                        <label className="flex items-center gap-3 px-1 text-xs text-slate-500">
                          <span>Rol en el expediente</span>
                          <select
                            aria-label={`Rol de ${person.name}`}
                            value={person.role}
                            onChange={(event) =>
                              setParticipants((current) =>
                                current.map((value, i) =>
                                  i === index
                                    ? {
                                        ...value,
                                        role: event.target.value as LaunchParticipant['role'],
                                      }
                                    : value
                                )
                              )
                            }
                            className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700"
                          >
                            {Object.entries(participantRoleLabels).map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ))}
                    {!participants.length && (
                      <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
                        Aún no hay participantes adicionales.
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={participants.length >= 20}
                      onClick={() => setPicker('additional')}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      <UserPlus size={16} />
                      Añadir participante
                    </button>
                    <p className="text-xs leading-relaxed text-slate-500">
                      Recibirán una invitación por correo con su enlace personal de seguimiento. No
                      se convierten en miembros del espacio ni se asignan automáticamente a firmas.
                    </p>
                  </section>
                </>
              )}
              {step === 1 && (
                <>
                  <section className={cardClass}>
                    <h2 className="text-base font-semibold">Responsable del expediente</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Coordina la integración y da seguimiento al expediente.
                    </p>
                    <div className="mt-4">
                      <PersonCard
                        person={{
                          id: data.actorId,
                          name:
                            data.members.find((member) => member.id === data.actorId)?.name ||
                            'Mi cuenta',
                          email: '',
                        }}
                        label="Tú · Responsable principal"
                      />
                    </div>
                  </section>
                  {reviewers.length > 0 && (
                    <section className={`${cardClass} space-y-4`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold">Revisión de información</h2>
                          <p className="mt-1 text-sm text-slate-500">
                            Asigna un revisor para cada requisito o formulario.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openResponsible('all-reviewers')}
                          className={secondaryClass}
                        >
                          <Users size={15} />
                          Asignar a todos
                        </button>
                      </div>
                      {reviewers.map((role) => (
                        <ResponsibleRow
                          key={role.key}
                          label={role.label}
                          detail={
                            CASE_CONTROL_ROLES[role.role as keyof typeof CASE_CONTROL_ROLES] ||
                            'Responsable autorizado'
                          }
                          name={
                            data.members.find((member) => member.id === assignments[role.key])?.name
                          }
                          onSelect={() => openResponsible(role.key)}
                        />
                      ))}
                    </section>
                  )}
                  {responsibilities
                    .filter((role) => ['approver', 'closer'].includes(role.key))
                    .map((role) => (
                      <section key={role.key} className={cardClass}>
                        <ResponsibleRow
                          label={role.label}
                          detail={role.detail}
                          name={
                            data.members.find((member) => member.id === assignments[role.key])?.name
                          }
                          onSelect={() => openResponsible(role.key)}
                        />
                        <p className="mt-3 text-xs text-slate-500">
                          {CASE_CONTROL_ROLES[role.role as keyof typeof CASE_CONTROL_ROLES] ||
                            'Responsable autorizado'}
                        </p>
                        {role.key === 'approver' && data.separationOfDuties && (
                          <p className="mt-2 text-xs text-slate-500">
                            La organización requiere un aprobador diferente del responsable
                            principal y de los revisores.
                          </p>
                        )}
                      </section>
                    ))}
                  {!responsibilities.length && (
                    <section className={cardClass}>
                      <div className="flex gap-3">
                        <CheckCircle2 className="shrink-0 text-emerald-600" size={20} />
                        <div>
                          <h2 className="text-sm font-semibold">Sin asignaciones adicionales</h2>
                          <p className="mt-1 text-sm text-slate-500">
                            Este tipo no requiere revisores ni aprobación final. El cierre se
                            evaluará automáticamente.
                          </p>
                        </div>
                      </div>
                    </section>
                  )}
                  {data.policy.completion.mode === 'automatic' && responsibilities.length > 0 && (
                    <p className="flex items-start gap-2 px-1 text-sm text-slate-500">
                      <Info size={16} className="mt-0.5 shrink-0" />
                      El cierre será automático cuando se cumplan todas las condiciones
                      configuradas.
                    </p>
                  )}
                </>
              )}
              {step === 2 && (
                <SignatureSettings
                  value={signatureType}
                  options={data.signatureOptions || Object.keys(caseSignatureLabels)}
                  onChange={setSignatureType}
                />
              )}
              {step === 3 && (
                <>
                  <section className={`${cardClass} space-y-5`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold">Revisar participantes</h2>
                        <p className="mt-1 text-sm text-slate-500">
                          Confirma para quién se integra el expediente.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => changeStep(0)}
                        className={secondaryClass}
                      >
                        <Edit3 size={14} />
                        Editar
                      </button>
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-slate-500">Nombre del expediente</p>
                      <p className="break-words text-base font-semibold">{title}</p>
                    </div>
                    {effectiveSubject && <PersonCard person={effectiveSubject} label="Titular" />}
                    {participants.map((person) => (
                      <PersonCard
                        key={person.id}
                        person={person}
                        label={participantRoleLabels[person.role]}
                      />
                    ))}
                  </section>
                  <section className={`${cardClass} space-y-4`}>
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold">Responsables asignados</h2>
                      <button
                        type="button"
                        onClick={() => changeStep(1)}
                        className={secondaryClass}
                      >
                        <Edit3 size={14} />
                        Editar
                      </button>
                    </div>
                    <dl className="divide-y divide-slate-100">
                      <div className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                        <dt className="text-slate-500">Responsable principal</dt>
                        <dd className="font-medium">
                          {data.members.find((member) => member.id === data.actorId)?.name}
                        </dd>
                      </div>
                      {responsibilities.map((role) => (
                        <div
                          key={role.key}
                          className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                        >
                          <dt className="min-w-0 text-slate-500">
                            {role.key === 'approver' || role.key === 'closer'
                              ? role.label
                              : `Revisión · ${role.label}`}
                          </dt>
                          <dd className="font-medium">
                            {data.members.find((member) => member.id === assignments[role.key])
                              ?.name || 'Sin asignar'}
                          </dd>
                        </div>
                      ))}
                      <div className="flex justify-between gap-2 py-3 text-sm">
                        <dt className="text-slate-500">Modalidad de cierre</dt>
                        <dd className="font-medium">
                          {data.policy.completion.mode === 'manual'
                            ? 'Confirmación del responsable'
                            : 'Automático'}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  <section className={cardClass}>
                    <h2 className="text-base font-semibold">Acceso y firma</h2>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Acceso</dt>
                        <dd>{accessMode === 'public' ? 'Público con código' : 'Privado'}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Firma</dt>
                        <dd>{signatureType ? caseSignatureLabels[signatureType] : 'Sin elegir'}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Prueba de vida</dt>
                        <dd>
                          {accessMode === 'public' || requireLiveness
                            ? 'Solicitada'
                            : 'No solicitada'}
                        </dd>
                      </div>
                    </dl>
                    <button onClick={() => changeStep(2)} className={secondaryClass}>
                      Editar firma
                    </button>
                  </section>
                  <DeliverySettings
                    mode={deliveryMode}
                    onMode={setDeliveryMode}
                    date={scheduleDate}
                    onDate={setScheduleDate}
                    time={scheduleTime}
                    onTime={setScheduleTime}
                    timezone={timezone}
                    hours={expirationHours}
                    onHours={setExpirationHours}
                  />
                  <section className="flex gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
                    <Info className="mt-0.5 shrink-0 text-primary" size={18} />
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        Al lanzar el expediente
                      </h2>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">
                        Se guardarán el titular, los participantes y las asignaciones, y se enviará
                        una invitación por correo a cada participante con un enlace personal vigente
                        según la vigencia seleccionada. Las solicitudes de firma mantienen su propio
                        flujo.
                      </p>
                    </div>
                  </section>
                </>
              )}
            </div>
            <aside className={`${cardClass} space-y-5 lg:sticky lg:top-0`}>
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-primary" />
                <h2 className="text-sm font-semibold">Resumen del expediente</h2>
              </div>
              <div>
                <p className="break-words text-base font-semibold">{data.title}</p>
                <button
                  onClick={() => router.push('/expedientes/lanzar')}
                  className="mt-2 text-xs text-primary"
                >
                  Cambiar expediente
                </button>
                <p className="mt-1 text-xs text-slate-500">{data.category || 'Sin especificar'}</p>
                {data.description && (
                  <p className="mt-3 text-sm leading-relaxed text-slate-500">{data.description}</p>
                )}
              </div>
              <dl className="space-y-3 border-t border-slate-100 pt-4 text-sm">
                {[
                  ['Prioridad', urgent ? 'Urgente' : 'Normal'],
                  ['Secciones', data.sectionCount],
                  [
                    'Requisitos documentales',
                    data.items.filter((item) => item.kind !== 'form').length,
                  ],
                  ['Formularios', data.items.filter((item) => item.kind === 'form').length],
                  ['Verificaciones', data.verificationCount],
                ].map(([label, count]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="font-medium tabular-nums">{count}</dd>
                  </div>
                ))}
              </dl>
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <SummaryStatus
                  complete={Boolean(effectiveSubject)}
                  label={
                    effectiveSubject ? 'Participante seleccionado' : 'Participante por seleccionar'
                  }
                />
                <SummaryStatus
                  complete={assignedCount === responsibilities.length}
                  label={
                    responsibilities.length
                      ? `${assignedCount} de ${responsibilities.length} asignaciones listas`
                      : 'Sin asignaciones adicionales'
                  }
                />
                <SummaryStatus complete={step === 3} label="Confirmación del lanzamiento" />
              </div>
              <p className="border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500">
                La revisión, aprobación y cierre respetan la configuración publicada del tipo de
                expediente.
              </p>
            </aside>
          </div>
        )}
      </main>
      <footer className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2 lg:px-6">
        <button
          type="button"
          disabled={busy || Boolean(launchedId)}
          onClick={() => (step > 0 ? changeStep(step - 1) : requestExit())}
          aria-disabled={Boolean(launchedId)}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowLeft size={16} />
          Atrás
        </button>
        <button
          type="button"
          disabled={busy || loading || !data || Boolean(loadError)}
          onClick={() =>
            launchedId
              ? router.push(`/expedientes/${launchedId}`)
              : step === 3
                ? void submit()
                : advance()
          }
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {launchedId ? (
            'Ver expediente'
          ) : busy ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Lanzando expediente...
            </>
          ) : step === 3 ? (
            <>
              <Send size={16} />
              {deliveryMode === 'scheduled'
                ? 'Programar envío'
                : accessMode === 'public'
                  ? 'Enviar invitación y código'
                  : 'Confirmar y enviar'}
            </>
          ) : (
            <>
              Siguiente
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </footer>
      {error && <BottomNotice message={error} tone="critical" onClose={() => setError('')} />}
      {picker && data && (
        <ParticipantPicker
          key={picker}
          userId={data.actorId}
          members={data.members}
          primary={picker === 'subject'}
          onChoose={selectParticipant}
          onClose={() => setPicker(null)}
        />
      )}
      {responsibilityPicker && data && (
        <LaunchDialog
          title={
            responsibilityPicker === 'all-reviewers'
              ? 'Asignar revisores'
              : 'Seleccionar responsable'
          }
          description={
            responsibilityPicker === 'all-reviewers'
              ? 'Elige a una persona autorizada para todas las revisiones.'
              : `${currentRole?.label || ''} · ${CASE_CONTROL_ROLES[currentRole?.role as keyof typeof CASE_CONTROL_ROLES] || 'Miembro autorizado'}`
          }
          onClose={() => setResponsibilityPicker(null)}
        >
          <label className="relative block">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              type="search"
              aria-label="Buscar responsable"
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder="Buscar miembro del espacio..."
              className={`${inputClass} pl-9`}
            />
          </label>
          <div className="mt-4 space-y-2">
            {allowedMembers
              .filter((member) => member.name.toLowerCase().includes(memberQuery.toLowerCase()))
              .map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 p-4"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <User size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {member.name}
                      {member.id === data.actorId ? ' (Tú)' : ''}
                    </p>
                    <p className="text-xs text-slate-500">{membershipLabel(member.role)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => assignMember(member.id)}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white"
                  >
                    Seleccionar
                  </button>
                </div>
              ))}
            {!allowedMembers.length ? (
              <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
                No hay miembros activos que cumplan los permisos de esta asignación. Revisa la
                configuración del tipo de expediente o los permisos del espacio.
              </p>
            ) : (
              !allowedMembers.some((member) =>
                member.name.toLowerCase().includes(memberQuery.toLowerCase())
              ) && (
                <p className="py-10 text-center text-sm text-slate-500">
                  No se encontraron miembros con ese nombre.
                </p>
              )
            )}
          </div>
        </LaunchDialog>
      )}
      {exitOpen && (
        <LaunchDialog
          title="¿Salir del lanzamiento?"
          description="Los participantes y las asignaciones aún no se han guardado."
          onClose={() => setExitOpen(false)}
          footer={
            <>
              <button type="button" onClick={() => setExitOpen(false)} className={secondaryClass}>
                Seguir configurando
              </button>
              <button
                type="button"
                onClick={() => router.push('/expedientes')}
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white"
              >
                Salir sin lanzar
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-500">
            Puedes continuar ahora o volver a comenzar desde la lista de expedientes.
          </p>
        </LaunchDialog>
      )}
    </div>
  );
}

function PersonCard({
  person,
  label,
  onChange,
  onRemove,
  compact = false,
}: {
  person: LaunchPerson;
  label?: string;
  onChange?: () => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 ${compact ? 'px-1 py-1' : 'rounded-lg border border-slate-200 bg-white p-4'}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-sm font-semibold text-blue-700">
        {person.name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        {label && <p className="mb-0.5 text-xs text-primary">{label}</p>}
        <p className="break-words text-sm font-semibold">{person.name}</p>
        <p className="mt-0.5 break-all text-xs text-slate-500">
          {person.email || 'Cuenta del espacio de trabajo'}
        </p>
      </div>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-primary"
        >
          Cambiar
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={`Quitar a ${person.name}`}
          aria-label={`Quitar a ${person.name}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}
function ResponsibleRow({
  label,
  detail,
  name,
  onSelect,
}: {
  label: string;
  detail: string;
  name?: string;
  onSelect: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-start gap-2">
        <ClipboardCheck className="mt-0.5 shrink-0 text-primary" size={16} />
        <div>
          <h3 className="text-sm font-semibold">{label}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2.5">
        <p
          className={`min-w-0 break-words text-sm ${name ? 'font-medium text-slate-800' : 'text-slate-400'}`}
        >
          {name || 'Sin responsable seleccionado'}
        </p>
        <button
          type="button"
          aria-label={`${name ? 'Cambiar' : 'Seleccionar'} responsable de ${label}`}
          onClick={onSelect}
          className={secondaryClass}
        >
          <Users size={14} />
          {name ? 'Cambiar' : 'Seleccionar'}
        </button>
      </div>
    </div>
  );
}
function SummaryStatus({ complete, label }: { complete: boolean; label: string }) {
  return (
    <p className="flex items-center gap-2 text-xs text-slate-500">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${complete ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}
      >
        {complete ? <Check size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      {label}
    </p>
  );
}
