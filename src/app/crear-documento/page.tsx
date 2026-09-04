'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import {
  Upload,
  Users,
  Settings,
  Send,
  X,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Save,
  LayoutGrid,
  Maximize2,
} from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import { ExitConfirmModal } from './components/ExitConfirmModal';
import { StepSubir } from './components/StepSubir';
import { StepParticipantes } from './components/StepParticipantes';
import { StepAgrupamiento } from './components/StepAgrupamiento';
import { StepAjustes } from './components/StepAjustes';
import { StepEnviar } from './components/StepEnviar';
import type { StepEnviarHandle } from './components/StepEnviar';
import { StepFlujoTrabajo } from './components/StepFlujoTrabajo';
import type {
  Participant,
  DocumentSettings,
  DocumentConfig,
  ParticipantMode,
  GrupoFirma,
  SecuritySettings,
  DocuboxSourceSelection,
} from './components/types';

// ─── Helper: derive tipo from field label ─────────────────────────────────────
function getLabelTipo(label: string): string {
  const map: Record<string, string> = {
    Firma: 'firma',
    'Nombre Completo': 'nombre_completo',
    RFC: 'rfc',
    CURP: 'curp',
    'Correo Electrónico': 'correo',
    'Número Telefónico': 'telefono',
    Dirección: 'direccion',
    Texto: 'texto',
    Fecha: 'fecha',
    Hora: 'hora',
    Número: 'numero',
    Moneda: 'moneda',
    Casilla: 'checkbox',
    Imagen: 'imagen',
    'Botones de opción': 'radio',
    Desplegable: 'dropdown',
    'Cadena original': 'document_chain',
    'Sello digital': 'document_seal',
    'Estampa de tiempo': 'timestamp',
    'Cadena de evidencia': 'evidence_chain',
  };
  return map[label] || 'texto';
}

// ─── Pipeline de seguridad (Capa 1 + Capa 2) — ejecutado en background ───────
const ALLOWED_MIME_TYPES_PAGE = [
  'application/pdf',
  'application/vnd.openxmlformats',
  'image/png',
  'image/jpeg',
];
const MAX_FILE_SIZE_BYTES_PAGE = 50 * 1024 * 1024;

async function validateMimeByMagicBytesPage(file: File): Promise<string | null> {
  const slice = file.slice(0, 8);
  const buffer = await slice.arrayBuffer();
  const b = new Uint8Array(buffer);
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)
    return 'application/vnd.openxmlformats';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

async function sanitizePDFPage(file: File): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const catalog = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Root) as any;
  if (catalog) {
    try {
      catalog.delete('JavaScript');
    } catch {
      /* ignorar */
    }
    try {
      catalog.delete('JS');
    } catch {
      /* ignorar */
    }
    try {
      catalog.delete('OpenAction');
    } catch {
      /* ignorar */
    }
    try {
      catalog.delete('AA');
    } catch {
      /* ignorar */
    }
  }
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('');
  pdfDoc.setCreator('');
  return await pdfDoc.save();
}

/** Resultado del pipeline de seguridad pre-ejecutado */
export interface PreProcessedFile {
  bytes: Uint8Array;
  mime: string;
  /** 'ready' = procesado OK, 'error_tipo' | 'error_grande' | 'error_invalido' = falló */
  status: 'ready' | 'error_tipo' | 'error_grande' | 'error_invalido';
}
// ─────────────────────────────────────────────────────────────────────────────

const BASE_STEPS = [
  { id: 1, label: 'Subir', icon: Upload },
  { id: 2, label: 'Participantes', icon: Users },
  { id: 3, label: 'Ajustes', icon: Settings },
  { id: 4, label: 'Enviar', icon: Send },
];

const MIXTO_STEPS = [
  { id: 1, label: 'Subir', icon: Upload },
  { id: 2, label: 'Participantes', icon: Users },
  { id: 3, label: 'Agrupamiento', icon: LayoutGrid },
  { id: 4, label: 'Ajustes', icon: Settings },
  { id: 5, label: 'Enviar', icon: Send },
];

