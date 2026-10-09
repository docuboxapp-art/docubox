'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  FileCog,
  FileText,
  GitBranch,
  Loader2,
  Maximize2,
  PanelLeftOpen,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { BottomNotice } from '@/components/ui/BottomNotice';
import WizardSuccessScreen from '@/components/ui/WizardSuccessScreen';
import { FormBuilderProvider, useFormBuilder } from '@/contexts/FormBuilderContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { useFormAutoSave } from '@/hooks/useFormAutoSave';
import { createClient } from '@/lib/supabase/client';
import { templateApiFetch } from '@/lib/templates/client';
import { readFormPdfDefaults } from '@/lib/forms/pdf-defaults';
import { readFormAppearanceDefaults } from '@/lib/forms/appearance-defaults';
import { readFormExperienceDefaults } from '@/lib/forms/experience-defaults';
import { loadFormDefaults } from '@/lib/forms/remote-defaults';
import {
  createFormRevision,
  createFormVersion,
  FORM_STATUS_LABELS,
  formSaveError,
  formTemplateFromRow,
  publicationError,
  signatureFieldError,
  submitFormForApproval,
  switchFormDraftVersionMode,
  type FormPublicationContext,
} from '@/lib/forms/lifecycle';
import FieldLibrary from '../components/FieldLibrary';
import BuilderCanvas from '../components/BuilderCanvas';
import FieldProperties from '../components/FieldProperties';
import FormPreview from '../components/FormPreview';
import { FormAppearanceSettings, GeneralSettings, PdfSettings } from '../components/WizardSettings';
import FormVersionHistory from '../components/FormVersionHistory';

const STEPS = [
  {
    id: 'general',
    label: 'General',
    icon: Settings2,
    description: 'Define la identidad y experiencia del formulario.',
  },
  {
    id: 'contenido',
    label: 'Contenido',
    icon: FileText,
    description: 'Diseña las secciones y campos que responderán los participantes.',
  },
  {
    id: 'visual',
    label: 'Diseño',
    icon: SlidersHorizontal,
    description: 'Personaliza la presentación del formulario web.',
  },
  {
    id: 'pdf',
    label: 'PDF',
    icon: FileCog,
    description: 'Configura la presentación y el contenido del PDF.',
  },
  {
    id: 'publicacion',
    label: 'Publicación',
    icon: Send,
    description: 'Revisa y decide cómo guardar o publicar esta versión.',
  },
];
const buttonClass =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground';
const primaryClass =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50';

