'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import PublicTokenLayout from '@/components/PublicTokenLayout';
import { QRCodeSVG } from 'qrcode.react';
import { createClient } from '@/lib/supabase/client';
import {
  Mail, Phone, Lock, Eye, EyeOff, User, Building2, UserCheck, Shield,
  Upload, CheckCircle2, QrCode, ArrowRight, ArrowLeft, FileKey, Check,
  AlertCircle, RefreshCw, Loader2, XCircle, Clock
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NubariumSerialResult {
  serial: string;
  rfc: string;
  estado: string;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string;
  clave_mensaje: number;
  estatus: string;
  codigo_validacion: string;
}

interface NubariumCurpResult {
  estatus: string;
  codigoValidacion: string;
  curp: string;
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  sexo: string;
  fechaNacimiento: string;
  paisNacimiento: string;
  estadoNacimiento: string;
  docProbatorio: number;
  estatusCurp: string;
  codigoMensaje: string;
}

interface EfirmaValidationResult {
  serialResult: NubariumSerialResult | null;
  curpResult: NubariumCurpResult | null;
  rfc: string;
  curp: string;
  serial: string;
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  vigenciaFin: string;
  isExpired: boolean;
}

interface ParticipantData {
  email: string;
  nombre: string | null;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
  telefono: string | null;
  tipoPersona: 'fisica' | 'moral';
  documentId: string | null;
  documentName: string | null;
  acto: string;
}

interface WizardData {
  phone: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  identityMethod: 'efirma' | 'biometrico' | null;
  cerFile: File | null;
  keyFile: File | null;
  efirmaPassword: string;
  validatedData: {
    nombre: string;
    rfc: string;
    curp: string;
    vigencia: string;
  } | null;
  efirmaValidationResult: EfirmaValidationResult | null;
}

// ─── Password strength ────────────────────────────────────────────────────────

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: '', color: '' };
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const levels = [
    { score: 1, label: 'Débil', color: 'bg-red-400' },
    { score: 2, label: 'Regular', color: 'bg-yellow-400' },
    { score: 3, label: 'Buena', color: 'bg-blue-400' },
    { score: 4, label: 'Fuerte', color: 'bg-emerald-500' },
  ];
  return levels[score - 1] ?? { score: 0, label: '', color: '' };
}

// ─── File Upload Zone ─────────────────────────────────────────────────────────

function FileUploadZone({
  label, accept, file, onFile, icon,
}: {
  label: string; accept: string; file: File | null;
  onFile: (f: File) => void; icon: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all duration-200 w-full max-w-full ${
        file
          ? 'border-emerald-400 bg-emerald-50' :'border-border hover:border-primary/50 hover:bg-primary/5 bg-muted/30'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }}
      />
      {file ? (
        <>
          <CheckCircle2 size={22} className="text-emerald-500" />
          <p className="text-sm font-semibold text-emerald-700 text-center">{file.name}</p>
          <p className="text-xs text-emerald-500">{(file.size / 1024).toFixed(1)} KB</p>
        </>
      ) : (
        <>
          <div className="text-muted-foreground">{icon}</div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">Haz clic para seleccionar</p>
        </>
      )}
    </div>
  );
}

// ─── Parse CER file ───────────────────────────────────────────────────────────