const CONDICIONAL_STEPS = [
  { id: 1, label: 'Subir', icon: Upload },
  { id: 2, label: 'Participantes', icon: Users },
  { id: 3, label: 'Ajustes', icon: Settings },
  {
    id: 4,
    label: 'Flujo de Trabajo',
    icon: () => (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        width="14"
        height="14"
      >
        <circle cx="6" cy="18" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="6" cy="6" r="2" />
        <path d="M6 8v8M8 6h8" />
      </svg>
    ),
  },
  { id: 5, label: 'Enviar', icon: Send },
];

function generateDocumentoId(): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `DOC-${year}-${rand}`;
}

function CrearDocumentoPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, emailVerified, refreshEmailVerified } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [docuboxSource, setDocuboxSource] = useState<DocuboxSourceSelection | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantMode, setParticipantMode] = useState<ParticipantMode>(null);
  const [participationOrder, setParticipationOrder] = useState<string>('');
  const [grupos, setGrupos] = useState<GrupoFirma[]>([]);
  const [settings, setSettings] = useState<DocumentSettings>({
    title: '',
    message: '',
    deadline: '',
    reminderDays: '3',
    requireAllSignatures: true,
    allowDecline: false,
  });
  const [docConfig, setDocConfig] = useState<DocumentConfig>({
    nombre: '',
    descripcion: '',
    numeroOficio: '',
    grupotipoId: '',
    tipoDocumentoId: '',
    otroTipoDocumento: '',
    ruta: 'raiz',
    etiquetasIds: [],
    additionalMetadata: [],
  });
  const [placedFields, setPlacedFields] = useState<import('./components/types').PlacedField[]>([]);
  const [ajustesFixarCampos, setAjustesFixarCampos] = useState(false);
  const [ajustesHasFirma, setAjustesHasFirma] = useState(false);
  const [securitySummary, setSecuritySummary] = useState<SecuritySettings | undefined>(undefined);
  const [documentoId] = useState<string>(() => {
    const year = new Date().getFullYear();
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `DOC-${year}-${rand}`;
  });
  const [viewMode] = useState<'split' | 'stacked'>('split');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftDbId, setDraftDbId] = useState<string | null>(null);
  const stepEnviarRef = useRef<StepEnviarHandle>(null);
  const [enviarSending, setEnviarSending] = useState(false);
  // Estado del pipeline de seguridad pre-ejecutado
  const [preProcessedFile, setPreProcessedFile] = useState<PreProcessedFile | null>(null);
  const [isPreProcessing, setIsPreProcessing] = useState(false);
  const [pdfMetadata, setPdfMetadata] = useState<{
    pageCount: number;
    title?: string;
    author?: string;
    creationDate?: string;
  } | null>(null);

  const isMixto = participationOrder === 'mixto';
  const isCondicional = participationOrder === 'condicional';
  const STEPS = isMixto ? MIXTO_STEPS : isCondicional ? CONDICIONAL_STEPS : BASE_STEPS;

  const currentStepLabel = STEPS.find((s) => s.id === currentStep)?.label ?? '';
  const CurrentStepIcon = STEPS.find((s) => s.id === currentStep)?.icon ?? Upload;
  const currentStepDescription =
    (
      {
        Subir: 'Carga el archivo y define sus propiedades iniciales.',
        Participantes: 'Elige quienes participan y configura su intervencion.',
        Agrupamiento: 'Organiza los grupos y el orden de participacion.',
        Ajustes: 'Define los campos que deberá completar cada participante.',
        'Flujo de Trabajo': 'Define condiciones y acciones para el proceso.',
        Enviar: 'Revisa la información final antes de iniciar el proceso.',
      } as Record<string, string>
    )[currentStepLabel] ?? 'Configura el documento antes de enviarlo.';
  const completionPercent = Math.round(((currentStep - 1) / Math.max(STEPS.length - 1, 1)) * 100);

  // Load draft from Supabase if draftId is in URL
  useEffect(() => {
    const draftId = searchParams?.get('draft');
    if (!draftId || !user) return;
    const loadDraft = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('documentos')
          .select('*')
          .eq('id', draftId)
          .eq('estado', 'borrador')
          .single();
        if (error || !data) return;
        // Restore config
        setDocConfig({
          nombre: data.nombre || '',
          descripcion: data.descripcion || '',
          numeroOficio: data.numero_oficio || '',
          grupotipoId: data.grupo_tipo_documento_id || '',
          tipoDocumentoId: data.tipo_documento_id || '',
          otroTipoDocumento: '',
          ruta: data.ruta_guardado || 'raiz',
          etiquetasIds: data.etiquetas_ids || [],
          additionalMetadata: Array.isArray(data.additional_metadata)
            ? data.additional_metadata
            : [],
        });
        if (data.participantes && Array.isArray(data.participantes)) {
          setParticipants(data.participantes);
        }
        if (data.participation_order) setParticipationOrder(data.participation_order);
        if (data.participant_mode) setParticipantMode(data.participant_mode as ParticipantMode);
        if (data.ultimo_paso) setCurrentStep(data.ultimo_paso);
        setDraftDbId(draftId);
      } catch (err) {
        console.error('Error loading draft:', err);
      }
    };
    loadDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Refresh email verification status on mount to get latest DB value
  useEffect(() => {
    refreshEmailVerified();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canGoNext = (() => {
    if (currentStep === 1) {
      if (!file || !docConfig.nombre.trim()) return false;
      if (docConfig.tipoDocumentoId === '__otros__' && !docConfig.otroTipoDocumento.trim())
        return false;
      if (securitySummary?.legalHoldEnabled && !securitySummary.legalHoldReason) return false;
      return true;
    }
    if (currentStepLabel === 'Participantes') {
      return (
        participantMode !== null &&
        participants.length > 0 &&
        participants.every((p) => p.configured === true) &&
        (participantMode === 'solo_yo' || participationOrder !== '')
      );
    }
    if (currentStepLabel === 'Agrupamiento') {
      const assignedIds = new Set(grupos.flatMap((g) => g.participantIds));
      return grupos.length > 0 && participants.every((p) => assignedIds.has(p.id));
    }
    if (currentStepLabel === 'Ajustes') {
      if (ajustesFixarCampos && !ajustesHasFirma) return false;
      return true;
    }
    return true;
  })();

  const nextButtonLabel =
    currentStepLabel === 'Ajustes' && !ajustesFixarCampos
      ? 'Continuar sin asignar campos'
      : 'Siguiente';

  const isLastStep = currentStep === STEPS.length;

  const handleNext = () => {
    if (canGoNext && currentStep < STEPS.length) {
      // Disparar pipeline de seguridad al salir del paso Participantes
      if (currentStepLabel === 'Participantes' && file && !preProcessedFile && !isPreProcessing) {
        setIsPreProcessing(true);
        (async () => {
          try {
            if (file.size > MAX_FILE_SIZE_BYTES_PAGE) {
              setPreProcessedFile({ bytes: new Uint8Array(), mime: '', status: 'error_grande' });
              return;
            }
            const detectedMime = await validateMimeByMagicBytesPage(file);
            if (!detectedMime || !ALLOWED_MIME_TYPES_PAGE.includes(detectedMime)) {
              setPreProcessedFile({ bytes: new Uint8Array(), mime: '', status: 'error_tipo' });
              return;
            }
            let bytes: Uint8Array;
            if (detectedMime === 'application/pdf') {
              try {
                bytes = await sanitizePDFPage(file);
              } catch {
                setPreProcessedFile({
                  bytes: new Uint8Array(),
                  mime: detectedMime,
                  status: 'error_invalido',
                });
                return;
              }
            } else {
              bytes = new Uint8Array(await file.arrayBuffer());
            }
            setPreProcessedFile({ bytes, mime: detectedMime, status: 'ready' });
            console.log(
              '[DOCUBOX][security] Pipeline pre-ejecutado: MIME =',
              detectedMime,
              '| bytes =',
              bytes.byteLength
            );
          } catch (err) {
            console.warn('[DOCUBOX][security] Error en pre-procesamiento (no bloqueante):', err);
            // No bloquear la navegación; StepEnviar ejecutará el pipeline normalmente
          } finally {
            setIsPreProcessing(false);
          }
        })();
      }
      setCurrentStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep((s) => s - 1);
  };

  const handleOrderChange = (order: string) => {
    setParticipationOrder(order);
    if (order !== 'mixto') setGrupos([]);
  };

  const handleGuardarAvance = async (): Promise<boolean> => {
    if (!file) return false;
    if (!docConfig.nombre.trim()) return false;
    if (!user) {
      router.push('/login');
      return false;
    }
    setSavingDraft(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        router.push('/login');
        return false;
      }

      const docId = draftDbId || generateDocumentoId();

      const res = await fetch('/api/documentos/guardar-borrador', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          documentoId: docId,
          draftDbId: draftDbId || null,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || 'application/octet-stream',
          fileHash: 'draft',
          nombre: docConfig.nombre || file.name.replace(/\.[^/.]+$/, ''),
          descripcion: docConfig.descripcion || null,
          numeroOficio: docConfig.numeroOficio || null,
          grupotipoId: docConfig.grupotipoId || null,
          tipoDocumentoId: docConfig.tipoDocumentoId || null,
          otroTipoDocumento:
            docConfig.tipoDocumentoId === '__otros__'
              ? docConfig.otroTipoDocumento || null
              : docConfig.tipoDocumentoId
                ? null
                : 'No especificado',
          ruta: docConfig.ruta || 'raiz',
          etiquetasIds: docConfig.etiquetasIds || [],
          currentStep,
          participationOrder: participationOrder || null,
          participantMode: participantMode || null,
          participants,
          workspaceId: activeWorkspace?.id || null,
          vencimientoEnabled: securitySummary?.vencimientoEnabled ?? false,
          fechaVencimiento: securitySummary?.fechaVencimiento || null,
          codigoAccesoEnabled: securitySummary?.codigoAccesoEnabled ?? false,
          proteccionAdicionalEnabled: securitySummary?.proteccionAdicionalEnabled ?? false,
          impedirImpresion: securitySummary?.impedirImpresion ?? false,
          evitarCopiaTexto: securitySummary?.evitarCopiaTexto ?? false,
          impedirModificacion: securitySummary?.impedirModificacion ?? false,
          impedirExtraccion: securitySummary?.impedirExtraccion ?? false,
          evitarMontaje: securitySummary?.evitarMontaje ?? false,
          legalHoldEnabled: securitySummary?.legalHoldEnabled ?? false,
          legalHoldReason: securitySummary?.legalHoldReason || null,
          recordatorioFrecuencia: securitySummary?.recordatorioFrecuencia || null,
          urgente: securitySummary?.urgente ?? false,
          publico: securitySummary?.publico ?? false,
          selloDigital: securitySummary?.selloDigital ?? false,
          selloUbicacion: securitySummary?.selloUbicacion || 'calce',
          estampaAutenticacion: securitySummary?.estampaAutenticacion ?? false,
          metadatosAdicionales: securitySummary?.metadatosAdicionales ?? false,
          additionalMetadata: docConfig.additionalMetadata,
          camposSolicitados: placedFields.map((f) => ({
            id: f.id,
            label: f.label,
            tipo: getLabelTipo(f.label),
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            page: f.page || 1,
            participantId: f.participantId || null,
            participantName: f.participantName || null,
            colorHex: f.colorHex || null,
            placementKind: f.placementKind || null,
            cryptographicType: f.cryptographicType || null,
            generatedOnCompletion: f.generatedOnCompletion ?? false,
            dropdownOptions: f.dropdownOptions || null,
            radioOptions: f.radioOptions || null,
            casillaLabel: f.casillaLabel || null,
            fieldConfig: f.fieldConfig || null,
            fieldTypeConfig: f.fieldTypeConfig || null,
          })),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        console.error('[DOCUBOX][borrador] Error al guardar borrador:', json.error);
        return false;
      }

      if (!draftDbId && json.data?.id) {
        setDraftDbId(json.data.id);
      }

      setDraftSaved(true);
      return true;
    } catch (err: any) {
      console.error('Error saving draft:', err);
      return false;
    } finally {
      setSavingDraft(false);
    }
  };

  // Called from footer "Guardar Avance" button — shows the exit modal
  const handleGuardarAvanceClick = () => {
    setShowExitModal(true);
  };

  const handleGuardarAvanceAndExit = async () => {
    const success = await handleGuardarAvance();
    if (success) {
      router.push('/mis-documentos');
    }
  };

  const handleToggleFullscreen = () => {
    if (!isFullscreen) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
    setIsFullscreen((v) => !v);
  };

  const handleEnviarDocumento = async () => {
    if (stepEnviarRef.current) {
      setEnviarSending(true);
      await stepEnviarRef.current.handleEnviar();
      setEnviarSending(false);
    }
  };

  // Determine if "Guardar Avance" should be enabled (needs file + nombre)
  const canSaveDraft = !!file && !!docConfig.nombre.trim();

  // Block document creation if email not verified
  if (emailVerified === false) {
    return (
      <div className="h-screen bg-white flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-8 h-8 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-3">Verifica tu correo electrónico</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-6">
            Para crear documentos necesitas verificar tu correo electrónico. Revisa tu bandeja de
            entrada y haz clic en el enlace de verificación que te enviamos al registrarte.
          </p>
          <button
            onClick={() => router.push('/inicio')}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
          >
            Volver al dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-screen flex-col bg-slate-50 text-slate-950">
      {showExitModal && (
        <ExitConfirmModal
          canSave={canSaveDraft}
          onClose={() => setShowExitModal(false)}
          onExitWithoutSave={() => router.push('/mis-documentos')}
          onSaveDraft={handleGuardarAvanceAndExit}
          saving={savingDraft}
        />
      )}

      <header className="flex h-16 shrink-0 items-center border-b border-slate-200 bg-white px-4 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <AppLogo size={34} />
          <div className="hidden h-8 w-px bg-slate-200 lg:block" />
          <div className="hidden min-w-0 lg:block">
            <p className="truncate text-sm font-700 text-slate-950">Nuevo documento</p>
            <p className="truncate text-xs text-slate-500">
              {activeWorkspace?.name || 'Espacio personal'}
            </p>
          </div>
        </div>
        <nav className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 xl:flex">
          {STEPS.map((step, idx) => {
            const StepIcon = step.icon;
            const isActive = step.id === currentStep;
            const isCompleted = step.id < currentStep;
            return (
              <React.Fragment key={step.id}>
                <button
                  onClick={() => step.id < currentStep && setCurrentStep(step.id)}
                  className={`flex h-8 items-center gap-2 rounded-md px-3 text-xs font-600 transition-colors ${isActive ? 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)]' : isCompleted ? 'cursor-pointer text-slate-700 hover:bg-white hover:text-primary' : 'cursor-default text-slate-400'}`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${isActive ? 'bg-primary text-white' : isCompleted ? 'bg-primary/10 text-primary' : 'bg-slate-200/70 text-slate-400'}`}
                  >
                    {isCompleted ? <CheckCircle2 size={13} /> : <StepIcon size={13} />}
                  </span>
                  <span>{step.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`h-px w-3 ${step.id < currentStep ? 'bg-primary/50' : 'bg-slate-200'}`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </nav>
        <div className="flex flex-1 items-center justify-end gap-1.5">
          <button
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Restaurar pantalla' : 'Maximizar pantalla'}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-500 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950"
          >
            <Maximize2 size={17} />
          </button>
          <button
            onClick={() => setShowExitModal(true)}
            title="Salir"
            className="ml-0.5 flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <X size={16} />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <div className="shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 xl:hidden">
        <nav className="mx-auto flex min-w-max items-center gap-1">
          {STEPS.map((step) => {
            const StepIcon = step.icon;
            const isActive = step.id === currentStep;
            const isCompleted = step.id < currentStep;
            return (
              <button
                key={step.id}
                onClick={() => step.id < currentStep && setCurrentStep(step.id)}
                className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-600 transition-colors ${isActive ? 'bg-primary/10 text-primary' : isCompleted ? 'text-slate-700' : 'text-slate-400'}`}
              >
                {isCompleted ? <CheckCircle2 size={14} /> : <StepIcon size={14} />}
                {step.label}
              </button>
            );
          })}
        </nav>
      </div>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1480px] px-4 py-5 lg:px-6 lg:py-6">
          <div className="mb-5 flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CurrentStepIcon size={19} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-700 text-slate-950">{currentStepLabel}</h1>
                  <span className="rounded-md bg-slate-200/70 px-2 py-0.5 text-xs font-600 text-slate-600">
                    Paso {currentStep} de {STEPS.length}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{currentStepDescription}</p>
              </div>
            </div>
            <div className="w-full sm:w-60">
              <div className="flex items-center justify-between text-xs font-600 text-slate-500">
                <span>Progreso</span>
                <span>{completionPercent}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
            </div>
          </div>
          {currentStep === 1 && (
            <StepSubir
              file={file}
              onFileChange={(nextFile) => {
                setFile(nextFile);
                setPreProcessedFile(null);
              }}
              config={docConfig}
              onConfigChange={setDocConfig}
              viewMode={viewMode}
              onGuardarAvance={handleGuardarAvance}
              savingDraft={savingDraft}
              onSecurityChange={(s) => setSecuritySummary(s)}
              documentoId={documentoId}
              onPdfMetadata={(meta) => setPdfMetadata(meta)}
              sourceSelection={docuboxSource}
              onSourceSelectionChange={setDocuboxSource}
            />
          )}
          {currentStepLabel === 'Participantes' && (
            <StepParticipantes
              participants={participants}
              onChange={setParticipants}
              mode={participantMode}
              onModeChange={setParticipantMode}
              onOrderChange={handleOrderChange}
              participationOrder={participationOrder}
              vencimientoSolicitudEnabled={(securitySummary as any)?.vencimientoSolicitud ?? false}
            />
          )}
          {currentStepLabel === 'Agrupamiento' && (
            <StepAgrupamiento participants={participants} grupos={grupos} onChange={setGrupos} />
          )}
          {currentStepLabel === 'Flujo de Trabajo' && (
            <StepFlujoTrabajo participants={participants} />
          )}
          {currentStepLabel === 'Ajustes' && (
            <StepAjustes
              settings={settings}
              onChange={setSettings}
              participants={participants}
              file={file}
              isCondicional={isCondicional}
              documentoId={documentoId}
              securitySettings={securitySummary}
              onPlacedFieldsChange={setPlacedFields}
              onFixarCamposChange={(fixar, hasFirma) => {
                setAjustesFixarCampos(fixar);
                setAjustesHasFirma(hasFirma);
              }}
              initialFixarCampos={ajustesFixarCampos}
              initialPlacedFields={placedFields}
            />
          )}
          {currentStepLabel === 'Enviar' && (
            <StepEnviar
              ref={stepEnviarRef}
              file={file}
              participants={participants}
              settings={settings}
              docConfig={docConfig}
              onGoToStep={setCurrentStep}
              placedFields={placedFields}
              documentoId={documentoId}
              securitySettings={securitySummary}
              grupos={grupos}
              participationOrder={participationOrder}
              participantMode={participantMode}
              preProcessedFile={preProcessedFile}
              pdfMetadata={pdfMetadata}
              docuboxSource={docuboxSource}
            />
          )}
        </div>
      </main>

      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 lg:px-6">
        <div className="mx-auto flex w-full max-w-[1480px] items-center justify-between gap-3">
          {currentStep === 1 ? (
            <div />
          ) : (
            <button
              onClick={handleBack}
              className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
            >
              <ArrowLeft size={16} />
              Atrás
            </button>
          )}
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {draftSaved && (
              <span className="hidden items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 sm:flex">
                <CheckCircle2 size={12} />
                Borrador guardado
              </span>
            )}
            {currentStep !== 1 && (
              <button
                onClick={handleGuardarAvanceClick}
                disabled={savingDraft}
                className="hidden h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 sm:flex"
              >
                {savingDraft ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save size={15} />
                    Guardar avance
                  </>
                )}
              </button>
            )}
            {isLastStep ? (
              <button
                onClick={handleEnviarDocumento}
                disabled={enviarSending}
                className="flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-700 text-white shadow-[0_8px_18px_-12px_rgba(5,150,105,0.85)] transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enviarSending ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    Enviar documento
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleNext}
                disabled={!canGoNext}
                className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-700 text-white shadow-[0_8px_18px_-12px_rgba(30, 107, 255,0.85)] transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {nextButtonLabel}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function CrearDocumentoPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center">
          <svg
            className="animate-spin h-8 w-8 text-primary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
      }
    >
      <CrearDocumentoPageInner />
    </Suspense>
  );
}
