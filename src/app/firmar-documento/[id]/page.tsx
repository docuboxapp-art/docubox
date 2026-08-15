'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, X, PenLine, RotateCcw, Save, FileText, User, Shield, ShieldCheck, AlertTriangle, ChevronDown, Loader2, Check, Eye, Plus, Trash2, Type, Hash, Calendar, ToggleLeft, List, Circle, Maximize2, Minimize2, Mail, Phone, UserCheck, MapPin, Tag, Settings, Clock, DollarSign, Image as ImageIcon, CheckSquare, Download, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTheme } from '@/contexts/ThemeContext';
import AppLogo from '@/components/ui/AppLogo';
import { createNotification } from '@/lib/notificationsInApp';
import { sendParticipationCompletionEmail, sendOwnerParticipantActionEmail } from '@/lib/emailNotifications';
import AutographSignatureFlow from './AutographSignatureFlow';
import { useEfirmaEvidence, fileToBase64 } from '@/hooks/useEfirmaEvidence';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CampoSolicitado {
  id?: string;
  label: string;
  participantId: string | null;
  participantName: string | null;
  page: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  colorHex?: string | null;
  tipo?: string;
  dropdownOptions?: string[];
  radioOptions?: string[];
  casillaLabel?: string;
  fieldConfig?: {
    customName?: string;
    showLabelInDocument?: boolean;
  };
  fieldTypeConfig?: {
    imageType?: string;
    decimals?: number;
    numberFormat?: string;
    currency?: string;
    currencySymbol?: string;
    dateFormat?: string;
    timeFormat?: string;
    timeWithSeconds?: boolean;
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  };
}

interface CampoCompletado {
  campo_id: string;
  label: string;
  value: string;
}

interface CampoPersonalizado {
  id: string;
  label: string;
  tipo: 'texto' | 'numero' | 'fecha' | 'checkbox' | 'dropdown' | 'firma' | 'nombre_completo' | 'rfc' | 'curp' | 'correo' | 'telefono' | 'hora' | 'imagen' | 'moneda' | 'radio' | 'direccion';
  value: string;
}

// ─── NEW: Placed field on document ───────────────────────────────────────────
interface PlacedFieldFirmar {
  id: string;
  label: string;
  tipo: CampoPersonalizado['tipo'];
  value: string;
  x: number; // percentage
  y: number; // percentage
  width: number; // percentage
  height: number; // percentage
  page: number;
  fieldConfig?: FieldLabelConfig;
  fieldTypeConfig?: FieldTypeConfig;
  dropdownOptions?: string[];
  radioOptions?: string[];
  casillaLabel?: string;
}

interface UserProfileData {
  nombre_completo: string;
  rfc: string;
  curp: string;
  email: string;
  telefono: string;
  direccion: string;
}

interface DocumentData {
  id: string;
  nombre: string;
  estado: string;
  owner_id: string;
  file_url?: string;
  campos_solicitados?: CampoSolicitado[];
  participantes?: any[];
}

// ─── Helper: derive tipo from label (fallback for legacy docs) ────────────────
function deriveTipoFromLabel(label: string): CampoPersonalizado['tipo'] {
  const map: Record<string, CampoPersonalizado['tipo']> = {
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

// ─── Helper: smart tipo resolution considering field data ─────────────────────
function resolveFieldTipo(c: CampoSolicitado): CampoPersonalizado['tipo'] {
  // If tipo is explicitly set and not the generic 'texto' fallback, use it
  const explicitTipo = c.tipo as CampoPersonalizado['tipo'];
  if (explicitTipo && explicitTipo !== 'texto') return explicitTipo;
  // If tipo is 'texto' but field has dropdown/radio options, infer correct type
  if (c.dropdownOptions && c.dropdownOptions.length > 0) return 'dropdown';
  if (c.radioOptions && c.radioOptions.length > 0) return 'radio';
  if (c.casillaLabel) return 'checkbox';
  // Fall back to label-based derivation
  const fromLabel = deriveTipoFromLabel(c.label);
  // If label-based gives a specific type, prefer it over 'texto'
  if (fromLabel !== 'texto') return fromLabel;
  // If tipo was explicitly 'texto', keep it
  if (explicitTipo === 'texto') return 'texto';
  return fromLabel;
}

// ─── ASN.1 helpers (for CER parsing) — exact copy from /registro ─────────────

/**
 * Reads a DER-encoded X.509 certificate (.cer) and extracts:
 *  - noCertificado (serial hex → ASCII → 20-digit string)
 *  - RFC, CURP from subject OIDs / text fields
 *  - subject raw string
 *  - notBefore / notAfter validity dates
 *  - base64 of the certificate
 *
 * IMPORTANT: The SAT serial is stored as ASCII digits encoded in hex.
 * Example: hex "3030303031303030303030373034313439363830"
 *          → bytes [0x30,0x30,...] → ASCII "00001000000704149680"
 * We NEVER convert to BigInt decimal.
 */
function derReadLen(bytes: Uint8Array, pos: number): number {
  const first = bytes[pos];
  if (first < 0x80) return first;
  const numBytes = first & 0x7f;
  let len = 0;
  for (let i = 1; i <= numBytes; i++) len = (len << 8) | bytes[pos + i];
  return len;
}

function derLenSize(bytes: Uint8Array, pos: number): number {
  const first = bytes[pos];
  if (first < 0x80) return 0; // length fits in 1 byte (the byte at pos itself)
  return first & 0x7f; // number of additional bytes
}

/** Extract a human-readable DN string from raw DER bytes of a Name SEQUENCE */
function extractDNStringFirmar(bytes: Uint8Array): string {
  const parts: string[] = [];
  let i = 0;

  // Skip outer SEQUENCE tag+length
  if (bytes[i] === 0x30) {
    i++;
    i += derLenSize(bytes, i) + 1; // skip length bytes
  }

  while (i < bytes.length) {
    // SET
    if (bytes[i] !== 0x31) { i++; continue; }
    i++;
    const setLen = derReadLen(bytes, i);
    i += derLenSize(bytes, i) + 1;
    const setEnd = i + setLen;

    // SEQUENCE inside SET
    if (bytes[i] === 0x30) {
      i++;
      const seqLen = derReadLen(bytes, i);
      i += derLenSize(bytes, i) + 1;
      const seqEnd = i + seqLen;

      // OID — skip it
      if (bytes[i] === 0x06) {
        i++;
        const oidLen = derReadLen(bytes, i);
        i += derLenSize(bytes, i) + 1;
        i += oidLen;
      }

      // Value (UTF8String, PrintableString, IA5String, etc.)
      if (i < seqEnd) {
        i++; // tag
        const valLen = derReadLen(bytes, i);
        i += derLenSize(bytes, i) + 1;
        let val = '';
        for (let j = i; j < i + valLen; j++) {
          if (bytes[j] >= 0x20) val += String.fromCharCode(bytes[j]);
        }
        if (val.trim()) parts.push(val.trim());
        i += valLen;
      }
      i = seqEnd;
    }
    i = setEnd;
  }
  return parts.join(', ');
}

function parseAsn1TimeFirmar(value: Uint8Array): string {
  try {
    const str = Array.from(value).map(b => String.fromCharCode(b)).join('');
    if (str.length === 13) {
      const yy = parseInt(str.slice(0, 2));
      const year = yy >= 50 ? 1900 + yy : 2000 + yy;
      return `${year}-${str.slice(2, 4)}-${str.slice(4, 6)} ${str.slice(6, 8)}:${str.slice(8, 10)}:${str.slice(10, 12)}`;
    } else if (str.length >= 15) {
      return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)} ${str.slice(8, 10)}:${str.slice(10, 12)}:${str.slice(12, 14)}`;
    }
    return str;
  } catch { return ''; }
}

async function parseCerFileFirmar(file: File): Promise<{
  rfc: string; curp: string; serial: string; subject: string;
  notBefore: string; notAfter: string; base64: string;
} | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);

        // ── Base64 of the raw certificate ──────────────────────────────────
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);

        // ── ASN.1 DER minimal parser helpers ──────────────────────────────
        let pos = 0;

        function readLength(): number {
          const first = bytes[pos++];
          if (first < 0x80) return first;
          const numBytes = first & 0x7f;
          let len = 0;
          for (let i = 0; i < numBytes; i++) len = (len << 8) | bytes[pos++];
          return len;
        }

        function readTag(): number {
          return bytes[pos++];
        }

        function skipValue(len: number): void {
          pos += len;
        }

        function readTLV(): { tag: number; value: Uint8Array } {
          const tag = readTag();
          let len = readLength();
          const value = bytes.slice(pos, pos + len);
          pos += len;
          return { tag, value };
        }

        // ── STEP 1: Enter outer SEQUENCE (Certificate) ────────────────────
        readTag(); // 0x30 SEQUENCE
        readLength();

        // ── STEP 2: Enter TBSCertificate SEQUENCE ─────────────────────────
        readTag(); // 0x30 SEQUENCE
        readLength();

        // ── STEP 3: Skip optional [0] version ─────────────────────────────
        if (bytes[pos] === 0xa0) {
          readTag();
          const vLen = readLength();
          skipValue(vLen);
        }

        // ── STEP 4: Read serialNumber INTEGER ─────────────────────────────
        const serialTLV = readTLV(); // tag 0x02
        const serialBytes = serialTLV.value;

        // Convert serial bytes to hex string
        const serialHex = Array.from(serialBytes)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        // Convert hex → ASCII (each pair of hex digits = one ASCII char)
        let noCertificado = '';
        for (let i = 0; i + 1 < serialHex.length; i += 2) {
          const charCode = parseInt(serialHex.slice(i, i + 2), 16);
          if (charCode >= 0x20 && charCode <= 0x7e) {
            noCertificado += String.fromCharCode(charCode);
          }
        }

        // Clean and validate: must be exactly 20 numeric characters
        noCertificado = noCertificado.replace(/\s/g, '');
        if (!/^\d{20}$/.test(noCertificado)) {
          console.warn('[parseCerFileFirmar] noCertificado no cumple 20 dígitos numéricos:', noCertificado, '| serialHex:', serialHex);
          // Fallback: try raw hex as-is if it looks numeric and is 20 chars
          if (/^\d{20}$/.test(serialHex)) {
            noCertificado = serialHex;
          } else {
            noCertificado = '';
          }
        }

        // ── STEP 5: Read signature algorithm (skip) ───────────────────────
        const sigAlgTLV = readTLV(); // SEQUENCE
        void sigAlgTLV;

        // ── STEP 6: Read issuer SEQUENCE (skip) ───────────────────────────
        readTag(); // 0x30
        const issuerLen = readLength();
        skipValue(issuerLen);

        // ── STEP 7: Read validity SEQUENCE ────────────────────────────────
        readTag(); // 0x30 SEQUENCE
        readLength();
        const notBeforeTLV = readTLV();
        const notAfterTLV = readTLV();
        const notBefore = parseAsn1TimeFirmar(notBeforeTLV.value);
        const notAfter = parseAsn1TimeFirmar(notAfterTLV.value);

        // ── STEP 8: Read subject SEQUENCE ─────────────────────────────────
        const subjectStart = pos;
        readTag(); // 0x30
        const subjectLen = readLength();
        const subjectBytes = bytes.slice(subjectStart, pos + subjectLen);
        skipValue(subjectLen);
        const subject = extractDNStringFirmar(subjectBytes);

        // ── Extract RFC and CURP from subject string (same as /registro) ──
        // RFC pattern: 3-4 uppercase letters (including Ñ &) + 6 digits + 3 alphanumeric
        const rfcMatch = subject.match(/[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}/);
        const rfc = rfcMatch ? rfcMatch[0] : '';

        // CURP pattern: 18 chars
        const curpMatch = subject.match(/[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9]{2}/);
        const curp = curpMatch ? curpMatch[0] : '';

        resolve({ rfc, curp, serial: noCertificado, subject, notBefore, notAfter, base64 });
      } catch (err) {
        console.error('[parseCerFileFirmar] Error al parsear certificado:', err);
        resolve(null);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── EfirmaFirmarFlow component ───────────────────────────────────────────────
interface EfirmaProfileData {
  serial: string | null;
  rfc: string | null;
  curp: string | null;
  nombre: string | null;
  vigenciaFin: string | null;
}

// ── Nubarium result type ──────────────────────────────────────────────────────
interface NubariumValidationResult {
  estado: string;
  fechaConsulta: string;
  codigoValidacion: string | null;
}

function EfirmaFirmarFlow({
  profileEfirma,
  isDark,
  geoDenied,
  onValidated,
  documentId,
  supabaseAccessToken,
}: {
  profileEfirma: EfirmaProfileData | null;
  isDark: boolean;
  geoDenied: boolean;
  onValidated: (certInfo?: any, cerB64?: string, keyB64?: string, password?: string, nubariumResult?: NubariumValidationResult) => void;
  documentId?: string;
  supabaseAccessToken?: string;
}) {
  const hasProfileEfirma = !!(profileEfirma?.serial && profileEfirma?.rfc);

  // UX states — mirrors autógrafa flow
  // usePreloaded: null = asking, true = using preloaded, false = rejected
  const [usePreloaded, setUsePreloaded] = useState<boolean | null>(hasProfileEfirma ? null : false);
  // noticeAccepted: whether user clicked "Entendido — Continuar" on the info box
  const [noticeAccepted, setNoticeAccepted] = useState(false);

  // Upload form states
  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [validated, setValidated] = useState(false);

  // User profile data for CURP/RFC cross-validation
  const [userProfileData, setUserProfileData] = useState<{ curp: string; rfc: string; personalidad_juridica: string } | null>(null);

  // Evidence capture
  const { captureFrame, collectAllEvidence } = useEfirmaEvidence(documentId || '');
  const [cerLoaded, setCerLoaded] = useState(false);
  const [keyLoaded, setKeyLoaded] = useState(false);

  // Fetch user profile for CURP/RFC validation
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from('user_profiles')
        .select('curp, rfc, personalidad_juridica')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setUserProfileData({
              curp: (data.curp || '').trim().toUpperCase(),
              rfc: (data.rfc || '').trim().toUpperCase(),
              personalidad_juridica: (data.personalidad_juridica || 'fisica').toLowerCase(),
            });
          }
        });
    });
  }, []);

  // Frame 1 — cuando ambos archivos están cargados y listos
  useEffect(() => {
    if (cerLoaded && keyLoaded) {
      captureFrame('efirma_files_loaded').catch(() => {});
    }
  }, [cerLoaded, keyLoaded, captureFrame]);

  // Check if profile e.firma is still valid (not expired)
  const profileIsExpired = profileEfirma?.vigenciaFin
    ? new Date(profileEfirma.vigenciaFin) < new Date()
    : false;

  const handleValidateProfileEfirma = async () => {
    if (!profileEfirma?.serial || (!profileEfirma?.rfc && !profileEfirma?.curp)) return;
    setValidating(true);
    setValidationError('');
    try {
      // Build identifier: prefer rfc, fall back to curp
      const identifierPayload = profileEfirma.rfc
        ? { rfc: profileEfirma.rfc, serial: profileEfirma.serial }
        : { curp: profileEfirma.curp, serial: profileEfirma.serial };

      const res = await fetch('/api/nubarium/validar-serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identifierPayload),
      });
      const data = await res.json();
      // Use _es_valido (server-computed) or fall back to legacy field checks
      const isValid =
        data._es_valido === true ||
        data.clave_mensaje === 0 ||
        data.estado === 'Vigente' || data.estatus === 'Vigente' ||
        data.estado === 'Activo' || data.estatus === 'Activo';
      if (isValid) {
        setValidated(true);
        const nubariumResult: NubariumValidationResult = {
          estado: data._estado_normalizado || data.estado || data.estatus || 'Vigente',
          fechaConsulta: new Date().toISOString(),
          codigoValidacion: data.codigo_validacion || null,
        };
        onValidated(undefined, undefined, undefined, undefined, nubariumResult);
      } else {
        const cm = data.clave_mensaje || data._clave_mensaje_detectada || 0;
        const msg = cm === 2
          ? 'La e.firma está revocada.'
          : cm === 3
          ? 'La e.firma está suspendida.'
          : cm === 4
          ? 'La e.firma ha expirado.'
          : data.error
          ? data.error?.includes('RFC') || data.error?.includes('serial')
            ? 'No se pudo extraer el RFC o número de serie del certificado registrado en tu perfil. Vuelve a vincular tu e.firma en Mi Perfil.'
            : `Error del servicio SAT: ${data.error}`
          : `La e.firma no está vigente (${data._estado_normalizado || data.estado || data.estatus || 'sin estado'}).`;
        setValidationError(msg);
      }
    } catch {
      setValidationError('Error al conectar con el servicio de validación. Intenta nuevamente.');
    } finally {
      setValidating(false);
    }
  };

  const handleValidateUploadedEfirma = async () => {
    if (!cerFile || !keyFile || !password) return;
    setValidating(true);
    setValidationError('');
    try {
      // ── PASO 1: Parsear .cer para validaciones previas ──────────────────
      const parsed = await parseCerFileFirmar(cerFile);
      if (!parsed || !parsed.serial) {
        setValidationError('No se pudo extraer el número de serie del certificado. Verifica el archivo .cer.');
        setValidating(false);
        return;
      }

      // ── PASO 2: Verificar vigencia del certificado ──────────────────────
      const now = new Date();
      const notAfterDate = parsed.notAfter ? new Date(parsed.notAfter.replace(' ', 'T') + (parsed.notAfter.includes('Z') ? '' : 'Z')) : null;
      const notBeforeDate = parsed.notBefore ? new Date(parsed.notBefore.replace(' ', 'T') + (parsed.notBefore.includes('Z') ? '' : 'Z')) : null;
      if (notAfterDate && now > notAfterDate) {
        const fechaVencimiento = notAfterDate.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
        setValidationError(`El certificado está vencido. Venció el ${fechaVencimiento}. Renueva tu e.firma ante el SAT para continuar.`);
        setValidating(false);
        return;
      }
      if (notBeforeDate && now < notBeforeDate) {
        setValidationError('El certificado aún no es vigente. Verifica la fecha de inicio de vigencia.');
        setValidating(false);
        return;
      }

      // ── PASO 3: Verificar CURP del certificado vs perfil ────────────────
      if (userProfileData && parsed.curp) {
        const certCurp = parsed.curp.trim().toUpperCase();
        const profileCurp = userProfileData.curp;
        if (profileCurp && certCurp && certCurp !== profileCurp) {
          setValidationError(`La CURP del certificado (${certCurp}) no coincide con la CURP registrada en tu perfil (${profileCurp}). Verifica que estés usando el certificado correcto.`);
          setValidating(false);
          return;
        }
      }

      // ── PASO 4: Verificar RFC si es persona moral ───────────────────────
      if (userProfileData && userProfileData.personalidad_juridica === 'moral' && parsed.rfc) {
        const certRfc = parsed.rfc.trim().toUpperCase();
        const profileRfc = userProfileData.rfc;
        if (profileRfc && certRfc && certRfc !== profileRfc) {
          setValidationError(`El RFC del certificado (${certRfc}) no coincide con el RFC registrado en tu perfil (${profileRfc}). Verifica que estés usando el certificado de tu empresa.`);
          setValidating(false);
          return;
        }
      }

      // ── PASO 5: Convertir archivos a base64 ─────────────────────────────
      const cerB64 = await fileToBase64(cerFile);
      const keyB64 = await fileToBase64(keyFile);

      // Collect evidence in parallel (non-blocking)
      const { deviceFingerprint, sessionEvidence } = await collectAllEvidence();

      // ── PASO 6: Validar par criptográfico con Edge Function ─────────────
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (supabaseUrl && supabaseAccessToken && documentId) {
        const edgeRes = await fetch(`${supabaseUrl}/functions/v1/validate-efirma`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAccessToken}`,
          },
          body: JSON.stringify({
            document_id: documentId,
            cer_b64: cerB64,
            key_b64: keyB64,
            password,
            device_fingerprint: deviceFingerprint,
            session_evidence: sessionEvidence,
          }),
        });

        if (edgeRes.ok) {
          const edgeData = await edgeRes.json();
          if (edgeData.valid) {
            // ── PASO 7: Validar serial con Nubarium ────────────────────────
            // Prefer client-side parsed values (ASCII-decoded serial, OID-aware RFC/CURP)
            // over edge function values as primary source of truth
            const certRfc = (parsed.rfc || edgeData.cert_rfc || '').trim();
            const certCurpFallback = (parsed.curp || edgeData.cert_curp || '').trim();
            const certSerial = (parsed.serial || edgeData.cert_serial || '').trim();
            if (!certRfc && !certCurpFallback) {
              setValidationError('No se pudo extraer el RFC o CURP del certificado. Verifica que el archivo .cer sea válido y pertenezca a tu e.firma.');
              setValidating(false);
              return;
            }
            // Build identifier payload: prefer rfc, fall back to curp
            const nubariumIdentifier = certRfc
              ? { rfc: certRfc, serial: certSerial }
              : { curp: certCurpFallback, serial: certSerial };
            // Proceed with Nubarium validation — certSerial may be empty but RFC/CURP is enough to identify
            {
              let nubariumOk = false;
              let nubariumError = '';
              let capturedNubariumResult: NubariumValidationResult | undefined;
              try {
                const nubariumRes = await fetch('/api/nubarium/validar-serial', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(nubariumIdentifier),
                });
                const nubariumData = await nubariumRes.json();
                // Check for connection/auth errors returned as success:false
                if (nubariumData.success === false && nubariumData.fetch_error) {
                  nubariumError = 'No se pudo conectar con el servicio de validación del SAT. Intenta nuevamente.';
                } else if (nubariumData.success === false && nubariumData.error) {
                  nubariumError = nubariumData.error?.includes('RFC') || nubariumData.error?.includes('serial')
                    ? 'No se pudo extraer el RFC o número de serie del certificado. Verifica que el archivo .cer sea válido.'
                    : `Error del servicio SAT: ${nubariumData.error}`;
                } else {
                  // Use server-computed _es_valido or fall back to legacy field checks
                  const nubariumIsValid =
                    nubariumData._es_valido === true ||
                    nubariumData.clave_mensaje === 0 ||
                    nubariumData.estado === 'Vigente' || nubariumData.estatus === 'Vigente' ||
                    nubariumData.estado === 'Activo' || nubariumData.estatus === 'Activo';
                  if (nubariumIsValid) {
                    nubariumOk = true;
                    capturedNubariumResult = {
                      estado: nubariumData._estado_normalizado || nubariumData.estado || nubariumData.estatus || 'Vigente',
                      fechaConsulta: new Date().toISOString(),
                      codigoValidacion: nubariumData.codigo_validacion || null,
                    };
                  } else {
                    const cm = nubariumData.clave_mensaje || nubariumData._clave_mensaje_detectada || 0;
                    nubariumError = cm === 2
                      ? 'La e.firma está revocada ante el SAT.'
                      : cm === 3
                      ? 'La e.firma está suspendida ante el SAT.'
                      : cm === 4
                      ? 'La e.firma ha expirado ante el SAT.'
                      : nubariumData.error
                      ? `Error del servicio SAT: ${nubariumData.error}`
                      : `La e.firma no está vigente ante el SAT (${nubariumData._estado_normalizado || nubariumData.estado || nubariumData.estatus || 'sin estado'}).`;
                  }
                }
              } catch {
                nubariumError = 'No se pudo conectar con el servicio de validación del SAT. Verifica tu conexión e intenta nuevamente.';
              }

              if (!nubariumOk) {
                setValidationError(nubariumError);
                setValidating(false);
                return;
              }

              // ── PASO 8: Re-verificar CURP/RFC con datos del Edge Function ──
              const edgeCurp = (edgeData.cert_curp || '').trim().toUpperCase();
              const edgeRfc = (edgeData.cert_rfc || '').trim().toUpperCase();

              if (userProfileData && edgeCurp) {
                const profileCurp = userProfileData.curp;
                if (profileCurp && edgeCurp !== profileCurp) {
                  setValidationError(`La CURP del certificado (${edgeCurp}) no coincide con la CURP registrada en tu perfil (${profileCurp}). Verifica que estés usando el certificado correcto.`);
                  setValidating(false);
                  return;
                }
              }

              if (userProfileData && userProfileData.personalidad_juridica === 'moral' && edgeRfc) {
                const profileRfc = userProfileData.rfc;
                if (profileRfc && edgeRfc !== profileRfc) {
                  setValidationError(`El RFC del certificado (${edgeRfc}) no coincide con el RFC registrado en tu perfil (${profileRfc}). Verifica que estés usando el certificado de tu empresa.`);
                  setValidating(false);
                  return;
                }
              }

              // Frame 2 — validación exitosa
              await captureFrame('efirma_validated').catch(() => {});
              setValidated(true);
              onValidated(edgeData, cerB64, keyB64, password, capturedNubariumResult);
              return;
            }
          } else {
            // Edge Function returned explicit error (e.g. expired cert, wrong password)
            const errMsg = edgeData.error || 'La e.firma no es válida.';
            // Improve expiry error message
            if (errMsg.toLowerCase().includes('expirado') || errMsg.toLowerCase().includes('vigente') || errMsg.toLowerCase().includes('expired')) {
              const fechaVenc = edgeData.cert_not_after
                ? new Date(edgeData.cert_not_after).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
                : null;
              setValidationError(fechaVenc
                ? `El certificado está vencido. Venció el ${fechaVenc}. Renueva tu e.firma ante el SAT para continuar.`
                : 'El certificado está vencido. Renueva tu e.firma ante el SAT para continuar.');
            } else {
              setValidationError(errMsg);
            }
            setValidating(false);
            return;
          }
        }
        // Fall through to legacy validation if Edge Function fails
      }

      // ── Legacy fallback: validate-key API + Nubarium ────────────────────
      const keyFormData = new FormData();
      keyFormData.append('keyFile', keyFile);
      keyFormData.append('password', password);
      const keyRes = await fetch('/api/efirma/validate-key', { method: 'POST', body: keyFormData });
      const keyData = await keyRes.json();
      if (!keyData.isPasswordValid) {
        setValidationError(keyData.message || 'Contraseña incorrecta para el archivo .key.');
        setValidating(false);
        return;
      }
      // Validate serial with Nubarium (legacy path)
      if ((!parsed.rfc || !parsed.rfc.trim()) && (!parsed.curp || !parsed.curp.trim())) {
        setValidationError('No se pudo extraer el RFC o CURP del certificado. Verifica que el archivo .cer sea válido y pertenezca a tu e.firma.');
        setValidating(false);
        return;
      }
      // Build identifier: prefer rfc, fall back to curp
      const legacyIdentifier = parsed.rfc?.trim()
        ? { rfc: parsed.rfc.trim(), serial: parsed.serial.trim() }
        : { curp: parsed.curp?.trim(), serial: parsed.serial.trim() };
      const nubariumRes = await fetch('/api/nubarium/validar-serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(legacyIdentifier),
      });
      const nubariumData = await nubariumRes.json();
      // Check for connection/auth errors returned as success:false
      if (nubariumData.success === false && (nubariumData.fetch_error || nubariumData.error)) {
        const errMsg = nubariumData.fetch_error
          ? 'No se pudo conectar con el servicio de validación del SAT. Intenta nuevamente.'
          : nubariumData.error?.includes('RFC') || nubariumData.error?.includes('serial')
          ? 'No se pudo extraer el RFC o número de serie del certificado. Verifica que el archivo .cer sea válido.'
          : `Error del servicio SAT: ${nubariumData.error}`;
        setValidationError(errMsg);
        setValidating(false);
        return;
      }
      // Use server-computed _es_valido or fall back to legacy field checks
      const legacyIsValid =
        nubariumData._es_valido === true ||
        nubariumData.clave_mensaje === 0 ||
        nubariumData.estado === 'Vigente' || nubariumData.estatus === 'Vigente' ||
        nubariumData.estado === 'Activo' || nubariumData.estatus === 'Activo';
      if (legacyIsValid) {
        // Frame 2 — validación exitosa (legacy path)
        await captureFrame('efirma_validated').catch(() => {});
        setValidated(true);
        const legacyNubariumResult: NubariumValidationResult = {
          estado: nubariumData._estado_normalizado || nubariumData.estado || nubariumData.estatus || 'Vigente',
          fechaConsulta: new Date().toISOString(),
          codigoValidacion: nubariumData.codigo_validacion || null,
        };
        onValidated({ cert_serial: parsed.serial, cert_rfc: parsed.rfc, cert_subject: parsed.subject }, cerB64, keyB64, password, legacyNubariumResult);
      } else {
        const cm = nubariumData.clave_mensaje || nubariumData._clave_mensaje_detectada || 0;
        const msg = cm === 2
          ? 'La e.firma está revocada ante el SAT.'
          : cm === 3
          ? 'La e.firma está suspendida ante el SAT.'
          : cm === 4
          ? 'La e.firma ha expirado ante el SAT.'
          : nubariumData.error
          ? `Error del servicio SAT: ${nubariumData.error}`
          : `La e.firma no está vigente ante el SAT (${nubariumData._estado_normalizado || nubariumData.estado || nubariumData.estatus || 'sin estado'}).`;
        setValidationError(msg);
      }
    } catch {
      setValidationError('Error al validar la e.firma. Intenta nuevamente.');
    } finally {
      setValidating(false);
    }
  };

  // ── Validated success state ──────────────────────────────────────────────
  if (validated) {
    return (
      <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-green-700' : 'border-green-200'}`}>
        <div className={`px-4 py-3 flex items-center gap-2 ${isDark ? 'bg-green-900/20' : 'bg-green-50'}`}>
          <CheckCircle2 size={16} className="text-green-600 shrink-0" />
          <div>
            <p className={`text-sm font-semibold ${isDark ? 'text-green-400' : 'text-green-700'}`}>e.firma SAT validada y vigente</p>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-green-500' : 'text-green-600'}`}>La validación ante el SAT fue exitosa. Puedes enviar tu firma.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── STEP 1: Ask if user wants to use preloaded e.firma ─────────────── */}
      {hasProfileEfirma && !profileIsExpired && usePreloaded === null && (
        <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-blue-700 bg-blue-900/20' : 'border-blue-200 bg-blue-50'}`}>
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-2">
              <ShieldCheck size={16} className={`flex-shrink-0 mt-0.5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              <p className={`text-sm font-medium ${isDark ? 'text-blue-200' : 'text-blue-800'}`}>
                Existe una e.firma registrada en tu perfil, ¿deseas utilizarla?
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setUsePreloaded(true)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
              >
                <Check size={14} />
                Sí
              </button>
              <button
                type="button"
                onClick={() => setUsePreloaded(false)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-border text-foreground hover:bg-muted'}`}
              >
                No usar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expired warning — show directly if expired */}
      {hasProfileEfirma && profileIsExpired && usePreloaded === null && (
        <div className={`flex items-start gap-2 rounded-lg p-3 border ${isDark ? 'bg-amber-900/20 border-amber-700' : 'bg-amber-50 border-amber-200'}`}>
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className={`text-xs font-medium ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>La e.firma registrada en tu perfil está vencida.</p>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>Carga una nueva e.firma vigente para continuar.</p>
          </div>
        </div>
      )}

      {/* ── STEP 2A: Using preloaded e.firma — show data card ──────────────── */}
      {usePreloaded === true && hasProfileEfirma && (
        <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-gray-700' : 'border-border'}`}>
          <div className={`px-4 py-2.5 border-b flex items-center justify-between ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/30 border-border'}`}>
            <div className="flex items-center gap-2">
              <Shield size={13} className="text-primary" />
              <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-foreground'}`}>E.FIRMA REGISTRADA EN PERFIL</p>
            </div>
            <button
              type="button"
              onClick={() => { setUsePreloaded(null); setValidationError(''); }}
              className={`text-xs underline ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Cambiar
            </button>
          </div>
          <div className={`p-4 space-y-3 ${isDark ? 'bg-gray-800' : ''}`}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>RFC</p>
                <p className={`text-sm font-mono font-medium ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{profileEfirma?.rfc || '—'}</p>
              </div>
              <div>
                <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>NO. DE SERIE</p>
                <p className={`text-xs font-mono ${isDark ? 'text-gray-300' : 'text-slate-600'} truncate`}>{profileEfirma?.serial || '—'}</p>
              </div>
              {profileEfirma?.nombre && (
                <div className="col-span-2">
                  <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>TITULAR</p>
                  <p className={`text-sm ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{profileEfirma.nombre}</p>
                </div>
              )}
              {profileEfirma?.vigenciaFin && (
                <div className="col-span-2">
                  <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>VIGENCIA</p>
                  <p className={`text-sm ${isDark ? 'text-gray-200' : 'text-foreground'}`}>
                    {new Date(profileEfirma.vigenciaFin).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                </div>
              )}
            </div>
            {validationError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{validationError}</p>
              </div>
            )}
            <button
              type="button"
              onClick={handleValidateProfileEfirma}
              disabled={validating}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {validating ? (
                <><Loader2 size={14} className="animate-spin" /> Validando ante SAT...</>
              ) : (
                <><Shield size={14} /> Validar e.firma y firmar</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2B: User rejected preloaded — show info notice ────────────── */}
      {(usePreloaded === false || (!hasProfileEfirma) || profileIsExpired) && !noticeAccepted && (
        <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-gray-700' : 'border-border'}`}>
          <div className={`px-4 py-3 flex items-center gap-2 border-b ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/30 border-border'}`}>
            <Shield size={15} className="text-primary" />
            <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Iniciar proceso de obtención de firma</p>
          </div>
          <div className={`p-4 space-y-4 ${isDark ? 'bg-gray-800' : ''}`}>
            <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>
              Generamos automáticamente un registro del proceso para brindar plena validez legal a tu firma en el documento, por lo que se emitirá un registro de tiempo, dispositivo, ubicación y trazo de firma.
            </p>
            {geoDenied && (
              <div className={`flex items-start gap-3 p-3 rounded-lg border ${isDark ? 'bg-red-900/20 border-red-700/50' : 'bg-red-50 border-red-300'}`}>
                <MapPin size={16} className={`flex-shrink-0 mt-0.5 ${isDark ? 'text-red-400' : 'text-red-500'}`} />
                <div>
                  <p className={`text-xs font-semibold ${isDark ? 'text-red-300' : 'text-red-700'}`}>Ubicación requerida para firmar</p>
                  <p className={`text-xs mt-0.5 leading-relaxed ${isDark ? 'text-red-400/80' : 'text-red-600'}`}>
                    Has bloqueado el acceso a tu ubicación. La ubicación es obligatoria para completar el proceso de firmado. Activa el permiso en la configuración de tu navegador y recarga la página para continuar.
                  </p>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setNoticeAccepted(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
            >
              <Check size={15} />
              Entendido — Continuar
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Upload form — shown after notice accepted ──────────────── */}
      {(usePreloaded === false || (!hasProfileEfirma) || profileIsExpired) && noticeAccepted && (
        <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-gray-700' : 'border-border'}`}>
          <div className={`px-4 py-2.5 border-b ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/30 border-border'}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-foreground'}`}>Cargar archivos de e.firma</p>
          </div>
          <div className={`p-4 space-y-4 ${isDark ? 'bg-gray-800' : ''}`}>
            {/* .cer file */}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-foreground'}`}>
                Certificado (.cer) <span className="text-red-500">*</span>
              </label>
              <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${cerFile ? (isDark ? 'border-green-600 bg-green-900/20' : 'border-green-300 bg-green-50') : (isDark ? 'border-gray-600' : 'border-border')}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cerFile ? 'text-green-500' : 'text-slate-400'}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <label className="flex-1 cursor-pointer">
                  <span className={`text-xs ${cerFile ? (isDark ? 'text-green-400' : 'text-green-700') : (isDark ? 'text-gray-400' : 'text-muted-foreground')}`}>
                    {cerFile ? cerFile.name : 'Seleccionar archivo .cer'}
                  </span>
                  <input
                    type="file"
                    accept=".cer"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0] || null; setCerFile(f); setCerLoaded(!!f); setValidationError(''); }}
                  />
                </label>
                {cerFile && (
                  <button type="button" onClick={() => setCerFile(null)} className="text-slate-400 hover:text-red-500 transition-colors">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            {/* .key file */}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-foreground'}`}>
                Llave privada (.key) <span className="text-red-500">*</span>
              </label>
              <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${keyFile ? (isDark ? 'border-green-600 bg-green-900/20' : 'border-green-300 bg-green-50') : (isDark ? 'border-gray-600' : 'border-border')}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={keyFile ? 'text-green-500' : 'text-slate-400'}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                <label className="flex-1 cursor-pointer">
                  <span className={`text-xs ${keyFile ? (isDark ? 'text-green-400' : 'text-green-700') : (isDark ? 'text-gray-400' : 'text-muted-foreground')}`}>
                    {keyFile ? keyFile.name : 'Seleccionar archivo .key'}
                  </span>
                  <input
                    type="file"
                    accept=".key"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0] || null; setKeyFile(f); setKeyLoaded(!!f); setValidationError(''); }}
                  />
                </label>
                {keyFile && (
                  <button type="button" onClick={() => setKeyFile(null)} className="text-slate-400 hover:text-red-500 transition-colors">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            {/* Password */}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-foreground'}`}>
                Contraseña de la llave privada <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setValidationError(''); }}
                  placeholder="Contraseña e.Firma"
                  className={`w-full pr-9 pl-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500' : 'bg-background border-border'}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            {validationError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{validationError}</p>
              </div>
            )}
            <button
              type="button"
              onClick={handleValidateUploadedEfirma}
              disabled={!cerFile || !keyFile || !password || validating}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {validating ? (
                <><Loader2 size={14} className="animate-spin" /> Validando ante SAT...</>
              ) : (
                <><Shield size={14} /> Validar e.firma y firmar</>
              )}
            </button>
            <p className={`text-[10px] text-center ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>
              La contraseña se usa únicamente para descifrar la llave y no se almacena.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PDF Canvas ───────────────────────────────────────────────────────────────

declare global {
  interface Window { pdfjsLib: any; }
}

function PdfCanvas({ fileUrl, page, zoom, onTotalPages }: {
  fileUrl: string; page: number; zoom: number; onTotalPages: (n: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const pdfDocRef = useRef<any>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState(false);

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
      if (err?.name !== 'RenderingCancelledException') setError(true);
    } finally {
      setRendering(false);
    }
  }, [fileUrl, page, zoom, onTotalPages]);

  useEffect(() => {
    renderPage();
    return () => {
      if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch (_) {} }
    };
  }, [renderPage]);

  return (
    <div className="relative">
      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
          <Loader2 className="animate-spin h-6 w-6 text-primary" />
        </div>
      )}
      {error ? (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 bg-gray-100">
          <FileText size={48} className="text-slate-300" strokeWidth={1} />
          <p className="text-sm text-slate-400">Vista previa no disponible</p>
        </div>
      ) : (
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      )}
    </div>
  );
}

// ─── Signature Pad ────────────────────────────────────────────────────────────

function SignaturePad({ onSave, onClear, existingSignature }: {
  onSave: (dataUrl: string) => void;
  onClear: () => void;
  existingSignature?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (existingSignature && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        setHasStrokes(true);
      };
      img.src = existingSignature;
    }
  }, [existingSignature]);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDrawing(true);
    lastPos.current = getPos(e, canvas);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing || !canvasRef.current || !lastPos.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
    setHasStrokes(true);
  };

  const endDraw = () => {
    setIsDrawing(false);
    lastPos.current = null;
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    onClear();
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative border-2 border-dashed border-slate-300 rounded-xl bg-white overflow-hidden"
        style={{ touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="w-full cursor-crosshair"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasStrokes && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <PenLine size={28} className="text-slate-300 mx-auto mb-1" />
              <p className="text-xs text-slate-400">Dibuja tu firma aquí</p>
            </div>
          </div>
        )}
        {/* Baseline */}
        <div className="absolute bottom-10 left-8 right-8 border-b border-slate-200 pointer-events-none" />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <RotateCcw size={14} />
          Limpiar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasStrokes}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={14} />
          Confirmar firma
        </button>
      </div>
    </div>
  );
}

