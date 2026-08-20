'use client';

import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { FileText, Users, Edit3, Folder, Clock, Lock, CheckCircle2, AlertTriangle, Mail, Phone, Bell, ShieldCheck, LayoutGrid, GitBranch, Shield, Globe2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { PDFDocument } from 'pdf-lib';
import type { Participant, DocumentSettings, DocumentConfig, PlacedField, GrupoFirma, SecuritySettings, DocuboxSourceSelection } from './types';
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
  securitySettings?: SecuritySettings;
  grupos?: GrupoFirma[];
  participationOrder?: string;
  participantMode?: import('./types').ParticipantMode;
  /** Resultado del pipeline de seguridad pre-ejecutado desde el paso Participantes */
  preProcessedFile?: PreProcessedFile | null;
  /** Metadata extraída del PDF en el paso Subir */
  pdfMetadata?: { pageCount: number; title?: string; author?: string; creationDate?: string } | null;
  /** Version exacta elegida desde el repositorio interno de Docubox. */
  docuboxSource?: DocuboxSourceSelection | null;
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
    docuboxSource,
  },
  ref
) {
  const supabase = createClient();
  const { activeWorkspace } = useWorkspace();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [carpetaNombre, setCarpetaNombre] = useState<string>('Carpeta Principal');
  const [localSecurity, setLocalSecurity] = useState<SecuritySettings | undefined>(undefined);
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
            impedirImpresion: data.impedir_impresion ?? false,
            evitarCopiaTexto: data.evitar_copia_texto ?? false,
            impedirModificacion: data.impedir_modificacion ?? false,
            impedirExtraccion: data.impedir_extraccion ?? false,
            evitarMontaje: data.evitar_montaje ?? false,
            recordatorioFrecuencia: data.recordatorio_frecuencia ?? '',
            codigoAcceso: '',
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
    if (countdown <= 0) {
      window.location.replace('/mis-documentos');
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [sent, countdown]);

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

      if (!docuboxSource && preProcessedFile && preProcessedFile.status !== 'ready') {
        if (preProcessedFile.status === 'error_grande') { setScanState('error_grande'); throw new Error('El archivo supera el límite de 50MB.'); }
        if (preProcessedFile.status === 'error_tipo') { setScanState('error_tipo'); throw new Error('Tipo de archivo no permitido. Solo se aceptan PDF, Word, Excel, PNG y JPG.'); }
        if (preProcessedFile.status === 'error_invalido') { setScanState('error_invalido'); throw new Error('El PDF está dañado o no es válido.'); }
      }

      if (docuboxSource) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          setScanState('error_grande');
          throw new Error('El archivo supera el límite de 50MB.');
        }
        detectedMime = await validateMimeByMagicBytes(file);
        if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime)) {
          setScanState('error_tipo');
          throw new Error('La versión seleccionada tiene un tipo de archivo no permitido.');
        }
        uploadContentType = docuboxSource.fileType || file.type || detectedMime;
        uploadBlob = file;
      } else if (preProcessedFile && preProcessedFile.status === 'ready') {
        console.log('[DOCUBOX][security] Usando pipeline pre-ejecutado (sin reprocesar)');
        detectedMime = preProcessedFile.mime;
        uploadContentType = preProcessedFile.mime === 'application/pdf' ? 'application/pdf' : (file.type || 'application/octet-stream');
        const uploadBytes = new Uint8Array(preProcessedFile.bytes.byteLength);
        uploadBytes.set(preProcessedFile.bytes);
        uploadBlob = new Blob([uploadBytes.buffer], { type: uploadContentType });
      } else {
        console.log('[DOCUBOX][security] Pre-procesamiento no disponible, ejecutando pipeline ahora');
        if (file.size > MAX_FILE_SIZE_BYTES) { setScanState('error_grande'); throw new Error('El archivo supera el límite de 50MB.'); }
        detectedMime = await validateMimeByMagicBytes(file);
        if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime)) { setScanState('error_tipo'); throw new Error('Tipo de archivo no permitido. Solo se aceptan PDF, Word, Excel, PNG y JPG.'); }
        uploadContentType = file.type || 'application/octet-stream';
        if (detectedMime === 'application/pdf') {
          try {
            const sanitizedBytes = await sanitizePDFClient(file);
            const uploadBytes = new Uint8Array(sanitizedBytes.byteLength);
            uploadBytes.set(sanitizedBytes);
            uploadBlob = new Blob([uploadBytes.buffer], { type: 'application/pdf' });
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
      if (docuboxSource && hash.toLowerCase() !== docuboxSource.sourceSha256.toLowerCase()) {
        setScanState('error_invalido');
        throw new Error('La huella de la versión seleccionada cambió. Vuelve a elegir el documento desde Docubox.');
      }
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
          'Cadena original': 'document_chain',
          'Sello digital': 'document_seal',
          'Estampa de tiempo': 'timestamp',
          'Cadena de evidencia': 'evidence_chain',
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
          placementKind: f.placementKind || null,
          cryptographicType: f.cryptographicType || null,
          generatedOnCompletion: f.generatedOnCompletion ?? false,
          dropdownOptions: f.dropdownOptions || null,
          radioOptions: f.radioOptions || null,
          casillaLabel: f.casillaLabel || null,
          fieldConfig: f.fieldConfig || null,
          fieldTypeConfig: f.fieldTypeConfig || null,
        };
      }) : [];

      // Enviar archivo + metadata al servidor (usa service role — bypasa RLS y storage policies)
      const uploadFormData = new FormData();
      if (!docuboxSource) {
        uploadFormData.append('file', new File([uploadBlob], sanitizeFileName(file.name), { type: uploadContentType }));
      }
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
        publico: effectiveSecurity?.publico ?? false,
        selloDigital: effectiveSecurity?.selloDigital ?? false,
        selloUbicacion: effectiveSecurity?.selloUbicacion || 'calce',
        estampaAutenticacion: effectiveSecurity?.estampaAutenticacion ?? false,
        metadatosAdicionales: effectiveSecurity?.metadatosAdicionales ?? false,
        docuboxSource: docuboxSource ? {
          workspaceId: docuboxSource.workspaceId,
          documentId: docuboxSource.sourceDocumentId,
          versionId: docuboxSource.sourceVersionId,
          variant: docuboxSource.sourceVariant,
          expectedSha256: docuboxSource.sourceSha256,
          relationType: docuboxSource.relationType,
        } : null,
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100 p-4">
        <div className="flex w-full max-w-lg flex-col items-center rounded-lg border border-slate-200 bg-white px-8 py-10 text-center shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-700 text-slate-950">Documento enviado</h1>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">El proceso se inició correctamente y los participantes recibirán sus notificaciones.</p>
          <div className="mt-7 flex w-full items-center justify-between border-t border-slate-200 pt-5">
            <p className="text-xs text-slate-500">Redirección automática en <span className="font-700 text-emerald-600">{countdown}</span> segundo{countdown !== 1 ? 's' : ''}</p>
            <button onClick={() => window.location.replace('/mis-documentos')} className="flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-700 text-white transition-colors hover:bg-emerald-700">
              Cerrar
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
    <div className="mx-auto w-full max-w-[1180px] pb-8">
      {/* Ready status */}
      <div className="mb-5 flex flex-col gap-4 rounded-lg border border-emerald-200/80 bg-emerald-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
            <CheckCircle2 size={20} className="text-emerald-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-700 text-slate-950">Documento listo para enviar</h1>
            <p className="mt-0.5 text-sm text-slate-600">Comprueba la información antes de iniciar el proceso.</p>
          </div>
        </div>
        <div className="flex items-center divide-x divide-emerald-200 text-center">
          <div className="px-4 first:pl-0">
            <p className="text-base font-700 tabular-nums text-slate-950">{participants.length}</p>
            <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-500">Participantes</p>
          </div>
          <div className="px-4">
            <p className="text-base font-700 tabular-nums text-slate-950">{placedFields?.length ?? 0}</p>
            <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-500">Campos</p>
          </div>
          <div className="px-4 pr-0">
            <p className="text-base font-700 tabular-nums text-slate-950">{pdfMetadata?.pageCount ?? '—'}</p>
            <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-500">Páginas</p>
          </div>
        </div>
      </div>

      {sendError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{sendError}</p>
        </div>
      )}

      {/* Scan state messages */}
      {scanState === 'uploading' && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <svg className="animate-spin h-4 w-4 text-blue-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          <p className="text-sm text-blue-700 font-medium">Verificando seguridad del documento... (puede tardar entre 5 y 30 segundos)</p>
        </div>
      )}
      {scanState === 'error_tipo' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <Shield size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">Tipo de archivo no permitido. Solo se aceptan PDF, Word, Excel, PNG y JPG.</p>
        </div>
      )}
      {scanState === 'error_grande' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">El archivo supera el límite de 50MB.</p>
        </div>
      )}
      {scanState === 'error_infected' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <Shield size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">Documento bloqueado por seguridad. Se detectó una amenaza. Si crees que es un error contacta a soporte.</p>
        </div>
      )}
      {scanState === 'error_invalido' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">El PDF está dañado o no es válido.</p>
        </div>
      )}
      {scanState === 'error_red' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">Error de conexión. Intenta de nuevo.</p>
        </div>
      )}
      {scanState === 'success' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
          <p className="text-sm text-emerald-700 font-medium">Documento subido correctamente y verificado.</p>
        </div>
      )}

      {/* Document overview */}
      <section className="mb-4 overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-700 text-slate-950">Documento</h2>
            <p className="mt-0.5 text-xs text-slate-500">Archivo y configuración general</p>
          </div>
          <button onClick={() => onGoToStep(1)} className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-primary" title="Editar documento">
            <Edit3 size={14} />
          </button>
        </div>
        <div className="p-5">
          <div className="flex min-w-0 items-center gap-3 border-b border-slate-100 pb-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary">
              <FileText size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-700 text-slate-950">{docConfig.nombre || (file?.name.replace(/\.[^/.]+$/, '') ?? 'Sin nombre')}</p>
              <p className="mt-1 truncate text-xs text-slate-500">{file ? `${file.name} · ${formatFileSize(file.size)}` : 'Archivo no disponible'}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-600 text-emerald-700">
              <CheckCircle2 size={12} />Listo
            </span>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5">
            <div className="flex items-start gap-2.5">
              <Clock size={15} className="mt-0.5 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-400">Vencimiento</p>
                <p className="mt-1 truncate text-sm font-600 text-slate-800">{vencimientoLabel}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Folder size={15} className="mt-0.5 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-400">Ubicación</p>
                <p className="mt-1 truncate text-sm font-600 text-slate-800">{carpetaNombre}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Lock size={15} className="mt-0.5 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-400">Seguridad</p>
                <p className="mt-1 truncate text-sm font-600 text-slate-800">{securityLabel}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Users size={15} className="mt-0.5 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-400">Participación</p>
                <p className="mt-1 truncate text-sm font-600 text-slate-800">{participationTypeLabel}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Globe2 size={15} className={`mt-0.5 shrink-0 ${effectiveSecurity?.publico ? 'text-blue-600' : 'text-slate-400'}`} />
              <div className="min-w-0">
                <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-400">Portal público</p>
                <p className="mt-1 text-sm font-600 text-slate-800">
                  {effectiveSecurity?.publico ? 'Al completarse' : 'No publicado'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Participantes */}
      <section className="mb-4 overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-700 text-slate-950">Participantes</h2>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-600 tabular-nums text-slate-500">{participants.length}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">Personas incluidas en el proceso y su configuración</p>
          </div>
          <button onClick={() => onGoToStep(2)} className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-primary" title="Editar participantes">
            <Edit3 size={14} />
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {participants.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No hay participantes configurados.</p>
          ) : (
            participants.map((p, idx) => {
              const initials = (p.name || '?').charAt(0).toUpperCase();
              const colors = ['bg-blue-100 text-blue-700', 'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700', 'bg-orange-100 text-orange-700', 'bg-pink-100 text-pink-700', 'bg-teal-100 text-teal-700'];
              const colorClass = colors[idx % colors.length];
              return (
                <div key={p.id} className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-slate-50/60">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-700 ${colorClass}`}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-700 text-slate-950">{p.name}</p>
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-600 ${p.isNewUser ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {p.isNewUser ? 'Sin registro' : 'Registrado'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{p.email}</p>
                    <p className="mt-1 text-xs font-600 text-primary">{p.rolDocumento || 'Participante'}</p>
                  </div>
                  <div className="hidden shrink-0 space-y-2 text-right sm:block">
                    {p.acto && (
                      <div>
                        <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-400">Acto / rol</p>
                        <p className="mt-0.5 text-sm font-600 text-slate-800">{p.acto}</p>
                      </div>
                    )}
                    {p.tipoFirma && p.tipoFirma.length > 0 && (
                      <div>
                        <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-400">Método</p>
                        <div className="flex items-center gap-1 justify-end">
                          <ShieldCheck size={13} className="text-primary" />
                          <p className="text-xs font-600 text-slate-700">{p.tipoFirma.map(getFirmaLabel).join(', ')}</p>
                        </div>
                      </div>
                    )}
                    {p.tipoNotificacion && p.tipoNotificacion.length > 0 && (
                      <div>
                        <p className="text-[10px] font-600 uppercase tracking-[0.08em] text-slate-400">Notificaciones</p>
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
      </section>

      {/* Información Solicitada — only visible when there is content */}
      {(
        Object.keys(fieldsByParticipant).length > 0 ||
        (participationOrder === 'mixto' && grupos && grupos.length > 0) ||
        participationOrder === 'condicional'
      ) && (
      <section className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-700 text-slate-950">Información solicitada</h2>
            <p className="mt-0.5 text-xs text-slate-500">Campos y reglas que se aplicarán durante el proceso</p>
          </div>
          <button onClick={() => onGoToStep(3)} className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-primary" title="Editar campos">
            <Edit3 size={14} />
          </button>
        </div>
        <div className="p-5">

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
                  <div key={grupo.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5">
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
            <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
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
          <div className="divide-y divide-slate-100">
            {Object.entries(fieldsByParticipant).map(([pid, data], idx) => {
              const participantName = data.name;
              const participantFields = data.fields;
              const initials = (participantName || '?').charAt(0).toUpperCase();
              const colors = ['bg-blue-100 text-blue-700', 'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700', 'bg-orange-100 text-orange-700', 'bg-pink-100 text-pink-700', 'bg-teal-100 text-teal-700'];
              const colorClass = colors[idx % colors.length];
              return (
                <div key={pid} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-700 ${colorClass}`}>
                      {initials}
                    </div>
                    <p className="text-sm font-700 text-slate-900">{participantName}</p>
                    <span className="ml-auto text-xs tabular-nums text-slate-400">{participantFields.length} campo{participantFields.length === 1 ? '' : 's'}</span>
                  </div>
                  <ul className="ml-9 flex flex-wrap gap-2">
                    {participantFields.map((label) => (
                      <li key={label} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-600 text-slate-600">
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
      </section>
      )}
    </div>
  );
});
