'use client';

import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Users, Info, Edit3, Folder, Clock, Lock, CheckCircle2, AlertTriangle, Mail, Phone, Bell, ShieldCheck, LayoutGrid, GitBranch, Shield } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { PDFDocument } from 'pdf-lib';
import type { Participant, DocumentSettings, DocumentConfig, PlacedField, GrupoFirma } from './types';
import type { PreProcessedFile } from '../page';
import { createNotification } from '@/lib/notificationsInApp';

async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateDocumentoId(): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `DOC-${year}-${rand}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeFileName(name: string): string {
  // Normalize unicode (e.g. é → e), then replace any character that is not
  // alphanumeric, dash, underscore or dot with an underscore.
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-zA-Z0-9.\-_]/g, '_'); // replace unsafe chars
}

function getNotifLabel(id: string): string {
  const map: Record<string, string> = { docubox: 'Docubox', correo: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };
  return map[id] || id;
}

function getFirmaLabel(id: string): string {
  const map: Record<string, string> = { autografa: 'Firma Autógrafa', efirma: 'e-Firma SAT', biometria: 'Biometría' };
  return map[id] || id;
}

interface SecuritySummary {
  vencimientoEnabled: boolean;
  fechaVencimiento: string;
  codigoAccesoEnabled: boolean;
  proteccionAdicionalEnabled: boolean;
  legalHoldEnabled: boolean;
}

export interface StepEnviarHandle {
  handleEnviar: () => Promise<void>;
  sending: boolean;
}

// ─── CAPA 1: Validación MIME por magic bytes (cliente) ───────────────────────
async function validateMimeByMagicBytes(file: File): Promise<string | null> {
  const slice = file.slice(0, 8);
  const buffer = await slice.arrayBuffer();
  const b = new Uint8Array(buffer);
  // PDF: %PDF
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  // DOCX / XLSX (ZIP internamente)
  if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return 'application/vnd.openxmlformats';
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  // JPG
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  return null;
}

const ALLOWED_MIME_TYPES = ['application/pdf', 'application/vnd.openxmlformats', 'image/png', 'image/jpeg'];
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

// ─── CAPA 2: Sanitización PDF con pdf-lib (cliente) ──────────────────────────
async function sanitizePDFClient(file: File): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const catalog = (pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Root) as any);
  if (catalog) {
    try { catalog.delete('JavaScript'); } catch { /* ignore */ }
    try { catalog.delete('JS'); } catch { /* ignore */ }
    try { catalog.delete('OpenAction'); } catch { /* ignore */ }
    try { catalog.delete('AA'); } catch { /* ignore */ }
  }
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('');
  pdfDoc.setCreator('');
  return await pdfDoc.save();
}

export const StepEnviar = forwardRef<StepEnviarHandle, {
  file: File | null;
  participants: Participant[];
  settings: DocumentSettings;
  docConfig: DocumentConfig;
  onGoToStep: (step: number) => void;
  placedFields?: PlacedField[];
  documentoId?: string;
  securitySettings?: SecuritySummary;
  grupos?: GrupoFirma[];
  participationOrder?: string;
  participantMode?: import('./types').ParticipantMode;
  /** Resultado del pipeline de seguridad pre-ejecutado desde el paso Participantes */
  preProcessedFile?: PreProcessedFile | null;
  /** Metadata extraída del PDF en el paso Subir */
  pdfMetadata?: { pageCount: number; title?: string; author?: string; creationDate?: string } | null;
}>(function StepEnviar(
  {
    file,
    participants,
    settings,
    docConfig,
    onGoToStep,
    placedFields,
    documentoId,
    securitySettings,
    grupos,
    participationOrder,
    participantMode,
    preProcessedFile,
    pdfMetadata,
  },
  ref
) {
  const router = useRouter();
  const supabase = createClient();
  const { activeWorkspace } = useWorkspace();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [carpetaNombre, setCarpetaNombre] = useState<string>('Carpeta Principal');
  const [localSecurity, setLocalSecurity] = useState<SecuritySummary | undefined>(undefined);
  const [scanState, setScanState] = useState<'idle' | 'uploading' | 'success' | 'error_tipo' | 'error_grande' | 'error_infected' | 'error_invalido' | 'error_red'>('idle');

  // Load security settings from Supabase
  useEffect(() => {
    if (!documentoId || securitySettings) return;
    const loadSecurity = async () => {
      try {
        const { data } = await supabase.from('document_security_settings').select('*').eq('documento_id', documentoId).maybeSingle();
        if (data) {
          setLocalSecurity({
            vencimientoEnabled: data.vencimiento_enabled ?? false,
            fechaVencimiento: data.fecha_vencimiento ?? '',
            codigoAccesoEnabled: data.codigo_acceso_enabled ?? false,
            proteccionAdicionalEnabled: data.proteccion_adicional_enabled ?? false,
            legalHoldEnabled: data.legal_hold_enabled ?? false,
          });
        }
      } catch { /* silent */ }
    };
    loadSecurity();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentoId]);

  const effectiveSecurity = securitySettings ?? localSecurity;

  // Load folder name if ruta is a UUID
  useEffect(() => {
    const loadCarpeta = async () => {
      if (!docConfig.ruta || docConfig.ruta === 'raiz') {
        setCarpetaNombre('Carpeta Principal');
        return;
      }
      try {
        const { data } = await supabase.from('carpetas').select('nombre').eq('id', docConfig.ruta).maybeSingle();
        if (data?.nombre) setCarpetaNombre(data.nombre);
        else setCarpetaNombre('Carpeta Principal');
      } catch { setCarpetaNombre('Carpeta Principal'); }
    };
    loadCarpeta();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docConfig.ruta]);

  // Countdown after send
  useEffect(() => {
    if (!sent) return;
    if (countdown <= 0) { router.push('/documents-dashboard'); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [sent, countdown, router]);

  const handleEnviar = async () => {
    if (!file) return;
    setSending(true);
    setSendError(null);
    setScanState('uploading');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No autenticado');

      // ─── Validación y preparación del archivo ────────────────────────────
      let uploadBlob: Blob;
      let uploadContentType: string;
      let detectedMime: string | null;

      if (preProcessedFile && preProcessedFile.status !== 'ready') {
        if (preProcessedFile.status === 'error_grande') { setScanState('error_grande'); throw new Error('El archivo supera el límite de 50MB.'); }
        if (preProcessedFile.status === 'error_tipo') { setScanState('error_tipo'); throw new Error('Tipo de archivo no permitido. Solo se aceptan PDF, Word, Excel, PNG y JPG.'); }
        if (preProcessedFile.status === 'error_invalido') { setScanState('error_invalido'); throw new Error('El PDF está dañado o no es válido.'); }
      }

      if (preProcessedFile && preProcessedFile.status === 'ready') {
        console.log('[DOCUBOX][security] Usando pipeline pre-ejecutado (sin reprocesar)');
        detectedMime = preProcessedFile.mime;
        uploadContentType = preProcessedFile.mime === 'application/pdf' ? 'application/pdf' : (file.type || 'application/octet-stream');
        uploadBlob = new Blob([preProcessedFile.bytes], { type: uploadContentType });
      } else {
        console.log('[DOCUBOX][security] Pre-procesamiento no disponible, ejecutando pipeline ahora');
        if (file.size > MAX_FILE_SIZE_BYTES) { setScanState('error_grande'); throw new Error('El archivo supera el límite de 50MB.'); }
        detectedMime = await validateMimeByMagicBytes(file);
        if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime)) { setScanState('error_tipo'); throw new Error('Tipo de archivo no permitido. Solo se aceptan PDF, Word, Excel, PNG y JPG.'); }
        uploadContentType = file.type || 'application/octet-stream';
        if (detectedMime === 'application/pdf') {
          try {
            const sanitizedBytes = await sanitizePDFClient(file);
            uploadBlob = new Blob([sanitizedBytes], { type: 'application/pdf' });
            uploadContentType = 'application/pdf';
          } catch {
            setScanState('error_invalido');
            throw new Error('El PDF está dañado o no es válido.');
          }
        } else {
          uploadBlob = file;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const hash = await computeSHA256(file);
      const docId = documentoId || generateDocumentoId();
      const workspaceId = activeWorkspace?.id || null;

      const participantesData = participants.map((p) => {
        // Determine if this participant is a registered platform user
        // Platform users have their Supabase user ID as p.id (UUID format, not 'current-user' or 'contact-*')
        const isRegisteredUser = p.id && p.id !== 'current-user' && !p.id.startsWith('contact-') && !p.id.startsWith('invited-');
        return {
          id: p.id,
          // Store user_id for registered platform users so they can find their documents
          user_id: isRegisteredUser ? p.id : null,
          name: p.name,
          email: p.email,
          phone: p.phone || null,
          acto: p.acto || null,
          rolDocumento: p.rolDocumento || null,
          tipoFirma: p.tipoFirma || [],
          tipoNotificacion: p.tipoNotificacion || [],
          isCurrentUser: p.id === 'current-user',
        };
      });

      const camposSolicitados = placedFields ? placedFields.map((f) => {
        const tipoMap: Record<string, string> = {
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
        return {
          id: f.id,
          tipo: (f as any).tipo || tipoMap[f.label] || 'texto',
          label: f.label,
          participantId: f.participantId || null,
          participantName: f.participantName || null,
          page: f.page || 1,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          colorHex: f.colorHex || null,
          dropdownOptions: f.dropdownOptions || null,
          radioOptions: f.radioOptions || null,
          casillaLabel: f.casillaLabel || null,
          fieldConfig: f.fieldConfig || null,
          fieldTypeConfig: f.fieldTypeConfig || null,
        };
      }) : [];

      // Enviar archivo + metadata al servidor (usa service role — bypasa RLS y storage policies)
      const uploadFormData = new FormData();
      uploadFormData.append('file', new File([uploadBlob], sanitizeFileName(file.name), { type: uploadContentType }));
      uploadFormData.append('meta', JSON.stringify({
        documentoId: docId,
        fileName: sanitizeFileName(file.name),
        fileSize: file.size,
        fileType: uploadContentType,
        fileHashSha256: hash,
        nombre: docConfig.nombre || file.name.replace(/\.[^/.]+$/, ''),
        descripcion: docConfig.descripcion || null,
        numeroOficio: docConfig.numeroOficio || null,
        grupotipoId: docConfig.grupotipoId || null,
        tipoDocumentoId: docConfig.tipoDocumentoId || null,
        otroTipoDocumento: docConfig.tipoDocumentoId === '__otros__' ? (docConfig.otroTipoDocumento || null) : null,
        ruta: docConfig.ruta || 'raiz',
        etiquetasIds: docConfig.etiquetasIds || [],
        participantes: participantesData,
        camposSolicitados,
        workspaceId,
        participationOrder: participationOrder || 'paralelo',
        gruposFirma: grupos || [],
      }));

      const enviarRes = await fetch('/api/documentos/enviar', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: uploadFormData,
      });

      if (!enviarRes.ok) {
        const enviarJson = await enviarRes.json().catch(() => ({}));
        setScanState('error_red');
        throw new Error(enviarJson.error || 'Error al guardar el documento');
      }

      const { dbDocumentId } = await enviarRes.json();

      setScanState('success');

      // ── Insertar notificación in-app para el dueño del documento ─────────
      try {
        const docName = docConfig.nombre || file?.name.replace(/\.[^/.]+$/, '') || 'Documento';
        await createNotification({
          userId: user.id,
          type: 'document',
          title: 'Documento enviado exitosamente',
          description: `El documento "${docName}" fue enviado a ${participants.length} participante${participants.length !== 1 ? 's' : ''} para su firma.`,
          priority: 'media',
          metadata: { documentoId: dbDocumentId, docName },
        });
      } catch {
        // Non-blocking
      }

      // ── Guardar metadatos del documento (no bloqueante) ───────────────────
      try {
        await fetch('/api/documentos/metadata', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            documentos_id: dbDocumentId,
            file_name: file.name,
            file_size: file.size,
            mime_type: detectedMime || file.type || 'application/octet-stream',
            page_count: pdfMetadata?.pageCount ?? null,
            pdf_title: pdfMetadata?.title ?? null,
            pdf_author: pdfMetadata?.author ?? null,
            pdf_creation_date: pdfMetadata?.creationDate ?? null,
          }),
        });
      } catch {
        // Silently ignore metadata errors — upload is already saved
      }

      // Guardar participantes como contactos si aplica
      const contactsToSave = participants.filter((p) => p.savedAsContact && p.id !== 'current-user');
      if (contactsToSave.length > 0) {
        const contactRows = contactsToSave.map((p) => {
          const nameParts = (p.name || '').trim().split(' ');
          return {
            user_id: user.id,
            nombre: nameParts[0] || p.name,
            apellido_paterno: nameParts[1] || null,
            apellido_materno: nameParts.slice(2).join(' ') || null,
            email: p.email || null,
            telefono: p.phone || null,
          };
        });
        await supabase.from('contacts').upsert(contactRows, { onConflict: 'user_id,email' });
      }

      setSent(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al enviar el documento';
      setSendError(msg);
      if (scanState === 'uploading') setScanState('error_red');
    } finally {
      setSending(false);
    }
  };

  // Expose handleEnviar and sending state to parent via ref
  useImperativeHandle(ref, () => ({
    handleEnviar,
    sending,
  }));

  // ── Success screen ──────────────────────────────────────────────────────────
  if (sent) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-600">
        <div className="flex flex-col items-center w-full max-w-md px-4 text-center">
          <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center mb-6 shadow-lg">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">¡Documento enviado!</h1>
          <p className="text-white/90 text-base mb-8 leading-relaxed">Tu documento ha sido enviado exitosamente a todos los participantes.</p>
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 w-full flex items-center justify-between">
            <p className="text-sm text-gray-500">Redireccionando en <span className="font-bold text-emerald-600">{countdown}</span> segundo{countdown !== 1 ? 's' : ''}...</p>
            <button onClick={() => router.push('/documents-dashboard')} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
              Ir al Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Summary screen ──────────────────────────────────────────────────────────
  const vencimientoLabel = effectiveSecurity?.vencimientoEnabled && effectiveSecurity.fechaVencimiento
    ? new Date(effectiveSecurity.fechaVencimiento).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
    : 'Sin fecha límite';

  const securityLabel = (() => {
    if (!effectiveSecurity) return 'Configuración estándar';
    const flags = [];
    if (effectiveSecurity.codigoAccesoEnabled) flags.push('Código de acceso');
    if (effectiveSecurity.proteccionAdicionalEnabled) flags.push('Protección adicional');
    if (effectiveSecurity.legalHoldEnabled) flags.push('Legal Hold');
    return flags.length > 0 ? flags.join(', ') : 'Configuración estándar';
  })();

  // Participation type label
  const participationTypeLabel = (() => {
    if (participantMode === 'solo_yo') return 'Solo yo';
    if (participantMode === 'yo_y_otros') return 'Yo y otros';
    if (participantMode === 'solo_otros') return 'Solo otros';
    return '—';
  })();

  // Group placed fields by participant
  const fieldsByParticipant: Record<string, { name: string; fields: string[] }> = {};
  if (placedFields && placedFields.length > 0) {
    placedFields.forEach((f) => {
      const pid = f.participantId || 'sin-asignar';
      if (!fieldsByParticipant[pid]) {
        fieldsByParticipant[pid] = { name: f.participantName || 'Sin asignar', fields: [] };
      }
      if (!fieldsByParticipant[pid].fields.includes(f.label)) {
        fieldsByParticipant[pid].fields.push(f.label);
      }
    });
  }

  return (
    <div className="max-w-3xl mx-auto w-full pb-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={28} className="text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">¡Documento listo para enviar!</h1>
        <p className="text-gray-500 text-sm">Revisa los detalles finales antes de iniciar el proceso de participación.</p>
      </div>

      {sendError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{sendError}</p>
        </div>
      )}

      {/* Scan state messages */}
      {scanState === 'uploading' && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <svg className="animate-spin h-4 w-4 text-blue-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          <p className="text-sm text-blue-700 font-medium">Verificando seguridad del documento... (puede tardar entre 5 y 30 segundos)</p>
        </div>
      )}
      {scanState === 'error_tipo' && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <Shield size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">Tipo de archivo no permitido. Solo se aceptan PDF, Word, Excel, PNG y JPG.</p>
        </div>
      )}
      {scanState === 'error_grande' && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">El archivo supera el límite de 50MB.</p>
        </div>
      )}
      {scanState === 'error_infected' && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <Shield size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">Documento bloqueado por seguridad. Se detectó una amenaza. Si crees que es un error contacta a soporte.</p>
        </div>
      )}
      {scanState === 'error_invalido' && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">El PDF está dañado o no es válido.</p>
        </div>
      )}
      {scanState === 'error_red' && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">Error de conexión. Intenta de nuevo.</p>
        </div>
      )}
      {scanState === 'success' && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
          <p className="text-sm text-emerald-700 font-medium">Documento subido correctamente y verificado.</p>
        </div>
      )}

      {/* Resumen del Documento */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-primary" />
            <h2 className="text-base font-bold text-gray-900">Resumen del Documento</h2>
          </div>
          <button onClick={() => onGoToStep(1)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-primary hover:bg-primary/5 transition-colors" title="Editar">
            <Edit3 size={15} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          <div className="flex items-start gap-3">
            <FileText size={16} className="text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Nombre y Archivo</p>
              <p className="text-sm font-bold text-gray-900">{docConfig.nombre || (file?.name.replace(/\.[^/.]+$/, '') ?? '—')}</p>
              {file && <p className="text-xs text-primary mt-0.5">{file.name} ({formatFileSize(file.size)})</p>}
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Clock size={16} className="text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Configuración de Retención</p>
              <p className="text-sm font-semibold text-gray-900">Vencimiento: <span className={effectiveSecurity?.vencimientoEnabled ? 'text-gray-900' : 'text-red-500'}>{vencimientoLabel}</span></p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Folder size={16} className="text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Ubicación de Guardado</p>
              <p className="text-sm font-bold text-gray-900">{carpetaNombre}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Lock size={16} className="text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Seguridad y Legal</p>
              <p className="text-sm text-gray-700">{securityLabel}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Users size={16} className="text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Tipo de Participación</p>
              <p className="text-sm font-semibold text-gray-900">{participationTypeLabel}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Participantes */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-primary" />
            <h2 className="text-base font-bold text-gray-900">Participantes</h2>
          </div>
          <button onClick={() => onGoToStep(2)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-primary hover:bg-primary/5 transition-colors" title="Editar">
            <Edit3 size={15} />
          </button>
        </div>
        <p className="text-xs text-primary mb-4">Lista de personas involucradas en el proceso</p>
        <div className="space-y-3">
          {participants.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No hay participantes configurados.</p>
          ) : (
            participants.map((p, idx) => {
              const initials = (p.name || '?').charAt(0).toUpperCase();
              const colors = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];
              const colorClass = colors[idx % colors.length];
              return (
                <div key={p.id} className="border border-gray-200 rounded-xl p-4 flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${colorClass}`}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{p.name}</p>
                    <p className="text-xs text-primary">{p.rolDocumento || 'Participante'}</p>
                    <p className="text-xs text-gray-400">{p.email}</p>
                    {/* Registered / unregistered badge */}
                    <span className={`inline-flex items-center gap-1 mt-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${p.isNewUser ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {p.isNewUser ? (
                        <>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                          Participante no registrado
                        </>
                      ) : (
                        <>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          Participante registrado
                        </>
                      )}
                    </span>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    {p.acto && (
                      <div>
                        <p className="text-xs text-gray-400">Acto / Rol</p>
                        <p className="text-sm font-semibold text-gray-800">{p.acto}</p>
                      </div>
                    )}
                    {p.tipoFirma && p.tipoFirma.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-400">Método de Participación</p>
                        <div className="flex items-center gap-1 justify-end">
                          <ShieldCheck size={13} className="text-primary" />
                          <p className="text-xs font-medium text-gray-700">{p.tipoFirma.map(getFirmaLabel).join(', ')}</p>
                        </div>
                      </div>
                    )}
                    {p.tipoNotificacion && p.tipoNotificacion.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-400">Notificaciones</p>
                        <div className="flex items-center gap-1 justify-end flex-wrap">
                          {p.tipoNotificacion.map((n) => (
                            <span key={n} className="flex items-center gap-0.5 text-xs text-primary">
                              {n === 'correo' || n === 'email' ? <Mail size={11} /> : n === 'sms' ? <Phone size={11} /> : <Bell size={11} />}
                              {getNotifLabel(n)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Información Solicitada — only visible when there is content */}
      {(
        Object.keys(fieldsByParticipant).length > 0 ||
        (participationOrder === 'mixto' && grupos && grupos.length > 0) ||
        participationOrder === 'condicional'
      ) && (
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Info size={18} className="text-primary" />
            <h2 className="text-base font-bold text-gray-900">Información solicitada</h2>
          </div>
          <button onClick={() => onGoToStep(3)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-primary hover:bg-primary/5 transition-colors" title="Editar">
            <Edit3 size={15} />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">Campos requeridos para cada participante</p>

        {/* Agrupamiento (Mixto) */}
        {participationOrder === 'mixto' && grupos && grupos.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <LayoutGrid size={15} className="text-primary" />
              <p className="text-sm font-semibold text-gray-800">Agrupamiento de participantes</p>
            </div>
            <div className="space-y-2">
              {grupos.map((grupo, idx) => {
                const grupoParticipants = participants.filter((p) => grupo.participantIds.includes(p.id));
                return (
                  <div key={grupo.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                      <p className="text-sm font-semibold text-gray-900">{grupo.nombre}</p>
                      <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${grupo.tipo === 'paralelo' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>
                        {grupo.tipo === 'paralelo' ? 'Paralelo' : 'Secuencial'}
                      </span>
                    </div>
                    {grupoParticipants.length > 0 ? (
                      <ul className="space-y-1 ml-7">
                        {grupoParticipants.map((p) => (
                          <li key={p.id} className="flex items-center gap-2 text-xs text-gray-600">
                            <div className="w-3 h-3 rounded-full border border-gray-300 flex items-center justify-center shrink-0">
                              <div className="w-1 h-1 rounded-full bg-gray-400" />
                            </div>
                            <span className="font-medium">{p.name}</span>
                            {p.acto && <span className="text-gray-400">· {p.acto}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-gray-400 ml-7">Sin participantes asignados</p>
                    )}
                    {grupo.mensaje && (
                      <p className="text-xs text-gray-500 mt-2 ml-7 italic">"{grupo.mensaje}"</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-gray-100 mt-4 pt-4" />
          </div>
        )}

        {/* Flujo de Trabajo (Condicional) */}
        {participationOrder === 'condicional' && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <GitBranch size={15} className="text-primary" />
              <p className="text-sm font-semibold text-gray-800">Flujo de trabajo condicional</p>
            </div>
            <div className="border border-blue-100 bg-blue-50 rounded-lg p-3">
              <p className="text-xs text-blue-700 mb-2 font-medium">Participantes en el flujo:</p>
              <ul className="space-y-1.5">
                {participants.map((p, idx) => (
                  <li key={p.id} className="flex items-center gap-2 text-xs text-gray-700">
                    <span className="w-4 h-4 rounded-full bg-blue-200 text-blue-800 text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                    <span className="font-medium">{p.name}</span>
                    {p.acto && <span className="text-gray-400">· {p.acto}</span>}
                    {p.rolDocumento && <span className="text-gray-400">· {p.rolDocumento}</span>}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-blue-600 mt-2">Las condiciones y acciones del flujo se ejecutarán según la configuración definida en el paso anterior.</p>
            </div>
            <div className="border-t border-gray-100 mt-4 pt-4" />
          </div>
        )}

        {Object.keys(fieldsByParticipant).length === 0 ? (
          null
        ) : (
          <div className="space-y-3">
            {Object.entries(fieldsByParticipant).map(([pid, data], idx) => {
              const participantName = data.name;
              const participantFields = data.fields;
              const initials = (participantName || '?').charAt(0).toUpperCase();
              const colors = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];
              const colorClass = colors[idx % colors.length];
              return (
                <div key={pid} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 ${colorClass}`}>
                      {initials}
                    </div>
                    <p className="text-sm font-bold text-gray-900">{participantName}</p>
                  </div>
                  <ul className="space-y-1.5">
                    {participantFields.map((label) => (
                      <li key={label} className="flex items-center gap-2 text-sm text-gray-600">
                        <div className="w-4 h-4 rounded-full border border-gray-300 flex items-center justify-center shrink-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                        </div>
                        {label}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
});