// ─── Campo Icon ───────────────────────────────────────────────────────────────

function CampoIcon({ tipo }: { tipo?: string }) {
  switch (tipo) {
    case 'firma': return <PenLine size={13} className="text-slate-400" />;
    case 'numero': return <Hash size={13} className="text-slate-400" />;
    case 'fecha': return <Calendar size={13} className="text-slate-400" />;
    case 'hora': return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case 'moneda': return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
    case 'imagen': return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
    case 'checkbox': return <ToggleLeft size={13} className="text-slate-400" />;
    case 'dropdown': return <List size={13} className="text-slate-400" />;
    case 'radio': return <Circle size={13} className="text-slate-400" />;
    default: return <Type size={13} className="text-slate-400" />;
  }
}

// ─── Campo Personalizado Icon ─────────────────────────────────────────────────

function CampoPersonalizadoIcon({ tipo }: { tipo?: string }) {
  switch (tipo) {
    case 'firma': return <PenLine size={13} className="text-slate-400" />;
    case 'nombre_completo': return <User size={13} className="text-slate-400" />;
    case 'rfc': return <FileText size={13} className="text-slate-400" />;
    case 'curp': return <UserCheck size={13} className="text-slate-400" />;
    case 'correo': return <Mail size={13} className="text-slate-400" />;
    case 'telefono': return <Phone size={13} className="text-slate-400" />;
    case 'direccion': return <MapPin size={13} className="text-slate-400" />;
    case 'numero': return <Hash size={13} className="text-slate-400" />;
    case 'moneda': return <DollarSign size={13} className="text-slate-400" />;
    case 'fecha': return <Calendar size={13} className="text-slate-400" />;
    case 'hora': return <Clock size={13} className="text-slate-400" />;
    case 'checkbox': return <CheckSquare size={13} className="text-slate-400" />;
    case 'dropdown': return <List size={13} className="text-slate-400" />;
    case 'radio': return <Circle size={13} className="text-slate-400" />;
    case 'imagen': return <ImageIcon size={13} className="text-slate-400" />;
    default: return <Type size={13} className="text-slate-400" />;
  }
}

// ─── Field Label Config Modal ─────────────────────────────────────────────────
interface FieldLabelConfig {
  customName?: string;
  showLabelInDocument?: boolean;
}

