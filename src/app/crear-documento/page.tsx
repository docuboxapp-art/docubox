'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import { Upload, Users, Settings, Send, X, ArrowRight, CheckCircle2, Save, LayoutGrid } from 'lucide-react';

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
import type { Participant, DocumentSettings, DocumentConfig, ParticipantMode, GrupoFirma, SecuritySettings } from './components/types';

// ─── Helper: derive tipo from field label ─────────────────────────────────────
function getLabelTipo(label: string): string {
  const map: Record<string, string> = {
    'Firma': 'firma',
    'Nombre Completo': 'nombre_completo',
    'RFC': 'rfc',
    'CURP': 'curp',
    'Correo Electrónico': 'correo',
    'Número Telefónico': 'telefono',
    'Dirección': 'direccion',
    'Texto': 'texto',
    'Fecha': 'fecha',
    'Hora': 'hora',
    'Número': 'numero',
    'Moneda': 'moneda',
    'Casilla': 'checkbox',
    'Imagen': 'imagen',
    'Botones de opción': 'radio',
    'Desplegable': 'dropdown',
  };
  return map[label] || 'texto';
}

// ─── Pipeline de seguridad (Capa 1 + Capa 2) — ejecutado en background ───────
const ALLOWED_MIME_TYPES_PAGE = ['application/pdf', 'application/vnd.openxmlformats', 'image/png', 'image/jpeg'];
const MAX_FILE_SIZE_BYTES_PAGE = 50 * 1024 * 1024;

async function validateMimeByMagicBytesPage(file: File): Promise<string | null> {
  const slice = file.slice(0, 8);
  const buffer = await slice.arrayBuffer();
  const b = new Uint8Array(buffer);
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return 'application/vnd.openxmlformats';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  return null;
}