function BuilderWorkspace() {
  const router = useRouter();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const initialId = searchParams.get('id') || undefined;
  const { state, dispatch } = useFormBuilder();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const { save, error, clearError, isSaving, isDirty } = useFormAutoSave(!loading && !loadError, false);
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [notice, setNotice] = useState('');
  const [publicationSuccess, setPublicationSuccess] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitError, setExitError] = useState('');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogExit, setSaveDialogExit] = useState(false);
  const [saveDialogError, setSaveDialogError] = useState('');
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [publication, setPublication] = useState<'draft' | 'published' | 'approval'>('draft');
  const [versionChoice, setVersionChoice] = useState<'revision' | 'version'>('revision');
  const [publicationContextResult, setPublicationContextResult] = useState<{
    key: string;
    context: FormPublicationContext | null;
    error: string;
  } | null>(null);
  const [versionTarget, setVersionTarget] = useState<string | null>(null);
  const loadedId = useRef<string | undefined>(undefined);
  const exitingAfterSave = useRef(false);
  const appliedDefaults = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();
  const template = state.template;
  const publicationContextKey = `${activeWorkspace?.id || ''}:${template.id || ''}`;
  const publicationContext = publicationContextResult?.key === publicationContextKey
    ? publicationContextResult.context : null;
  const publicationContextError = publicationContextResult?.key === publicationContextKey
    ? publicationContextResult.error : '';
  const readOnly = template.status !== 'draft' || Boolean(template.publishedAt);
  const editingPublishedForm = Boolean(template.rootTemplateId && !readOnly);
  const selectedVersionChoice = editingPublishedForm
    ? (template.sourceTemplateId ? 'revision' : 'version')
    : versionChoice;
  const busy = isSaving || creatingVersion || submittingApproval;
  const visibleSteps = STEPS.filter((item) =>
    (item.id !== 'visual' || template.settings.configureFormDetails) &&
    (item.id !== 'pdf' || template.settings.configurePdfDetails)
  );
  const activeStep = visibleSteps[step];
  const StepIcon = activeStep.icon;
  const wizardProgress = Math.round((step / (visibleSteps.length - 1)) * 100);

  useEffect(() => {
    if (initialId || appliedDefaults.current) return;
    if (!activeWorkspace) {
      if (!workspaceLoading) {
        const frame = window.requestAnimationFrame(() => setLoading(false));
        return () => window.cancelAnimationFrame(frame);
      }
      return;
    }
    const workspaceId = activeWorkspace.id;
    let active = true;
    void (async () => {
      let defaults;
      try {
        defaults = await loadFormDefaults(workspaceId);
      } catch {
        const pdf = readFormPdfDefaults(workspaceId);
        defaults = { pdf, appearance: readFormAppearanceDefaults(workspaceId), experience: readFormExperienceDefaults(workspaceId, pdf.configurePdfDetails) };
      }
      if (!active) return;
      appliedDefaults.current = true;
      dispatch({ type: 'APPLY_PDF_DEFAULTS', payload: defaults.pdf });
      dispatch({ type: 'APPLY_APPEARANCE_DEFAULTS', payload: defaults.appearance });
      dispatch({ type: 'APPLY_EXPERIENCE_DEFAULTS', payload: defaults.experience });
      setLoading(false);
    })();
    return () => { active = false; };
  }, [activeWorkspace, dispatch, initialId, workspaceLoading]);

  useEffect(() => {
    if (!initialId || loadedId.current === initialId) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const { data, error: failure } = await supabase
          .from('form_templates')
          .select('*')
          .eq('id', initialId)
          .single();
        if (failure || !data) throw failure || new Error('Formulario no disponible.');
        if (!active) return;
        dispatch({ type: 'SET_TEMPLATE', payload: formTemplateFromRow(data) });
        loadedId.current = initialId;
        setStep(0);
        setFurthest(0);
        setVersionChoice(data.status === 'draft' && data.root_template_id && !data.source_template_id ? 'version' : 'revision');
      } catch {
        if (active) setLoadError('No se pudo cargar el formulario o no tienes acceso.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [initialId, dispatch, supabase]);

  useEffect(() => {
    if (template.id && !initialId && !loading && !exitingAfterSave.current) {
      loadedId.current = template.id;
      router.replace(`/formularios/nuevo?id=${template.id}`);
    }
  }, [template.id, initialId, loading, router]);

  useEffect(() => {
    if (!activeWorkspace?.id || loading || loadError) return;
    let active = true;
    const params = new URLSearchParams({ workspace_id: activeWorkspace.id });
    if (template.id) params.set('form_id', template.id);
    void (async () => {
      try {
        const response = await templateApiFetch(`/api/formularios/publication-context?${params}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo validar la publicación.');
        if (!active) return;
        const context = data as FormPublicationContext;
        setPublicationContextResult({ key: `${activeWorkspace.id}:${template.id || ''}`, context, error: '' });
        setPublication((current) => {
          if (current === 'published' && !context.permissions.canPublish) return 'draft';
          if (current === 'approval' && !context.permissions.canSubmitApproval) return 'draft';
          return current;
        });
      } catch (cause) {
        if (active) setPublicationContextResult({ key: `${activeWorkspace.id}:${template.id || ''}`, context: null, error: formSaveError(cause) });
      }
    })();
    return () => { active = false; };
  }, [activeWorkspace?.id, template.id, loading, loadError]);

  const navigate = (target: number) => {
    const targetStep = visibleSteps[target];
    if (!targetStep) return;
    if (target > step && !readOnly) {
      if (!template.name.trim()) {
        setNotice('Escribe el nombre del formulario.');
        return;
      }
      if (target > visibleSteps.findIndex((item) => item.id === 'contenido')) {
        const missingSignature = signatureFieldError(template);
        if (missingSignature) {
          setNotice(missingSignature);
          return;
        }
      }
      if (targetStep.id !== 'general' && targetStep.id !== 'contenido' && !template.schema.length) {
        setNotice('Agrega al menos un campo.');
        return;
      }
      if (targetStep.id === 'publicacion') {
        const invalid = publicationError(template);
        if (invalid) {
          setNotice(invalid);
          return;
        }
      }
    }
    setStep(target);
    setFurthest((current) => Math.max(current, target));
    setLibraryOpen(false);
    setPropertiesOpen(false);
    setNotice('');
  };

  const saveDraft = async (exit = false) => {
    if (exit) exitingAfterSave.current = true;
    try {
      await save();
      if (exit) router.push('/formularios');
      else {
        setSaveDialogOpen(false);
        setNotice('Borrador guardado.');
      }
    } catch (cause) {
      exitingAfterSave.current = false;
      const message = formSaveError(cause);
      if (saveDialogOpen) setSaveDialogError(message);
      else if (exit) setExitError(message);
      else setNotice(message);
    }
  };
  const openSaveDialog = (exit: boolean) => {
    setSaveDialogExit(exit);
    setSaveDialogError('');
    setSaveDialogOpen(true);
  };
  const requestExit = () => {
    if (!isDirty) {
      router.push('/formularios');
      return;
    }
    setExitError('');
    setExitOpen(true);
  };
  const finish = async () => {
    if (publication === 'draft') {
      openSaveDialog(true);
      return;
    }
    const invalid = publicationError(template);
    if (invalid) {
      setNotice(invalid);
      return;
    }
    if (!publicationContext || !activeWorkspace) {
      setNotice(publicationContextError || 'Aún no se validan los permisos de publicación.');
      return;
    }
    if (publication === 'published' && !publicationContext.permissions.canPublish) {
      setNotice('No tienes permiso para publicar directamente esta versión.');
      return;
    }
    if (publication === 'approval' && (!publicationContext.permissions.canSubmitApproval || !publicationContext.approvalWorkflow)) {
      setNotice('No hay un flujo de aprobación disponible para este formulario.');
      return;
    }
    try {
      if (publication === 'published') {
        const publishedId = await save(true);
        if (template.settings.accessMode === 'public' && publishedId) {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error('La sesión expiró antes de generar el código de acceso.');
          const response = await fetch(`/api/formularios/publico/${encodeURIComponent(publishedId)}/codigo`, {
            headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
          });
          const result = await response.json();
          if (!response.ok || !result.code) throw new Error(result.error || 'No se pudo generar el código de acceso.');
          sessionStorage.setItem('docubox_recent_public_form_access', JSON.stringify({
            name: template.name,
            url: `${window.location.origin}/formulario-publico/${publishedId}`,
            code: result.code,
          }));
        }
        setNotice('');
        setPublicationSuccess(true);
      } else {
        setSubmittingApproval(true);
        const formId = await save();
        if (!formId || !publicationContext.approvalWorkflow) throw new Error('Guarda el borrador antes de enviarlo a aprobación.');
        const reviewed = await submitFormForApproval(supabase, formId, activeWorkspace.id, publicationContext.approvalWorkflow.id);
        dispatch({ type: 'SET_TEMPLATE', payload: reviewed });
        if (reviewed.status === 'published') {
          if (reviewed.settings.accessMode === 'public' && reviewed.id) {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('La sesión expiró antes de generar el código de acceso.');
            const response = await fetch(`/api/formularios/publico/${encodeURIComponent(reviewed.id)}/codigo`, {
              headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
            });
            const result = await response.json();
            if (!response.ok || !result.code) throw new Error(result.error || 'No se pudo generar el código de acceso.');
            sessionStorage.setItem('docubox_recent_public_form_access', JSON.stringify({
              name: reviewed.name,
              url: `${window.location.origin}/formulario-publico/${reviewed.id}`,
              code: result.code,
            }));
          }
          setNotice('');
          setPublicationSuccess(true);
        } else {
          setNotice('Formulario enviado a aprobación.');
        }
      }
    } catch (cause) {
      setNotice(formSaveError(cause));
    } finally {
      setSubmittingApproval(false);
    }
  };
  const newVersion = async (mode: 'revision' | 'version') => {
    if (!template.id || busy) return;
    if (!publicationContext?.permissions.canCreateVersion) {
      setNotice(publicationContextError || 'No tienes permiso para crear una nueva versión.');
      return;
    }
    setCreatingVersion(true);
    try {
      const draft = mode === 'revision'
        ? await createFormRevision(supabase, template.id)
        : await createFormVersion(supabase, template.id);
      loadedId.current = draft.id;
      dispatch({ type: 'SET_TEMPLATE', payload: draft });
      setVersionChoice(mode);
      setStep(0);
      setFurthest(0);
      setPublication('draft');
      router.replace(`/formularios/nuevo?id=${draft.id}`);
      setNotice(mode === 'revision'
        ? `Borrador de la revisión ${draft.revisionNumber} de la versión ${draft.versionNumber}.0 creado.`
        : `Borrador de la versión ${draft.versionNumber}.0 creado.`);
    } catch (cause) {
      setNotice(formSaveError(cause));
    } finally {
      setCreatingVersion(false);
    }
  };
  const changeVersionMode = async (mode: 'revision' | 'version') => {
    if (mode === selectedVersionChoice || !activeWorkspace || !user || busy) return;
    setCreatingVersion(true);
    try {
      const result = await switchFormDraftVersionMode(
        supabase, template, mode, activeWorkspace.id, user.id
      );
      loadedId.current = result.template.id;
      dispatch({ type: 'SET_TEMPLATE', payload: result.template });
      setVersionChoice(mode);
      router.replace(`/formularios/nuevo?id=${result.template.id}`);
      setNotice(result.previousDraftRetained
        ? 'Modalidad cambiada y contenido guardado. El borrador anterior permanece en el historial porque no se pudo retirar.'
        : 'Modalidad cambiada. El contenido editado se conserva en el nuevo borrador.');
    } catch (cause) {
      setNotice(formSaveError(cause));
    } finally {
      setCreatingVersion(false);
    }
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch {
      setNotice('No fue posible cambiar a pantalla completa.');
    }
  };

  if (loading)
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" aria-label="Cargando formulario" />
      </div>
    );
  if (loadError)
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6">
        <p role="alert">{loadError}</p>
        <button className={buttonClass} onClick={() => router.push('/formularios')}>
          Volver a formularios
        </button>
      </div>
    );

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-slate-50 text-slate-950 dark:bg-background dark:text-foreground"
    >
      <header className="grid min-h-16 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-border dark:bg-card sm:gap-4 sm:px-4 lg:px-6">
        <AppLogo size={34} imageClassName="max-sm:w-24" />
        <nav
          aria-label="Pasos de creación de formulario"
          className="mx-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100/80 p-1 dark:border-border dark:bg-muted/60 sm:gap-1"
        >
          {visibleSteps.map(({ label, icon: Icon }, index) => (
            <React.Fragment key={label}>
              <button
                type="button"
                title={label}
                aria-label={label}
                aria-current={index === step ? 'step' : undefined}
                disabled={busy || index > furthest}
                onClick={() => navigate(index)}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-sm font-normal transition-colors sm:px-2.5 ${index === step ? 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)] dark:bg-card' : index <= furthest ? 'text-slate-700 hover:bg-white hover:text-primary dark:text-foreground dark:hover:bg-card' : 'text-slate-400'} disabled:cursor-default`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${index === step ? 'bg-primary text-white' : index < step ? 'bg-primary/10 text-primary' : 'bg-slate-200/70 text-slate-400'}`}
                >
                  {index < step ? <CheckCircle2 size={13} /> : <Icon size={13} />}
                </span>
                <span className="hidden md:inline">{label}</span>
              </button>
              {index < visibleSteps.length - 1 && (
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
            title="Pantalla completa"
            aria-label="Pantalla completa"
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-500 hover:border-slate-200 hover:bg-white sm:flex"
            onClick={toggleFullscreen}
          >
            <Maximize2 size={17} />
          </button>
          <button
            type="button"
            title="Salir"
            aria-label="Salir"
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 sm:px-3"
            onClick={requestExit}
          >
            <X size={16} />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <section className="shrink-0 border-b border-slate-200 bg-[#edf3f8] px-4 py-2 dark:border-border dark:bg-muted lg:px-6">
        <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <StepIcon size={16} />
            </span>
            <h1 className="min-w-0 break-words text-[20px] font-normal">{activeStep.label}</h1>
            <span className="shrink-0 rounded-md bg-slate-200/70 px-1.5 py-0.5 text-sm text-slate-600 dark:bg-background dark:text-muted-foreground">
              Paso {step + 1} de {visibleSteps.length}
            </span>
            <p className="hidden min-w-0 truncate text-sm text-slate-500 lg:block">
              {activeStep.description}
            </p>
            <span className="hidden text-xs text-slate-500 xl:inline">
              v{template.versionNumber || 1}.0{(template.revisionNumber || 1) > 1 ? ` · revisión ${template.revisionNumber}` : ''} · {FORM_STATUS_LABELS[template.status]}
            </span>
          </div>
          <div className="flex w-full items-center gap-2 text-sm text-slate-500 sm:w-44">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-label="Progreso"
              aria-valuenow={wizardProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${wizardProgress}%` }}
              />
            </div>
            <span className="w-8 text-right tabular-nums">{wizardProgress}%</span>
          </div>
          <p className="w-full truncate text-sm text-slate-500 lg:hidden">
            {activeStep.description}
          </p>
        </div>
      </section>

      {(notice || error) && <BottomNotice message={error || notice} tone={error ? 'critical' : undefined} onClose={() => { setNotice(''); clearError(); }} />}

      {activeStep.id === 'contenido' && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-border bg-card px-3 py-2">
          <div
            role="group"
            aria-label="Vistas del formulario"
            className="flex max-w-full items-center rounded-md border border-border bg-muted/50 p-1"
          >
            <ModeButton
              active={state.canvasMode === 'list'}
              icon={FileText}
              label="Estructura"
              onClick={() => dispatch({ type: 'SET_CANVAS_MODE', payload: 'list' })}
            />
            <ModeButton
              active={state.canvasMode === 'preview'}
              icon={Eye}
              label="Formulario web"
              onClick={() => dispatch({ type: 'SET_CANVAS_MODE', payload: 'preview' })}
            />
            <ModeButton
              active={state.canvasMode === 'pdf'}
              icon={ShieldCheck}
              label="PDF espejo"
              onClick={() => dispatch({ type: 'SET_CANVAS_MODE', payload: 'pdf' })}
            />
          </div>
          {!readOnly && state.canvasMode === 'list' && (
            <div className="flex gap-2">
              <button
                type="button"
                title="Biblioteca de campos"
                aria-label="Biblioteca de campos"
                onClick={() => setLibraryOpen(true)}
                className={buttonClass + ' lg:hidden'}
              >
                <PanelLeftOpen size={15} />
              </button>
              <button
                type="button"
                title="Propiedades del campo"
                aria-label="Propiedades del campo"
                onClick={() => setPropertiesOpen(true)}
                className={buttonClass + ' xl:hidden'}
              >
                <SlidersHorizontal size={15} />
              </button>
            </div>
          )}
        </div>
      )}

      <main className="flex min-h-0 flex-1 overflow-hidden">
        {activeStep.id === 'general' && (
          <div className="min-w-0 flex-1 overflow-y-auto">
            <fieldset disabled={readOnly || busy} className="min-w-0">
              <legend className="sr-only">General</legend>
              <GeneralSettings />
            </fieldset>
          </div>
        )}
        {activeStep.id === 'contenido' && (
          <>
            {!readOnly && state.canvasMode === 'list' && (
              <fieldset
                disabled={busy}
                className="hidden w-[300px] shrink-0 lg:block 2xl:w-[340px]"
              >
                <FieldLibrary />
              </fieldset>
            )}
            <div className="min-w-0 flex-1 overflow-hidden">
              {state.canvasMode === 'list' && !readOnly ? (
                <fieldset disabled={busy} inert={busy} className="h-full min-w-0">
                  <BuilderCanvas />
                </fieldset>
              ) : (
                <div className="h-full overflow-y-auto px-4 py-6 md:px-8">
                  <FormPreview
                    template={template}
                    mode={state.canvasMode === 'pdf' ? 'pdf' : 'web'}
                  />
                </div>
              )}
            </div>
            {!readOnly && state.canvasMode === 'list' && (
              <fieldset disabled={busy} className="hidden w-[320px] shrink-0 xl:block">
                <FieldProperties />
              </fieldset>
            )}
          </>
        )}
        {activeStep.id === 'visual' && (
          <div className="min-w-0 flex-1 overflow-y-auto">
            <fieldset disabled={readOnly || busy} className="min-w-0">
              <legend className="sr-only">Diseño del formulario</legend>
              <FormAppearanceSettings onSaveForm={save} />
            </fieldset>
          </div>
        )}
        {activeStep.id === 'pdf' && (
          <div className="min-w-0 flex-1 overflow-y-auto">
            <fieldset disabled={readOnly || busy} className="min-w-0">
              <legend className="sr-only">Diseño del PDF</legend>
              <PdfSettings onSaveForm={save} />
            </fieldset>
          </div>
        )}
        {activeStep.id === 'publicacion' && (
          <div className="min-w-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-5 dark:bg-background lg:px-6">
            <div className="mx-auto grid w-full max-w-[1480px] grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-stretch">
              <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card">
                <h2 className="text-base font-medium text-slate-950 dark:text-foreground">
                  Publicación
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Revisa cómo guardar esta versión del formulario.
                </p>
                {(editingPublishedForm || (readOnly && publicationContext?.permissions.canCreateVersion)) && (
                  <div className="mt-5">
                    <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
                      <legend className="sr-only">Tipo de edición</legend>
                      {([
                        { value: 'revision', title: 'Actualizar la versión actual', description: `Conserva la versión ${editingPublishedForm && !template.sourceTemplateId ? Math.max(1, (template.versionNumber || 2) - 1) : template.versionNumber || 1}.0 y publica una revisión nueva. Los enlaces anteriores mantienen el contenido original.` },
                        { value: 'version', title: 'Crear una nueva versión', description: 'Avanza al siguiente número disponible y conserva la versión actual en el historial.' },
                      ] as const).map((option) => (
                        <label key={option.value} className={`flex min-h-[92px] cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors ${selectedVersionChoice === option.value ? 'border-primary bg-blue-50 ring-1 ring-primary/10' : 'border-slate-200 bg-white hover:border-primary/30 hover:bg-slate-50'}`}>
                          <input type="radio" name="version-choice" value={option.value} checked={selectedVersionChoice === option.value} onChange={() => editingPublishedForm ? void changeVersionMode(option.value) : setVersionChoice(option.value)} className="mt-1 accent-primary" />
                          <span><span className="block text-sm font-medium text-slate-800">{option.title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span></span>
                        </label>
                      ))}
                    </fieldset>
                    {readOnly && (
                      <button type="button" disabled={busy} onClick={() => void newVersion(versionChoice)} className={`${primaryClass} mt-4`}>
                        {creatingVersion ? <Loader2 size={15} className="animate-spin" /> : <GitBranch size={15} />}
                        Crear borrador para editar
                      </button>
                    )}
                  </div>
                )}
                {!readOnly ? (
                  <fieldset disabled={busy || !publicationContext} className="mt-5 grid gap-3 sm:grid-cols-2">
                    <legend className="sr-only">Destino del formulario</legend>
                    {(
                      [
                        {
                          value: 'draft',
                          title: 'Guardar borrador',
                          description: 'Continuar la edición más adelante.',
                        },
                        {
                          value: 'published',
                          title: 'Publicar formulario',
                          description: 'Dejar esta versión disponible para compartir.',
                        },
                        {
                          value: 'approval',
                          title: 'Enviar a aprobación',
                          description: `Solicitar revisión antes de publicar${publicationContext?.approvalWorkflow ? ` · ${publicationContext.approvalWorkflow.name}` : ''}.`,
                        },
                      ] as const
                    ).filter((option) => option.value === 'draft'
                      ? publicationContext?.permissions.canSaveDraft
                      : option.value === 'published'
                        ? publicationContext?.permissions.canPublish
                        : publicationContext?.permissions.canSubmitApproval
                    ).map((option) => (
                      <label
                        key={option.value}
                        className={`flex min-h-[92px] cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors ${publication === option.value ? 'border-primary bg-blue-50 ring-1 ring-primary/10 dark:bg-primary/10' : 'border-slate-200 bg-white hover:border-primary/30 hover:bg-slate-50 dark:border-border dark:bg-card'}`}
                      >
                        <input
                          type="radio"
                          name="publication"
                          value={option.value}
                          checked={publication === option.value}
                          onChange={() => setPublication(option.value)}
                          className="mt-1 accent-primary"
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-800 dark:text-foreground">
                            {option.title}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-slate-500">
                            {option.description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ) : !publicationContext?.permissions.canCreateVersion ? (
                  <p className="mt-5 text-sm text-slate-500">
                    Los enlaces y respuestas permanecen asociados a esta versión. Una nueva versión
                    comienza como borrador.
                  </p>
                ) : null}
                {!readOnly && template.rootTemplateId && (
                  <p className="mt-4 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    {template.revisionNumber && template.revisionNumber > 1
                      ? `Revisión ${template.revisionNumber} de la versión ${template.versionNumber || 1}.0. La publicación anterior y sus enlaces se conservan.`
                      : `Nueva versión ${template.versionNumber || 1}.0. La publicación anterior y sus enlaces se conservan.`}
                  </p>
                )}
                {!readOnly && (
                  <div className="mt-5">
                    <label htmlFor="form-publication-comment" className="block text-sm font-medium text-slate-800 dark:text-foreground">
                      Comentario (opcional)
                    </label>
                    <textarea
                      id="form-publication-comment"
                      rows={3}
                      maxLength={500}
                      disabled={busy}
                      value={template.publicationComment || ''}
                      onChange={(event) => dispatch({ type: 'SET_TEMPLATE_META', payload: { publicationComment: event.target.value } })}
                      placeholder="Agrega un comentario (opcional)..."
                      className="mt-2 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground"
                    />
                    <p className="mt-1 text-right text-xs text-slate-400">{(template.publicationComment || '').length} / 500</p>
                  </div>
                )}
                {!readOnly && !publicationContext && (
                  <p role={publicationContextError ? 'alert' : 'status'} className="mt-3 text-sm text-slate-500">
                    {publicationContextError || 'Validando permisos de publicación…'}
                  </p>
                )}
                {!readOnly && publicationContext && !Object.values(publicationContext.permissions).some((allowed) => allowed) && (
                  <p role="alert" className="mt-3 text-sm text-amber-700">No hay acciones de publicación disponibles para tu rol.</p>
                )}
                <FormVersionHistory
                  template={template}
                  disabled={busy}
                  onSelect={(id) => {
                    if (isDirty) setVersionTarget(id);
                    else router.push(`/formularios/nuevo?id=${id}`);
                  }}
                />
              </section>
              <aside className="xl:self-stretch">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-border dark:bg-card xl:h-full">
                  <h2 className="text-base font-medium text-slate-950 dark:text-foreground">
                    Resumen del formulario
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Comprueba el contenido antes de continuar.
                  </p>
                  <dl className="mt-4 divide-y divide-slate-100 text-sm dark:divide-border">
                    {[
                      ['Nombre', template.name],
                      ['Versión', `${template.versionNumber || 1}.0${(template.revisionNumber || 1) > 1 ? ` · revisión ${template.revisionNumber}` : ''}`],
                      ['Estado', FORM_STATUS_LABELS[template.status]],
                      [
                        'Contenido',
                        `${template.sections.length} ${template.sections.length === 1 ? 'sección' : 'secciones'} · ${template.schema.length} ${template.schema.length === 1 ? 'campo' : 'campos'}`,
                      ],
                      ['PDF', template.settings.configurePdfDetails
                        ? (template.settings.pdfSchema.pageSize === 'letter' ? 'Carta' : 'A4')
                        : 'Predeterminado'],
                      ['Firma', 'Requerida'],
                    ].map(([label, value]) => (
                      <div key={label} className="flex flex-wrap justify-between gap-2 py-3">
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="max-w-full break-words text-right text-slate-800 dark:text-foreground">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <button
                    type="button"
                    className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-border dark:bg-card dark:text-foreground"
                    onClick={() => {
                      navigate(1);
                      dispatch({ type: 'SET_CANVAS_MODE', payload: 'pdf' });
                    }}
                  >
                    <Eye size={15} /> Revisar PDF espejo
                  </button>
                </section>
              </aside>
            </div>
          </div>
        )}
      </main>

      <footer className="z-20 flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2 dark:border-border dark:bg-card lg:px-6">
        <button
          type="button"
          disabled={busy}
          onClick={() => (step > 0 ? navigate(step - 1) : requestExit())}
          className={buttonClass}
        >
          <ArrowLeft size={16} /> Atrás
        </button>
        <div className="flex items-center gap-2 sm:gap-3">
          {!readOnly && (
            <button
              type="button"
              disabled={busy}
              onClick={() => openSaveDialog(false)}
              className={buttonClass}
              title="Guardar borrador"
            >
              <Save size={15} />
              <span className="hidden sm:inline">Guardar borrador</span>
            </button>
          )}
          {step < visibleSteps.length - 1 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => navigate(step + 1)}
              className={primaryClass}
            >
              Siguiente
              <ArrowRight size={16} />
            </button>
          ) : readOnly ? (
            publicationContext?.permissions.canCreateVersion ? (
              <button type="button" disabled={busy} onClick={() => void newVersion(versionChoice)} className={primaryClass}>
                {creatingVersion ? <Loader2 size={15} className="animate-spin" /> : <GitBranch size={15} />}
                Crear borrador para editar
              </button>
            ) : (
              <button type="button" onClick={() => router.push('/formularios')} className={buttonClass}>Volver a formularios</button>
            )
          ) : (
            <button type="button" disabled={busy || (publication !== 'draft' && !publicationContext)} onClick={finish} className={primaryClass}>
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : publication === 'published' || publication === 'approval' ? (
                <Send size={15} />
              ) : (
                <Save size={15} />
              )}
              {publication === 'published' ? 'Publicar formulario' : publication === 'approval' ? 'Enviar a aprobación' : 'Guardar y salir'}
            </button>
          )}
        </div>
      </footer>

      {publicationSuccess && (
        <WizardSuccessScreen
          title="Formulario publicado"
          description={template.settings.accessMode === 'public'
            ? 'El enlace y el código de acceso están listos para compartir.'
            : 'El formulario está listo para lanzarse a los participantes.'}
          destination="/formularios"
          destinationLabel="Formularios"
        />
      )}

      {(libraryOpen || propertiesOpen) && (
        <div
          className="fixed inset-0 z-[80]"
          role="dialog"
          aria-modal="true"
          aria-label={libraryOpen ? 'Biblioteca de campos' : 'Propiedades del campo'}
        >
          <button
            type="button"
            aria-label="Cerrar panel"
            onClick={() => {
              setLibraryOpen(false);
              setPropertiesOpen(false);
            }}
            className="absolute inset-0 bg-black/35"
          />
          <div
            className={`absolute inset-y-0 w-[min(340px,92vw)] bg-card shadow-xl ${libraryOpen ? 'left-0' : 'right-0'}`}
          >
            <button
              type="button"
              aria-label="Cerrar panel"
              onClick={() => {
                setLibraryOpen(false);
                setPropertiesOpen(false);
              }}
              className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-md bg-card shadow-sm"
            >
              <X size={16} />
            </button>
            <fieldset disabled={busy} className="h-full">
              {libraryOpen ? <FieldLibrary /> : <FieldProperties />}
            </fieldset>
          </div>
        </div>
      )}
      {exitOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-title"
        >
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-border dark:bg-card">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <AlertTriangle size={21} />
              </span>
              <div>
                <h2 id="exit-title" className="text-base font-semibold text-slate-900 dark:text-foreground">¿Deseas salir?</h2>
                <p className="mt-1 text-sm text-slate-500">Tienes cambios sin guardar en este formulario.</p>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-600 dark:text-muted-foreground">
              {template.id
                ? 'Puedes guardar los cambios en el borrador para continuar después. Si sales sin guardar, se conservará la última versión guardada.'
                : 'Puedes guardar tu avance como borrador para continuar después, o salir sin guardar y descartar este formulario.'}
            </p>
            {exitError && <p role="alert" className="mt-3 text-sm text-red-600">{exitError}</p>}
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveDraft(true)}
                className={`${primaryClass} w-full`}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {busy ? 'Guardando...' : 'Guardar borrador y salir'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => router.push('/formularios')}
                className="inline-flex h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-red-600 transition-colors hover:border-red-200 hover:bg-red-50 disabled:opacity-50 dark:border-border dark:bg-card"
              >
                Salir sin guardar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setExitOpen(false)}
                className={`${buttonClass} w-full`}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {versionTarget && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="version-change-title">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-border dark:bg-card">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><AlertTriangle size={21} /></span>
              <div>
                <h2 id="version-change-title" className="text-base font-semibold">Cambios sin guardar</h2>
                <p className="mt-1 text-sm text-slate-500">Al abrir otra versión se perderán los cambios posteriores al último guardado.</p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setVersionTarget(null)} className={buttonClass}>Continuar editando</button>
              <button type="button" onClick={() => { router.push(`/formularios/nuevo?id=${versionTarget}`); setVersionTarget(null); }} className={primaryClass}>Abrir versión</button>
            </div>
          </div>
        </div>
      )}
      {saveDialogOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="save-draft-title">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-border dark:bg-card">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary dark:bg-primary/10"><Save size={20} /></span>
              <div>
                <h2 id="save-draft-title" className="text-base font-semibold text-slate-900 dark:text-foreground">Guardar borrador</h2>
                <p className="mt-1 text-sm text-slate-500">¿Deseas guardar el avance de este formulario?</p>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-600 dark:text-muted-foreground">
              {isDirty || !template.id
                ? 'Se guardará como borrador en Mis formularios. Podrás continuar editándolo después.'
                : 'Este borrador ya está guardado en Mis formularios.'}
            </p>
            {saveDialogError && <p role="alert" className="mt-3 text-sm text-red-600">{saveDialogError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setSaveDialogOpen(false)} className={buttonClass}>Cancelar</button>
              <button type="button" disabled={busy} onClick={() => void saveDraft(saveDialogExit)} className={primaryClass}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {busy ? 'Guardando...' : saveDialogExit ? 'Guardar y salir' : 'Guardar borrador'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs transition sm:px-3 ${active ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
    >
      <Icon size={13} className="hidden min-[380px]:block" />
      {label}
    </button>
  );
}

export default function FormBuilderPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center">
          <Loader2 className="animate-spin text-primary" />
        </div>
      }
    >
      <FormBuilderProvider>
        <BuilderWorkspace />
      </FormBuilderProvider>
    </Suspense>
  );
}