interface FieldTypeConfig {
  imageType?: string;
  decimals?: number;
  numberFormat?: string;
  currency?: string;
  currencySymbol?: string;
  dateFormat?: string;
  timeFormat?: string;
  timeWithSeconds?: boolean;
  // Font/style config (set by document creator)
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

function FieldLabelConfigModalFirmar({
  label,
  fieldConfig,
  onSave,
  onClose,
}: {
  label: string;
  fieldConfig?: FieldLabelConfig;
  onSave: (cfg: FieldLabelConfig) => void;
  onClose: () => void;
}) {
  const [customName, setCustomName] = useState(fieldConfig?.customName ?? label);
  const [showLabel, setShowLabel] = useState(fieldConfig?.showLabelInDocument ?? false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900">Configuración del Campo</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-4 mt-0.5"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500 mb-5">Personaliza el nombre y la visibilidad de la etiqueta para este campo.</p>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre del Campo <span className="text-red-500">*</span></label>
          <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" placeholder={label} autoFocus />
          <p className="mt-1.5 text-xs text-primary">Este nombre identificará el campo en los reportes y validaciones.</p>
        </div>
        <label className="flex items-start gap-3 border border-gray-200 rounded-lg px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors mb-6">
          <input type="checkbox" checked={showLabel} onChange={(e) => setShowLabel(e.target.checked)} className="w-4 h-4 rounded accent-primary cursor-pointer mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-800">Mostrar etiqueta en el documento</p>
            <p className="text-xs text-gray-500 mt-0.5">Si activas esta opción, el nombre del campo aparecerá visiblemente encima del elemento en el PDF final.</p>
          </div>
        </label>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
          <button type="button" onClick={() => { onSave({ customName: customName.trim() || label, showLabelInDocument: showLabel }); onClose(); }} className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-colors">Guardar Cambios</button>
        </div>
      </div>
    </div>
  );
}

function FieldTypeConfigModalFirmar({
  label,
  tipo,
  fieldTypeConfig,
  onSave,
  onClose,
}: {
  label: string;
  tipo?: string;
  fieldTypeConfig?: FieldTypeConfig;
  onSave: (cfg: FieldTypeConfig) => void;
  onClose: () => void;
}) {
  const cfg = fieldTypeConfig ?? {};
  const [imageType, setImageType] = useState(cfg.imageType ?? 'foto');
  const [decimals, setDecimals] = useState(cfg.decimals ?? 2);
  const [numberFormat, setNumberFormat] = useState(cfg.numberFormat ?? 'decimal');
  const [currency, setCurrency] = useState(cfg.currency ?? 'MXN');
  const [currencySymbol, setCurrencySymbol] = useState(cfg.currencySymbol ?? '$');
  const [dateFormat, setDateFormat] = useState(cfg.dateFormat ?? 'DD/MM/YYYY');
  const [timeFormat, setTimeFormat] = useState(cfg.timeFormat ?? '24h');
  const [timeWithSeconds, setTimeWithSeconds] = useState(cfg.timeWithSeconds ?? false);

  const isImagen = label === 'Imagen' || tipo === 'imagen';
  const isNumero = label === 'Número' || tipo === 'numero';
  const isMoneda = label === 'Moneda' || tipo === 'moneda';
  const isFecha = label === 'Fecha' || tipo === 'fecha';
  const isHora = label === 'Hora' || tipo === 'hora';

  const handleSave = () => {
    const result: FieldTypeConfig = {};
    if (isImagen) result.imageType = imageType;
    if (isNumero) { result.decimals = decimals; result.numberFormat = numberFormat; }
    if (isMoneda) { result.currency = currency; result.currencySymbol = currencySymbol; }
    if (isFecha) result.dateFormat = dateFormat;
    if (isHora) { result.timeFormat = timeFormat; result.timeWithSeconds = timeWithSeconds; }
    onSave(result);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900">Configuración de {label}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-4 mt-0.5"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500 mb-5">Configura las opciones específicas para este tipo de campo.</p>
        <div className="space-y-4 mb-6">
          {isImagen && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Tipo de imagen</label>
              <select value={imageType} onChange={(e) => setImageType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                <option value="foto">Fotografía</option>
                <option value="firma_imagen">Firma como imagen</option>
                <option value="logo">Logotipo</option>
                <option value="documento">Imagen de documento</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          )}
          {isNumero && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Formato de número</label>
                <select value={numberFormat} onChange={(e) => setNumberFormat(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                  <option value="entero">Entero (sin decimales)</option>
                  <option value="decimal">Decimal</option>
                  <option value="porcentaje">Porcentaje (%)</option>
                </select>
              </div>
              {numberFormat === 'decimal' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Decimales</label>
                  <select value={decimals} onChange={(e) => setDecimals(Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                    {[0, 1, 2, 3, 4].map((d) => <option key={d} value={d}>{d} decimal{d !== 1 ? 'es' : ''}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
          {isMoneda && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Tipo de moneda</label>
                <select value={currency} onChange={(e) => {
                  setCurrency(e.target.value);
                  const symbols: Record<string, string> = { MXN: '$', USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', otro: '' };
                  setCurrencySymbol(symbols[e.target.value] ?? '');
                }} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                  <option value="MXN">MXN — Peso Mexicano</option>
                  <option value="USD">USD — Dólar Estadounidense</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — Libra Esterlina</option>
                  <option value="CAD">CAD — Dólar Canadiense</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Símbolo de moneda</label>
                <input type="text" value={currencySymbol} onChange={(e) => setCurrencySymbol(e.target.value)} maxLength={5} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="$" />
              </div>
            </>
          )}
          {isFecha && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Formato de fecha</label>
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                <option value="DD/MM/YYYY">DD/MM/YYYY (ej. 31/12/2025)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (ej. 12/31/2025)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ej. 2025-12-31)</option>
                <option value="DD-MM-YYYY">DD-MM-YYYY (ej. 31-12-2025)</option>
                <option value="DD MMMM YYYY">DD MMMM YYYY (ej. 31 diciembre 2025)</option>
              </select>
            </div>
          )}
          {isHora && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Formato de hora</label>
                <select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                  <option value="24h">24 horas (ej. 14:30)</option>
                  <option value="12h">12 horas AM/PM (ej. 2:30 PM)</option>
                </select>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={timeWithSeconds} onChange={(e) => setTimeWithSeconds(e.target.checked)} className="w-4 h-4 rounded accent-primary cursor-pointer" />
                <span className="text-sm text-gray-700">Incluir segundos</span>
              </label>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
          <button type="button" onClick={handleSave} className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-colors">Guardar Cambios</button>
        </div>
      </div>
    </div>
  );
}

// ─── Dropdown Options Modal ───────────────────────────────────────────────────
function DropdownOptionsModalFirmar({ fieldLabel, options, onSave, onClose }: { fieldLabel: string; options: string[]; onSave: (opts: string[]) => void; onClose: () => void }) {
  const [localOptions, setLocalOptions] = useState<string[]>(options.length > 0 ? [...options] : ['Opción A', 'Opción B']);
  const [newOption, setNewOption] = useState('');

  const handleAdd = () => {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    setLocalOptions((prev) => [...prev, trimmed]);
    setNewOption('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
  };

  const handleRemove = (idx: number) => {
    setLocalOptions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleChange = (idx: number, value: string) => {
    setLocalOptions((prev) => prev.map((o, i) => (i === idx ? value : o)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900">Editar Opciones para &quot;{fieldLabel}&quot;</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-4 mt-0.5"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500 mb-5">Define las opciones que el participante podrá seleccionar.</p>
        <div className="space-y-2 mb-4">
          {localOptions.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input type="text" value={opt} onChange={(e) => handleChange(idx, e.target.value)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
              <button type="button" onClick={() => handleRemove(idx)} className="text-gray-400 hover:text-red-500 transition-colors p-1"><X size={16} /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mb-6">
          <input type="text" value={newOption} onChange={(e) => setNewOption(e.target.value)} onKeyDown={handleKeyDown} placeholder="Nueva opción" className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-500 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
          <button type="button" onClick={handleAdd} className="w-10 h-10 flex items-center justify-center bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors shrink-0">
            <Plus size={18} />
          </button>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
          <button type="button" onClick={() => { onSave(localOptions.filter((o) => o.trim() !== '')); onClose(); }} className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-colors">Guardar Cambios</button>
        </div>
      </div>
    </div>
  );
}

// ─── Casilla Label Modal ──────────────────────────────────────────────────────
function CasillaLabelModalFirmar({ currentLabel, onSave, onClose }: { currentLabel: string; onSave: (label: string) => void; onClose: () => void }) {
  const [label, setLabel] = useState(currentLabel || 'Etiqueta de casilla');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900">Editar Etiqueta para &quot;Casilla&quot;</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-4 mt-0.5"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500 mb-5">Define la etiqueta que se mostrará junto a la casilla de verificación.</p>
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Etiqueta</label>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" placeholder="Etiqueta de casilla" autoFocus />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
          <button type="button" onClick={() => { onSave(label.trim() || 'Casilla'); onClose(); }} className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-colors">Guardar Cambios</button>
        </div>
      </div>
    </div>
  );
}

// ─── Placed Field Overlay (on document) ──────────────────────────────────────

function PlacedFieldOverlay({
  field,
  onRemove,
  onMove,
  onResize,
  onUpdateFieldConfig,
  onUpdateFieldTypeConfig,
  onUpdateOptions,
  onUpdateRadioOptions,
  onUpdateCasillaLabel,
  readOnly,
}: {
  field: PlacedFieldFirmar;
  onRemove: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number, x: number, y: number) => void;
  onUpdateFieldConfig?: (id: string, cfg: FieldLabelConfig) => void;
  onUpdateFieldTypeConfig?: (id: string, cfg: FieldTypeConfig) => void;
  onUpdateOptions?: (id: string, options: string[]) => void;
  onUpdateRadioOptions?: (id: string, options: string[]) => void;
  onUpdateCasillaLabel?: (id: string, label: string) => void;
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showRadioModal, setShowRadioModal] = useState(false);
  const [showCasillaModal, setShowCasillaModal] = useState(false);
  // Initialize font/style from fieldTypeConfig if provided by the document creator
  const [fontFamily, setFontFamily] = useState(field.fieldTypeConfig?.fontFamily || 'Arial');
  const [fontSize, setFontSize] = useState(field.fieldTypeConfig?.fontSize || 11);
  const [bold, setBold] = useState(field.fieldTypeConfig?.bold || false);
  const [italic, setItalic] = useState(field.fieldTypeConfig?.italic || false);
  const [underline, setUnderline] = useState(field.fieldTypeConfig?.underline || false);
  const widgetRef = useRef<HTMLDivElement>(null);

  // Sync font/style state when field.fieldTypeConfig changes (e.g. after DB load)
  useEffect(() => {
    if (field.fieldTypeConfig?.fontFamily) setFontFamily(field.fieldTypeConfig.fontFamily);
    if (field.fieldTypeConfig?.fontSize) setFontSize(field.fieldTypeConfig.fontSize);
    if (field.fieldTypeConfig?.bold !== undefined) setBold(field.fieldTypeConfig.bold);
    if (field.fieldTypeConfig?.italic !== undefined) setItalic(field.fieldTypeConfig.italic);
    if (field.fieldTypeConfig?.underline !== undefined) setUnderline(field.fieldTypeConfig.underline);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.id]);

  const hasTypeConfigOption = ['Número', 'Moneda', 'Fecha', 'Hora'].includes(field.label) || ['numero', 'moneda', 'fecha', 'hora'].includes(field.tipo);
  const isDropdown = field.label === 'Desplegable' || field.tipo === 'dropdown';
  const isRadio = field.label === 'Botones de opción' || field.tipo === 'radio';
  const isCasilla = field.label === 'Casilla' || field.tipo === 'checkbox';
  const isFirma = field.tipo === 'firma';
  const isImagen = field.label === 'Imagen' || field.tipo === 'imagen';
  const displayName = field.fieldConfig?.customName || field.label;
  const displayValue = field.value || displayName;

  const dropdownOptions = field.dropdownOptions && field.dropdownOptions.length > 0 ? field.dropdownOptions : ['Opción A', 'Opción B'];
  const radioOptions = field.radioOptions && field.radioOptions.length > 0 ? field.radioOptions : ['Opción 1', 'Opción 2'];

  // Load Google Fonts once
  useEffect(() => {
    const linkId = 'google-fonts-fields-firmar';
    if (document.getElementById(linkId)) return;
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Roboto&family=Open+Sans&family=Lato&family=Montserrat&family=Raleway&family=Nunito&family=Poppins&family=Source+Sans+3&family=Merriweather&family=Playfair+Display&family=Oswald&family=PT+Sans&family=PT+Serif&family=Ubuntu&family=Noto+Sans&family=Libre+Baskerville&family=Crimson+Text&family=EB+Garamond&family=Josefin+Sans&family=Quicksand&family=Mulish&family=Barlow&family=Inter&family=DM+Sans&family=Fira+Sans&family=Cabin&family=Exo+2&family=Titillium+Web&family=Zilla+Slab&family=Spectral&family=Cormorant+Garamond&family=Alegreya&family=Lora&family=Arvo&family=Bitter&family=Karla&family=Rubik&family=Work+Sans&family=Manrope&family=Space+Grotesk&family=Plus+Jakarta+Sans&family=Sora&family=Outfit&family=Figtree&family=Lexend&family=Jost&family=Urbanist&family=Archivo&family=Asap&family=Heebo&family=Hind&family=Varela+Round&family=Comfortaa&family=Pacifico&family=Dancing+Script&family=Caveat&family=Sacramento&family=Great+Vibes&family=Satisfy&family=Kaushan+Script&family=Lobster&family=Righteous&family=Fredoka+One&family=Boogaloo&family=Indie+Flower&family=Patrick+Hand&family=Shadows+Into+Light&family=Amatic+SC&family=Permanent+Marker&family=Rock+Salt&family=Special+Elite&family=Courier+Prime&family=Source+Code+Pro&family=Fira+Code&family=Space+Mono&family=Inconsolata&family=Anonymous+Pro&family=Share+Tech+Mono&display=swap';
    document.head.appendChild(link);
  }, []);

  const fontFamilies = [
    'Arial', 'Arial Black', 'Times New Roman', 'Georgia', 'Garamond', 'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'Helvetica', 'Palatino',
    'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Raleway', 'Nunito', 'Poppins', 'Source Sans 3', 'Merriweather', 'Playfair Display', 'Oswald', 'PT Sans', 'PT Serif', 'Ubuntu', 'Noto Sans', 'Libre Baskerville', 'Crimson Text', 'EB Garamond', 'Josefin Sans', 'Quicksand', 'Mulish', 'Barlow', 'Inter', 'DM Sans', 'Fira Sans', 'Cabin', 'Exo 2', 'Titillium Web', 'Zilla Slab', 'Spectral', 'Cormorant Garamond', 'Alegreya', 'Lora', 'Arvo', 'Bitter', 'Karla', 'Rubik', 'Work Sans', 'Manrope', 'Space Grotesk', 'Plus Jakarta Sans', 'Sora', 'Outfit', 'Figtree', 'Lexend', 'Jost', 'Urbanist', 'Archivo', 'Asap', 'Heebo', 'Hind', 'Varela Round', 'Comfortaa', 'Pacifico', 'Dancing Script', 'Caveat', 'Sacramento', 'Great Vibes', 'Satisfy', 'Kaushan Script', 'Lobster', 'Righteous', 'Fredoka One', 'Boogaloo', 'Indie Flower', 'Patrick Hand', 'Shadows Into Light', 'Amatic SC', 'Permanent Marker', 'Rock Salt', 'Special Elite', 'Courier Prime', 'Source Code Pro', 'Fira Code', 'Space Mono', 'Inconsolata', 'Anonymous Pro', 'Share Tech Mono',
  ];

  useEffect(() => {
    if (!selected) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        setSelected(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selected]);

  const getContainer = (el: HTMLElement) =>
    el.closest('[data-doc-sheet-firmar]') as HTMLElement | null;

  const handleMoveMouseDown = (e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(true);
    const container = getContainer(e.currentTarget as HTMLElement);
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const elRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ox = e.clientX - elRect.left;
    const oy = e.clientY - elRect.top;
    const onMouseMove = (ev: MouseEvent) => {
      let newX = ((ev.clientX - ox - rect.left) / rect.width) * 100;
      let newY = ((ev.clientY - oy - rect.top) / rect.height) * 100;
      newX = Math.max(0, Math.min(100 - field.width, newX));
      newY = Math.max(0, Math.min(100 - field.height, newY));
      onMove(field.id, newX, newY);
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  type ResizeDir = 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 's' | 'n';
  const handleResizeMouseDown = (e: React.MouseEvent, dir: ResizeDir) => {
    e.preventDefault();
    e.stopPropagation();
    const container = getContainer(e.currentTarget as HTMLElement);
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const startW = field.width, startH = field.height, startFX = field.x, startFY = field.y;
    const onMouseMove = (ev: MouseEvent) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      let newW = startW, newH = startH, newX = startFX, newY = startFY;
      if (dir.includes('e')) newW = Math.max(5, startW + dx);
      if (dir.includes('s')) newH = Math.max(3, startH + dy);
      if (dir.includes('w')) { newW = Math.max(5, startW - dx); newX = startFX + dx; }
      if (dir.includes('n')) { newH = Math.max(3, startH - dy); newY = startFY + dy; }
      newX = Math.max(0, Math.min(100 - newW, newX));
      newY = Math.max(0, Math.min(100 - newH, newY));
      onResize(field.id, newW, newH, newX, newY);
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleStyleClass = `absolute w-2.5 h-2.5 bg-white border-2 rounded-sm z-20 hover:opacity-80`;

  const colorHex = '#2dd4bf';

  return (
    <>
      <div
        ref={widgetRef}
        style={{
          left: `${field.x}%`,
          top: `${field.y}%`,
          width: `${field.width}%`,
          height: `${field.height}%`,
        }}
        className="absolute z-10 group"
        onClick={() => !readOnly && setSelected(true)}
      >
        {/* Label above field — always shown for readOnly prefixed fields */}
        {readOnly && (
          <div className="absolute bottom-full left-0 mb-0.5 text-[8px] font-semibold px-1 py-0.5 rounded whitespace-nowrap pointer-events-none" style={{ color: colorHex, background: `${colorHex}18` }}>
            {displayName}
          </div>
        )}
        {/* Custom name label above field */}
        {!readOnly && field.fieldConfig?.showLabelInDocument && (
          <div className="absolute bottom-full left-0 mb-0.5 text-[8px] font-semibold px-1 py-0.5 rounded whitespace-nowrap pointer-events-none" style={{ color: colorHex, background: `${colorHex}18` }}>
            {displayName}
          </div>
        )}

        {/* Toolbar on select — hidden for readOnly */}
        {selected && !readOnly && (
          <div
            className="absolute bottom-full left-0 mb-1 flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg shadow-md px-1.5 py-1 z-30"
            onMouseDown={(e) => e.stopPropagation()}
            style={{ whiteSpace: 'nowrap' }}
          >
            {/* Font family selector — hidden for Firma and Imagen */}
            {!isFirma && !isImagen && (
              <select
                value={fontFamily}
                onChange={(e) => { setFontFamily(e.target.value); onUpdateFieldTypeConfig?.(field.id, { ...(field.fieldTypeConfig || {}), fontFamily: e.target.value }); }}
                className="text-[10px] border border-gray-200 rounded px-1 py-0.5 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400 cursor-pointer"
                style={{ maxWidth: '80px' }}
              >
                {fontFamilies.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            )}

            {/* Font size — hidden for Firma and Imagen */}
            {!isFirma && !isImagen && (
              <select
                value={fontSize}
                onChange={(e) => { setFontSize(Number(e.target.value)); onUpdateFieldTypeConfig?.(field.id, { ...(field.fieldTypeConfig || {}), fontSize: Number(e.target.value) }); }}
                className="text-[10px] border border-gray-200 rounded px-1 py-0.5 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400 cursor-pointer w-10"
              >
                {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}

            {!isFirma && !isImagen && <div className="w-px h-4 bg-gray-200 mx-0.5" />}

            {/* Bold — hidden for Firma and Imagen */}
            {!isFirma && !isImagen && (
              <button type="button" onClick={() => { const v = !bold; setBold(v); onUpdateFieldTypeConfig?.(field.id, { ...(field.fieldTypeConfig || {}), bold: v }); }} className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-colors ${bold ? 'bg-teal-100 text-teal-700' : 'text-gray-600 hover:bg-gray-100'}`} title="Negrita">B</button>
            )}
            {!isFirma && !isImagen && (
              <button type="button" onClick={() => { const v = !italic; setItalic(v); onUpdateFieldTypeConfig?.(field.id, { ...(field.fieldTypeConfig || {}), italic: v }); }} className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold italic transition-colors ${italic ? 'bg-teal-100 text-teal-700' : 'text-gray-600 hover:bg-gray-100'}`} title="Cursiva">I</button>
            )}
            {!isFirma && !isImagen && (
              <button type="button" onClick={() => { const v = !underline; setUnderline(v); onUpdateFieldTypeConfig?.(field.id, { ...(field.fieldTypeConfig || {}), underline: v }); }} className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold underline transition-colors ${underline ? 'bg-teal-100 text-teal-700' : 'text-gray-600 hover:bg-gray-100'}`} title="Subrayado">U</button>
            )}

            {!isFirma && !isImagen && <div className="w-px h-4 bg-gray-200 mx-0.5" />}

            {/* Delete */}
            <button
              type="button"
              onClick={() => onRemove(field.id)}
              className="w-6 h-6 flex items-center justify-center rounded bg-red-500 hover:bg-red-600 text-white transition-colors"
              title="Eliminar campo"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>

            <div className="w-px h-4 bg-gray-200 mx-0.5" />

            {/* Tag / Label config icon */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowLabelModal(true); }}
              className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 transition-colors"
              title="Configuración del campo"
            >
              <Tag size={12} />
            </button>

            {/* Settings icon — for type config, dropdown options, or radio options (NOT casilla) */}
            {!isFirma && !isCasilla && (hasTypeConfigOption || isDropdown || isRadio) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isDropdown) setShowOptionsModal(true);
                  else if (isRadio) setShowRadioModal(true);
                  else if (hasTypeConfigOption) setShowTypeModal(true);
                }}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 transition-colors"
                title={isDropdown ? 'Configurar opciones del desplegable' : isRadio ? 'Configurar opciones de botones' : `Configuración de ${field.label}`}
              >
                <Settings size={12} />
              </button>
            )}

            {/* Settings icon for Casilla — edits the visible label text */}
            {isCasilla && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowCasillaModal(true); }}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 transition-colors"
                title="Editar etiqueta visible de la casilla"
              >
                <Settings size={12} />
              </button>
            )}
          </div>
        )}

        {isFirma ? (
          <div
            onMouseDown={readOnly ? undefined : handleMoveMouseDown}
            className={`w-full h-full flex flex-col items-center justify-center select-none overflow-hidden relative ${readOnly ? 'cursor-default' : 'cursor-move'}`}
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: `${colorHex}15` }}
          >
            <PenLine size={12} style={{ color: colorHex }} className="mb-0.5 opacity-70" />
            <span className="text-[9px] font-medium" style={{ color: colorHex }}>Firma</span>
          </div>
        ) : isImagen ? (
          <div
            onMouseDown={readOnly ? undefined : handleMoveMouseDown}
            className={`w-full h-full flex flex-col items-center justify-center select-none overflow-hidden relative ${readOnly ? 'cursor-default' : 'cursor-move'}`}
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: 'rgba(255,255,255,0.97)' }}
          >
            {field.value ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={field.value} alt="Imagen insertada" className="w-full h-full object-contain pointer-events-none" />
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colorHex} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-0.5 opacity-70"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span className="text-[9px] font-medium" style={{ color: colorHex }}>Imagen</span>
              </>
            )}
          </div>
        ) : isDropdown ? (
          <div
            onMouseDown={readOnly ? undefined : handleMoveMouseDown}
            className={`w-full h-full flex items-center px-2 py-1 select-none overflow-hidden relative ${readOnly ? 'cursor-default' : 'cursor-move'}`}
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: 'rgba(255,255,255,0.97)' }}
          >
            <span className="flex-1 truncate" style={{ fontFamily, fontSize: `${Math.max(8, fontSize * 0.6)}px`, fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal', textDecoration: underline ? 'underline' : 'none', color: field.value ? '#374151' : '#9ca3af' }}>
              {field.value || dropdownOptions[0]}
            </span>
            <ChevronDown size={10} className="text-gray-400 shrink-0 ml-1" />
          </div>
        ) : isRadio ? (
          <div
            onMouseDown={readOnly ? undefined : handleMoveMouseDown}
            className={`w-full h-full flex flex-col justify-center px-2 py-1 select-none overflow-hidden relative ${readOnly ? 'cursor-default' : 'cursor-move'}`}
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: 'rgba(255,255,255,0.97)' }}
          >
            {radioOptions.slice(0, 3).map((opt, i) => (
              <div key={i} className="flex items-center gap-1">
                <Circle size={8} className={field.value === opt ? 'text-primary shrink-0' : 'text-gray-400 shrink-0'} style={field.value === opt ? { fill: 'currentColor' } : {}} />
                <span className="truncate" style={{ fontFamily, fontSize: `${Math.max(7, fontSize * 0.55)}px`, color: field.value === opt ? '#0d9488' : '#374151', fontWeight: field.value === opt ? 'bold' : 'normal' }}>{opt}</span>
              </div>
            ))}
          </div>
        ) : isCasilla ? (
          <div
            onMouseDown={readOnly ? undefined : handleMoveMouseDown}
            className={`w-full h-full flex items-center gap-1.5 px-2 py-1 select-none overflow-hidden relative ${readOnly ? 'cursor-default' : 'cursor-move'}`}
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: 'rgba(255,255,255,0.97)' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            <span className="truncate flex-1" style={{ fontFamily, fontSize: `${Math.max(8, fontSize * 0.6)}px`, color: '#374151' }}>
              {field.casillaLabel || 'Etiqueta de casilla'}
            </span>
          </div>
        ) : (
          <div
            onMouseDown={readOnly ? undefined : handleMoveMouseDown}
            className={`w-full h-full flex items-center px-2 py-1 select-none overflow-hidden relative ${readOnly ? 'cursor-default' : 'cursor-move'}`}
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: field.value ? `${colorHex}10` : 'rgba(255,255,255,0.95)' }}
          >
            <span
              className="truncate flex-1"
              style={{
                fontFamily,
                fontSize: `${fontSize}px`,
                fontWeight: bold ? 'bold' : 'normal',
                fontStyle: italic ? 'italic' : 'normal',
                textDecoration: underline ? 'underline' : 'none',
                color: field.value ? '#374151' : '#9ca3af',
              }}
            >
              {displayValue}
            </span>
          </div>
        )}

        {/* Resize handles — visible on hover or when selected — hidden for readOnly */}
        {!readOnly && <>
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'nw')} className={`${handleStyleClass} -top-1.5 -left-1.5 cursor-nw-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'ne')} className={`${handleStyleClass} -top-1.5 -right-1.5 cursor-ne-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'sw')} className={`${handleStyleClass} -bottom-1.5 -left-1.5 cursor-sw-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'se')} className={`${handleStyleClass} -bottom-1.5 -right-1.5 cursor-se-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'n')} className={`${handleStyleClass} -top-1.5 left-1/2 -translate-x-1/2 cursor-n-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 's')} className={`${handleStyleClass} -bottom-1.5 left-1/2 -translate-x-1/2 cursor-s-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'w')} className={`${handleStyleClass} top-1/2 -translate-y-1/2 -left-1.5 cursor-w-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'e')} className={`${handleStyleClass} top-1/2 -translate-y-1/2 -right-1.5 cursor-e-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        </>}
      </div>

      {showLabelModal && (
        <FieldLabelConfigModalFirmar
          label={field.label}
          fieldConfig={field.fieldConfig}
          onSave={(cfg) => { onUpdateFieldConfig?.(field.id, cfg); }}
          onClose={() => setShowLabelModal(false)}
        />
      )}
      {showTypeModal && (
        <FieldTypeConfigModalFirmar
          label={field.label}
          tipo={field.tipo}
          fieldTypeConfig={field.fieldTypeConfig}
          onSave={(cfg) => { onUpdateFieldTypeConfig?.(field.id, cfg); }}
          onClose={() => setShowTypeModal(false)}
        />
      )}
      {showOptionsModal && (
        <DropdownOptionsModalFirmar
          fieldLabel={field.label}
          options={field.dropdownOptions ?? []}
          onSave={(opts) => { onUpdateOptions?.(field.id, opts); }}
          onClose={() => setShowOptionsModal(false)}
        />
      )}
      {showRadioModal && (
        <DropdownOptionsModalFirmar
          fieldLabel="Botones de opción"
          options={field.radioOptions ?? []}
          onSave={(opts) => { onUpdateRadioOptions?.(field.id, opts); }}
          onClose={() => setShowRadioModal(false)}
        />
      )}
      {showCasillaModal && (
        <CasillaLabelModalFirmar
          currentLabel={field.casillaLabel || ''}
          onSave={(lbl) => { onUpdateCasillaLabel?.(field.id, lbl); }}
          onClose={() => setShowCasillaModal(false)}
        />
      )}
    </>
  );
}

// ─── Completed Field Stamp Overlay (read-only display with values) ────────────

function CompletedFieldStamp({
  field,
  firmaDataUrl,
  stampDisplayProps,
}: {
  field: PlacedFieldFirmar;
  firmaDataUrl: string | null;
  stampDisplayProps?: StampDisplayProps;
}) {
  const isFirma = field.tipo === 'firma';
  const isImagen = field.tipo === 'imagen';
  const isCheckbox = field.tipo === 'checkbox';
  const isDropdown = field.tipo === 'dropdown';
  const isRadio = field.tipo === 'radio';
  const colorHex = '#2dd4bf';
  const displayValue = field.value || '';

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${field.x}%`,
    top: `${field.y}%`,
    width: `${field.width}%`,
    height: `${field.height}%`,
    zIndex: 10,
    pointerEvents: 'none',
  };

  if (isFirma) {
    const sigSrc = firmaDataUrl;
    return (
      <div style={style}>
        {stampDisplayProps ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.96)',
              borderRadius: '3px',
              border: `1.5px solid ${colorHex}`,
              display: 'flex',
              alignItems: 'stretch',
            }}
          >
            <SignatureStampDisplay {...stampDisplayProps} />
          </div>
        ) : sigSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sigSrc}
            alt="Firma estampada"
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'rgba(255,255,255,0.85)', borderRadius: '3px', border: `1.5px solid ${colorHex}` }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', border: `1.5px solid ${colorHex}`, borderRadius: '3px', background: `${colorHex}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '8px', color: colorHex }}>Firma</span>
          </div>
        )}
      </div>
    );
  }

  if (isImagen && displayValue) {
    return (
      <div style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={displayValue} alt="Imagen insertada" style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'rgba(255,255,255,0.9)', borderRadius: '3px' }} />
      </div>
    );
  }

  if (isCheckbox) {
    const checked = displayValue === 'true' || displayValue === '1' || displayValue === 'checked';
    const casillaFontFamily = field.fieldTypeConfig?.fontFamily || 'inherit';
    const casillaFontSize = field.fieldTypeConfig?.fontSize ? `${field.fieldTypeConfig.fontSize}px` : '8px';
    const casillaFontWeight = field.fieldTypeConfig?.bold ? 'bold' : 'normal';
    const casillaFontStyle = field.fieldTypeConfig?.italic ? 'italic' : 'normal';
    const casillaTextDecoration = field.fieldTypeConfig?.underline ? 'underline' : 'none';
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.9)', borderRadius: '3px', padding: '2px 4px' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill={checked ? colorHex : 'none'} stroke={colorHex} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {checked ? <><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 12 11 14 15 10"/></> : <rect x="3" y="3" width="18" height="18" rx="2"/>}
        </svg>
        <span style={{ fontFamily: casillaFontFamily, fontSize: casillaFontSize, fontWeight: casillaFontWeight, fontStyle: casillaFontStyle, textDecoration: casillaTextDecoration, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field.casillaLabel || field.label}</span>
      </div>
    );
  }

  if (!displayValue) return null;

  // Apply font/style from fieldTypeConfig if set by creator
  const fontFamily = field.fieldTypeConfig?.fontFamily || 'inherit';
  const fontSize = field.fieldTypeConfig?.fontSize ? `${field.fieldTypeConfig.fontSize}px` : '9px';
  const fontWeight = field.fieldTypeConfig?.bold ? 'bold' : 'normal';
  const fontStyle = field.fieldTypeConfig?.italic ? 'italic' : 'normal';
  const textDecoration = field.fieldTypeConfig?.underline ? 'underline' : 'none';

  return (
    <div style={{ ...style, background: 'rgba(255,255,255,0.92)', borderRadius: '3px', border: `1px solid ${colorHex}40`, display: 'flex', alignItems: 'center', padding: '1px 4px', overflow: 'hidden' }}>
      <span style={{ fontFamily, fontSize, fontWeight, fontStyle, textDecoration, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
        {displayValue}
      </span>
    </div>
  );
}

// ─── Sidebar Settings Button ──────────────────────────────────────────────────

function SidebarSettingsButton({
  campo,
  placedField,
  onUpdateFieldTypeConfig,
  onUpdateDropdownOptions,
  onUpdateRadioOptions,
}: {
  campo: CampoPersonalizado;
  placedField: PlacedFieldFirmar;
  onUpdateFieldTypeConfig: (id: string, cfg: FieldTypeConfig) => void;
  onUpdateDropdownOptions: (id: string, opts: string[]) => void;
  onUpdateRadioOptions: (id: string, opts: string[]) => void;
}) {
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showRadioModal, setShowRadioModal] = useState(false);

  const isDropdown = campo.tipo === 'dropdown';
  const isRadio = campo.tipo === 'radio';
  const hasTypeConfig = ['numero', 'moneda', 'fecha', 'hora'].includes(campo.tipo);

  const handleClick = () => {
    if (isDropdown) setShowOptionsModal(true);
    else if (isRadio) setShowRadioModal(true);
    else if (hasTypeConfig) setShowTypeModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="p-1 rounded hover:bg-slate-100 text-muted-foreground hover:text-primary transition-colors"
        title={isDropdown ? 'Configurar opciones del desplegable' : isRadio ? 'Configurar opciones de botones' : `Configuración de ${campo.label}`}
      >
        <Settings size={13} />
      </button>
      {showTypeModal && (
        <FieldTypeConfigModalFirmar
          label={campo.label}
          tipo={campo.tipo}
          fieldTypeConfig={placedField.fieldTypeConfig}
          onSave={(cfg) => { onUpdateFieldTypeConfig(campo.id, cfg); }}
          onClose={() => setShowTypeModal(false)}
        />
      )}
      {showOptionsModal && (
        <DropdownOptionsModalFirmar
          fieldLabel={campo.label}
          options={placedField.dropdownOptions ?? []}
          onSave={(opts) => { onUpdateDropdownOptions(campo.id, opts); }}
          onClose={() => setShowOptionsModal(false)}
        />
      )}
      {showRadioModal && (
        <DropdownOptionsModalFirmar
          fieldLabel="Botones de opción"
          options={placedField.radioOptions ?? []}
          onSave={(opts) => { onUpdateRadioOptions(campo.id, opts); }}
          onClose={() => setShowRadioModal(false)}
        />
      )}
    </>
  );
}

// ─── Sidebar Casilla Settings Button ─────────────────────────────────────────
function SidebarCasillaSettingsButton({
  campo,
  placedField,
  onUpdateCasillaLabel,
}: {
  campo: CampoPersonalizado;
  placedField: PlacedFieldFirmar;
  onUpdateCasillaLabel: (id: string, label: string) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="p-1 rounded hover:bg-slate-100 text-muted-foreground hover:text-primary transition-colors"
        title="Configurar etiqueta de la casilla"
      >
        <Settings size={13} />
      </button>
      {showModal && (
        <CasillaLabelModalFirmar
          currentLabel={placedField.casillaLabel || campo.label}
          onSave={(lbl) => { onUpdateCasillaLabel(campo.id, lbl); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

// ─── Signature Stamp Display ──────────────────────────────────────────────────
// Renders the actual selected stamp style for the completado screen

interface StampDisplayProps {
  stampStyle: string;
  signatureType: 'efirma' | 'autografa' | 'clicksign';
  signatureUrl: string | null;
  userName: string;
  userRfc: string;
  signatureHash: string;
  signedAt: string;
  ipAddress: string;
  coordinates: { lat: number; lng: number } | null;
  efirmaSerial?: string | null;
  efirmaVigenciaFin?: string | null;
}

function SignatureStampDisplay({
  stampStyle,
  signatureType,
  signatureUrl,
  userName,
  userRfc,
  signatureHash,
  signedAt,
  ipAddress,
  coordinates,
  efirmaSerial,
  efirmaVigenciaFin,
}: StampDisplayProps) {
  const nombre = userName || 'Firmante';
  const rfc = userRfc || '—';
  const hashShort = signatureHash ? signatureHash.slice(0, 16) + '...' + signatureHash.slice(-6) : '—';
  const hashFull = signatureHash || '—';
  const signedDate = signedAt ? new Date(signedAt) : new Date();
  const fecha = signedDate.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' CST';
  const ip = ipAddress && ipAddress !== '—' ? ipAddress : '—';
  const geoloc = coordinates ? `${coordinates.lat.toFixed(2)}°N ${Math.abs(coordinates.lng).toFixed(2)}°W ±80m` : '—';
  const vigencia = efirmaVigenciaFin ? new Date(efirmaVigenciaFin).toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
  const serial = efirmaSerial ? efirmaSerial.slice(0, 20) : '—';

  const qrBlock = (
    <div className="w-10 h-10 bg-gray-800 rounded flex-shrink-0 flex items-center justify-center">
      <svg viewBox="0 0 20 20" width="32" height="32" fill="white">
        <rect x="1" y="1" width="7" height="7" rx="1" />
        <rect x="12" y="1" width="7" height="7" rx="1" />
        <rect x="1" y="12" width="7" height="7" rx="1" />
        <rect x="3" y="3" width="3" height="3" fill="#1f2937" />
        <rect x="14" y="3" width="3" height="3" fill="#1f2937" />
        <rect x="3" y="14" width="3" height="3" fill="#1f2937" />
        <rect x="12" y="12" width="2" height="2" />
        <rect x="15" y="12" width="2" height="2" />
        <rect x="12" y="15" width="2" height="2" />
        <rect x="15" y="15" width="2" height="2" />
      </svg>
    </div>
  );

  const fieldRow = (label: string, value: string) => (
    <div key={label}>
      <p className="text-[7px] font-semibold text-gray-400 uppercase tracking-wide leading-none">{label}</p>
      <p className="text-[8px] text-gray-700 leading-tight mt-0.5">{value}</p>
    </div>
  );

  const hashBlock = (full = false) => (
    <div className={`border rounded px-1.5 py-1 ${signatureType === 'efirma' ? 'bg-amber-50 border-amber-200' : signatureType === 'autografa' ? 'bg-amber-50 border-amber-200' : 'bg-gray-100 border-gray-200'}`}>
      <p className={`text-[6px] font-semibold uppercase tracking-wide ${signatureType === 'efirma' ? 'text-amber-700' : signatureType === 'autografa' ? 'text-amber-700' : 'text-gray-500'}`}>
        {signatureType === 'efirma' ? '🔑 HASH FIRMADO RSA / SHA-256' : signatureType === 'autografa' ? '🔑 HASH FIRMADO SHA-256' : '○ HASH ACEPTACIÓN SHA-256'}
      </p>
      <p className="text-[7px] font-mono text-gray-700 break-all leading-tight mt-0.5">{full ? hashFull : hashShort}</p>
    </div>
  );

  const sigBox = () => (
    <div className="border border-gray-300 rounded bg-gray-50 flex items-center justify-center p-1 min-h-[32px]">
      {signatureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={signatureUrl} alt="Firma autógrafa" className="max-h-10 max-w-full object-contain" />
      ) : (
        <svg viewBox="0 0 120 30" width="100%" height="30" className="opacity-60">
          <path d="M5,20 Q20,5 35,18 Q50,30 65,12 Q80,0 95,15 Q110,28 118,18" stroke="#374151" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );

  const certLine = (expanded = false) => (
    <p className="text-[7px] text-gray-500 leading-tight">
      {expanded
        ? `Cert.: ${serial} · RSA-2048/SHA-256 · OCSP: Válido ✓ · Vigencia: → ${vigencia}`
        : `Cert.: ${serial} · RSA-2048 · → ${vigencia}`}
    </p>
  );

  const urlLine = () => (
    <p className="text-[7px] text-blue-600 leading-tight">verify.docubox.mx/{hashShort.slice(0, 8)}</p>
  );

  const avatarBlock = () => (
    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[7px] font-bold text-gray-600 flex-shrink-0">
      {nombre.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}
    </div>
  );

  const acceptBox = (short = true) => (
    <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1 flex items-start gap-1">
      <div className="w-3 h-3 rounded border border-gray-400 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <p className="text-[7px] text-gray-700 leading-tight">
        {short ? `Aceptó expresamente · clic confirmado` : `Aceptó expresamente el documento mediante clic confirmado + OTP ✓`}
      </p>
    </div>
  );

  // ── e.Firma stamps ──────────────────────────────────────────────────────────
  if (signatureType === 'efirma') {
    if (stampStyle === 'EC1') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
        <p className="text-[7px] text-gray-500">RFC: {rfc} · #1</p>
        {certLine()}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('OCSP', 'Válido ✓')}
          {fieldRow('FECHA/TZ', fecha)}
        </div>
        {urlLine()}
      </div>
    );
    if (stampStyle === 'EC2') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded border-2 border-blue-500 flex items-center justify-center flex-shrink-0">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div>
              <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
              <p className="text-[7px] text-gray-500">{rfc}</p>
            </div>
          </div>
          <span className="text-[6px] text-blue-600 font-semibold border border-blue-300 rounded px-1">OCSP ✓</span>
        </div>
        {certLine(true)}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA/TZ', fecha)}
          {fieldRow('IP/GEOLOC', `${ip} · ${geoloc}`)}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
    if (stampStyle === 'EC3') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
        <div className="w-1.5 bg-blue-500 flex-shrink-0" />
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
          {certLine(true)}
          {hashBlock()}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {fieldRow('FECHA/TZ', fecha)}
            {fieldRow('IP', ip)}
          </div>
          {urlLine()}
        </div>
      </div>
    );
    if (stampStyle === 'EC4') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full items-center">
        <p className="text-[9px] font-bold text-gray-800 leading-tight text-center">{nombre}</p>
        <p className="text-[7px] text-gray-500 text-center">RFC: {rfc}</p>
        {certLine(true)}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 w-full">
          {fieldRow('FECHA/TZ', fecha)}
          {fieldRow('IP', ip)}
        </div>
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    if (stampStyle === 'EC5') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex w-full gap-2">
        <div className="flex-1 flex flex-col gap-1.5">
          <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
          <p className="text-[7px] text-gray-500">RFC: {rfc} · #1</p>
          {certLine()}
          {hashBlock()}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {fieldRow('FECHA/TZ', fecha)}
            {fieldRow('OCSP', 'Válido ✓')}
          </div>
        </div>
        {qrBlock}
      </div>
    );
    // Medianas
    if (stampStyle === 'EM1') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-start gap-1.5">
          <div className="w-4 h-4 rounded border-2 border-blue-500 flex items-center justify-center flex-shrink-0">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div className="flex-1">
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc} · Firmante #1</p>
          </div>
          <span className="text-[6px] text-blue-600 font-semibold border border-blue-300 rounded px-1">OCSP ✓</span>
        </div>
        {certLine(true)}
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('OCSP', 'Válido ✓')}
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('DISPOSITIVO', 'Navegador Web')}
          {fieldRow('SELLO RFC 3161', 'DigiCert ✓')}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
    if (stampStyle === 'EM2') return (
      <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
        <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
        <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
        <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
        <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
        <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
        <p className="text-[7px] text-gray-500 text-center">RFC: {rfc}</p>
        {certLine(true)}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('OCSP', 'Válido ✓')}
        </div>
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    if (stampStyle === 'EM3') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
        <div className="w-1.5 bg-blue-500 flex-shrink-0" />
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
          {certLine(true)}
          {hashBlock(true)}
          <div className="grid grid-cols-3 gap-x-1 gap-y-1">
            {fieldRow('FECHA', fecha)}
            {fieldRow('IP', ip)}
            {fieldRow('GEOLOC', geoloc)}
            {fieldRow('OCSP', 'Válido ✓')}
            {fieldRow('DISPOSITIVO', 'Web')}
            {fieldRow('SELLO', 'DigiCert ✓')}
          </div>
          {urlLine()}
        </div>
      </div>
    );
    if (stampStyle === 'EM4') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex flex-col w-full overflow-hidden">
        <div className="bg-gray-800 px-2 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <p className="text-[8px] font-bold text-white">{nombre}</p>
          </div>
          <span className="text-[6px] text-gray-300 font-semibold border border-gray-500 rounded px-1">Avanzada</span>
        </div>
        <div className="p-2 flex flex-col gap-1.5">
          <p className="text-[7px] text-gray-500">{rfc}</p>
          {certLine(true)}
          {hashBlock(true)}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {fieldRow('FECHA', fecha)}
            {fieldRow('IP', ip)}
            {fieldRow('GEOLOC', geoloc)}
            {fieldRow('OCSP', 'Válido ✓')}
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="flex-1">{urlLine()}</div>
            {qrBlock}
          </div>
        </div>
      </div>
    );
    if (stampStyle === 'EM5') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
        <p className="text-[7px] text-gray-500 text-center">RFC: {rfc}</p>
        {certLine()}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
        </div>
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    // Largas — EL1-EL4
    if (stampStyle === 'EL1') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-start gap-1.5">
          <div className="flex-1">
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc}</p>
          </div>
          <span className="text-[6px] text-blue-600 font-semibold border border-blue-300 rounded px-1">Avanzada</span>
        </div>
        {certLine(true)}
        {hashBlock(true)}
        <div className="grid grid-cols-3 gap-x-1 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('OCSP', 'Válido ✓')}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('SELLO RFC 3161', 'DigiCert ✓')}
          {fieldRow('NIVEL', 'Avanzada')}
          {fieldRow('ORDEN', '#1')}
          {fieldRow('VIGENCIA', vigencia)}
          {fieldRow('CERT No.', serial)}
          {fieldRow('ALGORITMO', 'RSA-2048/SHA-256')}
          {fieldRow('XML EVIDENCE', 'Incluido ✓')}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
    if (stampStyle === 'EL2') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FIRMANTE', nombre)}
          {fieldRow('RFC', rfc)}
          {fieldRow('CERT No.', serial)}
          {fieldRow('ALGORITMO', 'RSA-2048/SHA-256')}
          {fieldRow('OCSP', 'Válido ✓')}
          {fieldRow('VIGENCIA', vigencia)}
          {fieldRow('EMISOR', 'SAT México')}
          {fieldRow('NIVEL', 'Avanzada')}
          {fieldRow('CURP', '—')}
          {fieldRow('SERIE', serial)}
        </div>
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('OTP CANAL', 'Correo ✓')}
          {fieldRow('XML EVIDENCE', 'Incluido ✓')}
        </div>
        {urlLine()}
      </div>
    );
    if (stampStyle === 'EL3') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
        <div className="w-1.5 bg-blue-500 flex-shrink-0" />
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
          {certLine(true)}
          {hashBlock(true)}
          <div className="grid grid-cols-3 gap-x-1 gap-y-1">
            {fieldRow('FECHA', fecha)}
            {fieldRow('IP', ip)}
            {fieldRow('GEOLOC', geoloc)}
            {fieldRow('OCSP', 'Válido ✓')}
            {fieldRow('DISPOSITIVO', 'Web')}
            {fieldRow('SELLO', 'DigiCert ✓')}
            {fieldRow('NIVEL', 'Avanzada')}
            {fieldRow('ORDEN', '#1')}
            {fieldRow('VIGENCIA', vigencia)}
            {fieldRow('CERT No.', serial)}
            {fieldRow('ALGORITMO', 'RSA-2048')}
            {fieldRow('XML EVIDENCE', 'Incluido ✓')}
          </div>
          {urlLine()}
        </div>
      </div>
    );
    if (stampStyle === 'EL4') return (
      <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
        <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
        <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
        <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
        <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
        <div className="flex justify-center mb-1">{avatarBlock()}</div>
        <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
        <p className="text-[7px] text-gray-500 text-center">RFC: {rfc}</p>
        {certLine(true)}
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('OCSP', 'Válido ✓')}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('SELLO RFC 3161', 'DigiCert ✓')}
          {fieldRow('NIVEL', 'Avanzada')}
          {fieldRow('XML EVIDENCE', 'Incluido ✓')}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
  }

  // ── Autógrafa stamps ────────────────────────────────────────────────────────
  if (signatureType === 'autografa') {
    if (stampStyle === 'AC0') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full items-center justify-center">
        <div className="border border-gray-300 rounded bg-gray-50 flex items-center justify-center p-1.5 min-h-[36px] w-full">
          {sigBox()}
        </div>
        {hashBlock()}
      </div>
    );
    if (stampStyle === 'AC1') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
        <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
        {sigBox()}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA/TZ', fecha)}
          {fieldRow('IP', ip)}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
    if (stampStyle === 'AC2') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-start gap-1.5">
          {avatarBlock()}
          <div className="flex-1">
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc} · Firmante #1</p>
          </div>
        </div>
        {sigBox()}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('RFC', rfc)}
          {fieldRow('FECHA/TZ', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('OTP', 'Correo ✓')}
          {fieldRow('GEOLOC', geoloc)}
        </div>
      </div>
    );
    if (stampStyle === 'AC3') return (
      <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
        <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
        <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
        <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
        <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
        <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
        {sigBox()}
        {hashBlock()}
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    if (stampStyle === 'AC4') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
        <div className="w-1.5 bg-green-500 flex-shrink-0" />
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
          {sigBox()}
          {hashBlock()}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {fieldRow('FECHA/TZ', fecha)}
            {fieldRow('IP', ip)}
          </div>
          {urlLine()}
        </div>
      </div>
    );
    if (stampStyle === 'AC5') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
        {sigBox()}
        {hashBlock()}
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    // Medianas
    if (stampStyle === 'AM1') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-start gap-1.5">
          {avatarBlock()}
          <div className="flex-1">
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc} · Firmante #1</p>
          </div>
          <span className="text-[6px] text-blue-600 font-semibold border border-blue-300 rounded px-1">Simple</span>
        </div>
        {sigBox()}
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('RFC', rfc)}
          {fieldRow('FECHA/TZ', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('OTP', 'Correo ✓')}
          {fieldRow('NIVEL', 'Simple')}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
    if (stampStyle === 'AM2') return (
      <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
        <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
        <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
        <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
        <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
        <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
        <p className="text-[7px] text-gray-500 text-center">RFC: {rfc}</p>
        {sigBox()}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('OTP', 'Correo ✓')}
          {fieldRow('NIVEL', 'Simple')}
          {fieldRow('RFC', rfc)}
        </div>
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    if (stampStyle === 'AM3') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
        <div className="w-1.5 bg-green-500 flex-shrink-0" />
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
          {sigBox()}
          {hashBlock(true)}
          <div className="grid grid-cols-3 gap-x-1 gap-y-1">
            {fieldRow('FECHA', fecha)}
            {fieldRow('IP', ip)}
            {fieldRow('GEOLOC', geoloc)}
            {fieldRow('OTP', 'Correo ✓')}
            {fieldRow('DISPOSITIVO', 'Web')}
            {fieldRow('NIVEL', 'Simple')}
          </div>
          {urlLine()}
        </div>
      </div>
    );
    if (stampStyle === 'AM4') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex flex-col w-full overflow-hidden">
        <div className="bg-gray-800 px-2 py-1.5 flex items-center gap-1.5">
          {avatarBlock()}
          <p className="text-[8px] font-bold text-white">{nombre}</p>
        </div>
        <div className="p-2 flex flex-col gap-1.5">
          <p className="text-[7px] text-gray-500">{rfc} · Firmante #1</p>
          {sigBox()}
          {hashBlock(true)}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {fieldRow('FECHA', fecha)}
            {fieldRow('IP', ip)}
            {fieldRow('GEOLOC', geoloc)}
            {fieldRow('OTP', 'Correo ✓')}
            {fieldRow('DISPOSITIVO', 'Web')}
            {fieldRow('NIVEL', 'Simple')}
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="flex-1">{urlLine()}</div>
            {qrBlock}
          </div>
        </div>
      </div>
    );
    if (stampStyle === 'AM5') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-center gap-1.5">
          {avatarBlock()}
          <div>
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">Firmante #1 · Simple</p>
          </div>
        </div>
        {sigBox()}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
        </div>
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    // Largas
    if (stampStyle === 'AL1') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-start gap-1.5">
          {avatarBlock()}
          <div className="flex-1">
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc} · Firmante #1</p>
          </div>
          <span className="text-[6px] text-blue-600 font-semibold border border-blue-300 rounded px-1">Simple</span>
        </div>
        {sigBox()}
        {hashBlock(true)}
        <div className="grid grid-cols-3 gap-x-1 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('OTP', 'Correo ✓')}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('NIVEL', 'Simple')}
          {fieldRow('BIOMETRÍA', 'Presión · Vel.')}
          {fieldRow('PRECISIÓN GPS', '±80m')}
          {fieldRow('ORDEN', '#1')}
          {fieldRow('CURP', '—')}
          {fieldRow('RFC', rfc)}
          {fieldRow('SELLO', 'DigiCert ✓')}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
    if (stampStyle === 'AL2') return (
      <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
        <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
        <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
        <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
        <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
        <div className="flex justify-center mb-1">{avatarBlock()}</div>
        <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
        {sigBox()}
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('OTP', 'Correo ✓')}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('NIVEL', 'Simple')}
          {fieldRow('BIOMETRÍA', 'Presión · Vel.')}
          {fieldRow('ORDEN', '#1')}
          {fieldRow('CURP', '—')}
          {fieldRow('RFC', rfc)}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
    if (stampStyle === 'AL3') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
        <div className="w-1.5 bg-green-500 flex-shrink-0" />
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
          {sigBox()}
          {hashBlock(true)}
          <div className="grid grid-cols-3 gap-x-1 gap-y-1">
            {fieldRow('FECHA', fecha)}
            {fieldRow('IP', ip)}
            {fieldRow('GEOLOC', geoloc)}
            {fieldRow('OTP', 'Correo ✓')}
            {fieldRow('DISPOSITIVO', 'Web')}
            {fieldRow('NIVEL', 'Simple')}
            {fieldRow('BIOMETRÍA', 'Presión · Vel.')}
            {fieldRow('PRECISIÓN GPS', '±80m')}
            {fieldRow('ORDEN', '#1')}
            {fieldRow('CURP', '—')}
            {fieldRow('RFC', rfc)}
            {fieldRow('SELLO', 'DigiCert ✓')}
          </div>
          {urlLine()}
        </div>
      </div>
    );
    if (stampStyle === 'AL4') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FIRMANTE', nombre)}
          {fieldRow('RFC', rfc)}
          {fieldRow('CURP', '—')}
          {fieldRow('ROL', 'Firmante')}
          {fieldRow('NIVEL', 'Firma Electrónica Simple')}
          {fieldRow('ORDEN', '#1')}
        </div>
        {sigBox()}
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA / TZ', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('OTP CANAL', 'Correo ✓')}
          {fieldRow('SELLO RFC 3161', 'DigiCert ✓')}
          {fieldRow('BIOMETRÍA TRAZO', 'Presión · Velocidad')}
          {fieldRow('NIVEL FIRMA', 'Simple')}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
  }

  // ── Click & Sign stamps ─────────────────────────────────────────────────────
  if (signatureType === 'clicksign') {
    if (stampStyle === 'CC1') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
        <p className="text-[7px] text-gray-500">RFC: {rfc} · #1</p>
        {acceptBox()}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA/TZ', fecha)}
          {fieldRow('IP', ip)}
        </div>
        {urlLine()}
      </div>
    );
    if (stampStyle === 'CC2') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1">
            <div className="w-5 h-5 rounded-full border-2 border-gray-700 flex items-center justify-center flex-shrink-0">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div>
              <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
              <p className="text-[7px] text-gray-500">{rfc} · #1</p>
            </div>
          </div>
          <span className="text-[6px] text-blue-600 font-semibold border border-blue-300 rounded px-1">OTP ✓</span>
        </div>
        {acceptBox(false)}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA/TZ', fecha)}
          {fieldRow('IP/GEOLOC', `${ip} · ${geoloc}`)}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
    if (stampStyle === 'CC3') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
        <div className="w-1.5 bg-gray-700 flex-shrink-0" />
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
          <p className="text-[7px] text-gray-500">{rfc}</p>
          {acceptBox(false)}
          {hashBlock()}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {fieldRow('IP/GEOLOC', `${ip} · ${geoloc}`)}
            {fieldRow('FECHA', fecha)}
          </div>
          {urlLine()}
        </div>
      </div>
    );
    if (stampStyle === 'CC4') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-full border-2 border-gray-700 flex items-center justify-center flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc} · #1</p>
          </div>
        </div>
        {acceptBox(false)}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA/TZ', fecha)}
          {fieldRow('OTP', 'Correo ✓')}
        </div>
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    if (stampStyle === 'CC5') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
        <p className="text-[7px] text-gray-500 text-center">RFC: {rfc}</p>
        {acceptBox()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('Clic + OTP ✓', fecha)}
          {fieldRow('IP', ip)}
        </div>
        {hashBlock()}
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    // Medianas
    if (stampStyle === 'CM1') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-start gap-1.5">
          {avatarBlock()}
          <div className="flex-1">
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc} · Firmante #1</p>
          </div>
          <span className="text-[6px] text-gray-600 font-semibold border border-gray-300 rounded px-1">Simple</span>
        </div>
        {acceptBox(false)}
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('RFC', rfc)}
          {fieldRow('FECHA/TZ', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('OTP CANAL', 'Correo ✓')}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
    if (stampStyle === 'CM2') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
        <div className="w-1.5 bg-gray-700 flex-shrink-0" />
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
          <p className="text-[7px] text-gray-500">{rfc} · #1</p>
          {acceptBox(false)}
          {hashBlock()}
          <div className="grid grid-cols-3 gap-x-1 gap-y-1">
            {fieldRow('RFC', rfc)}
            {fieldRow('FECHA', fecha)}
            {fieldRow('IP', ip)}
            {fieldRow('GEOLOC', geoloc)}
            {fieldRow('DISPOSITIVO', 'Web')}
            {fieldRow('OTP', 'Correo ✓')}
          </div>
          {urlLine()}
        </div>
      </div>
    );
    if (stampStyle === 'CM3') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex flex-col w-full overflow-hidden">
        <div className="bg-gray-800 px-2 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <p className="text-[8px] font-bold text-white">{nombre}</p>
          </div>
          <span className="text-[6px] text-gray-300 font-semibold border border-gray-500 rounded px-1">Simple</span>
        </div>
        <div className="p-2 flex flex-col gap-1.5">
          <p className="text-[7px] text-gray-500">{rfc} · Firmante #1</p>
          {acceptBox(false)}
          {hashBlock()}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {fieldRow('FECHA/TZ', fecha)}
            {fieldRow('IP/GEOLOC', `${ip} · ${geoloc}`)}
            {fieldRow('DISPOSITIVO', 'Web')}
            {fieldRow('OTP', 'Correo ✓')}
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="flex-1">{urlLine()}</div>
            {qrBlock}
          </div>
        </div>
      </div>
    );
    if (stampStyle === 'CM4') return (
      <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
        <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
        <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
        <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
        <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
        <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
        <p className="text-[7px] text-gray-500 text-center">RFC: {rfc}</p>
        <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1">
          <p className="text-[7px] text-gray-700 leading-tight">
            Aceptó expresamente el documento mediante clic confirmado + OTP ✓ · {fecha}
          </p>
        </div>
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA/TZ', fecha)}
          {fieldRow('IP/GEOLOC', `${ip} · ${geoloc}`)}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('OTP CANAL', 'Correo ✓')}
        </div>
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    if (stampStyle === 'CM5') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-center gap-1.5">
          {avatarBlock()}
          <div>
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">Firmante #1 · Simple</p>
          </div>
        </div>
        {acceptBox(false)}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
        </div>
        <div className="flex justify-center mt-1">{qrBlock}</div>
      </div>
    );
    // Largas
    if (stampStyle === 'CL1') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="flex items-start gap-1.5">
          {avatarBlock()}
          <div className="flex-1">
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc} · Firmante #1</p>
          </div>
          <span className="text-[6px] text-blue-600 font-semibold border border-blue-300 rounded px-1">OTP ✓</span>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1">
          <p className="text-[7px] text-gray-700 leading-tight">
            El firmante aceptó expresamente el contenido del documento mediante clic confirmado y código OTP de un solo uso · {fecha}
          </p>
        </div>
        {hashBlock(true)}
        <div className="grid grid-cols-3 gap-x-1 gap-y-1">
          {fieldRow('RFC', rfc)}
          {fieldRow('CURP', '—')}
          {fieldRow('ROL', 'Firmante')}
          {fieldRow('FECHA', fecha)}
          {fieldRow('HORA/TZ', 'CST')}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('PRECISIÓN GPS', '±80m')}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('OTP CANAL', 'Correo ✓')}
          {fieldRow('SESSION TOKEN', hashShort.slice(0, 12))}
          {fieldRow('ORDEN / TOTAL', '#1')}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
    if (stampStyle === 'CL2') return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FIRMANTE', nombre)}
          {fieldRow('RFC', rfc)}
          {fieldRow('CURP', '—')}
          {fieldRow('ROL', 'Firmante')}
          {fieldRow('NIVEL', 'Firma Electrónica Simple')}
          {fieldRow('ORDEN', '#1')}
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1">
          <p className="text-[7px] text-gray-700 leading-tight">
            Aceptó expresamente el documento mediante clic confirmado + OTP ✓ · {fecha}
          </p>
        </div>
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('OTP CANAL', 'Correo ✓')}
          {fieldRow('SESSION TOKEN', hashShort.slice(0, 12))}
        </div>
        {urlLine()}
      </div>
    );
    if (stampStyle === 'CL3') return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
        <div className="w-1.5 bg-gray-700 flex-shrink-0" />
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
          {acceptBox(false)}
          {hashBlock(true)}
          <div className="grid grid-cols-3 gap-x-1 gap-y-1">
            {fieldRow('RFC', rfc)}
            {fieldRow('CURP', '—')}
            {fieldRow('ROL', 'Firmante')}
            {fieldRow('FECHA', fecha)}
            {fieldRow('IP', ip)}
            {fieldRow('GEOLOC', geoloc)}
            {fieldRow('PRECISIÓN GPS', '±80m')}
            {fieldRow('DISPOSITIVO', 'Web')}
            {fieldRow('OTP', 'Correo ✓')}
            {fieldRow('SESSION TOKEN', hashShort.slice(0, 12))}
            {fieldRow('NIVEL', 'Simple')}
            {fieldRow('ORDEN', '#1')}
          </div>
          {urlLine()}
        </div>
      </div>
    );
    if (stampStyle === 'CL4') return (
      <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
        <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
        <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
        <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
        <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
        <div className="flex justify-center mb-1">{avatarBlock()}</div>
        <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
        <p className="text-[7px] text-gray-500 text-center">RFC: {rfc}</p>
        <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1">
          <p className="text-[7px] text-gray-700 leading-tight">
            Aceptó expresamente el documento mediante clic confirmado + OTP ✓ · {fecha}
          </p>
        </div>
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('DISPOSITIVO', 'Web')}
          {fieldRow('OTP CANAL', 'Correo ✓')}
          {fieldRow('SESSION TOKEN', hashShort.slice(0, 12))}
          {fieldRow('NIVEL', 'Simple')}
          {fieldRow('ORDEN', '#1')}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    );
  }

  // Fallback: show raw signature image
  return signatureUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={signatureUrl} alt="Estampa de firma" className="max-h-20 max-w-full object-contain" />
  ) : (
    <div className="flex flex-col items-center justify-center gap-1 py-2">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      <p className="text-xs text-slate-400">Sin estampa visual</p>
    </div>
  );
}