async function parseCerFile(file: File): Promise<{
  rfc: string; curp: string; serial: string; subject: string;
  issuer: string; notBefore: string; notAfter: string; sha256: string; base64: string;
} | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        let sha256 = '';
        try {
          const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
        } catch { /* ignore */ }

        let pos = 0;
        function readLength(): number {
          const first = bytes[pos++];
          if (first < 0x80) return first;
          const numBytes = first & 0x7f;
          let len = 0;
          for (let i = 0; i < numBytes; i++) len = (len << 8) | bytes[pos++];
          return len;
        }
        function readTag(): number { return bytes[pos++]; }
        function skipValue(len: number): void { pos += len; }
        function readTLV(): { tag: number; value: Uint8Array } {
          const tag = readTag();
          let len = readLength();
          const value = bytes.slice(pos, pos + len);
          pos += len;
          return { tag, value };
        }

        readTag(); readLength();
        readTag(); readLength();
        if (bytes[pos] === 0xa0) { readTag(); const vLen = readLength(); skipValue(vLen); }

        const serialTLV = readTLV();
        const serialBytes = serialTLV.value;
        const serialHex = Array.from(serialBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        let noCertificado = '';
        for (let i = 0; i + 1 < serialHex.length; i += 2) {
          const charCode = parseInt(serialHex.slice(i, i + 2), 16);
          if (charCode >= 0x20 && charCode <= 0x7e) noCertificado += String.fromCharCode(charCode);
        }
        noCertificado = noCertificado.replace(/\s/g, '');
        if (!/^\d{20}$/.test(noCertificado)) {
          noCertificado = /^\d{20}$/.test(serialHex) ? serialHex : '';
        }

        const sigAlgTLV = readTLV(); void sigAlgTLV;

        const issuerStart = pos;
        readTag();
        const issuerLen = readLength();
        const issuerBytes = bytes.slice(issuerStart, pos + issuerLen);
        skipValue(issuerLen);
        const issuer = extractDNString(issuerBytes);

        readTag(); readLength();
        const notBeforeTLV = readTLV();
        const notAfterTLV = readTLV();
        const notBefore = parseAsn1Time(notBeforeTLV.value);
        const notAfter = parseAsn1Time(notAfterTLV.value);

        const subjectStart = pos;
        readTag();
        const subjectLen = readLength();
        const subjectBytes = bytes.slice(subjectStart, pos + subjectLen);
        skipValue(subjectLen);
        const subject = extractDNString(subjectBytes);

        const rfcMatch = subject.match(/[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}/);
        const rfc = rfcMatch ? rfcMatch[0] : '';
        const curpMatch = subject.match(/[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9]{2}/);
        const curp = curpMatch ? curpMatch[0] : '';

        resolve({ rfc, curp, serial: noCertificado, subject, issuer, notBefore, notAfter, sha256, base64 });
      } catch (err) {
        console.error('[parseCerFile] Error:', err);
        resolve(null);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function parseAsn1Time(value: Uint8Array): string {
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

function extractDNString(bytes: Uint8Array): string {
  const parts: string[] = [];
  let i = 0;
  if (bytes[i] === 0x30) { i++; i += derLenSize(bytes, i) + 1; }
  while (i < bytes.length) {
    if (bytes[i] !== 0x31) { i++; continue; }
    i++;
    const setLen = derReadLen(bytes, i);
    i += derLenSize(bytes, i) + 1;
    const setEnd = i + setLen;
    if (bytes[i] === 0x30) {
      i++;
      const seqLen = derReadLen(bytes, i);
      i += derLenSize(bytes, i) + 1;
      const seqEnd = i + seqLen;
      if (bytes[i] === 0x06) { i++; const oidLen = derReadLen(bytes, i); i += derLenSize(bytes, i) + 1; i += oidLen; }
      if (i < seqEnd) {
        i++;
        const valLen = derReadLen(bytes, i);
        i += derLenSize(bytes, i) + 1;
        let val = '';
        for (let j = i; j < i + valLen; j++) { if (bytes[j] >= 0x20) val += String.fromCharCode(bytes[j]); }
        if (val.trim()) parts.push(val.trim());
        i += valLen;
      }
      i = seqEnd;
    }
    i = setEnd;
  }
  return parts.join(', ');
}

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
  if (first < 0x80) return 0;
  return first & 0x7f;
}

// ─── Wizard pages ─────────────────────────────────────────────────────────────

const WIZARD_PAGES = [
  { id: 1, label: 'Tus datos' },
  { id: 2, label: 'Contraseña' },
  { id: 3, label: 'Identidad' },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RegistroParticipantePage() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;

  const [currentPage, setCurrentPage] = useState(1);
  const [participantData, setParticipantData] = useState<ParticipantData | null>(null);
  const [loadingParticipant, setLoadingParticipant] = useState(true);
  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [efirmaValidated, setEfirmaValidated] = useState(false);
  const [biometricoValidated, setBiometricoValidated] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedIdentityMethod, setSelectedIdentityMethod] = useState<'efirma' | 'biometrico' | null>(null);
  const [phoneCheckStatus, setPhoneCheckStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // QR / biometric enrollment state
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrExpired, setQrExpired] = useState(false);
  const [qrExpiresAt, setQrExpiresAt] = useState<Date | null>(null);
  const [qrTimeLeft, setQrTimeLeft] = useState<number>(600);
  const [enrollmentResult, setEnrollmentResult] = useState<{
    nombre: string; apellidoPaterno: string; apellidoMaterno: string;
    curp: string; rfc: string; fechaNacimiento: string; sexo: string; tipoIdentificacion: string;
  } | null>(null);
  const sessionIdRef = useRef<string>('');
  const realtimeChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
  const realtimeResultsChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [data, setData] = useState<WizardData>({
    phone: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
    identityMethod: null,
    cerFile: null,
    keyFile: null,
    efirmaPassword: '',
    validatedData: null,
    efirmaValidationResult: null,
  });

  const update = (fields: Partial<WizardData>) => setData((prev) => ({ ...prev, ...fields }));

  // Load participant data
  useEffect(() => {
    async function loadData() {
      if (!token) { setLoadingParticipant(false); return; }
      try {
        const res = await fetch(`/api/portal-participante/participant-data?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const d = await res.json();
          const email = d.email || '';
          setParticipantData({
            email,
            nombre: d.nombre || null,
            apellidoPaterno: d.apellidoPaterno || null,
            apellidoMaterno: d.apellidoMaterno || null,
            telefono: d.telefono || null,
            tipoPersona: d.tipoPersona || 'fisica',
            documentId: d.documentId || null,
            documentName: d.documentName || null,
            acto: d.acto || 'firmar',
          });
          if (d.telefono) {
            setData(prev => ({ ...prev, phone: d.telefono || '' }));
          }
          // Check if email is already registered
          if (email) {
            try {
              const dupRes = await fetch('/api/registro/check-duplicates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
              });
              if (dupRes.ok) {
                const dupData = await dupRes.json();
                if (dupData.emailExists) {
                  setEmailAlreadyRegistered(true);
                }
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
      setLoadingParticipant(false);
    }
    loadData();
  }, [token]);

  // QR countdown timer
  useEffect(() => {
    if (!qrExpiresAt || qrExpired || biometricoValidated) return;
    const interval = setInterval(() => {
      const diff = qrExpiresAt.getTime() - Date.now();
      if (isNaN(diff)) { setQrExpired(true); clearInterval(interval); return; }
      const remaining = Math.max(0, Math.floor(diff / 1000));
      setQrTimeLeft(remaining);
      if (remaining === 0) {
        setQrExpired(true);
        clearInterval(interval);
        if (realtimeChannelRef.current) { const s = createClient(); s.removeChannel(realtimeChannelRef.current); realtimeChannelRef.current = null; }
        if (realtimeResultsChannelRef.current) { const s = createClient(); s.removeChannel(realtimeResultsChannelRef.current); realtimeResultsChannelRef.current = null; }
        if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [qrExpiresAt, qrExpired, biometricoValidated]);

  useEffect(() => {
    return () => {
      const supabase = createClient();
      if (realtimeChannelRef.current) supabase.removeChannel(realtimeChannelRef.current);
      if (realtimeResultsChannelRef.current) supabase.removeChannel(realtimeResultsChannelRef.current);
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current);
    };
  }, []);

  const checkPhone = useCallback(async (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) { setPhoneCheckStatus('idle'); return; }
    setPhoneCheckStatus('checking');
    try {
      const res = await fetch('/api/registro/check-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits }),
      });
      const result = await res.json();
      setPhoneCheckStatus(result.phoneExists ? 'taken' : 'available');
    } catch { setPhoneCheckStatus('idle'); }
  }, []);

  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    update({ phone: digits });
    setPhoneCheckStatus('idle');
    if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current);
    phoneDebounceRef.current = setTimeout(() => checkPhone(digits), 600);
  };

  // Generate QR token
  const generateQrToken = useCallback(async () => {
    setQrLoading(true);
    setQrExpired(false);
    setQrUrl(null);
    setQrTimeLeft(600);

    if (realtimeChannelRef.current) { const s = createClient(); s.removeChannel(realtimeChannelRef.current); realtimeChannelRef.current = null; }
    if (realtimeResultsChannelRef.current) { const s = createClient(); s.removeChannel(realtimeResultsChannelRef.current); realtimeResultsChannelRef.current = null; }
    if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionIdRef.current = sessionId;

    try {
      const res = await fetch('/api/enrollment/create-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const result = await res.json();
      if (!result.success) {
        setErrors((prev) => ({ ...prev, biometrico: 'Error al generar el código QR. Intenta nuevamente.' }));
        setQrLoading(false);
        return;
      }

      let expiresAtDate: Date;
      try {
        const rawExpiry: string = result.expiresAt;
        const normalized = rawExpiry.replace(' ', 'T').replace(/([^Z])$/, '$1Z');
        const parsed = new Date(normalized);
        expiresAtDate = isNaN(parsed.getTime()) ? new Date(Date.now() + 10 * 60 * 1000) : parsed;
      } catch { expiresAtDate = new Date(Date.now() + 10 * 60 * 1000); }

      setQrUrl(result.enrollmentUrl);
      setQrExpiresAt(expiresAtDate);
      setQrTimeLeft(600);

      const supabase = createClient();
      let enrollmentHandled = false;

      const handleEnrollmentData = (rowData: any) => {
        if (enrollmentHandled) return;
        enrollmentHandled = true;
        const enrollData = {
          nombre: rowData.nombre || '',
          apellidoPaterno: rowData.apellido_paterno || '',
          apellidoMaterno: rowData.apellido_materno || '',
          curp: rowData.curp || '',
          rfc: rowData.rfc || '',
          fechaNacimiento: rowData.fecha_nacimiento || '',
          sexo: rowData.sexo || '',
          tipoIdentificacion: rowData.tipo_identificacion || '',
        };
        setEnrollmentResult(enrollData);
        setBiometricoValidated(true);
        update({
          validatedData: {
            nombre: [enrollData.nombre, enrollData.apellidoPaterno, enrollData.apellidoMaterno].filter(Boolean).join(' '),
            rfc: enrollData.rfc,
            curp: enrollData.curp,
            vigencia: 'Verificado biométricamente',
          },
        });
        if (realtimeResultsChannelRef.current) { supabase.removeChannel(realtimeResultsChannelRef.current); realtimeResultsChannelRef.current = null; }
        if (realtimeChannelRef.current) { supabase.removeChannel(realtimeChannelRef.current); realtimeChannelRef.current = null; }
      };

      const resultsChannel = supabase
        .channel(`enrollment_results_${sessionId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'enrollment_results', filter: `session_id=eq.${sessionId}` },
          (payload) => { const row = payload.new as any; if (row.status === 'completed') handleEnrollmentData(row); })
        .subscribe();
      realtimeResultsChannelRef.current = resultsChannel;

      const tokenChannel = supabase
        .channel(`enrollment_token_${result.token}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'enrollment_tokens', filter: `token=eq.${result.token}` },
          (payload) => { const row = payload.new as any; if (row.status === 'completed') handleEnrollmentData(row); })
        .subscribe();
      realtimeChannelRef.current = tokenChannel;

      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = setInterval(async () => {
        if (enrollmentHandled) { if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current); return; }
        try {
          const response = await fetch(`/api/enrollment/status?token=${encodeURIComponent(result.token)}&session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
          const status = await response.json();
          if (response.ok && status.result) { if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current); handleEnrollmentData(status.result); }
        } catch { /* ignore */ }
      }, 3000);
    } catch {
      setErrors((prev) => ({ ...prev, biometrico: 'Error de conexión. Intenta nuevamente.' }));
    } finally {
      setQrLoading(false);
    }
  }, []);

  // e.Firma validation
  const handleValidateEfirma = async () => {
    if (!data.cerFile || !data.keyFile || !data.efirmaPassword) return;
    setIsValidating(true);
    setErrors((prev) => ({ ...prev, efirma: '' }));

    try {
      const keyFormData = new FormData();
      keyFormData.append('keyFile', data.keyFile);
      keyFormData.append('password', data.efirmaPassword);

      let keyValidationRes: Response;
      try {
        keyValidationRes = await fetch('/api/efirma/validate-key', { method: 'POST', body: keyFormData });
      } catch {
        setErrors((prev) => ({ ...prev, efirma: 'Error de red al validar la llave privada. Intenta nuevamente.' }));
        setIsValidating(false);
        return;
      }

      const keyValidation = await keyValidationRes.json();
      if (!keyValidation.success || !keyValidation.isPasswordValid) {
        let userMessage = 'La contraseña es incorrecta o la llave privada no es válida.';
        if (keyValidation.errorCode === 'CORRUPTED_FILE') userMessage = 'El archivo .key está corrupto o dañado.';
        else if (keyValidation.errorCode === 'EMPTY_PASSWORD') userMessage = 'La contraseña no puede estar vacía.';
        setErrors((prev) => ({ ...prev, efirma: userMessage }));
        setIsValidating(false);
        return;
      }

      const parsed = await parseCerFile(data.cerFile);
      const rfc = parsed?.rfc || '';
      const curp = parsed?.curp || '';
      const serial = parsed?.serial || '';
      const notAfter = parsed?.notAfter || '';

      if (!serial) {
        setErrors((prev) => ({ ...prev, efirma: 'No se pudo extraer el número de serie del certificado.' }));
        setIsValidating(false);
        return;
      }

      let isCertExpired = false;
      if (notAfter) {
        try {
          const expiryDate = new Date(notAfter.replace(' ', 'T') + 'Z');
          isCertExpired = expiryDate < new Date();
        } catch { /* ignore */ }
      }

      let serialResult: NubariumSerialResult | null = null;
      let curpResult: NubariumCurpResult | null = null;

      if (rfc && serial) {
        try {
          const serialRes = await fetch('/api/nubarium/validar-serial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rfc, serial }) });
          serialResult = await serialRes.json();
          if (serialResult?.fecha_fin) {
            try { const exp = new Date(serialResult.fecha_fin.replace(' ', 'T')); if (exp < new Date()) isCertExpired = true; } catch { /* ignore */ }
          }
        } catch { /* continue */ }
      }

      if (curp) {
        try {
          const curpRes = await fetch('/api/nubarium/validar-curp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ curp }) });
          curpResult = await curpRes.json();
        } catch { /* continue */ }
      }

      const nombre = curpResult?.nombre || '';
      const apellidoPaterno = curpResult?.apellidoPaterno || '';
      const apellidoMaterno = curpResult?.apellidoMaterno || '';
      const vigenciaFin = serialResult?.fecha_fin || notAfter || '';

      const efirmaValidationResult: EfirmaValidationResult = {
        serialResult, curpResult, rfc, curp: curpResult?.curp || curp,
        serial, nombre, apellidoPaterno, apellidoMaterno, vigenciaFin, isExpired: isCertExpired,
      };

      setEfirmaValidated(true);
      update({
        efirmaValidationResult,
        validatedData: {
          nombre: [nombre, apellidoPaterno, apellidoMaterno].filter(Boolean).join(' '),
          rfc, curp: curpResult?.curp || curp, vigencia: vigenciaFin,
        },
      });
    } catch {
      setErrors((prev) => ({ ...prev, efirma: 'Error al procesar el certificado. Verifica que los archivos sean válidos.' }));
    } finally {
      setIsValidating(false);
    }
  };

  // Registration
  const handleConfirmAndRegister = async () => {
    setIsRegistering(true);
    setRegistrationError(null);

    try {
      const email = participantData?.email || '';
      const tipoPersona = participantData?.tipoPersona || 'fisica';
      const fullName = data.validatedData?.nombre || [participantData?.nombre, participantData?.apellidoPaterno, participantData?.apellidoMaterno].filter(Boolean).join(' ') || '';
      const rfc = data.validatedData?.rfc || '';
      const curp = data.validatedData?.curp || '';
      const identityMethod = data.identityMethod || 'biometrico';

      let documentType1: string | null = null;
      let documentType2: string | null = null;
      if (identityMethod === 'biometrico') { documentType1 = 'biometrico'; documentType2 = 'curp'; }
      else if (identityMethod === 'efirma') { documentType1 = 'efirma_fisica'; documentType2 = 'curp'; }

      const res = await fetch('/api/registro/register-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: data.password,
          phone: data.phone,
          accountType: 'personal',
          personalidadJuridica: tipoPersona,
          identityMethod,
          fullName,
          rfc,
          curp,
          documentType1,
          documentType2,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        setRegistrationError(result.error || 'Error al registrar el usuario. Intenta nuevamente.');
        setIsRegistering(false);
        return;
      }

      // Mark unregistered participant as registered
      if (participantData?.email) {
        try {
          await fetch('/api/portal-participante/mark-registered', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: participantData.email, userId: result.userId }),
          });
        } catch { /* ignore */ }
      }

      setShowSuccess(true);
    } catch {
      setRegistrationError('Error de conexión. Verifica tu internet e intenta nuevamente.');
    } finally {
      setIsRegistering(false);
    }
  };

  const validatePage = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (currentPage === 1) {
      if (data.phone && data.phone.replace(/\D/g, '').length > 0 && data.phone.replace(/\D/g, '').length !== 10) {
        newErrors.phone = 'El número de teléfono debe tener 10 dígitos';
      }
      if (phoneCheckStatus === 'taken') newErrors.phone = 'Este número de teléfono ya está registrado';
    }
    if (currentPage === 2) {
      if (!data.password || data.password.length < 8) newErrors.password = 'La contraseña debe tener al menos 8 caracteres';
      if (data.password !== data.confirmPassword) newErrors.confirmPassword = 'Las contraseñas no coinciden';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (!validatePage()) return;
    if (currentPage < 3) setCurrentPage((p) => p + 1);
  };

  const handleBack = () => {
    if (currentPage > 1) setCurrentPage((p) => p - 1);
    setErrors({});
  };

  const passwordStrength = getPasswordStrength(data.password);

  // ─── Success Screen ──────────────────────────────────────────────────────────

  if (showSuccess) {
    return (
      <div className="fixed inset-0 bg-emerald-500 flex flex-col items-center justify-center z-50">
        <div className="flex flex-col items-center gap-6 text-white text-center px-6 max-w-md">
          <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center mb-2">
            <CheckCircle2 size={52} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold">¡Registro exitoso!</h1>
          <p className="text-emerald-100 text-lg">
            Tu cuenta ha sido creada y verificada correctamente.
          </p>
          <div className="bg-white/15 rounded-2xl p-5 w-full text-left space-y-3 mt-2">
            <div className="flex items-center gap-3">
              <Mail size={16} className="text-emerald-200 flex-shrink-0" />
              <div>
                <p className="text-xs text-emerald-200">Correo electrónico</p>
                <p className="text-sm font-semibold">{participantData?.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <User size={16} className="text-emerald-200 flex-shrink-0" />
              <div>
                <p className="text-xs text-emerald-200">Tipo de cuenta</p>
                <p className="text-sm font-semibold">Personal</p>
              </div>
            </div>
            {data.validatedData && (
              <div className="flex items-center gap-3">
                <Shield size={16} className="text-emerald-200 flex-shrink-0" />
                <div>
                  <p className="text-xs text-emerald-200">Identidad verificada</p>
                  <p className="text-sm font-semibold">{data.validatedData.nombre}</p>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 bg-white/20 rounded-full px-4 py-2 text-sm">
            <Shield size={14} />
            <span>Identidad acreditada · Cuenta activa</span>
          </div>
          <button
            onClick={() => {
              if (participantData?.documentId) {
                router.push(`/visor-documento/${participantData.documentId}`);
              } else {
                router.push('/sign-up-login-screen');
              }
            }}
            className="mt-2 bg-white text-emerald-600 font-bold px-8 py-3 rounded-xl hover:bg-emerald-50 transition-colors duration-200 text-sm"
          >
            {participantData?.documentId ? 'Ver documento' : 'Ir al inicio de sesión'}
          </button>
        </div>
      </div>
    );
  }

  if (loadingParticipant) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Cargando información del participante...</p>
        </div>
      </div>
    );
  }

  // ─── Email already registered screen ─────────────────────────────────────────
  if (emailAlreadyRegistered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <AppLogo variant="dark" className="h-8" />
          </div>

          <div className="bg-white rounded-2xl shadow-lg border border-border overflow-hidden">
            {/* Header */}
            <div className="bg-amber-50 border-b border-amber-100 px-6 py-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertCircle size={20} className="text-amber-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-amber-900">Correo ya registrado</h2>
                <p className="text-sm text-amber-700 mt-0.5">
                  Este correo electrónico ya tiene una cuenta en DocuBox.
                </p>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-border">
                <Mail size={16} className="text-muted-foreground flex-shrink-0" />
                <p className="text-sm font-medium text-foreground">{participantData?.email}</p>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">
                El correo electrónico asociado a esta invitación ya está registrado en la plataforma. Puedes iniciar sesión con tu cuenta existente o recuperar tu contraseña si la olvidaste.
              </p>

              <div className="space-y-2 pt-1">
                <button
                  onClick={() => router.push('/sign-up-login-screen')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
                >
                  <UserCheck size={16} />
                  Iniciar sesión
                </button>
                <button
                  onClick={() => router.push('/olvide-contrasena')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-foreground border border-border rounded-xl hover:bg-muted/50 transition-colors"
                >
                  <Lock size={16} />
                  Olvidé mi contraseña
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Page 1: Datos prellenados ────────────────────────────────────────────────

  const renderPage1 = () => (
    <div className="space-y-6">
      {/* Step 1: Contacto */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold flex-shrink-0">1</div>
          <h3 className="text-base font-bold text-foreground">Contacto</h3>
        </div>
        <div className="space-y-4 pl-8">
          {/* Email — read only */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">
              Correo electrónico
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                value={participantData?.email || ''}
                readOnly
                className="w-full pl-9 pr-10 py-2.5 border border-border rounded-lg text-sm bg-muted/30 text-muted-foreground cursor-not-allowed"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <CheckCircle2 size={14} className="text-emerald-500" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">El correo electrónico no puede modificarse</p>
          </div>

          {/* Phone — editable */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5">
              Número de teléfono <span className="text-muted-foreground font-normal">(opcional)</span>
            </label>
            <div className="relative">
              <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="tel"
                placeholder="10 dígitos"
                value={data.phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                maxLength={10}
                className={`w-full pl-9 pr-10 py-2.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
                  errors.phone || phoneCheckStatus === 'taken' ?'border-red-400'
                    : phoneCheckStatus === 'available' ?'border-emerald-400' :'border-border'
                }`}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {phoneCheckStatus === 'checking' && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                {phoneCheckStatus === 'available' && <CheckCircle2 size={14} className="text-emerald-500" />}
                {phoneCheckStatus === 'taken' && <XCircle size={14} className="text-red-500" />}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{data.phone.length}/10 dígitos</p>
            {phoneCheckStatus === 'taken' && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={12} /> Este número ya está registrado</p>
            )}
            {phoneCheckStatus === 'available' && (
              <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> Número disponible</p>
            )}
            {errors.phone && phoneCheckStatus !== 'taken' && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={12} /> {errors.phone}</p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border/50" />

      {/* Step 2: Tipo de cuenta */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold flex-shrink-0">2</div>
          <h3 className="text-base font-bold text-foreground">Tipo de cuenta</h3>
        </div>
        <div className="pl-8">
          <div className="flex items-start gap-4 p-4 rounded-xl border-2 border-primary bg-primary/5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <User size={20} className="text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-bold text-base text-foreground">Personal</p>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">Seleccionado</span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">Para uso individual, freelancers y profesionistas independientes.</p>
            </div>
            <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0 mt-0.5">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">El tipo de cuenta no puede modificarse</p>
        </div>
      </div>

      <div className="border-t border-border/50" />

      {/* Step 3: Personalidad */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold flex-shrink-0">3</div>
          <h3 className="text-base font-bold text-foreground">Personalidad</h3>
        </div>
        <div className="pl-8">
          {participantData?.tipoPersona === 'moral' ? (
            <div className="flex items-start gap-4 p-4 rounded-xl border-2 border-primary bg-primary/5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 size={20} className="text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-base text-foreground">Persona Moral</p>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">RFC empresarial</span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">Entidad jurídica como empresa, asociación o sociedad.</p>
              </div>
              <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-4 p-4 rounded-xl border-2 border-primary bg-primary/5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <UserCheck size={20} className="text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-base text-foreground">Persona Física</p>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">RFC con CURP</span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">Individuo que actúa en nombre propio.</p>
              </div>
              <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">La personalidad jurídica no puede modificarse</p>
        </div>
      </div>
    </div>
  );

  // ─── Page 2: Contraseña ───────────────────────────────────────────────────────

  const renderPage2 = () => (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-semibold text-foreground mb-1.5">Contraseña</label>
        <div className="relative">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Mínimo 8 caracteres"
            value={data.password}
            onChange={(e) => update({ password: e.target.value })}
            className={`w-full pl-9 pr-10 py-2.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${errors.password ? 'border-red-400' : 'border-border'}`}
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {errors.password && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={12} /> {errors.password}</p>}
        {data.password && (
          <div className="mt-2 space-y-1.5">
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= passwordStrength.score ? passwordStrength.color : 'bg-border'}`} />
              ))}
            </div>
            {passwordStrength.label && <p className="text-xs text-muted-foreground">Seguridad: <span className="font-semibold">{passwordStrength.label}</span></p>}
          </div>
        )}
      </div>
      <div>
        <label className="block text-sm font-semibold text-foreground mb-1.5">Confirmar contraseña</label>
        <div className="relative">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type={showConfirmPassword ? 'text' : 'password'}
            placeholder="Repite tu contraseña"
            value={data.confirmPassword}
            onChange={(e) => update({ confirmPassword: e.target.value })}
            className={`w-full pl-9 pr-10 py-2.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${errors.confirmPassword ? 'border-red-400' : 'border-border'}`}
          />
          <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {errors.confirmPassword && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={12} /> {errors.confirmPassword}</p>}
        {data.confirmPassword && data.password === data.confirmPassword && (
          <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> Las contraseñas coinciden</p>
        )}
      </div>
      <div className="bg-muted/50 rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Requisitos de contraseña</p>
        {[
          { label: 'Mínimo 8 caracteres', met: data.password.length >= 8 },
          { label: 'Al menos una mayúscula', met: /[A-Z]/.test(data.password) },
          { label: 'Al menos un número', met: /[0-9]/.test(data.password) },
          { label: 'Al menos un símbolo', met: /[^A-Za-z0-9]/.test(data.password) },
        ].map((req) => (
          <p key={req.label} className={`text-xs flex items-center gap-1.5 ${req.met ? 'text-emerald-600' : 'text-muted-foreground'}`}>
            {req.met ? <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" /> : <span className="w-3 h-3 rounded-full border border-muted-foreground/40 flex-shrink-0 inline-block" />}
            {req.label}
          </p>
        ))}
      </div>
    </div>
  );

  // ─── Page 3: Identidad + Terms ────────────────────────────────────────────────

  const renderPage3 = () => {
    const minutes = Math.floor(qrTimeLeft / 60);
    const seconds = qrTimeLeft % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const identityDone = (data.identityMethod === 'efirma' && efirmaValidated && data.efirmaValidationResult) ||
      (data.identityMethod === 'biometrico' && biometricoValidated && enrollmentResult);

    return (
      <div className="space-y-6">
        {/* Identity section */}
        <div>
          <h3 className="text-base font-bold text-foreground mb-1">Acredita tu Identidad</h3>
          <p className="text-sm text-muted-foreground mb-4">Verifica tu identidad para activar tu cuenta</p>

          {/* Method selection */}
          {!data.identityMethod && (
            <div className="space-y-3">
              {errors.identityMethod && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} /> {errors.identityMethod}</p>}
              {[
                { value: 'efirma' as const, icon: FileKey, title: 'e.Firma del SAT', desc: 'Usa tu certificado digital (.cer) y llave privada (.key) emitidos por el SAT.', badge: 'Recomendado', badgeColor: 'bg-emerald-100 text-emerald-700' },
                { value: 'biometrico' as const, icon: QrCode, title: 'Enrolamiento Biométrico', desc: 'Escanea un código QR con tu teléfono para verificar tu identidad biométricamente.', badge: 'Rápido', badgeColor: 'bg-blue-100 text-blue-700' },
              ].map((opt) => {
                const isSelected = selectedIdentityMethod === opt.value;
                return (
                  <button key={opt.value} onClick={() => setSelectedIdentityMethod(opt.value)}
                    className={`w-full flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all duration-200 group ${isSelected ? 'border-primary bg-primary/5' : 'border-border bg-white hover:border-primary/40 hover:bg-primary/5'}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'bg-primary/10' : 'bg-muted group-hover:bg-primary/10'}`}>
                      <opt.icon size={20} className={`transition-colors ${isSelected ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm text-foreground">{opt.title}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${opt.badgeColor}`}>{opt.badge}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${isSelected ? 'border-primary' : 'border-muted-foreground/40'}`}>
                      {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                    </div>
                  </button>
                );
              })}
              <button
                onClick={() => {
                  if (!selectedIdentityMethod) { setErrors((prev) => ({ ...prev, identityMethod: 'Selecciona un método de acreditación' })); return; }
                  setErrors((prev) => ({ ...prev, identityMethod: '' }));
                  update({ identityMethod: selectedIdentityMethod });
                }}
                className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                Continuar <ArrowRight size={15} />
              </button>
            </div>
          )}

          {/* e.Firma */}
          {data.identityMethod === 'efirma' && !efirmaValidated && (
            <div className="space-y-3">
              <button onClick={() => { update({ identityMethod: null }); setEfirmaValidated(false); }} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft size={14} /> Cambiar método
              </button>
              <div className="flex items-center gap-2 justify-center">
                <FileKey size={16} className="text-primary" />
                <h4 className="text-sm font-bold text-foreground">Archivos e.Firma</h4>
              </div>
              <FileUploadZone label="Certificado (.cer)" accept=".cer" file={data.cerFile} onFile={(f) => update({ cerFile: f })} icon={<Upload size={18} />} />
              <FileUploadZone label="Llave privada (.key)" accept=".key" file={data.keyFile} onFile={(f) => update({ keyFile: f })} icon={<Lock size={18} />} />
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">Contraseña de la llave privada</label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="password" placeholder="Contraseña e.Firma" value={data.efirmaPassword} onChange={(e) => update({ efirmaPassword: e.target.value })}
                    className={`w-full pl-8 pr-4 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 ${errors.efirma ? 'border-red-400' : 'border-border'}`} />
                </div>
              </div>
              {errors.efirma && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{errors.efirma}</p>
                </div>
              )}
              <button onClick={handleValidateEfirma} disabled={!data.cerFile || !data.keyFile || !data.efirmaPassword || isValidating}
                className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
                {isValidating ? <><RefreshCw size={14} className="animate-spin" /> Validando...</> : <><Shield size={14} /> Validar e.Firma</>}
              </button>
            </div>
          )}

          {/* e.Firma validated */}
          {data.identityMethod === 'efirma' && efirmaValidated && data.efirmaValidationResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 bg-white border border-border rounded-xl p-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">e.Firma Validada</h4>
                  <p className="text-xs text-muted-foreground">Certificado verificado correctamente</p>
                </div>
              </div>
              {data.efirmaValidationResult.curpResult && (
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-muted/40 px-4 py-2 border-b border-border">
                    <p className="text-xs font-bold text-foreground">Información Personal</p>
                  </div>
                  <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-3">
                    <div><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">NOMBRE</p><p className="text-sm font-semibold text-foreground">{data.efirmaValidationResult.curpResult.nombre || '—'}</p></div>
                    <div><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">RFC</p><p className="text-sm font-semibold text-foreground font-mono">{data.efirmaValidationResult.rfc || '—'}</p></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Biométrico QR */}
          {data.identityMethod === 'biometrico' && !biometricoValidated && (
            <div className="space-y-3">
              <button onClick={() => { update({ identityMethod: null }); setBiometricoValidated(false); setQrUrl(null); }} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft size={14} /> Cambiar método
              </button>
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-2"><QrCode size={16} className="text-primary" /><h4 className="text-sm font-bold text-foreground">Código QR de enrolamiento</h4></div>
                <div className="bg-white border-2 border-border rounded-xl p-4 flex flex-col items-center gap-3 w-full">
                  {qrLoading ? (
                    <div className="w-40 h-40 flex items-center justify-center"><Loader2 size={32} className="text-primary animate-spin" /></div>
                  ) : qrExpired ? (
                    <div className="w-40 h-40 flex flex-col items-center justify-center gap-3"><AlertCircle size={32} className="text-red-400" /><p className="text-xs text-red-500 font-semibold text-center">Código expirado</p></div>
                  ) : qrUrl ? (
                    <div className="p-2 bg-white rounded-lg border border-border"><QRCodeSVG value={qrUrl} size={152} level="M" includeMargin={false} /></div>
                  ) : (
                    <div className="w-40 h-40 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-xl">
                      <QrCode size={32} className="text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground text-center">Genera el código QR para comenzar</p>
                    </div>
                  )}
                  {qrUrl && !qrExpired && (
                    <div className="flex items-center gap-2">
                      <Clock size={13} className={qrTimeLeft < 60 ? 'text-red-500' : 'text-muted-foreground'} />
                      <span className={`text-xs font-mono font-semibold ${qrTimeLeft < 60 ? 'text-red-500' : 'text-muted-foreground'}`}>Válido por {timeStr}</span>
                    </div>
                  )}
                  {(!qrUrl || qrExpired) && (
                    <button onClick={generateQrToken} disabled={qrLoading}
                      className="w-full py-2 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
                      {qrLoading ? <><Loader2 size={12} className="animate-spin" /> Generando...</> : qrExpired ? <><RefreshCw size={12} /> Generar nuevo código</> : <><QrCode size={12} /> Generar código QR</>}
                    </button>
                  )}
                  {qrUrl && !qrExpired && (
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 w-full">
                      <Loader2 size={13} className="text-blue-500 animate-spin flex-shrink-0" />
                      <span className="text-xs text-blue-600 font-medium">Esperando enrolamiento...</span>
                    </div>
                  )}
                </div>
              </div>
              {errors.biometrico && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{errors.biometrico}</p>
                </div>
              )}
            </div>
          )}

          {/* Biométrico validated */}
          {data.identityMethod === 'biometrico' && biometricoValidated && enrollmentResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 bg-white border border-border rounded-xl p-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">Identidad Verificada</h4>
                  <p className="text-xs text-muted-foreground">Enrolamiento biométrico completado</p>
                </div>
              </div>
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="bg-muted/40 px-4 py-2 border-b border-border">
                  <p className="text-xs font-bold text-foreground">Información Personal</p>
                </div>
                <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-3">
                  <div><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">NOMBRE</p><p className="text-sm font-semibold text-foreground">{enrollmentResult.nombre || '—'}</p></div>
                  <div><p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">CURP</p><p className="text-sm font-semibold text-foreground font-mono">{enrollmentResult.curp || '—'}</p></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Terms and register button */}
        {identityDone && (
          <div className="space-y-4 border-t border-border/50 pt-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5">
                <input type="checkbox" checked={data.acceptTerms} onChange={(e) => update({ acceptTerms: e.target.checked })} className="sr-only" />
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${data.acceptTerms ? 'bg-primary border-primary' : errors.terms ? 'border-red-400 bg-white' : 'border-border bg-white group-hover:border-primary/50'}`}>
                  {data.acceptTerms && <Check size={12} className="text-white" strokeWidth={3} />}
                </div>
              </div>
              <span className="text-sm text-muted-foreground leading-relaxed">
                Acepto los{' '}
                <span className="text-primary font-semibold cursor-pointer hover:underline">Términos y Condiciones</span>{' '}
                y el{' '}
                <span className="text-primary font-semibold cursor-pointer hover:underline">Aviso de Privacidad</span>{' '}
                de DocuBox
              </span>
            </label>
            {errors.terms && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} /> {errors.terms}</p>}

            <button
              onClick={() => {
                if (!data.acceptTerms) { setErrors((prev) => ({ ...prev, terms: 'Debes aceptar los términos y condiciones' })); return; }
                handleConfirmAndRegister();
              }}
              disabled={!data.acceptTerms || isRegistering}
              className="w-full py-3 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isRegistering ? <><Loader2 size={16} className="animate-spin" /> Registrando...</> : <><CheckCircle2 size={16} /> Completar registro</>}
            </button>

            {registrationError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{registrationError}</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const pageTitles: Record<number, { title: string; subtitle: string }> = {
    1: { title: 'Tus datos de registro', subtitle: 'Verifica y completa tu información' },
    2: { title: 'Crear contraseña', subtitle: 'Elige una contraseña segura para tu cuenta' },
    3: { title: 'Acredita tu Identidad', subtitle: 'Verifica tu identidad para activar tu cuenta' },
  };

  return (
    <PublicTokenLayout token={token as string} luciaScope="external_registration">
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 bg-white/80 backdrop-blur-sm border-b border-border/50">
        <AppLogo size={32} />
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">¿Ya tienes cuenta?</span>
          <button onClick={() => router.push('/sign-up-login-screen')} className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors">
            Iniciar sesión
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-start justify-center py-8 px-4">
        <div className="w-full max-w-md">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-0 mb-8">
            {WIZARD_PAGES.map((page, idx) => (
              <React.Fragment key={page.id}>
                <div className="flex flex-col items-center gap-1.5">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    page.id < currentPage ? 'bg-primary text-white' : page.id === currentPage ? 'bg-primary text-white ring-4 ring-primary/20' : 'bg-muted text-muted-foreground'
                  }`}>
                    {page.id < currentPage ? <Check size={14} strokeWidth={3} /> : page.id}
                  </div>
                  <span className={`text-[10px] font-medium whitespace-nowrap ${page.id === currentPage ? 'text-primary' : 'text-muted-foreground'}`}>
                    {page.label}
                  </span>
                </div>
                {idx < WIZARD_PAGES.length - 1 && (
                  <div className={`h-0.5 w-16 mb-4 mx-1 transition-all duration-300 ${page.id < currentPage ? 'bg-primary' : 'bg-border'}`} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Document info banner */}
          {participantData?.documentName && (
            <div className="mb-4 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
              <p className="text-xs text-muted-foreground">Documento al que fuiste invitado a <span className="font-semibold text-primary">{participantData.acto}</span>:</p>
              <p className="text-sm font-semibold text-foreground mt-0.5 truncate">{participantData.documentName}</p>
            </div>
          )}

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-modal border border-border/50 overflow-hidden">
            {/* Card header */}
            <div className="px-7 pt-7 pb-5 border-b border-border/50">
              <h1 className="text-xl font-bold text-foreground">{pageTitles[currentPage]?.title}</h1>
              <p className="text-sm text-muted-foreground mt-1">{pageTitles[currentPage]?.subtitle}</p>
            </div>

            {/* Card body */}
            <div className="px-7 py-6">
              {currentPage === 1 && renderPage1()}
              {currentPage === 2 && renderPage2()}
              {currentPage === 3 && renderPage3()}
            </div>

            {/* Card footer — only for pages 1 and 2 */}
            {currentPage < 3 && (
              <div className="px-7 pb-7 flex items-center justify-between gap-3">
                <button
                  onClick={currentPage === 1 ? () => router.push(`/portal-participante/${token}`) : handleBack}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150"
                >
                  <ArrowLeft size={15} />
                  {currentPage === 1 ? 'Cancelar' : 'Anterior'}
                </button>
                <button
                  onClick={handleNext}
                  disabled={phoneCheckStatus === 'checking' || phoneCheckStatus === 'taken'}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-all duration-150 shadow-card disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Siguiente <ArrowRight size={15} />
                </button>
              </div>
            )}
            {currentPage === 3 && (
              <div className="px-7 pb-7">
                <button onClick={handleBack} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft size={15} /> Anterior
                </button>
              </div>
            )}
          </div>

          {/* Progress text */}
          <p className="text-center text-xs text-muted-foreground mt-4">
            Paso {currentPage} de {WIZARD_PAGES.length}
          </p>
        </div>
      </main>
    </div>
    </PublicTokenLayout>
  );
}
