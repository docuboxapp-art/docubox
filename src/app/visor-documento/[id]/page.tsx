'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Maximize2, Users, MessageSquare, Activity, FileText, RefreshCw, Info, CheckCircle2, XCircle, Clock, Mail, Tag, Send, Eye, FilePlus, UserPlus, Download, Shield, AlertTriangle, PenLine, Bell, Calendar, StickyNote, Edit3, Upload, X, Save, PanelRightClose, PanelRightOpen, Copy, ExternalLink, Globe2, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import AppLayout from '@/components/AppLayout';
import { useSidebar } from '@/contexts/SidebarContext';
import { sendDocumentCompletedToAllSigners } from '@/lib/emailNotifications';
import { createNotification } from '@/lib/notificationsInApp';
import { StepSubir } from '@/app/crear-documento/components/StepSubir';
import { StepParticipantes } from '@/app/crear-documento/components/StepParticipantes';
import { StepAjustes } from '@/app/crear-documento/components/StepAjustes';
import type { Participant, DocumentSettings, DocumentConfig, ParticipantMode, PlacedField, SecuritySettings } from '@/app/crear-documento/components/types';

interface DocumentData {
  id: string;
  nombre: string;
  estado: string;
  owner_id: string;
  file_url?: string;
  file_size?: number;
  formato?: string;
  file_type?: string;
  created_at?: string;
  updated_at?: string;
  vencimiento?: string;
  carpeta_nombre?: string;
  organizacion?: string;
  owner_nombre?: string;
  hash_sha256?: string;
  firma_completa?: string;
  fecha_constancia?: string;
  origen?: string;
  documento_id?: string;
  cancelacion_motivo?: string;
  cancelacion_descripcion?: string;
  cancelado_at?: string;
  fecha_completado?: string;
  workspace_id?: string;
  sealed_pdf_path?: string;
  xml_evidencia_path?: string;
  xml_hash_sha256?: string;
  xml_generated_at?: string;
  es_publico?: boolean;
  metadata?: {
    pdf_page_count?: number | null;
    pdf_is_native?: boolean | null;
    pdf_has_acroform?: boolean | null;
    pdf_has_prior_sigs?: boolean | null;
    pdf_author?: string | null;
    pdf_creator_software?: string | null;
    pdf_created_at?: string | null;
    pdf_modified_at?: string | null;
    pdf_metadata_raw?: Record<string, unknown> | null;
    analyzed_at?: string | null;
  } | null;
}

interface CryptographicCertification {
  certificationUuid: string;
  verificationUuid: string;
  documentId: string;
  documentFolio: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  documentBodySha256: string | null;
  certifiedPdfSha256: string | null;
  certificationRootSha256: string | null;
  timestampStatus: string | null;
  timestampGenTime: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const CRYPTOGRAPHIC_PROVIDER_LABELS: Record<string, string> = {
  DOCUBOX_KMS_GATEWAY_URL: 'Sellado digital KMS',
  DOCUBOX_TSA_GATEWAY_URL: 'Estampa de tiempo RFC 3161',
  DOCUBOX_PADES_GATEWAY_URL: 'Firma del PDF PAdES',
};

async function apiAuthHeaders(includeJson = false): Promise<Record<string, string>> {
  const { data: { session } } = await createClient().auth.getSession();
  const headers: Record<string, string> = {};
  if (includeJson) headers['Content-Type'] = 'application/json';
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

interface Participante {
  id: string;
  nombre: string;
  email: string;
  estado: string;
  metodo_firma: string;
  orden?: number;
  ip_address?: string;
  lugar_firma?: string;
  fecha_firma?: string;
  motivo_rechazo?: string;
  fecha_rechazo?: string;
  sub_estado?: string;
  acto?: string;
  rolDocumento?: string;
  fecha_notificacion?: string;
  fecha_recordatorio?: string;
  fecha_participacion?: string;
}

interface SectionState {
  informacionGeneral: boolean;
  auditoria: boolean;
  seguridad: boolean;
  ubicacion: boolean;
}

interface ChatMessage {
  id: string;
  sender_id: string;
  sender_nombre: string;
  content: string;
  created_at: string;
}

interface ActivityEvent {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
  actor_name: string;
  actor_email: string;
  category?: string;
  source?: 'audit_trail' | 'security_log' | 'synthesized';
  participant_name?: string;
  participant_email?: string;
  doc_state_before?: string;
  doc_state_after?: string;
  participation_state?: string;
}

interface CampoSolicitado {
  label: string;
  participantId: string | null;
  participantName: string | null;
  page: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  colorHex?: string | null;
  dropdownOptions?: string[] | null;
  radioOptions?: string[] | null;
  casillaLabel?: string | null;
  fieldConfig?: {
    customName?: string;
    showLabelInDocument?: boolean;
  } | null;
  fieldTypeConfig?: {
    imageType?: string;
    decimals?: number;
    numberFormat?: string;
    currency?: string;
    currencySymbol?: string;
    dateFormat?: string;
    timeFormat?: string;
    timeWithSeconds?: boolean;
  } | null;
  tipo?: string;
  id?: string;
}

// NEW: participation response data
interface ParticipationResponse {
  participante_email: string;
  participante_nombre: string;
  campos_completados: Array<{ campo_id: string; label: string; value: string }>;
  firma_data: string | null;
  firma_completada: boolean;
}

interface DocumentNote {
  id: string;
  documento_id: string;
  author_id: string;
  author_nombre: string;
  content: string;
  tipo: 'general' | 'rechazo' | 'cancelacion';
  visibilidad: 'privada' | 'publica';
  created_at: string;
}

// Color palette for participant fields
const CAMPO_COLORS: { border: string; bg: string; text: string }[] = [
  { border: 'border-emerald-400', bg: 'bg-emerald-50', text: 'text-emerald-600' },
  { border: 'border-violet-400', bg: 'bg-violet-50', text: 'text-violet-600' },
  { border: 'border-blue-400', bg: 'bg-blue-50', text: 'text-blue-600' },
  { border: 'border-orange-400', bg: 'bg-orange-50', text: 'text-orange-600' },
  { border: 'border-pink-400', bg: 'bg-pink-50', text: 'text-pink-600' },
  { border: 'border-teal-400', bg: 'bg-teal-50', text: 'text-teal-600' },
];

// Avatar colors per participant index
const AVATAR_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-600' },
  { bg: 'bg-purple-100', text: 'text-purple-600' },
  { bg: 'bg-green-100', text: 'text-green-600' },
  { bg: 'bg-orange-100', text: 'text-orange-600' },
  { bg: 'bg-pink-100', text: 'text-pink-600' },
  { bg: 'bg-teal-100', text: 'text-teal-600' },
];

const estadoConfig: Record<string, { label: string; color: string; bg: string }> = {
  en_proceso: { label: 'EN PROGRESO', color: 'text-blue-700', bg: 'bg-blue-100' },
  en_espera: { label: 'EN ESPERA', color: 'text-orange-700', bg: 'bg-orange-100' },
  completado: { label: 'COMPLETADO', color: 'text-green-700', bg: 'bg-green-100' },
  rechazado: { label: 'RECHAZADO', color: 'text-red-700', bg: 'bg-red-100' },
  cancelado: { label: 'CANCELADO', color: 'text-slate-700', bg: 'bg-slate-100' },
};

// ─── PDF.js canvas renderer ──────────────────────────────────────────────────
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

interface PdfCanvasProps {
  fileUrl: string;
  page: number;
  zoom: number;
  onTotalPages: (n: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

function PdfCanvas({ fileUrl, page, zoom, onTotalPages, className, style }: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const pdfDocRef = useRef<any>(null);
  const [error, setError] = useState(false);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    if (window.pdfjsLib) return;
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
    };
    document.head.appendChild(script);
  }, []);