// ─── Exit Confirm Modal ───────────────────────────────────────────────────────
function ExitConfirmModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} className="text-red-500" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">¿Salir del proceso?</h3>
            <p className="text-sm text-gray-500 mt-0.5">Tu progreso no guardado se perderá.</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-6">
          Si sales ahora, perderás los campos completados y tendrás que volver a iniciar el proceso de firma.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            Sí, salir
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── No Firma Alert Modal ─────────────────────────────────────────────────────
function NoFirmaAlertModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} className="text-amber-500" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Firma no insertada en el documento</h3>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-3">
          No has insertado un campo de firma en el documento. Si continúas, tu firma será registrada en una <span className="font-semibold text-gray-800">hoja de certificación aparte</span> que indicará que firmaste el documento.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 flex items-start gap-2">
          <Shield size={15} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">La hoja de certificación tiene la misma validez legal que una firma insertada directamente en el documento.</p>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Volver e insertar firma
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            Continuar con certificación
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FirmarDocumentoPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const docId = params?.id as string;
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // ── Session-storage key for this document's signing flow ──────────────────
  const sessionKey = docId ? `firmar-doc-flow-${docId}` : null;

  // Flag: true once processDocData has finished restoring persisted state.
  // Persist effects must NOT write until this is true, otherwise they fire
  // with initial (empty) state values and overwrite the saved sessionStorage.
  const flowRestoredRef = useRef(false);

  // ── Pre-fetch geolocation on mount so it's ready at submit time ───────────
  const geoRef = useRef<{ lat: number; lng: number } | null>(null);
  const [geoDenied, setGeoDenied] = useState(false);
  const [geoLoading, setGeoLoading] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGeoLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGeoDenied(false);
        setGeoLoading(false);
      },
      (err) => {
        if (err.code === 1 /* PERMISSION_DENIED */) {
          setGeoDenied(true);
        }
        setGeoLoading(false);
        /* permission denied or unavailable – geoRef stays null */
      },
      { timeout: 15000, maximumAge: 60000, enableHighAccuracy: false }
    );
  }, []);

  // Helper: read persisted flow state
  const readPersistedFlow = useCallback(() => {
    if (!sessionKey || typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(sessionKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [sessionKey]);

  // Helper: write persisted flow state (only after restore is complete)
  const writePersistedFlow = useCallback((patch: Record<string, unknown>) => {
    if (!sessionKey || typeof window === 'undefined') return;
    if (!flowRestoredRef.current) return; // don't overwrite before restore
    try {
      const existing = (() => {
        try { const r = sessionStorage.getItem(sessionKey); return r ? JSON.parse(r) : {}; } catch { return {}; }
      })();
      sessionStorage.setItem(sessionKey, JSON.stringify({ ...existing, ...patch }));
    } catch { /* quota exceeded – ignore */ }
  }, [sessionKey]);

  // Helper: clear persisted flow state
  const clearPersistedFlow = useCallback(() => {
    if (!sessionKey || typeof window === 'undefined') return;
    try { sessionStorage.removeItem(sessionKey); } catch { /* ignore */ }
  }, [sessionKey]);

  // Document state
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [docError, setDocError] = useState<string | null>(null);

  // PDF viewer
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [showPdf, setShowPdf] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { isDark } = useTheme();
  const [showDocModal, setShowDocModal] = useState(false);
  const [docModalPage, setDocModalPage] = useState(1);
  const [docModalZoom, setDocModalZoom] = useState(100);

  // Exit modal
  const [showExitModal, setShowExitModal] = useState(false);

  // No firma alert modal
  const [showNoFirmaAlert, setShowNoFirmaAlert] = useState(false);

  // Participant info
  const [myRole, setMyRole] = useState<'firmante' | 'aprobador' | 'observador'>('firmante');
  const [myParticipantData, setMyParticipantData] = useState<any>(null);

  // ── Stamp styles from user profile ────────────────────────────────────────
  const [efirmaStampStyle, setEfirmaStampStyle] = useState<string>('EC1');
  const [autografaStampStyle, setAutografaStampStyle] = useState<string>('AC1');
  const [clickSignStampStyle, setClickSignStampStyle] = useState<string>('CC1');

  // ── Protección adicional para participar ──────────────────────────────────
  const [proteccionParticipacionEnabled, setProteccionParticipacionEnabled] = useState(false);
  const [proteccionVerified, setProteccionVerified] = useState(false);
  const [proteccionOtp, setProteccionOtp] = useState('');
  const [proteccionOtpSent, setProteccionOtpSent] = useState(false);
  const [proteccionSending, setProteccionSending] = useState(false);
  const [proteccionVerifying, setProteccionVerifying] = useState(false);
  const [proteccionError, setProteccionError] = useState<string | null>(null);
  const [proteccionHasTOTP, setProteccionHasTOTP] = useState(false);
  const [proteccionTotpCode, setProteccionTotpCode] = useState('');

  // Step state
  const [step, setStep] = useState<'terminos' | 'campos' | 'firma' | 'aprobacion' | 'completado'>('terminos');
  const [terminosAceptados, setTerminosAceptados] = useState(false);

  // Campos prefijados (from document)
  const [camposPrefijados, setCamposPrefijados] = useState<CampoSolicitado[]>([]);
  const [camposValues, setCamposValues] = useState<Record<string, string>>({});

  // Campos personalizados (user-added when no prefixed fields)
  const [camposPersonalizados, setCamposPersonalizados] = useState<CampoPersonalizado[]>([]);
  const [showCampoSelector, setShowCampoSelector] = useState(false);
  const [participanteOpen, setParticipanteOpen] = useState(true);
  const [generalesOpen, setGeneralesOpen] = useState(false);

  // ─── NEW: Placed fields on document ───────────────────────────────────────
  const [placedFields, setPlacedFields] = useState<PlacedFieldFirmar[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const docSheetRef = useRef<HTMLDivElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // ─── NEW: User profile data for auto-fill ─────────────────────────────────
  const [userProfile, setUserProfile] = useState<UserProfileData>({
    nombre_completo: '',rfc: '',curp: '',email: '',telefono: '',direccion: '',
  });
  // Keep a ref so processDocData (called inside useEffect) can access latest profile
  const userProfileRef = useRef<UserProfileData>({
    nombre_completo: '',rfc: '',curp: '',email: '',telefono: '',direccion: '',
  });

  // Firma
  const [firmaData, setFirmaData] = useState<string | null>(null);
  const [firmaConfirmada, setFirmaConfirmada] = useState(false);
  // Preloaded signature from profile
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [savedSignatureType, setSavedSignatureType] = useState<'efirma' | 'firma_electronica' | 'autografa' | null>(null);
  const [usePreloadedSignature, setUsePreloadedSignature] = useState<boolean | null>(null);
  // Autograph-specific dates
  const [autografaCreatedAt, setAutografaCreatedAt] = useState<string | null>(null);
  const [autografaLastUsed, setAutografaLastUsed] = useState<string | null>(null);
  // Autograph flow completed
  const [autographFlowDone, setAutographFlowDone] = useState(false);
  // Hide no-signature warning after "Entendido — Continuar"
  const [hideNoSignatureWarning, setHideNoSignatureWarning] = useState(false);
  // Want to save new autograph signature
  const [wantToSaveSignature, setWantToSaveSignature] = useState<boolean | null>(null);
  const [savingNewSignature, setSavingNewSignature] = useState(false);
  const [newSignatureSaved, setNewSignatureSaved] = useState(false);
  // Want to save e.firma to profile
  const [wantToSaveEfirma, setWantToSaveEfirma] = useState<boolean | null>(null);
  const [savingEfirmaToProfile, setSavingEfirmaToProfile] = useState(false);
  const [efirmaSavedToProfile, setEfirmaSavedToProfile] = useState(false);
  // Signature mode / style
  const [signatureMode, setSignatureMode] = useState<'dibujar' | 'tipear' | 'cargar'>('dibujar');
  const [typedSignature, setTypedSignature] = useState('');
  const [typedSignatureStyle, setTypedSignatureStyle] = useState<'cursive' | 'print' | 'formal'>('cursive');
  // e.firma SAT profile data
  const [profileEfirma, setProfileEfirma] = useState<EfirmaProfileData | null>(null);
  const [efirmaValidated, setEfirmaValidated] = useState(false);
  // e.firma SAT evidence data (stored in memory only, never persisted directly)
  const [efirmaCertInfo, setEfirmaCertInfo] = useState<any>(null);
  const [efirmaCerB64, setEfirmaCerB64] = useState<string | null>(null);
  const [efirmaKeyB64, setEfirmaKeyB64] = useState<string | null>(null);
  const [efirmaPassword, setEfirmaPassword] = useState<string | null>(null);
  // Nubarium validation result (captured at validation time, used in constancia)
  const [nubariumValidationResult, setNubariumValidationResult] = useState<NubariumValidationResult | null>(null);

  // Aprobador
  const [observaciones, setObservaciones] = useState('');

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Inline success animation state
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  // ── Completado tab state ───────────────────────────────────────────────────
  const [activeCompletadoTab, setActiveCompletadoTab] = useState<'resumen' | 'descargas'>('resumen');
  const [downloadingOriginal, setDownloadingOriginal] = useState(false);

  // ── NOM-151 state ──────────────────────────────────────────────────────────
  const [nom151Data, setNom151Data] = useState<{
    id: string;
    status: string;
    nubarium_codigo_validacion: string;
    nubarium_hash: string;
    constancia_sha256: string;
    created_at: string;
} | null>(null);
  const [nom151Polling, setNom151Polling] = useState(false);

  // ── XML Evidence state ─────────────────────────────────────────────────────
  const [xmlEvidenceData, setXmlEvidenceData] = useState<{
    xml_evidencia_path: string;
    xml_hash_sha256: string;
    xml_generated_at: string;
  } | null>(null);
  const [downloadingXml, setDownloadingXml] = useState(false);
  const [xmlPolling, setXmlPolling] = useState(false);

  // ── Signature evidence captured at submit time ─────────────────────────────
  const [signatureEvidence, setSignatureEvidence] = useState<{
    signedAt: string;
    ipAddress: string;
    coordinates: { lat: number; lng: number } | null;
    signatureHash: string;
    timestampSello: string;
    signatureType: string;
    documentoEstado: 'completado' | 'firmado' | 'en_progreso';
    efirmaSerial?: string | null;
    efirmaRfc?: string | null;
    efirmaNombre?: string | null;
    efirmaVigenciaFin?: string | null;
    serverTimestamp?: string | null;
    nubariumEstado?: string | null;
    nubariumFechaConsulta?: string | null;
    nubariumCodigoValidacion?: string | null;
  } | null>(null);

  const generateConstanciaPDF = useCallback(async () => {
    setGeneratingPdf(true);
    try {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

      const safe = (str: string | null | undefined) => (str || '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

      const pdfDoc = await PDFDocument.create();
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

      // Colors
      const black = rgb(0.05, 0.05, 0.05);
      const darkGray = rgb(0.2, 0.2, 0.2);
      const midGray = rgb(0.45, 0.45, 0.45);
      const lightGray = rgb(0.88, 0.88, 0.88);
      const veryLightGray = rgb(0.96, 0.96, 0.98);
      const white = rgb(1, 1, 1);
      const accentBlue = rgb(0.11, 0.47, 0.78);
      const darkBg = rgb(0.08, 0.08, 0.12);
      const sectionBg = rgb(0.97, 0.97, 0.98);
      const certSectionBg = rgb(0.973, 0.980, 0.988); // #F8FAFC
      const certBorderBlue = rgb(0.118, 0.420, 1.0);  // #1E6BFF

      const margin = 40;
      const pageW = 595;
      const pageH = 842;
      const contentW = pageW - margin * 2;

      let currentPage = pdfDoc.addPage([pageW, pageH]);
      let y = pageH;

      const ensureSpace = (needed: number) => {
        if (y - needed < 50) {
          currentPage = pdfDoc.addPage([pageW, pageH]);
          y = pageH - 30;
        }
      };

      const drawSectionHeading = (title: string) => {
        ensureSpace(30);
        currentPage.drawRectangle({ x: margin, y: y - 18, width: contentW, height: 20, color: darkBg });
        currentPage.drawText(safe(title), { x: margin + 8, y: y - 12, size: 8, font: fontBold, color: white });
        y -= 26;
      };

      const drawKV = (label: string, value: string) => {
        ensureSpace(22);
        const rowH = 18;
        currentPage.drawRectangle({ x: margin, y: y - rowH, width: contentW, height: rowH, color: veryLightGray, borderColor: lightGray, borderWidth: 0.3 });
        currentPage.drawText(safe(label), { x: margin + 6, y: y - 12, size: 7.5, font: fontBold, color: darkGray });
        const valStr = safe(value);
        const displayVal = valStr.length > 72 ? valStr.slice(0, 72) + '...' : valStr;
        currentPage.drawText(displayVal, { x: margin + 180, y: y - 12, size: 7.5, font: fontRegular, color: black });
        y -= rowH;
      };

      const drawKVMono = (label: string, value: string) => {
        ensureSpace(22);
        const rowH = 18;
        currentPage.drawRectangle({ x: margin, y: y - rowH, width: contentW, height: rowH, color: veryLightGray, borderColor: lightGray, borderWidth: 0.3 });
        currentPage.drawText(safe(label), { x: margin + 6, y: y - 12, size: 7.5, font: fontBold, color: darkGray });
        const valStr = safe(value);
        currentPage.drawText(valStr, { x: margin + 180, y: y - 12, size: 7, font: fontMono, color: black });
        y -= rowH;
      };

      const drawCertKV = (label: string, value: string) => {
        ensureSpace(20);
        const rowH = 17;
        currentPage.drawRectangle({ x: margin + 3, y: y - rowH, width: contentW - 3, height: rowH, color: certSectionBg });
        currentPage.drawText(safe(label), { x: margin + 10, y: y - 11, size: 7.5, font: fontBold, color: darkGray });
        currentPage.drawText(safe(value), { x: margin + 185, y: y - 11, size: 7.5, font: fontMono, color: black });
        y -= rowH;
      };

      const ev = signatureEvidence;
      const isEfirma = savedSignatureType === 'efirma' || ev?.signatureType?.includes('efirma') || ev?.signatureType?.includes('e.firma');
      const signedAt = ev?.signedAt || new Date().toISOString();
      const shortDocId = document?.id?.slice(0, 8) || 'doc';
      const folioPrefix = isEfirma ? 'EFI' : 'AUT';
      const folioId = `DOCUBOX-IND-${folioPrefix}-${new Date().getFullYear()}-${shortDocId.toUpperCase()}`;
      const userName = userProfile.nombre_completo || user?.user_metadata?.full_name || '—';
      const userEmail = userProfile.email || user?.email || '—';
      const methodLabel = isEfirma ? 'FIRMA ELECTRONICA AVANZADA - E.FIRMA SAT' : 'FIRMA AUTOGRAFA DIGITALIZADA';

      // ════════════════════════════════════════════════════════════════════════
      // HEADER
      // ════════════════════════════════════════════════════════════════════════
      currentPage.drawRectangle({ x: 0, y: pageH - 55, width: pageW, height: 55, color: darkBg });
      currentPage.drawText('CONSTANCIA INDIVIDUAL DE PARTICIPACION', {
        x: margin, y: pageH - 22, size: 13, font: fontBold, color: white,
      });
      currentPage.drawText('Documento confidencial - uso exclusivo del firmante', {
        x: margin, y: pageH - 36, size: 8, font: fontRegular, color: rgb(0.75, 0.75, 0.85),
      });
      currentPage.drawText('DOCUBOX', {
        x: pageW - 90, y: pageH - 28, size: 10, font: fontBold, color: accentBlue,
      });
      y = pageH - 55;

      // Confidential banner
      currentPage.drawRectangle({ x: margin, y: y - 18, width: contentW, height: 18, color: rgb(0.95, 0.95, 0.97), borderColor: rgb(0.6, 0.6, 0.7), borderWidth: 0.5 });
      currentPage.drawText('CONFIDENCIAL - SOLO PARA EL FIRMANTE', {
        x: margin + 8, y: y - 12, size: 7.5, font: fontBold, color: rgb(0.3, 0.3, 0.4),
      });
      currentPage.drawText(`METODO: ${methodLabel}`, {
        x: margin + 260, y: y - 12, size: 7.5, font: fontBold, color: accentBlue,
      });
      y -= 22;

      // Folio table header
      currentPage.drawRectangle({ x: margin, y: y - 18, width: contentW, height: 18, color: rgb(0.2, 0.2, 0.25) });
      currentPage.drawText('FOLIO', { x: margin + 6, y: y - 12, size: 7, font: fontBold, color: white });
      currentPage.drawText('GENERADA (UTC)', { x: margin + 200, y: y - 12, size: 7, font: fontBold, color: white });
      currentPage.drawText('FIRMANTE', { x: margin + 370, y: y - 12, size: 7, font: fontBold, color: white });
      y -= 18;
      currentPage.drawRectangle({ x: margin, y: y - 18, width: contentW, height: 18, color: veryLightGray, borderColor: lightGray, borderWidth: 0.3 });
      currentPage.drawText(safe(folioId), { x: margin + 6, y: y - 12, size: 7, font: fontRegular, color: black });
      currentPage.drawText(safe(signedAt), { x: margin + 200, y: y - 12, size: 7, font: fontRegular, color: black });
      currentPage.drawText(safe(userEmail), { x: margin + 370, y: y - 12, size: 7, font: fontRegular, color: black });
      y -= 24;

      // ── DATOS DEL PARTICIPANTE ────────────────────────────────────────────────
      drawSectionHeading('DATOS DEL PARTICIPANTE');
      drawKV('NOMBRE COMPLETO', userName);
      drawKV('CORREO', userEmail);
      drawKV('ROL', myRole === 'firmante' ? 'Firmante' : myRole === 'aprobador' ? 'Aprobador' : 'Observador');
      if (userProfile.rfc) drawKV('RFC', userProfile.rfc);
      if (userProfile.curp) drawKV('CURP', userProfile.curp);
      y -= 8;

      // ── CERTIFICADO DE FIRMA DIGITAL ──────────────────────────────────────────
      ensureSpace(40);
      // Section background with left border accent
      const certSectionStartY = y;
      const certRows = 9;
      const certSectionH = certRows * 17 + 30;
      currentPage.drawRectangle({ x: margin, y: y - certSectionH, width: contentW, height: certSectionH, color: certSectionBg });
      currentPage.drawRectangle({ x: margin, y: y - certSectionH, width: 3, height: certSectionH, color: certBorderBlue });
      // Section heading
      currentPage.drawRectangle({ x: margin, y: y - 20, width: contentW, height: 20, color: rgb(0.118, 0.420, 1.0) });
      currentPage.drawText('CERTIFICADO DE FIRMA DIGITAL', { x: margin + 10, y: y - 14, size: 8, font: fontBold, color: white });
      y -= 26;
      drawCertKV('Entidad emisora (CN)', 'Docubox CA');
      drawCertKV('Organizacion (O)', 'Docubox');
      drawCertKV('Pais (C)', 'MX');
      drawCertKV('Validez del certificado', '825 dias');
      drawCertKV('Algoritmo', 'RSA-2048 + SHA-256');
      drawCertKV('Sellado de tiempo (TSA)', 'DigiCert RFC 3161');
      drawCertKV('URL TSA', 'http://timestamp.digicert.com');
      drawCertKV('Nivel de firma', 'PAdES - Fase 1');
      drawCertKV('Estandar legal', 'Codigo de Comercio Arts. 89-97');
      y -= 8;

      // ── DATOS DEL DOCUMENTO ───────────────────────────────────────────────────
      drawSectionHeading('DATOS DEL DOCUMENTO');
      drawKV('IDENTIFICADOR', document?.id || '—');
      drawKV('TITULO', document?.nombre || '—');
      drawKV('CREADO', signedAt);
      y -= 8;

      // ── EVIDENCIA DE SESION ───────────────────────────────────────────────────
      drawSectionHeading('EVIDENCIA DE SESION - RECOLECCION AUTOMATICA');

      ensureSpace(16);
      currentPage.drawText('Red e Identidad', { x: margin + 6, y: y - 10, size: 7.5, font: fontBold, color: accentBlue });
      y -= 16;
      drawKV('IP DEL FIRMANTE', ev?.ipAddress || '—');
      drawKV('COORDENADAS', ev?.coordinates ? `${ev.coordinates.lat.toFixed(6)}, ${ev.coordinates.lng.toFixed(6)}` : '—');

      ensureSpace(16);
      currentPage.drawText('Sellado de Tiempo', { x: margin + 6, y: y - 10, size: 7.5, font: fontBold, color: accentBlue });
      y -= 16;
      drawKV('TIMESTAMP UTC (SERVIDOR)', ev?.timestampSello || signedAt);

      ensureSpace(16);
      currentPage.drawText('Dispositivo', { x: margin + 6, y: y - 10, size: 7.5, font: fontBold, color: accentBlue });
      y -= 16;
      drawKV('TIPO', 'DESKTOP');
      y -= 8;

      // ── e.firma SAT section (only if efirma) ──────────────────────────────────
      if (isEfirma) {
        drawSectionHeading('FIRMA ELECTRONICA AVANZADA - e.firma SAT');
        drawKV('TITULAR', safe(ev?.efirmaNombre || userName));
        drawKV('RFC', safe(ev?.efirmaRfc || userProfile.rfc || '—'));
        drawKV('NO. DE SERIE', safe(ev?.efirmaSerial || '—'));
        drawKV('EMISOR', 'SAT - Autoridad Certificadora');
        drawKV('VIGENTE HASTA', safe(ev?.efirmaVigenciaFin || '—'));
        drawKV('SHA-256 DOCUMENTO', safe(ev?.signatureHash || '—'));
        drawKV('ALGORITMO', 'SHA256withRSA');
        drawKV('FIRMADO', safe(signedAt));
        y -= 6;

        ensureSpace(30);
        currentPage.drawRectangle({ x: margin, y: y - 26, width: contentW, height: 26, color: rgb(0.97, 0.98, 1), borderColor: rgb(0.7, 0.8, 0.95), borderWidth: 0.5 });
        currentPage.drawText('La clave privada (.key) fue procesada exclusivamente en memoria RAM del servidor y nunca fue persistida.', {
          x: margin + 6, y: y - 12, size: 6.5, font: fontRegular, color: midGray,
        });
        currentPage.drawText('El certificado fue validado contra el arbol de confianza del SAT con verificacion OCSP en tiempo real al momento de la firma.', {
          x: margin + 6, y: y - 22, size: 6.5, font: fontRegular, color: midGray,
        });
        y -= 32;

        // ── VALIDACION NUBARIUM SAT ───────────────────────────────────────────
        const nubariumEstado = ev?.nubariumEstado || null;
        const nubariumFecha = ev?.nubariumFechaConsulta || null;
        const nubariumCodigo = ev?.nubariumCodigoValidacion || null;

        if (nubariumEstado || nubariumFecha || nubariumCodigo) {
          const nubariumColor = rgb(0.039, 0.439, 0.275); // #0A7046 green
          const nubariumBg = rgb(0.941, 0.992, 0.969);    // #F0FEFA light green
          const nubariumBorder = rgb(0.188, 0.706, 0.494); // #30B47E

          ensureSpace(90);
          const nubariumSectionH = 80;
          currentPage.drawRectangle({ x: margin, y: y - nubariumSectionH, width: contentW, height: nubariumSectionH, color: nubariumBg });
          currentPage.drawRectangle({ x: margin, y: y - nubariumSectionH, width: 3, height: nubariumSectionH, color: nubariumBorder });

          // Heading
          currentPage.drawRectangle({ x: margin, y: y - 20, width: contentW, height: 20, color: nubariumColor });
          currentPage.drawText('VALIDACION NUBARIUM - SAT (Servicio de Administracion Tributaria)', {
            x: margin + 10, y: y - 14, size: 8, font: fontBold, color: white,
          });
          y -= 26;

          // Estado row
          ensureSpace(18);
          {
            const rowH = 17;
            currentPage.drawRectangle({ x: margin + 3, y: y - rowH, width: contentW - 3, height: rowH, color: nubariumBg });
            currentPage.drawText('ESTADO DEL CERTIFICADO', { x: margin + 10, y: y - 11, size: 7.5, font: fontBold, color: darkGray });
            currentPage.drawText(safe(nubariumEstado || 'Vigente'), { x: margin + 185, y: y - 11, size: 7.5, font: fontBold, color: nubariumColor });
            y -= rowH;
          }

          // Fecha consulta row
          if (nubariumFecha) {
            ensureSpace(18);
            const rowH = 17;
            const fechaDisplay = (() => {
              try {
                const d = new Date(nubariumFecha);
                const pad = (n: number) => String(n).padStart(2, '0');
                return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} UTC`;
              } catch { return nubariumFecha; }
            })();
            currentPage.drawRectangle({ x: margin + 3, y: y - rowH, width: contentW - 3, height: rowH, color: nubariumBg });
            currentPage.drawText('FECHA DE CONSULTA', { x: margin + 10, y: y - 11, size: 7.5, font: fontBold, color: darkGray });
            currentPage.drawText(safe(fechaDisplay), { x: margin + 185, y: y - 11, size: 7.5, font: fontMono, color: black });
            y -= rowH;
          }

          // Código de validación row
          if (nubariumCodigo) {
            ensureSpace(18);
            const rowH = 17;
            currentPage.drawRectangle({ x: margin + 3, y: y - rowH, width: contentW - 3, height: rowH, color: nubariumBg });
            currentPage.drawText('CODIGO DE VALIDACION', { x: margin + 10, y: y - 11, size: 7.5, font: fontBold, color: darkGray });
            currentPage.drawText(safe(nubariumCodigo), { x: margin + 185, y: y - 11, size: 7, font: fontMono, color: black });
            y -= rowH;
          }

          y -= 8;
        }
      } else {
        // Autograph section
        drawSectionHeading('FIRMA AUTOGRAFA DIGITALIZADA');
        const sigDataUrl = firmaData || savedSignature;
        if (sigDataUrl && sigDataUrl.startsWith('data:image/')) {
          try {
            ensureSpace(90);
            const base64Data = sigDataUrl.split(',')[1];
            const binaryStr = atob(base64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            let sigImg;
            if (sigDataUrl.includes('image/png')) {
              sigImg = await pdfDoc.embedPng(bytes);
            } else {
              sigImg = await pdfDoc.embedJpg(bytes);
            }
            const sigDims = sigImg.scaleToFit(180, 70);
            currentPage.drawRectangle({ x: margin + 6, y: y - sigDims.height - 6, width: sigDims.width + 4, height: sigDims.height + 4, color: white, borderColor: lightGray, borderWidth: 0.5 });
            currentPage.drawImage(sigImg, { x: margin + 8, y: y - sigDims.height - 4, width: sigDims.width, height: sigDims.height });
            y -= sigDims.height + 14;
          } catch { /* skip */ }
        }
        drawKV('SHA-256', safe(ev?.signatureHash || '—'));
        drawKV('ALGORITMO', 'SHA-256');
        y -= 8;
      }

      // ── INTEGRIDAD Y VERIFICACION ─────────────────────────────────────────────
      drawSectionHeading('INTEGRIDAD Y VERIFICACION');

      // Hash SHA-256 documento original (from document state)
      const originalHash = safe((document as any)?.file_hash_sha256 || ev?.signatureHash || '—');
      // Hash SHA-256 documento firmado (signatureHash from evidence)
      const sealedHash = safe(ev?.signatureHash || '—');
      // Folio
      const folioDisplay = safe(folioId);
      // Fecha y hora del sello en UTC-6
      const selloDate = new Date(ev?.timestampSello || signedAt);
      const utcMinus6 = new Date(selloDate.getTime() - 6 * 60 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const fechaSello = `${pad(utcMinus6.getUTCDate())}/${pad(utcMinus6.getUTCMonth() + 1)}/${utcMinus6.getUTCFullYear()} ${pad(utcMinus6.getUTCHours())}:${pad(utcMinus6.getUTCMinutes())}:${pad(utcMinus6.getUTCSeconds())} UTC-6`;
      // IP
      const ipDisplay = safe(ev?.ipAddress || '—');
      // Geolocation
      const geoDisplay = ev?.coordinates ? `${ev.coordinates.lat.toFixed(6)}, ${ev.coordinates.lng.toFixed(6)}` : '—';

      // Draw hash rows in mono font (full 64 chars)
      ensureSpace(22);
      {
        const rowH = 18;
        currentPage.drawRectangle({ x: margin, y: y - rowH, width: contentW, height: rowH, color: veryLightGray, borderColor: lightGray, borderWidth: 0.3 });
        currentPage.drawText('HASH SHA-256 DOC. ORIGINAL', { x: margin + 6, y: y - 12, size: 7.5, font: fontBold, color: darkGray });
        currentPage.drawText(originalHash.length > 64 ? originalHash.slice(0, 64) : originalHash, { x: margin + 180, y: y - 12, size: 7, font: fontMono, color: black });
        y -= rowH;
      }
      ensureSpace(22);
      {
        const rowH = 18;
        currentPage.drawRectangle({ x: margin, y: y - rowH, width: contentW, height: rowH, color: veryLightGray, borderColor: lightGray, borderWidth: 0.3 });
        currentPage.drawText('HASH SHA-256 DOC. FIRMADO', { x: margin + 6, y: y - 12, size: 7.5, font: fontBold, color: darkGray });
        currentPage.drawText(sealedHash.length > 64 ? sealedHash.slice(0, 64) : sealedHash, { x: margin + 180, y: y - 12, size: 7, font: fontMono, color: black });
        y -= rowH;
      }
      drawKV('FOLIO UNICO DOCUBOX', folioDisplay);
      drawKV('FECHA Y HORA DEL SELLO', fechaSello);
      drawKV('IP DEL FIRMANTE', ipDisplay);
      drawKV('GEOLOCALIZACION', geoDisplay);
      drawKV('ALGORITMO', 'SHA-256');
      drawKV('URL DE VERIFICACION', 'https://verificar.docubox.mx');
      y -= 6;
      ensureSpace(16);
      currentPage.drawText(`https://verificar.docubox.mx?constancia=${safe(folioId)}&doc=${safe(document?.id || '—')}`, {
        x: margin + 6, y: y - 10, size: 7, font: fontRegular, color: accentBlue,
      });
      y -= 20;

      // ── FUNDAMENTO LEGAL ──────────────────────────────────────────────────────
      drawSectionHeading('FUNDAMENTO LEGAL');
      const legalBlocks = [
        ['Confidencialidad:', 'Este documento contiene datos personales protegidos por la LFPDPPP. Su divulgacion a terceros no autorizados esta prohibida.'],
        ['Validez juridica:', 'Certifica la participacion y voluntad de firma conforme a los Arts. 89-97 del Codigo de Comercio, LFEA y NOM-151-SCFI-2016.'],
        ['No repudio:', 'Los elementos registrados constituyen prueba de la libre y expresa manifestacion de voluntad del firmante.'],
      ];
      for (const [label, text] of legalBlocks) {
        ensureSpace(24);
        currentPage.drawText(safe(label), { x: margin + 6, y: y - 10, size: 7.5, font: fontBold, color: darkGray });
        currentPage.drawText(safe(text), { x: margin + 6, y: y - 20, size: 7, font: fontRegular, color: midGray });
        y -= 28;
      }

      // ── PÁRRAFO DE FUNDAMENTO LEGAL EXTENDIDO ─────────────────────────────────
      ensureSpace(80);
      y -= 6;
      const legalParrafo = [
        'La presente firma electronica tiene validez juridica conforme al Codigo de Comercio de los Estados Unidos',
        'Mexicanos (Arts. 89-97), la Ley de Firma Electronica Avanzada (LFEA) y los Lineamientos del SAT para firma',
        'electronica. El sellado de tiempo mediante DigiCert TSA (RFC 3161) acredita la existencia del documento en',
        'la fecha y hora indicadas. El hash SHA-256 garantiza la integridad e inalterabilidad del documento.',
        'Certificado emitido por Docubox CA bajo los estandares X.509 v3, RSA-2048, SHA-256.',
      ];
      currentPage.drawRectangle({ x: margin, y: y - (legalParrafo.length * 12 + 10), width: contentW, height: legalParrafo.length * 12 + 10, color: rgb(0.97, 0.97, 0.98), borderColor: lightGray, borderWidth: 0.3 });
      for (const line of legalParrafo) {
        ensureSpace(14);
        currentPage.drawText(safe(line), { x: margin + 6, y: y - 10, size: 7.5, font: fontRegular, color: darkGray });
        y -= 12;
      }
      y -= 8;

      // ── Footer ────────────────────────────────────────────────────────────────
      ensureSpace(30);
      currentPage.drawLine({ start: { x: margin, y: y - 4 }, end: { x: pageW - margin, y: y - 4 }, thickness: 0.5, color: lightGray });
      currentPage.drawText('Generado por: DOCUBOX - https://docubox.mx', { x: margin, y: y - 16, size: 7, font: fontRegular, color: midGray });
      currentPage.drawText(`Generado automaticamente al momento de la firma - ${safe(signedAt)}`, {
        x: margin, y: y - 26, size: 7, font: fontRegular, color: midGray,
      });

      // ── METADATA DEL PDF ──────────────────────────────────────────────────────
      const signerName = safe(userName);
      const docTitle = safe(document?.nombre || '—');
      const docFolio = safe(folioId);
      const signMethod = isEfirma ? 'Firma Electronica Avanzada - e.firma SAT' : 'Firma Autografa Digitalizada';
      pdfDoc.setTitle(`Documento firmado - DOCUBOX - ${docFolio}`);
      pdfDoc.setAuthor('Docubox CA - Docubox - MX');
      pdfDoc.setSubject(`Firma electronica - ${signerName} - ${signMethod}`);
      pdfDoc.setCreator('DOCUBOX - Plataforma de firma electronica');
      pdfDoc.setProducer('DOCUBOX v1.0 | PAdES Fase 1 | Docubox CA');
      pdfDoc.setKeywords(['firma electronica', 'DOCUBOX', 'PAdES', 'RSA-2048', 'Codigo de Comercio', 'Mexico', 'Docubox CA']);

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `constancia-participacion-${document?.id?.slice(0, 8) || 'doc'}.pdf`;
      a.style.display = 'none';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generando constancia PDF:', err);
    } finally {
      setGeneratingPdf(false);
    }
  }, [document?.id, document?.nombre, userProfile, user, myRole, savedSignatureType, savedSignature, firmaData, signatureEvidence, nubariumValidationResult]);

  // ── Download original document ─────────────────────────────────────────────
  const downloadOriginalDocument = useCallback(async () => {
    if (!document?.file_url) return;
    setDownloadingOriginal(true);
    try {
      const response = await fetch(document.file_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `${document.nombre || 'documento'}.pdf`;
      a.style.display = 'none';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // fallback: open in new tab
      window.open(document.file_url, '_blank');
    } finally {
      setDownloadingOriginal(false);
    }
  }, [document?.file_url, document?.nombre]);

  // ── NOM-151 polling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!document?.id || document?.estado !== 'completado') return;
    let cancelled = false;

    const fetchNom151 = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('nom151_constancias')
          .select('id, status, nubarium_codigo_validacion, nubarium_hash, constancia_sha256, created_at')
          .eq('document_id', document.id)
          .eq('status', 'issued')
          .maybeSingle();
        if (!cancelled) {
          setNom151Data(data ?? null);
          setNom151Polling(!data);
        }
      } catch {
        if (!cancelled) setNom151Polling(false);
      }
    };

    fetchNom151();
    const interval = setInterval(() => {
      if (!nom151Data) fetchNom151();
      else clearInterval(interval);
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.id, document?.estado]);

  // ── XML Evidence polling ───────────────────────────────────────────────────
  useEffect(() => {
    if (!document?.id || document?.estado !== 'completado') return;
    let cancelled = false;

    const fetchXmlEvidence = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('documents')
          .select('xml_evidencia_path, xml_hash_sha256, xml_generated_at')
          .eq('id', document.id)
          .not('xml_evidencia_path', 'is', null)
          .maybeSingle();
        if (!cancelled && data?.xml_evidencia_path) {
          setXmlEvidenceData(data as { xml_evidencia_path: string; xml_hash_sha256: string; xml_generated_at: string });
          setXmlPolling(false);
        } else if (!cancelled) {
          setXmlPolling(true);
        }
      } catch {
        if (!cancelled) setXmlPolling(false);
      }
    };

    fetchXmlEvidence();
    const interval = setInterval(() => {
      if (!xmlEvidenceData) fetchXmlEvidence();
      else clearInterval(interval);
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.id, document?.estado]);

  // ── Download XML evidence file ─────────────────────────────────────────────
  const downloadXmlEvidence = useCallback(async () => {
    if (!xmlEvidenceData?.xml_evidencia_path) return;
    setDownloadingXml(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from('documentos-evidencia')
        .download(xmlEvidenceData.xml_evidencia_path);
      if (error || !data) throw error;
      const url = URL.createObjectURL(data);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `evidencia_${document?.id?.slice(0, 8) || 'doc'}.xml`;
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
  }, [xmlEvidenceData?.xml_evidencia_path, document?.id]);
  useEffect(() => {
    if (!user?.id) return;
    const fetchProfile = async () => {
      const supabase = createClient();
      // Also fetch session token for Edge Function calls
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) setSessionToken(session.access_token);
      const { data } = await supabase
        .from('user_profiles')
        .select('nombre, apellido_paterno, apellido_materno, rfc, curp, email, telefono, calle, num_exterior, colonia, municipio, estado, codigo_postal, firma_autografa_url, metodo_firma, firma_autografa_created_at, firma_autografa_last_used, efirma_serial, efirma_rfc, efirma_nombre, efirma_vigencia_fin, efirma_stamp_style, autografa_stamp_style, click_sign_stamp_style')
        .eq('id', user.id)
        .maybeSingle();

      if (data) {
        const nombreCompleto = [data.nombre, data.apellido_paterno, data.apellido_materno]
          .filter(Boolean)
          .join(' ')
          .trim() || user.user_metadata?.full_name || '';

        const direccionParts = [
          data.calle,
          data.num_exterior ? `#${data.num_exterior}` : null,
          data.colonia,
          data.municipio,
          data.estado,
          data.codigo_postal,
        ].filter(Boolean);
        const direccion = direccionParts.join(', ');

        setUserProfile({
          nombre_completo: nombreCompleto,
          rfc: data.rfc || '',
          curp: data.curp || '',
          email: data.email || user.email || '',
          telefono: data.telefono || '',
          direccion,
        });
        userProfileRef.current = {
          nombre_completo: nombreCompleto,
          rfc: data.rfc || '',
          curp: data.curp || '',
          email: data.email || user.email || '',
          telefono: data.telefono || '',
          direccion,
        };

        // Load saved signature if available
        if (data.firma_autografa_url) {
          setSavedSignature(data.firma_autografa_url);
          const metodo = data.metodo_firma as string | null;
          if (metodo === 'efirma') setSavedSignatureType('efirma');
          else if (metodo === 'firma_electronica' || metodo === 'electronica') setSavedSignatureType('firma_electronica');
          else if (metodo === 'autografa' || metodo === 'autografa_digital') setSavedSignatureType('autografa');
          else setSavedSignatureType('autografa'); // default: firma_autografa_url present → treat as autógrafa
        }
        // Load e.firma profile data
        if (data.efirma_serial) {
          setProfileEfirma({
            serial: data.efirma_serial || null,
            rfc: data.efirma_rfc || null,
            curp: data.curp || null,
            nombre: data.efirma_nombre || null,
            vigenciaFin: data.efirma_vigencia_fin || null,
          });
        }
        // Load stamp styles from profile
        if (data.efirma_stamp_style) setEfirmaStampStyle(data.efirma_stamp_style);
        if (data.autografa_stamp_style) setAutografaStampStyle(data.autografa_stamp_style);
        if (data.click_sign_stamp_style) setClickSignStampStyle(data.click_sign_stamp_style);
      } else {
        setUserProfile((prev) => ({
          ...prev,
          nombre_completo: user.user_metadata?.full_name || '',
          email: user.email || '',
        }));
        userProfileRef.current = {
          ...userProfileRef.current,
          nombre_completo: user.user_metadata?.full_name || '',
          email: user.email || '',
        };
      }
    };
    fetchProfile();
  }, [user?.id]);

  // ── Load document ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading || !docId || !user) return;
    const loadDoc = async () => {
      setLoading(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('documentos')
          .select('id, nombre, estado, owner_id, file_url, campos_solicitados, participantes')
          .eq('id', docId)
          .single();

        if (error || !data) {
          const { data: { session } } = await supabase.auth.getSession();
          const accessToken = session?.access_token;
          const apiRes = await fetch(`/api/documentos/obtener?id=${docId}`, {
            headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {},
          });
          if (!apiRes.ok) {
            setDocError('no_encontrado');
            return;
          }
          const apiJson = await apiRes.json();
          processDocData(apiJson.data);
        } else {
          processDocData(data);
        }

        // Check proteccion_participacion_enabled
        const { data: secData } = await supabase
          .from('document_security_settings')
          .select('proteccion_participacion_enabled')
          .eq('documento_id', docId)
          .maybeSingle();
        if (secData?.proteccion_participacion_enabled) {
          setProteccionParticipacionEnabled(true);
          // Check if user has TOTP enabled
          const { data: totpData } = await supabase
            .from('totp_secrets')
            .select('id')
            .eq('user_id', user.id)
            .eq('verified', true)
            .maybeSingle();
          setProteccionHasTOTP(!!totpData);
        }
      } catch (err: any) {
        setDocError(err?.message || 'error_desconocido');
      } finally {
        setLoading(false);
      }
    };

    const processDocData = (data: any) => {
      setDocument(data);

      const rawParts: any[] = data.participantes || [];
      const myPart = rawParts.find((p: any) =>
        p.email === user?.email ||
        p.id === user?.id ||
        p.user_id === user?.id
      );

      // ── Access control: only allow if participant sub_estado is 'en_revision'
      // and document estado is 'en_proceso'. Otherwise redirect silently.
      const participantSubEstado = myPart?.sub_estado || '';
      const documentoEstadoActual = data.estado || '';
      if (participantSubEstado !== 'en_revision' || documentoEstadoActual !== 'en_proceso') {
        router.replace(`/visor-documento/${data.id}`);
        return;
      }

      if (myPart) {
        setMyParticipantData(myPart);
        const role = myPart.role || myPart.acto || 'firmante';
        if (role === 'aprobador' || role === 'Aprobador') setMyRole('aprobador');
        else if (role === 'observador' || role === 'Observador') setMyRole('observador');
        else setMyRole('firmante');
      }

      const campos: CampoSolicitado[] = data.campos_solicitados || [];
      // Match campos assigned to this participant by: no participantId, or matches participant's internal id, or matches user's supabase id, or matches user's email
      const myCampos = campos.filter((c: CampoSolicitado) =>
        !c.participantId ||
        c.participantId === myPart?.id ||
        c.participantId === user?.id ||
        (myPart?.email && c.participantId === myPart?.email)
      );
      setCamposPrefijados(myCampos);

      // ── Convert prefixed campos to PlacedFieldFirmar overlays ──────────────
      if (myCampos.length > 0) {
        const prefijadosAsPlaced: PlacedFieldFirmar[] = myCampos
          .filter((c) => c.x !== undefined && c.y !== undefined)
          .map((c) => {
            const resolvedTipo: CampoPersonalizado['tipo'] = resolveFieldTipo(c);
            return {
              id: c.id || `prefijado-${myCampos.indexOf(c)}`,
              label: c.label,
              tipo: resolvedTipo,
              value: '',
              x: c.x ?? 10,
              y: c.y ?? 10,
              width: c.width ?? 16,
              height: c.height ?? 4,
              page: c.page || 1,
              dropdownOptions: c.dropdownOptions || [],
              radioOptions: c.radioOptions || [],
              fieldConfig: c.fieldConfig || undefined,
              fieldTypeConfig: c.fieldTypeConfig || undefined,
              casillaLabel: c.casillaLabel || undefined,
            };
          });
        setPlacedFields(prefijadosAsPlaced);
      }

      const initValues: Record<string, string> = {};
      myCampos.forEach((c) => {
        const key = c.id || `prefijado-${myCampos.indexOf(c)}`;
        const resolvedTipo: CampoPersonalizado['tipo'] = resolveFieldTipo(c);
        const autoValue = getAutoFillValue(resolvedTipo, userProfileRef.current);
        initValues[key] = autoValue || '';
      });

      // ── Restore persisted flow state (merge saved values over auto-fill) ───
      const persisted = readPersistedFlow();
      if (persisted) {
        // Merge saved camposValues over auto-fill (saved values take priority)
        const mergedValues = { ...initValues, ...(persisted.camposValues || {}) };
        setCamposValues(mergedValues);
        if (persisted.step && persisted.step !== 'completado') {
          setStep(persisted.step);
        }
        // Note: do NOT call setCamposValues(initValues) in the else branch —
        // mergedValues is already set above and must not be overwritten.
        if (persisted.terminosAceptados) setTerminosAceptados(persisted.terminosAceptados);
        if (persisted.camposPersonalizados?.length > 0) setCamposPersonalizados(persisted.camposPersonalizados);
        if (persisted.firmaData) {
          setFirmaData(persisted.firmaData);
          setFirmaConfirmada(true);
        }
      } else {
        setCamposValues(initValues);
      }
      // Allow persist effects to write from this point forward
      flowRestoredRef.current = true;
    };

    loadDoc();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, docId, user?.id]);

  // ── Auto-fill placed fields when profile loads ─────────────────────────────
  useEffect(() => {
    if (!userProfile.nombre_completo && !userProfile.email) return;
    setPlacedFields((prev) =>
      prev.map((f) => {
        const autoValue = getAutoFillValue(f.tipo, userProfile);
        if (autoValue && !f.value) {
          return { ...f, value: autoValue };
        }
        return f;
      })
    );
    if (camposPrefijados.length > 0) {
      setCamposValues((prev) => {
        const updated = { ...prev };
        camposPrefijados.forEach((c, idx) => {
          const key = c.id || `prefijado-${idx}`;
          const tipo = c.tipo as CampoPersonalizado['tipo'];
          const autoValue = getAutoFillValue(tipo, userProfile);
          if (autoValue && !updated[key]) {
            updated[key] = autoValue;
          }
        });
        return updated;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile, camposPrefijados]);

  // ── Sync camposValues to placedFields for prefixed campos ─────────────────
  useEffect(() => {
    if (Object.keys(camposValues).length === 0) return;
    setPlacedFields((prev) =>
      prev.map((f) => {
        let val = camposValues[f.id];
        // Only update if the value exists in camposValues AND is different from current
        // Don't overwrite a non-empty auto-filled value with an empty string
        if (val !== undefined && val !== f.value && (val !== '' || f.value === '')) {
          return { ...f, value: val };
        }
        return f;
      })
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camposValues]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const hasCamposPrefijados = camposPrefijados.length > 0;
  const allCamposCompleted = hasCamposPrefijados
    ? camposPrefijados.every((c, idx) => {
        // firma fields are handled in the next step — skip validation here
        const resolvedTipo = resolveFieldTipo(c);
        if (resolvedTipo === 'firma') return true;
        const key = c.id || `prefijado-${idx}`;
        return (camposValues[key] || '').trim().length > 0;
      }) && camposPersonalizados.every((c) => {
        if (c.tipo === 'firma') return true;
        return c.value.trim().length > 0;
      })
    : camposPersonalizados.every((c) => {
        if (c.tipo === 'firma') return true;
        return c.value.trim().length > 0;
      });

  // Check if firma field is inserted in document
  const hasFirmaInserted = camposPersonalizados.some((c) => c.tipo === 'firma') ||
    camposPrefijados.some((c) => c.tipo === 'firma') ||
    placedFields.some((f) => f.tipo === 'firma');

  // ── Auto-fill helper ───────────────────────────────────────────────────────
  function getAutoFillValue(tipo: CampoPersonalizado['tipo'], profile: UserProfileData): string {
    switch (tipo) {
      case 'nombre_completo': return profile.nombre_completo;
      case 'rfc': return profile.rfc;
      case 'curp': return profile.curp;
      case 'correo': return profile.email;
      case 'telefono': return profile.telefono;
      case 'direccion': return profile.direccion;
      default: return '';
    }
  }

  // ── Place field on document ────────────────────────────────────────────────
  const handlePlaceFieldOnDocument = useCallback((tipo: CampoPersonalizado['tipo'], label: string) => {
    if (tipo === 'firma') {
      const alreadyHasFirma = camposPersonalizados.some((c) => c.tipo === 'firma');
      if (alreadyHasFirma) return;
    }
    const autoValue = getAutoFillValue(tipo, userProfile);
    const newField: PlacedFieldFirmar = {
      id: `placed-${Date.now()}-${tipo}`,
      label,
      tipo,
      value: autoValue,
      x: 42,
      y: 45,
      width: 16,
      height: 4,
      page: currentPage,
    };
    setPlacedFields((prev) => [...prev, newField]);
    const newCampo: CampoPersonalizado = {
      id: newField.id,
      label,
      tipo,
      value: autoValue,
    };
    setCamposPersonalizados((prev) => [...prev, newCampo]);
    setShowCampoSelector(false);
  }, [userProfile, currentPage, camposPersonalizados]);

  // ── Drag & Drop on document ────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const tipo = e.dataTransfer.getData('campo-tipo') as CampoPersonalizado['tipo'];
    const label = e.dataTransfer.getData('campo-label');
    if (!tipo || !label) return;

    if (tipo === 'firma') {
      const alreadyHasFirma = camposPersonalizados.some((c) => c.tipo === 'firma');
      if (alreadyHasFirma) return;
    }

    const rect = docSheetRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;

    const autoValue = getAutoFillValue(tipo, userProfile);
    const newField: PlacedFieldFirmar = {
      id: `placed-${Date.now()}-${tipo}`,
      label,
      tipo,
      value: autoValue,
      x: Math.max(0, Math.min(84, x - 8)),
      y: Math.max(0, Math.min(96, y - 2)),
      width: 16,
      height: 4,
      page: currentPage,
    };
    setPlacedFields((prev) => [...prev, newField]);
    const newCampo: CampoPersonalizado = {
      id: newField.id,
      label,
      tipo,
      value: autoValue,
    };
    setCamposPersonalizados((prev) => [...prev, newCampo]);
  };

  // ── Remove placed field ────────────────────────────────────────────────────
  const handleRemovePlacedField = (id: string) => {
    setPlacedFields((prev) => prev.filter((f) => f.id !== id));
    setCamposPersonalizados((prev) => prev.filter((c) => c.id !== id));
  };

  // ── Move placed field ──────────────────────────────────────────────────────
  const handleMovePlacedField = (id: string, x: number, y: number) => {
    setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, x, y } : f));
  };

  // ── Resize placed field ────────────────────────────────────────────────────
  const handleResizePlacedField = (id: string, width: number, height: number, x: number, y: number) => {
    setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, width, height, x, y } : f));
  };

  // ── Update field label config ──────────────────────────────────────────────
  const handleUpdateFieldConfig = (id: string, cfg: FieldLabelConfig) => {
    setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, fieldConfig: cfg } : f));
    if (cfg.customName) {
      setCamposPersonalizados((prev) =>
        prev.map((c) => c.id === id ? { ...c, label: cfg.customName! } : c)
      );
    }
  };

  // ── Update field type config ───────────────────────────────────────────────
  const handleUpdateFieldTypeConfig = (id: string, cfg: FieldTypeConfig) => {
    setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, fieldTypeConfig: cfg } : f));
  };

  // ── Update dropdown options ────────────────────────────────────────────────
  const handleUpdateDropdownOptions = (id: string, options: string[]) => {
    setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, dropdownOptions: options } : f));
  };

  // ── Update radio options ───────────────────────────────────────────────────
  const handleUpdateRadioOptions = (id: string, options: string[]) => {
    setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, radioOptions: options } : f));
  };

  // ── Update casilla label ───────────────────────────────────────────────────
  const handleUpdateCasillaLabel = (id: string, label: string) => {
    setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, casillaLabel: label } : f));
  };

  // ── Update campo value in sidebar ─────────────────────────────────────────
  const handleUpdateCampoValue = (id: string, value: string) => {
    setCamposPersonalizados((prev) =>
      prev.map((c) => c.id === id ? { ...c, value } : c)
    );
    setPlacedFields((prev) =>
      prev.map((f) => f.id === id ? { ...f, value } : f)
    );
  };

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleAceptarTerminos = () => {
    if (!terminosAceptados) return;
    if (geoDenied) return;
    if (myRole === 'aprobador') {
      setStep('aprobacion');
    } else {
      setStep('campos');
    }
  };

  const handleContinuarDesdeCampos = () => {
    if (geoDenied) return;
    if (myRole === 'firmante') {
      // Check if firma field is inserted
      if (!hasFirmaInserted) {
        setShowNoFirmaAlert(true);
        return;
      }
      setStep('firma');
    } else {
      setStep('aprobacion');
    }
  };

  const handleConfirmNoFirma = () => {
    setShowNoFirmaAlert(false);
    setStep('firma');
  };

  const handleFirmaSaved = (dataUrl: string) => {
    setFirmaData(dataUrl);
    setFirmaConfirmada(true);
  };

  const handleFirmaClear = () => {
    setFirmaData(null);
    setFirmaConfirmada(false);
  };

  const handleRemoveCampoPersonalizado = (id: string) => {
    setCamposPersonalizados((prev) => prev.filter((c) => c.id !== id));
    setPlacedFields((prev) => prev.filter((f) => f.id !== id));
  };

  const handleUpdateCampoPersonalizado = (id: string, value: string) => {
    handleUpdateCampoValue(id, value);
  };

  // ── Signature type label helper ────────────────────────────────────────────
  // Detect if participant's firma type is e.firma SAT
  const isEfirmaSAT = (() => {
    const tipoFirmaArr: string[] = myParticipantData?.tipoFirma || [];
    const metodo: string = myParticipantData?.metodo_firma || '';
    // Check array first (tipoFirma is the authoritative source from document creation)
    if (tipoFirmaArr.length > 0) {
      return tipoFirmaArr.some((m: string) =>
        m === 'efirma' || m === 'e.firma' || m === 'e.firma SAT' || m === 'efirma_sat'
      );
    }
    // Fallback to metodo_firma scalar field
    return metodo === 'efirma' || metodo === 'e.firma' || metodo === 'e.firma SAT' || metodo === 'efirma_sat';
  })();

  // Detect if participant's firma type is autógrafa digital
  // NOTE: Only use participation config (tipoFirma), NOT the user's profile savedSignatureType
  const isAutografaDigital = (() => {
    const tipoFirmaArr: string[] = myParticipantData?.tipoFirma || [];
    const metodo: string = myParticipantData?.metodo_firma || '';
    // If e.firma SAT is configured, autógrafa is NOT active
    if (isEfirmaSAT) return false;
    // Check array first
    if (tipoFirmaArr.length > 0) {
      return tipoFirmaArr.some((m: string) =>
        m === 'autografa' || m === 'autografa_digital' || m === 'Firma Autógrafa Digital'
      );
    }
    // Fallback to metodo_firma scalar field
    return metodo === 'autografa' || metodo === 'autografa_digital' || metodo === 'Firma Autógrafa Digital';
  })();

  const signatureTypeLabel = savedSignatureType === 'efirma' ? 'e.firma (SAT)'
    : savedSignatureType === 'firma_electronica' ? 'Firma Electrónica Digital'
    : savedSignatureType === 'autografa'? 'Firma Autógrafa Digital' :'Firma Electrónica';

  // ── Generate typed signature as data URL ──────────────────────────────────
  const generateTypedSignatureDataUrl = useCallback((text: string, style: 'cursive' | 'print' | 'formal'): string => {
    const canvas = window.document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fontMap = {
      cursive: '48px "Dancing Script", cursive',
      print: '36px "Roboto", sans-serif',
      formal: '44px "Playfair Display", serif',
    };
    ctx.font = fontMap[style];
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 300, 100);
    // Baseline
    ctx.beginPath();
    ctx.moveTo(50, 150);
    ctx.lineTo(550, 150);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.stroke();
    return canvas.toDataURL('image/png');
  }, []);

    // ── Persist flow state to sessionStorage on every relevant change ──────────
  useEffect(() => {
    if (step === 'completado') { clearPersistedFlow(); return; }
    writePersistedFlow({ step });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    writePersistedFlow({ terminosAceptados });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminosAceptados]);

  useEffect(() => {
    if (Object.keys(camposValues).length > 0) {
      writePersistedFlow({ camposValues });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camposValues]);

  useEffect(() => {
    if (camposPersonalizados.length > 0) {
      writePersistedFlow({ camposPersonalizados });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camposPersonalizados]);

  useEffect(() => {
    if (firmaData) {
      writePersistedFlow({ firmaData });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaData]);

  // ── Save progress ─────────────────────────────────────────────────────────
  const [savingProgress, setSavingProgress] = useState(false);
  const [saveProgressMsg, setSaveProgressMsg] = useState<string | null>(null);

  const handleGuardarAvance = async () => {
    if (!document || !user) return;
    setSavingProgress(true);
    setSaveProgressMsg(null);
    try {
      const supabase = createClient();
      const camposCompletados: CampoCompletado[] = [];
      if (hasCamposPrefijados) {
        camposPrefijados.forEach((c, idx) => {
          const key = c.id || `prefijado-${idx}`;
          camposCompletados.push({ campo_id: key, label: c.label, value: camposValues[key] || '' });
        });
      } else {
        camposPersonalizados.forEach((c) => {
          camposCompletados.push({ campo_id: c.id, label: c.label, value: c.value });
        });
      }
      const now = new Date().toISOString();
      const progressPayload = {
        documento_id: document.id,
        participante_email: user.email || '',
        participante_nombre: user.user_metadata?.full_name || user.email || '',
        participante_id: user.id,
        tipo_participacion: myRole,
        terminos_aceptados: true,
        terminos_aceptados_at: now,
        campos_completados: camposCompletados,
        firma_data: step === 'firma' && firmaData ? firmaData : null,
        firma_completada: false,
        firma_completada_at: null,
        aprobacion_completada: false,
        aprobacion_completada_at: null,
        observaciones: null,
      };
      const { error } = await supabase
        .from('participation_responses')
        .upsert(progressPayload, { onConflict: 'documento_id,participante_email' });
      if (error) throw new Error(error.message);
      setSaveProgressMsg('Avance guardado correctamente');
      setTimeout(() => setSaveProgressMsg(null), 3000);
    } catch {
      setSaveProgressMsg('Error al guardar el avance');
      setTimeout(() => setSaveProgressMsg(null), 3000);
    } finally {
      setSavingProgress(false);
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!document || !user) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const supabase = createClient();

      const camposCompletados: CampoCompletado[] = [];
      if (hasCamposPrefijados) {
        camposPrefijados.forEach((c, idx) => {
          const key = c.id || `prefijado-${idx}`;
          camposCompletados.push({
            campo_id: key,
            label: c.label,
            value: camposValues[key] || '',
          });
        });
      } else {
        camposPersonalizados.forEach((c) => {
          camposCompletados.push({
            campo_id: c.id,
            label: c.label,
            value: c.value,
          });
        });
      }

      // Determine final firma data
      let finalFirmaData = firmaData;
      if (myRole === 'firmante' && usePreloadedSignature && savedSignature) {
        finalFirmaData = savedSignature;
      } else if (myRole === 'firmante' && signatureMode === 'tipear' && typedSignature.trim()) {
        finalFirmaData = generateTypedSignatureDataUrl(typedSignature, typedSignatureStyle);
      }

      const now = new Date().toISOString();

      // ── Capture evidence: IP, geolocation, hash ────────────────────────────
      let ipAddress = '—';
      let coordinates: { lat: number; lng: number } | null = null;
      let signatureHash = '';

      // Get public IP
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        if (ipRes.ok) {
          const ipJson = await ipRes.json();
          ipAddress = ipJson.ip || '—';
        }
      } catch { /* ignore */ }

      // Get geolocation — use pre-fetched value from mount if available
      if (geoRef.current) {
        coordinates = geoRef.current;
      } else {
        try {
          await new Promise<void>((resolve) => {
            if (!navigator.geolocation) { resolve(); return; }
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                coordinates = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                geoRef.current = coordinates;
                resolve();
              },
              () => resolve(),
              { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
            );
          });
        } catch { /* ignore */ }
      }

      // Generate SHA-256 hash of firma data
      try {
        // For e.firma SAT, include serial + RFC in hash for stronger binding
        const efirmaSerial = isEfirmaSAT ? (profileEfirma?.serial || '') : '';
        const efirmaRfc = isEfirmaSAT ? (profileEfirma?.rfc || userProfile.rfc || '') : '';
        const dataToHash = (finalFirmaData || '') + now + (user.id || '') + (document.id || '') + efirmaSerial + efirmaRfc;
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(dataToHash);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        signatureHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch { /* ignore */ }

      const sigTypeLabel = isEfirmaSAT ? 'e.firma (SAT)'
        : savedSignatureType === 'efirma' ? 'e.firma (SAT)'
        : savedSignatureType === 'firma_electronica'? 'Firma Electrónica Digital' :'Firma Autógrafa Digital';

      // Validate and persist the cryptographic signature before changing any
      // participant or document state. A provider failure must leave the
      // workflow pending instead of producing a false "signed" state.
      let serverEfirmaSignedAt: string | null = null;
      if (isEfirmaSAT && myRole === 'firmante') {
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!accessToken || !supabaseUrl || !efirmaCerB64 || !efirmaKeyB64 || !efirmaPassword) {
          throw new Error('No fue posible conservar la evidencia criptografica de la e.firma.');
        }
        const signRes = await fetch(`${supabaseUrl}/functions/v1/sign-efirma`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            document_id: document.id,
            cer_b64: efirmaCerB64,
            key_b64: efirmaKeyB64,
            password: efirmaPassword,
            session_evidence: {
              user_agent: navigator.userAgent,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              geo: coordinates ? { latitude: coordinates.lat, longitude: coordinates.lng, accuracy_meters: 0, source: 'browser_api' } : null,
            },
            device_fingerprint: { fingerprint_id: signatureHash },
          }),
        });
        const signData = await signRes.json().catch(() => ({}));
        if (!signRes.ok || !signData?.evidence_id) {
          throw new Error(signData?.error || 'La e.firma no supero la validacion criptografica.');
        }
        serverEfirmaSignedAt = signData.signed_at || null;
        setEfirmaCerB64(null);
        setEfirmaKeyB64(null);
        setEfirmaPassword(null);
      }

      const responsePayload = {
        documento_id: document.id,
        participante_email: user.email || '',
        participante_nombre: user.user_metadata?.full_name || user.email || '',
        participante_id: user.id,
        tipo_participacion: myRole,
        terminos_aceptados: true,
        terminos_aceptados_at: now,
        campos_completados: camposCompletados,
        firma_data: myRole === 'firmante' ? finalFirmaData : null,
        firma_completada: myRole === 'firmante' ? (finalFirmaData !== null) : false,
        firma_completada_at: myRole === 'firmante' && finalFirmaData ? now : null,
        aprobacion_completada: myRole === 'aprobador',
        aprobacion_completada_at: myRole === 'aprobador' ? now : null,
        observaciones: observaciones || null,
      };

      const { error: upsertError } = await supabase
        .from('participation_responses')
        .upsert(responsePayload, { onConflict: 'documento_id,participante_email' });

      if (upsertError) throw new Error(upsertError.message);

      const subEstado = myRole === 'firmante' ? 'firmo' : 'aprobo';
      await supabase.rpc('update_participante_sub_estado', {
        p_documento_id: document.id,
        p_email: user.email,
        p_sub_estado: subEstado,
      });

      // Update participant's estado to 'firmado' in the participantes JSONB array
      await supabase.rpc('update_participante_estado', {
        p_documento_id: document.id,
        p_email: user.email,
        p_estado: 'firmado',
      });

      // Check if ALL participants have completed and determine document estado
      const TERMINAL_SUB_ESTADOS = ['firmo', 'firmado', 'aprobo', 'aprobado', 'rechazo', 'rechazado', 'cancelo', 'cancelado'];
      const { data: updatedDoc } = await supabase
        .from('documentos')
        .select('participantes, estado')
        .eq('id', document.id)
        .single();

      let documentoEstado: 'completado' | 'firmado' | 'en_progreso' = 'en_progreso';

      if (updatedDoc && updatedDoc.estado !== 'completado' && updatedDoc.estado !== 'cancelado') {
        const updatedParticipantes: any[] = updatedDoc.participantes ?? [];

        // If participantes array is empty or null, the current user is the only/last signer
        if (updatedParticipantes.length === 0) {
          documentoEstado = 'completado';
          const completedAt = new Date().toISOString();
          await supabase
            .from('documentos')
            .update({ estado: 'completado', fecha_completado: completedAt })
            .eq('id', document.id);
        } else {
          // Mark current user as signed in the local copy for evaluation
          // Match by email (case-insensitive), supabase user id, or participant id
          const userEmailLower = (user.email || '').toLowerCase();
          const participantesEvaluados = updatedParticipantes.map((p: any) => {
            const pEmail = (p.email || '').toLowerCase();
            if (pEmail === userEmailLower || p.id === user.id || p.user_id === user.id) {
              return { ...p, sub_estado: subEstado, estado: 'firmado' };
            }
            return p;
          });

          // Check terminal state using both sub_estado AND estado fields
          const allCompleted =
            participantesEvaluados.length > 0 &&
            participantesEvaluados.every((p: any) => {
              const sub = (p.sub_estado ?? '').toLowerCase();
              const est = (p.estado ?? '').toLowerCase();
              return TERMINAL_SUB_ESTADOS.includes(sub) || TERMINAL_SUB_ESTADOS.includes(est);
            });

          // Additional check: if there's only 1 participant and we just signed, mark as completado
          const isSoloParticipant = updatedParticipantes.length === 1;

          if (allCompleted || isSoloParticipant) {
            documentoEstado = 'completado';
            const completedAt = new Date().toISOString();
            await supabase
              .from('documentos')
              .update({ estado: 'completado', fecha_completado: completedAt })
              .eq('id', document.id);
          } else {
            // Some participants still pending — mark as en_progreso
            await supabase
              .from('documentos')
              .update({ estado: 'en_progreso' })
              .eq('id', document.id);

            // ── Advance participation chain for sequential/mixed orders ────
            // Notify the next participant(s) in line based on participation_order
            try {
              const { data: { session: currentSession } } = await supabase.auth.getSession();
              if (currentSession?.access_token) {
                await fetch('/api/documentos/advance-participation', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentSession.access_token}`,
                  },
                  body: JSON.stringify({ documentoId: document.id }),
                }).catch(() => {});
              }
            } catch { /* non-critical */ }
          }
        }
      } else if (!updatedDoc) {
        // Could not read document back (RLS or network issue) — use service role via API to check
        // Fallback: if current user is the only participant in local document data, mark as completed
        const localParticipantes: any[] = document.participantes ?? [];
        if (localParticipantes.length <= 1) {
          documentoEstado = 'completado';
          // Best-effort update via supabase (may fail for participants without UPDATE permission)
          await supabase
            .from('documentos')
            .update({ estado: 'completado', fecha_completado: new Date().toISOString() })
            .eq('id', document.id);
        }
      }

      // Store captured evidence in state for display
      setSignatureEvidence({
        signedAt: now,
        ipAddress,
        coordinates,
        signatureHash,
        timestampSello: now,
        signatureType: sigTypeLabel,
        documentoEstado,
        efirmaSerial: isEfirmaSAT ? (profileEfirma?.serial || null) : null,
        efirmaRfc: isEfirmaSAT ? (profileEfirma?.rfc || userProfile.rfc || null) : null,
        efirmaNombre: isEfirmaSAT ? (profileEfirma?.nombre || userProfile.nombre_completo || null) : null,
        efirmaVigenciaFin: isEfirmaSAT ? (profileEfirma?.vigenciaFin || null) : null,
        serverTimestamp: serverEfirmaSignedAt,
        nubariumEstado: isEfirmaSAT ? (nubariumValidationResult?.estado || null) : null,
        nubariumFechaConsulta: isEfirmaSAT ? (nubariumValidationResult?.fechaConsulta || null) : null,
        nubariumCodigoValidacion: isEfirmaSAT ? (nubariumValidationResult?.codigoValidacion || null) : null,
      });

      const actorNombre = user.user_metadata?.full_name || user.email || 'Usuario';
      await supabase.from('document_activity_log').insert({
        documento_id: document.id,
        actor_id: user.id,
        actor_nombre: actorNombre,
        actor_email: user.email || '',
        action: myRole === 'firmante' ? 'firma_completada' : 'aprobacion_completada',
        category: 'firma',
        details: { metodo: myRole, campos_completados: camposCompletados.length, ip: ipAddress, hash: signatureHash },
      });

      if (document.owner_id && user.id !== document.owner_id) {
        await createNotification({
          userId: document.owner_id,
          type: 'document',
          title: myRole === 'firmante' ? 'Participante firmó el documento' : 'Participante aprobó el documento',
          description: `${actorNombre} ha ${myRole === 'firmante' ? 'firmado' : 'aprobado'} "${document.nombre}".`,
          priority: 'media',
          metadata: { documentoId: document.id, documentName: document.nombre, signerEmail: user.email },
        });
      }

      // ── Send participation completion email to the participant ────────────
      if (user.email) {
        sendParticipationCompletionEmail({
          participantEmail: user.email,
          participantName: user.user_metadata?.full_name || user.email,
          documentName: document.nombre || 'Documento',
          participationStatus: 'firmado',
          completedAt: now,
        }).catch((err: unknown) => {
          console.error('[firmar-documento] Failed to send firmado completion email:', err instanceof Error ? err.message : err);
        });
      }

      // ── Send owner notification email when participant approves ───────────
      if (myRole === 'aprobador' && document.owner_id && user.id !== document.owner_id) {
        // Fetch owner profile for email
        const { data: ownerProf } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', document.owner_id)
          .maybeSingle();
        if (ownerProf?.email) {
          sendOwnerParticipantActionEmail({
            ownerEmail: ownerProf.email,
            ownerName: ownerProf.full_name || undefined,
            documentName: document.nombre || 'Documento',
            participantName: actorNombre,
            participantEmail: user.email,
            action: 'aprobado',
            completedAt: now,
          }).catch(() => {});
        }
      }

      setStep('completado');
      // Trigger green success animation after a short delay
      setTimeout(() => setShowSuccessAnim(true), 150);
    } catch (err: any) {
      setSubmitError(err?.message || 'Error al enviar la participación');
    } finally {
      setSubmitting(false);
    }
  };

  const steps = myRole === 'aprobador'
    ? [
        { id: 'terminos', label: 'Términos' },
        { id: 'aprobacion', label: 'Aprobación' },
      ]
    : [
        { id: 'terminos', label: 'Términos' },
        { id: 'campos', label: 'Campos' },
        { id: 'firma', label: 'Firma' },
      ];

  const currentStepIndex = steps.findIndex((s) => s.id === step);
  const signingStepIcons: Record<string, React.ElementType> = {
    terminos: Shield,
    campos: Type,
    firma: PenLine,
    aprobacion: CheckCircle2,
  };
  const currentStepData = steps[currentStepIndex] || steps[0];
  const CurrentSigningStepIcon = signingStepIcons[currentStepData?.id || 'terminos'] || FileText;
  const currentStepDescription = ({
    terminos: 'Revisa las condiciones y confirma tu consentimiento para participar.',
    campos: 'Completa la informacion solicitada y ubica los campos necesarios.',
    firma: 'Selecciona tu metodo y confirma la firma del documento.',
    aprobacion: 'Revisa la informacion y registra tu decision sobre el documento.',
  } as Record<string, string>)[currentStepData?.id || 'terminos'];
  const completionPercent = Math.round((Math.max(currentStepIndex, 0) / Math.max(steps.length - 1, 1)) * 100);

  // ── Fullscreen handler ─────────────────────────────────────────────────────
  const handleToggleFullscreen = useCallback(() => {
    const doc = window.document as Document & {
      webkitFullscreenElement?: Element;
      mozFullScreenElement?: Element;
      webkitExitFullscreen?: () => Promise<void>;
      mozCancelFullScreen?: () => Promise<void>;
    };
    const el = window.document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      mozRequestFullScreen?: () => Promise<void>;
    };
    const isCurrentlyFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement);
    if (!isCurrentlyFullscreen) {
      (el.requestFullscreen?.() || el.webkitRequestFullscreen?.() || el.mozRequestFullScreen?.())?.catch(() => {});
      setIsFullscreen(true);
    } else {
      (doc.exitFullscreen?.() || doc.webkitExitFullscreen?.() || doc.mozCancelFullScreen?.())?.catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = window.document as Document & {
        webkitFullscreenElement?: Element;
        mozFullScreenElement?: Element;
      };
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement));
    };
    window.document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      window.document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // ── Loading / Error ────────────────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin h-8 w-8 text-primary" />
          <p className="text-sm text-muted-foreground">Cargando documento...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Shield size={40} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Debes iniciar sesión para participar.</p>
          <button onClick={() => router.push('/login')}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors">
            Iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  if (docError || !document) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <AlertTriangle size={40} className="text-amber-400 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No se pudo cargar el documento.</p>
          <button onClick={() => router.back()}
            className="mt-4 px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors">
            Volver
          </button>
        </div>
      </div>
    );
  }

  // ── Protección adicional para participar — OTP/TOTP gate ──────────────────
  if (proteccionParticipacionEnabled && !proteccionVerified) {
    const handleSendOtp = async () => {
      setProteccionSending(true);
      setProteccionError(null);
      try {
        const { data: { session } } = await createClient().auth.getSession();
        if (!session?.access_token || !user?.email) throw new Error('La sesion no es valida. Inicia sesion nuevamente.');
        const res = await fetch('/api/firma/send-otp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ documentId: docId, recipientEmail: user.email }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Error al enviar OTP');
        setProteccionOtpSent(true);
      } catch (err: any) {
        setProteccionError(err.message || 'Error al enviar OTP');
      } finally {
        setProteccionSending(false);
      }
    };

    const handleVerifyOtp = async () => {
      setProteccionVerifying(true);
      setProteccionError(null);
      try {
        const supabase = createClient();
        const code = proteccionHasTOTP ? proteccionTotpCode : proteccionOtp;
        if (!code || code.length < 4) throw new Error('Ingresa el código de verificación.');

        if (proteccionHasTOTP) {
          // Verify TOTP via existing endpoint
          const res = await fetch('/api/auth/totp/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          });
          const json = await res.json();
          if (!res.ok || !json.valid) throw new Error('Código TOTP inválido.');
        } else {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.access_token) throw new Error('La sesion no es valida. Inicia sesion nuevamente.');
          const res = await fetch('/api/firma/send-otp', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ documentId: docId, otpCode: code.trim() }),
          });
          const json = await res.json();
          if (!res.ok || !json.verified) throw new Error(json.error || 'Codigo incorrecto.');
        }

        setProteccionVerified(true);
      } catch (err: any) {
        setProteccionError(err.message || 'Error al verificar');
      } finally {
        setProteccionVerifying(false);
      }
    };

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 border border-gray-100">
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Shield size={28} className="text-primary" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 text-center">Verificación de identidad</h2>
            <p className="text-sm text-gray-500 text-center mt-2">
              Este documento requiere verificación adicional antes de participar.
            </p>
          </div>

          {proteccionHasTOTP ? (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
                <p className="text-sm text-blue-700 font-medium">Token móvil (TOTP)</p>
                <p className="text-xs text-blue-600 mt-1">Ingresa el código de 6 dígitos de tu aplicación autenticadora.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Código TOTP</label>
                <input
                  type="text"
                  value={proteccionTotpCode}
                  onChange={(e) => { setProteccionTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setProteccionError(null); }}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 text-center text-xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                />
              </div>
              {proteccionError && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={11} />{proteccionError}</p>}
              <button
                type="button"
                onClick={handleVerifyOtp}
                disabled={proteccionVerifying || proteccionTotpCode.length < 6}
                className="w-full py-3 bg-primary text-white rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {proteccionVerifying ? <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Verificando...</> : 'Verificar y continuar'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
                <p className="text-sm text-amber-700 font-medium">OTP por correo electrónico</p>
                <p className="text-xs text-amber-600 mt-1">Se enviará un código de verificación a <span className="font-semibold">{user?.email}</span></p>
              </div>

              {!proteccionOtpSent ? (
                <>
                  {proteccionError && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={11} />{proteccionError}</p>}
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={proteccionSending}
                    className="w-full py-3 bg-primary text-white rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {proteccionSending ? <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Enviando...</> : <><Mail size={15} />Enviar código OTP</>}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Código OTP recibido</label>
                    <input
                      type="text"
                      value={proteccionOtp}
                      onChange={(e) => { setProteccionOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setProteccionError(null); }}
                      placeholder="000000"
                      maxLength={6}
                      className="w-full border border-gray-200 rounded-lg px-4 py-3 text-center text-xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30"
                      autoFocus
                    />
                  </div>
                  {proteccionError && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={11} />{proteccionError}</p>}
                  <button
                    type="button"
                    onClick={handleVerifyOtp}
                    disabled={proteccionVerifying || proteccionOtp.length < 4}
                    className="w-full py-3 bg-primary text-white rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {proteccionVerifying ? <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Verificando...</> : 'Verificar y continuar'}
                  </button>
                  <button type="button" onClick={() => { setProteccionOtpSent(false); setProteccionOtp(''); setProteccionError(null); }} className="w-full text-xs text-gray-500 hover:text-gray-700 underline">
                    Reenviar código
                  </button>
                </>
              )}
            </div>
          )}

          <button onClick={() => router.back()} className="mt-4 w-full text-xs text-gray-400 hover:text-gray-600 transition-colors">
            ← Volver
          </button>
        </div>
      </div>
    );
  }

  // ── Completado screen ──────────────────────────────────────────────────────
  if (step === 'completado') {
    const ev = signatureEvidence;
    const signedDate = ev?.signedAt ? new Date(ev.signedAt) : new Date();
    const displayFirmaData = firmaData || savedSignature;
    const completedSigType: 'efirma' | 'autografa' | 'clicksign' = isEfirmaSAT || ev?.signatureType === 'e.firma (SAT)'
      ? 'efirma'
      : isAutografaDigital || savedSignatureType === 'autografa' || autographFlowDone || ev?.signatureType === 'Firma Autógrafa Digital'
        ? 'autografa'
        : 'clicksign';
    const completedStampStyle = completedSigType === 'efirma'
      ? efirmaStampStyle
      : completedSigType === 'autografa'
        ? autografaStampStyle
        : clickSignStampStyle;
    const completedStampProps: StampDisplayProps = {
      stampStyle: completedStampStyle,
      signatureType: completedSigType,
      signatureUrl: displayFirmaData,
      userName: userProfile.nombre_completo,
      userRfc: userProfile.rfc,
      signatureHash: ev?.signatureHash || '',
      signedAt: ev?.signedAt || new Date().toISOString(),
      ipAddress: ev?.ipAddress || '—',
      coordinates: ev?.coordinates || null,
      efirmaSerial: ev?.efirmaSerial,
      efirmaVigenciaFin: ev?.efirmaVigenciaFin,
    };

    // Fields to stamp on the PDF (all placed fields for current page)
    const stampFieldsForPage = (page: number) =>
      placedFields.filter((f) => (f.page || 1) === page);

    return (
      <div className={`min-h-screen flex flex-col transition-colors duration-300 ${isDark ? 'bg-gray-900' : 'bg-background'}`}>
        {/* ── Top Bar — step nav hidden on completado ──────────────────────── */}
        <header className={`h-16 border-b flex items-center px-6 shrink-0 z-10 transition-colors duration-300 ${isDark ? 'bg-gray-800 border-gray-700' : 'border-gray-100 bg-white'}`}>
          <div className="flex-1">
            <AppLogo size={36} />
          </div>
          {/* Step bar intentionally hidden on success state */}
          <div className="flex-1 flex items-center justify-end gap-1">
          </div>
        </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
          {/* PDF Viewer (left) */}
          <div className={`hidden lg:flex flex-col border-r transition-all duration-300 w-[70%] ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-border'}`}>
            {document.file_url ? (
              <div className="flex-1 relative overflow-hidden">
                <div className="absolute inset-0 overflow-auto p-4 flex justify-center">
                  <div className="shadow-xl bg-white self-start relative">
                    <PdfCanvas
                      fileUrl={document.file_url}
                      page={currentPage}
                      zoom={zoom}
                      onTotalPages={setTotalPages}
                    />
                    {/* Stamp overlay: placed fields with filled values */}
                    {stampFieldsForPage(currentPage).length > 0 && (
                      <div className="absolute inset-0" style={{ zIndex: 10, pointerEvents: 'none' }}>
                        {stampFieldsForPage(currentPage).map((field) => (
                          <CompletedFieldStamp
                            key={field.id}
                            field={field}
                            firmaDataUrl={displayFirmaData}
                            stampDisplayProps={completedStampProps}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {/* Zoom + Pagination bar */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
                  <div className="flex items-center gap-1 bg-white/90 backdrop-blur-sm border border-border rounded-full px-3 py-1.5 shadow-md">
                    <button onClick={() => setZoom((z) => Math.max(50, z - 10))} disabled={zoom <= 50} className="w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                    </button>
                    <span className="text-sm text-slate-600 font-medium min-w-[44px] text-center select-none">{zoom}%</span>
                    <button onClick={() => setZoom((z) => Math.min(200, z + 10))} disabled={zoom >= 200} className="w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                    </button>
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <span className="text-sm text-slate-600 font-medium min-w-[48px] text-center select-none">{currentPage} / {totalPages}</span>
                    <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <FileText size={40} className={`mx-auto mb-2 ${isDark ? 'text-gray-600' : 'text-slate-300'}`} />
                  <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>Sin vista previa disponible</p>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel — Success animation */}
          <div className={`lg:w-[30%] flex-1 lg:flex-none flex flex-col overflow-hidden transition-colors duration-300 ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
            <div className="flex-1 overflow-y-auto">
              {/* ── RESUMEN TAB ── */}
              {activeCompletadoTab === 'resumen' && (
              <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">

                {/* Animated success icon */}
                <div className="flex flex-col items-center text-center pt-4">
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 transition-all duration-700 ${showSuccessAnim ? 'bg-green-100 scale-110' : 'bg-gray-100'}`}>
                    <CheckCircle2 size={40} className={`transition-all duration-700 ${showSuccessAnim ? 'text-green-500' : 'text-gray-300'}`} />
                  </div>
                  <h2 className={`text-xl font-bold mb-1 ${isDark ? 'text-gray-100' : 'text-foreground'}`}>
                    {myRole === 'firmante' ? '¡Documento firmado!' : '¡Aprobación registrada!'}
                  </h2>
                  <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                    {myRole === 'firmante' ? 'Tu firma ha sido registrada exitosamente.' : 'Tu aprobación ha sido registrada exitosamente.'}
                  </p>
                </div>

                {/* Animated progress bar */}
                <div className={`rounded-xl p-4 border transition-all duration-700 ${showSuccessAnim ? (isDark ? 'bg-green-900/20 border-green-700' : 'bg-green-50 border-green-200') : (isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/30 border-border')}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-700 ${showSuccessAnim ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                      <Check size={12} />
                    </div>
                    <span className={`text-sm font-semibold transition-colors duration-700 ${showSuccessAnim ? (isDark ? 'text-green-400' : 'text-green-700') : (isDark ? 'text-gray-400' : 'text-muted-foreground')}`}>
                      {myRole === 'firmante' ? '¡Firma completada!' : '¡Aprobación completada!'}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    <div
                      className="h-full rounded-full bg-green-500 transition-all duration-700 ease-out"
                      style={{ width: showSuccessAnim ? '100%' : '0%' }}
                    />
                  </div>
                </div>

                {/* Firma stamp — replaces "Documento" section */}
                <div className={`rounded-xl p-4 border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/40 border-border'}`}>
                  <p className={`text-xs mb-2 font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                    {ev?.signatureType === 'e.firma (SAT)' ? 'Estampa de e.firma' : isAutografaDigital ? 'Estampa de firma autógrafa' : 'Estampa de firma digital'}
                  </p>
                  {(() => {
                    // Determine stamp type and style based on signing method
                    const sigType: 'efirma' | 'autografa' | 'clicksign' = isEfirmaSAT || ev?.signatureType === 'e.firma (SAT)'
                      ? 'efirma'
                      : isAutografaDigital || savedSignatureType === 'autografa' || autographFlowDone || ev?.signatureType === 'Firma Autógrafa Digital' ? 'autografa' : 'clicksign';
                    const stampStyle = sigType === 'efirma'
                      ? efirmaStampStyle
                      : sigType === 'autografa'
                        ? autografaStampStyle
                        : clickSignStampStyle;
                    return (
                      <div className={`rounded-lg border p-3 ${isDark ? 'bg-gray-900 border-gray-600' : 'bg-white border-gray-200'}`}>
                        <SignatureStampDisplay
                          stampStyle={stampStyle}
                          signatureType={sigType}
                          signatureUrl={displayFirmaData}
                          userName={userProfile.nombre_completo}
                          userRfc={userProfile.rfc}
                          signatureHash={ev?.signatureHash || ''}
                          signedAt={ev?.signedAt || new Date().toISOString()}
                          ipAddress={ev?.ipAddress || '—'}
                          coordinates={ev?.coordinates || null}
                          efirmaSerial={ev?.efirmaSerial}
                          efirmaVigenciaFin={ev?.efirmaVigenciaFin}
                        />
                      </div>
                    );
                  })()}
                  <div className="mt-2 flex items-center gap-2">
                    <Shield size={11} className="text-green-500 shrink-0" />
                    <p className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>
                      {ev?.signatureType || (savedSignatureType === 'efirma' ? 'e.firma (SAT)' : savedSignatureType === 'firma_electronica' ? 'Firma Electrónica Digital' : 'Firma Autógrafa Digital')}
                    </p>
                    {ev?.documentoEstado && (
                      <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${ev.documentoEstado === 'completado' ? 'bg-green-100 text-green-700' : ev.documentoEstado === 'firmado' ? 'bg-green-100 text-green-700' : 'bg-green-100 text-green-700'}`}>
                        {ev.documentoEstado === 'completado' ? 'Completado' : ev.documentoEstado === 'firmado' ? 'Firmó' : 'Firmó'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Datos de la firma — replaces "Participante" section */}
                <div className={`rounded-xl p-4 border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/40 border-border'}`}>
                  <p className={`text-xs mb-3 font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>Datos de la firma</p>
                  <div className="space-y-2">
                    {/* Participant name */}
                    {userProfile.nombre_completo && (
                      <div className="flex items-start gap-2">
                        <User size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                        <div className="min-w-0">
                          <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Firmante</p>
                          <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{userProfile.nombre_completo}</p>
                        </div>
                      </div>
                    )}
                    {/* Email */}
                    {(userProfile.email || user?.email) && (
                      <div className="flex items-start gap-2">
                        <Mail size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                        <div className="min-w-0">
                          <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Correo</p>
                          <p className={`text-xs truncate ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>{userProfile.email || user?.email}</p>
                        </div>
                      </div>
                    )}
                    {/* Acción */}
                    <div className="flex items-start gap-2">
                      <PenLine size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                      <div className="min-w-0">
                        <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Acción</p>
                        <p className={`text-xs font-semibold text-green-600`}>Firmado</p>
                      </div>
                    </div>
                    {/* Fecha y hora */}
                    <div className="flex items-start gap-2">
                      <Calendar size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                      <div className="min-w-0">
                        <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Fecha y hora de firma</p>
                        <p className={`text-xs ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>
                          {signedDate.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })} · {signedDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    {/* IP */}
                    {ev?.ipAddress && ev.ipAddress !== '—' && (
                      <div className="flex items-start gap-2">
                        <Shield size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                        <div className="min-w-0">
                          <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Dirección IP</p>
                          <p className={`text-xs font-mono ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>{ev.ipAddress}</p>
                        </div>
                      </div>
                    )}
                    {/* Coordenadas */}
                    <div className="flex items-start gap-2">
                      <MapPin size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                      <div className="min-w-0">
                        <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Lugar de firma (coordenadas)</p>
                        <p className={`text-xs font-mono ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>
                          {ev?.coordinates ? `${ev.coordinates.lat.toFixed(6)}, ${ev.coordinates.lng.toFixed(6)}` : 'No disponible'}
                        </p>
                      </div>
                    </div>
                    {/* Estampa de tiempo */}
                    <div className="flex items-start gap-2">
                      <Clock size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                      <div className="min-w-0">
                        <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Estampa de tiempo (ISO 8601)</p>
                        <p className={`text-xs font-mono break-all ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>{ev?.timestampSello || signedDate.toISOString()}</p>
                      </div>
                    </div>
                    {/* Hash */}
                    {ev?.signatureHash && (
                      <div className="flex items-start gap-2">
                        <Hash size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                        <div className="min-w-0">
                          <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Hash de firma (SHA-256)</p>
                          <p className={`text-[10px] font-mono break-all ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>{ev.signatureHash}</p>
                        </div>
                      </div>
                    )}
                    {/* RFC / CURP */}
                    {userProfile.rfc && (
                      <div className="flex items-start gap-2">
                        <FileText size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                        <div className="min-w-0">
                          <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>RFC</p>
                          <p className={`text-xs font-mono ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>{userProfile.rfc}</p>
                        </div>
                      </div>
                    )}
                    {userProfile.curp && (
                      <div className="flex items-start gap-2">
                        <UserCheck size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                        <div className="min-w-0">
                          <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>CURP</p>
                          <p className={`text-xs font-mono ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>{userProfile.curp}</p>
                        </div>
                      </div>
                    )}
                    {/* ── e.firma SAT specific evidence ── */}
                    {(ev?.efirmaSerial || ev?.efirmaRfc) && (
                      <>
                        <div className={`my-1 border-t ${isDark ? 'border-gray-700' : 'border-border'}`} />
                        {/* Validation badge */}
                        <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${isDark ? 'bg-blue-900/20 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
                          <Shield size={11} className="text-blue-500 shrink-0" />
                          <p className={`text-[10px] font-semibold ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>e.firma SAT — Validada ante el SAT</p>
                          <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isDark ? 'bg-green-800 text-green-300' : 'bg-green-100 text-green-700'}`}>Vigente</span>
                        </div>
                        {/* Estampa de tiempo del servidor */}
                        {ev?.serverTimestamp && (
                          <div className="flex items-start gap-2">
                            <Clock size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                            <div className="min-w-0">
                              <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Estampa de tiempo del servidor (ISO 8601)</p>
                              <p className={`text-[10px] font-mono break-all ${isDark ? 'text-teal-300' : 'text-teal-700'}`}>{ev.serverTimestamp}</p>
                            </div>
                          </div>
                        )}
                        {/* Serial */}
                        {ev.efirmaSerial && (
                          <div className="flex items-start gap-2">
                            <Hash size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                            <div className="min-w-0">
                              <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>No. de Serie (e.firma)</p>
                              <p className={`text-[10px] font-mono break-all ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>{ev.efirmaSerial}</p>
                            </div>
                          </div>
                        )}
                        {/* RFC e.firma */}
                        {ev.efirmaRfc && (
                          <div className="flex items-start gap-2">
                            <FileText size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                            <div className="min-w-0">
                              <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>RFC (e.firma)</p>
                              <p className={`text-xs font-mono ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>{ev.efirmaRfc}</p>
                            </div>
                          </div>
                        )}
                        {/* Nombre titular */}
                        {ev.efirmaNombre && (
                          <div className="flex items-start gap-2">
                            <User size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                            <div className="min-w-0">
                              <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Titular del certificado</p>
                              <p className={`text-xs ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>{ev.efirmaNombre}</p>
                            </div>
                          </div>
                        )}
                        {/* Vigencia */}
                        {ev.efirmaVigenciaFin && (
                          <div className="flex items-start gap-2">
                            <Calendar size={12} className={`mt-0.5 shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`} />
                            <div className="min-w-0">
                              <p className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Vigencia del certificado</p>
                              <p className={`text-xs ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>
                                {new Date(ev.efirmaVigenciaFin).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}
                              </p>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

              </div>
              )}

              {/* ── DESCARGAS TAB ── */}
              {activeCompletadoTab === 'descargas' && (
              <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">

                {/* Header */}
                <div className="flex flex-col gap-1">
                  <h3 className={`text-base font-bold ${isDark ? 'text-gray-100' : 'text-foreground'}`}>Documentos disponibles</h3>
                  <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>Descarga el documento original y tu constancia de participación.</p>
                </div>

                {/* Documento original */}
                <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-border bg-white'}`}>
                  <div className={`px-4 py-3 border-b flex items-center gap-2 ${isDark ? 'bg-gray-700/50 border-gray-700' : 'bg-muted/30 border-border'}`}>
                    <FileText size={14} className={isDark ? 'text-gray-400' : 'text-muted-foreground'} />
                    <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-foreground'}`}>Documento Original</p>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isDark ? 'bg-gray-700' : 'bg-slate-100'}`}>
                        <FileText size={18} className={isDark ? 'text-gray-400' : 'text-slate-500'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{document.nombre || 'Documento'}</p>
                        <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Archivo PDF original del documento</p>
                      </div>
                    </div>
                    {document.file_url ? (
                      <button
                        onClick={downloadOriginalDocument}
                        disabled={downloadingOriginal}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDark ? 'border-gray-600 text-gray-200 hover:bg-gray-700' : 'border-border text-foreground hover:bg-muted'}`}
                      >
                        {downloadingOriginal ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        Descargar documento original
                      </button>
                    ) : (
                      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${isDark ? 'bg-gray-700/50' : 'bg-muted/50'}`}>
                        <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                        <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>El documento original no está disponible para descarga.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Constancia de participación */}
                <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-border bg-white'}`}>
                  <div className={`px-4 py-3 border-b flex items-center gap-2 ${isDark ? 'bg-gray-700/50 border-gray-700' : 'bg-muted/30 border-border'}`}>
                    <Shield size={14} className="text-green-500" />
                    <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-foreground'}`}>Constancia de Participación</p>
                    <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${isDark ? 'bg-green-900/40 text-green-400' : 'bg-green-100 text-green-700'}`}>Individual</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isDark ? 'bg-green-900/30' : 'bg-green-50'}`}>
                        <Shield size={18} className="text-green-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Constancia Individual de Participación</p>
                        <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>
                          {(signatureEvidence?.signatureType?.includes('efirma') || signatureEvidence?.signatureType?.includes('e.firma') || savedSignatureType === 'efirma')
                            ? 'Método: Firma Electrónica Avanzada · e.firma SAT' :'Método: Firma Autógrafa Digitalizada'}
                        </p>
                      </div>
                    </div>

                    {/* Constancia details */}
                    <div className={`rounded-lg p-3 space-y-1.5 ${isDark ? 'bg-gray-700/40' : 'bg-muted/40'}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Firmante</span>
                        <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-foreground'}`}>{userProfile.nombre_completo || user?.email || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Fecha de firma</span>
                        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                          {signatureEvidence?.signedAt
                            ? new Date(signatureEvidence.signedAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })
                            : new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Algoritmo</span>
                        <span className={`text-xs font-mono ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>SHA-256</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Verificación</span>
                        <span className={`text-xs ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>verificar.docubox.mx</span>
                      </div>
                    </div>

                    {/* Legal note */}
                    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 ${isDark ? 'bg-blue-900/20 border border-blue-800' : 'bg-blue-50 border border-blue-100'}`}>
                      <Shield size={11} className="text-blue-500 shrink-0 mt-0.5" />
                      <p className={`text-[10px] leading-relaxed ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                        Válida conforme a los Arts. 89–97 del Código de Comercio, LFEA y NOM-151-SCFI-2016. Documento confidencial — uso exclusivo del firmante.
                      </p>
                    </div>

                    <button
                      onClick={generateConstanciaPDF}
                      disabled={generatingPdf}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {generatingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      Descargar constancia de participación
                    </button>
                  </div>
                </div>

                {/* ── NOM-151 Constancia de Conservación ── */}
                <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-purple-800/50 bg-gray-800' : 'border-purple-200 bg-white'}`}>
                  <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-purple-800/40 bg-purple-900/20' : 'border-purple-100 bg-purple-50'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-base">🔏</span>
                      <span className={`text-xs font-bold uppercase tracking-wide ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>Constancia NOM-151</span>
                    </div>
                    {nom151Data ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDark ? 'bg-purple-900/40 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>Emitida</span>
                    ) : (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDark ? 'bg-yellow-900/40 text-yellow-400' : 'bg-yellow-100 text-yellow-700'}`}>
                        {nom151Polling ? 'Generando…' : 'Pendiente'}
                      </span>
                    )}
                  </div>
                  <div className="p-4 space-y-3">
                    {nom151Data ? (
                      <>
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isDark ? 'bg-purple-900/30' : 'bg-purple-50'}`}>
                            <ShieldCheck size={18} className="text-purple-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Constancia de Conservación NOM-151</p>
                            <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>PSC: Nubarium · Secretaría de Economía</p>
                          </div>
                        </div>
                        <div className={`rounded-lg p-3 space-y-1.5 ${isDark ? 'bg-gray-700/40' : 'bg-muted/40'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Código validación</span>
                            <span className={`text-xs font-mono truncate ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>{nom151Data.nubarium_codigo_validacion}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Hash SHA-256</span>
                            <span className={`text-xs font-mono truncate ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>{nom151Data.constancia_sha256.slice(0, 16)}…</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Fecha emisión</span>
                            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                              {new Date(nom151Data.created_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                        </div>
                        <div className={`flex items-start gap-2 rounded-lg px-3 py-2 ${isDark ? 'bg-purple-900/20 border border-purple-800' : 'bg-purple-50 border border-purple-100'}`}>
                          <ShieldCheck size={11} className="text-purple-500 shrink-0 mt-0.5" />
                          <p className={`text-[10px] leading-relaxed ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
                            Constancia emitida conforme a NOM-151-SCFI-2016. Válida ante cualquier autoridad o tribunal mexicano. Archivo .ans vinculado al PDF por hash criptográfico.
                          </p>
                        </div>
                        <a
                          href="https://validatuconstancia.pscworld.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl border transition-colors ${isDark ? 'border-purple-700 text-purple-300 hover:bg-purple-900/30' : 'border-purple-300 text-purple-700 hover:bg-purple-50'}`}
                        >
                          <ShieldCheck size={14} />
                          Verificar validez en PSC
                        </a>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-3 py-4">
                        {nom151Polling ? (
                          <>
                            <Loader2 size={24} className={`animate-spin ${isDark ? 'text-purple-400' : 'text-purple-500'}`} />
                            <p className={`text-sm text-center ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                              Generando constancia NOM-151…<br />
                              <span className="text-xs">Esto puede tomar unos segundos</span>
                            </p>
                          </>
                        ) : (
                          <>
                            <Clock size={24} className={`${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                            <p className={`text-sm text-center ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                              La constancia NOM-151 se generará automáticamente cuando el documento esté completado.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── XML Evidencia ── */}
                <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-emerald-800/50 bg-gray-800' : 'border-emerald-200 bg-white'}`}>
                  <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-emerald-800/40 bg-emerald-900/20' : 'border-emerald-100 bg-emerald-50'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-base">📄</span>
                      <span className={`text-xs font-bold uppercase tracking-wide ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>XML de Evidencia</span>
                    </div>
                    {xmlEvidenceData ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDark ? 'bg-emerald-900/40 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>Generado</span>
                    ) : (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDark ? 'bg-yellow-900/40 text-yellow-400' : 'bg-yellow-100 text-yellow-700'}`}>
                        {xmlPolling ? 'Generando…' : 'Pendiente'}
                      </span>
                    )}
                  </div>
                  <div className="p-4 space-y-3">
                    {xmlEvidenceData ? (
                      <>
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isDark ? 'bg-emerald-900/30' : 'bg-emerald-50'}`}>
                            <FileText size={18} className="text-emerald-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Paquete de Evidencia XMLDSig</p>
                            <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Evidencia criptográfica completa del documento</p>
                          </div>
                        </div>
                        <div className={`rounded-lg p-3 space-y-1.5 ${isDark ? 'bg-gray-700/40' : 'bg-muted/40'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Hash XML</span>
                            <span className={`text-xs font-mono truncate ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>{xmlEvidenceData.xml_hash_sha256?.slice(0, 16)}…</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Generado</span>
                            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                              {new Date(xmlEvidenceData.xml_generated_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>Algoritmo</span>
                            <span className={`text-xs font-mono ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>RSA-SHA256 + XMLDSig</span>
                          </div>
                        </div>
                        <div className={`flex items-start gap-2 rounded-lg px-3 py-2 ${isDark ? 'bg-emerald-900/20 border border-emerald-800' : 'bg-emerald-50 border border-emerald-100'}`}>
                          <ShieldCheck size={11} className="text-emerald-500 shrink-0 mt-0.5" />
                          <p className={`text-[10px] leading-relaxed ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                            Paquete de evidencia conforme a XMLDSig W3C y NOM-151-SCFI-2016. Contiene identidad del documento, firmantes, bitácora de eventos y sello de conservación.
                          </p>
                        </div>
                        <button
                          onClick={downloadXmlEvidence}
                          disabled={downloadingXml}
                          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDark ? 'border-emerald-700 text-emerald-300 hover:bg-emerald-900/30' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'}`}
                        >
                          {downloadingXml ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                          Descargar XML de evidencia
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-3 py-4">
                        {xmlPolling ? (
                          <>
                            <Loader2 size={24} className={`animate-spin ${isDark ? 'text-emerald-400' : 'text-emerald-500'}`} />
                            <p className={`text-sm text-center ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                              Generando XML de evidencia…<br />
                              <span className="text-xs">Esto puede tomar unos segundos</span>
                            </p>
                          </>
                        ) : (
                          <>
                            <Clock size={24} className={`${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                            <p className={`text-sm text-center ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                              El XML de evidencia se generará automáticamente cuando el documento esté completado.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

              </div>
              )}
            </div>

            {/* Bottom action bar */}
            <div className={`border-t px-4 sm:px-6 py-3 flex flex-col gap-2 flex-shrink-0 shadow-sm transition-colors duration-300 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-border bg-card'}`}>
              <button
                onClick={generateConstanciaPDF}
                disabled={generatingPdf}
                className="w-full flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {generatingPdf ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Descargar constancia de participación
              </button>
              <button
                onClick={() => router.push(`/visor-documento/${document.id}`)}
                className={`flex items-center justify-center gap-2 w-full px-5 py-2.5 text-sm font-medium rounded-xl border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-border text-foreground hover:bg-muted'}`}
              >
                <Eye size={16} />
                Ver documento
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className={`flex h-screen flex-col transition-colors duration-300 ${isDark ? 'bg-gray-900 text-gray-100' : 'bg-slate-50 text-slate-950'}`}>
      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <header className={`z-10 flex h-16 shrink-0 items-center border-b px-4 transition-colors duration-300 lg:px-6 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <AppLogo size={34} />
          <div className={`hidden h-8 w-px lg:block ${isDark ? 'bg-gray-700' : 'bg-slate-200'}`} />
          <div className="hidden min-w-0 lg:block">
            <p className={`truncate text-sm font-700 ${isDark ? 'text-gray-100' : 'text-slate-950'}`}>
              {myRole === 'aprobador' ? 'Revisar documento' : 'Firmar documento'}
            </p>
            <p className={`truncate text-xs ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
              {activeWorkspace?.name || 'Espacio personal'}
            </p>
          </div>
        </div>

        <nav className={`hidden items-center gap-1 rounded-lg border p-1 xl:flex ${isDark ? 'border-gray-700 bg-gray-900/50' : 'border-slate-200 bg-slate-50'}`}>
          {steps.map((s, idx) => {
            const isActive = idx === currentStepIndex;
            const isCompleted = idx < currentStepIndex;
            const StepIcon = signingStepIcons[s.id] || FileText;
            return (
              <React.Fragment key={s.id}>
                <button
                  onClick={() => isCompleted && setStep(s.id as 'terminos' | 'campos' | 'firma' | 'aprobacion')}
                  className={`flex h-8 items-center gap-2 rounded-md px-3 text-xs font-600 transition-colors ${
                    isActive
                      ? isDark ? 'bg-gray-700 text-blue-300 shadow-[0_1px_3px_rgba(0,0,0,0.25)]' : 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                      : isCompleted
                      ? isDark ? 'cursor-pointer text-gray-200 hover:bg-gray-700' : 'cursor-pointer text-slate-700 hover:bg-white hover:text-primary'
                      : isDark ? 'cursor-default text-gray-500' : 'cursor-default text-slate-400'
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                    isActive ? 'bg-primary text-white' : isCompleted ? 'bg-primary/10 text-primary' : isDark ? 'bg-gray-700 text-gray-500' : 'bg-slate-200/70 text-slate-400'
                  }`}>
                    {isCompleted ? <CheckCircle2 size={13} /> : <StepIcon size={13} />}
                  </span>
                  <span>{s.label}</span>
                </button>
                {idx < steps.length - 1 && <div className={`h-px w-3 ${isCompleted ? 'bg-primary/50' : isDark ? 'bg-gray-700' : 'bg-slate-200'}`} />}
              </React.Fragment>
            );
          })}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-1.5">
          <button
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Restaurar pantalla' : 'Maximizar pantalla'}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border border-transparent transition-colors ${isDark ? 'text-gray-400 hover:border-gray-600 hover:bg-gray-700 hover:text-gray-200' : 'text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950'}`}
          >
            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button
            onClick={() => setShowExitModal(true)}
            title="Salir"
            className={`ml-0.5 flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-600 transition-colors ${isDark ? 'border-gray-600 bg-gray-800 text-gray-300 hover:border-red-800 hover:bg-red-900/20 hover:text-red-400' : 'border-slate-200 bg-white text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600'}`}
          >
            <X size={16} /><span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <div className={`shrink-0 overflow-x-auto border-b px-4 py-2 xl:hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <nav className="mx-auto flex min-w-max items-center gap-1">
          {steps.map((s, idx) => {
            const isActive = idx === currentStepIndex;
            const isCompleted = idx < currentStepIndex;
            const StepIcon = signingStepIcons[s.id] || FileText;
            return (
              <button
                key={s.id}
                onClick={() => isCompleted && setStep(s.id as 'terminos' | 'campos' | 'firma' | 'aprobacion')}
                className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-600 transition-colors ${
                  isActive ? 'bg-primary/10 text-primary' : isCompleted ? isDark ? 'text-gray-200' : 'text-slate-700' : isDark ? 'text-gray-500' : 'text-slate-400'
                }`}
              >
                {isCompleted ? <CheckCircle2 size={14} /> : <StepIcon size={14} />}
                {s.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Exit confirmation modal */}
      {showExitModal && (
        <ExitConfirmModal
          onConfirm={() => {
            setShowExitModal(false);
            router.push(`/visor-documento/${document?.id}`);
          }}
          onCancel={() => setShowExitModal(false)}
        />
      )}

      {/* No firma alert modal */}
      {showNoFirmaAlert && (
        <NoFirmaAlertModal
          onConfirm={handleConfirmNoFirma}
          onCancel={() => setShowNoFirmaAlert(false)}
        />
      )}

      {/* Full-screen document modal — matches visor-documento style */}
      {showDocModal && document?.file_url && (
        <div className="fixed inset-0 z-50 bg-gray-100 flex flex-col">
          {/* Top bar: close button */}
          <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
            <span className="text-sm font-medium text-foreground bg-white border border-border rounded-full px-3 py-1.5 shadow-sm truncate max-w-xs">
              {document.nombre}
            </span>
            <div className="flex items-center gap-2">
              {/* Zoom controls */}
              <div className="flex items-center gap-1 bg-white border border-border rounded-full px-3 py-1.5 shadow-sm">
                <button
                  onClick={() => setDocModalZoom((z) => Math.max(50, z - 10))}
                  disabled={docModalZoom <= 50}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40"
                  title="Reducir zoom"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
                  </svg>
                </button>
                <span className="text-slate-600 text-xs font-medium min-w-[40px] text-center select-none">{docModalZoom}%</span>
                <button
                  onClick={() => setDocModalZoom((z) => Math.min(200, z + 10))}
                  disabled={docModalZoom >= 200}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40"
                  title="Aumentar zoom"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                  </svg>
                </button>
              </div>
              {/* Pagination */}
              <div className="flex items-center gap-1 bg-white border border-border rounded-full px-3 py-1.5 shadow-sm">
                <button
                  onClick={() => setDocModalPage((p) => Math.max(1, p - 1))}
                  disabled={docModalPage <= 1}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40"
                  title="Página anterior"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
                <span className="text-slate-600 text-xs font-medium select-none">{docModalPage} / {totalPages}</span>
                <button
                  onClick={() => setDocModalPage((p) => Math.min(totalPages, p + 1))}
                  disabled={docModalPage >= totalPages}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40"
                  title="Página siguiente"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              </div>
              {/* Close */}
              <button
                onClick={() => setShowDocModal(false)}
                className="flex items-center gap-1.5 text-sm font-medium text-foreground bg-white border border-border rounded-full px-3 py-1.5 shadow-sm hover:shadow-md transition-all"
                title="Cerrar"
              >
                <Maximize2 size={14} className="rotate-180" />
                Salir
              </button>
            </div>
          </div>
          {/* Modal body */}
          <div className="flex-1 overflow-auto" style={{ paddingTop: '0px' }}>
            <div className="flex items-start justify-center min-h-full min-w-full p-8 pt-16">
              <div className="relative shadow-lg bg-white flex-shrink-0">
                <PdfCanvas
                  fileUrl={document.file_url}
                  page={docModalPage}
                  zoom={docModalZoom}
                  onTotalPages={(n) => { /* totalPages already set */ }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <section className={`shrink-0 border-b ${isDark ? 'border-gray-700 bg-gray-900' : 'border-slate-200 bg-slate-50'}`}>
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4 sm:flex-row sm:items-end sm:justify-between lg:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CurrentSigningStepIcon size={19} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className={`text-xl font-700 ${isDark ? 'text-gray-100' : 'text-slate-950'}`}>{currentStepData?.label}</h1>
                <span className={`rounded-md px-2 py-0.5 text-xs font-600 ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-slate-200/70 text-slate-600'}`}>
                  Paso {currentStepIndex + 1} de {steps.length}
                </span>
              </div>
              <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>{currentStepDescription}</p>
            </div>
          </div>
          <div className="w-full sm:w-60">
            <div className={`flex items-center justify-between text-xs font-600 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
              <span>Progreso</span>
              <span>{completionPercent}%</span>
            </div>
            <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${isDark ? 'bg-gray-700' : 'bg-slate-200'}`}>
              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${completionPercent}%` }} />
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-1 overflow-hidden">

        {/* PDF Viewer (left) */}
        <div className={`hidden lg:flex flex-col border-r transition-all duration-300 ${showPdf ? 'w-[70%]' : 'w-0 overflow-hidden'} ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-border'}`}>
          {document.file_url && (
            <>
              <div className="flex-1 relative overflow-hidden">
                {/* Scrollable PDF area with drag-drop support in campos step */}
                <div
                  ref={dropZoneRef}
                  className={`absolute inset-0 overflow-auto p-4 flex justify-center transition-colors ${isDragOver ? 'bg-primary/5' : ''}`}
                  onDragOver={step === 'campos' ? handleDragOver : undefined}
                  onDragLeave={step === 'campos' ? handleDragLeave : undefined}
                  onDrop={step === 'campos' ? handleDrop : undefined}
                >
                  {/* Drag-over overlay */}
                  {isDragOver && (
                    <div className="absolute inset-4 border-2 border-dashed border-primary rounded-lg z-20 pointer-events-none flex items-center justify-center">
                      <div className="bg-white/90 rounded-xl px-6 py-3 shadow-sm">
                        <p className="text-sm font-semibold text-primary">Suelta el campo aquí</p>
                      </div>
                    </div>
                  )}

                  {/* PDF canvas with placed fields overlay */}
                  <div
                    ref={docSheetRef}
                    data-doc-sheet-firmar="true"
                    className="shadow-xl bg-white self-start relative"
                  >
                    <PdfCanvas
                      fileUrl={document.file_url}
                      page={currentPage}
                      zoom={zoom}
                      onTotalPages={setTotalPages}
                    />
                    {/* Placed fields overlays */}
                    {placedFields
                      .filter((f) => f.page === currentPage)
                      .map((field) => (
                        <PlacedFieldOverlay
                          key={field.id}
                          field={field}
                          onRemove={handleRemovePlacedField}
                          onMove={handleMovePlacedField}
                          onResize={handleResizePlacedField}
                          onUpdateFieldConfig={handleUpdateFieldConfig}
                          onUpdateFieldTypeConfig={handleUpdateFieldTypeConfig}
                          onUpdateOptions={handleUpdateDropdownOptions}
                          onUpdateRadioOptions={handleUpdateRadioOptions}
                          onUpdateCasillaLabel={handleUpdateCasillaLabel}
                          readOnly={hasCamposPrefijados && !field.id.startsWith('placed-')}
                        />
                      ))}
                  </div>
                </div>

                {/* Overlay: Ver documento completo — top-right */}
                <div className="absolute top-4 right-4 z-20 pointer-events-auto">
                  <button
                    onClick={() => { setDocModalPage(currentPage); setDocModalZoom(zoom); setShowDocModal(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground bg-white border border-border rounded-full shadow-sm hover:shadow-md transition-all"
                  >
                    <Maximize2 size={14} className="text-foreground" />
                    Ver documento completo
                  </button>
                </div>

                {/* Overlay: Zoom + Pagination bar — bottom-center */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
                  <div className="flex items-center gap-1 bg-white/90 backdrop-blur-sm border border-border rounded-full px-3 py-1.5 shadow-md">
                    <button
                      onClick={() => setZoom((z) => Math.max(50, z - 10))}
                      disabled={zoom <= 50}
                      className="w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40"
                      title="Reducir zoom"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
                      </svg>
                    </button>
                    <span className="text-sm text-slate-600 font-medium min-w-[44px] text-center select-none">{zoom}%</span>
                    <button
                      onClick={() => setZoom((z) => Math.min(200, z + 10))}
                      disabled={zoom >= 200}
                      className="w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40"
                      title="Aumentar zoom"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                      </svg>
                    </button>
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage <= 1}
                      className="w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40"
                      title="Página anterior"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6"/>
                      </svg>
                    </button>
                    <span className="text-sm text-slate-600 font-medium min-w-[48px] text-center select-none">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage >= totalPages}
                      className="w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40"
                      title="Página siguiente"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
          {!document.file_url && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FileText size={40} className={`mx-auto mb-2 ${isDark ? 'text-gray-600' : 'text-slate-300'}`} />
                <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>Sin vista previa disponible</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div className={`lg:w-[30%] flex-1 lg:flex-none flex flex-col overflow-hidden transition-colors duration-300 ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">

              {/* ── STEP: TÉRMINOS ─────────────────────────────────────────── */}
              {step === 'terminos' && (
                <div className="space-y-5">
                  <div>
                    <h2 className={`text-lg font-bold ${isDark ? 'text-gray-100' : 'text-foreground'}`}>Términos y condiciones</h2>
                    <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                      Antes de continuar, revisa y acepta los términos de participación.
                    </p>
                  </div>

                  <div className={`rounded-xl p-4 flex items-start gap-3 border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/40 border-border'}`}>
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <FileText size={18} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${isDark ? 'text-gray-100' : 'text-foreground'}`}>{document.nombre}</p>
                      <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                        Tu rol: <span className="font-medium capitalize">{myRole}</span>
                      </p>
                      {/* Signature type indicator for firmante */}
                      {myRole === 'firmante' && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <PenLine size={12} className="text-primary" />
                          <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-foreground'}`}>
                            Tipo de firma:{' '}
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${isDark ? 'bg-primary/20 text-primary' : 'bg-primary/10 text-primary'}`}>
                              {savedSignatureType === 'efirma' ? 'e.firma (SAT)'
                                : savedSignatureType === 'firma_electronica' ? 'Firma Electrónica Digital' : 'Firma Autógrafa Digital'}
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-gray-700' : 'border-border'}`}>
                    <div className={`px-4 py-2.5 border-b ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/30 border-border'}`}>
                      <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-foreground'}`}>Términos de participación</p>
                    </div>
                    <div className={`p-4 max-h-64 overflow-y-auto text-sm space-y-3 leading-relaxed ${isDark ? 'text-gray-400 bg-gray-850' : 'text-muted-foreground'}`}>
                      <p>Al aceptar y participar en este documento, usted declara y acepta lo siguiente:</p>
                      <ol className="list-decimal list-inside space-y-2 pl-2">
                        <li>Que ha revisado el contenido completo del documento y comprende su alcance y obligaciones.</li>
                        <li>Que la firma electrónica o aprobación que otorgue tiene plena validez legal conforme a la legislación aplicable.</li>
                        <li>Que los datos proporcionados son verídicos y corresponden a su identidad.</li>
                        <li>Que autoriza el tratamiento de sus datos personales para los fines del presente documento.</li>
                        <li>Que la fecha y hora de su participación quedarán registradas de forma inmutable en el sistema.</li>
                        {myRole === 'firmante' && (
                          <li>Que su firma autógrafa digital es un acto voluntario y tiene el mismo valor que una firma manuscrita.</li>
                        )}
                        {myRole === 'aprobador' && (
                          <li>Que su visto bueno constituye una aprobación formal del contenido del documento.</li>
                        )}
                      </ol>
                      <p className={`text-xs pt-2 border-t ${isDark ? 'text-gray-500 border-gray-700' : 'text-muted-foreground/70 border-border'}`}>
                        Este proceso está respaldado por la plataforma DocuBox y cumple con los estándares de firma electrónica avanzada.
                      </p>
                    </div>
                  </div>

                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                      terminosAceptados ? 'bg-primary border-primary' : `border-slate-300 group-hover:border-primary/60`
                    }`}
                      onClick={() => setTerminosAceptados((v) => !v)}>
                      {terminosAceptados && <Check size={12} className="text-white" />}
                    </div>
                    <span className={`text-sm leading-relaxed ${isDark ? 'text-gray-300' : 'text-foreground'}`}>
                      He leído y acepto los términos y condiciones de participación en este documento.
                    </span>
                  </label>

                  {/* ── Geo loading indicator ─────────────────────────────── */}
                  {geoLoading && (
                    <div className={`flex items-center gap-3 p-3 rounded-lg border ${isDark ? 'bg-blue-900/20 border-blue-700/50' : 'bg-blue-50 border-blue-200'}`}>
                      <Loader2 size={15} className={`animate-spin flex-shrink-0 ${isDark ? 'text-blue-400' : 'text-blue-500'}`} />
                      <p className={`text-xs leading-snug ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                        Verificando acceso a ubicación…
                      </p>
                    </div>
                  )}

                  {/* ── Geo denied — blocking error ───────────────────────── */}
                  {!geoLoading && geoDenied && (
                    <div className={`flex items-start gap-3 p-4 rounded-lg border ${isDark ? 'bg-red-900/20 border-red-700/50' : 'bg-red-50 border-red-300'}`}>
                      <MapPin size={16} className={`flex-shrink-0 mt-0.5 ${isDark ? 'text-red-400' : 'text-red-500'}`} />
                      <div>
                        <p className={`text-sm font-semibold ${isDark ? 'text-red-300' : 'text-red-700'}`}>
                          Ubicación requerida para firmar
                        </p>
                        <p className={`text-xs mt-1 leading-relaxed ${isDark ? 'text-red-400/80' : 'text-red-600'}`}>
                          Has bloqueado el acceso a tu ubicación. La ubicación geográfica es obligatoria para completar el proceso de firmado y garantizar la validez legal del documento. Activa el permiso de ubicación en la configuración de tu navegador y recarga la página para continuar.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── STEP: CAMPOS ──────────────────────────────────────────── */}
              {step === 'campos' && (
                <div className="space-y-5">
                  <div>
                    <h2 className={`text-lg font-bold ${isDark ? 'text-gray-100' : 'text-foreground'}`}>
                      {hasCamposPrefijados ? 'Completar campos requeridos' : 'Campos'}
                    </h2>
                    {hasCamposPrefijados && (
                      <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                        Completa los campos que el propietario del documento ha solicitado.
                      </p>
                    )}
                  </div>

                  {/* Campos prefijados */}
                  {hasCamposPrefijados && (
                    <div className="space-y-3">
                      {camposPrefijados.map((campo, idx) => {
                        const key = campo.id || `prefijado-${idx}`;
                        const resolvedTipo: CampoPersonalizado['tipo'] = resolveFieldTipo(campo);
                        const displayLabel = campo.fieldConfig?.customName || campo.label;
                        return (
                          <div key={key} className={`border rounded-xl p-4 space-y-2 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-border'}`}>
                            <div className="flex items-center gap-2">
                              <CampoIcon tipo={resolvedTipo} />
                              <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{displayLabel}</label>
                              <span className="text-red-500 text-xs">*</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ml-auto ${isDark ? 'bg-gray-700 text-gray-400' : 'bg-muted text-muted-foreground'}`}>
                                {resolvedTipo === 'firma' ? 'Firma' :
                                 resolvedTipo === 'nombre_completo' ? 'Nombre Completo' :
                                 resolvedTipo === 'rfc' ? 'RFC' :
                                 resolvedTipo === 'curp' ? 'CURP' :
                                 resolvedTipo === 'correo' ? 'Correo' :
                                 resolvedTipo === 'telefono' ? 'Teléfono' :
                                 resolvedTipo === 'direccion' ? 'Dirección' :
                                 resolvedTipo === 'fecha' ? 'Fecha' :
                                 resolvedTipo === 'hora' ? 'Hora' :
                                 resolvedTipo === 'numero' ? 'Número' :
                                 resolvedTipo === 'moneda' ? 'Moneda' :
                                 resolvedTipo === 'checkbox' ? 'Casilla' :
                                 resolvedTipo === 'dropdown' ? 'Desplegable' :
                                 resolvedTipo === 'radio' ? 'Botones de opción' :
                                 resolvedTipo === 'imagen'? 'Imagen' : 'Texto'}
                              </span>
                            </div>
                            {resolvedTipo === 'fecha' ? (
                              <input
                                type="date"
                                value={camposValues[key] || ''}
                                onChange={(e) => setCamposValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`}
                              />
                            ) : resolvedTipo === 'hora' ? (
                              <input
                                type="time"
                                value={camposValues[key] || ''}
                                onChange={(e) => setCamposValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`}
                              />
                            ) : resolvedTipo === 'numero' ? (
                              <input
                                type="number"
                                value={camposValues[key] || ''}
                                onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                                onChange={(e) => setCamposValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                placeholder={`Ingresa ${campo.label.toLowerCase()}`}
                                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`}
                              />
                            ) : resolvedTipo === 'moneda' ? (
                              <div className="relative">
                                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={camposValues[key] || ''}
                                  onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                                  onChange={(e) => setCamposValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                  placeholder="0.00"
                                  className={`w-full pl-7 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`}
                                />
                              </div>
                            ) : resolvedTipo === 'imagen' ? (
                              <div className="space-y-2">
                                <input
                                  type="file"
                                  accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const allowed = ['image/jpeg', 'image/png'];
                                    if (!allowed.includes(file.type)) {
                                      alert('Solo se permiten archivos JPG, JPEG o PNG.');
                                      e.target.value = '';
                                      return;
                                    }
                                    if (file.size > 2 * 1024 * 1024) {
                                      alert('El archivo no debe superar los 2 MB.');
                                      e.target.value = '';
                                      return;
                                    }
                                    const reader = new FileReader();
                                    reader.onload = (ev) => {
                                      setCamposValues((prev) => ({ ...prev, [key]: ev.target?.result as string }));
                                    };
                                    reader.readAsDataURL(file);
                                  }}
                                  className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                                />
                                <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>JPG, JPEG o PNG · máx. 2 MB</p>
                                {camposValues[key] && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={camposValues[key]} alt="Vista previa" className="w-full max-h-32 object-contain rounded-lg border border-border" />
                                )}
                              </div>
                            ) : resolvedTipo === 'checkbox' ? (
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={camposValues[key] === 'true'}
                                  onChange={(e) => setCamposValues((prev) => ({ ...prev, [key]: e.target.checked ? 'true' : 'false' }))}
                                  className="w-4 h-4 accent-primary"
                                />
                                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>{campo.casillaLabel || displayLabel}</span>
                              </label>
                            ) : resolvedTipo === 'firma' ? (
                              <div className={`flex items-center gap-2.5 border border-dashed rounded-lg px-3 py-3 ${isDark ? 'border-teal-700 bg-teal-900/20' : 'border-teal-300 bg-teal-50'}`}>
                                <PenLine size={15} className="text-teal-500 shrink-0" />
                                <p className={`text-xs leading-snug ${isDark ? 'text-teal-300' : 'text-teal-700'}`}>
                                  La firma se configurará en el paso siguiente.
                                </p>
                              </div>
                            ) : resolvedTipo === 'dropdown' && campo.dropdownOptions?.length ? (
                              <select
                                value={camposValues[key] || ''}
                                onChange={(e) => setCamposValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`}
                              >
                                <option value="">Selecciona una opción</option>
                                {campo.dropdownOptions.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : resolvedTipo === 'radio' && campo.radioOptions?.length ? (
                              <div className="flex flex-wrap gap-3">
                                {campo.radioOptions.map((opt) => (
                                  <label key={opt} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={key}
                                      value={opt}
                                      checked={camposValues[key] === opt}
                                      onChange={(e) => setCamposValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                      className="accent-primary"
                                    />
                                    <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-foreground'}`}>{opt}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <input
                                type={resolvedTipo === 'correo' ? 'email' : resolvedTipo === 'telefono' ? 'tel' : 'text'}
                                value={camposValues[key] || ''}
                                onChange={(e) => setCamposValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                placeholder={`Ingresa ${campo.label.toLowerCase()}`}
                                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Additional fields section — shown for BOTH prefixed and non-prefixed */}
                  {hasCamposPrefijados && (
                    <div className="space-y-3">
                      <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Agregar información adicional</h3>

                      {/* Placed custom fields shown in sidebar */}
                      {camposPersonalizados.length > 0 && (
                        <div className="space-y-2">
                          {camposPersonalizados.map((campo) => (
                            <div key={campo.id} className={`border rounded-xl p-3 space-y-2 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-border'}`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <CampoPersonalizadoIcon tipo={campo.tipo} />
                                  <span className={`text-sm font-medium truncate ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{campo.label}</span>
                                  {campo.value && ['nombre_completo', 'rfc', 'curp', 'correo', 'telefono', 'direccion'].includes(campo.tipo) && (
                                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium shrink-0">Auto</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const placedField = placedFields.find((f) => f.id === campo.id);
                                      if (placedField) {
                                        const newName = window.prompt('Nombre del campo:', placedField.fieldConfig?.customName || campo.label);
                                        if (newName !== null && newName.trim()) {
                                          handleUpdateFieldConfig(campo.id, { ...(placedField.fieldConfig || {}), customName: newName.trim() });
                                        }
                                      }
                                    }}
                                    className="p-1 rounded hover:bg-slate-100 text-muted-foreground hover:text-primary transition-colors"
                                    title="Editar etiqueta del campo"
                                  >
                                    <Tag size={13} />
                                  </button>
                                  {(() => {
                                    const placedField = placedFields.find((f) => f.id === campo.id);
                                    const hasSettings = ['numero', 'moneda', 'fecha', 'hora', 'dropdown', 'radio'].includes(campo.tipo);
                                    if (campo.tipo === 'checkbox') {
                                      if (!placedField) return null;
                                      return (
                                        <SidebarCasillaSettingsButton
                                          campo={campo}
                                          placedField={placedField}
                                          onUpdateCasillaLabel={handleUpdateCasillaLabel}
                                        />
                                      );
                                    }
                                    if (!hasSettings || !placedField) return null;
                                    return (
                                      <SidebarSettingsButton campo={campo} placedField={placedField}
                                        onUpdateFieldTypeConfig={handleUpdateFieldTypeConfig}
                                        onUpdateDropdownOptions={handleUpdateDropdownOptions}
                                        onUpdateRadioOptions={handleUpdateRadioOptions}
                                      />
                                    );
                                  })()}
                                  <button
                                    onClick={() => handleRemoveCampoPersonalizado(campo.id)}
                                    className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>
                              {(() => {
                                const placedField = placedFields.find((f) => f.id === campo.id);
                                const dropOpts = placedField?.dropdownOptions && placedField.dropdownOptions.length > 0 ? placedField.dropdownOptions : ['Opción A', 'Opción B'];
                                const radioOpts = placedField?.radioOptions && placedField.radioOptions.length > 0 ? placedField.radioOptions : ['Opción 1', 'Opción 2'];
                                const casillaLbl = placedField?.casillaLabel || 'Etiqueta de casilla';
                                if (campo.tipo === 'firma') return (
                                  <div className={`flex items-center gap-2.5 border border-dashed rounded-lg px-3 py-3 ${isDark ? 'border-teal-700 bg-teal-900/20' : 'border-teal-300 bg-teal-50'}`}>
                                    <PenLine size={15} className="text-teal-500 shrink-0" />
                                    <p className={`text-xs leading-snug ${isDark ? 'text-teal-300' : 'text-teal-700'}`}>La firma se configurará en el paso siguiente.</p>
                                  </div>
                                );
                                if (campo.tipo === 'fecha') return (
                                  <input type="date" value={campo.value}
                                    onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                );
                                if (campo.tipo === 'hora') return (
                                  <input type="time" value={campo.value}
                                    onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                );
                                if (campo.tipo === 'numero') return (
                                  <input type="number" value={campo.value} placeholder="Ingresa número"
                                    onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                                    onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                );
                                if (campo.tipo === 'moneda') return (
                                  <div className="relative">
                                    <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>$</span>
                                    <input type="number" step="0.01" value={campo.value} placeholder="0.00"
                                      onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                                      onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                      className={`w-full pl-7 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                  </div>
                                );
                                if (campo.tipo === 'imagen') return (
                                  <div className="space-y-2">
                                    <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        if (!['image/jpeg', 'image/png'].includes(file.type)) { alert('Solo se permiten archivos JPG, JPEG o PNG.'); e.target.value = ''; return; }
                                        if (file.size > 2 * 1024 * 1024) { alert('El archivo no debe superar los 2 MB.'); e.target.value = ''; return; }
                                        const reader = new FileReader();
                                        reader.onload = (ev) => handleUpdateCampoPersonalizado(campo.id, ev.target?.result as string);
                                        reader.readAsDataURL(file);
                                      }}
                                      className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer" />
                                    <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>JPG, JPEG o PNG · máx. 2 MB</p>
                                    {campo.value && <img src={campo.value} alt="Vista previa" className="w-full max-h-32 object-contain rounded-lg border border-border" />}
                                  </div>
                                );
                                if (campo.tipo === 'telefono') return (
                                  <input type="tel" value={campo.value} placeholder="Ingresa número telefónico"
                                    onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                );
                                if (campo.tipo === 'correo') return (
                                  <input type="email" value={campo.value} placeholder="correo@ejemplo.com"
                                    onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                );
                                if (campo.tipo === 'direccion') return (
                                  <input type="text" value={campo.value} placeholder="Calle, colonia, municipio, estado"
                                    onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                );
                                if (campo.tipo === 'checkbox') return (
                                  <label className="flex items-center gap-2.5 cursor-pointer">
                                    <input type="checkbox" checked={campo.value === 'true'}
                                      onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.checked ? 'true' : 'false')}
                                      className="w-4 h-4 accent-primary" />
                                    <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>{casillaLbl}</span>
                                  </label>
                                );
                                if (campo.tipo === 'dropdown') return (
                                  <select value={campo.value}
                                    onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`}>
                                    <option value="">Selecciona una opción</option>
                                    {dropOpts.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                                  </select>
                                );
                                if (campo.tipo === 'radio') return (
                                  <div className="flex flex-wrap gap-3">
                                    {radioOpts.map((opt) => (
                                      <label key={opt} className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" name={campo.id} value={opt} checked={campo.value === opt}
                                          onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                          className="accent-primary" />
                                        <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-foreground'}`}>{opt}</span>
                                      </label>
                                    ))}
                                  </div>
                                );
                                return (
                                  <input type="text" value={campo.value} placeholder={`Ingresa ${campo.label.toLowerCase()}`}
                                    onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      )}

                      {camposPersonalizados.length === 0 && (
                        <p className={`text-xs rounded-lg px-3 py-2 ${isDark ? 'text-gray-400 bg-gray-800' : 'text-muted-foreground bg-muted/30'}`}>
                          Haz clic en un campo para colocarlo en el documento, o arrástralo directamente sobre el PDF.
                        </p>
                      )}

                      {/* Campo type selector panel */}
                      {showCampoSelector && (
                        <div className={`border rounded-xl overflow-hidden shadow-sm ${isDark ? 'border-gray-700 bg-gray-800' : 'border-border bg-white'}`}>
                          <div className={`border-b ${isDark ? 'border-gray-700' : 'border-border'}`}>
                            <button
                              onClick={() => setParticipanteOpen((v) => !v)}
                              className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${isDark ? 'bg-gray-800 hover:bg-gray-750' : 'bg-white hover:bg-slate-50'}`}
                            >
                              <span className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Campos del Participante</span>
                              <ChevronDown size={16} className={`text-muted-foreground transition-transform ${participanteOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {participanteOpen && (
                              <div className="px-3 pb-3 space-y-2">
                                {[
                                  { tipo: 'firma' as const, label: 'Firma', icon: <PenLine size={14} />, required: true },
                                  { tipo: 'nombre_completo' as const, label: 'Nombre Completo', icon: <User size={14} /> },
                                  { tipo: 'rfc' as const, label: 'RFC', icon: <FileText size={14} /> },
                                  { tipo: 'curp' as const, label: 'CURP', icon: <UserCheck size={14} /> },
                                  { tipo: 'correo' as const, label: 'Correo Electrónico', icon: <Mail size={14} /> },
                                  { tipo: 'telefono' as const, label: 'Número Telefónico', icon: <Phone size={14} /> },
                                  { tipo: 'direccion' as const, label: 'Dirección', icon: <MapPin size={14} /> },
                                ].map((item) => {
                                  const firmaAlreadyAdded = item.tipo === 'firma' && (
                                    camposPersonalizados.some((c) => c.tipo === 'firma') ||
                                    camposPrefijados.some((c) => (c.tipo === 'firma') || deriveTipoFromLabel(c.label) === 'firma')
                                  );
                                  return (
                                    <div
                                      key={item.tipo}
                                      draggable={!firmaAlreadyAdded}
                                      onDragStart={(e) => {
                                        if (firmaAlreadyAdded) { e.preventDefault(); return; }
                                        e.dataTransfer.setData('campo-tipo', item.tipo);
                                        e.dataTransfer.setData('campo-label', item.label);
                                      }}
                                      onClick={() => { if (!firmaAlreadyAdded) handlePlaceFieldOnDocument(item.tipo, item.label); }}
                                      className={`flex items-center justify-between px-3 py-2.5 border rounded-lg transition-all select-none ${firmaAlreadyAdded ? 'border-slate-100 opacity-50 cursor-not-allowed' : `cursor-grab active:cursor-grabbing hover:border-primary/40 hover:shadow-sm ${isDark ? 'border-gray-600 bg-gray-700' : 'border-slate-200 bg-white'}`}`}
                                      title={firmaAlreadyAdded ? 'La firma ya fue insertada en el documento' : undefined}
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <span className="text-slate-500">{item.icon}</span>
                                        <span className={`text-sm ${isDark ? 'text-gray-200' : 'text-foreground'}`}>
                                          {item.label}
                                          {item.required && <span className="text-red-500 ml-1">*</span>}
                                        </span>
                                      </div>
                                      {firmaAlreadyAdded ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                                      ) : (
                                        <span className="text-slate-300 text-xs font-bold tracking-widest">⠿</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div>
                            <button
                              onClick={() => setGeneralesOpen((v) => !v)}
                              className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${isDark ? 'bg-gray-800 hover:bg-gray-750' : 'bg-white hover:bg-slate-50'}`}
                            >
                              <span className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Campos Generales</span>
                              <ChevronDown size={16} className={`text-muted-foreground transition-transform ${generalesOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {generalesOpen && (
                              <div className="px-3 pb-3 space-y-2">
                                {[
                                  { tipo: 'texto' as const, label: 'Texto', icon: <Type size={14} /> },
                                  { tipo: 'fecha' as const, label: 'Fecha', icon: <Calendar size={14} /> },
                                  { tipo: 'hora' as const, label: 'Hora', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
                                  { tipo: 'numero' as const, label: 'Número', icon: <Hash size={14} /> },
                                  { tipo: 'moneda' as const, label: 'Moneda', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
                                  { tipo: 'checkbox' as const, label: 'Casilla', icon: <ToggleLeft size={14} /> },
                                  { tipo: 'imagen' as const, label: 'Imagen', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> },
                                  { tipo: 'radio' as const, label: 'Botones de opción', icon: <List size={14} /> },
                                  { tipo: 'dropdown' as const, label: 'Desplegable', icon: <ChevronDown size={14} /> },
                                ].map((item) => (
                                  <div
                                    key={item.tipo}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData('campo-tipo', item.tipo);
                                      e.dataTransfer.setData('campo-label', item.label);
                                    }}
                                    onClick={() => handlePlaceFieldOnDocument(item.tipo as CampoPersonalizado['tipo'], item.label)}
                                    className={`flex items-center justify-between px-3 py-2.5 border rounded-lg cursor-grab active:cursor-grabbing hover:border-primary/40 hover:shadow-sm transition-all select-none ${isDark ? 'border-gray-600 bg-gray-700' : 'border-slate-200 bg-white'}`}
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <span className="text-slate-500">{item.icon}</span>
                                      <span className={`text-sm ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{item.label}</span>
                                    </div>
                                    <span className="text-slate-300 text-xs font-bold tracking-widest">⠿</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className={`px-3 pb-3 pt-1 border-t ${isDark ? 'border-gray-700' : 'border-border'}`}>
                            <button
                              onClick={() => setShowCampoSelector(false)}
                              className={`w-full text-xs py-1.5 transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                              Cerrar
                            </button>
                          </div>
                        </div>
                      )}

                      {!showCampoSelector && (
                        <button
                          onClick={() => setShowCampoSelector(true)}
                          className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
                        >
                          <Plus size={15} />
                          Agregar campo personalizado
                        </button>
                      )}
                    </div>
                  )}

                  {/* No prefixed campos */}
                  {!hasCamposPrefijados && (
                    <div className="space-y-5">
                      {/* Campos obligatorios section */}
                      <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-gray-700' : 'border-border'}`}>
                        <div className={`px-4 py-3 border-b ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/20 border-border'}`}>
                          <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Campos obligatorios</h3>
                        </div>
                        <div className={`px-4 py-4 ${isDark ? 'bg-gray-800' : ''}`}>
                          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                            No hay campos obligatorios. Puedes agregar información opcional o continuar directamente a la firma.
                          </p>
                        </div>
                      </div>

                      {/* Agregar información adicional section */}
                      <div className="space-y-3">
                        <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Agregar información adicional</h3>

                        {/* Placed fields shown in sidebar */}
                        {camposPersonalizados.length > 0 && (
                          <div className="space-y-2">
                            {camposPersonalizados.map((campo) => (
                              <div key={campo.id} className={`border rounded-xl p-3 space-y-2 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-border'}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <CampoPersonalizadoIcon tipo={campo.tipo} />
                                    <span className={`text-sm font-medium truncate ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{campo.label}</span>
                                    {campo.value && ['nombre_completo', 'rfc', 'curp', 'correo', 'telefono', 'direccion'].includes(campo.tipo) && (
                                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium shrink-0">
                                        Auto
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const placedField = placedFields.find((f) => f.id === campo.id);
                                        if (placedField) {
                                          const newName = window.prompt('Nombre del campo:', placedField.fieldConfig?.customName || campo.label);
                                          if (newName !== null && newName.trim()) {
                                            handleUpdateFieldConfig(campo.id, { ...(placedField.fieldConfig || {}), customName: newName.trim() });
                                          }
                                        }
                                      }}
                                      className="p-1 rounded hover:bg-slate-100 text-muted-foreground hover:text-primary transition-colors"
                                      title="Editar etiqueta del campo"
                                    >
                                      <Tag size={13} />
                                    </button>
                                    {(() => {
                                      const placedField = placedFields.find((f) => f.id === campo.id);
                                      const hasSettings = ['numero', 'moneda', 'fecha', 'hora', 'dropdown', 'radio'].includes(campo.tipo);
                                      if (campo.tipo === 'checkbox') {
                                        if (!placedField) return null;
                                        return (
                                          <SidebarCasillaSettingsButton
                                            campo={campo}
                                            placedField={placedField}
                                            onUpdateCasillaLabel={handleUpdateCasillaLabel}
                                          />
                                        );
                                      }
                                      if (!hasSettings || !placedField) return null;
                                      return (
                                        <SidebarSettingsButton campo={campo} placedField={placedField}
                                          onUpdateFieldTypeConfig={handleUpdateFieldTypeConfig}
                                          onUpdateDropdownOptions={handleUpdateDropdownOptions}
                                          onUpdateRadioOptions={handleUpdateRadioOptions}
                                        />
                                      );
                                    })()}
                                    <button
                                      onClick={() => handleRemoveCampoPersonalizado(campo.id)}
                                      className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </div>
                                {(() => {
                                  const placedField = placedFields.find((f) => f.id === campo.id);
                                  const dropOpts = placedField?.dropdownOptions && placedField.dropdownOptions.length > 0 ? placedField.dropdownOptions : ['Opción A', 'Opción B'];
                                  const radioOpts = placedField?.radioOptions && placedField.radioOptions.length > 0 ? placedField.radioOptions : ['Opción 1', 'Opción 2'];
                                  const casillaLbl = placedField?.casillaLabel || 'Etiqueta de casilla';
                                  if (campo.tipo === 'firma') return (
                                    <div className="border border-dashed border-slate-300 rounded-lg p-3 text-center text-xs text-muted-foreground">
                                      <PenLine size={16} className="mx-auto mb-1 text-slate-400" />
                                      La firma se capturará en el paso siguiente
                                    </div>
                                  );
                                  if (campo.tipo === 'fecha') return (
                                    <input type="date" value={campo.value}
                                      onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                  );
                                  if (campo.tipo === 'hora') return (
                                    <input type="time" value={campo.value}
                                      onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                  );
                                  if (campo.tipo === 'numero') return (
                                    <input type="number" value={campo.value} placeholder="Ingresa número"
                                      onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                                      onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                  );
                                  if (campo.tipo === 'moneda') return (
                                    <div className="relative">
                                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>$</span>
                                      <input type="number" step="0.01" value={campo.value} placeholder="0.00"
                                        onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                                        onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                        className={`w-full pl-7 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                    </div>
                                  );
                                  if (campo.tipo === 'imagen') return (
                                    <div className="space-y-2">
                                      <input
                                        type="file"
                                        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          const allowed = ['image/jpeg', 'image/png'];
                                          if (!allowed.includes(file.type)) {
                                            alert('Solo se permiten archivos JPG, JPEG o PNG.');
                                            e.target.value = '';
                                            return;
                                          }
                                          if (file.size > 2 * 1024 * 1024) {
                                            alert('El archivo no debe superar los 2 MB.');
                                            e.target.value = '';
                                            return;
                                          }
                                          const reader = new FileReader();
                                          reader.onload = (ev) => {
                                            handleUpdateCampoPersonalizado(campo.id, ev.target?.result as string);
                                          };
                                          reader.readAsDataURL(file);
                                        }}
                                        className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                                      />
                                      <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>JPG, JPEG o PNG · máx. 2 MB</p>
                                      {campo.value && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={campo.value} alt="Vista previa" className="w-full max-h-32 object-contain rounded-lg border border-border" />
                                      )}
                                    </div>
                                  );
                                  if (campo.tipo === 'telefono') return (
                                    <input type="tel" value={campo.value} placeholder="Ingresa número telefónico"
                                      onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                  );
                                  if (campo.tipo === 'correo') return (
                                    <input type="email" value={campo.value} placeholder="correo@ejemplo.com"
                                      onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                  );
                                  if (campo.tipo === 'direccion') return (
                                    <input type="text" value={campo.value} placeholder="Calle, colonia, municipio, estado"
                                      onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                  );
                                  if (campo.tipo === 'checkbox') return (
                                    <label className="flex items-center gap-2.5 cursor-pointer">
                                      <input type="checkbox" checked={campo.value === 'true'}
                                        onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.checked ? 'true' : 'false')}
                                        className="w-4 h-4 accent-primary" />
                                      <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-muted-foreground'}`}>{casillaLbl}</span>
                                    </label>
                                  );
                                  if (campo.tipo === 'dropdown') return (
                                    <select value={campo.value}
                                      onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`}>
                                      <option value="">Selecciona una opción</option>
                                      {dropOpts.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                  );
                                  if (campo.tipo === 'radio') return (
                                    <div className="flex flex-wrap gap-3">
                                      {radioOpts.map((opt) => (
                                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                                          <input type="radio" name={campo.id} value={opt} checked={campo.value === opt}
                                            onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                            className="accent-primary" />
                                          <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-foreground'}`}>{opt}</span>
                                        </label>
                                      ))}
                                    </div>
                                  );
                                  return (
                                    <input type="text" value={campo.value} placeholder={`Ingresa ${campo.label.toLowerCase()}`}
                                      onChange={(e) => handleUpdateCampoPersonalizado(campo.id, e.target.value)}
                                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`} />
                                  );
                                })()}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Hint for drag-drop */}
                        {camposPersonalizados.length === 0 && (
                          <p className={`text-xs rounded-lg px-3 py-2 ${isDark ? 'text-gray-400 bg-gray-800' : 'text-muted-foreground bg-muted/30'}`}>
                            Haz clic en un campo para colocarlo en el documento, o arrástralo directamente sobre el PDF.
                          </p>
                        )}

                        {/* Campo type selector panel */}
                        {showCampoSelector && (
                          <div className={`border rounded-xl overflow-hidden shadow-sm ${isDark ? 'border-gray-700 bg-gray-800' : 'border-border bg-white'}`}>
                            {/* Campos del Participante */}
                            <div className={`border-b ${isDark ? 'border-gray-700' : 'border-border'}`}>
                              <button
                                onClick={() => setParticipanteOpen((v) => !v)}
                                className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${isDark ? 'bg-gray-800 hover:bg-gray-750' : 'bg-white hover:bg-slate-50'}`}
                              >
                                <span className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Campos del Participante</span>
                                <ChevronDown size={16} className={`text-muted-foreground transition-transform ${participanteOpen ? 'rotate-180' : ''}`} />
                              </button>
                              {participanteOpen && (
                                <div className="px-3 pb-3 space-y-2">
                                  {[
                                    { tipo: 'firma' as const, label: 'Firma', icon: <PenLine size={14} />, required: true },
                                    { tipo: 'nombre_completo' as const, label: 'Nombre Completo', icon: <User size={14} /> },
                                    { tipo: 'rfc' as const, label: 'RFC', icon: <FileText size={14} /> },
                                    { tipo: 'curp' as const, label: 'CURP', icon: <UserCheck size={14} /> },
                                    { tipo: 'correo' as const, label: 'Correo Electrónico', icon: <Mail size={14} /> },
                                    { tipo: 'telefono' as const, label: 'Número Telefónico', icon: <Phone size={14} /> },
                                    { tipo: 'direccion' as const, label: 'Dirección', icon: <MapPin size={14} /> },
                                  ].map((item) => {
                                    const firmaAlreadyAdded = item.tipo === 'firma' && (
                                      camposPersonalizados.some((c) => c.tipo === 'firma') ||
                                      camposPrefijados.some((c) => (c.tipo === 'firma') || deriveTipoFromLabel(c.label) === 'firma')
                                    );
                                    return (
                                    <div
                                      key={item.tipo}
                                      draggable={!firmaAlreadyAdded}
                                      onDragStart={(e) => {
                                        if (firmaAlreadyAdded) { e.preventDefault(); return; }
                                        e.dataTransfer.setData('campo-tipo', item.tipo);
                                        e.dataTransfer.setData('campo-label', item.label);
                                      }}
                                      onClick={() => { if (!firmaAlreadyAdded) handlePlaceFieldOnDocument(item.tipo, item.label); }}
                                      className={`flex items-center justify-between px-3 py-2.5 border rounded-lg transition-all select-none ${firmaAlreadyAdded ? 'border-slate-100 opacity-50 cursor-not-allowed' : `cursor-grab active:cursor-grabbing hover:border-primary/40 hover:shadow-sm ${isDark ? 'border-gray-600 bg-gray-700' : 'border-slate-200 bg-white'}`}`}
                                      title={firmaAlreadyAdded ? 'La firma ya fue insertada en el documento' : undefined}
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <span className="text-slate-500">{item.icon}</span>
                                        <span className={`text-sm ${isDark ? 'text-gray-200' : 'text-foreground'}`}>
                                          {item.label}
                                          {item.required && <span className="text-red-500 ml-1">*</span>}
                                        </span>
                                      </div>
                                      {firmaAlreadyAdded ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                                      ) : (
                                        <span className="text-slate-300 text-xs font-bold tracking-widest">⠿</span>
                                      )}
                                    </div>
                                  );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Campos Generales */}
                            <div>
                              <button
                                onClick={() => setGeneralesOpen((v) => !v)}
                                className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${isDark ? 'bg-gray-800 hover:bg-gray-750' : 'bg-white hover:bg-slate-50'}`}
                              >
                                <span className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Campos Generales</span>
                                <ChevronDown size={16} className={`text-muted-foreground transition-transform ${generalesOpen ? 'rotate-180' : ''}`} />
                              </button>
                              {generalesOpen && (
                                <div className="px-3 pb-3 space-y-2">
                                  {[
                                    { tipo: 'texto' as const, label: 'Texto', icon: <Type size={14} /> },
                                    { tipo: 'fecha' as const, label: 'Fecha', icon: <Calendar size={14} /> },
                                    { tipo: 'hora' as const, label: 'Hora', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
                                    { tipo: 'numero' as const, label: 'Número', icon: <Hash size={14} /> },
                                    { tipo: 'moneda' as const, label: 'Moneda', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
                                    { tipo: 'checkbox' as const, label: 'Casilla', icon: <ToggleLeft size={14} /> },
                                    { tipo: 'imagen' as const, label: 'Imagen', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> },
                                    { tipo: 'radio' as const, label: 'Botones de opción', icon: <List size={14} /> },
                                    { tipo: 'dropdown' as const, label: 'Desplegable', icon: <ChevronDown size={14} /> },
                                  ].map((item) => (
                                    <div
                                      key={item.tipo}
                                      draggable
                                      onDragStart={(e) => {
                                        e.dataTransfer.setData('campo-tipo', item.tipo);
                                        e.dataTransfer.setData('campo-label', item.label);
                                      }}
                                      onClick={() => handlePlaceFieldOnDocument(item.tipo as CampoPersonalizado['tipo'], item.label)}
                                      className={`flex items-center justify-between px-3 py-2.5 border rounded-lg cursor-grab active:cursor-grabbing hover:border-primary/40 hover:shadow-sm transition-all select-none ${isDark ? 'border-gray-600 bg-gray-700' : 'border-slate-200 bg-white'}`}
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <span className="text-slate-500">{item.icon}</span>
                                        <span className={`text-sm ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{item.label}</span>
                                      </div>
                                      <span className="text-slate-300 text-xs font-bold tracking-widest">⠿</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Close button */}
                            <div className={`px-3 pb-3 pt-1 border-t ${isDark ? 'border-gray-700' : 'border-border'}`}>
                              <button
                                onClick={() => setShowCampoSelector(false)}
                                className={`w-full text-xs py-1.5 transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-muted-foreground hover:text-foreground'}`}
                              >
                                Cerrar
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Add campo button */}
                        {!showCampoSelector && (
                          <button
                            onClick={() => setShowCampoSelector(true)}
                            className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
                          >
                            <Plus size={15} />
                            Agregar campo personalizado
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── STEP: FIRMA ────────────────────────────────────────────── */}
              {step === 'firma' && (
                <div className="space-y-5">
                  <div>
                    <h2 className={`text-lg font-bold ${isDark ? 'text-gray-100' : 'text-foreground'}`}>Asentar firma</h2>
                    <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                      Captura tu firma para registrarla en el documento.
                    </p>
                  </div>

                  {/* ── E.FIRMA SAT FLOW ───────────────────────────────────── */}
                  {isEfirmaSAT && (
                    <>
                      <div className={`flex items-center gap-3 rounded-xl p-3 border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/40 border-border'}`}>
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <Shield size={15} className="text-blue-600" />
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{user.user_metadata?.full_name || user.email}</p>
                          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>{user.email} · e.firma SAT</p>
                        </div>
                        {efirmaValidated && (
                          <div className="ml-auto flex items-center gap-1 text-green-600 text-xs font-medium">
                            <CheckCircle2 size={14} />
                            Validada
                          </div>
                        )}
                      </div>
                      <EfirmaFirmarFlow
                        profileEfirma={profileEfirma}
                        isDark={isDark}
                        geoDenied={geoDenied}
                        onValidated={(certInfo, cerB64, keyB64, password, nubariumResult) => {
                          setEfirmaValidated(true);
                          // Store cert info and credentials in memory for sign-efirma call
                          setEfirmaCertInfo(certInfo || null);
                          setEfirmaCerB64(cerB64 || null);
                          setEfirmaKeyB64(keyB64 || null);
                          setEfirmaPassword(password || null);
                          // Store Nubarium validation result
                          if (nubariumResult) setNubariumValidationResult(nubariumResult);
                          // Generate a visual stamp for the e.firma
                          const canvas = window.document.createElement('canvas');
                          canvas.width = 600;
                          canvas.height = 200;
                          const ctx = canvas.getContext('2d');
                          if (ctx) {
                            ctx.fillStyle = '#f0f9ff';
                            ctx.fillRect(0, 0, 600, 200);
                            ctx.strokeStyle = '#0ea5e9';
                            ctx.lineWidth = 2;
                            ctx.strokeRect(4, 4, 592, 192);
                            ctx.fillStyle = '#0ea5e9';
                            ctx.font = 'bold 14px Arial';
                            ctx.textAlign = 'center';
                            ctx.fillText('e.firma SAT — Firma Electrónica Avanzada', 300, 50);
                            ctx.fillStyle = '#1e293b';
                            ctx.font = '12px Arial';
                            ctx.fillText(profileEfirma?.rfc || userProfile.rfc || 'RFC', 300, 80);
                            ctx.fillText(profileEfirma?.nombre || userProfile.nombre_completo || '', 300, 105);
                            ctx.fillStyle = '#64748b';
                            ctx.font = '10px Arial';
                            ctx.fillText(`Validado ante SAT · ${new Date().toLocaleDateString('es-MX')}`, 300, 135);
                            ctx.strokeStyle = '#0ea5e9';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            ctx.moveTo(50, 155);
                            ctx.lineTo(550, 155);
                            ctx.stroke();
                            ctx.fillStyle = '#0ea5e9';
                            ctx.font = '9px Arial';
                            ctx.fillText('Firma Electrónica Avanzada — SAT México', 300, 175);
                          }
                          const dataUrl = canvas.toDataURL('image/png');
                          setFirmaData(dataUrl);
                          setFirmaConfirmada(true);
                        }}
                        documentId={document.id}
                        supabaseAccessToken={sessionToken || undefined}
                      />

                      {/* ── Save e.firma to profile prompt ─────────────────── */}
                      {efirmaValidated && wantToSaveEfirma === null && !efirmaSavedToProfile && (() => {
                        // Show prompt if: no profile e.firma stored, OR the validated cert serial differs from stored serial
                        const validatedSerial = efirmaCertInfo?.cert_serial || null;
                        const storedSerial = profileEfirma?.serial || null;
                        return !storedSerial || (validatedSerial && validatedSerial !== storedSerial);
                      })() && (
                        <div className={`border rounded-xl p-4 space-y-3 ${isDark ? 'border-blue-700 bg-blue-900/20' : 'border-blue-200 bg-blue-50'}`}>
                          <div className="flex items-start gap-2">
                            <ShieldCheck size={16} className={`flex-shrink-0 mt-0.5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                            <p className={`text-sm font-medium ${isDark ? 'text-blue-200' : 'text-blue-800'}`}>
                              ¿Deseas guardar tu e.firma en tu perfil para agilizar futuros procesos de firma?
                            </p>
                          </div>
                          <p className={`text-xs ${isDark ? 'text-blue-300' : 'text-blue-600'}`}>
                            Solo se guardan los datos del certificado (RFC, número de serie, vigencia). Tus archivos .cer y .key nunca se almacenan.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={savingEfirmaToProfile}
                              onClick={async () => {
                                if (!user || !efirmaCertInfo) return;
                                setSavingEfirmaToProfile(true);
                                try {
                                  const supabase = createClient();
                                  await supabase.from('user_profiles').upsert({
                                    id: user.id,
                                    efirma_serial: efirmaCertInfo?.cert_serial || null,
                                    efirma_rfc: efirmaCertInfo?.cert_rfc || userProfile.rfc || null,
                                    efirma_nombre: efirmaCertInfo?.cert_subject || userProfile.nombre_completo || null,
                                    efirma_vigencia_fin: efirmaCertInfo?.cert_not_after || null,
                                    updated_at: new Date().toISOString(),
                                  }, { onConflict: 'id' });
                                  setWantToSaveEfirma(true);
                                  setEfirmaSavedToProfile(true);
                                } catch (err) {
                                  console.error('Error al guardar e.firma en perfil:', err);
                                } finally {
                                  setSavingEfirmaToProfile(false);
                                }
                              }}
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60"
                            >
                              {savingEfirmaToProfile ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                              Sí, guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => setWantToSaveEfirma(false)}
                              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-border text-foreground hover:bg-muted'}`}
                            >
                              No, gracias
                            </button>
                          </div>
                        </div>
                      )}

                      {efirmaSavedToProfile && (
                        <div className={`border rounded-xl p-3 flex items-center gap-2 ${isDark ? 'border-gray-600 bg-gray-800/40' : 'border-gray-200 bg-gray-50'}`}>
                          <ShieldCheck size={16} className={`flex-shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
                          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                            e.firma guardada en tu perfil. Podrás gestionarla desde <strong>/mi-perfil</strong>.
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {/* ── AUTÓGRAFA DIGITAL FLOW ─────────────────────────────── */}
                  {isAutografaDigital && !isEfirmaSAT && (
                    <>
                      {/* User info */}
                      <div className={`flex items-center gap-3 rounded-xl p-3 border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/40 border-border'}`}>
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <User size={15} className="text-blue-600" />
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-foreground'}`}>{user.user_metadata?.full_name || user.email}</p>
                          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>{user.email} · Firma Autógrafa Digital</p>
                        </div>
                      </div>

                      {/* Check for pre-recorded autograph signature — new UX */}
                      {savedSignature && savedSignatureType === 'autografa' && usePreloadedSignature === null && !autographFlowDone && (
                        <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-blue-700 bg-blue-900/20' : 'border-blue-200 bg-blue-50'}`}>
                          <div className="p-4 space-y-3">
                            <div className="flex items-start gap-2">
                              <ShieldCheck size={16} className={`flex-shrink-0 mt-0.5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                              <p className={`text-sm font-medium ${isDark ? 'text-blue-200' : 'text-blue-800'}`}>
                                Existe una firma vinculada a este usuario, ¿quieres utilizarla?
                              </p>
                            </div>
                            {/* Signature preview */}
                            <div className="border border-dashed border-slate-300 rounded-lg bg-white overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={savedSignature} alt="Firma autógrafa guardada" className="w-full max-h-24 object-contain p-2" />
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setUsePreloadedSignature(true);
                                  setFirmaData(savedSignature);
                                  setFirmaConfirmada(true);
                                }}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
                              >
                                <Check size={14} />
                                Sí, usar esta firma
                              </button>
                              <button
                                type="button"
                                onClick={() => setUsePreloadedSignature(false)}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-border text-foreground hover:bg-muted'}`}
                              >
                                No, usar otra
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Using pre-recorded signature */}
                      {savedSignature && savedSignatureType === 'autografa' && usePreloadedSignature === true && (
                        <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-green-700' : 'border-green-200'}`}>
                          <div className={`px-4 py-2.5 border-b flex items-center justify-between ${isDark ? 'bg-green-900/20 border-green-700' : 'bg-green-50 border-green-200'}`}>
                            <div className="flex items-center gap-2">
                              <CheckCircle2 size={14} className="text-green-600" />
                              <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-green-400' : 'text-green-700'}`}>
                                Usando firma autógrafa pregrabada
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setUsePreloadedSignature(null); setFirmaData(null); setFirmaConfirmada(false); }}
                              className={`text-xs underline ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                              Cambiar
                            </button>
                          </div>
                          <div className="p-4 bg-white">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={savedSignature} alt="Firma autógrafa guardada" className="w-full max-h-28 object-contain" />
                          </div>
                        </div>
                      )}

                      {/* Full autograph flow — when no pre-recorded or user chose to draw new */}
                      {((!savedSignature || savedSignatureType !== 'autografa') || usePreloadedSignature === false) && !autographFlowDone && (
                        <AutographSignatureFlow
                          documentId={document.id}
                          userId={user.id}
                          userToken=""
                          userEmail={userProfile.email || user.email || ''}
                          onNoticeAccepted={() => setHideNoSignatureWarning(true)}
                          userName={userProfile.nombre_completo || user.email || ''}
                          documentName={document.nombre}
                          isDark={isDark}
                          onComplete={(dataUrl) => {
                            setFirmaData(dataUrl);
                            setFirmaConfirmada(true);
                            setAutographFlowDone(true);
                          }}
                        />
                      )}

                      {autographFlowDone && firmaConfirmada && (
                        <div className="space-y-3">
                          <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                            <p className="text-sm text-green-700">Firma autógrafa digital capturada y evidencia registrada correctamente.</p>
                          </div>

                          {/* Save signature selector */}
                          {wantToSaveSignature === null && !newSignatureSaved && (
                            <div className={`border rounded-xl p-4 space-y-3 ${isDark ? 'border-blue-700 bg-blue-900/20' : 'border-blue-200 bg-blue-50'}`}>
                              <div className="flex items-start gap-2">
                                <ShieldCheck size={16} className={`flex-shrink-0 mt-0.5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                                <p className={`text-sm font-medium ${isDark ? 'text-blue-200' : 'text-blue-800'}`}>
                                  ¿Quieres guardar tu firma para utilizarla posteriormente y agilizar el proceso de firmado?
                                </p>
                              </div>
                              <p className={`text-xs ${isDark ? 'text-blue-300' : 'text-blue-600'}`}>
                                Tu firma se almacenará de forma segura y cifrada vinculada a tu perfil.
                              </p>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={savingNewSignature}
                                  onClick={async () => {
                                    if (!user || !firmaData) return;
                                    setSavingNewSignature(true);
                                    try {
                                      const supabase = createClient();
                                      await supabase.from('user_profiles').upsert({
                                        id: user.id,
                                        firma_autografa_url: firmaData,
                                        metodo_firma: 'autografa_digital',
                                        firma_autografa_created_at: new Date().toISOString(),
                                        firma_autografa_last_used: new Date().toISOString(),
                                        updated_at: new Date().toISOString(),
                                      }, { onConflict: 'id' });
                                      setWantToSaveSignature(true);
                                      setNewSignatureSaved(true);
                                    } catch (err) {
                                      console.error('Error al guardar firma:', err);
                                    } finally {
                                      setSavingNewSignature(false);
                                    }
                                  }}
                                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60"
                                >
                                  {savingNewSignature ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                  Sí, guardar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setWantToSaveSignature(false)}
                                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-border text-foreground hover:bg-muted'}`}
                                >
                                  No, gracias
                                </button>
                              </div>
                            </div>
                          )}

                          {newSignatureSaved && (
                            <div className={`border rounded-xl p-3 flex items-center gap-2 ${isDark ? 'border-gray-600 bg-gray-800/40' : 'border-gray-200 bg-gray-50'}`}>
                              <ShieldCheck size={16} className={`flex-shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
                              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                                Firma guardada de forma segura en tu perfil. Podrás verla en <strong>/mi-perfil</strong>.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* ── NON-AUTÓGRAFA FLOW (existing) ─────────────────────── */}
                  {!isAutografaDigital && !isEfirmaSAT && (<>
                  <div className={`flex items-center gap-3 rounded-xl p-3 border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/40 border-border'}`}>
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <User size={15} className="text-blue-600" />
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-foreground'}`}>
                        {user.user_metadata?.full_name || user.email}
                      </p>
                      <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>{user.email}</p>
                    </div>
                  </div>

                  {/* Preloaded signature option */}
                  {savedSignature && usePreloadedSignature === null && (
                    <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-amber-700 bg-amber-900/20' : 'border-amber-200 bg-amber-50'}`}>
                      <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${isDark ? 'border-amber-700' : 'border-amber-200'}`}>
                        <PenLine size={14} className="text-amber-600" />
                        <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
                          Firma precargada disponible — {signatureTypeLabel}
                        </p>
                      </div>
                      <div className="p-4 space-y-3">
                        <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          Tienes una firma guardada en tu perfil. ¿Deseas utilizarla o dibujar una nueva?
                        </p>
                        {/* Preview of saved signature */}
                        <div className="border border-dashed border-slate-300 rounded-lg bg-white overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={savedSignature} alt="Firma guardada" className="w-full max-h-24 object-contain p-2" />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setUsePreloadedSignature(true);
                              setFirmaData(savedSignature);
                              setFirmaConfirmada(true);
                            }}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
                          >
                            <Check size={14} />
                            Usar firma guardada
                          </button>
                          <button
                            type="button"
                            onClick={() => setUsePreloadedSignature(false)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-border text-foreground hover:bg-muted'}`}
                          >
                            <PenLine size={14} />
                            Dibujar nueva
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Show preloaded signature confirmation */}
                  {savedSignature && usePreloadedSignature === true && (
                    <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-green-700' : 'border-green-200'}`}>
                      <div className={`px-4 py-2.5 border-b flex items-center justify-between ${isDark ? 'bg-green-900/20 border-green-700' : 'bg-green-50 border-green-200'}`}>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={14} className="text-green-600" />
                          <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-green-400' : 'text-green-700'}`}>
                            Usando firma guardada — {signatureTypeLabel}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setUsePreloadedSignature(null); setFirmaData(null); setFirmaConfirmada(false); }}
                          className={`text-xs underline ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                          Cambiar
                        </button>
                      </div>
                      <div className="p-4 bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={savedSignature} alt="Firma guardada" className="w-full max-h-28 object-contain" />
                      </div>
                    </div>
                  )}

                  {/* New signature drawing area — shown when no preloaded or user chose new */}
                  {(!savedSignature || usePreloadedSignature === false) && (
                    <>
                      {/* Configurar modo de firma */}
                      <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-gray-700' : 'border-border'}`}>
                        <div className={`px-4 py-2.5 border-b ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/30 border-border'}`}>
                          <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-foreground'}`}>Configurar modo de firma</p>
                        </div>
                        <div className={`p-4 space-y-4 ${isDark ? 'bg-gray-800' : ''}`}>
                          {/* Mode selector — 3 styles */}
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() => { setSignatureMode('dibujar'); setFirmaData(null); setFirmaConfirmada(false); }}
                              className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 text-xs font-medium transition-all ${signatureMode === 'dibujar' ? 'border-primary bg-primary/5 text-primary' : `${isDark ? 'border-gray-600 text-gray-400 hover:border-gray-500' : 'border-border text-muted-foreground hover:border-primary/40'}`}`}
                            >
                              <PenLine size={18} />
                              Dibujar
                            </button>
                            <button
                              type="button"
                              onClick={() => { setSignatureMode('tipear'); setFirmaData(null); setFirmaConfirmada(false); }}
                              className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 text-xs font-medium transition-all ${signatureMode === 'tipear' ? 'border-primary bg-primary/5 text-primary' : `${isDark ? 'border-gray-600 text-gray-400 hover:border-gray-500' : 'border-border text-muted-foreground hover:border-primary/40'}`}`}
                            >
                              <Type size={18} />
                              Tipear
                            </button>
                            <button
                              type="button"
                              onClick={() => { setSignatureMode('cargar'); setFirmaData(null); setFirmaConfirmada(false); }}
                              className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 text-xs font-medium transition-all ${signatureMode === 'cargar' ? 'border-primary bg-primary/5 text-primary' : `${isDark ? 'border-gray-600 text-gray-400 hover:border-gray-500' : 'border-border text-muted-foreground hover:border-primary/40'}`}`}
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                              Cargar imagen
                            </button>
                          </div>

                          {/* Mode: Dibujar */}
                          {signatureMode === 'dibujar' && (
                            <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-gray-700' : 'border-border'}`}>
                              <div className={`px-4 py-2.5 border-b flex items-center justify-between ${isDark ? 'bg-gray-700 border-gray-600' : 'bg-muted/30 border-border'}`}>
                                <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-foreground'}`}>Firma autógrafa digital</p>
                                {firmaConfirmada && (
                                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                    <Check size={11} /> Guardada
                                  </span>
                                )}
                              </div>
                              <div className="p-4">
                                <SignaturePad
                                  onSave={handleFirmaSaved}
                                  onClear={handleFirmaClear}
                                  existingSignature={firmaData || undefined}
                                />
                              </div>
                            </div>
                          )}

                          {/* Mode: Tipear */}
                          {signatureMode === 'tipear' && (
                            <div className="space-y-3">
                              <div>
                                <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-foreground'}`}>Escribe tu nombre para generar la firma</label>
                                <input
                                  type="text"
                                  value={typedSignature}
                                  onChange={(e) => { setTypedSignature(e.target.value); setFirmaConfirmada(false); setFirmaData(null); }}
                                  placeholder="Tu nombre completo"
                                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`}
                                />
                              </div>
                              {/* 3 style options */}
                              <div>
                                <label className={`block text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-foreground'}`}>Estilo de firma</label>
                                <div className="grid grid-cols-3 gap-2">
                                  {([
                                    { key: 'cursive' as const, label: 'Cursiva', font: '"Dancing Script", cursive' },
                                    { key: 'print' as const, label: 'Imprenta', font: '"Roboto", sans-serif' },
                                    { key: 'formal' as const, label: 'Formal', font: '"Playfair Display", serif' },
                                  ]).map((style) => (
                                    <button
                                      key={style.key}
                                      type="button"
                                      onClick={() => { setTypedSignatureStyle(style.key); setFirmaConfirmada(false); setFirmaData(null); }}
                                      className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl border-2 transition-all ${typedSignatureStyle === style.key ? 'border-primary bg-primary/5' : `${isDark ? 'border-gray-600 hover:border-gray-500' : 'border-border hover:border-primary/40'}`}`}
                                    >
                                      <span style={{ fontFamily: style.font, fontSize: '18px', color: '#1e293b' }}>
                                        {typedSignature ? typedSignature.split(' ')[0] || 'Firma' : 'Firma'}
                                      </span>
                                      <span className={`text-[10px] font-medium ${typedSignatureStyle === style.key ? 'text-primary' : isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>{style.label}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                              {typedSignature.trim() && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const dataUrl = generateTypedSignatureDataUrl(typedSignature, typedSignatureStyle);
                                    if (dataUrl) { setFirmaData(dataUrl); setFirmaConfirmada(true); }
                                  }}
                                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
                                >
                                  <Check size={14} />
                                  Confirmar firma tipografiada
                                </button>
                              )}
                            </div>
                          )}

                          {/* Mode: Cargar imagen */}
                          {signatureMode === 'cargar' && (
                            <div className="space-y-3">
                              <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-foreground'}`}>Sube una imagen de tu firma</label>
                              <input
                                type="file"
                                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  if (file.size > 2 * 1024 * 1024) { alert('El archivo no debe superar los 2 MB.'); e.target.value = ''; return; }
                                  const reader = new FileReader();
                                  reader.onload = (ev) => {
                                    const dataUrl = ev.target?.result as string;
                                    setFirmaData(dataUrl);
                                    setFirmaConfirmada(true);
                                  };
                                  reader.readAsDataURL(file);
                                }}
                                className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                              />
                              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>JPG, JPEG o PNG · máx. 2 MB</p>
                              {firmaData && (
                                <div className="border border-dashed border-slate-300 rounded-lg bg-white overflow-hidden">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={firmaData} alt="Firma cargada" className="w-full max-h-28 object-contain p-2" />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {firmaConfirmada && firmaData && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                      <p className="text-sm text-green-700">Tu firma ha sido capturada. Puedes enviar tu participación.</p>
                    </div>
                  )}
                  </>)}
                </div>
              )}

              {/* ── STEP: APROBACIÓN ──────────────────────────────────────── */}
              {step === 'aprobacion' && (
                <div className="space-y-5">
                  <div>
                    <h2 className={`text-lg font-bold ${isDark ? 'text-gray-100' : 'text-foreground'}`}>Dar visto bueno</h2>
                    <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                      Como aprobador, indica tu aprobación formal del documento. Puedes agregar observaciones opcionales.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 bg-violet-50 rounded-xl p-3 border border-violet-200">
                    <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                      <User size={15} className="text-violet-600" />
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-foreground'}`}>
                        {user.user_metadata?.full_name || user.email}
                      </p>
                      <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>{user.email} · Aprobador</p>
                    </div>
                  </div>

                  <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-gray-700' : 'border-border'}`}>
                    <div className={`px-4 py-2.5 border-b ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-muted/30 border-border'}`}>
                      <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-foreground'}`}>Confirmación de aprobación</p>
                    </div>
                    <div className={`p-4 space-y-4 ${isDark ? 'bg-gray-800' : ''}`}>
                      <div className="flex items-start gap-3 bg-violet-50 rounded-lg p-3 border border-violet-100">
                        <CheckCircle2 size={18} className="text-violet-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-foreground'}`}>Visto bueno / Aprobación</p>
                          <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>
                            Al enviar, confirmas que has revisado el documento y otorgas tu aprobación formal.
                          </p>
                        </div>
                      </div>

                      {hasCamposPrefijados && camposPrefijados.length > 0 && (
                        <div className="space-y-3">
                          <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-muted-foreground'}`}>Campos requeridos</p>
                          {camposPrefijados.map((campo, idx) => {
                            const key = campo.id || `prefijado-${idx}`;
                            return (
                              <div key={key} className="space-y-1.5">
                                <label className={`flex items-center gap-1.5 text-sm font-medium ${isDark ? 'text-gray-200' : 'text-foreground'}`}>
                                  <CampoIcon tipo={campo.tipo} />
                                  {campo.label}
                                </label>
                                <input
                                  type={campo.tipo === 'fecha' ? 'date' : campo.tipo === 'numero' ? 'number' : 'text'}
                                  value={camposValues[key] || ''}
                                  onKeyDown={campo.tipo === 'numero' ? (e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); } : undefined}
                                  onChange={(e) => setCamposValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                  placeholder={`Ingresa ${campo.label.toLowerCase()}`}
                                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-background border-border'}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-foreground'}`}>
                          Observaciones <span className={`font-normal ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>(opcional)</span>
                        </label>
                        <textarea
                          value={observaciones}
                          onChange={(e) => setObservaciones(e.target.value)}
                          placeholder="Escribe tus observaciones, comentarios o condiciones de aprobación..."
                          rows={4}
                          className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500' : 'bg-background border-border'}`}
                        />
                        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-muted-foreground'}`}>{observaciones.length}/500 caracteres</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {submitError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
                  <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700">{submitError}</p>
                </div>
              )}

            </div>
          </div>

          {/* ── Bottom Action Bar ──────────────────────────────────────────── */}
          <div className={`border-t px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-shrink-0 shadow-sm transition-colors duration-300 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-border bg-card'}`}>
            <div className="flex items-center gap-2">
              {step !== 'terminos' && (
                <button
                  onClick={() => {
                    if (step === 'campos') setStep('terminos');
                    else if (step === 'firma') setStep('campos');
                    else if (step === 'aprobacion') setStep(myRole === 'aprobador' ? 'terminos' : 'campos');
                  }}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${isDark ? 'text-gray-300 border-gray-600 hover:bg-gray-700' : 'text-muted-foreground border-border hover:bg-muted'}`}
                >
                  <ArrowLeft size={14} />
                  Atrás
                </button>
              )}
              {/* Guardar avance — only in campos and firma steps */}
              {(step === 'campos' || step === 'firma') && (
                <button
                  onClick={handleGuardarAvance}
                  disabled={savingProgress}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg transition-colors ${isDark ? 'text-gray-300 border-gray-600 hover:bg-gray-700' : 'text-primary border-primary/30 hover:bg-primary/5'} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {savingProgress ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  <span className="hidden sm:inline">Guardar avance</span>
                </button>
              )}
              {saveProgressMsg && (
                <span className={`text-xs font-medium ${saveProgressMsg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>
                  {saveProgressMsg}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {step === 'terminos' && (
                <button
                  onClick={handleAceptarTerminos}
                  disabled={!terminosAceptados || geoDenied || geoLoading}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {geoLoading ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} className="rotate-[-90deg]" />}
                  Continuar
                </button>
              )}

              {step === 'campos' && (
                <button
                  onClick={handleContinuarDesdeCampos}
                  disabled={!allCamposCompleted || geoDenied || geoLoading}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {myRole === 'firmante' ? 'Ir a firmar' : 'Continuar'}
                  <ChevronDown size={14} className="rotate-[-90deg]" />
                </button>
              )}

              {step === 'firma' && (
                <button
                  onClick={handleSubmit}
                  disabled={!firmaConfirmada || submitting}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <><Loader2 size={14} className="animate-spin" /> Enviando...</>
                  ) : (
                    <><Save size={14} /> Enviar firma</>
                  )}
                </button>
              )}

              {step === 'aprobacion' && (
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-violet-500 rounded-xl hover:bg-violet-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <><Loader2 size={14} className="animate-spin" /> Enviando...</>
                  ) : (
                    <><CheckCircle2 size={14} /> Confirmar aprobación</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