async function sanitizePDFPage(file: File): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const catalog = (pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Root) as any);
  if (catalog) {
    try { catalog.delete('JavaScript'); } catch { /* ignorar */ }
    try { catalog.delete('JS'); } catch { /* ignorar */ }
    try { catalog.delete('OpenAction'); } catch { /* ignorar */ }
    try { catalog.delete('AA'); } catch { /* ignorar */ }
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
  { id: 4, label: 'Flujo de Trabajo', icon: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="6" r="2"/>
      <path d="M6 8v8M8 6h8"/>
    </svg>
  )},
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
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantMode, setParticipantMode] = useState<ParticipantMode>(null);
  const [participationOrder, setParticipationOrder] = useState<string>('');
  const [grupos, setGrupos] = useState<GrupoFirma[]>([]);
  const [settings, setSettings] = useState<DocumentSettings>({
    title: '', message: '', deadline: '', reminderDays: '3', requireAllSignatures: true, allowDecline: false,
  });
  const [docConfig, setDocConfig] = useState<DocumentConfig>({
    nombre: '', descripcion: '', numeroOficio: '', grupotipoId: '', tipoDocumentoId: '', otroTipoDocumento: '', ruta: 'raiz', etiquetasIds: [],
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
  const [pdfMetadata, setPdfMetadata] = useState<{ pageCount: number; title?: string; author?: string; creationDate?: string } | null>(null);

  const isMixto = participationOrder === 'mixto';
  const isCondicional = participationOrder === 'condicional';
  const STEPS = isMixto ? MIXTO_STEPS : isCondicional ? CONDICIONAL_STEPS : BASE_STEPS;

  const currentStepLabel = STEPS.find((s) => s.id === currentStep)?.label ?? '';

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
      if (!file || !docConfig.nombre.trim() || !docConfig.grupotipoId || !docConfig.tipoDocumentoId) return false;
      if (docConfig.tipoDocumentoId === '__otros__' && !docConfig.otroTipoDocumento.trim()) return false;
      return true;
    }
    if (currentStepLabel === 'Participantes') {
      return participantMode !== null && participants.length > 0 && participants.every((p) => p.configured === true) && (participantMode === 'solo_yo' || participationOrder !== '');
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

  const nextButtonLabel = currentStepLabel === 'Ajustes' && !ajustesFixarCampos ? 'Continuar sin fijar campos' : 'Siguiente';

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
                setPreProcessedFile({ bytes: new Uint8Array(), mime: detectedMime, status: 'error_invalido' });
                return;
              }
            } else {
              bytes = new Uint8Array(await file.arrayBuffer());
            }
            setPreProcessedFile({ bytes, mime: detectedMime, status: 'ready' });
            console.log('[DOCUBOX][security] Pipeline pre-ejecutado: MIME =', detectedMime, '| bytes =', bytes.byteLength);
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
      router.push('/sign-up-login-screen');
      return false;
    }
    setSavingDraft(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        router.push('/sign-up-login-screen');
        return false;
      }

      const docId = draftDbId || generateDocumentoId();

      const res = await fetch('/api/documentos/guardar-borrador', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
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
          otroTipoDocumento: docConfig.tipoDocumentoId === '__otros__' ? (docConfig.otroTipoDocumento || null) : null,
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
          legalHoldEnabled: securitySummary?.legalHoldEnabled ?? false,
          impedirImpresion: securitySummary?.impedirImpresion ?? false,
          evitarCopiaTexto: securitySummary?.evitarCopiaTexto ?? false,
          impedirModificacion: securitySummary?.impedirModificacion ?? false,
          impedirExtraccion: securitySummary?.impedirExtraccion ?? false,
          evitarMontaje: securitySummary?.evitarMontaje ?? false,
          recordatorioFrecuencia: securitySummary?.recordatorioFrecuencia || null,
          urgente: securitySummary?.urgente ?? false,
          publico: securitySummary?.publico ?? false,
          selloDigital: securitySummary?.selloDigital ?? false,
          estampaAutenticacion: securitySummary?.estampaAutenticacion ?? false,
          metadatosAdicionales: securitySummary?.metadatosAdicionales ?? false,
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
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-3">Verifica tu correo electrónico</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-6">
            Para crear documentos necesitas verificar tu correo electrónico. Revisa tu bandeja de entrada y haz clic en el enlace de verificación que te enviamos al registrarte.
          </p>
          <button
            onClick={() => router.push('/documents-dashboard')}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
          >
            Volver al dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-screen bg-white flex flex-col">
      {showExitModal && (
        <ExitConfirmModal
          canSave={canSaveDraft}
          onClose={() => setShowExitModal(false)}
          onExitWithoutSave={() => router.push('/mis-documentos')}
          onSaveDraft={handleGuardarAvanceAndExit}
          saving={savingDraft}
        />
      )}

      <header className="h-16 border-b border-gray-100 flex items-center px-6 shrink-0 bg-white">
        <div className="flex-1"><AppLogo size={36} /></div>
        <nav className="flex items-center gap-1 sm:gap-2">
          {STEPS.map((step, idx) => {
            const StepIcon = step.icon;
            const isActive = step.id === currentStep;
            const isCompleted = step.id < currentStep;
            return (
              <React.Fragment key={step.id}>
                <button
                  onClick={() => step.id < currentStep && setCurrentStep(step.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${isActive ? 'border-2 border-primary text-primary bg-white' : isCompleted ? 'text-primary hover:bg-primary/5 cursor-pointer' : 'text-gray-400 cursor-default'}`}
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isActive ? 'bg-primary text-white' : isCompleted ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400'}`}>
                    {isCompleted ? <CheckCircle2 size={14} /> : <StepIcon size={14} />}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
                {idx < STEPS.length - 1 && <div className={`w-8 h-px ${step.id < currentStep ? 'bg-primary' : 'bg-gray-200'}`} />}
              </React.Fragment>
            );
          })}
        </nav>
        <div className="flex-1 flex items-center justify-end gap-1">
          <button title="Preferencias" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          </button>
          <button onClick={handleToggleFullscreen} title={isFullscreen ? 'Restaurar pantalla' : 'Maximizar pantalla'} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
          <button onClick={() => setShowExitModal(true)} title="Salir" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors ml-1 text-sm font-medium">
            <X size={16} /><span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-10">
        <div className="max-w-7xl mx-auto w-full">
          {currentStep === 1 && (
            <StepSubir
              file={file}
              onFileChange={setFile}
              config={docConfig}
              onConfigChange={setDocConfig}
              viewMode={viewMode}
              onGuardarAvance={handleGuardarAvance}
              savingDraft={savingDraft}
              onSecurityChange={(s) => setSecuritySummary(s)}
              documentoId={documentoId}
              onPdfMetadata={(meta) => setPdfMetadata(meta)}
            />
          )}
          {currentStepLabel === 'Participantes' && (
            <StepParticipantes participants={participants} onChange={setParticipants} mode={participantMode} onModeChange={setParticipantMode} onOrderChange={handleOrderChange} participationOrder={participationOrder} vencimientoSolicitudEnabled={(securitySummary as any)?.vencimientoSolicitud ?? false} />
          )}
          {currentStepLabel === 'Agrupamiento' && (
            <StepAgrupamiento participants={participants} grupos={grupos} onChange={setGrupos} />
          )}
          {currentStepLabel === 'Flujo de Trabajo' && (
            <StepFlujoTrabajo participants={participants} />
          )}
          {currentStepLabel === 'Ajustes' && (
            <StepAjustes settings={settings} onChange={setSettings} participants={participants} file={file} isCondicional={isCondicional} documentoId={documentoId} onPlacedFieldsChange={setPlacedFields} onFixarCamposChange={(fixar, hasFirma) => { setAjustesFixarCampos(fixar); setAjustesHasFirma(hasFirma); }} initialFixarCampos={ajustesFixarCampos} initialPlacedFields={placedFields} />
          )}
          {currentStepLabel === 'Enviar' && (
            <StepEnviar ref={stepEnviarRef} file={file} participants={participants} settings={settings} docConfig={docConfig} onGoToStep={setCurrentStep} placedFields={placedFields} documentoId={documentoId} securitySettings={securitySummary} grupos={grupos} participationOrder={participationOrder} participantMode={participantMode} preProcessedFile={preProcessedFile} pdfMetadata={pdfMetadata} />
          )}
        </div>
      </main>

      <footer className="h-16 border-t border-gray-100 flex items-center justify-between px-6 shrink-0 bg-white">
        {currentStep === 1 ? (
          <div />
        ) : (
          <button onClick={handleBack} className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            ← Atrás
          </button>
        )}
        <div className="flex items-center gap-3">
          {draftSaved && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <CheckCircle2 size={12} />Borrador guardado
            </span>
          )}
          {currentStep !== 1 && (
          <button
            onClick={handleGuardarAvanceClick}
            disabled={savingDraft}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            {savingDraft ? (
              <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Guardando...</>
            ) : (
              <><Save size={15} />Guardar avance</>
            )}
          </button>
          )}
          {isLastStep ? (
            <button
              onClick={handleEnviarDocumento}
              disabled={enviarSending}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {enviarSending ? (
                <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Enviando...</>
              ) : (
                <><Send size={15} />Enviar Documento</>
              )}
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={!canGoNext}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm bg-primary hover:bg-primary/90 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {nextButtonLabel}<ArrowRight size={16} />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

export default function CrearDocumentoPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><svg className="animate-spin h-8 w-8 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>}>
      <CrearDocumentoPageInner />
    </Suspense>
  );
}