  const renderPage = useCallback(async () => {
    if (!canvasRef.current) return;
    setRendering(true);
    setError(false);

    try {
      let attempts = 0;
      while (!window.pdfjsLib && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }
      if (!window.pdfjsLib) throw new Error('PDF.js not loaded');

      if (!pdfDocRef.current || pdfDocRef.current._url !== fileUrl) {
        const loadingTask = window.pdfjsLib.getDocument({
          url: fileUrl,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
        });
        const pdfDoc = await loadingTask.promise;
        pdfDoc._url = fileUrl;
        pdfDocRef.current = pdfDoc;
        onTotalPages(pdfDoc.numPages);
      }

      const pdfDoc = pdfDocRef.current;
      const pageNum = Math.max(1, Math.min(page, pdfDoc.numPages));
      const pdfPage = await pdfDoc.getPage(pageNum);

      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch (_) {}
        renderTaskRef.current = null;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const scale = zoom / 100;
      const viewport = pdfPage.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      renderTaskRef.current = null;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('[PdfCanvas] render error:', err);
        setError(true);
      }
    } finally {
      setRendering(false);
    }
  }, [fileUrl, page, zoom, onTotalPages]);

  useEffect(() => {
    renderPage();
    return () => {
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch (_) {}
      }
    };
  }, [renderPage]);

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
          <svg className="animate-spin h-6 w-6 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}
      {error ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4 bg-gray-100">
          <FileText size={64} className="text-slate-300" strokeWidth={1} />
          <p className="text-sm text-slate-400">Vista previa no disponible</p>
          <p className="text-xs text-slate-300">No se pudo cargar el archivo PDF</p>
        </div>
      ) : (
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Edit Modal Wrapper ───────────────────────────────────────────────────────
interface EditModalProps {
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  children: React.ReactNode;
}

function EditModal({ title, onClose, onSave, saving, children }: EditModalProps) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex flex-col">
      <div className="bg-white flex flex-col h-full">
        {/* Modal Header */}
        <div className="h-14 border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Guardando...
                </>
              ) : (
                <>
                  <Save size={14} />
                  Guardar cambios
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <X size={14} />
              Cerrar
            </button>
          </div>
        </div>
        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function VisorDocumentoPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { sidebarOpen } = useSidebar();
  const docId = params?.id as string;

  const [document, setDocument] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [docError, setDocError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sections, setSections] = useState<SectionState>({
    informacionGeneral: true,
    auditoria: true,
    seguridad: true,
    ubicacion: true,
  });
  const [activeTab, setActiveTab] = useState<'details' | 'participants' | 'comments' | 'activity' | 'fields' | 'vencimientos' | 'editar' | 'descargas'>('details');
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(true);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showChangesModal, setShowChangesModal] = useState(false);
  const [rejectMotivo, setRejectMotivo] = useState('');
  const [rejectDescripcion, setRejectDescripcion] = useState('');
  const [rejectConfirmStep, setRejectConfirmStep] = useState(false);
  const [changesComment, setChangesComment] = useState('');
  const [changesTipo, setChangesTipo] = useState('Solicitud de Cambios en el Documento');
  const [showCancelDocModal, setShowCancelDocModal] = useState(false);
  const [cancelMotivo, setCancelMotivo] = useState('');
  const [cancelDescripcion, setCancelDescripcion] = useState('');
  const [cancelConfirmStep, setCancelConfirmStep] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  // Track which participant emails are "online" (presence via realtime)
  const [onlineEmails, setOnlineEmails] = useState<Set<string>>(new Set());
  const [participantSubEstado, setParticipantSubEstado] = useState<string | null>(null);

  const [camposSolicitados, setCamposSolicitados] = useState<CampoSolicitado[]>([]);
  const [showCampos, setShowCampos] = useState(true);
  const [showFullscreenModal, setShowFullscreenModal] = useState(false);
  const [isViewerMaximized, setIsViewerMaximized] = useState(false);
  const [showCamposModal, setShowCamposModal] = useState(true);
  const [pageInputValue, setPageInputValue] = useState('1');

  // NEW: participation responses for filled field values
  const [participationResponses, setParticipationResponses] = useState<ParticipationResponse[]>([]);

  const [notes, setNotes] = useState<DocumentNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [noteVisibilidad, setNoteVisibilidad] = useState<'privada' | 'publica'>('publica');
  const [noteSaving, setNoteSaving] = useState(false);
  // Track which participant is currently receiving a reminder email
  const [sendingReminderFor, setSendingReminderFor] = useState<string | null>(null);
  const [reminderSentFor, setReminderSentFor] = useState<Set<string>>(new Set());

  // ── Descargas tab state ────────────────────────────────────────────────────
  const [downloadingOriginal, setDownloadingOriginal] = useState(false);
  const [nom151Data, setNom151Data] = useState<{
    id: string;
    status: string;
    nubarium_codigo_validacion: string;
    nubarium_hash: string;
    constancia_sha256: string;
    constancia_path: string;
    nubarium_request_payload?: Record<string, unknown> | null;
    nubarium_response_payload?: Record<string, unknown> | null;
    created_at: string;
  } | null>(null);
  const [nom151Polling, setNom151Polling] = useState(false);
  const [nom151Generating, setNom151Generating] = useState(false);
  const [downloadingAns, setDownloadingAns] = useState(false);
  const [downloadingNom151Pdf, setDownloadingNom151Pdf] = useState(false);

  // ── Constancia General state ───────────────────────────────────────────────
  const [downloadingConstanciaGeneral, setDownloadingConstanciaGeneral] = useState(false);
  const [cryptographicCertification, setCryptographicCertification] = useState<CryptographicCertification | null>(null);
  const [certificationProviderReady, setCertificationProviderReady] = useState(false);
  const [certificationProviderChecked, setCertificationProviderChecked] = useState(false);
  const [certificationProviderMissing, setCertificationProviderMissing] = useState<string[]>([]);
  const [certificationLoading, setCertificationLoading] = useState(false);
  const [certificationError, setCertificationError] = useState('');
  const [certificationDownload, setCertificationDownload] = useState<'certificate' | 'package' | 'certified-pdf' | null>(null);

  // ── Signed PDF state ───────────────────────────────────────────────────────
  const [downloadingSignedPdf, setDownloadingSignedPdf] = useState(false);
  const [publicVerificationOrigin, setPublicVerificationOrigin] = useState('');
  const [publicVerificationPath, setPublicVerificationPath] = useState('');
  const [publicUrlCopied, setPublicUrlCopied] = useState(false);

  // ── XML Evidence state ─────────────────────────────────────────────────────
  const [xmlEvidenceData, setXmlEvidenceData] = useState<{
    xml_evidencia_path: string;
    xml_hash_sha256: string;
    xml_generated_at: string;
  } | null>(null);
  const [downloadingXml, setDownloadingXml] = useState(false);
  const [xmlPolling, setXmlPolling] = useState(false);
  const [xmlGenerating, setXmlGenerating] = useState(false);

  useEffect(() => {
    setPublicVerificationOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!document?.id || document.estado !== 'completado' || !document.es_publico) {
      setPublicVerificationPath('');
      return;
    }
    const storageKey = `docubox-public-verification:${document.id}`;
    const storedPath = window.localStorage.getItem(storageKey);
    if (storedPath?.startsWith('/v/')) {
      setPublicVerificationPath(storedPath);
      return;
    }
    let active = true;
    const issueLink = async () => {
      const linkSupabase = createClient();
      const { data: { session } } = await linkSupabase.auth.getSession();
      if (!session?.access_token) return;
      const response = await fetch('/api/public/v1/verifications/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ documentId: document.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.path || !active) return;
      window.localStorage.setItem(storageKey, data.path);
      setPublicVerificationPath(data.path);
    };
    issueLink().catch((error) => console.error('No fue posible emitir el enlace publico:', error));
    return () => { active = false; };
  }, [document?.es_publico, document?.estado, document?.id]);

  const publicVerificationUrl = useMemo(() => {
    if (!publicVerificationPath || !publicVerificationOrigin) return '';
    return `${publicVerificationOrigin}${publicVerificationPath}`;
  }, [publicVerificationOrigin, publicVerificationPath]);

  const copyPublicVerificationUrl = useCallback(async () => {
    if (!publicVerificationUrl) return;

    try {
      await navigator.clipboard.writeText(publicVerificationUrl);
      setPublicUrlCopied(true);
      window.setTimeout(() => setPublicUrlCopied(false), 1800);
    } catch (error) {
      console.error('No fue posible copiar el enlace público:', error);
    }
  }, [publicVerificationUrl]);

  useEffect(() => {
    const desktopPanel = window.matchMedia('(min-width: 1280px)');
    const syncPanelWithViewport = (event?: MediaQueryListEvent) => {
      setIsSidePanelOpen(event ? event.matches : desktopPanel.matches);
    };

    syncPanelWithViewport();
    desktopPanel.addEventListener('change', syncPanelWithViewport);
    return () => desktopPanel.removeEventListener('change', syncPanelWithViewport);
  }, []);

  // ── Activity logger helper ─────────────────────────────────────────────────
  const logActivity = useCallback(async (
    action: string,
    category: string,
    details?: Record<string, unknown>
  ) => {
    if (!docId || !user) return;
    try {
      const supabase = createClient();
      const actorNombre =
        user.user_metadata?.full_name ||
        user.user_metadata?.nombre ||
        user.email ||
        'Usuario';
      await supabase.from('document_activity_log').insert({
        documento_id: docId,
        actor_id: user.id,
        actor_nombre: actorNombre,
        actor_email: user.email || '',
        action,
        category,
        details: details || null,
      });
    } catch (err) {
      // Non-blocking: activity logging should never break the main flow
      console.warn('[activity-log] Error logging activity:', err);
    }
  }, [docId, user]);

  const loadCryptographicCertification = useCallback(async () => {
    if (!docId || document?.estado !== 'completado') return;
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const response = await fetch(`/api/documents/${docId}/certifications`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No fue posible consultar la certificación.');
      setCryptographicCertification(payload.certification || null);
      setCertificationProviderReady(Boolean(payload.providerStatus?.ready));
      setCertificationProviderMissing(Array.isArray(payload.providerStatus?.missing) ? payload.providerStatus.missing : []);
      setCertificationProviderChecked(true);
      setCertificationError('');
    } catch (error) {
      setCertificationProviderChecked(true);
      setCertificationError(error instanceof Error ? error.message : 'No fue posible consultar la certificación.');
    }
  }, [docId, document?.estado]);

  useEffect(() => {
    loadCryptographicCertification();
  }, [loadCryptographicCertification]);

  const generateCryptographicCertification = useCallback(async () => {
    if (!docId) return;
    setCertificationLoading(true);
    setCertificationError('');
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('La sesión no está disponible.');
      const response = await fetch(`/api/documents/${docId}/certifications`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Idempotency-Key': crypto.randomUUID(),
        },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No fue posible generar la certificación.');
      setCryptographicCertification(payload.certification || null);
      await logActivity('certificacion_criptografica_generada', 'cumplimiento', {
        certification_uuid: payload.certification?.certificationUuid,
        status: payload.certification?.status,
      });
    } catch (error) {
      setCertificationError(error instanceof Error ? error.message : 'No fue posible generar la certificación.');
      await loadCryptographicCertification();
    } finally {
      setCertificationLoading(false);
    }
  }, [docId, loadCryptographicCertification, logActivity]);

  const downloadCertificationArtifact = useCallback(async (
    kind: 'certificate' | 'package' | 'certified-pdf',
  ) => {
    if (!docId || !cryptographicCertification?.certificationUuid) return;
    setCertificationDownload(kind);
    setCertificationError('');
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('La sesión no está disponible.');
      const response = await fetch(
        `/api/documents/${docId}/certifications/${cryptographicCertification.certificationUuid}/${kind}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'No fue posible descargar el archivo.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const matchedName = disposition.match(/filename="([^"]+)"/i)?.[1];
      const fallbackName = kind === 'certificate'
        ? `constancia_integridad_${document?.documento_id || docId}.pdf`
        : kind === 'package'
          ? `paquete_certificacion_${document?.documento_id || docId}.zip`
          : `documento_certificado_${document?.documento_id || docId}.pdf`;
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = matchedName || fallbackName;
      anchor.style.display = 'none';
      window.document.body.appendChild(anchor);
      anchor.click();
      window.document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      await logActivity('certificacion_criptografica_descargada', 'cumplimiento', { artifact: kind });
    } catch (error) {
      setCertificationError(error instanceof Error ? error.message : 'No fue posible descargar el archivo.');
    } finally {
      setCertificationDownload(null);
    }
  }, [cryptographicCertification?.certificationUuid, docId, document?.documento_id, logActivity]);

  // ── NOM-151 polling (only when completado) ─────────────────────────────────
  useEffect(() => {
    if (!docId || document?.estado !== 'completado') return;
    let cancelled = false;

    const fetchNom151 = async () => {
      try {
        // Use API route that queries nom151_constancias_doc (references documentos.id)
        const res = await fetch(`/api/nom151/constancia?documento_id=${docId}`, {
          headers: await apiAuthHeaders(),
        });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            if (json.data) {
              setNom151Data(json.data ?? null);
              setNom151Polling(false);
            } else {
              // No record found — show "Pendiente" state, not "Generando"
              setNom151Data(null);
              setNom151Polling(false);
            }
          }
        } else if (!cancelled) {
          setNom151Polling(false);
        }
      } catch {
        if (!cancelled) setNom151Polling(false);
      }
    };

    fetchNom151();
    const interval = setInterval(() => {
      if (nom151Generating) fetchNom151();
      else clearInterval(interval);
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [docId, document?.estado, nom151Generating]);

  // ── Download original PDF ──────────────────────────────────────────────────
  const downloadOriginalDocument = useCallback(async () => {
    if (!document?.file_url) return;
    setDownloadingOriginal(true);
    try {
      const supabase = createClient();
      // Extract storage path from file_url
      // file_url is a public URL like: https://<project>.supabase.co/storage/v1/object/public/documents/<path>
      // We need to get a signed URL for private buckets
      const fileUrl = document.file_url;
      let blob: Blob | null = null;

      // Try direct fetch first (works if bucket is public or URL has token)
      try {
        const res = await fetch(fileUrl);
        if (res.ok) {
          blob = await res.blob();
        }
      } catch {
        // ignore, try signed URL below
      }

      if (!blob) {
        // Extract path from URL and use signed URL
        const urlParts = fileUrl.split('/storage/v1/object/');
        if (urlParts.length > 1) {
          const pathPart = urlParts[1].replace(/^public\//, '').replace(/^sign\//, '');
          const bucketAndPath = pathPart.split('/');
          const bucket = bucketAndPath[0];
          const filePath = bucketAndPath.slice(1).join('/');
          const { data: signedData } = await supabase.storage
            .from(bucket)
            .createSignedUrl(filePath, 60);
          if (signedData?.signedUrl) {
            const res = await fetch(signedData.signedUrl);
            if (res.ok) blob = await res.blob();
          }
        }
      }

      if (!blob) throw new Error('No se pudo descargar el archivo');

      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `${document.nombre || 'documento'}.pdf`;
      a.style.display = 'none';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error descargando documento:', err);
    } finally {
      setDownloadingOriginal(false);
    }
  }, [document?.file_url, document?.nombre]);

  // ── Download .ans NOM-151 file ─────────────────────────────────────────────
  const downloadAnsFile = useCallback(async () => {
    if (!nom151Data?.constancia_path) return;
    setDownloadingAns(true);
    try {
      const supabase = createClient();
      // Try nom151-constancias bucket first, then evidence bucket as fallback
      let blob: Blob | null = null;
      const bucketsToTry = ['nom151-constancias', 'evidence'];
      for (const bucket of bucketsToTry) {
        const { data, error } = await supabase.storage
          .from(bucket)
          .download(nom151Data.constancia_path);
        if (!error && data) {
          blob = data;
          break;
        }
        // Try signed URL
        const { data: signedData } = await supabase.storage
          .from(bucket)
          .createSignedUrl(nom151Data.constancia_path, 60);
        if (signedData?.signedUrl) {
          const res = await fetch(signedData.signedUrl);
          if (res.ok) { blob = await res.blob(); break; }
        }
      }
      if (!blob) throw new Error('Archivo .ans no disponible');
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `nom151_${docId?.slice(0, 8) || 'doc'}.ans`;
      a.style.display = 'none';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error descargando .ans:', err);
    } finally {
      setDownloadingAns(false);
    }
  }, [nom151Data?.constancia_path, docId]);

  // ── XML Evidence polling (only when completado) ────────────────────────────
  useEffect(() => {
    if (!docId || document?.estado !== 'completado') return;
    let cancelled = false;

    const fetchXmlEvidence = async () => {
      try {
        // Use API route that queries documentos table (xml columns added via migration)
        const res = await fetch(`/api/nom151/xml-evidence?documento_id=${docId}`, {
          headers: await apiAuthHeaders(),
        });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled && json.data?.xml_evidencia_path) {
            setXmlEvidenceData(json.data as { xml_evidencia_path: string; xml_hash_sha256: string; xml_generated_at: string });
            setXmlPolling(false);
          } else if (!cancelled) {
            // No XML data found — show Pendiente state, not spinner
            setXmlPolling(false);
          }
        } else if (!cancelled) {
          setXmlPolling(false);
        }
      } catch {
        if (!cancelled) setXmlPolling(false);
      }
    };

    // Also check if document already has xml_evidencia_path loaded
    if (document?.xml_evidencia_path) {
      setXmlEvidenceData({
        xml_evidencia_path: document.xml_evidencia_path,
        xml_hash_sha256: document.xml_hash_sha256 || '',
        xml_generated_at: document.xml_generated_at || '',
      });
      setXmlPolling(false);
      return;
    }

    fetchXmlEvidence();
    // Only poll if we're actively waiting (not just showing Pendiente)
    const interval = setInterval(() => {
      if (!xmlEvidenceData && xmlPolling) fetchXmlEvidence();
      else clearInterval(interval);
    }, 8000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [docId, document?.estado, document?.xml_evidencia_path]);

  // ── Download XML evidence file ─────────────────────────────────────────────
  const downloadXmlEvidence = useCallback(async () => {
    if (!xmlEvidenceData?.xml_evidencia_path) return;
    setDownloadingXml(true);
    try {
      const supabase = createClient();
      // Try multiple buckets: evidence (STORAGE_BUCKET_EVIDENCIA), documentos-evidencia
      const bucketsToTry = ['evidence', 'documentos-evidencia'];
      let blob: Blob | null = null;
      for (const bucket of bucketsToTry) {
        const { data, error } = await supabase.storage
          .from(bucket)
          .download(xmlEvidenceData.xml_evidencia_path);
        if (!error && data) {
          blob = data;
          break;
        }
        // Try signed URL
        const { data: signedData } = await supabase.storage
          .from(bucket)
          .createSignedUrl(xmlEvidenceData.xml_evidencia_path, 60);
        if (signedData?.signedUrl) {
          const res = await fetch(signedData.signedUrl);
          if (res.ok) { blob = await res.blob(); break; }
        }
      }
      if (!blob) throw new Error('XML no disponible');
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `evidencia_${docId?.slice(0, 8) || 'doc'}.xml`;
      a.style.display = 'none';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error descargando XML:', err);
    } finally {
      setDownloadingXml(false);
    }
  }, [xmlEvidenceData?.xml_evidencia_path, docId]);

  // ── Download signed PDF (with certification elements, readable in Acrobat) ─
  const downloadSignedPdf = useCallback(async () => {
    if (!docId) return;
    setDownloadingSignedPdf(true);
    try {
      const supabase = createClient();
      let blob: Blob | null = null;
      let errorMsg = '';

      // 1. Try sealed_pdf_path from documentos table
      if (document?.sealed_pdf_path) {
        const bucketsToTry = ['documents-signed', 'documents'];
        for (const bucket of bucketsToTry) {
          try {
            const { data, error } = await supabase.storage
              .from(bucket)
              .download(document.sealed_pdf_path);
            if (!error && data) { blob = data; break; }

            const { data: signedData } = await supabase.storage
              .from(bucket)
              .createSignedUrl(document.sealed_pdf_path, 120);
            if (signedData?.signedUrl) {
              const res = await fetch(signedData.signedUrl);
              if (res.ok) { blob = await res.blob(); break; }
            }
          } catch { /* try next */ }
        }
      }

      // 2. Try workspace-scoped sealed.pdf path in documents-signed bucket
      if (!blob) {
        const workspaceId = document?.workspace_id;
        const paths = workspaceId
          ? [`${workspaceId}/${docId}/sealed.pdf`, `${docId}/sealed.pdf`]
          : [`${docId}/sealed.pdf`];

        for (const bucket of ['documents-signed', 'documents']) {
          for (const path of paths) {
            try {
              const { data, error } = await supabase.storage
                .from(bucket)
                .download(path);
              if (!error && data) { blob = data; break; }
              const { data: signedData } = await supabase.storage
                .from(bucket)
                .createSignedUrl(path, 120);
              if (signedData?.signedUrl) {
                const res = await fetch(signedData.signedUrl);
                if (res.ok) { blob = await res.blob(); break; }
              }
            } catch { /* try next */ }
          }
          if (blob) break;
        }
      }

      // 3. Call seal-pdf edge function to generate the stamped PDF on-demand
      if (!blob) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const accessToken = session?.access_token;
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

          if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL no configurado');

          // Build all participants info for the seal page
          const allParticipants = participantes.map((p) => ({
            nombre: p.nombre,
            email: p.email,
            metodo_firma: p.metodo_firma,
            estado: p.estado,
            fecha_firma: p.fecha_firma || p.fecha_participacion,
            rolDocumento: p.rolDocumento || p.acto,
          }));

          const firstSigner = participantes.find(
            (p) => p.sub_estado === 'firmo' || p.sub_estado === 'firmado' || p.estado === 'firmado'
          ) || participantes[0];
          const signerName = firstSigner?.nombre || document?.owner_nombre || 'Firmante';
          const signerEmail = firstSigner?.email || user?.email || '';

          const sealRes = await fetch(`${supabaseUrl}/functions/v1/seal-pdf`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
              'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
            },
            body: JSON.stringify({
              document_id: docId,
              signer_name: signerName,
              signer_email: signerEmail,
              reason: 'Firma electrónica completada',
              location: 'México',
              workspace_id: document?.workspace_id || undefined,
              file_url: document?.file_url || undefined,
              participants: allParticipants,
              campos_solicitados: camposSolicitados,
            }),
          });

          if (!sealRes.ok) {
            // Try to get error details
            const errText = await sealRes.text().catch(() => `HTTP ${sealRes.status}`);
            errorMsg = `Error del servidor: ${sealRes.status} — ${errText.slice(0, 200)}`;
            console.error('[seal-pdf] Edge function error:', sealRes.status, errText);
          } else {
            // Validate the response is actually a PDF (not a JSON error with status 200)
            const contentType = sealRes.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              // Edge function returned JSON — likely an error
              const errJson = await sealRes.json().catch(() => ({}));
              errorMsg = `Error generando PDF: ${(errJson as any).error || 'Respuesta inesperada del servidor'}`;
              console.error('[seal-pdf] Edge function returned JSON instead of PDF:', errJson);
            } else {
              const arrayBuffer = await sealRes.arrayBuffer();
              // Validate it starts with %PDF
              const header = new Uint8Array(arrayBuffer.slice(0, 4));
              const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF
              if (!isPdf) {
                errorMsg = 'El archivo recibido no es un PDF válido. Intenta de nuevo.';
                console.error('[seal-pdf] Response is not a valid PDF, first bytes:', Array.from(header));
              } else {
                // Valid PDF — force download as octet-stream to prevent browser from opening it
                blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
              }
            }
          }
        } catch (sealErr) {
          errorMsg = `Error de conexión: ${(sealErr as Error).message}`;
          console.error('[seal-pdf] Error calling edge function:', sealErr);
        }
      }

      // 4. Fallback: download original PDF via signed URL
      if (!blob && document?.file_url) {
        console.warn('[seal-pdf] Falling back to original PDF download');
        try {
          const res = await fetch(document.file_url);
          if (res.ok) blob = await res.blob();
        } catch { /* ignore */ }

        if (!blob) {
          const urlParts = document.file_url.split('/storage/v1/object/');
          if (urlParts.length > 1) {
            const pathPart = urlParts[1].replace(/^public\//, '').replace(/^sign\//, '');
            const bucketAndPath = pathPart.split('/');
            const bucket = bucketAndPath[0];
            const filePath = bucketAndPath.slice(1).join('/');
            const { data: signedData } = await supabase.storage
              .from(bucket)
              .createSignedUrl(filePath, 120);
            if (signedData?.signedUrl) {
              const res = await fetch(signedData.signedUrl);
              if (res.ok) blob = await res.blob();
            }
          }
        }
      }

      if (!blob) {
        const msg = errorMsg || 'No se pudo generar el documento PAdES. Verifica que el documento esté completado y vuelve a intentarlo.';
        alert(msg);
        return;
      }

      // Ensure we force download (not open in browser) by using octet-stream
      const downloadBlob = blob.type === 'application/pdf'
        ? new Blob([await blob.arrayBuffer()], { type: 'application/octet-stream' })
        : blob;

      // Sanitize filename: remove characters that cause issues in some browsers
      const safeName = (document?.nombre || 'documento')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 100);

      const url = URL.createObjectURL(downloadBlob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `${safeName}_firmado_PAdES.pdf`;
      a.style.display = 'none';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Error descargando PDF firmado:', err);
      alert(`Error al descargar el documento PAdES: ${(err as Error).message}`);
    } finally {
      setDownloadingSignedPdf(false);
    }
  }, [docId, document?.workspace_id, document?.file_url, document?.nombre, document?.sealed_pdf_path, document?.owner_nombre, participantes, user?.email, camposSolicitados]);

  // ── Generate XML Evidence ─────────────────────────────────────────────────
  const generateXmlEvidence = useCallback(async () => {
    if (!docId || xmlGenerating) return;
    setXmlGenerating(true);
    try {
      const res = await fetch('/api/nom151/generate-xml', {
        method: 'POST',
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ documento_id: docId, requested_by: user?.id }),
      });
      const json = await res.json();
      if (res.ok) {
        // Refresh XML evidence data immediately after generation
        const xmlPath = json.xml_evidencia_path || (json.already_generated ? json.xml_evidencia_path : null);
        if (json.xml_evidencia_path || json.already_generated) {
          setXmlEvidenceData({
            xml_evidencia_path: json.xml_evidencia_path,
            xml_hash_sha256: json.xml_hash_sha256 || '',
            xml_generated_at: json.xml_generated_at || new Date().toISOString(),
          });
        } else {
          // Fallback: re-fetch from API
          const refreshRes = await fetch(`/api/nom151/xml-evidence?documento_id=${docId}`, {
            headers: await apiAuthHeaders(),
          });
          if (refreshRes.ok) {
            const refreshJson = await refreshRes.json();
            if (refreshJson.data?.xml_evidencia_path) {
              setXmlEvidenceData(refreshJson.data);
            }
          }
        }
      } else {
        console.error('[generateXmlEvidence] Error:', json.error);
        alert(`Error generando XML: ${json.error || 'Error desconocido'}`);
      }
    } catch (err) {
      console.error('[generateXmlEvidence] Error:', err);
      alert('Error generando XML de evidencia. Intenta de nuevo.');
    } finally {
      setXmlGenerating(false);
    }
  }, [docId, xmlGenerating, user?.id]);

  // ── Generate NOM-151 constancia via Nubarium ───────────────────────────────
  const generateNom151 = useCallback(async () => {
    if (!docId || nom151Generating) return;
    setNom151Generating(true);
    try {
      const res = await fetch('/api/nom151/generate', {
        method: 'POST',
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ documento_id: docId, requested_by: user?.id }),
      });
      const json = await res.json();
      if (res.ok && (json.status === 'issued' || json.already_issued)) {
        // Refresh NOM-151 data
        const constanciaRes = await fetch(`/api/nom151/constancia?documento_id=${docId}`, {
          headers: await apiAuthHeaders(),
        });
        if (constanciaRes.ok) {
          const constanciaJson = await constanciaRes.json();
          setNom151Data(constanciaJson.data ?? null);
          setNom151Polling(false);
        }
      } else {
        const errMsg = json.error || 'Error desconocido';
        console.error('[nom151] Error generando:', errMsg);
        alert(`Error generando NOM-151: ${errMsg}`);
      }
    } catch (err) {
      console.error('[nom151] Error:', err);
      alert('Error generando constancia NOM-151. Intenta de nuevo.');
    } finally {
      setNom151Generating(false);
    }
  }, [docId, nom151Generating, user?.id]);

  // ── Download NOM-151 info PDF (request/response data) ─────────────────────
  const downloadNom151InfoPdf = useCallback(async () => {
    if (!nom151Data) return;
    setDownloadingNom151Pdf(true);
    try {
      const reqPayload = nom151Data.nubarium_request_payload as Record<string, unknown> | null;
      const respPayload = nom151Data.nubarium_response_payload as Record<string, unknown> | null;

      const firmantes: Array<Record<string, unknown>> = (reqPayload?.firmantes as Array<Record<string, unknown>>) || [];
      const fechaEmisionRaw = new Date(nom151Data.created_at);
      const fechaEmision = fechaEmisionRaw.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

      const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Constancia NOM-151 — ${document?.nombre || docId}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Arial', sans-serif; font-size: 10px; color: #1a1a2e; background: #fff; padding: 0; }
  .page { max-width: 800px; margin: 0 auto; padding: 32px 36px; }
  .header { background: linear-gradient(135deg, #0a1628 0%, #1a2d4a 100%); color: white; padding: 20px 24px; border-radius: 8px 8px 0 0; margin-bottom: 0; }
  .header-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .header h1 { font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
  .header-subtitle { font-size: 9px; color: #b0c4de; margin-top: 2px; }
  .header-badge { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); border-radius: 4px; padding: 4px 10px; font-size: 9px; font-weight: 700; letter-spacing: 1px; color: #e0eaff; }
  .summary-bar { display: grid; grid-template-columns: 1fr 1fr 1fr; background: #f0f4ff; border: 1px solid #c8d8f0; border-top: none; }
  .summary-cell { padding: 10px 14px; border-right: 1px solid #c8d8f0; }
  .summary-cell:last-child { border-right: none; }
  .summary-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #5a6a8a; margin-bottom: 3px; }
  .summary-value { font-size: 11px; font-weight: 700; color: #1a2d4a; font-family: monospace; }
  .section { margin-top: 16px; border: 1px solid #dde4f0; border-radius: 6px; overflow: hidden; }
  .section-header { background: #f5f7fc; padding: 8px 14px; border-bottom: 1px solid #dde4f0; display: flex; align-items: center; gap: 8px; }
  .section-icon { font-size: 13px; }
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #2a3a5a; }
  .section-body { padding: 0; }
  .row { display: flex; align-items: flex-start; border-bottom: 1px solid #f0f2f8; }
  .row:last-child { border-bottom: none; }
  .label { width: 200px; min-width: 200px; padding: 7px 14px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #5a6a8a; background: #fafbfe; border-right: 1px solid #f0f2f8; }
  .value { flex: 1; padding: 7px 14px; font-size: 10px; color: #1a2d4a; word-break: break-all; }
  .mono { font-family: 'Courier New', monospace; font-size: 9px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 8px; font-weight: 700; letter-spacing: 0.5px; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .firmante-row { padding: 8px 14px; border-bottom: 1px solid #f0f2f8; }
  .firmante-row:last-child { border-bottom: none; }
  .firmante-name { font-size: 10px; font-weight: 700; color: #1a2d4a; margin-bottom: 3px; }
  .firmante-detail { font-size: 9px; color: #5a6a8a; }
  .legal-box { margin-top: 16px; background: #f0f4ff; border: 1px solid #c8d8f0; border-radius: 6px; padding: 12px 16px; }
  .legal-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #2a3a5a; margin-bottom: 6px; }
  .legal-text { font-size: 9px; color: #3a4a6a; line-height: 1.5; }
  .footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #dde4f0; display: flex; justify-content: space-between; align-items: center; }
  .footer-brand { font-size: 9px; font-weight: 700; color: #2a3a5a; }
  .footer-ts { font-size: 8px; color: #8a9ab8; font-family: monospace; }
  .verify-box { margin-top: 12px; background: #fdf4ff; border: 1px solid #e9d5ff; border-radius: 6px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
  .verify-icon { font-size: 18px; }
  .verify-text { font-size: 9px; color: #5b21b6; }
  .verify-url { font-size: 9px; font-weight: 700; color: #7c3aed; font-family: monospace; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 16px 20px; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-top">
      <div>
        <h1>DOCUBOX — Constancia NOM-151-SCFI-2016</h1>
        <div class="header-subtitle">Proveedor de Servicios de Certificación: Nubarium · Secretaría de Economía · México</div>
      </div>
      <div class="header-badge">NOM-151</div>
    </div>
  </div>
  <div class="summary-bar">
    <div class="summary-cell">
      <div class="summary-label">Código de Validación</div>
      <div class="summary-value">${nom151Data.nubarium_codigo_validacion}</div>
    </div>
    <div class="summary-cell">
      <div class="summary-label">Fecha de Emisión</div>
      <div class="summary-value">${fechaEmision}</div>
    </div>
    <div class="summary-cell">
      <div class="summary-label">Estatus</div>
      <div class="summary-value"><span class="badge badge-green">${respPayload?.estatus || 'OK'}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-header"><span class="section-icon">📄</span><span class="section-title">Información del Documento</span></div>
    <div class="section-body">
      <div class="row"><div class="label">Nombre del Documento</div><div class="value">${document?.nombre || '—'}</div></div>
      <div class="row"><div class="label">ID del Documento</div><div class="value mono">${docId}</div></div>
      <div class="row"><div class="label">Estado</div><div class="value"><span class="badge badge-green">COMPLETADO</span></div></div>
      <div class="row"><div class="label">Hash SHA-256 del PDF</div><div class="value mono">${reqPayload?.pdf_sha256 || '—'}</div></div>
      <div class="row"><div class="label">Tamaño del PDF</div><div class="value">${reqPayload?.pdf_size_bytes ? Number(reqPayload.pdf_size_bytes).toLocaleString() + ' bytes' : '—'}</div></div>
      <div class="row"><div class="label">Fecha de Emisión Constancia</div><div class="value">${fechaEmision}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-header"><span class="section-icon">📤</span><span class="section-title">Datos Enviados a Nubarium (Request)</span></div>
    <div class="section-body">
      <div class="row"><div class="label">Endpoint</div><div class="value mono">POST https://firma.nubarium.com/nom151/v1/obtener-nom151</div></div>
      <div class="row"><div class="label">Número de Firmantes</div><div class="value">${firmantes.length}</div></div>
      ${firmantes.map((f, i) => `
      <div class="firmante-row">
        <div class="firmante-name">Firmante ${i + 1}: ${f.nombreCompleto || '—'}</div>
        <div class="firmante-detail">Correo: ${f.correoElectronico || '—'} · Firma imagen: ${f.tieneFirmaImagen ? 'Sí (Autógrafa Digital)' : 'No (e.Firma SAT)'}</div>
      </div>`).join('')}
    </div>
  </div>

  <div class="section">
    <div class="section-header"><span class="section-icon">📥</span><span class="section-title">Respuesta Recibida de Nubarium (Response)</span></div>
    <div class="section-body">
      <div class="row"><div class="label">Código de Validación</div><div class="value mono">${nom151Data.nubarium_codigo_validacion}</div></div>
      <div class="row"><div class="label">Hash Nubarium</div><div class="value mono">${nom151Data.nubarium_hash}</div></div>
      <div class="row"><div class="label">Estatus</div><div class="value"><span class="badge badge-green">${respPayload?.estatus || 'OK'}</span></div></div>
      <div class="row"><div class="label">Clave Mensaje</div><div class="value">${respPayload?.claveMensaje ?? 0} (0 = éxito)</div></div>
      <div class="row"><div class="label">Hash SHA-256 Constancia .ans</div><div class="value mono">${nom151Data.constancia_sha256}</div></div>
      <div class="row"><div class="label">URL de Verificación</div><div class="value mono">https://validatuconstancia.pscworld.com/</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-header"><span class="section-icon">🔐</span><span class="section-title">Integridad Criptográfica</span></div>
    <div class="section-body">
      <div class="row"><div class="label">Norma Aplicable</div><div class="value">NOM-151-SCFI-2016</div></div>
      <div class="row"><div class="label">PSC Acreditado</div><div class="value">Nubarium — Secretaría de Economía</div></div>
      <div class="row"><div class="label">Algoritmo Hash</div><div class="value">SHA-256</div></div>
      <div class="row"><div class="label">Tipo de Constancia</div><div class="value">Conservación de Mensajes de Datos (.ans)</div></div>
    </div>
  </div>

  <div class="verify-box">
    <div class="verify-icon">🔍</div>
    <div>
      <div class="verify-text">Verifica la validez de esta constancia en el portal del PSC:</div>
      <div class="verify-url">https://validatuconstancia.pscworld.com/</div>
    </div>
  </div>

  <div class="legal-box">
    <div class="legal-title">Fundamento Legal</div>
    <div class="legal-text">Esta constancia acredita la conservación del mensaje de datos conforme a la NOM-151-SCFI-2016 emitida por la Secretaría de Economía. El archivo .ans contiene el sello de tiempo y la firma del PSC acreditado (Nubarium), garantizando la integridad e inalterabilidad del documento electrónico. Válido conforme a los Arts. 89-97 del Código de Comercio de México y la Ley de Firma Electrónica Avanzada (LFEA).</div>
  </div>

  <div class="footer">
    <div class="footer-brand">DOCUBOX · https://docubox.mx</div>
    <div class="footer-ts">Generado: ${new Date().toISOString()}</div>
  </div>
  <div class="no-print" style="margin-top:24px;text-align:center;">
    <button onClick="window.print()" style="padding:10px 28px;background:#0a1628;color:white;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;">Imprimir / Guardar como PDF</button>
  </div>
</div>
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

      // Direct download as HTML file (no preview window)
      let blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `constancia_nom151_${docId?.slice(0, 8) || 'doc'}.html`;
      a.style.display = 'none';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generando PDF NOM-151:', err);
    } finally {
      setDownloadingNom151Pdf(false);
    }
  }, [nom151Data, document?.nombre, docId]);

  // ── Download Constancia General de Firma Electrónica ──────────────────────
  const downloadConstanciaGeneral = useCallback(async () => {
    if (!document || document.estado !== 'completado') return;
    setDownloadingConstanciaGeneral(true);
    try {
      const folioId = `DOCUBOX-GEN-${new Date().getFullYear()}-${docId?.slice(0, 8).toUpperCase() || '00000000'}`;
      const fechaCompletado = document.fecha_completado
        ? new Date(document.fecha_completado).toISOString()
        : new Date(document.updated_at || '').toISOString();
      const fechaCreado = document.created_at
        ? new Date(document.created_at).toISOString()
        : '—';
      const hashFinal = document.hash_sha256 || '—';
      const totalParticipantes = participantes.length;
      const generadoEn = new Date().toISOString();
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://docubox.mx';
      const verificarUrl = `${siteUrl}/verificar?folio=${folioId}&doc=${docId}`;

      const maskEmail = (email: string) => {
        if (!email || !email.includes('@')) return email;
        const [local, domain] = email.split('@');
        return `${local.slice(0, 2)}****@${domain}`;
      };

      const estadoParticipante = (p: Participante) => {
        if (p.estado === 'firmado' || p.sub_estado === 'firmo') return '✓ Firmado';
        if (p.estado === 'aprobado') return '✓ Aprobado';
        if (p.estado === 'rechazado') return '✗ Rechazado';
        return p.estado || '—';
      };

      const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Constancia General de Firma Electrónica — ${document.nombre}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Arial', sans-serif; font-size: 10px; color: #1a1a2e; background: #fff; }
  .page { max-width: 820px; margin: 0 auto; padding: 32px 36px; }
  .header { text-align: center; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 2px solid #1a2d4a; }
  .header-logo { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #5a6a8a; text-transform: uppercase; margin-bottom: 6px; }
  .header h1 { font-size: 17px; font-weight: 800; color: #0a1628; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px; }
  .header-sub { font-size: 9px; color: #5a6a8a; }
  .summary-bar { display: grid; grid-template-columns: 1fr 1fr 1fr; border: 1px solid #c8d8f0; border-radius: 6px; overflow: hidden; margin-bottom: 16px; background: #f0f4ff; }
  .summary-cell { padding: 10px 14px; border-right: 1px solid #c8d8f0; }
  .summary-cell:last-child { border-right: none; }
  .summary-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #5a6a8a; margin-bottom: 3px; }
  .summary-value { font-size: 11px; font-weight: 700; color: #1a2d4a; font-family: monospace; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: #0a1628; padding: 6px 0; border-bottom: 1.5px solid #1a2d4a; margin-bottom: 0; }
  .kv-table { width: 100%; border-collapse: collapse; }
  .kv-table td { padding: 5px 8px; border-bottom: 1px solid #f0f2f8; font-size: 9.5px; vertical-align: top; }
  .kv-table td:first-child { width: 180px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #5a6a8a; background: #fafbfe; border-right: 1px solid #f0f2f8; }
  .kv-table td:last-child { color: #1a2d4a; word-break: break-all; font-family: monospace; font-size: 9px; }
  .participants-table { width: 100%; border-collapse: collapse; font-size: 9px; }
  .participants-table thead tr { background: #0a1628; color: white; }
  .participants-table thead th { padding: 6px 8px; text-align: left; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .participants-table tbody tr { border-bottom: 1px solid #f0f2f8; }
  .participants-table tbody tr:nth-child(even) { background: #fafbfe; }
  .participants-table tbody td { padding: 5px 8px; color: #1a2d4a; vertical-align: top; }
  .participants-table tbody td.mono { font-family: monospace; font-size: 8px; }
  .status-ok { color: #065f46; font-weight: 700; }
  .status-bad { color: #991b1b; font-weight: 700; }
  .disclaimer { font-size: 8.5px; color: #5a6a8a; font-style: italic; margin-top: 6px; line-height: 1.5; padding: 6px 8px; background: #fafbfe; border-left: 3px solid #c8d8f0; }
  .qr-section { margin: 14px 0; padding: 12px 14px; background: #f5f7fc; border: 1px solid #dde4f0; border-radius: 6px; }
  .qr-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #2a3a5a; margin-bottom: 4px; }
  .qr-url { font-size: 9px; font-family: monospace; color: #1a2d4a; word-break: break-all; }
  .legal-section { margin-top: 14px; }
  .legal-item { margin-bottom: 6px; font-size: 9px; line-height: 1.5; color: #3a4a6a; }
  .legal-item strong { color: #0a1628; }
  .footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid #dde4f0; display: flex; justify-content: space-between; align-items: center; }
  .footer-brand { font-size: 9px; font-weight: 700; color: #2a3a5a; }
  .footer-ts { font-size: 8px; color: #8a9ab8; font-family: monospace; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 16px 20px; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-logo">DOCUBOX</div>
    <h1>Constancia General de Firma Electrónica</h1>
    <div class="header-sub">Documento compartido entre todas las partes del proceso de firma</div>
  </div>

  <div class="summary-bar">
    <div class="summary-cell">
      <div class="summary-label">Folio</div>
      <div class="summary-value">${folioId}</div>
    </div>
    <div class="summary-cell">
      <div class="summary-label">Completado (UTC)</div>
      <div class="summary-value">${fechaCompletado}</div>
    </div>
    <div class="summary-cell">
      <div class="summary-label">Participantes</div>
      <div class="summary-value">${totalParticipantes}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Datos del Documento</div>
    <table class="kv-table">
      <tr><td>Identificador</td><td>${docId}</td></tr>
      <tr><td>Título</td><td style="font-family:Arial;font-size:10px;">${document.nombre}</td></tr>
      <tr><td>Workspace</td><td style="font-family:Arial;font-size:10px;">${document.organizacion || document.workspace_id || '—'}</td></tr>
      <tr><td>Páginas</td><td style="font-family:Arial;font-size:10px;">${document.metadata?.pdf_page_count ?? '—'}</td></tr>
      <tr><td>SHA-256</td><td>${hashFinal}</td></tr>
      <tr><td>Creado</td><td>${fechaCreado}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Participantes y Estado de Firma</div>
    <table class="participants-table">
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Correo</th>
          <th>Rol</th>
          <th>Método</th>
          <th>Firmado (UTC)</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        ${participantes.map(p => `
        <tr>
          <td>${p.nombre || '—'}</td>
          <td class="mono">${maskEmail(p.email || '')}</td>
          <td>${p.rolDocumento || p.acto || '—'}</td>
          <td>${p.metodo_firma || '—'}</td>
          <td class="mono">${p.fecha_firma ? new Date(p.fecha_firma).toISOString() : (p.fecha_participacion ? new Date(p.fecha_participacion).toISOString() : '—')}</td>
          <td class="${(p.estado === 'firmado' || p.sub_estado === 'firmo' || p.estado === 'aprobado') ? 'status-ok' : 'status-bad'}">${estadoParticipante(p)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="disclaimer">El correo electrónico se muestra parcialmente enmascarado para proteger los datos personales de cada participante conforme a la LFPDPPP.</div>
  </div>

  <div class="section">
    <div class="section-title">Integridad del Expediente</div>
    <table class="kv-table">
      <tr><td>Hash Final del Expediente</td><td>${hashFinal}</td></tr>
      <tr><td>Algoritmo</td><td style="font-family:Arial;font-size:10px;">SHA-256 encadenado</td></tr>
      <tr><td>Completado</td><td>${fechaCompletado}</td></tr>
      <tr><td>URL de Verificación</td><td>${verificarUrl}</td></tr>
    </table>
  </div>

  <div class="qr-section">
    <div class="qr-title">Verifica la autenticidad de este documento</div>
    <div class="qr-url">${verificarUrl}</div>
  </div>

  <div class="legal-section">
    <div class="section-title">Fundamento Legal</div>
    <div style="margin-top:8px;">
      <div class="legal-item"><strong>Validez jurídica:</strong> Esta constancia acredita que el proceso de firma electrónica fue completado por todos los participantes listados, conforme a los Arts. 89-97 del Código de Comercio de México, LFEA y NOM-151-SCFI-2016.</div>
      <div class="legal-item"><strong>Privacidad:</strong> Los datos personales detallados de cada participante están protegidos por la LFPDPPP.</div>
      <div class="legal-item"><strong>Generado por:</strong> DOCUBOX · https://docubox.mx</div>
    </div>
  </div>

  <div class="footer">
    <div class="footer-brand">DOCUBOX · https://docubox.mx</div>
    <div class="footer-ts">Generado automáticamente al completarse todas las firmas · ${generadoEn}</div>
  </div>
  <div class="no-print" style="margin-top:24px;text-align:center;">
    <button onClick="window.print()" style="padding:10px 28px;background:#0a1628;color:white;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;">Imprimir / Guardar como PDF</button>
  </div>
</div>
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

      // Direct download as HTML file (no preview window)
      let blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `constancia_general_${docId?.slice(0, 8) || 'doc'}.html`;
      a.style.display = 'none';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generando Constancia General:', err);
    } finally {
      setDownloadingConstanciaGeneral(false);
    }
  }, [document, docId, participantes]);

  // ── Load document + participants + activity ────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!docId || !user) {
      setLoading(false);
      return;
    }
    const supabase = createClient();

    const loadDocument = async () => {
      setLoading(true);
      setDocError(null);
      try {
        let data: any = null;

        // First try direct Supabase query (works for owners and when RLS policies are applied)
        const { data: directData, error } = await supabase
          .from('documentos')
          .select('id, documento_id, nombre, estado, owner_id, file_url, file_size, file_type, file_hash_sha256, es_publico, created_at, updated_at, fecha_vencimiento, carpeta_id, campos_solicitados, workspace_id, cancelacion_motivo, cancelacion_descripcion, cancelado_at, fecha_completado, participantes, sealed_pdf_path, xml_evidencia_path, xml_hash_sha256, xml_generated_at')
          .eq('id', docId)
          .single();

        if (error || !directData) {
          // Fallback: use API route with service role to verify access server-side
          console.log('[visor-documento] Direct query failed, trying API fallback. Error:', error?.code, error?.message);
          try {
            // Get the current session token to send as Authorization header
            const { data: { session } } = await supabase.auth.getSession();
            const accessToken = session?.access_token;
            const apiRes = await fetch(`/api/documentos/obtener?id=${docId}`, {
              headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {},
            });
            if (apiRes.ok) {
              const apiJson = await apiRes.json();
              data = apiJson.data;
            } else if (apiRes.status === 403) {
              setDocError('sin_acceso');
              return;
            } else if (apiRes.status === 404) {
              setDocError('no_encontrado');
              return;
            } else {
              const apiJson = await apiRes.json().catch(() => ({}));
              setDocError(apiJson.error || 'error_desconocido');
              return;
            }
          } catch (apiFetchErr: any) {
            console.error('[visor-documento] API fallback error:', apiFetchErr);
            // If both fail, show appropriate error
            if (error?.code === 'PGRST116') {
              setDocError('no_encontrado');
            } else {
              setDocError(error?.message || 'error_desconocido');
            }
            return;
          }
        } else {
          data = directData;
        }

        if (!data) {
          setDocError('no_encontrado');
          return;
        }

        if (data.campos_solicitados && Array.isArray(data.campos_solicitados) && data.campos_solicitados.length > 0) {
          setCamposSolicitados(data.campos_solicitados as CampoSolicitado[]);
        }

        let ownerNombre = 'Usuario';
        if (data.owner_id) {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('full_name, nombre, apellido_paterno, apellido_materno')
            .eq('id', data.owner_id)
            .single();
          if (profile) {
            ownerNombre = profile.full_name ||
              [profile.nombre, profile.apellido_paterno, profile.apellido_materno].filter(Boolean).join(' ') ||
              'Usuario';
          }
        }

        let carpetaNombre = 'Documentos Generales';
        if (data.carpeta_id) {
          const { data: carpeta } = await supabase
            .from('carpetas')
            .select('nombre')
            .eq('id', data.carpeta_id)
            .single();
          if (carpeta) carpetaNombre = carpeta.nombre;
        }

        let organizacion = 'Mi Organización';
        const { data: ws } = await supabase
          .from('workspaces')
          .select('name')
          .eq('owner_id', data.owner_id)
          .eq('workspace_type', 'personal')
          .single();
        if (ws) organizacion = ws.name;

        let docMetadata = null;
        const { data: metaData } = await supabase
          .from('document_metadata')
          .select('pdf_page_count, pdf_is_native, pdf_has_acroform, pdf_has_prior_sigs, pdf_author, pdf_creator_software, pdf_created_at, pdf_modified_at, pdf_metadata_raw, analyzed_at')
          .eq('documentos_id', docId)
          .maybeSingle();
        if (metaData) docMetadata = metaData;

        setDocument({
          ...data,
          vencimiento: data.fecha_vencimiento || undefined,
          owner_nombre: ownerNombre,
          carpeta_nombre: carpetaNombre,
          organizacion,
          formato: data.file_type || 'application/pdf',
          hash_sha256: data.file_hash_sha256 || '—',
          firma_completa: 'Pendiente',
          fecha_constancia: 'Pendiente',
          origen: data.origen || 'Plataforma Web',
          documento_id: data.documento_id || undefined,
          cancelacion_motivo: data.cancelacion_motivo || undefined,
          cancelacion_descripcion: data.cancelacion_descripcion || undefined,
          cancelado_at: data.cancelado_at || undefined,
          fecha_completado: data.fecha_completado || undefined,
          sealed_pdf_path: data.sealed_pdf_path || undefined,
          xml_evidencia_path: data.xml_evidencia_path || undefined,
          xml_hash_sha256: data.xml_hash_sha256 || undefined,
          xml_generated_at: data.xml_generated_at || undefined,
          es_publico: data.es_publico ?? false,
          metadata: docMetadata,
        });

        const rawParts: any[] = data.participantes || [];

        if (rawParts.length > 0) {
          const mapped = rawParts.map((p: any, idx: number) => ({
            id: p.id || String(idx),
            nombre: p.nombre || p.name || '',
            email: p.email || '',
            estado: p.estado || 'pendiente',
            metodo_firma: p.metodo_firma || (p.tipoFirma && p.tipoFirma[0] ? (() => {
              const firmaLabelMap: Record<string, string> = {
                autografa: 'Firma Autógrafa Digital',
                efirma: 'e-Firma SAT',
                biometria: 'Biometría (Premium)',
              };
              return firmaLabelMap[p.tipoFirma[0]] || p.tipoFirma[0];
            })() : 'Firma Autógrafa Digital'),
            orden: p.orden ?? idx + 1,
            sub_estado: p.sub_estado || 'en_revision',
            ip_address: p.ip_address || undefined,
            lugar_firma: p.lugar_firma || undefined,
            fecha_firma: p.fecha_firma || undefined,
            motivo_rechazo: p.motivo_rechazo || undefined,
            fecha_rechazo: p.fecha_rechazo || undefined,
            acto: p.acto || undefined,
            rolDocumento: p.rolDocumento || p.rol_documento || undefined,
            fecha_notificacion: p.fecha_notificacion || undefined,
            fecha_recordatorio: p.fecha_recordatorio || undefined,
            fecha_participacion: p.fecha_participacion || p.fecha_firma || undefined,
          }));
          setParticipantes(mapped);

          if (user?.email) {
            const myPart = mapped.find((p: any) => p.email === user.email);
            if (myPart) {
              setParticipantSubEstado(myPart.sub_estado || 'en_revision');
              // Only update to 'en_revision' if participant has legacy 'sin_revisar' state
              // (new documents already start participants at 'en_revision')
              const terminalStates = ['firmo', 'firmado', 'rechazo', 'rechazado', 'aprobo', 'aprobado', 'cancelo', 'cancelado'];
              const currentSub = myPart.sub_estado || 'en_revision';
              if (currentSub === 'sin_revisar' && !terminalStates.includes(currentSub)) {
                try {
                  await supabase.rpc('update_participante_sub_estado', {
                    p_documento_id: docId,
                    p_email: user.email,
                    p_sub_estado: 'en_revision',
                  });
                  setParticipantSubEstado('en_revision');
                } catch (err) {
                  console.error('[visor-documento] Error updating sub_estado:', err);
                }
              }
            }
          }
        } else if (ownerNombre !== 'Usuario') {
          setParticipantes([{
            id: data.owner_id,
            nombre: ownerNombre,
            email: '',
            estado: 'pendiente',
            metodo_firma: 'Firma Autógrafa Digital',
            orden: 1,
          }]);
        }
      } catch (err: any) {
        console.error('[visor-documento] Error loading document:', err);
        setDocError(err?.message || 'error_desconocido');
      } finally {
        setLoading(false);
      }
    };

    const loadActivity = async () => {
      setActivityLoading(true);
      try {
        const allEvents: ActivityEvent[] = [];

        // ── 1. security_audit_log (own events + doc events) ──────────────────
        const { data: secData } = await supabase
          .from('security_audit_log')
          .select(`
            id,
            action,
            details,
            created_at,
            user_id
          `)
          .eq('documento_id', docId)
          .order('created_at', { ascending: false });

        if (secData) {
          secData.forEach((row: any) => {
            allEvents.push({
              id: `sec_${row.id}`,
              action: row.action,
              details: row.details,
              created_at: row.created_at,
              actor_name: 'Sistema',
              actor_email: '',
              source: 'security_log',
              category: row.details?.category as string | undefined,
            });
          });
        }

        // ── 2. document_audit_trail (legal audit) ────────────────────────────
        const { data: auditData } = await supabase
          .from('document_audit_trail')
          .select('id, action_code, action_description_es, action_category, action_result, actor_name, actor_email, actor_role, document_status_at_action, ip_address, action_at, metadata_encrypted')
          .eq('document_id', docId)
          .order('action_at', { ascending: false });

        if (auditData) {
          auditData.forEach((row: any) => {
            // Avoid duplicates with security_audit_log by checking action+time proximity
            const isDuplicate = allEvents.some(
              (e) =>
                e.action === row.action_code &&
                Math.abs(new Date(e.created_at).getTime() - new Date(row.action_at).getTime()) < 5000
            );
            if (!isDuplicate) {
              allEvents.push({
                id: `adt_${row.id}`,
                action: row.action_code,
                details: {
                  description: row.action_description_es,
                  result: row.action_result,
                  ip_address: row.ip_address,
                  actor_role: row.actor_role,
                  doc_status: row.document_status_at_action,
                },
                created_at: row.action_at,
                actor_name: row.actor_name || 'Sistema',
                actor_email: row.actor_email || '',
                source: 'audit_trail',
                category: row.action_category,
                doc_state_after: row.document_status_at_action,
              });
            }
          });
        }

        // ── 3. Synthesize events from document data ──────────────────────────
        // Re-fetch document to get creation and state info
        // Use maybeSingle to avoid error when RLS blocks direct access for participants
        let docData: any = null;
        const { data: directDocData } = await supabase
          .from('documentos')
          .select('id, nombre, estado, created_at, updated_at, owner_id, cancelado_at, fecha_completado, participantes, owner_nombre')
          .eq('id', docId)
          .maybeSingle();

        if (directDocData) {
          docData = directDocData;
        } else {
          // Fallback: use API route for participants who can't query documentos directly via RLS
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const accessToken = session?.access_token;
            const apiRes = await fetch(`/api/documentos/obtener?id=${docId}`, {
              headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {},
            });
            if (apiRes.ok) {
              const apiJson = await apiRes.json();
              docData = apiJson.data;
            }
          } catch {
            // ignore fallback error, synthesized events will be skipped
          }
        }

        if (docData) {
          // Document creation event
          const creationExists = allEvents.some(
            (e) => e.action === 'documento_creado' || e.action === 'documento_creado'
          );
          if (!creationExists && docData.created_at) {
            // Get owner name
            let ownerName = 'Propietario';
            if (docData.owner_id) {
              const { data: ownerProfile } = await supabase
                .from('user_profiles')
                .select('full_name, nombre, apellido_paterno')
                .eq('id', docData.owner_id)
                .maybeSingle();
              if (ownerProfile) {
                ownerName = ownerProfile.full_name ||
                  [ownerProfile.nombre, ownerProfile.apellido_paterno].filter(Boolean).join(' ') ||
                  'Propietario';
              }
            }
            allEvents.push({
              id: `synth_created_${docId}`,
              action: 'documento_creado',
              details: { nombre: docData.nombre },
              created_at: docData.created_at,
              actor_name: ownerName,
              actor_email: '',
              source: 'synthesized',
              category: 'ciclo_de_vida',
            });
          }

          // Document completed event
          if (docData.fecha_completado && docData.estado === 'completado') {
            const completedExists = allEvents.some((e) => e.action === 'documento_completado');
            if (!completedExists) {
              allEvents.push({
                id: `synth_completed_${docId}`,
                action: 'documento_completado',
                details: { fecha: docData.fecha_completado },
                created_at: docData.fecha_completado,
                actor_name: 'Sistema',
                actor_email: '',
                source: 'synthesized',
                category: 'ciclo_de_vida',
              });
            }
          }

          // Document cancelled event
          if (docData.cancelado_at && docData.estado === 'cancelado') {
            const cancelledExists = allEvents.some((e) => e.action === 'documento_cancelado');
            if (!cancelledExists) {
              allEvents.push({
                id: `synth_cancelled_${docId}`,
                action: 'documento_cancelado',
                details: {},
                created_at: docData.cancelado_at,
                actor_name: 'Sistema',
                actor_email: '',
                source: 'synthesized',
                category: 'ciclo_de_vida',
              });
            }
          }

          // Synthesize participant state events from participantes JSONB
          const rawParts: any[] = docData.participantes || [];
          rawParts.forEach((p: any, idx: number) => {
            const pName = p.nombre || p.name || `Participante ${idx + 1}`;
            const pEmail = p.email || '';

            // Participant assigned (always synthesize)
            allEvents.push({
              id: `synth_part_assigned_${idx}_${docId}`,
              action: 'participante_asignado',
              details: { participant_email: pEmail, metodo_firma: p.metodo_firma },
              created_at: docData.created_at,
              actor_name: 'Sistema',
              actor_email: '',
              source: 'synthesized',
              category: 'participantes',
              participant_name: pName,
              participant_email: pEmail,
            });

            // Participant viewed (en_revision or beyond)
            if (p.sub_estado && p.sub_estado !== 'sin_revisar') {
              // Check if there's already a view event for this participant
              const viewExists = allEvents.some(
                (e) =>
                  (e.action === 'documento_visto' || e.action === 'documento_abierto') &&
                  (e.actor_email === pEmail || e.participant_email === pEmail)
              );
              if (!viewExists && pEmail) {
                allEvents.push({
                  id: `synth_viewed_${idx}_${docId}`,
                  action: 'documento_visto',
                  details: { participant_email: pEmail },
                  created_at: docData.updated_at || docData.created_at,
                  actor_name: pName,
                  actor_email: pEmail,
                  source: 'synthesized',
                  category: 'acceso',
                  participant_name: pName,
                  participant_email: pEmail,
                });
              }
            }

            // Terminal participation states
            if (p.sub_estado === 'firmo' && p.fecha_firma) {
              allEvents.push({
                id: `synth_firmo_${idx}_${docId}`,
                action: 'firma_completada',
                details: {
                  participant_email: pEmail,
                  firma_tipo: p.metodo_firma,
                  ip_address: p.ip_address,
                  lugar: p.lugar_firma,
                },
                created_at: p.fecha_firma,
                actor_name: pName,
                actor_email: pEmail,
                source: 'synthesized',
                category: 'firma',
                participant_name: pName,
                participant_email: pEmail,
                participation_state: 'firmo',
              });
            }

            if (p.sub_estado === 'rechazo' && p.fecha_rechazo) {
              allEvents.push({
                id: `synth_rechazo_${idx}_${docId}`,
                action: 'firma_rechazada',
                details: {
                  participant_email: pEmail,
                  reason: p.motivo_rechazo,
                },
                created_at: p.fecha_rechazo,
                actor_name: pName,
                actor_email: pEmail,
                source: 'synthesized',
                category: 'firma',
                participant_name: pName,
                participant_email: pEmail,
                participation_state: 'rechazo',
              });
            }

            if (p.sub_estado === 'aprobo') {
              allEvents.push({
                id: `synth_aprobo_${idx}_${docId}`,
                action: 'aprobacion_otorgada',
                details: { participant_email: pEmail },
                created_at: p.fecha_firma || docData.updated_at || docData.created_at,
                actor_name: pName,
                actor_email: pEmail,
                source: 'synthesized',
                category: 'aprobacion',
                participant_name: pName,
                participant_email: pEmail,
                participation_state: 'aprobo',
              });
            }

            if (p.sub_estado === 'cancelo') {
              allEvents.push({
                id: `synth_cancelo_${idx}_${docId}`,
                action: 'documento_cancelado',
                details: { participant_email: pEmail },
                created_at: docData.cancelado_at || docData.updated_at || docData.created_at,
                actor_name: pName,
                actor_email: pEmail,
                source: 'synthesized',
                category: 'ciclo_de_vida',
                participant_name: pName,
                participant_email: pEmail,
                participation_state: 'cancelo',
              });
            }

            // Participation state change: en_revision
            if (p.sub_estado === 'en_revision' && pEmail) {
              allEvents.push({
                id: `synth_en_revision_${idx}_${docId}`,
                action: 'cambio_estado_participacion',
                details: { participant_email: pEmail, estado_nuevo: 'En revisión' },
                created_at: docData.updated_at || docData.created_at,
                actor_name: pName,
                actor_email: pEmail,
                source: 'synthesized',
                category: 'participantes',
                participant_name: pName,
                participant_email: pEmail,
                participation_state: 'en_revision',
              });
            }
          });
        }

        // ── 4. document_activity_log (user interactions) ─────────────────────
        const { data: actLogData } = await supabase
          .from('document_activity_log')
          .select('id, action, category, details, created_at, actor_id, actor_nombre, actor_email')
          .eq('documento_id', docId)
          .order('created_at', { ascending: false });

        if (actLogData) {
          actLogData.forEach((row: any) => {
            allEvents.push({
              id: `alog_${row.id}`,
              action: row.action,
              details: row.details,
              created_at: row.created_at,
              actor_name: row.actor_nombre || 'Usuario',
              actor_email: row.actor_email || '',
              source: 'security_log',
              category: row.category,
            });
          });
        }

        // ── 5. Deduplicate and sort ──────────────────────────────────────────
        const seen = new Set<string>();
        const unique = allEvents.filter((e) => {
          // Deduplicate synthesized participant_assigned if audit_trail already has it
          const key = `${e.action}_${e.actor_email}_${new Date(e.created_at).toISOString().slice(0, 16)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        unique.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        setActivityEvents(unique);
      } catch (err) {
        console.error('Error loading activity:', err);
      } finally {
        setActivityLoading(false);
      }
    };

    // Load participation responses via API (service role bypasses RLS so all responses are visible)
    const loadParticipationResponses = async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        const apiRes = await fetch(`/api/documentos/participation-responses?id=${docId}`, {
          headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {},
        });
        if (apiRes.ok) {
          const apiJson = await apiRes.json();
          if (apiJson.data && apiJson.data.length > 0) {
            setParticipationResponses(apiJson.data as ParticipationResponse[]);
          }
        } else {
          // Fallback: direct Supabase query (works for owner or own response)
          const { data, error } = await supabase
            .from('participation_responses')
            .select('participante_email, participante_nombre, campos_completados, firma_data, firma_completada')
            .eq('documento_id', docId);
          if (!error && data && data.length > 0) {
            setParticipationResponses(data as ParticipationResponse[]);
          }
        }
      } catch (err) {
        console.warn('[visor-documento] Could not load participation responses:', err);
      }
    };

    loadDocument();
    loadActivity();
    loadParticipationResponses();
    // Log document view after a short delay to ensure user is authenticated
    const viewTimer = setTimeout(() => {
      if (user && docId) {
        const supabase = createClient();
        const actorNombre =
          user.user_metadata?.full_name ||
          user.user_metadata?.nombre ||
          user.email ||
          'Usuario';
        supabase.from('document_activity_log').insert({
          documento_id: docId,
          actor_id: user.id,
          actor_nombre: actorNombre,
          actor_email: user.email || '',
          action: 'documento_visto',
          category: 'acceso',
          details: { source: 'visor' },
        }).then(() => {}).catch(() => {});
      }
    }, 1500);
    return () => clearTimeout(viewTimer);
  }, [docId, user, authLoading]);

  // ── Load chat messages ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!docId || !user) return;
    const supabase = createClient();

    const loadMessages = async () => {
      setChatLoading(true);
      try {
        const { data, error } = await supabase
          .from('document_chat_messages')
          .select('id, sender_id, sender_nombre, content, created_at')
          .eq('documento_id', docId)
          .order('created_at', { ascending: true });
        if (!error && data) {
          setChatMessages(data as ChatMessage[]);
        }
      } catch (err) {
        console.error('[chat] Error loading messages:', err);
      } finally {
        setChatLoading(false);
      }
    };

    loadMessages();

    // Realtime subscription for new messages
    const channel = supabase
      .channel(`chat:${docId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'document_chat_messages',
          filter: `documento_id=eq.${docId}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setChatMessages((prev) => {
            // Avoid duplicates (optimistic insert)
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [docId, user]);

  // ── Load notes ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!docId || !user) return;
    const supabase = createClient();

    const loadNotes = async () => {
      setNotesLoading(true);
      try {
        const { data, error } = await supabase
          .from('document_notes')
          .select('id, documento_id, author_id, author_nombre, content, tipo, visibilidad, created_at')
          .eq('documento_id', docId)
          .order('created_at', { ascending: false });
        if (!error && data) {
          setNotes(data as DocumentNote[]);
        }
      } catch (err) {
        console.error('[notes] Error loading notes:', err);
      } finally {
        setNotesLoading(false);
      }
    };

    loadNotes();

    // Realtime subscription for new notes
    const channel = supabase
      .channel(`notes:${docId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'document_notes',
          filter: `documento_id=eq.${docId}`,
        },
        () => {
          loadNotes();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [docId, user]);

  // ── Presence tracking ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!docId || !user) return;
    const supabase = createClient();

    const presenceChannel = supabase.channel(`presence:${docId}`, {
      config: { presence: { key: user.id } },
    });

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const emails = new Set<string>();
        Object.values(state).forEach((presences: any) => {
          presences.forEach((p: any) => {
            if (p.email) emails.add(p.email);
          });
        });
        setOnlineEmails(emails);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            user_id: user.id,
            email: user.email || '',
          });
        }
      });

    return () => {
      supabase.removeChannel(presenceChannel);
    };
  }, [docId, user]);

  // Scroll to bottom when messages load
  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [chatMessages.length]);

  const handleTotalPages = useCallback((n: number) => {
    setTotalPages(n);
  }, []);

  const toggleSection = (section: keyof SectionState) => {
    setSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const ZOOM_STEP = 25;
  const ZOOM_MIN = 50;
  const ZOOM_MAX = 300;

  const handleZoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX));
  const handleZoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN));
  const handlePrevPage = () => {
    const newPage = Math.max(currentPage - 1, 1);
    setCurrentPage(newPage);
    setPageInputValue(String(newPage));
  };
  const handleNextPage = () => {
    const newPage = Math.min(currentPage + 1, totalPages);
    setCurrentPage(newPage);
    setPageInputValue(String(newPage));
  };
  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInputValue(e.target.value);
  };
  const handlePageInputBlur = () => {
    const parsed = parseInt(pageInputValue, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= totalPages) {
      setCurrentPage(parsed);
    } else {
      setPageInputValue(String(currentPage));
    }
  };
  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const parsed = parseInt(pageInputValue, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= totalPages) {
        setCurrentPage(parsed);
      } else {
        setPageInputValue(String(currentPage));
      }
      (e.target as HTMLInputElement).blur();
    }
  };

  // ── Send reminder email to a participant ───────────────────────────────────
  const handleSendReminder = async (p: Participante) => {
    if (!p.email || !document) return;
    setSendingReminderFor(p.id);
    try {
      const res = await fetch('/api/documentos/send-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantEmail: p.email,
          participantName: p.nombre,
          documentName: document.nombre,
          documentId: document.id,
        }),
      });
      if (res.ok) {
        setReminderSentFor((prev) => new Set(prev).add(p.id));
        // Log reminder activity
        logActivity('recordatorio_enviado', 'notificacion', {
          participant_email: p.email,
          participant_name: p.nombre,
        });
        // Update local participant state with new fecha_recordatorio
        const now = new Date().toISOString();
        setParticipantes((prev) =>
          prev.map((part) =>
            part.id === p.id ? { ...part, fecha_recordatorio: now } : part
          )
        );
        // Clear "sent" indicator after 3 seconds
        setTimeout(() => {
          setReminderSentFor((prev) => {
            const next = new Set(prev);
            next.delete(p.id);
            return next;
          });
        }, 3000);
      } else if (res.status === 429) {
        // Already sent today — update local state so button disables immediately
        const body = await res.json().catch(() => ({}));
        console.warn('[visor-documento] Recordatorio ya enviado hoy:', body.error);
        // Ensure fecha_recordatorio reflects today so the button stays disabled
        setParticipantes((prev) =>
          prev.map((part) =>
            part.id === p.id && !part.fecha_recordatorio
              ? { ...part, fecha_recordatorio: new Date().toISOString() }
              : part
          )
        );
      }
    } catch (err) {
      console.error('[visor-documento] Error al enviar recordatorio:', err);
    } finally {
      setSendingReminderFor(null);
    }
  };

  const handleAccept = async () => {
    if (!document) return;
    setActionLoading(true);
    try {
      const supabase = createClient();

      // Step 1: Update THIS participant's sub_estado to 'firmo' only
      if (user?.email) {
        await supabase.rpc('update_participante_sub_estado', {
          p_documento_id: document.id,
          p_email: user.email,
          p_sub_estado: 'firmo',
        });
        setParticipantSubEstado('firmo');
      }

      logActivity('firma_completada', 'firma', { metodo: 'participacion' });

      // Step 2: Re-fetch updated participantes to check if ALL have completed
      const { data: updatedDoc } = await supabase
        .from('documentos')
        .select('participantes, estado')
        .eq('id', document.id)
        .single();

      const TERMINAL_SUB_ESTADOS = ['firmo', 'firmado', 'aprobo', 'aprobado', 'rechazo', 'rechazado', 'cancelo', 'cancelado'];
      const updatedParticipantes: any[] = updatedDoc?.participantes ?? [];
      const allCompleted =
        updatedParticipantes.length > 0 &&
        updatedParticipantes.every((p: any) => {
          const sub = (p.sub_estado ?? '').toLowerCase();
          return TERMINAL_SUB_ESTADOS.includes(sub);
        });

      const documentName = document.nombre || 'Documento';
      const signerName = user?.user_metadata?.full_name || user?.email || 'Un participante';

      if (allCompleted) {
        // All participants have completed — close the document
        const completedAt = new Date().toISOString();
        await supabase
          .from('documentos')
          .update({ estado: 'completado', fecha_completado: completedAt })
          .eq('id', document.id);
        setDocument((prev) => prev ? { ...prev, estado: 'completado', fecha_completado: completedAt } : prev);
        logActivity('documento_completado', 'firma', { estado_nuevo: 'completado', total_participantes: updatedParticipantes.length });

        // ── Auto-generate XML evidence and NOM-151 constancia ──────────────
        // Fire-and-forget: both run in background, UI will reflect via polling
        let generatedXmlPath: string | undefined;
        let generatedNom151Path: string | undefined;
        let generatedPadesPath: string | undefined;

        // Collect sealed_pdf_path if already exists
        if (document.sealed_pdf_path) {
          generatedPadesPath = document.sealed_pdf_path;
        }

        const xmlGenPromise = (async () => {
          try {
            setXmlGenerating(true);
            const xmlRes = await fetch('/api/nom151/generate-xml', {
              method: 'POST',
              headers: await apiAuthHeaders(true),
              body: JSON.stringify({ documento_id: document.id, requested_by: user?.id }),
            });
            const xmlJson = await xmlRes.json();
            if (xmlRes.ok && (xmlJson.xml_evidencia_path || xmlJson.already_generated)) {
              generatedXmlPath = xmlJson.xml_evidencia_path;
              setXmlEvidenceData({
                xml_evidencia_path: xmlJson.xml_evidencia_path,
                xml_hash_sha256: xmlJson.xml_hash_sha256 || '',
                xml_generated_at: xmlJson.xml_generated_at || completedAt,
              });
            }
          } catch (xmlErr) {
            console.error('[auto-generate] XML evidence error:', xmlErr);
          } finally {
            setXmlGenerating(false);
          }
        })();

        const nom151GenPromise = (async () => {
          try {
            setNom151Generating(true);
            const nom151Res = await fetch('/api/nom151/generate', {
              method: 'POST',
              headers: await apiAuthHeaders(true),
              body: JSON.stringify({ documento_id: document.id, requested_by: user?.id }),
            });
            const nom151Json = await nom151Res.json();
            if (nom151Res.ok && (nom151Json.status === 'issued' || nom151Json.already_issued)) {
              const constanciaRes = await fetch(`/api/nom151/constancia?documento_id=${document.id}`, {
                headers: await apiAuthHeaders(),
              });
              if (constanciaRes.ok) {
                const constanciaJson = await constanciaRes.json();
                setNom151Data(constanciaJson.data ?? null);
                generatedNom151Path = constanciaJson.data?.constancia_path;
              }
            } else {
              console.error('[auto-generate] NOM-151 error:', nom151Json.error);
            }
          } catch (nom151Err) {
            console.error('[auto-generate] NOM-151 error:', nom151Err);
          } finally {
            setNom151Generating(false);
          }
        })();

        // Wait for both generation tasks, then send enriched completion emails
        Promise.allSettled([xmlGenPromise, nom151GenPromise]).then(async () => {
          try {
            // Fetch owner profile for email
            let ownerEmail: string | undefined;
            let ownerName: string | undefined;
            if (document.owner_id) {
              const { data: ownerProfile } = await supabase
                .from('user_profiles')
                .select('full_name, email')
                .eq('id', document.owner_id)
                .maybeSingle();
              ownerEmail = ownerProfile?.email || undefined;
              ownerName = ownerProfile?.full_name || undefined;
            }

            await sendDocumentCompletedToAllSigners({
              ownerEmail,
              ownerName,
              participants: participantes,
              documentName,
              documentId: document.id,
              completedAt,
              xmlEvidenciaPath: generatedXmlPath,
              nom151ConstanciaPath: generatedNom151Path,
              padesPath: generatedPadesPath,
            });
          } catch (emailErr) {
            console.error('[visor-documento] Error sending completion emails:', emailErr);
          }
        });
        // ──────────────────────────────────────────────────────────────────

        try {
          if (document.owner_id && user?.id !== document.owner_id) {
            await createNotification({
              userId: document.owner_id,
              type: 'document',
              title: 'Participante firmó el documento',
              description: `${signerName} ha participado en "${documentName}".`,
              priority: 'media',
              metadata: { documentoId: document.id, documentName, signerEmail: user?.email },
            });
          }
          if (user?.id) {
            await createNotification({
              userId: user.id,
              type: 'task',
              title: 'Participación registrada',
              description: `Tu participación en "${documentName}" fue registrada exitosamente.`,
              priority: 'baja',
              metadata: { documentoId: document.id, documentName },
            });
          }
          if (document.owner_id) {
            await createNotification({
              userId: document.owner_id,
              type: 'document',
              title: 'Documento completado',
              description: `El documento "${documentName}" ha sido completado por todos los participantes.`,
              priority: 'alta',
              metadata: { documentoId: document.id, documentName },
            });
          }
        } catch {
          // Non-blocking
        }

      } else {
        // Not all completed yet — just notify owner that this participant signed
        try {
          if (document.owner_id && user?.id !== document.owner_id) {
            await createNotification({
              userId: document.owner_id,
              type: 'document',
              title: 'Participante firmó el documento',
              description: `${signerName} ha participado en "${documentName}".`,
              priority: 'media',
              metadata: { documentoId: document.id, documentName, signerEmail: user?.email },
            });
          }
          if (user?.id) {
            await createNotification({
              userId: user.id,
              type: 'task',
              title: 'Participación registrada',
              description: `Tu participación en "${documentName}" fue registrada exitosamente.`,
              priority: 'baja',
              metadata: { documentoId: document.id, documentName },
            });
          }
        } catch {
          // Non-blocking
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!document || !rejectMotivo.trim()) return;
    setActionLoading(true);
    try {
      const noteContent = rejectDescripcion.trim()
        ? `${rejectMotivo}: ${rejectDescripcion}`
        : rejectMotivo;

      // Use server-side API to bypass RLS (participants can't UPDATE documentos directly)
      const res = await fetch('/api/documentos/update-estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rechazar',
          documentoId: document.id,
          motivo: rejectMotivo,
          descripcion: rejectDescripcion.trim() || undefined,
          userEmail: user?.email,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? 'Error al rechazar el documento');
      }

      const result = await res.json();

      setDocument((prev) => prev ? { ...prev, estado: 'rechazado' } : prev);
      logActivity('firma_rechazada', 'firma', { motivo: rejectMotivo, descripcion: rejectDescripcion || undefined, estado_nuevo: 'rechazado' });

      // Update local participant state from API response
      if (result.participantes) {
        setParticipantes((prev) =>
          prev.map((p) => {
            const updated = result.participantes.find(
              (rp: any) => (rp.email ?? '').toLowerCase() === (p.email ?? '').toLowerCase()
            );
            if (updated) return { ...p, sub_estado: updated.sub_estado };
            return p;
          })
        );
      } else {
        setParticipantes((prev) =>
          prev.map((p) => {
            if (p.email === user?.email) return { ...p, sub_estado: 'rechazo' };
            if (p.email) return { ...p, sub_estado: 'cancelo' };
            return p;
          })
        );
      }
      setParticipantSubEstado('rechazo');

      // Save rejection note as public
      try {
        const supabase = createClient();
        const authorNombre =
          user?.user_metadata?.full_name ||
          user?.user_metadata?.nombre ||
          user?.email ||
          'Usuario';
        const { data: insertedNote } = await supabase.from('document_notes').insert({
          documento_id: document.id,
          author_id: user?.id,
          author_nombre: authorNombre,
          content: noteContent,
          tipo: 'rechazo',
          visibilidad: 'publica',
        }).select('id, documento_id, author_id, author_nombre, content, tipo, visibilidad, created_at').single();
        if (insertedNote) {
          setNotes((prev) => [insertedNote as DocumentNote, ...prev]);
        }
      } catch {
        // Non-blocking
      }

      try {
        const documentName = document.nombre || 'Documento';
        const rejectorName = user?.user_metadata?.full_name || user?.email || 'Un participante';
        if (document.owner_id && user?.id !== document.owner_id) {
          await createNotification({
            userId: document.owner_id,
            type: 'alert',
            title: 'Documento rechazado',
            description: `${rejectorName} rechazó el documento "${documentName}". Motivo: ${rejectMotivo}`,
            priority: 'alta',
            metadata: { documentoId: document.id, documentName, reason: rejectMotivo },
          });
        }
        if (user?.id) {
          await createNotification({
            userId: user.id,
            type: 'alert',
            title: 'Rechazaste un documento',
            description: `Rechazaste el documento "${documentName}".`,
            priority: 'media',
            metadata: { documentoId: document.id, documentName },
          });
        }
      } catch {
        // Non-blocking
      }

      setShowRejectModal(false);
      setRejectMotivo('');
      setRejectDescripcion('');
      setRejectConfirmStep(false);
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!document || !changesComment.trim()) return;
    setActionLoading(true);
    try {
      // Use server-side API to bypass RLS
      const res = await fetch('/api/documentos/update-estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'en_espera', documentoId: document.id }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? 'Error al actualizar el estado');
      }
      setDocument((prev) => prev ? { ...prev, estado: 'en_espera' } : prev);
      logActivity('documento_editado', 'ciclo_de_vida', { tipo: changesTipo, comentario: changesComment.trim(), estado_nuevo: 'en_espera' });

      // Save note about the request
      try {
        const supabaseNote = createClient();
        const authorNombre =
          user?.user_metadata?.full_name ||
          user?.user_metadata?.nombre ||
          user?.email ||
          'Usuario';
        const noteText = `[${changesTipo}] ${changesComment.trim()}`;
        const { data: insertedNote } = await supabaseNote.from('document_notes').insert({
          documento_id: document.id,
          author_id: user?.id,
          author_nombre: authorNombre,
          content: noteText,
          tipo: 'general',
          visibilidad: 'publica',
        }).select('id, documento_id, author_id, author_nombre, content, tipo, visibilidad, created_at').single();
        if (insertedNote) {
          setNotes((prev) => [insertedNote as DocumentNote, ...prev]);
        }
      } catch {
        // Non-blocking
      }

      try {
        const documentName = document.nombre || 'Documento';
        const requesterName = user?.user_metadata?.full_name || user?.email || 'Un participante';
        if (document.owner_id && user?.id !== document.owner_id) {
          await createNotification({
            userId: document.owner_id,
            type: 'alert',
            title: 'Solicitud de cambios',
            description: `${requesterName} solicitó cambios en "${documentName}": ${changesComment.trim()}`,
            priority: 'alta',
            metadata: { documentoId: document.id, documentName },
          });
        }
      } catch {
        // Non-blocking
      }

      setShowChangesModal(false);
      setChangesComment('');
      setChangesTipo('Solicitud de Cambios en el Documento');
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelDocument = async () => {
    if (!document || !cancelMotivo.trim()) return;
    setActionLoading(true);
    try {
      // Use server-side API to bypass RLS (service role updates both document and participants)
      const res = await fetch('/api/documentos/update-estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancelar',
          documentoId: document.id,
          motivo: cancelMotivo,
          descripcion: cancelDescripcion.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? 'Error al cancelar el documento');
      }
      const result = await res.json();
      const now = result.cancelado_at ?? new Date().toISOString();

      setDocument((prev) => prev ? {
        ...prev,
        estado: 'cancelado',
        cancelacion_motivo: cancelMotivo,
        cancelacion_descripcion: cancelDescripcion.trim() || undefined,
        cancelado_at: now,
      } : prev);
      logActivity('documento_cancelado', 'ciclo_de_vida', { motivo: cancelMotivo, descripcion: cancelDescripcion.trim() || undefined, estado_nuevo: 'cancelado' });

      // Update local participant state from API response
      if (result.participantes) {
        setParticipantes((prev) =>
          prev.map((p) => {
            const updated = result.participantes.find(
              (rp: any) => (rp.email ?? '').toLowerCase() === (p.email ?? '').toLowerCase()
            );
            if (updated) return { ...p, sub_estado: updated.sub_estado };
            return p;
          })
        );
      } else {
        setParticipantes((prev) => prev.map((p) => ({ ...p, sub_estado: 'cancelo' })));
      }

      // Save cancellation note as public
      try {
        const authorNombre =
          user?.user_metadata?.full_name ||
          user?.user_metadata?.nombre ||
          user?.email ||
          'Usuario';
        const noteContent = cancelDescripcion.trim()
          ? `${cancelMotivo}: ${cancelDescripcion}`
          : cancelMotivo;
        const supabaseNote = createClient();
        const { data: insertedNote } = await supabaseNote.from('document_notes').insert({
          documento_id: document.id,
          author_id: user?.id,
          author_nombre: authorNombre,
          content: noteContent,
          tipo: 'cancelacion',
          visibilidad: 'publica',
        }).select('id, documento_id, author_id, author_nombre, content, tipo, visibilidad, created_at').single();
        if (insertedNote) {
          setNotes((prev) => [insertedNote as DocumentNote, ...prev]);
        }
      } catch {
        // Non-blocking
      }

      try {
        const documentName = document.nombre || 'Documento';
        for (const p of participantes) {
          if (p.id && p.id !== user?.id) {
            await createNotification({
              userId: p.id,
              type: 'alert',
              title: 'Documento cancelado',
              description: `El documento "${documentName}" ha sido cancelado. Motivo: ${cancelMotivo}`,
              priority: 'alta',
              metadata: { documentoId: document.id, documentName },
            });
          }
        }
      } catch {
        // Non-blocking
      }

      setShowCancelDocModal(false);
      setCancelMotivo('');
      setCancelDescripcion('');
      setCancelConfirmStep(false);
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  // ── Send chat message ──────────────────────────────────────────────────────
  const handleSendMessage = async () => {
    if (!chatInput.trim() || !user || !docId || chatSending) return;
    const content = chatInput.trim();
    setChatInput('');
    setChatSending(true);

    try {
      const supabase = createClient();
      const senderNombre =
        user.user_metadata?.full_name ||
        user.user_metadata?.nombre ||
        user.email ||
        'Usuario';

      const { error } = await supabase.from('document_chat_messages').insert({
        documento_id: docId,
        sender_id: user.id,
        sender_nombre: senderNombre,
        content,
      });

      if (error) {
        console.error('[chat] Error sending message:', error);
        // Restore input on error
        setChatInput(content);
      } else {
        logActivity('mensaje_enviado', 'chat', { preview: content.slice(0, 80) });
      }
    } catch (err) {
      console.error('[chat] Error:', err);
      setChatInput(content);
    } finally {
      setChatSending(false);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const estadoInfo = document
    ? (estadoConfig[document.estado] || { label: document.estado?.toUpperCase() || '—', color: 'text-gray-700', bg: 'bg-gray-100' })
    : null;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Sin vencimiento';
    try {
      return new Date(dateStr).toLocaleDateString('es-MX', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const formatChatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return '';
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getInitials = (nombre: string) => {
    return nombre
      .split(' ')
      .slice(0, 2)
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  };

  const formatDisplayName = (value?: string | null) => {
    if (!value) return '—';
    return value
      .trim()
      .toLocaleLowerCase('es-MX')
      .replace(
        /(^|[\s'-])([a-záéíóúüñ])/g,
        (_, separator: string, letter: string) =>
          `${separator}${letter.toLocaleUpperCase('es-MX')}`
      );
  };

  const formatNoteDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'hace menos de un minuto';
      if (diffMin < 60) return `hace ${diffMin} minuto${diffMin > 1 ? 's' : ''}`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `hace ${diffHr} hora${diffHr > 1 ? 's' : ''}`;
      return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // ── Participant state config (estado principal + sub_estado) ───────────────
  // Main estados (firmó, rechazó, canceló, postergó/en espera)
  const participanteEstadoConfig: Record<string, { label: string; color: string; bg: string; borderColor: string; icon: React.ReactNode }> = {
    pendiente:      { label: 'Pendiente',   color: 'text-yellow-700', bg: 'bg-yellow-50',  borderColor: 'border-yellow-300', icon: <Clock size={11} /> },
    firmado:        { label: 'Firmó',       color: 'text-green-700',  bg: 'bg-green-50',   borderColor: 'border-green-300',  icon: <CheckCircle2 size={11} /> },
    rechazado:      { label: 'Rechazó',     color: 'text-red-700',    bg: 'bg-red-50',     borderColor: 'border-red-300',    icon: <XCircle size={11} /> },
    completado:     { label: 'Firmó',       color: 'text-green-700',  bg: 'bg-green-50',   borderColor: 'border-green-300',  icon: <CheckCircle2 size={11} /> },
    cancelado:      { label: 'Canceló',     color: 'text-slate-700',  bg: 'bg-slate-100',  borderColor: 'border-slate-300',  icon: <XCircle size={11} /> },
    en_espera:      { label: 'Postergó',    color: 'text-orange-700', bg: 'bg-orange-50',  borderColor: 'border-orange-300', icon: <Clock size={11} /> },
  };

  // Sub-estados (only shown when estado is "en_proceso" / pendiente)
  const subEstadoConfig: Record<string, { label: string; color: string; bg: string; borderColor: string; dot: string }> = {
    sin_revisar:    { label: 'Sin revisar',  color: 'text-slate-500',  bg: 'bg-slate-50',   borderColor: 'border-slate-200',  dot: 'bg-slate-400' },
    en_revision:    { label: 'En revisión',  color: 'text-blue-600',   bg: 'bg-blue-50',    borderColor: 'border-blue-200',   dot: 'bg-blue-500' },
    firmo:          { label: 'Firmado',      color: 'text-green-700',  bg: 'bg-green-50',   borderColor: 'border-green-200',  dot: 'bg-green-500' },
    firmado:        { label: 'Firmado',      color: 'text-green-700',  bg: 'bg-green-50',   borderColor: 'border-green-200',  dot: 'bg-green-500' },
    rechazo:        { label: 'Rechazado',    color: 'text-red-700',    bg: 'bg-red-50',     borderColor: 'border-red-200',    dot: 'bg-red-500' },
    rechazado:      { label: 'Rechazado',    color: 'text-red-700',    bg: 'bg-red-50',     borderColor: 'border-red-200',    dot: 'bg-red-500' },
    aprobo:         { label: 'Aprobado',     color: 'text-blue-700',   bg: 'bg-blue-50',    borderColor: 'border-blue-200',   dot: 'bg-blue-500' },
    aprobado:       { label: 'Aprobado',     color: 'text-blue-700',   bg: 'bg-blue-50',    borderColor: 'border-blue-200',   dot: 'bg-blue-500' },
    cancelo:        { label: 'Cancelado',    color: 'text-slate-600',  bg: 'bg-slate-100',  borderColor: 'border-slate-300',  dot: 'bg-slate-400' },
    cancelado:      { label: 'Cancelado',    color: 'text-slate-600',  bg: 'bg-slate-100',  borderColor: 'border-slate-300',  dot: 'bg-slate-400' },
  };

  // Determine which badge(s) to show for a participant
  const getParticipantBadges = (p: Participante) => {
    const estadoKey = p.estado?.toLowerCase() || 'pendiente';
    const subKey = p.sub_estado || 'en_revision';
    const isTerminalEstado = ['firmado', 'completado', 'rechazado', 'cancelado', 'en_espera'].includes(estadoKey);
    const isTerminalSub = ['firmo', 'firmado', 'rechazo', 'rechazado', 'aprobo', 'aprobado', 'cancelo', 'cancelado'].includes(subKey);

    if (isTerminalEstado) {
      // Show only the terminal estado badge
      const cfg = participanteEstadoConfig[estadoKey] || participanteEstadoConfig['pendiente'];
      return { main: cfg, sub: null };
    }

    if (isTerminalSub) {
      // Show sub_estado terminal badge
      const subCfg = subEstadoConfig[subKey] || subEstadoConfig['en_revision'];
      return { main: null, sub: subCfg };
    }

    // "pendiente" / "en_proceso" → show sub_estado badge
    const subCfg = subEstadoConfig[subKey] || subEstadoConfig['en_revision'];
    return { main: null, sub: subCfg };
  };

  const getActivityIcon = (action: string, category?: string) => {
    const a = action?.toLowerCase() || '';
    const c = category?.toLowerCase() || '';
    if (a === 'documento_creado') return <FilePlus size={14} />;
    if (a === 'documento_visto' || a === 'documento_abierto' || a.includes('visualiz')) return <Eye size={14} />;
    if (a === 'documento_completado') return <CheckCircle2 size={14} />;
    if (a === 'documento_cancelado' || a === 'documento_anulado') return <XCircle size={14} />;
    if (a === 'documento_vencido') return <Clock size={14} />;
    if (a === 'documento_editado') return <PenLine size={14} />;
    if (a === 'participante_asignado' || a === 'participante_sustituido') return <UserPlus size={14} />;
    if (a === 'participante_removido') return <XCircle size={14} />;
    if (a === 'cambio_estado_participacion') return <RefreshCw size={14} />;
    if (a === 'firma_completada' || a === 'autografa_capturada') return <PenLine size={14} />;
    if (a === 'firma_rechazada' || a === 'aprobacion_rechazada') return <XCircle size={14} />;
    if (a === 'firma_iniciada') return <PenLine size={14} />;
    if (a === 'aprobacion_otorgada') return <CheckCircle2 size={14} />;
    if (a === 'invitacion_enviada' || a === 'invitacion_reenviada' || a === 'recordatorio_enviado') return <Bell size={14} />;
    if (a === 'descarga_solicitada' || a === 'descarga_completada') return <Download size={14} />;
    if (a === 'nom151_generado' || a === 'nom151_solicitado') return <Shield size={14} />;
    if (a.includes('acceso_denegado') || a.includes('intento_fallido') || a.includes('sospechoso')) return <AlertTriangle size={14} />;
    if (c === 'seguridad') return <Shield size={14} />;
    if (c === 'notificacion') return <Bell size={14} />;
    if (c === 'firma') return <PenLine size={14} />;
    if (c === 'acceso') return <Eye size={14} />;
    if (c === 'participantes') return <UserPlus size={14} />;
    if (a === 'nota_agregada' || c === 'nota') return <StickyNote size={14} />;
    if (a === 'mensaje_enviado' || c === 'chat') return <MessageSquare size={14} />;
    if (c === 'edicion') return <Edit3 size={14} />;
    return <Activity size={14} />;
  };

  const getActivityIconColors = (action: string, category?: string) => {
    const a = action?.toLowerCase() || '';
    const c = category?.toLowerCase() || '';
    if (a === 'documento_creado') return { bg: 'bg-indigo-100', text: 'text-indigo-600' };
    if (a === 'documento_visto' || a === 'documento_abierto' || a.includes('visualiz')) return { bg: 'bg-blue-100', text: 'text-blue-600' };
    if (a === 'documento_completado') return { bg: 'bg-emerald-100', text: 'text-emerald-600' };
    if (a === 'documento_cancelado' || a === 'documento_anulado') return { bg: 'bg-slate-100', text: 'text-slate-500' };
    if (a === 'documento_vencido') return { bg: 'bg-rose-100', text: 'text-rose-600' };
    if (a === 'documento_editado') return { bg: 'bg-amber-100', text: 'text-amber-600' };
    if (a === 'participante_asignado' || a === 'participante_sustituido') return { bg: 'bg-purple-100', text: 'text-purple-600' };
    if (a === 'participante_removido') return { bg: 'bg-red-100', text: 'text-red-500' };
    if (a === 'cambio_estado_participacion') return { bg: 'bg-cyan-100', text: 'text-cyan-600' };
    if (a === 'firma_completada' || a === 'autografa_capturada') return { bg: 'bg-green-100', text: 'text-green-600' };
    if (a === 'firma_rechazada' || a === 'aprobacion_rechazada') return { bg: 'bg-red-100', text: 'text-red-600' };
    if (a === 'firma_iniciada') return { bg: 'bg-teal-100', text: 'text-teal-600' };
    if (a === 'aprobacion_otorgada') return { bg: 'bg-blue-100', text: 'text-blue-600' };
    if (a === 'invitacion_enviada' || a === 'invitacion_reenviada' || a === 'recordatorio_enviado') return { bg: 'bg-amber-100', text: 'text-amber-600' };
    if (a === 'descarga_solicitada' || a === 'descarga_completada') return { bg: 'bg-cyan-100', text: 'text-cyan-600' };
    if (a === 'nom151_generado' || a === 'nom151_solicitado') return { bg: 'bg-violet-100', text: 'text-violet-600' };
    if (a.includes('acceso_denegado') || a.includes('intento_fallido') || a.includes('sospechoso')) return { bg: 'bg-red-100', text: 'text-red-500' };
    if (c === 'seguridad') return { bg: 'bg-slate-100', text: 'text-slate-600' };
    if (c === 'notificacion') return { bg: 'bg-amber-100', text: 'text-amber-600' };
    if (c === 'firma') return { bg: 'bg-green-100', text: 'text-green-600' };
    if (c === 'acceso') return { bg: 'bg-blue-100', text: 'text-blue-600' };
    if (c === 'participantes') return { bg: 'bg-purple-100', text: 'text-purple-600' };
    if (a === 'nota_agregada' || c === 'nota') return { bg: 'bg-yellow-100', text: 'text-yellow-600' };
    if (a === 'mensaje_enviado' || c === 'chat') return { bg: 'bg-sky-100', text: 'text-sky-600' };
    if (c === 'edicion') return { bg: 'bg-amber-100', text: 'text-amber-600' };
    return { bg: 'bg-gray-100', text: 'text-gray-500' };
  };

  const formatActivityDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('es-MX', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return dateStr;
    }
  };

  const getActivityLabel = (action: string, event?: ActivityEvent) => {
    const map: Record<string, string> = {
      documento_creado: 'Documento creado',
      documento_editado: 'Documento modificado',
      documento_completado: 'Documento completado',
      documento_vencido: 'Documento vencido',
      documento_cancelado: 'Documento cancelado',
      documento_anulado: 'Documento anulado',
      documento_restaurado: 'Documento restaurado',
      documento_abierto: 'Documento abierto',
      documento_visto: 'Documento visualizado',
      descarga_solicitada: 'Descarga solicitada',
      descarga_completada: 'Descarga completada',
      vista_previa_generada: 'Vista previa generada',
      participante_asignado: 'Participante asignado',
      participante_removido: 'Participante removido',
      participante_sustituido: 'Participante sustituido',
      cambio_estado_participacion: 'Cambio de estado de participación',
      invitacion_enviada: 'Invitación enviada',
      invitacion_reenviada: 'Invitación reenviada',
      recordatorio_enviado: 'Recordatorio enviado',
      notificacion_completado_enviada: 'Notificación de completado enviada',
      firma_iniciada: 'Proceso de firma iniciado',
      firma_completada: 'Documento firmado',
      firma_rechazada: 'Firma rechazada',
      firma_delegada: 'Firma delegada',
      aprobacion_otorgada: 'Documento aprobado',
      aprobacion_rechazada: 'Aprobación rechazada',
      nom151_generado: 'Constancia NOM-151 generada',
      nom151_solicitado: 'Constancia NOM-151 solicitada',
      nom151_verificado: 'Constancia NOM-151 verificada',
      blockchain_notarizado: 'Notarizado en blockchain',
      blockchain_verificado: 'Verificado en blockchain',
      intento_fallido: 'Intento fallido',
      acceso_denegado: 'Acceso denegado',
      actividad_sospechosa_detectada: 'Actividad sospechosa detectada',
      bloqueo_por_rate_limit: 'Bloqueo por límite de intentos',
      sesion_expirada: 'Sesión expirada',
      efirma_certificado_validado: 'Certificado e.firma validado',
      efirma_certificado_rechazado: 'Certificado e.firma rechazado',
      otp_enviado: 'Código OTP enviado',
      otp_verificado: 'Código OTP verificado',
      otp_fallido: 'Código OTP fallido',
      autografa_capturada: 'Firma autógrafa capturada',
      acceso_revocado: 'Acceso revocado',
      nota_agregada: 'Nota agregada',
      mensaje_enviado: 'Mensaje enviado',
      cambio_estado_participacion: 'Cambio de estado de participación',
    };
    // Enrich label with participant name if available
    const base = map[action] || action?.replace(/_/g, ' ') || 'Evento';
    if (event?.participant_name && (action === 'documento_visto' || action === 'documento_abierto')) {
      return `Documento visualizado`;
    }
    return base;
  };

  const getActivityDetails = (event: ActivityEvent): string | null => {
    const details = event.details;
    if (!details || typeof details !== 'object') return null;
    const parts: string[] = [];
    // Skip workspace_id intentionally
    if (details.ip_address) parts.push(`IP: ${details.ip_address}`);
    if (details.device) parts.push(`Dispositivo: ${details.device}`);
    if (details.method) parts.push(`Método: ${details.method}`);
    if (details.reason) parts.push(`Motivo: ${String(details.reason)}`);
    if (details.metodo_firma) parts.push(`Método de firma: ${String(details.metodo_firma)}`);
    if (details.firma_tipo) parts.push(`Tipo de firma: ${String(details.firma_tipo)}`);
    if (details.lugar) parts.push(`Lugar: ${String(details.lugar)}`);
    if (details.estado_nuevo) parts.push(`Nuevo estado: ${String(details.estado_nuevo)}`);
    if (details.doc_status) parts.push(`Estado del documento: ${String(details.doc_status)}`);
    if (details.actor_role) parts.push(`Rol: ${String(details.actor_role)}`);
    if (details.result && details.result !== 'exitoso') parts.push(`Resultado: ${String(details.result)}`);
    if (details.campo) parts.push(`Campo: ${String(details.campo)}`);
    if (details.nombre_nuevo) parts.push(`Nuevo nombre: ${String(details.nombre_nuevo)}`);
    if (details.nombre_archivo) parts.push(`Archivo: ${String(details.nombre_archivo)}`);
    if (details.campos_actualizados && Array.isArray(details.campos_actualizados)) {
      parts.push(`Campos: ${(details.campos_actualizados as string[]).join(', ')}`);
    }
    if (details.total !== undefined) parts.push(`Total participantes: ${String(details.total)}`);
    if (details.visibilidad) parts.push(`Visibilidad: ${String(details.visibilidad)}`);
    if (details.preview) parts.push(`"${String(details.preview)}${String(details.preview).length >= 80 ? '…' : ''}"`);
    if (details.tipo) parts.push(`Tipo: ${String(details.tipo)}`);
    if (details.comentario) parts.push(`Comentario: ${String(details.comentario).slice(0, 80)}`);
    if (details.description && typeof details.description === 'string' && !details.description.includes('workspace')) {
      // Only show description if it doesn't contain workspace info
      parts.unshift(details.description);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const effectiveCampos = React.useMemo(() => camposSolicitados, [camposSolicitados]);

  // NEW: Build a map of campo_id/label -> filled value from participation responses
  const camposFilledMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    participationResponses.forEach((resp) => {
      if (resp.campos_completados && Array.isArray(resp.campos_completados)) {
        resp.campos_completados.forEach((c) => {
          if (c.campo_id) map[c.campo_id] = c.value;
          if (c.label) map[c.label] = c.value;
          // Also index by "email:label" for participant-specific lookup
          if (resp.participante_email && c.label) {
            map[`${resp.participante_email}:${c.label}`] = c.value;
          }
          if (resp.participante_email && c.campo_id) {
            map[`${resp.participante_email}:${c.campo_id}`] = c.value;
          }
        });
      }
    });
    return map;
  }, [participationResponses]);

    // NEW: Get the firma_data for a given campo (by participantId/email match)
  const getFirmaDataForCampo = React.useCallback((campo: CampoSolicitado): string | null => {
    if (!campo.participantId && !campo.participantName) {
      // No specific participant — use first available firma
      const resp = participationResponses.find((r) => r.firma_data && r.firma_completada);
      return resp?.firma_data || null;
    }

    // Resolve participantId (UUID) to email via participantes array
    const resolvedEmail = (() => {
      if (!campo.participantId) return null;
      // Check if participantId is already an email
      if (campo.participantId.includes('@')) return campo.participantId;
      // Look up in participantes array by id
      const matchedPart = participantes.find(
        (p) => p.id === campo.participantId
      );
      return matchedPart?.email || null;
    })();

    // Match by resolved email, participantId directly (if email), or participantName
    const resp = participationResponses.find(
      (r) =>
        (resolvedEmail && r.participante_email === resolvedEmail) ||
        r.participante_email === campo.participantId ||
        (campo.participantName && r.participante_nombre === campo.participantName)
    );
    return resp?.firma_data || null;
  }, [participationResponses, participantes]);

  // NEW: Get filled value for a campo
  const getFilledValueForCampo = React.useCallback((campo: CampoSolicitado): string => {
    // Resolve participantId (UUID) to email
    const resolvedEmail = (() => {
      if (!campo.participantId) return null;
      if (campo.participantId.includes('@')) return campo.participantId;
      const matchedPart = participantes.find((p) => p.id === campo.participantId);
      return matchedPart?.email || null;
    })();

    // Try participant-specific lookup first (email:campo_id or email:label)
    if (resolvedEmail) {
      if (campo.id && camposFilledMap[`${resolvedEmail}:${campo.id}`]) return camposFilledMap[`${resolvedEmail}:${campo.id}`];
      if (campo.label && camposFilledMap[`${resolvedEmail}:${campo.label}`]) return camposFilledMap[`${resolvedEmail}:${campo.label}`];
    }
    // Fallback to generic lookup
    if (campo.id && camposFilledMap[campo.id]) return camposFilledMap[campo.id];
    if (campo.label && camposFilledMap[campo.label]) return camposFilledMap[campo.label];
    return '';
  }, [camposFilledMap, participantes]);

  // Helper: render a field value correctly based on its type
  const renderFieldDisplayValue = (value: string, tipo?: string, casillaLabel?: string | null): React.ReactNode => {
    const resolvedTipo = tipo || 'texto';
    const isCasilla = resolvedTipo === 'casilla' || resolvedTipo === 'checkbox';
    const isCheckboxValue = value === 'true' || value === 'false';

    if (isCasilla || isCheckboxValue) {
      const checked = value === 'true';
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '14px',
              height: '14px',
              border: `2px solid ${checked ? '#2dd4bf' : '#94a3b8'}`,
              borderRadius: '3px',
              background: checked ? '#2dd4bf' : '#fff',
              flexShrink: 0,
            }}
          >
            {checked && (
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          {casillaLabel && (
            <span style={{ fontSize: '9px', color: '#1e293b' }}>{casillaLabel}</span>
          )}
        </span>
      );
    }

    return (
      <span
        style={{
          fontSize: '9px',
          color: '#1e293b',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          width: '100%',
        }}
      >
        {value}
      </span>
    );
  };

  const participantColorMap = React.useMemo(() => {
    const map: Record<string, number> = {};
    let idx = 0;
    effectiveCampos.forEach((c) => {
      const key = c.participantId || 'sin-asignar';
      if (!(key in map)) {
        map[key] = idx % CAMPO_COLORS.length;
        idx++;
      }
    });
    return map;
  }, [effectiveCampos]);

  const camposEnPaginaActual = React.useMemo(
    () => effectiveCampos.filter((c) => (c.page || 1) === currentPage),
    [effectiveCampos, currentPage]
  );

  const getFieldOverlayStyle = (campo: CampoSolicitado): React.CSSProperties => {
    const x = campo.x ?? 5;
    const y = campo.y ?? 5;
    const w = campo.width ?? 20;
    const h = campo.height ?? 6;
    return {
      position: 'absolute',
      left: `${x}%`,
      top: `${y}%`,
      width: `${w}%`,
      height: `${h}%`,
    };
  };

  // NEW: Helper to render a campo overlay with filled value or signature stamp
  const renderCampoOverlay = (campo: CampoSolicitado, idx: number, keyPrefix: string) => {
    const colorKey = campo.participantId || 'sin-asignar';
    const colorIdx = participantColorMap[colorKey] ?? 0;
    const colors = CAMPO_COLORS[colorIdx];
    const style = getFieldOverlayStyle(campo);
    const borderColor = campo.colorHex ?? undefined;
    const bgColor = campo.colorHex ? `${campo.colorHex}20` : undefined;
    const textColor = campo.colorHex ?? undefined;

    const resolvedTipo = campo.tipo || (campo.label === 'Firma' ? 'firma' : 'texto');
    const isFirma = resolvedTipo === 'firma' || campo.label === 'Firma' || campo.label?.toLowerCase() === 'firma';
    const filledValue = getFilledValueForCampo(campo);
    const firmaData = isFirma ? getFirmaDataForCampo(campo) : null;

    // If firma field and we have signature data — show the stamp
    if (isFirma && firmaData) {
      return (
        <div
          key={`${keyPrefix}-${campo.label}-${idx}`}
          style={{ ...style, zIndex: 10 }}
          className="absolute"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={firmaData}
            alt="Firma estampada"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              background: 'rgba(255,255,255,0.88)',
              borderRadius: '3px',
              border: `1.5px solid ${borderColor || '#2dd4bf'}`,
            }}
          />
        </div>
      );
    }

    // If non-firma field and we have a filled value — show the value
    if (!isFirma && filledValue) {
      const isCasilla = resolvedTipo === 'casilla' || resolvedTipo === 'checkbox';
      return (
        <div
          key={`${keyPrefix}-${campo.label}-${idx}`}
          style={{
            ...style,
            zIndex: 10,
            background: 'rgba(255,255,255,0.92)',
            borderRadius: '3px',
            border: `1px solid ${borderColor || '#2dd4bf'}60`,
            display: 'flex',
            alignItems: 'center',
            padding: isCasilla ? '2px 4px' : '1px 4px',
            overflow: 'hidden',
          }}
        >
          {renderFieldDisplayValue(filledValue, resolvedTipo, campo.casillaLabel)}
        </div>
      );
    }

    // Default: show the campo label placeholder (original behavior)
    return (
      <div
        key={`${keyPrefix}-${campo.label}-${idx}`}
        style={{ ...style, borderColor, backgroundColor: bgColor }}
        className={`border-2 rounded flex items-center justify-center ${!borderColor ? `${colors.border} ${colors.bg}` : ''}`}
      >
        <span
          className={`text-xs font-semibold px-1 text-center leading-tight ${!textColor ? colors.text : ''}`}
          style={textColor ? { color: textColor } : undefined}
        >
          {campo.label}
        </span>
      </div>
    );
  };

  const handleSaveNote = async () => {
    if (!noteContent.trim() || !user || !docId || noteSaving) return;
    setNoteSaving(true);
    try {
      const supabase = createClient();
      const authorNombre =
        user.user_metadata?.full_name ||
        user.user_metadata?.nombre ||
        user.email ||
        'Usuario';

      const newNote = {
        documento_id: docId,
        author_id: user.id,
        author_nombre: authorNombre,
        content: noteContent.trim(),
        tipo: 'general' as const,
        visibilidad: noteVisibilidad,
      };

      const { data: insertedData, error } = await supabase
        .from('document_notes')
        .insert(newNote)
        .select('id, documento_id, author_id, author_nombre, content, tipo, visibilidad, created_at')
        .single();

      if (!error) {
        if (insertedData) {
          setNotes((prev) => [insertedData as DocumentNote, ...prev]);
        }
        logActivity('nota_agregada', 'nota', {
          visibilidad: noteVisibilidad,
          preview: noteContent.trim().slice(0, 80),
        });
        setNoteContent('');
        setNoteVisibilidad('publica');
        setShowNoteForm(false);
      } else {
        console.error('[notes] Error saving note:', error);
      }
    } catch (err) {
      console.error('[notes] Error:', err);
    } finally {
      setNoteSaving(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const supabase = createClient();
      await supabase.from('document_notes').delete().eq('id', noteId);
    } catch (err) {
      console.error('[notes] Error deleting note:', err);
    }
  };

  // ── Edit tab state ─────────────────────────────────────────────────────────
  const [editModal, setEditModal] = useState<'datos' | 'archivo' | 'participantes' | 'ajustes' | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editSaved, setEditSaved] = useState<string | null>(null);

  // Edit: document data (StepSubir config)
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editDocConfig, setEditDocConfig] = useState<DocumentConfig>({
    nombre: '', descripcion: '', numeroOficio: '', grupotipoId: '', tipoDocumentoId: '', otroTipoDocumento: '', ruta: 'raiz', etiquetasIds: [],
  });

  // Edit: participants (StepParticipantes)
  const [editParticipants, setEditParticipants] = useState<Participant[]>([]);
  const [editParticipantMode, setEditParticipantMode] = useState<ParticipantMode>(null);
  const [editParticipationOrder, setEditParticipationOrder] = useState<string>('');

  // Edit: settings (StepAjustes)
  const [editSettings, setEditSettings] = useState<DocumentSettings>({
    title: '', message: '', deadline: '', reminderDays: '3', requireAllSignatures: true, allowDecline: false,
  });
  const [editPlacedFields, setEditPlacedFields] = useState<PlacedField[]>([]);
  const [editSecuritySettings, setEditSecuritySettings] = useState<SecuritySettings | undefined>(undefined);

  // Initialize edit state from loaded document
  useEffect(() => {
    if (!document) return;
    setEditDocConfig({
      nombre: document.nombre || '',
      descripcion: '',
      numeroOficio: '',
      grupotipoId: '',
      tipoDocumentoId: '',
      otroTipoDocumento: '',
      ruta: 'raiz',
      etiquetasIds: [],
    });
  }, [document]);

  // Initialize edit participants from loaded participantes
  useEffect(() => {
    if (participantes.length === 0) return;
    const mapped: Participant[] = participantes.map((p) => ({
      id: p.id,
      name: p.nombre,
      email: p.email,
      role: (p.acto?.toLowerCase() === 'firmante' ? 'firmante' : p.acto?.toLowerCase() === 'aprobador' ? 'aprobador' : 'observador') as 'firmante' | 'aprobador' | 'observador',
      configured: true,
      acto: p.acto,
      rolDocumento: p.rolDocumento,
      tipoFirma: p.metodo_firma ? [p.metodo_firma] : ['autografa'],
    }));
    setEditParticipants(mapped);
  }, [participantes]);

  const handleOpenEditModal = (modal: 'datos' | 'archivo' | 'participantes' | 'ajustes') => {
    setEditModal(modal);
    setEditSaved(null);
  };

  const handleSaveDocumentData = async () => {
    if (!document || !editDocConfig.nombre.trim()) return;
    setEditSaving(true);
    try {
      const supabase = createClient();
      const updates: Record<string, any> = {
        nombre: editDocConfig.nombre.trim(),
      };
      if (editDocConfig.descripcion) updates.descripcion = editDocConfig.descripcion;
      if (editDocConfig.numeroOficio) updates.numero_oficio = editDocConfig.numeroOficio;
      if (editDocConfig.grupotipoId) updates.grupo_tipo_documento_id = editDocConfig.grupotipoId;
      if (editDocConfig.tipoDocumentoId && editDocConfig.tipoDocumentoId !== '__otros__') {
        updates.tipo_documento_id = editDocConfig.tipoDocumentoId;
      }
      if (editDocConfig.etiquetasIds?.length) updates.etiquetas_ids = editDocConfig.etiquetasIds;

      const { error } = await supabase.from('documentos').update(updates).eq('id', document.id);
      if (error) {
        console.error('[edit] Supabase error saving document data:', error.message, error.code);
      } else {
        setDocument((prev) => prev ? { ...prev, nombre: editDocConfig.nombre.trim() } : prev);
        logActivity('documento_editado', 'edicion', { campo: 'datos_documento', nombre_nuevo: editDocConfig.nombre.trim() });
        setEditSaved('datos');
        setTimeout(() => { setEditModal(null); setEditSaved(null); }, 800);
      }
    } catch (err) {
      console.error('[edit] Error saving document data:', err);
    } finally {
      setEditSaving(false);
    }
  };

  const handleSaveFile = async () => {
    if (!document || !editFile) return;
    setEditSaving(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      // Upload new file to storage
      const fileExt = editFile.name.split('.').pop() || 'pdf';
      const filePath = `documents/${document.workspace_id || 'default'}/${document.id}/document.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, editFile, { upsert: true, contentType: editFile.type });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
      const newUrl = urlData?.publicUrl;

      if (newUrl) {
        await supabase.from('documentos').update({
          file_url: newUrl,
          file_size: editFile.size,
          file_type: editFile.type,
        }).eq('id', document.id);
        setDocument((prev) => prev ? { ...prev, file_url: newUrl, file_size: editFile.size, formato: editFile.type } : prev);
        setEditFile(null);
        logActivity('documento_editado', 'edicion', { campo: 'archivo', nombre_archivo: editFile.name, tamanio: editFile.size });
        setEditSaved('archivo');
        setTimeout(() => { setEditModal(null); setEditSaved(null); }, 800);
      }
    } catch (err) {
      console.error('[edit] Error saving file:', err);
    } finally {
      setEditSaving(false);
    }
  };

  const handleSaveParticipants = async () => {
    if (!document || editParticipants.length === 0) return;
    setEditSaving(true);
    try {
      const supabase = createClient();
      const firmaLabelMap: Record<string, string> = {
        autografa: 'Firma Autógrafa Digital',
        efirma: 'e-Firma SAT',
        biometria: 'Biometría (Premium)',
      };
      const newParticipantes = editParticipants.map((p, idx) => ({
        id: p.id,
        nombre: p.name,
        email: p.email,
        estado: 'pendiente',
        metodo_firma: p.tipoFirma?.[0] ? (firmaLabelMap[p.tipoFirma[0]] || p.tipoFirma[0]) : 'Firma Autógrafa Digital',
        orden: idx + 1,
        acto: p.acto || p.role,
        rolDocumento: p.rolDocumento,
        tipoFirma: p.tipoFirma,
        tipoNotificacion: (p as any).tipoNotificacion,
        mensajePersonalizado: (p as any).mensajePersonalizado,
      }));

      const { error } = await supabase.from('documentos').update({
        participantes: newParticipantes,
      }).eq('id', document.id);

      if (error) {
        console.error('[edit] Supabase error saving participants:', error.message, error.code);
      } else {
        // Refresh local participantes
        const mapped = newParticipantes.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          email: p.email,
          estado: p.estado,
          metodo_firma: p.metodo_firma,
          orden: p.orden,
          acto: p.acto,
          rolDocumento: p.rolDocumento,
        }));
        setParticipantes(mapped);
        logActivity('documento_editado', 'participantes', { campo: 'participantes', total: editParticipants.length });
        setEditSaved('participantes');
        setTimeout(() => { setEditModal(null); setEditSaved(null); }, 800);
      }
    } catch (err) {
      console.error('[edit] Error saving participants:', err);
    } finally {
      setEditSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!document) return;
    setEditSaving(true);
    try {
      const supabase = createClient();
      const updates: Record<string, any> = {};
      if (editSettings.deadline) updates.fecha_vencimiento = editSettings.deadline;
      if (editPlacedFields.length > 0) {
        updates.campos_solicitados = editPlacedFields.map((f) => ({
          id: f.id,
          label: f.label,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          page: f.page || 1,
          participantId: f.participantId || null,
          participantName: f.participantName || null,
          colorHex: f.colorHex || null,
        }));
      }
      if (editSecuritySettings) {
        if (editSecuritySettings.vencimientoEnabled && editSecuritySettings.fechaVencimiento) {
          updates.fecha_vencimiento = editSecuritySettings.fechaVencimiento;
        }
        updates.tiene_codigo_acceso = editSecuritySettings.codigoAccesoEnabled;
        updates.legal_hold = editSecuritySettings.legalHoldEnabled;
        updates.es_urgente = editSecuritySettings.urgente;
        updates.es_publico = editSecuritySettings.publico;
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase.from('documentos').update(updates).eq('id', document.id);
        if (error) {
          console.error('[edit] Supabase error saving settings:', error.message, error.code);
        } else {
          if (updates.fecha_vencimiento) {
            setDocument((prev) => prev ? { ...prev, vencimiento: updates.fecha_vencimiento } : prev);
          }
          if (updates.campos_solicitados) {
            setCamposSolicitados(updates.campos_solicitados);
          }
          logActivity('documento_editado', 'edicion', { campo: 'ajustes', campos_actualizados: Object.keys(updates) });
          setEditSaved('ajustes');
          setTimeout(() => { setEditModal(null); setEditSaved(null); }, 800);
        }
      } else {
        // No updates to apply, just close
        setEditSaved('ajustes');
        setTimeout(() => { setEditModal(null); setEditSaved(null); }, 800);
      }
    } catch (err) {
      console.error('[edit] Error saving settings:', err);
    } finally {
      setEditSaving(false);
    }
  };

  if (loading || authLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3">
            <svg className="animate-spin h-6 w-6 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm text-muted-foreground">Cargando documento...</span>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!document) {
    const isAccessDenied = docError === 'sin_acceso';
    const isNotFound = docError === 'no_encontrado';
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <FileText size={48} className="text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground font-medium">
              {isNotFound ? 'Documento no encontrado.' : isAccessDenied ? 'No tienes acceso a este documento.' : 'Error al cargar el documento.'}
            </p>
            {isAccessDenied && (
              <p className="text-xs text-slate-400 mt-1">Verifica que tengas los permisos necesarios.</p>
            )}
            <button onClick={() => router.back()} className="mt-4 text-sm text-primary hover:underline">Volver</button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const allToolbarItems: { key: typeof activeTab; icon: React.ReactNode; title: string }[] = [
    { key: 'details', icon: <Info size={20} />, title: 'Detalles' },
    { key: 'participants', icon: <Users size={20} />, title: 'Participantes' },
    { key: 'comments', icon: <MessageSquare size={20} />, title: 'Comunicación' },
    { key: 'activity', icon: <Activity size={20} />, title: 'Actividad' },
    { key: 'vencimientos', icon: <Calendar size={20} />, title: 'Vencimientos' },
    { key: 'fields', icon: <StickyNote size={20} />, title: 'Notas y Comentarios' },
    ...(document?.estado === 'en_proceso' && user?.id === document?.owner_id
      ? [{ key: 'editar' as typeof activeTab, icon: <Edit3 size={20} />, title: 'Editar Documento' }]
      : []),
    ...(document?.estado === 'completado'
      ? [{ key: 'descargas' as typeof activeTab, icon: <Download size={20} />, title: 'Descargas' }]
      : []),
  ];
  const toolbarItems = allToolbarItems.filter(
    (item) => item.key !== 'comments' || participantes.length > 1
  );

  const PaginationBar = ({ modal = false }: { modal?: boolean }) => (
    <div className={`${modal ? 'absolute bottom-6 left-1/2 -translate-x-1/2 z-20' : 'absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto'}`}>
      <div className="flex h-10 items-center overflow-hidden rounded-md border border-slate-200 bg-white/95 shadow-[0_8px_24px_rgba(15,23,42,0.12)] backdrop-blur select-none">
        <button onClick={handleZoomOut} disabled={zoom <= ZOOM_MIN} className="flex h-10 w-10 items-center justify-center text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40" title="Reducir zoom">
          <ZoomOut size={14} />
        </button>
        <span className="min-w-[48px] border-x border-slate-100 px-2 text-center text-xs font-500 text-slate-600">{zoom}%</span>
        <button onClick={handleZoomIn} disabled={zoom >= ZOOM_MAX} className="flex h-10 w-10 items-center justify-center text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40" title="Aumentar zoom">
          <ZoomIn size={14} />
        </button>
        <div className="h-5 w-px bg-slate-200" />
        <button onClick={handlePrevPage} disabled={currentPage <= 1} className="flex h-10 w-10 items-center justify-center text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40" title="Página anterior">
          <ChevronLeft size={14} />
        </button>
        <div className="flex min-w-[54px] items-center justify-center gap-1 px-2">
          <span className="text-xs font-600 text-slate-800">{currentPage}</span>
          <span className="whitespace-nowrap text-xs text-slate-400">/ {totalPages}</span>
        </div>
        <button onClick={handleNextPage} disabled={currentPage >= totalPages} className="flex h-10 w-10 items-center justify-center text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40" title="Página siguiente">
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );

  const PDF_SHEET_REF_WIDTH = 800;

  return (
    <AppLayout>
      <div
        className="-mx-4 -my-4 flex flex-col overflow-hidden bg-gray-100 sm:-mx-6 md:-my-6 lg:-mx-8 xl:-mx-10"
        style={{ height: sidebarOpen ? 'calc(100dvh - 4rem)' : 'calc(100dvh - 6.5rem)' }}
      >

        {/* Document Top Bar */}
        <div className="flex min-h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 md:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {document.estado !== 'completado' && (
              <button onClick={() => router.back()} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-950" title="Volver">
                <ArrowLeft size={17} />
              </button>
            )}
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-[15px] font-700 text-slate-950 md:text-base">{document.nombre}</h1>
                {estadoInfo && (
                  <span className={`hidden flex-shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-700 uppercase md:inline-flex ${estadoInfo.bg} ${estadoInfo.color} border-current`}>
                    {estadoInfo.label}
                  </span>
                )}
              </div>
              <div className="mt-0.5 hidden min-w-0 items-center gap-2 xl:flex">
                <span className="truncate text-xs text-slate-500">
                  Creado por <span className="font-500 text-slate-600">{formatDisplayName(document.owner_nombre)}</span>
                </span>
                <span className="text-xs text-slate-300">•</span>
                <span className="whitespace-nowrap text-xs text-slate-500">
                  Modificado {formatDate(document.updated_at)}
                </span>
              </div>
            </div>
          </div>

          {(() => {
            const isOwner = user?.id === document.owner_id;
            const isEnProgreso = document.estado === 'en_proceso';
            const isEnEspera = document.estado === 'en_espera';
            const isTerminal = ['rechazado', 'cancelado', 'completado'].includes(document.estado);
            const myParticipation = participantes.find((p) => p.email === user?.email);
            const mySubEstado = myParticipation?.sub_estado || participantSubEstado;
            const iAlreadyActed = ['firmo', 'firmado', 'rechazo', 'rechazado', 'cancelo', 'cancelado'].includes(mySubEstado || '');
            // Participation actions blocked when doc is en_espera or terminal
            const actionsBlocked = isEnEspera || isTerminal || iAlreadyActed;
            return (
              <div className="flex flex-shrink-0 items-center gap-2">
                {/* Cerrar button: only when document is completado */}
                {document.estado === 'completado' && (
                  <button
                    onClick={() => router.push('/mis-documentos')}
                    className="flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-600 text-white transition-colors hover:bg-blue-700"
                  >
                    <X size={16} />
                    <span>Cerrar</span>
                  </button>
                )}
                {/* Cancel button: only for owner when doc is en_proceso */}
                {isOwner && isEnProgreso && (
                  <button onClick={() => setShowCancelDocModal(true)} className="flex h-9 w-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white text-sm font-500 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 xl:w-auto xl:px-3" title="Cancelar documento">
                    <XCircle size={16} />
                    <span className="hidden xl:inline">Cancelar</span>
                  </button>
                )}
                {/* Participation action buttons: hidden when blocked */}
                {!actionsBlocked && (
                  <>
                    <button onClick={() => setShowRejectModal(true)} className="flex h-9 w-9 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white text-sm font-500 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 xl:w-auto xl:px-3" title="Rechazar documento">
                      <XCircle size={16} />
                      <span className="hidden xl:inline">Rechazar</span>
                    </button>
                    <button onClick={() => setShowChangesModal(true)} className="flex h-9 w-9 items-center justify-center gap-1.5 rounded-md border border-amber-200 bg-white text-sm font-500 text-amber-600 transition-colors hover:bg-amber-50 hover:text-amber-700 xl:w-auto xl:px-3" title="Solicitar cambios">
                      <RefreshCw size={16} />
                      <span className="hidden xl:inline">Solicitar cambios</span>
                    </button>
                    <button onClick={() => router.push(`/firmar-documento/${document.id}`)} className="flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-600 text-white transition-colors hover:bg-emerald-700" title="Aceptar y participar">
                      <CheckCircle2 size={16} />
                      <span className="hidden xl:inline">Aceptar y participar</span>
                      <span className="xl:hidden">Aceptar</span>
                    </button>
                  </>
                )}
                {/* Status badge when blocked */}
                {actionsBlocked && !isOwner && (
                  <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${
                    isEnEspera ? 'bg-orange-100 text-orange-700' : isTerminal ?'bg-slate-100 text-slate-600': iAlreadyActed ?'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {isEnEspera ? 'Pendiente de información' : isTerminal ? document.estado.charAt(0).toUpperCase() + document.estado.slice(1) : 'Participación registrada'}
                  </span>
                )}
              </div>
            );
          })()}
        </div>

        {/* Body: pdf viewer + right panel */}
        <div className="relative flex flex-1 overflow-hidden bg-gray-100">

          {/* PDF Viewer Area */}
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-gray-100">
            <div className="pointer-events-none absolute left-4 right-4 top-3 z-10 flex items-center justify-between">
              <div className="pointer-events-auto">
                <button onClick={() => setShowCampos((v) => !v)} aria-pressed={showCampos} className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white/95 px-3 text-slate-700 shadow-[0_2px_8px_rgba(15,23,42,0.06)] backdrop-blur transition-colors hover:bg-white hover:text-slate-950">
                  <div className={`relative h-4 w-7 rounded-full transition-colors ${showCampos ? 'bg-blue-600' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${showCampos ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </div>
                  <Eye size={14} className="text-slate-400" />
                  <span className="text-xs font-600">Campos ({effectiveCampos.length})</span>
                </button>
              </div>
              {document.file_url && (
                <div className="pointer-events-auto">
                  <button onClick={() => setShowFullscreenModal(true)} className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white/95 px-3 text-xs font-600 text-slate-700 shadow-[0_2px_8px_rgba(15,23,42,0.06)] backdrop-blur transition-colors hover:bg-white hover:text-slate-950" title="Ver documento completo">
                    <Maximize2 size={14} />
                    <span className="hidden sm:inline">Pantalla completa</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto" style={{ paddingTop: '56px', paddingBottom: '72px' }}>
              {document.file_url ? (
                <div className="flex min-h-full min-w-full items-start justify-center p-4 md:p-6">
                  <div className="relative flex-shrink-0 border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.12)]">
                    <PdfCanvas fileUrl={document.file_url} page={currentPage} zoom={zoom} onTotalPages={handleTotalPages} />
                    {showCampos && camposEnPaginaActual.length > 0 && (
                      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
                        {camposEnPaginaActual.map((campo, idx) => renderCampoOverlay(campo, idx, 'main'))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <FileText size={64} className="text-slate-300" strokeWidth={1} />
                  <p className="text-sm text-slate-400">Vista previa no disponible</p>
                </div>
              )}
            </div>
            <PaginationBar />
          </div>

          {/* Right side: icon tab strip + panel content */}
          <div className="hidden flex-shrink-0 md:flex">
            <div className="z-30 flex w-14 flex-col items-center gap-1 border-x border-slate-200 bg-white px-2 py-3 shadow-[-4px_0_12px_rgba(15,23,42,0.04)]">
              {toolbarItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    if (activeTab === item.key) {
                      setIsSidePanelOpen((open) => !open);
                    } else {
                      setActiveTab(item.key);
                      setIsSidePanelOpen(true);
                    }
                  }}
                  title={item.title}
                  className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                    activeTab === item.key && isSidePanelOpen
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950'
                  }`}
                >
                  {React.cloneElement(item.icon as React.ReactElement<{ size?: number }>, { size: 17 })}
                </button>
              ))}
              <button
                onClick={() => setIsSidePanelOpen((open) => !open)}
                title={isSidePanelOpen ? 'Ocultar panel' : 'Mostrar panel'}
                className="mt-auto flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-slate-400 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-800"
              >
                {isSidePanelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
              </button>
            </div>

            {isSidePanelOpen && (
            <div className="document-viewer-panel absolute inset-y-0 right-14 z-20 flex w-[360px] max-w-[calc(100%-3.5rem)] flex-col overflow-hidden border-l border-slate-200 bg-slate-50/70 shadow-[-12px_0_28px_rgba(15,23,42,0.10)] lg:static lg:z-auto lg:w-[360px] lg:shadow-none 2xl:w-[400px]">
              {activeTab === 'details' ? (
                <>
                  <div className="px-4 py-3 border-b border-border flex-shrink-0">
                    <span className="text-sm font-semibold text-foreground">Detalles del Documento</span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <div className="flex flex-col gap-4 p-4">

                      {/* ── Información General ─────────────────────────────── */}
                      <div className="rounded-xl border border-border bg-white overflow-hidden">
                        <div className="px-4 py-3 border-b border-border/60">
                          <span className="text-sm font-semibold text-foreground">Información General</span>
                        </div>
                        <div className="p-4 flex flex-col gap-3">
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">NOMBRE DEL DOCUMENTO</p>
                            <p className="text-sm text-foreground break-all">{document.nombre}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">ID DEL DOCUMENTO</p>
                            <p className="text-xs text-foreground font-mono break-all">{document.documento_id || document.id}</p>
                          </div>
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FORMATO</p>
                              <p className="text-sm text-foreground">{document.formato || 'PDF'}</p>
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">TAMAÑO</p>
                              <p className="text-sm text-foreground">{formatSize(document.file_size)}</p>
                            </div>
                          </div>
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">PÁGINAS</p>
                              <p className="text-sm text-foreground">{document.metadata?.pdf_page_count ?? totalPages ?? '—'}</p>
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">ESTADO</p>
                              {estadoInfo && (
                                <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded ${estadoInfo.bg} ${estadoInfo.color}`}>
                                  {estadoInfo.label}
                                </span>
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">PROVIENE</p>
                            <p className="text-sm text-foreground">{document.origen || 'Plataforma Web'}</p>
                          </div>
                        </div>
                      </div>

                      {document.es_publico && document.estado === 'completado' && publicVerificationUrl && (
                        <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white">
                          <div className="flex items-center gap-2 border-b border-emerald-100 px-4 py-3">
                            <Globe2 size={16} className="text-emerald-600" />
                            <span className="text-sm font-semibold text-foreground">Verificación pública</span>
                            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Publicado
                            </span>
                          </div>
                          <div className="flex flex-col items-center gap-3 p-4 text-center">
                            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                              <QRCodeSVG
                                value={publicVerificationUrl}
                                size={116}
                                level="M"
                                marginSize={1}
                                aria-label="Código QR de verificación pública"
                              />
                            </div>
                            <p className="text-xs leading-5 text-slate-500">
                              Este QR permite consultar el documento completado y verificar su información pública.
                            </p>
                            <div className="grid w-full grid-cols-[1fr_auto] gap-2">
                              <a
                                href={publicVerificationUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                              >
                                <ExternalLink size={14} />
                                Ver portal público
                              </a>
                              <button
                                type="button"
                                onClick={copyPublicVerificationUrl}
                                title="Copiar enlace público"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                              >
                                {publicUrlCopied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                              </button>
                            </div>
                            {publicUrlCopied && (
                              <span className="text-[11px] font-medium text-emerald-700">Enlace copiado</span>
                            )}
                          </div>
                        </div>
                      )}

                      {document.es_publico && document.estado !== 'completado' && (
                        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-white text-blue-600 ring-1 ring-blue-100">
                              <QrCode size={16} />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Publicación programada</p>
                              <p className="mt-1 text-xs leading-5 text-slate-600">
                                El enlace público y el código QR estarán disponibles cuando el documento quede completado.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── Auditoría ────────────────────────────────────────── */}
                      <div className="rounded-xl border border-border bg-white overflow-hidden">
                        <div className="px-4 py-3 border-b border-border/60">
                          <span className="text-sm font-semibold text-foreground">Auditoría</span>
                        </div>
                        <div className="p-4 flex flex-col gap-3">
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">CREADO POR</p>
                            <p className="text-sm text-foreground">{formatDisplayName(document.owner_nombre)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FECHA Y HORA DE CREACIÓN</p>
                            <p className="text-sm text-foreground">{formatDate(document.created_at)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">MODIFICADO POR</p>
                            <p className="text-sm text-foreground">{formatDisplayName(document.owner_nombre)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FECHA Y HORA DE MODIFICACIÓN</p>
                            <p className="text-sm text-foreground">{formatDate(document.updated_at)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FECHA DE VENCIMIENTO</p>
                            <p className="text-sm text-foreground">{document.vencimiento ? formatDate(document.vencimiento) : 'Sin vencimiento'}</p>
                          </div>
                          {document.fecha_completado && (
                            <div>
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FECHA Y HORA DE FIRMADO POR TODAS LAS PARTES</p>
                              <p className="text-sm text-foreground">{formatDate(document.fecha_completado)}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">ZONA HORARIA</p>
                            <p className="text-sm text-foreground">(UTC-06:00) Hora Estándar Central</p>
                          </div>
                        </div>
                      </div>

                      {/* ── Ubicación ────────────────────────────────────────── */}
                      <div className="rounded-xl border border-border bg-white overflow-hidden">
                        <div className="px-4 py-3 border-b border-border/60">
                          <span className="text-sm font-semibold text-foreground">Ubicación</span>
                        </div>
                        <div className="p-4 flex flex-col gap-3">
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">CARPETA</p>
                            <p className="text-sm text-foreground">{document.carpeta_nombre || 'Documentos Generales'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">ORGANIZACIÓN</p>
                            <p className="text-sm text-foreground">{document.organizacion || 'Mi Organización'}</p>
                          </div>
                        </div>
                      </div>

                      {/* ── Firmantes ────────────────────────────────────────── */}
                      <div className="rounded-xl border border-border bg-white overflow-hidden">
                        <div className="px-4 py-3 border-b border-border/60">
                          <span className="text-sm font-semibold text-foreground">Firmantes ({participantes.length})</span>
                        </div>
                        <div className="p-4">
                          {participantes.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Sin firmantes registrados.</p>
                          ) : (
                            <div className="flex flex-col gap-3">
                              {participantes.map((p, idx) => {
                                const pEstado = participanteEstadoConfig[p.estado?.toLowerCase()] || participanteEstadoConfig['pendiente'];
                                const initials = getInitials(p.nombre || 'U');
                                return (
                                  <div key={p.id} className="rounded-lg border border-border bg-slate-50 p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                                        <span className="text-[10px] font-bold text-blue-600">{initials}</span>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-foreground truncate">{p.nombre}</p>
                                        {p.email && <p className="text-[10px] text-muted-foreground truncate">{p.email}</p>}
                                      </div>
                                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${pEstado.bg} ${pEstado.color} flex-shrink-0`}>
                                        {pEstado.label}
                                      </span>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-1">
                                      <div className="flex gap-2">
                                        <span className="text-[10px] font-semibold text-slate-400 uppercase w-24 flex-shrink-0">Método firma</span>
                                        <span className="text-[10px] text-foreground">{p.metodo_firma || '—'}</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <span className="text-[10px] font-semibold text-slate-400 uppercase w-24 flex-shrink-0">IP firmante</span>
                                        <span className="text-[10px] text-foreground font-mono">{p.ip_address || '—'}</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <span className="text-[10px] font-semibold text-slate-400 uppercase w-24 flex-shrink-0">Lugar firma</span>
                                        <span className="text-[10px] text-foreground">{p.lugar_firma || '—'}</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <span className="text-[10px] font-semibold text-slate-400 uppercase w-24 flex-shrink-0">Fecha firma</span>
                                        <span className="text-[10px] text-foreground">{p.fecha_firma ? formatDate(p.fecha_firma) : '—'}</span>
                                      </div>
                                      {p.motivo_rechazo && (
                                        <div className="flex gap-2">
                                          <span className="text-[10px] font-semibold text-slate-400 uppercase w-24 flex-shrink-0">Motivo rechazo</span>
                                          <span className="text-[10px] text-red-600">{p.motivo_rechazo}</span>
                                        </div>
                                      )}
                                      {p.fecha_rechazo && (
                                        <div className="flex gap-2">
                                          <span className="text-[10px] font-semibold text-slate-400 uppercase w-24 flex-shrink-0">Fecha rechazo</span>
                                          <span className="text-[10px] text-foreground">{formatDate(p.fecha_rechazo)}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Cancelación (condicional) ─────────────────────────── */}
                      {(document.cancelacion_motivo || document.cancelado_at) && (
                        <div className="rounded-xl border border-border bg-white overflow-hidden">
                          <div className="px-4 py-3 border-b border-border/60">
                            <span className="text-sm font-semibold text-foreground">Cancelación</span>
                          </div>
                          <div className="p-4 flex flex-col gap-3">
                            {document.cancelacion_motivo && (
                              <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">MOTIVO DE RECHAZO / CANCELACIÓN</p>
                                <p className="text-sm text-foreground">{document.cancelacion_motivo}</p>
                              </div>
                            )}
                            {document.cancelacion_descripcion && (
                              <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">DESCRIPCIÓN</p>
                                <p className="text-sm text-foreground">{document.cancelacion_descripcion}</p>
                              </div>
                            )}
                            {document.cancelado_at && (
                              <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FECHA Y HORA DE RECHAZO / CANCELACIÓN</p>
                                <p className="text-sm text-foreground">{formatDate(document.cancelado_at)}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ── Seguridad y NOM-151 ──────────────────────────────── */}
                      <div className="rounded-xl border border-border bg-white overflow-hidden">
                        <div className="px-4 py-3 border-b border-border/60">
                          <span className="text-sm font-semibold text-foreground">Seguridad y NOM-151</span>
                        </div>
                        <div className="p-4 flex flex-col gap-3">
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">NOM-151</p>
                              <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded ${document.fecha_constancia && document.fecha_constancia !== 'Pendiente' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                {document.fecha_constancia && document.fecha_constancia !== 'Pendiente' ? 'Sí' : 'No'}
                              </span>
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FECHA CONSTANCIA</p>
                              <p className="text-sm text-foreground">{document.fecha_constancia || 'Pendiente'}</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">IDENTIFICADOR HASH NOM-151</p>
                            <p className="text-xs text-foreground font-mono break-all">{document.hash_sha256 || '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">DATOS DE EMISOR DE CONSTANCIA</p>
                            <p className="text-sm text-foreground">DocuBox TSA Service</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FIRMA COMPLETA</p>
                            <p className="text-sm text-foreground">{document.firma_completa || 'Pendiente'}</p>
                          </div>
                        </div>
                      </div>

                      {/* ── Metadata del Archivo ─────────────────────────────── */}
                      {document.metadata && (
                        <div className="rounded-xl border border-border bg-white overflow-hidden">
                          <div className="px-4 py-3 border-b border-border/60">
                            <span className="text-sm font-semibold text-foreground">Metadata del Archivo</span>
                          </div>
                          <div className="p-4 flex flex-col gap-3">
                            {document.metadata.pdf_author && (
                              <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">AUTOR</p>
                                <p className="text-sm text-foreground">{document.metadata.pdf_author}</p>
                              </div>
                            )}
                            {document.metadata.pdf_creator_software && (
                              <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">SOFTWARE CREADOR</p>
                                <p className="text-sm text-foreground">{document.metadata.pdf_creator_software}</p>
                              </div>
                            )}
                            {document.metadata.pdf_created_at && (
                              <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FECHA CREACIÓN PDF</p>
                                <p className="text-sm text-foreground">{formatDate(document.metadata.pdf_created_at)}</p>
                              </div>
                            )}
                            {document.metadata.pdf_modified_at && (
                              <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FECHA MODIFICACIÓN PDF</p>
                                <p className="text-sm text-foreground">{formatDate(document.metadata.pdf_modified_at)}</p>
                              </div>
                            )}
                            <div className="flex gap-4">
                              <div className="flex-1">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">PDF NATIVO</p>
                                <p className="text-sm text-foreground">{document.metadata.pdf_is_native === true ? 'Sí' : document.metadata.pdf_is_native === false ? 'No (escaneado)' : '—'}</p>
                              </div>
                              <div className="flex-1">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">FIRMAS PREVIAS</p>
                                <p className="text-sm text-foreground">{document.metadata.pdf_has_prior_sigs === true ? 'Sí' : document.metadata.pdf_has_prior_sigs === false ? 'No' : '—'}</p>
                              </div>
                            </div>
                            {document.metadata.pdf_metadata_raw && Object.keys(document.metadata.pdf_metadata_raw).length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">METADATOS ADICIONALES</p>
                                <div className="bg-slate-50 rounded-lg p-2 flex flex-col gap-1">
                                  {Object.entries(document.metadata.pdf_metadata_raw).slice(0, 8).map(([key, val]) => (
                                    <div key={key} className="flex gap-2">
                                      <span className="text-[10px] font-semibold text-slate-400 uppercase w-20 flex-shrink-0 truncate">{key}</span>
                                      <span className="text-[10px] text-foreground break-all">{String(val)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {document.metadata.analyzed_at && (
                              <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">ANALIZADO EL</p>
                                <p className="text-sm text-foreground">{formatDate(document.metadata.analyzed_at)}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                </>
              ) : activeTab === 'participants' ? (
                /* ── Participants Panel ─────────────────────────────────── */
                <>
                  <div className="px-4 py-3 border-b border-border flex-shrink-0">
                    <span className="text-sm font-semibold text-foreground">Participantes</span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {participantes.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-40 gap-2 px-4">
                        <Users size={32} className="text-slate-200" />
                        <p className="text-xs text-muted-foreground text-center">Sin participantes registrados</p>
                      </div>
                    ) : (
                      <div className="p-3 flex flex-col gap-3">
                        {participantes.map((p, idx) => {
                          const { main: mainBadge, sub: subBadge } = getParticipantBadges(p);
                          const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                          const initials = getInitials(p.nombre || 'U');
                          const isFirmante = (p.acto || '').toLowerCase() === 'firmante';
                          return (
                            <div key={p.id} className="bg-white border border-border rounded-xl p-4 shadow-sm">
                              {/* Avatar + Name + Badge */}
                              <div className="flex items-start gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${avatarColor.bg}`}>
                                  <span className={`text-sm font-bold ${avatarColor.text}`}>{initials}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-foreground leading-tight mb-1.5 break-words whitespace-normal">
                                    {p.nombre ? formatDisplayName(p.nombre) : 'Participante'}
                                  </p>
                                  {/* Main estado badge (terminal states) */}
                                  {mainBadge && (
                                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${mainBadge.bg} ${mainBadge.color} ${mainBadge.borderColor}`}>
                                      {mainBadge.icon}
                                      {mainBadge.label}
                                    </span>
                                  )}
                                  {/* Sub-estado badge (in-process states) */}
                                  {subBadge && (
                                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${subBadge.bg} ${subBadge.color} ${subBadge.borderColor}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${subBadge.dot}`} />
                                      {subBadge.label}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {/* Email */}
                              {p.email && (
                                <div className="flex items-center gap-1.5 mt-3">
                                  <Mail size={13} className="text-slate-400 flex-shrink-0" />
                                  <span className="text-xs text-slate-500 truncate">{p.email}</span>
                                </div>
                              )}
                              {/* Rol en el documento */}
                              {p.rolDocumento && (
                                <div className="flex items-center gap-1.5 mt-2">
                                  <Tag size={13} className="text-slate-400 flex-shrink-0" />
                                  <span className="text-xs text-slate-600 font-medium">{p.rolDocumento}</span>
                                </div>
                              )}
                              {/* Acto a realizar */}
                              {p.acto && (
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  <PenLine size={13} className="text-slate-400 flex-shrink-0" />
                                  <span className="text-xs text-slate-600">{p.acto}</span>
                                </div>
                              )}
                              {/* Método de firma — solo si es firmante */}
                              {isFirmante && p.metodo_firma && (
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  <Shield size={13} className="text-slate-400 flex-shrink-0" />
                                  <span className="text-xs text-blue-500 font-medium">{p.metodo_firma}</span>
                                </div>
                              )}
                              {/* Divider + Dates */}
                              <div className="border-t border-slate-100 mt-3 mb-2.5" />
                              {/* Fecha de notificación */}
                              {p.fecha_notificacion && (
                                <div className="flex items-start gap-1.5 mt-1.5">
                                  <Bell size={13} className="text-slate-400 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <span className="text-[10px] font-semibold text-slate-400 uppercase block">Fecha de notificación</span>
                                    <span className="text-xs text-slate-600">{formatDate(p.fecha_notificacion)}</span>
                                  </div>
                                </div>
                              )}
                              {/* Fecha de último recordatorio */}
                              {p.fecha_recordatorio && (
                                <div className="flex items-start gap-1.5 mt-1.5">
                                  <Clock size={13} className="text-slate-400 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <span className="text-[10px] font-semibold text-slate-400 uppercase block">Fecha de último recordatorio</span>
                                    <span className="text-xs text-slate-600">{formatDate(p.fecha_recordatorio)}</span>
                                  </div>
                                </div>
                              )}
                              {/* Fecha de participación */}
                              {p.fecha_participacion && (
                                <div className="flex items-start gap-1.5 mt-1.5">
                                  <CheckCircle2 size={13} className="text-slate-400 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <span className="text-[10px] font-semibold text-slate-400 uppercase block">Fecha de participación</span>
                                    <span className="text-xs text-slate-600">{formatDate(p.fecha_participacion)}</span>
                                  </div>
                                </div>
                              )}
                              {/* Participation response: signature + filled fields */}
                              {(() => {
                                const resp = participationResponses.find(
                                  (r) => r.participante_email === p.email
                                );
                                if (!resp) return null;
                                const hasSignature = resp.firma_data && resp.firma_completada;
                                const hasFields = resp.campos_completados && resp.campos_completados.length > 0;
                                if (!hasSignature && !hasFields) return null;
                                return (
                                  <div className="mt-3 border-t border-slate-100 pt-3">
                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Datos de participación</p>
                                    {hasSignature && (
                                      <div className="mb-2">
                                        <p className="text-[10px] font-medium text-slate-500 mb-1">Firma registrada</p>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={resp.firma_data!}
                                          alt={`Firma de ${p.nombre}`}
                                          className="max-w-full rounded border border-slate-200 bg-white"
                                          style={{ maxHeight: '64px', objectFit: 'contain' }}
                                        />
                                      </div>
                                    )}
                                    {hasFields && (
                                      <div className="flex flex-col gap-1">
                                        {resp.campos_completados.filter((c) => c.value).map((c, ci) => {
                                          const isCheckbox = c.value === 'true' || c.value === 'false';
                                          return (
                                            <div key={ci} className="flex items-start gap-1.5">
                                              <span className="text-[10px] font-medium text-slate-500 shrink-0">{c.label}:</span>
                                              {isCheckbox ? (
                                                <span className="flex items-center gap-1">
                                                  <span
                                                    style={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      width: '13px',
                                                      height: '13px',
                                                      border: `2px solid ${c.value === 'true' ? '#2dd4bf' : '#94a3b8'}`,
                                                      borderRadius: '3px',
                                                      background: c.value === 'true' ? '#2dd4bf' : '#fff',
                                                      flexShrink: 0,
                                                    }}
                                                  >
                                                    {c.value === 'true' && (
                                                      <svg width="8" height="6" viewBox="0 0 9 7" fill="none">
                                                        <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                      </svg>
                                                    )}
                                                  </span>
                                                  <span className="text-[10px] text-slate-700">{c.value === 'true' ? 'Marcado' : 'No marcado'}</span>
                                                </span>
                                              ) : (
                                                <span className="text-[10px] text-slate-700 break-words">{c.value}</span>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {/* Send Reminder button — only for pending/non-terminal participants with email */}
                              {p.email && !['firmo', 'firmado', 'aprobo', 'aprobado', 'rechazo', 'rechazado', 'cancelo', 'cancelado'].includes((p.estado || '').toLowerCase()) && document?.owner_id === user?.id && (() => {
                                const reminderSentToday = !!p.fecha_recordatorio && (() => {
                                  const d = new Date(p.fecha_recordatorio!);
                                  const now = new Date();
                                  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate();
                                })();
                                const isLoading = sendingReminderFor === p.id;
                                const justSent = reminderSentFor.has(p.id);
                                const isDisabled = isLoading || reminderSentToday;
                                return (
                                  <button
                                    onClick={() => handleSendReminder(p)}
                                    disabled={isDisabled}
                                    title={reminderSentToday ? 'Ya se envió un recordatorio hoy. Podrás enviar otro mañana.' : 'Enviar recordatorio por correo'}
                                    className={`mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                                      justSent
                                        ? 'bg-green-50 border-green-200 text-green-600'
                                        : reminderSentToday
                                        ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed' :'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                                  >
                                    {isLoading ? (
                                      <>
                                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                        </svg>
                                        Enviando...
                                      </>
                                    ) : justSent ? (
                                      <>
                                        <CheckCircle2 size={13} />
                                        Recordatorio enviado
                                      </>
                                    ) : reminderSentToday ? (
                                      <>
                                        <Clock size={13} />
                                        Ya enviado hoy
                                      </>
                                    ) : (
                                      <>
                                        <Bell size={13} />
                                        Enviar recordatorio
                                      </>
                                    )}
                                  </button>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : activeTab === 'comments' ? (
                /* ── Chat / Comunicación Panel ──────────────────────────── */
                <>
                  {/* Header with "Comunicación" title + participant avatars */}
                  <div className="px-4 py-3 border-b border-border flex-shrink-0">
                    <div className="mb-2">
                      <span className="text-sm font-semibold text-foreground">Comunicación</span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        PARTICIPANTES ({participantes.length})
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {participantes.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Sin participantes</span>
                      ) : (
                        participantes.map((p, idx) => {
                          const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                          const initials = getInitials(p.nombre || 'U');
                          const isOnline = p.email ? onlineEmails.has(p.email) : false;
                          return (
                            <div key={p.id} className="flex flex-col items-center gap-1" title={`${p.nombre}${isOnline ? ' · Conectado' : ' · Desconectado'}`}>
                              <div className="relative">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${avatarColor.bg}`}>
                                  <span className={`text-xs font-bold ${avatarColor.text}`}>{initials}</span>
                                </div>
                                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${isOnline ? 'bg-green-400' : 'bg-slate-300'}`} />
                              </div>
                              <span className="text-[9px] text-muted-foreground truncate max-w-[36px] text-center leading-tight">
                                {p.nombre.split(' ')[0]}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Messages area */}
                  <div className="flex-1 overflow-y-auto px-3 py-3">
                    {chatLoading ? (
                      <div className="flex items-center justify-center h-24 gap-2">
                        <svg className="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-xs text-muted-foreground">Cargando mensajes...</span>
                      </div>
                    ) : chatMessages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                        <div className="w-10 h-10 rounded-full border-2 border-slate-200 flex items-center justify-center">
                          <MessageSquare size={18} className="text-slate-300" />
                        </div>
                        <p className="text-sm font-medium text-slate-400">No hay mensajes aún.</p>
                        <p className="text-xs text-slate-300">Inicia la conversación</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {chatMessages.map((msg, msgIdx) => {
                          const isMe = msg.sender_id === user?.id;
                          // Find participant index for color
                          const partIdx = participantes.findIndex(
                            (p) => p.id === msg.sender_id || p.email === msg.sender_nombre
                          );
                          const avatarColor = isMe
                            ? { bg: 'bg-blue-600', text: 'text-white' }
                            : AVATAR_COLORS[(partIdx >= 0 ? partIdx : msgIdx) % AVATAR_COLORS.length];
                          const initials = getInitials(msg.sender_nombre || 'U');

                          return (
                            <div key={msg.id} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                              {/* Avatar (only for others) */}
                              {!isMe && (
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${avatarColor.bg}`}>
                                  <span className={`text-[10px] font-bold ${avatarColor.text}`}>{initials}</span>
                                </div>
                              )}
                              <div className={`flex flex-col gap-0.5 max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                                {/* Sender name (only for others) */}
                                {!isMe && (
                                  <span className="text-[10px] font-semibold text-slate-500 px-1">
                                    {msg.sender_nombre}
                                  </span>
                                )}
                                {/* Bubble */}
                                <div className={`px-3 py-2 rounded-2xl text-xs leading-relaxed break-words ${
                                  isMe
                                    ? 'bg-blue-600 text-white rounded-br-sm' :'bg-slate-100 text-foreground rounded-bl-sm'
                                }`}>
                                  {msg.content}
                                </div>
                                {/* Timestamp */}
                                <span className="text-[9px] text-slate-400 px-1">
                                  {formatChatTime(msg.created_at)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={chatEndRef} />
                      </div>
                    )}
                  </div>

                  {/* Input */}
                  <div className="px-3 py-3 border-t border-border flex-shrink-0">
                    {participantes.length <= 1 ? (
                      <div className="flex items-center justify-center gap-2 py-2 px-3 bg-slate-50 border border-border rounded-full text-xs text-muted-foreground">
                        <Users size={13} className="flex-shrink-0" />
                        <span>Se necesitan al menos 2 participantes para chatear</span>
                      </div>
                    ) : (
                    <div className="flex items-center gap-2 bg-slate-50 border border-border rounded-full px-3 py-1.5">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={handleChatKeyDown}
                        placeholder="Escribe un mensaje..."
                        className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                        disabled={chatSending}
                      />
                      <button
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim() || chatSending}
                        className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:bg-primary/90 transition-colors"
                      >
                        {chatSending ? (
                          <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <Send size={13} className="text-white" />
                        )}
                      </button>
                    </div>
                    )}
                  </div>
                </>
              ) : activeTab === 'activity' ? (
                /* Activity History Panel */
                <>
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
                    <div>
                      <span className="text-sm font-semibold text-foreground">Historial de Actividad</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Registro detallado de acciones y eventos.</p>
                    </div>
                    <button
                      onClick={() => {
                        if (!docId || !user) return;
                        setActivityLoading(true);
                        const supabase = createClient();
                        const allEvents: ActivityEvent[] = [];
                        Promise.all([
                          supabase.from('security_audit_log').select('id, action, details, created_at, user_id').eq('documento_id', docId).order('created_at', { ascending: false }),
                          supabase.from('document_audit_trail').select('id, action_code, action_description_es, action_category, action_result, actor_name, actor_email, actor_role, document_status_at_action, ip_address, action_at, metadata_encrypted').eq('document_id', docId).order('action_at', { ascending: false }),
                          supabase.from('document_activity_log').select('id, action, category, details, created_at, actor_id, actor_nombre, actor_email').eq('documento_id', docId).order('created_at', { ascending: false }),
                        ]).then(([secRes, auditRes, actRes]) => {
                          if (secRes.data) secRes.data.forEach((row: any) => allEvents.push({ id: `sec_${row.id}`, action: row.action, details: row.details, created_at: row.created_at, actor_name: 'Sistema', actor_email: '', source: 'security_log', category: row.details?.category as string | undefined }));
                          if (auditRes.data) auditRes.data.forEach((row: any) => { const isDup = allEvents.some((e) => e.action === row.action_code && Math.abs(new Date(e.created_at).getTime() - new Date(row.action_at).getTime()) < 5000); if (!isDup) allEvents.push({ id: `adt_${row.id}`, action: row.action_code, details: { description: row.action_description_es, result: row.action_result, ip_address: row.ip_address, actor_role: row.actor_role, doc_status: row.document_status_at_action }, created_at: row.action_at, actor_name: row.actor_name || 'Sistema', actor_email: row.actor_email || '', source: 'audit_trail', category: row.action_category, doc_state_after: row.document_status_at_action }); });
                          if (actRes.data) actRes.data.forEach((row: any) => allEvents.push({ id: `alog_${row.id}`, action: row.action, category: row.category, details: row.details, created_at: row.created_at, actor_name: row.actor_nombre || 'Usuario', actor_email: row.actor_email || '', source: 'security_log' }));
                          const seen = new Set<string>();
                          const unique = allEvents.filter((e) => { const key = `${e.action}_${e.actor_email}_${new Date(e.created_at).toISOString().slice(0, 16)}`; if (seen.has(key)) return false; seen.add(key); return true; });
                          unique.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                          setActivityEvents(unique);
                        }).finally(() => setActivityLoading(false));
                      }}
                      className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      title="Actualizar historial"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {activityLoading ? (
                      <div className="flex items-center justify-center h-24 gap-2">
                        <svg className="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-xs text-muted-foreground">Cargando actividad...</span>
                      </div>
                    ) : activityEvents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-40 gap-2 px-4">
                        <Activity size={32} className="text-slate-200" />
                        <p className="text-xs text-muted-foreground text-center">Sin actividad registrada</p>
                      </div>
                    ) : (
                      <div className="px-4 py-3">
                        <div className="relative">
                          <div className="absolute left-[17px] top-0 bottom-0 w-px bg-border" />
                          <div className="flex flex-col gap-0">
                            {activityEvents.map((event) => {
                              const colors = getActivityIconColors(event.action, event.category);
                              const label = getActivityLabel(event.action, event);
                              const extraDetails = getActivityDetails(event);
                              const actorDisplay = event.participant_name || event.actor_name;
                              const actorEmail = event.participant_email || event.actor_email;
                              return (
                                <div key={event.id} className="relative flex gap-3 pb-4">
                                  <div className={`relative z-10 w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0 border-2 border-white shadow-sm ${colors.bg} ${colors.text}`}>
                                    {getActivityIcon(event.action, event.category)}
                                  </div>
                                  <div className="flex-1 min-w-0 pt-1">
                                    <p className="text-xs font-semibold text-foreground leading-snug">{label}</p>
                                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                      <span className="text-[10px] text-muted-foreground">{formatActivityDate(event.created_at)}</span>
                                      {actorDisplay && actorDisplay !== 'Sistema' && (
                                        <>
                                          <span className="text-[10px] text-muted-foreground">·</span>
                                          <span className="text-[10px] font-bold text-primary uppercase tracking-wide">{actorDisplay}</span>
                                        </>
                                      )}
                                      {(!actorDisplay || actorDisplay === 'Sistema') && (
                                        <>
                                          <span className="text-[10px] text-muted-foreground">·</span>
                                          <span className="text-[10px] font-medium text-slate-400 uppercase">Sistema</span>
                                        </>
                                      )}
                                    </div>
                                    {(extraDetails || actorEmail) && (
                                      <div className="mt-1.5 rounded-md bg-slate-50 border border-slate-100 px-2.5 py-1.5">
                                        {actorEmail && (
                                          <p className="text-[10px] text-slate-500 leading-relaxed">
                                            <span className="font-medium text-slate-600">Email:</span> {actorEmail}
                                          </p>
                                        )}
                                        {extraDetails && (
                                          <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">{extraDetails}</p>
                                        )}
                                      </div>
                                    )}
                                    {!extraDetails && !actorEmail && (
                                      <div className="mt-1.5 rounded-md bg-slate-50 border border-slate-100 px-2.5 py-1.5">
                                        <p className="text-[10px] text-slate-400 italic">Sin detalles adicionales</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : activeTab === 'descargas' ? (
                /* ── Descargas Panel ────────────────────────────────────── */
                <div className="flex flex-col h-full min-h-0">
                  <div className="px-4 py-3 border-b border-border flex-shrink-0">
                    <span className="text-sm font-semibold text-foreground">Descargas</span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <div className="p-4 space-y-4">

                    {/* ── Constancia de Integridad y Evidencia Digital ── */}
                    <div className="rounded-xl border border-blue-200 bg-white shadow-sm">
                      <div className="px-4 py-3 border-b border-blue-100 flex items-center gap-2 bg-blue-50/60 rounded-t-xl">
                        <Shield size={15} className="text-blue-600" />
                        <span className="text-xs font-bold uppercase tracking-wide text-foreground">Integridad y Evidencia Digital</span>
                        <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          cryptographicCertification?.status === 'COMPLETED'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : cryptographicCertification?.status === 'FAILED'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : certificationProviderChecked && !certificationProviderReady
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-muted text-muted-foreground border-border'
                        }`}>
                          {cryptographicCertification?.status === 'COMPLETED'
                            ? 'Validada'
                            : cryptographicCertification?.status === 'FAILED'
                              ? 'Requiere atención'
                              : cryptographicCertification
                                ? 'Procesando'
                                : !certificationProviderChecked
                                  ? 'Comprobando'
                                  : certificationProviderReady
                                    ? 'Disponible'
                                    : 'Requiere configuración'}
                        </span>
                      </div>
                      <div className="p-4 space-y-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Constancia Técnica de Integridad y Evidencia Digital</p>
                          <p className="text-xs mt-1 text-muted-foreground leading-relaxed">Cadenas canónicas, sellos KMS, estampa RFC 3161, raíz criptográfica y QR de verificación.</p>
                        </div>

                        {cryptographicCertification?.status === 'COMPLETED' ? (
                          <>
                            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Estado</span>
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={13} /> Criptográficamente válida</span>
                              </div>
                              {cryptographicCertification.certificationRootSha256 && (
                                <div>
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Raíz SHA-256</span>
                                  <p className="mt-1 truncate font-mono text-[10px] text-foreground" title={cryptographicCertification.certificationRootSha256}>{cryptographicCertification.certificationRootSha256}</p>
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => downloadCertificationArtifact('certificate')}
                              disabled={certificationDownload !== null}
                              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl bg-primary text-white hover:opacity-90 transition-opacity disabled:opacity-60"
                            >
                              {certificationDownload === 'certificate' ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
                              {certificationDownload === 'certificate' ? 'Descargando…' : 'Descargar constancia PDF'}
                            </button>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={() => downloadCertificationArtifact('package')}
                                disabled={certificationDownload !== null}
                                className="flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold rounded-lg border border-border text-foreground hover:bg-muted/50 disabled:opacity-60"
                              >
                                {certificationDownload === 'package' ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                                Paquete técnico
                              </button>
                              <button
                                onClick={() => downloadCertificationArtifact('certified-pdf')}
                                disabled={certificationDownload !== null}
                                className="flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold rounded-lg border border-border text-foreground hover:bg-muted/50 disabled:opacity-60"
                              >
                                {certificationDownload === 'certified-pdf' ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                                PDF certificado
                              </button>
                            </div>
                          </>
                        ) : !certificationProviderChecked ? (
                          <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs font-semibold text-muted-foreground">
                            <RefreshCw size={14} className="animate-spin" />
                            Comprobando infraestructura criptográfica
                          </div>
                        ) : !certificationProviderReady ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-3 text-amber-900">
                            <p className="text-xs font-semibold">Servicios criptográficos por configurar</p>
                            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
                              {certificationProviderMissing.map((provider) => (
                                <li key={provider} className="flex items-start gap-2">
                                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500" />
                                  <span>{CRYPTOGRAPHIC_PROVIDER_LABELS[provider] || provider}</span>
                                </li>
                              ))}
                            </ul>
                            <p className="mt-2 text-[10px] leading-relaxed text-amber-800">La constancia se habilitará cuando KMS, TSA y PAdES estén conectados y validados.</p>
                          </div>
                        ) : (
                          <button
                            onClick={generateCryptographicCertification}
                            disabled={certificationLoading || document?.estado !== 'completado'}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl bg-primary text-white hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {certificationLoading ? <RefreshCw size={15} className="animate-spin" /> : <Shield size={15} />}
                            {certificationLoading
                              ? 'Certificando…'
                              : cryptographicCertification?.status === 'FAILED'
                                ? 'Reintentar certificación'
                                : 'Generar certificación'}
                          </button>
                        )}

                        {(certificationError || cryptographicCertification?.errorMessage) && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
                            {certificationError || cryptographicCertification?.errorMessage}
                          </div>
                        )}
                        {certificationProviderReady && (
                          <p className="text-[10px] leading-relaxed text-muted-foreground">La constancia sólo se marca como válida cuando KMS, TSA RFC 3161 y PAdES superan su verificación criptográfica.</p>
                        )}
                      </div>
                    </div>

                    {/* ── 1. Constancia General de Firma ── */}
                    <div className="rounded-xl border border-border bg-white shadow-sm">
                      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 bg-muted/30 rounded-t-xl">
                        <span className="text-xs font-bold uppercase tracking-wide text-foreground">Constancia General de Firma</span>
                        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">PDF</span>
                      </div>
                      <div className="p-4">
                        <div className="mb-4">
                          <p className="text-sm font-semibold text-foreground">Constancia General de Firma Electrónica</p>
                          <p className="text-xs mt-1 text-muted-foreground leading-relaxed">Documento compartido entre todas las partes del proceso de firma</p>
                        </div>
                        <button
                          onClick={downloadConstanciaGeneral}
                          disabled={downloadingConstanciaGeneral}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl bg-primary text-white hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {downloadingConstanciaGeneral ? (
                            <RefreshCw size={15} className="animate-spin" />
                          ) : (
                            <Download size={15} />
                          )}
                          {downloadingConstanciaGeneral ? 'Generando…' : 'Descargar PDF'}
                        </button>
                      </div>
                    </div>

                    {/* ── 2. Documento Original ── */}
                    <div className="rounded-xl border border-border bg-white shadow-sm">
                      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 bg-muted/30 rounded-t-xl">
                        <span className="text-xs font-bold uppercase tracking-wide text-foreground">Documento Original</span>
                        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">PDF</span>
                      </div>
                      <div className="p-4">
                        <div className="mb-4">
                          <p className="text-sm font-semibold text-foreground truncate">{document?.nombre || 'Documento'}</p>
                          <p className="text-xs mt-1 text-muted-foreground">Archivo PDF original del documento</p>
                        </div>
                        <button
                          onClick={downloadOriginalDocument}
                          disabled={downloadingOriginal || !document?.file_url}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl border-2 border-border text-foreground hover:bg-muted/50 active:bg-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {downloadingOriginal ? (
                            <RefreshCw size={15} className="animate-spin" />
                          ) : (
                            <Download size={15} />
                          )}
                          {downloadingOriginal ? 'Descargando…' : 'Descargar PDF'}
                        </button>
                      </div>
                    </div>

                    {/* ── 3. Documento Firmado Certificado (PAdES) ── */}
                    <div className="rounded-xl border border-border bg-white shadow-sm">
                      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 bg-muted/30 rounded-t-xl">
                        <span className="text-xs font-bold uppercase tracking-wide text-foreground">Documento Firmado Certificado</span>
                        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">PAdES</span>
                      </div>
                      <div className="p-4">
                        <div className="mb-4">
                          <p className="text-sm font-semibold text-foreground truncate">{document?.nombre || 'Documento'} — Firmado</p>
                          <p className="text-xs mt-1 text-muted-foreground leading-relaxed">PDF con firma criptográfica PAdES, constancia visual y certificado Docubox CA</p>
                        </div>
                        <button
                          onClick={downloadSignedPdf}
                          disabled={downloadingSignedPdf}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl bg-primary text-white hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {downloadingSignedPdf ? (
                            <RefreshCw size={15} className="animate-spin" />
                          ) : (
                            <Download size={15} />
                          )}
                          {downloadingSignedPdf ? 'Descargando…' : 'Descargar PAdES'}
                        </button>
                      </div>
                    </div>

                    {/* ── 4. Constancia NOM-151 ── */}
                    <div className="rounded-xl border border-border bg-white shadow-sm">
                      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 bg-muted/30 rounded-t-xl">
                        <span className="text-xs font-bold uppercase tracking-wide text-foreground">Constancia NOM-151</span>
                        {nom151Data ? (
                          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Emitida</span>
                        ) : nom151Generating ? (
                          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Generando…</span>
                        ) : (
                          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Pendiente</span>
                        )}
                      </div>
                      <div className="p-4">
                        {nom151Data ? (
                          <div className="space-y-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Constancia de Conservación NOM-151</p>
                              <p className="text-xs mt-1 text-muted-foreground">PSC: Nubarium · Secretaría de Economía</p>
                            </div>
                            <div className="rounded-lg p-3 bg-muted/30 border border-border space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Código validación</span>
                                <span className="text-xs font-mono text-foreground truncate max-w-[140px]">{nom151Data.nubarium_codigo_validacion}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fecha emisión</span>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(nom151Data.created_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={downloadNom151InfoPdf}
                              disabled={downloadingNom151Pdf}
                              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl bg-primary text-white hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {downloadingNom151Pdf ? (
                                <RefreshCw size={15} className="animate-spin" />
                              ) : (
                                <Download size={15} />
                              )}
                              {downloadingNom151Pdf ? 'Generando…' : 'Descargar Constancia PDF'}
                            </button>
                            <button
                              onClick={downloadAnsFile}
                              disabled={downloadingAns}
                              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl border-2 border-border text-foreground hover:bg-muted/50 active:bg-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {downloadingAns ? (
                                <RefreshCw size={15} className="animate-spin" />
                              ) : (
                                <Download size={15} />
                              )}
                              {downloadingAns ? 'Descargando…' : 'Descargar .ans (ASN1)'}
                            </button>
                            <a
                              href="https://validatuconstancia.pscworld.com/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl border border-border text-foreground hover:bg-muted/50 transition-colors"
                            >
                              <Shield size={15} />
                              Verificar validez en PSC
                            </a>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-3 py-4">
                            <RefreshCw size={24} className="animate-spin text-muted-foreground" />
                            <p className="text-sm text-center text-muted-foreground">
                              {nom151Generating ? 'Generando constancia NOM-151…' : 'Constancia NOM-151 pendiente de generación automática…'}<br />
                              <span className="text-xs">Se genera automáticamente al completar el documento</span>
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── 5. XML de Evidencia ── */}
                    <div className="rounded-xl border border-border bg-white shadow-sm">
                      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 bg-muted/30 rounded-t-xl">
                        <span className="text-xs font-bold uppercase tracking-wide text-foreground">XML de Evidencia</span>
                        {xmlEvidenceData ? (
                          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">Generado</span>
                        ) : xmlGenerating ? (
                          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Generando…</span>
                        ) : (
                          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Pendiente</span>
                        )}
                      </div>
                      <div className="p-4">
                        {xmlEvidenceData ? (
                          <div className="space-y-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Paquete de Evidencia XMLDSig</p>
                              <p className="text-xs mt-1 text-muted-foreground">Evidencia criptográfica completa del documento</p>
                            </div>
                            <div className="rounded-lg p-3 bg-muted/30 border border-border space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Hash XML</span>
                                <span className="text-xs font-mono text-foreground truncate max-w-[140px]">{xmlEvidenceData.xml_hash_sha256?.slice(0, 16)}…</span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Generado</span>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(xmlEvidenceData.xml_generated_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={downloadXmlEvidence}
                              disabled={downloadingXml}
                              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl bg-primary text-white hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {downloadingXml ? (
                                <RefreshCw size={15} className="animate-spin" />
                              ) : (
                                <Download size={15} />
                              )}
                              {downloadingXml ? 'Descargando…' : 'Descargar XML'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-3 py-4">
                            <RefreshCw size={24} className="animate-spin text-muted-foreground" />
                            <p className="text-sm text-center text-muted-foreground">
                              {xmlGenerating ? 'Generando XML de evidencia…' : 'XML de evidencia pendiente de generación automática…'}<br />
                              <span className="text-xs">Se genera automáticamente al completar el documento</span>
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    </div>
                  </div>
                </div>
              ) : (
                /* Other Panels (fields / vencimientos / editar) */
                <>
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
                    <span className="text-sm font-semibold text-foreground">
                      {activeTab === 'fields' && 'Notas y Comentarios'}
                      {activeTab === 'vencimientos' && 'Vencimientos'}
                      {activeTab === 'editar' && 'Editar Documento'}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {activeTab === 'editar' ? (
                      <div className="flex flex-col gap-4 p-4">
                        {/* Archivo Cargado preview card */}
                        <div className="rounded-xl border border-border bg-white overflow-hidden">
                          <div className="px-4 py-3 border-b border-border/60">
                            <span className="text-sm font-semibold text-foreground">Archivo Cargado</span>
                          </div>
                          <div className="p-4">
                            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                              {/* PDF thumbnail */}
                              <div className="w-16 h-20 flex-shrink-0 rounded border border-border overflow-hidden bg-white">
                                {document?.file_url ? (
                                  <PdfCanvas fileUrl={document.file_url} page={1} zoom={100} onTotalPages={() => {}} style={{ width: '100%', height: '100%' }} />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-slate-50">
                                    <FileText size={24} className="text-slate-300" strokeWidth={1} />
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-foreground truncate">{document?.nombre || 'Documento'}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">{formatSize(document?.file_size)}</p>
                                <p className="text-[10px] text-muted-foreground">{document?.formato || 'PDF'}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Edit actions */}
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => handleOpenEditModal('datos')}
                            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-white hover:bg-muted/50 transition-colors text-sm font-medium text-foreground"
                          >
                            <Edit3 size={15} />
                            Editar datos del documento
                          </button>
                          <button
                            onClick={() => handleOpenEditModal('archivo')}
                            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-white hover:bg-muted/50 transition-colors text-sm font-medium text-foreground"
                          >
                            <Upload size={15} />
                            Reemplazar archivo
                          </button>
                          <button
                            onClick={() => handleOpenEditModal('participantes')}
                            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-white hover:bg-muted/50 transition-colors text-sm font-medium text-foreground"
                          >
                            <Users size={15} />
                            Editar participantes
                          </button>
                          <button
                            onClick={() => handleOpenEditModal('ajustes')}
                            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-white hover:bg-muted/50 transition-colors text-sm font-medium text-foreground"
                          >
                            <StickyNote size={15} />
                            Editar ajustes y campos
                          </button>
                        </div>
                      </div>
                    ) : activeTab === 'vencimientos' ? (
                      <div className="flex flex-col gap-4 p-4">
                        <div className="rounded-xl border border-border bg-white overflow-hidden">
                          <div className="px-4 py-3 border-b border-border/60">
                            <span className="text-sm font-semibold text-foreground">Fecha de Vencimiento</span>
                          </div>
                          <div className="p-4 flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                              <Calendar size={16} className="text-muted-foreground flex-shrink-0" />
                              <span className="text-sm text-foreground">
                                {document?.vencimiento ? formatDate(document.vencimiento) : 'Sin fecha de vencimiento configurada'}
                              </span>
                            </div>
                            {document?.vencimiento && (
                              <div className={`rounded-lg px-3 py-2 text-xs font-medium ${
                                new Date(document.vencimiento) < new Date()
                                  ? 'bg-red-50 text-red-700 border border-red-200' :'bg-green-50 text-green-700 border border-green-200'
                              }`}>
                                {new Date(document.vencimiento) < new Date() ? 'Documento vencido' : 'Documento vigente'}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Notes / fields tab */
                      <div className="flex flex-col h-full">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {notes.length} nota{notes.length !== 1 ? 's' : ''}
                          </span>
                          <button
                            onClick={() => setShowNoteForm((v) => !v)}
                            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                          >
                            <FilePlus size={13} />
                            Nueva nota
                          </button>
                        </div>
                        {showNoteForm && (
                          <div className="px-4 py-3 border-b border-border bg-muted/20 flex-shrink-0">
                            <textarea
                              value={noteContent}
                              onChange={(e) => setNoteContent(e.target.value)}
                              placeholder="Escribe una nota..."
                              rows={3}
                              className="w-full text-xs rounded-lg border border-border bg-white px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <div className="flex items-center justify-between mt-2">
                              <select
                                value={noteVisibilidad}
                                onChange={(e) => setNoteVisibilidad(e.target.value as 'privada' | 'publica')}
                                className="text-xs border border-border rounded-lg px-2 py-1 bg-white"
                              >
                                <option value="publica">Pública</option>
                                <option value="privada">Privada</option>
                              </select>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => { setShowNoteForm(false); setNoteContent(''); }}
                                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                                >
                                  Cancelar
                                </button>
                                <button
                                  onClick={handleSaveNote}
                                  disabled={!noteContent.trim() || noteSaving}
                                  className="flex items-center gap-1 text-xs font-semibold text-white bg-primary px-3 py-1.5 rounded-lg disabled:opacity-60"
                                >
                                  {noteSaving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                                  Guardar
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="flex-1 overflow-y-auto px-4 py-3">
                          {notesLoading ? (
                            <div className="flex items-center justify-center h-24 gap-2">
                              <svg className="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              <span className="text-xs text-muted-foreground">Cargando notas...</span>
                            </div>
                          ) : notes.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 gap-2">
                              <StickyNote size={32} className="text-slate-200" />
                              <p className="text-xs text-muted-foreground text-center">Sin notas registradas</p>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-3">
                              {notes.map((note) => (
                                <div key={note.id} className="rounded-xl border border-border bg-white p-3 shadow-sm">
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-semibold text-foreground">{note.author_nombre}</span>
                                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${note.visibilidad === 'privada' ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600'}`}>
                                        {note.visibilidad === 'privada' ? 'Privada' : 'Pública'}
                                      </span>
                                      {note.tipo !== 'general' && (
                                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${note.tipo === 'rechazo' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                                          {note.tipo === 'rechazo' ? 'Rechazo' : 'Cancelación'}
                                        </span>
                                      )}
                                    </div>
                                    {note.author_id === user?.id && (
                                      <button
                                        onClick={() => handleDeleteNote(note.id)}
                                        className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0"
                                      >
                                        <X size={13} />
                                      </button>
                                    )}
                                  </div>
                                  <p className="text-xs text-foreground leading-relaxed">{note.content}</p>
                                  <p className="text-[10px] text-muted-foreground mt-1.5">{formatNoteDate(note.created_at)}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            )}
          </div>
        </div>

        {/* Fullscreen modal */}
        {showFullscreenModal && document?.file_url && (
          <div className="fixed inset-0 z-50 flex flex-col bg-gray-100">
            <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
              <span className="max-w-md truncate text-sm font-600 text-slate-950">{document.nombre}</span>
              <button
                onClick={() => setShowFullscreenModal(false)}
                className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-sm font-500 text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950"
              >
                <X size={14} />
                Cerrar
              </button>
            </div>
            <div className="relative flex flex-1 items-start justify-center overflow-auto p-6">
              <div className="relative flex-shrink-0 border border-slate-700 bg-white shadow-[0_18px_48px_rgba(0,0,0,0.35)]">
                <PdfCanvas fileUrl={document.file_url} page={currentPage} zoom={zoom} onTotalPages={handleTotalPages} />
                {showCampos && camposEnPaginaActual.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
                    {camposEnPaginaActual.map((campo, idx) => renderCampoOverlay(campo, idx, 'modal'))}
                  </div>
                )}
              </div>
              <PaginationBar modal />
            </div>
          </div>
        )}

        {/* Reject Modal */}
        {showRejectModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
              <div className="p-6">
                <h3 className="text-base font-bold text-foreground mb-1">Rechazar documento</h3>
                <p className="text-sm text-muted-foreground mb-4">Indica el motivo del rechazo</p>
                {!rejectConfirmStep ? (
                  <>
                    <div className="mb-3">
                      <label className="text-xs font-semibold text-foreground mb-1 block">Motivo *</label>
                      <select
                        value={rejectMotivo}
                        onChange={(e) => setRejectMotivo(e.target.value)}
                        className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white"
                      >
                        <option value="">Selecciona un motivo...</option>
                        <option value="Información incorrecta">Información incorrecta</option>
                        <option value="Falta de documentos">Falta de documentos</option>
                        <option value="No autorizado">No autorizado</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="text-xs font-semibold text-foreground mb-1 block">Descripción (opcional)</label>
                      <textarea
                        value={rejectDescripcion}
                        onChange={(e) => setRejectDescripcion(e.target.value)}
                        rows={3}
                        placeholder="Describe el motivo..."
                        className="w-full text-sm border border-border rounded-lg px-3 py-2 resize-none"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setShowRejectModal(false); setRejectMotivo(''); setRejectDescripcion(''); }} className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted">Cancelar</button>
                      <button onClick={() => setRejectConfirmStep(true)} disabled={!rejectMotivo} className="px-4 py-2 text-sm font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50">Continuar</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
                      <p className="text-sm font-semibold text-red-700 mb-1">¿Confirmas el rechazo?</p>
                      <p className="text-xs text-red-600">Motivo: {rejectMotivo}</p>
                      {rejectDescripcion && <p className="text-xs text-red-600 mt-0.5">{rejectDescripcion}</p>}
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setRejectConfirmStep(false)} className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted">Atrás</button>
                      <button onClick={handleReject} disabled={actionLoading} className="px-4 py-2 text-sm font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50">
                        {actionLoading ? 'Procesando...' : 'Confirmar rechazo'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Request Changes Modal */}
        {showChangesModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
              <div className="p-6">
                <h3 className="text-base font-bold text-foreground mb-1">Solicitar cambios</h3>
                <p className="text-sm text-muted-foreground mb-4">Indica qué cambios necesitas</p>
                <div className="mb-3">
                  <label className="text-xs font-semibold text-foreground mb-1 block">Tipo de solicitud</label>
                  <select
                    value={changesTipo}
                    onChange={(e) => setChangesTipo(e.target.value)}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white"
                  >
                    <option value="Solicitud de Cambios en el Documento">Solicitud de Cambios en el Documento</option>
                    <option value="Información Adicional Requerida">Información Adicional Requerida</option>
                    <option value="Corrección de Errores">Corrección de Errores</option>
                  </select>
                </div>
                <div className="mb-4">
                  <label className="text-xs font-semibold text-foreground mb-1 block">Comentario *</label>
                  <textarea
                    value={changesComment}
                    onChange={(e) => setChangesComment(e.target.value)}
                    rows={3}
                    placeholder="Describe los cambios requeridos..."
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 resize-none"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setShowChangesModal(false); setChangesComment(''); }} className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted">Cancelar</button>
                  <button onClick={handleRequestChanges} disabled={!changesComment.trim() || actionLoading} className="px-4 py-2 text-sm font-semibold text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50">
                    {actionLoading ? 'Enviando...' : 'Enviar solicitud'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cancel Document Modal */}
        {showCancelDocModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
              <div className="p-6">
                <h3 className="text-base font-bold text-foreground mb-1">Cancelar documento</h3>
                <p className="text-sm text-muted-foreground mb-4">Esta acción cancelará el proceso de firma</p>
                {!cancelConfirmStep ? (
                  <>
                    <div className="mb-3">
                      <label className="text-xs font-semibold text-foreground mb-1 block">Motivo *</label>
                      <select
                        value={cancelMotivo}
                        onChange={(e) => setCancelMotivo(e.target.value)}
                        className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white"
                      >
                        <option value="">Selecciona un motivo...</option>
                        <option value="Documento incorrecto">Documento incorrecto</option>
                        <option value="Proceso cancelado">Proceso cancelado</option>
                        <option value="Error en participantes">Error en participantes</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="text-xs font-semibold text-foreground mb-1 block">Descripción (opcional)</label>
                      <textarea
                        value={cancelDescripcion}
                        onChange={(e) => setCancelDescripcion(e.target.value)}
                        rows={3}
                        placeholder="Describe el motivo..."
                        className="w-full text-sm border border-border rounded-lg px-3 py-2 resize-none"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setShowCancelDocModal(false); setCancelMotivo(''); setCancelDescripcion(''); }} className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted">Cancelar</button>
                      <button onClick={() => setCancelConfirmStep(true)} disabled={!cancelMotivo} className="px-4 py-2 text-sm font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50">Continuar</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
                      <p className="text-sm font-semibold text-red-700 mb-1">¿Confirmas la cancelación?</p>
                      <p className="text-xs text-red-600">Motivo: {cancelMotivo}</p>
                      {cancelDescripcion && <p className="text-xs text-red-600 mt-0.5">{cancelDescripcion}</p>}
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setCancelConfirmStep(false)} className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted">Atrás</button>
                      <button onClick={handleCancelDocument} disabled={actionLoading} className="px-4 py-2 text-sm font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50">
                        {actionLoading ? 'Procesando...' : 'Confirmar cancelación'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Edit Modals */}
        {editModal === 'datos' && (
          <EditModal title="Editar datos del documento" onClose={() => setEditModal(null)} onSave={handleSaveDocumentData} saving={editSaving}>
            <div className="p-6">
              <StepSubir
                file={editFile}
                onFileChange={setEditFile}
                docConfig={editDocConfig}
                onDocConfigChange={setEditDocConfig}
                hideFileUpload
              />
            </div>
          </EditModal>
        )}
        {editModal === 'archivo' && (
          <EditModal title="Reemplazar archivo" onClose={() => setEditModal(null)} onSave={handleSaveFile} saving={editSaving}>
            <div className="p-6">
              <StepSubir
                file={editFile}
                onFileChange={setEditFile}
                docConfig={editDocConfig}
                onDocConfigChange={setEditDocConfig}
              />
            </div>
          </EditModal>
        )}
        {editModal === 'participantes' && (
          <EditModal title="Editar participantes" onClose={() => setEditModal(null)} onSave={handleSaveParticipants} saving={editSaving}>
            <div className="p-6">
              <StepParticipantes
                participants={editParticipants}
                onParticipantsChange={setEditParticipants}
                participantMode={editParticipantMode}
                onParticipantModeChange={setEditParticipantMode}
                participationOrder={editParticipationOrder}
                onParticipationOrderChange={setEditParticipationOrder}
              />
            </div>
          </EditModal>
        )}
        {editModal === 'ajustes' && (
          <EditModal title="Editar ajustes y campos" onClose={() => setEditModal(null)} onSave={handleSaveSettings} saving={editSaving}>
            <div className="p-6">
              <StepAjustes
                settings={editSettings}
                onSettingsChange={setEditSettings}
                participants={editParticipants}
                placedFields={editPlacedFields}
                onPlacedFieldsChange={setEditPlacedFields}
                fileUrl={document?.file_url}
                securitySettings={editSecuritySettings}
                onSecuritySettingsChange={setEditSecuritySettings}
              />
            </div>
          </EditModal>
        )}

      </div>
    </AppLayout>
  );
}
