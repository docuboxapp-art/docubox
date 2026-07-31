'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { User, Building2, ShieldCheck, PenTool, Lock, Camera, Save, MapPin, Mail, Phone, FileText, ChevronDown, CheckCircle, AlertCircle, Loader2, Check, UserPlus, X, Link2, Trash2, RotateCcw, Edit3, Smartphone, Fingerprint, Clock, KeyRound, Shield, MonitorSmartphone, LogOut, Eye, EyeOff, Globe, Activity, Laptop, Tablet, Upload, FileKey, RefreshCw, QrCode, CheckCircle2, FolderOpen, Maximize2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import Icon from '@/components/ui/AppIcon';
import { QRCodeSVG } from 'qrcode.react';

import TotpSetupModal from '@/components/totp/TotpSetupModal';
import EfirmaStampSelector from './components/EfirmaStampSelector';
import AutografaStampSelector from './components/AutografaStampSelector';
import ClickSignStampSelector from './components/ClickSignStampSelector';


// ─── Types ────────────────────────────────────────────────────────────────────

interface ColoniaResponse {
  error: boolean;
  code_error: number;
  error_message: string | null;
  response: {
    cp: string;
    asentamiento: string;
    tipo_asentamiento: string;
    municipio: string;
    estado: string;
    ciudad: string;
    pais: string;
  };
}

interface ProfileData {
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  tipoPersona: string;
  curp: string;
  correo: string;
  telefono: string;
  rfc: string;
  regimenFiscal: string;
  codigoPostal: string;
  estado: string;
  municipio: string;
  colonia: string;
  localidad: string;
  calle: string;
  numExterior: string;
  numInterior: string;
  avatarUrl: string;
}

interface WorkspaceDoc {
  id: string;
  title?: string;
  nombre?: string;
  estado?: string;
  status?: string;
  created_at: string;
  isOwner: boolean;
}

interface VerificationStatus {
  email_verified: boolean;
  email_verified_at: string | null;
  phone_verified: boolean;
  phone_verified_at: string | null;
  phone_number: string | null;
  biometric_verified: boolean;
  biometric_verified_at: string | null;
  biometric_source: string | null;
  verification_steps_completed: number;
  all_verified: boolean;
}

interface UserSession {
  id: string;
  device_name: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  ip_address: string | null;
  location: string | null;
  is_current: boolean;
  last_active_at: string;
  created_at: string;
}

interface LoginActivity {
  id: string;
  event_type: string | null;
  device_name: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  ip_address: string | null;
  location: string | null;
  status: string;
  created_at: string;
  // access_logs specific fields
  auth_method: string | null;
  operating_system: string | null;
  city: string | null;
  country: string | null;
  login_success: boolean | null;
  accessed_at: string | null;
}

interface WebAuthnCredential {
  id: string;
  device_name: string;
  device_type: string | null;
  device_category: string | null;
  os: string | null;
  browser: string | null;
  registered_from: string | null;
  created_at: string;
  last_used_at: string | null;
  is_active: boolean;
}

// ─── e.Firma Types ───────────────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIMENES_FISCALES = [
  'Sueldos y Salarios e Ingresos Asimilados a Salarios',
  'Actividades Empresariales y Profesionales',
  'Régimen de Incorporación Fiscal',
  'Arrendamiento',
  'Régimen Simplificado de Confianza',
  'Dividendos (socios y accionistas)',
  'Intereses',
  'Sin obligaciones fiscales',
  'Sociedades Cooperativas de Producción',
  'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
  'Opcional para Grupos de Sociedades',
  'Coordinados',
  'Hidrocarburos',
  'Enajenación de Bienes',
  'Ingresos por Obtención de Premios',
  'Demás Ingresos',
  'Residentes en el Extranjero sin Establecimiento Permanente en México',
  'Ingresos por Dividendos (personas morales)',
  'Personas Morales con Fines no Lucrativos',
  'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
];

const sidebarItems = [
  { id: 'informacion-personal', label: 'Información Personal', icon: User },
  { id: 'espacios-trabajo', label: 'Espacios de Trabajo', icon: Building2 },
  { id: 'verificacion', label: 'Verificación', icon: ShieldCheck },
  { id: 'proteccion-acceso', label: 'Protección de Acceso', icon: Lock },
  { id: 'firmas', label: 'Firmas', icon: PenTool },
  { id: 'seguridad', label: 'Seguridad', icon: Shield },
  { id: 'mi-expediente', label: 'Mi Expediente', icon: FolderOpen },
  { id: 'privacidad', label: 'Privacidad', icon: Lock },
];

const COPOMEX_TOKEN = '076eac35-f150-43e8-88ca-21f2cb8d50cd';

// ─── Parse CER file ───────────────────────────────────────────────────────────

async function parseCerFile(file: File): Promise<{
  rfc: string;
  curp: string;
  serial: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  sha256: string;
  base64: string;
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
          if (/^\d{20}$/.test(serialHex)) noCertificado = serialHex;
          else noCertificado = '';
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
        const { rfc, curp, subject } = extractRfcCurpFromDN(subjectBytes);
        resolve({ rfc, curp, serial: noCertificado, subject, issuer, notBefore, notAfter, sha256, base64 });
      } catch { resolve(null); }
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

// Decode OID bytes to dotted-decimal string
function decodeOidBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const parts: number[] = [];
  parts.push(Math.floor(bytes[0] / 40));
  parts.push(bytes[0] % 40);
  let val = 0;
  for (let i = 1; i < bytes.length; i++) {
    val = (val << 7) | (bytes[i] & 0x7f);
    if ((bytes[i] & 0x80) === 0) { parts.push(val); val = 0; }
  }
  return parts.join('.');
}

// Extract DN as { oidMap, flatStr } — oidMap keys are dotted OID strings
function extractDNParsed(bytes: Uint8Array): { oidMap: Record<string, string>; flatStr: string } {
  const oidMap: Record<string, string> = {};
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
      let oidStr = '';
      if (bytes[i] === 0x06) {
        i++;
        const oidLen = derReadLen(bytes, i);
        i += derLenSize(bytes, i) + 1;
        oidStr = decodeOidBytes(bytes.slice(i, i + oidLen));
        i += oidLen;
      }
      if (i < seqEnd) {
        i++; // skip string tag (0x13 PrintableString, 0x0C UTF8String, 0x16 IA5String, 0x1E BMPString, etc.)
        const valLen = derReadLen(bytes, i);
        i += derLenSize(bytes, i) + 1;
        let val = '';
        for (let j = i; j < i + valLen; j++) { if (bytes[j] >= 0x20) val += String.fromCharCode(bytes[j]); }
        val = val.trim();
        if (val) {
          parts.push(val);
          if (oidStr) oidMap[oidStr] = val;
        }
        i += valLen;
      }
      i = seqEnd;
    }
    i = setEnd;
  }
  return { oidMap, flatStr: parts.join(', ') };
}

function extractDNString(bytes: Uint8Array): string {
  return extractDNParsed(bytes).flatStr;
}

// Extract RFC and CURP from a parsed DN.
// SAT e.firma stores "RFC / CURP / NOMBRE" in OID 2.5.4.45 (x500UniqueIdentifier).
// Falls back to regex scan of the full flat string.
function extractRfcCurpFromDN(bytes: Uint8Array): { rfc: string; curp: string; subject: string } {
  const { oidMap, flatStr } = extractDNParsed(bytes);
  const subject = flatStr;

  // OID 2.5.4.45 = x500UniqueIdentifier — SAT encodes "RFC / CURP / NOMBRE" here
  const uniqueId = (oidMap['2.5.4.45'] || '').toUpperCase().trim();
  if (uniqueId) {
    // Format: "RFCVALUE / CURPVALUE / NOMBRE" or "RFCVALUE/CURPVALUE/NOMBRE"
    const parts = uniqueId.split('/').map(p => p.trim());
    const rfcCandidate = parts[0] || '';
    const curpCandidate = parts[1] || '';
    const rfcOk = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/.test(rfcCandidate);
    const curpOk = /^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9]{2}[0-9]$/.test(curpCandidate);
    if (rfcOk || curpOk) {
      return { rfc: rfcOk ? rfcCandidate : '', curp: curpOk ? curpCandidate : '', subject };
    }
  }

  // Fallback: regex scan of the full subject string (uppercase for safety)
  const upper = subject.toUpperCase();
  // CURP first (18 chars) to avoid RFC regex matching inside CURP
  const curpMatch = upper.match(/\b([A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9]{2}[0-9])\b/);
  const curp = curpMatch ? curpMatch[1] : '';
  // RFC: 12 chars (moral) or 13 chars (física), avoid matching inside CURP
  const rfcMatch = upper.replace(curp, '').match(/\b([A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3})\b/);
  const rfc = rfcMatch ? rfcMatch[1] : '';
  return { rfc, curp, subject };
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

// ─── File Upload Zone ─────────────────────────────────────────────────────────

function FileUploadZone({ label, accept, file, onFile, icon }: {
  label: string; accept: string; file: File | null;
  onFile: (f: File) => void; icon: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all duration-200 w-full ${
        file ? 'border-emerald-400 bg-emerald-50' : 'border-border hover:border-primary/50 hover:bg-primary/5 bg-muted/30'
      }`}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }} />
      {file ? (
        <>
          <CheckCircle size={22} className="text-emerald-500" />
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

// ─── e.Firma Validation Result Card ──────────────────────────────────────────

function EfirmaValidationCard({
  result, onConfirm, isExpired, isLoading, actionError,
}: {
  result: EfirmaValidationResult;
  onConfirm: () => void;
  isExpired: boolean;
  isLoading?: boolean;
  actionError?: string | null;
}) {
  const { serialResult, curpResult } = result;
  const isActive = serialResult?.estado === 'Activo';
  const isMoralPerson = result.rfc ? result.rfc.replace(/\s/g, '').length === 12 : false;
  const certTipo = (serialResult?.tipo || '').toUpperCase();
  const isNotFiel = certTipo !== '' && certTipo !== 'FIEL';
  const hasBlockingError = isMoralPerson || isNotFiel;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <User size={24} className="text-primary" />
            Validación Exitosa
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Certificado validado correctamente ante el SAT y RENAPO.</p>
        </div>
      </div>

      {isExpired && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-3">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-600">La vigencia de tu e.Firma expiró el {serialResult?.fecha_fin || result.vigenciaFin || '—'}.</p>
        </div>
      )}
      {isMoralPerson && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-3">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-600">El RFC detectado ({result.rfc}) corresponde a persona moral. Solo se acepta e.Firma de persona física.</p>
        </div>
      )}
      {isNotFiel && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-3">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-600">El certificado es de tipo <strong>{serialResult?.tipo}</strong>. Solo se acepta e.Firma tipo FIEL.</p>
        </div>
      )}

      {curpResult && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="bg-muted/40 px-4 py-2.5 border-b border-border">
            <p className="text-sm font-bold text-foreground">Información Personal</p>
          </div>
          <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">NOMBRE</p>
              <p className="text-sm font-semibold text-foreground">{curpResult.nombre || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">APELLIDO PATERNO</p>
              <p className="text-sm font-semibold text-foreground">{curpResult.apellidoPaterno || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">APELLIDO MATERNO</p>
              <p className="text-sm font-semibold text-foreground">{curpResult.apellidoMaterno || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">CURP</p>
              <p className="text-sm font-semibold text-foreground font-mono">{curpResult.curp || result.curp || '—'}</p>
            </div>
          </div>
        </div>
      )}

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-muted/40 px-4 py-2.5 border-b border-border">
          <p className="text-sm font-bold text-foreground">Información del Certificado</p>
        </div>
        <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">RFC</p>
            <p className="text-sm font-semibold text-foreground font-mono">{result.rfc || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">ESTADO</p>
            <p className={`text-sm font-bold ${isExpired ? 'text-red-500' : isActive ? 'text-emerald-600' : 'text-red-500'}`}>
              {isExpired ? 'Vencido' : (serialResult?.estado || '—')}
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">NÚMERO DE SERIE</p>
            <p className="text-sm font-semibold text-foreground font-mono break-all">{result.serial || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">TIPO</p>
            <p className="text-sm font-semibold text-foreground">{serialResult?.tipo || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">FIN VIGENCIA</p>
            <p className={`text-sm font-semibold ${isExpired ? 'text-red-500' : 'text-foreground'}`}>
              {serialResult?.fecha_fin || result.vigenciaFin || '—'}
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={onConfirm}
        disabled={isExpired || hasBlockingError || isLoading}
        className={`w-full py-2.5 rounded-lg text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
          isExpired || hasBlockingError || isLoading
            ? 'bg-muted-foreground/40 cursor-not-allowed opacity-50'
            : 'bg-emerald-500 hover:bg-emerald-600'
        }`}
      >
        {isLoading ? <><Loader2 size={15} className="animate-spin" /> Guardando...</> : <><CheckCircle size={15} />Vincular e.firma a mi perfil</>}
      </button>
      {actionError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-600">{actionError}</p>
        </div>
      )}
    </div>
  );
}

// ─── e.Firma Modal ────────────────────────────────────────────────────────────

function EfirmaModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (result: EfirmaValidationResult) => Promise<void>;
}) {
  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [efirmaPassword, setEfirmaPassword] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validationResult, setValidationResult] = useState<EfirmaValidationResult | null>(null);
  const [efirmaError, setEfirmaError] = useState('');
  const [saveError, setSaveError] = useState('');

  const handleValidate = async () => {
    if (!cerFile || !keyFile || !efirmaPassword) return;
    setIsValidating(true);
    setEfirmaError('');
    setValidationResult(null);

    try {
      // Step 1: Validate .key password
      const keyFormData = new FormData();
      keyFormData.append('keyFile', keyFile);
      keyFormData.append('password', efirmaPassword);

      let keyValidationRes: Response;
      try {
        keyValidationRes = await fetch('/api/efirma/validate-key', { method: 'POST', body: keyFormData });
      } catch {
        setEfirmaError('Error de red al validar la llave privada. Intenta nuevamente.');
        setIsValidating(false);
        return;
      }

      const keyValidation = await keyValidationRes.json();
      if (!keyValidation.success || !keyValidation.isPasswordValid) {
        let msg = 'La contraseña es incorrecta o la llave privada no es válida.';
        if (keyValidation.errorCode === 'CORRUPTED_FILE') msg = 'El archivo .key está corrupto o dañado.';
        else if (keyValidation.errorCode === 'UNSUPPORTED_FORMAT') msg = 'El formato de la llave privada no es compatible.';
        else if (keyValidation.errorCode === 'PARSE_ERROR') msg = 'No se pudo procesar el archivo .key.';
        else if (keyValidation.errorCode === 'EMPTY_PASSWORD') msg = 'La contraseña no puede estar vacía.';
        else if (keyValidation.errorCode === 'INVALID_FILE_TYPE') msg = 'El archivo seleccionado no es un archivo .key válido.';
        setEfirmaError(msg);
        setIsValidating(false);
        return;
      }

      // Step 2: Parse .cer file
      const parsed = await parseCerFile(cerFile);
      const rfc = parsed?.rfc || '';
      const curp = parsed?.curp || '';
      const serial = parsed?.serial || '';
      const notAfter = parsed?.notAfter || '';

      if (!serial) {
        setEfirmaError('No se pudo extraer el número de serie del certificado. Verifica que el archivo .cer sea válido.');
        setIsValidating(false);
        return;
      }

      // Step 3: Check expiry
      let isCertExpired = false;
      if (notAfter) {
        try {
          const expiryDate = new Date(notAfter.replace(' ', 'T') + 'Z');
          isCertExpired = expiryDate < new Date();
        } catch { /* ignore */ }
      }

      let serialResult: NubariumSerialResult | null = null;
      let curpResult: NubariumCurpResult | null = null;

      // Step 4: Validate serial with Nubarium
      // Use rfc if available, fall back to curp (both are valid identifiers per Nubarium API)
      if ((rfc || curp) && serial) {
        try {
          const identifierPayload = rfc
            ? { rfc, serial }
            : { curp, serial };
          const serialRes = await fetch('/api/nubarium/validar-serial', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(identifierPayload),
          });
          serialResult = await serialRes.json();
          if (serialResult?.fecha_fin) {
            try {
              const nubariumExpiry = new Date(serialResult.fecha_fin.replace(' ', 'T'));
              if (nubariumExpiry < new Date()) isCertExpired = true;
            } catch { /* ignore */ }
          }
        } catch { /* continue */ }
      }

      // Step 5: Validate CURP with Nubarium
      if (curp) {
        try {
          const curpRes = await fetch('/api/nubarium/validar-curp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ curp }),
          });
          curpResult = await curpRes.json();
        } catch { /* continue */ }
      }

      const nombre = curpResult?.nombre || '';
      const apellidoPaterno = curpResult?.apellidoPaterno || '';
      const apellidoMaterno = curpResult?.apellidoMaterno || '';
      const vigenciaFin = serialResult?.fecha_fin || notAfter || '';

      setValidationResult({
        serialResult,
        curpResult,
        rfc,
        curp: curpResult?.curp || curp,
        serial,
        nombre,
        apellidoPaterno,
        apellidoMaterno,
        vigenciaFin,
        isExpired: isCertExpired,
      });
    } catch {
      setEfirmaError('Error al procesar el certificado. Verifica que los archivos sean válidos.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleConfirm = async () => {
    if (!validationResult) return;
    setIsSaving(true);
    setSaveError('');
    try {
      await onSave(validationResult);
      onClose();
    } catch (err: any) {
      setSaveError(err?.message || 'Error al guardar la e.firma.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <FileKey size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-700 text-foreground">Vincular e.firma (SAT)</h2>
              <p className="text-xs text-muted-foreground">Sube tus archivos .cer y .key del SAT</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {validationResult ? (
            <EfirmaValidationCard
              result={validationResult}
              onConfirm={handleConfirm}
              isExpired={validationResult.isExpired}
              isLoading={isSaving}
              actionError={saveError}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <FileUploadZone
                label="Certificado (.cer)"
                accept=".cer"
                file={cerFile}
                onFile={setCerFile}
                icon={<Upload size={18} />}
              />
              <FileUploadZone
                label="Llave privada (.key)"
                accept=".key"
                file={keyFile}
                onFile={setKeyFile}
                icon={<Lock size={18} />}
              />
              <div>
                <label className="block text-xs font-600 text-muted-foreground mb-1.5">
                  Contraseña de la llave privada
                </label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="password"
                    placeholder="Contraseña e.Firma"
                    value={efirmaPassword}
                    onChange={(e) => setEfirmaPassword(e.target.value)}
                    className={`w-full pl-8 pr-4 py-2.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors ${
                      efirmaError ? 'border-red-400' : 'border-border'
                    }`}
                  />
                </div>
              </div>
              {efirmaError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{efirmaError}</p>
                </div>
              )}
              <button
                onClick={handleValidate}
                disabled={!cerFile || !keyFile || !efirmaPassword || isValidating}
                className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                {isValidating ? (
                  <><RefreshCw size={14} className="animate-spin" /> Validando...</>
                ) : (
                  <><Shield size={14} /> Validar e.Firma</>
                )}
              </button>
              <div className="flex items-start gap-3 px-3 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                <ShieldCheck size={14} className="text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  La e.firma es emitida por el SAT y tiene la misma validez legal que una firma autógrafa.
                  Requiere tu archivo <strong>.cer</strong>, <strong>.key</strong> y contraseña de clave privada.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer — only show when not yet validated */}
        {!validationResult && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-gray-50 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-foreground hover:bg-gray-100 transition-colors font-500 rounded-lg"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Join Workspace Modal ─────────────────────────────────────────────────────

function JoinWorkspaceModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { refreshWorkspaces } = useWorkspace();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleJoin = async () => {
    if (!code.trim() || !user) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const supabase = createClient();
      const trimmedCode = code.trim();
      const { data: workspaces, error: wsErr } = await supabase
        .from('workspaces')
        .select('id, name, workspace_type')
        .or(`invite_code.eq.${trimmedCode},name.ilike.${trimmedCode}`);
      const ws = workspaces && workspaces.length > 0 ? workspaces[0] : null;
      if (wsErr || !ws) { setError('No se encontró ningún espacio de trabajo con ese código o nombre.'); return; }
      if (ws.workspace_type === 'personal') { setError('No puedes unirte a un espacio de trabajo personal.'); return; }
      const { data: existing } = await supabase.from('workspace_members').select('id').eq('workspace_id', ws.id).eq('user_id', user.id).maybeSingle();
      if (existing) { setError('Ya eres miembro de este espacio de trabajo.'); return; }
      const { error: joinErr } = await supabase.from('workspace_members').insert({ workspace_id: ws.id, user_id: user.id, role: 'member' });
      if (joinErr) throw joinErr;
      setSuccess(`¡Te has unido a "${ws.name}" exitosamente!`);
      await refreshWorkspaces();
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      setError(err?.message || 'Error al unirse al espacio de trabajo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Building2 size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-700 text-foreground">Unirse a espacio de trabajo</h2>
              <p className="text-xs text-muted-foreground">Ingresa el código de invitación</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground leading-relaxed">Solicita el código de invitación al administrador del espacio de trabajo al que deseas unirte.</p>
          <div>
            <label className="block text-xs font-600 text-muted-foreground mb-1.5">Código de invitación o nombre del espacio</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="Ej: EMPRESA-2024 o nombre del espacio"
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm text-foreground bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors placeholder:text-gray-400"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={14} />{error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
              <CheckCircle size={14} />{success}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-foreground hover:bg-gray-100 transition-colors font-500 rounded-lg">Cancelar</button>
          <button
            onClick={handleJoin}
            disabled={loading || !code.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Unirse
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Signature Canvas Modal ───────────────────────────────────────────────────

function SignatureCanvasModal({ onClose, onSave }: { onClose: () => void; onSave: (dataUrl: string) => void; }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDrawing(true);
    setHasDrawn(true);
    lastPos.current = getPos(e, canvas);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || !lastPos.current) return;
    let pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
  };

  const stopDraw = () => { setIsDrawing(false); lastPos.current = null; };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-700 text-foreground">Crear Firma Autógrafa</h2>
            <p className="text-xs text-muted-foreground">Traza tu firma en el área de abajo</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <div className="px-6 py-5">
          <div className="border-2 border-dashed border-border rounded-xl overflow-hidden bg-gray-50 relative">
            <canvas
              ref={canvasRef}
              width={460}
              height={200}
              className="w-full touch-none cursor-crosshair"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={stopDraw}
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-muted-foreground/60">Traza tu firma aquí</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between mt-3">
            <button onClick={clearCanvas} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <RotateCcw size={13} />Limpiar
            </button>
            <p className="text-xs text-muted-foreground">Usa el mouse o toca la pantalla para trazar</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-foreground hover:bg-gray-100 transition-colors font-500 rounded-lg">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={!hasDrawn}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            <Save size={14} />Guardar Firma
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TOTP Badge ───────────────────────────────────────────────────────────────

function TotpBadge() {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const supabase = createClient();

  React.useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('user_totp_settings')
          .select('is_enabled')
          .eq('user_id', user.id)
          .eq('is_enabled', true)
          .maybeSingle();
        setEnabled(!!data);
      } catch {
        setEnabled(false);
      }
    })();
  }, []);

  if (enabled === null) return null;
  return enabled ? (
    <span className="flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
      <CheckCircle size={11} />Activa
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
      <Clock size={11} />No configurada
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MiPerfilPage() {
  const { user } = useAuth();
  const { workspaces, activeWorkspace, setActiveWorkspace, refreshWorkspaces } = useWorkspace();
  const [activeSection, setActiveSection] = useState('informacion-personal');

  // Profile state
  const [profile, setProfile] = useState<ProfileData>({
    nombre: '', apellidoPaterno: '', apellidoMaterno: '', tipoPersona: '', curp: '',
    correo: '', telefono: '', rfc: '', regimenFiscal: '', codigoPostal: '', estado: '',
    municipio: '', colonia: '', localidad: '', calle: '', numExterior: '', numInterior: '', avatarUrl: '',
  });

  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Profile edit mode state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [rfcValidating, setRfcValidating] = useState(false);
  const [rfcError, setRfcError] = useState('');
  const [rfcValidated, setRfcValidated] = useState(false);
  const [rfcOriginal, setRfcOriginal] = useState('');

  // Avatar upload state
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Copomex state
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState('');
  const [colonias, setColonias] = useState<string[]>([]);
  const cpDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Workspace docs state
  const [workspaceDocs, setWorkspaceDocs] = useState<WorkspaceDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  // Workspace members state
  const [workspaceMembers, setWorkspaceMembers] = useState<{ id: string; user_id: string; role: string; email?: string; nombre?: string; avatarUrl?: string }[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Join workspace modal
  const [showJoinModal, setShowJoinModal] = useState(false);

  // Workspace inner tab: 'mis-espacios' | 'unirse'
  const [wsInnerTab, setWsInnerTab] = useState<'mis-espacios' | 'unirse'>('mis-espacios');

  // Workspace invitations state
  const [wsInvitations, setWsInvitations] = useState<{ id: string; workspace_id: string; workspace_name: string; owner_name: string; owner_email: string; invited_at: string }[]>([]);
  const [wsInvitationsLoading, setWsInvitationsLoading] = useState(false);
  const [wsInvitationAccepting, setWsInvitationAccepting] = useState<string | null>(null);
  const [wsInvitationError, setWsInvitationError] = useState('');
  const [wsJoinCode, setWsJoinCode] = useState('');
  const [wsJoinLoading, setWsJoinLoading] = useState(false);
  const [wsJoinError, setWsJoinError] = useState('');
  const [wsJoinSuccess, setWsJoinSuccess] = useState('');

  // Verification state
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationAction, setVerificationAction] = useState<string | null>(null);

  // TOTP state
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpPaired, setTotpPaired] = useState(false);
  const [totpLoading, setTotpLoading] = useState(false);
  const [showTotpModal, setShowTotpModal] = useState(false);
  const [showTotpDisableModal, setShowTotpDisableModal] = useState(false);
  const [totpDisablePassword, setTotpDisablePassword] = useState('');
  const [totpDisableShowPwd, setTotpDisableShowPwd] = useState(false);
  const [totpDisableLoading, setTotpDisableLoading] = useState(false);
  const [totpDisableError, setTotpDisableError] = useState<string | null>(null);
  const [totpSuccessMsg, setTotpSuccessMsg] = useState<string | null>(null);
  const [totpPurposes, setTotpPurposes] = useState<Array<'m2fa' | 'firma'>>(['m2fa']);
  const [totpDeviceInfo, setTotpDeviceInfo] = useState<{ deviceName: string; configuredAt: string | null; appType?: string } | null>(null);

  // WebAuthn device registration state
  const [showWebAuthnModal, setShowWebAuthnModal] = useState(false);
  const [webAuthnModalTab, setWebAuthnModalTab] = useState<'desktop' | 'qr'>('desktop');
  const [webAuthnDeviceName, setWebAuthnDeviceName] = useState('');
  const [webAuthnLoading, setWebAuthnLoading] = useState(false);
  const [webAuthnError, setWebAuthnError] = useState<string | null>(null);
  const [webAuthnSuccess, setWebAuthnSuccess] = useState<string | null>(null);
  const [webAuthnQrData, setWebAuthnQrData] = useState<{ qrUrl: string; token: string; expiresIn: number } | null>(null);
  const [webAuthnQrSeconds, setWebAuthnQrSeconds] = useState(300);
  const [webAuthnQrStatus, setWebAuthnQrStatus] = useState<'loading' | 'active' | 'completed' | 'expired'>('loading');
  const webAuthnQrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const webAuthnQrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [webAuthnDevices, setWebAuthnDevices] = useState<WebAuthnCredential[]>([]);
  const [webAuthnDevicesLoading, setWebAuthnDevicesLoading] = useState(false);
  const [webAuthnRevoking, setWebAuthnRevoking] = useState<string | null>(null);

  // Enrollment QR state (for biometric verification in mi-perfil)
  const [showEnrollmentQrModal, setShowEnrollmentQrModal] = useState(false);
  const [enrollQrUrl, setEnrollQrUrl] = useState<string | null>(null);
  const [enrollQrLoading, setEnrollQrLoading] = useState(false);
  const [enrollQrExpired, setEnrollQrExpired] = useState(false);
  const [enrollQrExpiresAt, setEnrollQrExpiresAt] = useState<Date | null>(null);
  const [enrollQrTimeLeft, setEnrollQrTimeLeft] = useState<number>(600);
  const [enrollQrError, setEnrollQrError] = useState<string | null>(null);
  const [enrollBiometricCompleted, setEnrollBiometricCompleted] = useState(false);
  const enrollSessionIdRef = useRef<string>('');
  const enrollRealtimeChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
  const enrollPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Firmas state
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [showSignatureFullscreen, setShowSignatureFullscreen] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  // Signature metadata (read-only)
  const [firmaCreatedAt, setFirmaCreatedAt] = useState<string | null>(null);
  const [firmaLastUsed, setFirmaLastUsed] = useState<string | null>(null);
  const [firmaHash, setFirmaHash] = useState<string | null>(null);
  const [firmaLinkedDocs, setFirmaLinkedDocs] = useState<{ id: string; nombre: string; created_at: string }[]>([]);
  const [firmaMetaLoading, setFirmaMetaLoading] = useState(false);

  // e.Firma state
  const [efirmaLinked, setEfirmaLinked] = useState(false);
  const [efirmaData, setEfirmaData] = useState<{
    rfc: string | null;
    serial: string | null;
    nombre: string | null;
    vigenciaFin: string | null;
    linkedAt: string | null;
  } | null>(null);
  const [showEfirmaModal, setShowEfirmaModal] = useState(false);
  const [efirmaUnlinking, setEfirmaUnlinking] = useState(false);
  const [efirmaStampStyle, setEfirmaStampStyle] = useState<string>('EC1');
  const [autografaStampStyle, setAutografaStampStyle] = useState<string>('AC1');
  const [clickSignStampStyle, setClickSignStampStyle] = useState<string>('CC1');
  const [firmasTab, setFirmasTab] = useState<'autografa' | 'efirma' | 'clicksign'>('autografa');

  // Load profile from Supabase on mount
  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (data) {
        const tipoPersona =
          data.personalidad_juridica === 'moral' ? 'Persona Moral'
            : data.personalidad_juridica === 'fisica'? 'Persona Física' : data.personalidad_juridica ? data.personalidad_juridica :'Persona Física';

        setProfile({
          nombre: data.nombre || '',
          apellidoPaterno: data.apellido_paterno || '',
          apellidoMaterno: data.apellido_materno || '',
          tipoPersona,
          curp: data.curp || '',
          correo: user.email || data.email || '',
          telefono: data.telefono || data.phone || '',
          rfc: data.rfc || '',
          regimenFiscal: data.regimen_fiscal || '',
          codigoPostal: data.codigo_postal || '',
          estado: data.estado || '',
          municipio: data.municipio || '',
          colonia: data.colonia || '',
          localidad: data.localidad || '',
          calle: data.calle || '',
          numExterior: data.num_exterior || '',
          numInterior: data.num_interior || '',
          avatarUrl: data.avatar_url || '',
        });
        // Track original RFC to know if it was pre-filled
        setRfcOriginal(data.rfc || '');
        if (data.rfc) setRfcValidated(true);
        if (data.rfc) setRfcValidating(false);

        // Load saved signature
        if (data.firma_autografa_url) {
          setSavedSignature(data.firma_autografa_url);
          setFirmaCreatedAt(data.firma_autografa_created_at || null);
          setFirmaLastUsed(data.firma_autografa_last_used || null);
        }

        // Load e.firma data
        if (data.efirma_serial) {
          setEfirmaLinked(true);
          setEfirmaData({
            rfc: data.efirma_rfc || null,
            serial: data.efirma_serial || null,
            nombre: data.efirma_nombre || null,
            vigenciaFin: data.efirma_vigencia_fin || null,
            linkedAt: data.efirma_linked_at || null,
          });
        }
        // Load stamp style
        if (data.efirma_stamp_style) {
          setEfirmaStampStyle(data.efirma_stamp_style);
        }
        // Load autógrafa stamp style
        if (data.autografa_stamp_style) {
          setAutografaStampStyle(data.autografa_stamp_style);
        }
        // Load click & sign stamp style
        if (data.click_sign_stamp_style) {
          setClickSignStampStyle(data.click_sign_stamp_style);
        }

        if (data.codigo_postal && data.codigo_postal.length === 5) {
          fetchCopomex(data.codigo_postal, data.colonia || '');
        }
      } else {
        // No profile row yet — at least populate email from auth
        setProfile((prev) => ({ ...prev, correo: user.email || '' }));
      }
    })();
  }, [user?.id]);

  // Load verification status
  useEffect(() => {
    if (!user || (activeSection !== 'verificacion' && activeSection !== 'proteccion-acceso')) return;
    if (activeSection === 'verificacion') {
      loadVerificationStatus();
    }
    loadTotpStatus();
    fetchWebAuthnDevices();
  }, [user, activeSection]);

  // Load TOTP status on mount as soon as user is available (so badge is correct on any section)
  useEffect(() => {
    if (!user) return;
    loadTotpStatus();
  }, [user?.id]);

  // Load signature evidence metadata when firmas section is active
  useEffect(() => {
    if (!user || activeSection !== 'firmas' || !savedSignature) return;
    (async () => {
      setFirmaMetaLoading(true);
      try {
        const supabase = createClient();
        // Get the most recent signature evidence for this user
        const { data: evidenceData } = await supabase
          .from('signature_evidence')
          .select('combined_sha256, image_sha256, signature_hash, document_id, captured_at')
          .eq('captured_by', user.id)
          .eq('is_voided', false)
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (evidenceData) {
          const hash = evidenceData.combined_sha256 || evidenceData.signature_hash || evidenceData.image_sha256 || null;
          setFirmaHash(hash);
        }

        // Get all documents linked to this user's signatures
        const { data: allEvidence } = await supabase
          .from('signature_evidence')
          .select('document_id, captured_at')
          .eq('captured_by', user.id)
          .eq('is_voided', false)
          .not('document_id', 'is', null)
          .order('captured_at', { ascending: false });

        if (allEvidence && allEvidence.length > 0) {
          const docIds = [...new Set(allEvidence.map((e: any) => e.document_id).filter(Boolean))];
          if (docIds.length > 0) {
            const { data: docsData } = await supabase
              .from('documentos')
              .select('id, nombre, created_at')
              .in('id', docIds);
            if (docsData) {
              setFirmaLinkedDocs(docsData.map((d: any) => ({ id: d.id, nombre: d.nombre || 'Documento sin nombre', created_at: d.created_at })));
            }
          }
        }
      } catch { /* silent */ } finally {
        setFirmaMetaLoading(false);
      }
    })();
  }, [user, activeSection, savedSignature]);

  // Real-time subscription for verification status
  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const channel = supabase
      .channel('verification-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_verification_status', filter: `user_id=eq.${user.id}` }, () => { loadVerificationStatus(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const loadVerificationStatus = async () => {
    if (!user) return;
    setVerificationLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.from('user_verification_status').select('*').eq('user_id', user.id).single();
      if (data) {
        setVerificationStatus(data as VerificationStatus);
      } else {
        await supabase.from('user_verification_status').insert({ user_id: user.id });
        setVerificationStatus({
          email_verified: false, email_verified_at: null, phone_verified: false,
          phone_verified_at: null, phone_number: null, biometric_verified: false,
          biometric_verified_at: null, biometric_source: null, verification_steps_completed: 0, all_verified: false,
        });
      }
    } catch { /* silent */ } finally { setVerificationLoading(false); }
  };

  // ── Enrollment QR timer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enrollQrExpiresAt || enrollQrExpired || enrollBiometricCompleted) return;
    const interval = setInterval(() => {
      const diffMs = enrollQrExpiresAt.getTime() - Date.now();
      if (isNaN(diffMs)) { setEnrollQrExpired(true); clearInterval(interval); return; }
      const diff = Math.max(0, Math.floor(diffMs / 1000));
      setEnrollQrTimeLeft(diff);
      if (diff === 0) { setEnrollQrExpired(true); clearInterval(interval); }
    }, 1000);
    return () => clearInterval(interval);
  }, [enrollQrExpiresAt, enrollQrExpired, enrollBiometricCompleted]);

  // Cleanup enrollment realtime on unmount
  useEffect(() => {
    return () => {
      const supabase = createClient();
      if (enrollRealtimeChannelRef.current) supabase.removeChannel(enrollRealtimeChannelRef.current);
      if (enrollPollingRef.current) clearInterval(enrollPollingRef.current);
    };
  }, []);

  const generateEnrollQrToken = useCallback(async () => {
    const supabase = createClient();
    if (enrollRealtimeChannelRef.current) { supabase.removeChannel(enrollRealtimeChannelRef.current); enrollRealtimeChannelRef.current = null; }
    if (enrollPollingRef.current) { clearInterval(enrollPollingRef.current); enrollPollingRef.current = null; }

    setEnrollQrLoading(true);
    setEnrollQrExpired(false);
    setEnrollQrUrl(null);
    setEnrollQrTimeLeft(600);
    setEnrollQrError(null);
    setEnrollBiometricCompleted(false);

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    enrollSessionIdRef.current = sessionId;

    try {
      const res = await fetch('/api/enrollment/create-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const result = await res.json();
      if (!result.success) { setEnrollQrError(result.error || 'Error al generar el código QR.'); return; }

      setEnrollQrUrl(result.enrollmentUrl);
      let expiresAtDate: Date;
      try {
        const rawExpiry: string = result.expiresAt;
        const normalized = rawExpiry.replace(' ', 'T').replace(/([^Z])$/, '$1Z');
        const parsed = new Date(normalized);
        expiresAtDate = isNaN(parsed.getTime()) ? new Date(Date.now() + 10 * 60 * 1000) : parsed;
      } catch { expiresAtDate = new Date(Date.now() + 10 * 60 * 1000); }
      setEnrollQrExpiresAt(expiresAtDate);
      setEnrollQrTimeLeft(600);

      let handled = false;
      const handleComplete = async () => {
        if (handled) return;
        handled = true;
        if (enrollRealtimeChannelRef.current) { supabase.removeChannel(enrollRealtimeChannelRef.current); enrollRealtimeChannelRef.current = null; }
        if (enrollPollingRef.current) { clearInterval(enrollPollingRef.current); enrollPollingRef.current = null; }
        if (user) {
          const now = new Date().toISOString();
          await supabase.from('user_verification_status').update({ biometric_verified: true, biometric_verified_at: now, biometric_source: 'enrollment' }).eq('user_id', user.id);
        }
        setEnrollBiometricCompleted(true);
        await loadVerificationStatus();
      };

      const ch = supabase.channel(`perfil_enroll_${sessionId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'enrollment_results', filter: `session_id=eq.${sessionId}` }, (payload) => {
          const row = payload.new as { status: string };
          if (row.status === 'completed') handleComplete();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'enrollment_tokens', filter: `token=eq.${result.token}` }, (payload) => {
          const row = payload.new as { status: string };
          if (row.status === 'completed') handleComplete();
        })
        .subscribe();
      enrollRealtimeChannelRef.current = ch;

      enrollPollingRef.current = setInterval(async () => {
        if (handled) { if (enrollPollingRef.current) clearInterval(enrollPollingRef.current); return; }
        try {
          const { data: rows } = await supabase.from('enrollment_results').select('*').eq('session_id', sessionId).eq('status', 'completed').limit(1);
          if (rows && rows.length > 0) { if (enrollPollingRef.current) clearInterval(enrollPollingRef.current); handleComplete(); }
        } catch { /* ignore */ }
      }, 3000);
    } catch { setEnrollQrError('Error de conexión. Intenta nuevamente.'); }
    finally { setEnrollQrLoading(false); }
  }, [user]);

  const parseDeviceFromUserAgent = (ua: string | null): string => {
    if (!ua) return 'Dispositivo desconocido';
    const u = ua.toLowerCase();
    if (u.includes('iphone')) return 'iPhone';
    if (u.includes('ipad')) return 'iPad';
    if (u.includes('android')) {
      const match = ua.match(/Android[^;]*;\s*([^)]+)\)/);
      if (match) return match[1].trim();
      return 'Android';
    }
    if (u.includes('macintosh') || u.includes('mac os x')) return 'Mac';
    if (u.includes('windows')) return 'Windows';
    if (u.includes('linux')) return 'Linux';
    return 'Dispositivo desconocido';
  };

  const detectAuthApp = (ua: string | null): string => {
    if (!ua) return 'App autenticadora';
    const u = ua.toLowerCase();
    if (u.includes('iphone') || u.includes('ipad')) return 'App autenticadora (iOS)';
    if (u.includes('android')) return 'App autenticadora (Android)';
    if (u.includes('mac os') || u.includes('macintosh')) return 'App autenticadora (macOS)';
    if (u.includes('linux')) return 'App autenticadora (Linux)';
    if (u.includes('windows')) return 'App autenticadora (Windows)';
    return 'App autenticadora';
  };

  const loadTotpStatus = async () => {
    if (!user) return;
    setTotpLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.from('user_totp_settings').select('is_enabled, totp_purpose, confirmed_at, secret_encrypted').eq('user_id', user.id).maybeSingle();
      if (data) {
        setTotpEnabled(!!data.is_enabled);
        setTotpPaired(!!(data.secret_encrypted && data.confirmed_at));
        if (data.totp_purpose) {
  // Support both legacy single string and new array format
  const raw = data.totp_purpose;
  if (Array.isArray(raw)) {
    setTotpPurposes(raw as Array<'m2fa' | 'firma'>);
  } else if (raw === 'both') {
    setTotpPurposes(['m2fa', 'firma']);
  } else {
    setTotpPurposes([raw as 'm2fa' | 'firma']);
  }
}
        // Fetch device info from security events
        if (data.is_enabled) {
          const { data: eventData } = await supabase
            .from('auth_security_events')
            .select('user_agent, created_at')
            .eq('user_id', user.id)
            .eq('event_type', 'TOTP_ENABLED')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (eventData) {
            setTotpDeviceInfo({
              deviceName: parseDeviceFromUserAgent(eventData.user_agent),
              configuredAt: eventData.created_at,
              appType: detectAuthApp(eventData.user_agent),
            });
          } else {
            setTotpDeviceInfo({ deviceName: 'Dispositivo desconocido', configuredAt: data.confirmed_at, appType: 'App autenticadora' });
          }
        } else {
          setTotpDeviceInfo(null);
        }
      } else {
        setTotpEnabled(false);
        setTotpPaired(false);
        setTotpDeviceInfo(null);
      }
    } catch {
      setTotpEnabled(false);
      setTotpPaired(false);
      setTotpDeviceInfo(null);
    } finally {
      setTotpLoading(false);
    }
  };

  const handleTotpDisable = async () => {
    if (!totpDisablePassword.trim()) {
      setTotpDisableError('Ingresa tu contraseña');
      return;
    }
    setTotpDisableLoading(true);
    setTotpDisableError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setTotpDisableError('Sesión no válida');
        return;
      }
      const res = await fetch('/api/auth/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ password: totpDisablePassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTotpDisableError(data.error || 'Contraseña incorrecta');
        return;
      }
      setShowTotpDisableModal(false);
      setTotpDisablePassword('');
      setTotpEnabled(false);
      setTotpPaired(false);
      setTotpDeviceInfo(null);
      setTotpSuccessMsg('Tóken Móvil desactivado correctamente.');
      setTimeout(() => setTotpSuccessMsg(null), 4000);
    } catch {
      setTotpDisableError('Error de conexión. Intenta nuevamente.');
    } finally {
      setTotpDisableLoading(false);
    }
  };

  const handleTotpPurposeChange = async (purpose: 'm2fa' | 'firma') => {
    const current = totpPurposes;
    let updated: Array<'m2fa' | 'firma'>;
    if (current.includes(purpose)) {
      if (current.length === 1) return;
      updated = current.filter(p => p !== purpose);
    } else {
      updated = [...current, purpose];
    }
    setTotpPurposes(updated);
    if (!user) return;
    try {
      const supabase = createClient();
      const dbValue = updated.length === 2 ? 'both' : updated[0];
      await supabase.from('user_totp_settings').update({ totp_purpose: dbValue }).eq('user_id', user.id);
    } catch { /* silent */ }
  };

  // Load workspace docs when workspace changes
  useEffect(() => {
    const wsId = selectedWorkspaceId || activeWorkspace?.id;
    if (!user || !wsId) return;
    loadWorkspaceDocs(wsId);
    loadWorkspaceMembers(wsId);
  }, [selectedWorkspaceId, activeWorkspace, user]);

  // Load invitations when unirse tab is active
  useEffect(() => {
    if (!user || activeSection !== 'espacios-trabajo' || wsInnerTab !== 'unirse') return;
    loadWsInvitations();
  }, [user, activeSection, wsInnerTab]);

  const loadWorkspaceDocs = async (wsId: string) => {
    if (!user) return;
    setDocsLoading(true);
    try {
      const supabase = createClient();
      const { data: ownedDocs } = await supabase.from('documentos').select('id, nombre, estado, created_at, owner_id').eq('owner_id', user.id).order('created_at', { ascending: false }).limit(100);
      const { data: wsDocs } = await supabase.from('documents').select('id, title, status, created_at, owner_id, workspace_id').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(100);
      const combined: WorkspaceDoc[] = [];
      (ownedDocs || []).forEach((d: any) => { combined.push({ id: d.id, nombre: d.nombre, estado: d.estado, created_at: d.created_at, isOwner: d.owner_id === user.id }); });
      (wsDocs || []).forEach((d: any) => { if (!combined.find((c) => c.id === d.id)) combined.push({ id: d.id, title: d.title, status: d.status, created_at: d.created_at, isOwner: d.owner_id === user.id }); });
      setWorkspaceDocs(combined);
    } catch { /* silent */ } finally { setDocsLoading(false); }
  };

  const loadWorkspaceMembers = async (wsId: string) => {
    if (!user) return;
    setMembersLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('workspace_members')
        .select('id, user_id, role')
        .eq('workspace_id', wsId);
      if (data && data.length > 0) {
        const userIds = data.map((m: any) => m.user_id);
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, nombre, apellido_paterno, correo, avatar_url')
          .in('id', userIds);
        const mapped = data.map((m: any) => {
          const p = profiles?.find((pr: any) => pr.id === m.user_id);
          return {
            id: m.id,
            user_id: m.user_id,
            role: m.role,
            email: p?.correo || '',
            nombre: p ? `${p.nombre || ''} ${p.apellido_paterno || ''}`.trim() : '',
            avatarUrl: p?.avatar_url || null,
          };
        });
        setWorkspaceMembers(mapped);
      } else {
        setWorkspaceMembers([]);
      }
    } catch { setWorkspaceMembers([]); } finally { setMembersLoading(false); }
  };

  const loadWsInvitations = async () => {
    if (!user) return;
    setWsInvitationsLoading(true);
    try {
      const supabase = createClient();
      // Look for workspace_members rows where user_id matches and role = 'invited'
      // or a dedicated invitations table if it exists. We'll check workspace_members with status='pending'
      const { data: invites } = await supabase
        .from('workspace_members')
        .select('id, workspace_id, role, created_at')
        .eq('user_id', user.id)
        .eq('role', 'invited');
      if (invites && invites.length > 0) {
        const wsIds = invites.map((i: any) => i.workspace_id);
        const { data: wsData } = await supabase
          .from('workspaces')
          .select('id, name, owner_id')
          .in('id', wsIds);
        const ownerIds = (wsData || []).map((w: any) => w.owner_id).filter(Boolean);
        let ownerProfiles: any[] = [];
        if (ownerIds.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, nombre, apellido_paterno, correo')
            .in('id', ownerIds);
          ownerProfiles = profiles || [];
        }
        const mapped = invites.map((inv: any) => {
          const ws = wsData?.find((w: any) => w.id === inv.workspace_id);
          const owner = ownerProfiles.find((p: any) => p.id === ws?.owner_id);
          return {
            id: inv.id,
            workspace_id: inv.workspace_id,
            workspace_name: ws?.name || 'Espacio desconocido',
            owner_name: owner ? `${owner.nombre || ''} ${owner.apellido_paterno || ''}`.trim() : '',
            owner_email: owner?.correo || '',
            invited_at: inv.created_at,
          };
        });
        setWsInvitations(mapped);
      } else {
        setWsInvitations([]);
      }
    } catch { setWsInvitations([]); } finally { setWsInvitationsLoading(false); }
  };

  const handleAcceptInvitation = async (invId: string, wsId: string, wsName: string) => {
    if (!user) return;
    setWsInvitationAccepting(invId);
    setWsInvitationError('');
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('workspace_members')
        .update({ role: 'member' })
        .eq('id', invId);
      if (error) throw error;
      await refreshWorkspaces();
      setWsInvitations((prev) => prev.filter((i) => i.id !== invId));
    } catch (err: any) {
      setWsInvitationError(err?.message || 'Error al aceptar la invitación.');
    } finally {
      setWsInvitationAccepting(null);
    }
  };

  const handleWsJoin = async () => {
    if (!wsJoinCode.trim() || !user) return;
    setWsJoinLoading(true);
    setWsJoinError('');
    setWsJoinSuccess('');
    try {
      const supabase = createClient();
      const trimmedCode = wsJoinCode.trim();
      const { data: wsResults } = await supabase
        .from('workspaces')
        .select('id, name, workspace_type')
        .or(`invite_code.eq.${trimmedCode},name.ilike.${trimmedCode}`);
      const ws = wsResults && wsResults.length > 0 ? wsResults[0] : null;
      if (!ws) { setWsJoinError('No se encontró ningún espacio de trabajo con ese código o nombre.'); return; }
      if (ws.workspace_type === 'personal') { setWsJoinError('No puedes unirte a un espacio de trabajo personal.'); return; }
      const { data: existing } = await supabase.from('workspace_members').select('id').eq('workspace_id', ws.id).eq('user_id', user.id).maybeSingle();
      if (existing) { setWsJoinError('Ya eres miembro de este espacio de trabajo.'); return; }
      const { error: joinErr } = await supabase.from('workspace_members').insert({ workspace_id: ws.id, user_id: user.id, role: 'member' });
      if (joinErr) throw joinErr;
      setWsJoinSuccess(`¡Te has unido a "${ws.name}" exitosamente!`);
      setWsJoinCode('');
      await refreshWorkspaces();
    } catch (err: any) {
      setWsJoinError(err?.message || 'Error al unirse al espacio de trabajo.');
    } finally {
      setWsJoinLoading(false);
    }
  };

  const fetchCopomex = async (cp: string, currentColonia?: string) => {
    if (cp.length !== 5) { setColonias([]); setCpError(''); setProfile((prev) => ({ ...prev, estado: '', municipio: '' })); return; }
    setCpLoading(true);
    setCpError('');
    try {
      const res = await fetch(`https://api.copomex.com/query/info_cp/${cp}?token=${COPOMEX_TOKEN}`);
      const data: ColoniaResponse[] = await res.json();
      if (!Array.isArray(data) || data.length === 0 || data[0]?.error) { setCpError('Código postal no encontrado'); setColonias([]); setProfile((prev) => ({ ...prev, estado: '', municipio: '' })); return; }
      const first = data[0].response;
      const coloniasList = data.map((item) => item.response.asentamiento);
      setColonias(coloniasList);
      setProfile((prev) => ({
        ...prev, estado: first.estado, municipio: first.municipio, localidad: first.ciudad || first.municipio,
        colonia: currentColonia && coloniasList.includes(currentColonia) ? currentColonia : coloniasList[0] || '',
      }));
    } catch { setCpError('Error al consultar el código postal'); setColonias([]); } finally { setCpLoading(false); }
  };

  const handleCpChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 5);
    setProfile((prev) => ({ ...prev, codigoPostal: digits }));
    if (cpDebounceRef.current) clearTimeout(cpDebounceRef.current);
    cpDebounceRef.current = setTimeout(() => { fetchCopomex(digits); }, 600);
  };

  const handleChange = (field: keyof ProfileData, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  // ─── RFC Validation ───────────────────────────────────────────────────────

  const handleRfcChange = (value: string) => {
    const upper = value.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '').slice(0, 13);
    setProfile((prev) => ({ ...prev, rfc: upper }));
    setRfcError('');
    setRfcValidated(false);
  };

  const handleValidateRfc = async () => {
    const rfc = profile.rfc.trim();
    if (!rfc) { setRfcError('Ingresa un RFC para validar.'); return; }
    // Basic format check: 12 chars (moral) or 13 chars (física)
    const rfcRegex = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;
    if (!rfcRegex.test(rfc)) {
      setRfcError('El formato del RFC no es válido. Verifica que sea correcto.');
      return;
    }
    setRfcValidating(true);
    setRfcError('');
    try {
      const res = await fetch('/api/nubarium/validar-rfc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfc }),
      });
      const data = await res.json();
      if (data.valid) {
        setRfcValidated(true);
        setRfcError('');
      } else {
        setRfcValidated(false);
        setRfcError(data.error || 'RFC no encontrado o inválido en el SAT. Verifica e intenta nuevamente.');
      }
    } catch {
      setRfcError('Error al validar el RFC. Intenta nuevamente.');
    } finally {
      setRfcValidating(false);
    }
  };

  const nombreCompleto = [profile.nombre, profile.apellidoPaterno, profile.apellidoMaterno].filter(Boolean).join(' ');

  // ─── Avatar Upload ────────────────────────────────────────────────────────

  const handleAvatarClick = () => { fileInputRef.current?.click(); };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) { setAvatarError('Solo se permiten imágenes PNG, JPG o WebP'); return; }
    if (file.size > 2 * 1024 * 1024) { setAvatarError('La imagen no debe superar 2MB'); return; }
    setAvatarUploading(true);
    setAvatarError('');
    try {
      const supabase = createClient();
      const ext = file.name.split('.').pop();
      const filePath = `avatars/${user.id}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('mobile-uploads').upload(filePath, file, { upsert: true, contentType: file.type });
      if (uploadError) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const dataUrl = ev.target?.result as string;
          setProfile((prev) => ({ ...prev, avatarUrl: dataUrl }));
          await supabase.from('user_profiles').update({ avatar_url: dataUrl, updated_at: new Date().toISOString() }).eq('id', user.id);
        };
        reader.readAsDataURL(file);
        return;
      }
      const { data: urlData } = supabase.storage.from('mobile-uploads').getPublicUrl(filePath);
      const publicUrl = urlData?.publicUrl || '';
      setProfile((prev) => ({ ...prev, avatarUrl: publicUrl }));
      await supabase.from('user_profiles').update({ avatar_url: publicUrl, updated_at: new Date().toISOString() }).eq('id', user.id);
    } catch { setAvatarError('Error al subir la imagen'); } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ─── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!user) return;
    // If RFC was changed (was empty before) and not yet validated, block save
    if (!rfcOriginal && profile.rfc && !rfcValidated) {
      setSaveError('Debes validar el RFC antes de guardar.');
      return;
    }
    setSaving(true);
    setSaveError('');
    setSavedOk(false);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('user_profiles').upsert({
        id: user.id,
        nombre: profile.nombre,
        apellido_paterno: profile.apellidoPaterno,
        apellido_materno: profile.apellidoMaterno,
        full_name: nombreCompleto,
        curp: profile.curp,
        email: profile.correo,
        telefono: profile.telefono,
        phone: profile.telefono,
        rfc: profile.rfc,
        regimen_fiscal: profile.regimenFiscal,
        codigo_postal: profile.codigoPostal,
        estado: profile.estado,
        municipio: profile.municipio,
        colonia: profile.colonia,
        localidad: profile.localidad,
        calle: profile.calle,
        num_exterior: profile.numExterior,
        num_interior: profile.numInterior,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setSavedOk(true);
      setIsEditingProfile(false);
      setRfcOriginal(profile.rfc);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (err: any) {
      setSaveError(err?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  // ─── Signature Save ────────────────────────────────────────────────────────

  const handleSaveSignature = async (dataUrl: string) => {
    if (!user) return;
    setSignatureSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('user_profiles').upsert({
        id: user.id,
        firma_autografa_url: dataUrl,
        metodo_firma: 'autografa_digital',
        firma_autografa_created_at: new Date().toISOString(),
        firma_autografa_last_used: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw error;
      setSavedSignature(dataUrl);
      setShowSignatureModal(false);
    } catch (err: any) {
      console.error('Error al guardar firma autógrafa:', err?.message || err);
    } finally {
      setSignatureSaving(false);
    }
  };

  const handleDeleteSignature = async () => {
    if (!user) return;
    try {
      const supabase = createClient();
      await supabase.from('user_profiles').update({ firma_autografa_url: null, updated_at: new Date().toISOString() }).eq('id', user.id);
      setSavedSignature(null);
    } catch { /* silent */ }
  };

  // ─── e.Firma Save ──────────────────────────────────────────────────────────

  const handleSaveEfirma = async (result: EfirmaValidationResult) => {
    if (!user) throw new Error('Usuario no autenticado');
    const supabase = createClient();
    const nombreCompleto = [result.nombre, result.apellidoPaterno, result.apellidoMaterno].filter(Boolean).join(' ');
    const { error } = await supabase.from('user_profiles').update({
      efirma_rfc: result.rfc,
      efirma_serial: result.serial,
      efirma_nombre: nombreCompleto || result.rfc,
      efirma_vigencia_fin: result.vigenciaFin,
      efirma_linked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    if (error) throw error;
    setEfirmaLinked(true);
    setEfirmaData({
      rfc: result.rfc,
      serial: result.serial,
      nombre: nombreCompleto || result.rfc,
      vigenciaFin: result.vigenciaFin,
      linkedAt: new Date().toISOString(),
    });
  };

  const handleUnlinkEfirma = async () => {
    if (!user) return;
    setEfirmaUnlinking(true);
    try {
      const supabase = createClient();
      await supabase.from('user_profiles').update({
        efirma_rfc: null,
        efirma_serial: null,
        efirma_nombre: null,
        efirma_vigencia_fin: null,
        efirma_linked_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', user.id);
      setEfirmaLinked(false);
      setEfirmaData(null);
    } catch { /* silent */ } finally { setEfirmaUnlinking(false); }
  };

  const handleSaveEfirmaStamp = async (stampStyle: string) => {
    if (!user) return;
    const supabase = createClient();
    const { error } = await supabase.from('user_profiles').update({
      efirma_stamp_style: stampStyle,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    if (error) throw new Error(error.message);
    setEfirmaStampStyle(stampStyle);
  };

  const handleSaveAutografaStamp = async (stampStyle: string) => {
    if (!user) return;
    const supabase = createClient();
    const { error } = await supabase.from('user_profiles').update({
      autografa_stamp_style: stampStyle,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    if (error) throw new Error(error.message);
    setAutografaStampStyle(stampStyle);
  };

  const handleSaveClickSignStamp = async (stampStyle: string) => {
    if (!user) return;
    const supabase = createClient();
    const { error } = await supabase.from('user_profiles').update({
      click_sign_stamp_style: stampStyle,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    if (error) throw new Error(error.message);
    setClickSignStampStyle(stampStyle);
  };

  // ─── Verification Actions ─────────────────────────────────────────────────

  const handleVerifyEmail = async () => {
    if (!user) return;
    setVerificationAction('email');
    try {
      const supabase = createClient();
      await supabase.auth.signInWithOtp({ email: user.email! });
      alert(`Se ha enviado un código de verificación a ${user.email}. Revisa tu bandeja de entrada.`);
    } catch { /* silent */ } finally { setVerificationAction(null); }
  };

  const handleVerifyPhone = async () => {
    if (!user || !profile.telefono) { alert('Primero debes agregar un número de teléfono en Información Personal.'); return; }
    setVerificationAction('phone');
    try {
      const supabase = createClient();
      await supabase.from('user_verification_status').update({ phone_verified: true, phone_verified_at: new Date().toISOString(), phone_number: profile.telefono }).eq('user_id', user.id);
      await loadVerificationStatus();
    } catch { /* silent */ } finally { setVerificationAction(null); }
  };

  // ─── WebAuthn Device Registration ─────────────────────────────────────────

  const fetchWebAuthnDevices = useCallback(async () => {
    if (!user) return;
    setWebAuthnDevicesLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('webauthn_credentials')
        .select('id, device_name, device_type, device_category, os, browser, registered_from, created_at, last_used_at, is_active')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (!error && data) setWebAuthnDevices(data as WebAuthnCredential[]);
    } catch { /* silent */ } finally { setWebAuthnDevicesLoading(false); }
  }, [user]);

  const handleRevokeWebAuthnDevice = async (credentialId: string, deviceName: string) => {
    if (!confirm(`¿Eliminar el dispositivo "${deviceName}"? Ya no podrás usarlo para autenticarte.`)) return;
    setWebAuthnRevoking(credentialId);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('webauthn_credentials')
        .update({ is_active: false })
        .eq('id', credentialId)
        .eq('user_id', user!.id);
      if (error) throw error;
      setWebAuthnDevices(prev => prev.filter(d => d.id !== credentialId));
    } catch { /* silent */ } finally { setWebAuthnRevoking(null); }
  };

  const openWebAuthnModal = () => {
    setWebAuthnError(null);
    setWebAuthnSuccess(null);
    setWebAuthnModalTab('desktop');
    setWebAuthnQrData(null);
    setWebAuthnQrStatus('loading');
    // Suggest device name
    if (typeof window !== 'undefined') {
      const ua = navigator.userAgent;
      let os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : '';
      if (os === 'macOS') setWebAuthnDeviceName('MacBook de usuario');
      else if (os === 'Windows') setWebAuthnDeviceName('PC de usuario');
      else if (os === 'iOS') setWebAuthnDeviceName(/iPad/.test(ua) ? 'iPad de usuario' : 'iPhone de usuario');
      else if (os === 'Android') setWebAuthnDeviceName('Android de usuario');
      else setWebAuthnDeviceName('Mi dispositivo');
    }
    setShowWebAuthnModal(true);
  };

  const closeWebAuthnModal = () => {
    setShowWebAuthnModal(false);
    if (webAuthnQrPollRef.current) clearInterval(webAuthnQrPollRef.current);
    if (webAuthnQrTimerRef.current) clearInterval(webAuthnQrTimerRef.current);
    setWebAuthnQrData(null);
    setWebAuthnQrStatus('loading');
  };

  const handleWebAuthnRegisterDesktop = async () => {
    if (!webAuthnDeviceName.trim()) { setWebAuthnError('Ingresa un nombre para el dispositivo.'); return; }
    setWebAuthnLoading(true);
    setWebAuthnError(null);
    setWebAuthnSuccess(null);
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa.');

      const ua = navigator.userAgent;
      let os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
      let browser = /Firefox/.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Unknown';
      const context = /iPhone|iPad|Android/.test(ua) ? 'browser_mobile' : 'browser_desktop';

      const optRes = await fetch('/api/webauthn/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ deviceName: webAuthnDeviceName.trim(), context, os, browser, deviceCategory: 'desktop' }),
      });
      if (!optRes.ok) { const e = await optRes.json(); throw new Error(e.error || 'Error al obtener opciones.'); }
      const options = await optRes.json();

      const credential = await startRegistration({ optionsJSON: options });

      const verRes = await fetch('/api/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ credential, deviceName: webAuthnDeviceName.trim(), context, os, browser, deviceCategory: 'desktop', registeredFrom: 'direct' }),
      });
      if (!verRes.ok) { const e = await verRes.json(); throw new Error(e.error || 'Error al verificar registro.'); }

      setWebAuthnSuccess(`✅ ${webAuthnDeviceName.trim()} registrado correctamente.`);
      fetchWebAuthnDevices();
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      let msg = err instanceof Error ? err.message : String(err);
      if (name === 'NotAllowedError') setWebAuthnError('Autenticación cancelada.');
      else if (name === 'NotSupportedError') setWebAuthnError('Este dispositivo no es compatible con autenticación biométrica.');
      else setWebAuthnError(msg || 'Error al registrar dispositivo.');
    } finally {
      setWebAuthnLoading(false);
    }
  };

  const handleWebAuthnGenerateQR = async () => {
    setWebAuthnQrStatus('loading');
    setWebAuthnError(null);
    setWebAuthnSuccess(null);
    if (webAuthnQrPollRef.current) clearInterval(webAuthnQrPollRef.current);
    if (webAuthnQrTimerRef.current) clearInterval(webAuthnQrTimerRef.current);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa.');

      const res = await fetch('/api/webauthn/generate-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error al generar QR.'); }
      const data = await res.json();
      setWebAuthnQrData(data);
      setWebAuthnQrSeconds(data.expiresIn || 300);
      setWebAuthnQrStatus('active');

      // Countdown
      webAuthnQrTimerRef.current = setInterval(() => {
        setWebAuthnQrSeconds((s) => {
          if (s <= 1) { clearInterval(webAuthnQrTimerRef.current!); setWebAuthnQrStatus('expired'); return 0; }
          return s - 1;
        });
      }, 1000);

      // Polling
      webAuthnQrPollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/webauthn/qr-status?token=${data.token}`);
          const pollData = await pollRes.json();
          if (pollData.status === 'completed') {
            clearInterval(webAuthnQrPollRef.current!);
            clearInterval(webAuthnQrTimerRef.current!);
            setWebAuthnQrStatus('completed');
            setWebAuthnSuccess(`✅ ${pollData.deviceName || 'Dispositivo móvil'} registrado correctamente.`);
            fetchWebAuthnDevices();
          } else if (pollData.status === 'expired') {
            clearInterval(webAuthnQrPollRef.current!);
            clearInterval(webAuthnQrTimerRef.current!);
            setWebAuthnQrStatus('expired');
          }
        } catch { /* ignore poll errors */ }
      }, 2000);
    } catch (err: unknown) {
      setWebAuthnError(err instanceof Error ? err.message : 'Error al generar QR.');
      setWebAuthnQrStatus('expired');
    }
  };

  // ─── Seguridad state ──────────────────────────────────────────────────────

  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordCreatedAt, setPasswordCreatedAt] = useState<string | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaMethod, setMfaMethod] = useState<string>('none');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaMsg, setMfaMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSession, setRevokingSession] = useState<string | null>(null);
  const [loginActivity, setLoginActivity] = useState<LoginActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'today' | 'week' | '30days' | '90days' | 'all'>('30days');
  const [activityPage, setActivityPage] = useState(1);

  // Security Events state
  const [securityEvents, setSecurityEvents] = useState<Array<{
    id: string;
    event_type: string;
    description: string | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
  }>>([]);
  const [secEventsLoading, setSecEventsLoading] = useState(false);
  const [secEventDateFilter, setSecEventDateFilter] = useState<'today' | 'week' | '30days' | '90days' | 'all'>('30days');
  const [secEventTypeFilter, setSecEventTypeFilter] = useState<string>('all');
  const [secEventDeviceFilter, setSecEventDeviceFilter] = useState<string>('all');
  const [secEventsPage, setSecEventsPage] = useState(1);

  useEffect(() => {
    if (!user || activeSection !== 'seguridad') return;
    loadSecurityData();
  }, [user, activeSection]);

  const loadSecurityData = async () => {
    if (!user) return;
    const supabase = createClient();
    const { data: profileData } = await supabase.from('user_profiles').select('mfa_enabled, mfa_method').eq('id', user.id).single();
    if (profileData) { setMfaEnabled(profileData.mfa_enabled ?? false); setMfaMethod(profileData.mfa_method ?? 'none'); }

    // Fetch password creation date from activity log
    const { data: pwdActivity } = await supabase
      .from('login_activity_log')
      .select('created_at')
      .eq('user_id', user.id)
      .eq('event_type', 'password_change')
      .order('created_at', { ascending: false })
      .limit(1);
    if (pwdActivity && pwdActivity.length > 0) {
      setPasswordCreatedAt(pwdActivity[0].created_at);
    } else {
      setPasswordCreatedAt(user.created_at || null);
    }

    setSessionsLoading(true);
    try {
      const { data: sessionsData } = await supabase.from('user_sessions').select('*').eq('user_id', user.id).order('last_active_at', { ascending: false }).limit(10);
      if (sessionsData && sessionsData.length > 0) {
        setSessions(sessionsData as UserSession[]);
      } else {
        const currentSession: UserSession = { id: 'current', device_name: 'Este dispositivo', device_type: 'web', browser: getBrowserName(), os: getOSName(), ip_address: null, location: null, is_current: true, last_active_at: new Date().toISOString(), created_at: user.created_at || new Date().toISOString() };
        setSessions([currentSession]);
        await supabase.from('user_sessions').upsert({ id: 'current-' + user.id, user_id: user.id, session_token: 'current', device_name: currentSession.device_name, device_type: currentSession.device_type, browser: currentSession.browser, os: currentSession.os, is_current: true, last_active_at: new Date().toISOString() }, { onConflict: 'id' }).select();
      }
    } finally { setSessionsLoading(false); }
    setActivityLoading(true);
    try {
      const { data: activityData } = await supabase
        .from('access_logs')
        .select('id, user_id, email, ip_address, accessed_at, browser, browser_version, operating_system, os_version, device_type, user_agent, login_success, auth_method, city, country, created_at')
        .eq('user_id', user.id)
        .order('accessed_at', { ascending: false })
        .limit(500);
      if (activityData && activityData.length > 0) {
        // Normalize access_logs rows to LoginActivity shape
        const normalized = activityData.map((row: any) => ({
          ...row,
          event_type: row.auth_method || 'login',
          device_name: null,
          os: row.operating_system || null,
          location: [row.city, row.country].filter(Boolean).join(', ') || null,
          status: row.login_success === false ? 'failed' : 'success',
          created_at: row.accessed_at || row.created_at,
        }));
        setLoginActivity(normalized as LoginActivity[]);
      } else {
        setLoginActivity([]);
      }
    } finally { setActivityLoading(false); }

    // Load security events
    setSecEventsLoading(true);
    try {
      const { data: eventsData } = await supabase
        .from('auth_security_events')
        .select('id, event_type, description, ip_address, user_agent, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(500);
      setSecurityEvents(eventsData || []);
    } catch {
      setSecurityEvents([]);
    } finally { setSecEventsLoading(false); }
  };

  const handlePasswordChange = async () => {
    if (!user) return;
    const { currentPassword, newPassword, confirmPassword } = passwordForm;
    if (!currentPassword || !newPassword || !confirmPassword) { setPasswordMsg({ type: 'error', text: 'Completa todos los campos.' }); return; }
    if (newPassword.length < 8) { setPasswordMsg({ type: 'error', text: 'La nueva contraseña debe tener al menos 8 caracteres.' }); return; }
    if (newPassword !== confirmPassword) { setPasswordMsg({ type: 'error', text: 'Las contraseñas no coinciden.' }); return; }
    setPasswordSaving(true);
    setPasswordMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      await supabase.from('login_activity_log').insert({ user_id: user.id, event_type: 'password_change', device_name: 'Este dispositivo', device_type: 'web', browser: getBrowserName(), os: getOSName(), status: 'success' });
      setPasswordMsg({ type: 'success', text: 'Contraseña actualizada correctamente.' });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowPasswordForm(false);
      loadSecurityData();
    } catch (err: any) {
      setPasswordMsg({ type: 'error', text: err?.message || 'Error al cambiar la contraseña.' });
    } finally { setPasswordSaving(false); }
  };

  const handleToggleMFA = async (method: string) => {
    if (!user) return;
    setMfaLoading(true);
    setMfaMsg(null);
    try {
      const supabase = createClient();
      const newEnabled = method !== 'none';
      await supabase.from('user_profiles').update({ mfa_enabled: newEnabled, mfa_method: method, mfa_enrolled_at: newEnabled ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', user.id);
      setMfaEnabled(newEnabled);
      setMfaMethod(method);
      setMfaMsg({ type: 'success', text: newEnabled ? `Autenticación de dos factores activada (${method === 'totp' ? 'App Autenticadora' : 'SMS'}).` : 'Autenticación de dos factores desactivada.' });
    } catch (err: any) {
      setMfaMsg({ type: 'error', text: err?.message || 'Error al actualizar la configuración.' });
    } finally { setMfaLoading(false); }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!user) return;
    setRevokingSession(sessionId);
    try {
      const supabase = createClient();
      await supabase.from('user_sessions').delete().eq('id', sessionId).eq('user_id', user.id);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      await supabase.from('login_activity_log').insert({ user_id: user.id, event_type: 'session_revoked', device_name: 'Este dispositivo', device_type: 'web', browser: getBrowserName(), os: getOSName(), status: 'success' });
      loadSecurityData();
    } catch { /* silent */ } finally { setRevokingSession(null); }
  };

  // ─── Render helpers ──────────────────────────────────────────────────────────

  const inputClass = 'w-full px-3 py-2 border border-border rounded-lg text-sm text-foreground bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors placeholder:text-gray-400';
  const labelClass = 'block text-xs font-600 text-muted-foreground mb-1';
  const readonlyClass = 'w-full px-3 py-2 border border-border rounded-lg text-sm text-foreground bg-gray-50 cursor-not-allowed';

  const renderInformacionPersonal = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <User size={24} className="text-primary" />
            Información Personal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Actualiza tus datos personales y fiscales.</p>
        </div>
        {!isEditingProfile ? (
          <button
            onClick={() => { setIsEditingProfile(true); setSaveError(''); setSavedOk(false); }}
            className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors flex-shrink-0"
          >
            <Edit3 size={15} />
            Actualizar perfil
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => { setIsEditingProfile(false); setRfcError(''); setSaveError(''); }}
              className="flex items-center gap-2 px-4 py-2 border border-border text-foreground rounded-lg text-sm font-500 hover:bg-gray-50 transition-colors"
            >
              <X size={14} />
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || (!rfcOriginal && !!profile.rfc && !rfcValidated)}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Guardar cambios
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="Foto de perfil" className="w-16 h-16 rounded-full object-cover shadow border border-border" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center shadow">
              <span className="text-white text-xl font-700">{(profile.nombre.charAt(0) || user?.email?.charAt(0) || '?').toUpperCase()}</span>
            </div>
          )}
          <button onClick={handleAvatarClick} disabled={avatarUploading} className="absolute -bottom-1 -right-1 w-6 h-6 flex items-center justify-center rounded-full bg-white border border-border shadow-sm hover:bg-gray-100 transition-colors">
            {avatarUploading ? <Loader2 size={10} className="text-primary animate-spin" /> : <Camera size={11} className="text-muted-foreground" />}
          </button>
        </div>
        <div>
          <button onClick={handleAvatarClick} disabled={avatarUploading} className="flex items-center gap-1.5 text-sm text-primary font-600 hover:underline disabled:opacity-60">
            {avatarUploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            {avatarUploading ? 'Subiendo...' : 'Subir foto'}
          </button>
          <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG o WebP, no mayor a 2MB.</p>
          {avatarError && <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1"><AlertCircle size={11} />{avatarError}</p>}
        </div>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" className="hidden" onChange={handleAvatarChange} />
      </div>

      <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
        <h3 className="text-sm font-700 text-primary flex items-center gap-2"><User size={15} />Datos de Identidad</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Tipo de Persona</label>
            <input type="text" value={profile.tipoPersona} readOnly className={readonlyClass} title="El tipo de persona se establece durante el registro y no puede modificarse" />
            <p className="text-xs text-muted-foreground mt-1">Definido en el registro. No editable.</p>
          </div>
          <div>
            <label className={labelClass}>CURP</label>
            <input type="text" value={profile.curp} readOnly maxLength={18} placeholder="HEBL861015HSLRL502" className={readonlyClass} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Nombre</label>
            <input type="text" value={profile.nombre} readOnly placeholder="Luis Alberto" className={readonlyClass} />
          </div>
          <div>
            <label className={labelClass}>Apellido Paterno</label>
            <input type="text" value={profile.apellidoPaterno} readOnly placeholder="Hernández" className={readonlyClass} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Apellido Materno</label>
            <input type="text" value={profile.apellidoMaterno} readOnly placeholder="García" className={readonlyClass} />
          </div>
          <div>
            <label className={labelClass}>Nombre Completo / Razón Social</label>
            <input type="text" value={nombreCompleto} readOnly placeholder="Se genera automáticamente" className={readonlyClass} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Correo Electrónico</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="email" value={profile.correo} readOnly placeholder="correo@ejemplo.com" className={readonlyClass + ' pl-8'} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Número de Teléfono</label>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="tel" value={profile.telefono} readOnly placeholder="8691074369" className={readonlyClass + ' pl-8'} />
            </div>
          </div>
        </div>
      </div>

      <div className={`bg-white border rounded-xl p-5 flex flex-col gap-4 transition-all ${isEditingProfile ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-700 text-primary flex items-center gap-2"><FileText size={15} />Datos Fiscales</h3>
          {isEditingProfile && <span className="text-xs text-primary font-500 flex items-center gap-1"><Edit3 size={11} />Editable</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>RFC</label>
            {isEditingProfile && !rfcOriginal ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={profile.rfc}
                    onChange={(e) => handleRfcChange(e.target.value)}
                    maxLength={13}
                    placeholder="HEBL861015J26"
                    className={`flex-1 px-3 py-2 border rounded-lg text-sm text-foreground bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors placeholder:text-gray-400 font-mono ${rfcError ? 'border-red-400' : rfcValidated ? 'border-emerald-400' : 'border-border'}`}
                  />
                  <button
                    onClick={handleValidateRfc}
                    disabled={rfcValidating || !profile.rfc || rfcValidated}
                    className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-xs font-600 hover:bg-primary/90 transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {rfcValidating ? <Loader2 size={12} className="animate-spin" /> : rfcValidated ? <CheckCircle size={12} /> : <ShieldCheck size={12} />}
                    {rfcValidating ? 'Validando...' : rfcValidated ? 'Válido' : 'Validar'}
                  </button>
                </div>
                {rfcError && (
                  <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{rfcError}</p>
                )}
                {rfcValidated && (
                  <p className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={11} />RFC verificado correctamente ante el SAT</p>
                )}
                <p className="text-xs text-muted-foreground">El RFC debe ser validado antes de guardar.</p>
              </div>
            ) : (
              <input
                type="text"
                value={profile.rfc}
                readOnly
                maxLength={13}
                placeholder="HEBL861015J26"
                className={readonlyClass + ' font-mono'}
                title={rfcOriginal ? 'El RFC ya fue registrado y no puede modificarse.' : undefined}
              />
            )}
            {rfcOriginal && isEditingProfile && (
              <p className="text-xs text-muted-foreground mt-1">El RFC ya fue registrado y no puede modificarse.</p>
            )}
          </div>
          <div>
            <label className={labelClass}>Régimen Fiscal</label>
            {isEditingProfile ? (
              <div className="relative">
                <select value={profile.regimenFiscal} onChange={(e) => handleChange('regimenFiscal', e.target.value)} className={inputClass + ' appearance-none pr-8'}>
                  <option value="">Selecciona un régimen</option>
                  {REGIMENES_FISCALES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            ) : (
              <input type="text" value={profile.regimenFiscal} readOnly placeholder="Sin régimen fiscal" className={readonlyClass} />
            )}
          </div>
        </div>
      </div>

      <div className={`bg-white border rounded-xl p-5 flex flex-col gap-4 transition-all ${isEditingProfile ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-700 text-primary flex items-center gap-2"><MapPin size={15} />Domicilio Fiscal</h3>
          {isEditingProfile && <span className="text-xs text-primary font-500 flex items-center gap-1"><Edit3 size={11} />Editable</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Código Postal</label>
            {isEditingProfile ? (
              <div className="relative">
                <input type="text" value={profile.codigoPostal} onChange={(e) => handleCpChange(e.target.value)} maxLength={5} placeholder="00000" className={inputClass} />
                {cpLoading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-primary animate-spin" />}
              </div>
            ) : (
              <input type="text" value={profile.codigoPostal} readOnly placeholder="00000" className={readonlyClass} />
            )}
            {cpError && isEditingProfile && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{cpError}</p>}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Estado</label>
            <input type="text" value={profile.estado} readOnly placeholder="Se completa con el C.P." className={readonlyClass} />
          </div>
          <div>
            <label className={labelClass}>Municipio o Alcaldía</label>
            <input type="text" value={profile.municipio} readOnly placeholder="Se completa con el C.P." className={readonlyClass} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Colonia</label>
            {isEditingProfile ? (
              colonias.length > 0 ? (
                <div className="relative">
                  <select value={profile.colonia} onChange={(e) => handleChange('colonia', e.target.value)} className={inputClass + ' appearance-none pr-8'}>
                    {colonias.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              ) : (
                <input type="text" value={profile.colonia} onChange={(e) => handleChange('colonia', e.target.value)} placeholder="Nombre de la colonia" className={inputClass} />
              )
            ) : (
              <input type="text" value={profile.colonia} readOnly placeholder="Nombre de la colonia" className={readonlyClass} />
            )}
          </div>
          <div>
            <label className={labelClass}>Localidad</label>
            {isEditingProfile ? (
              <input type="text" value={profile.localidad} onChange={(e) => handleChange('localidad', e.target.value)} placeholder="Nombre de la localidad" className={inputClass} />
            ) : (
              <input type="text" value={profile.localidad} readOnly placeholder="Nombre de la localidad" className={readonlyClass} />
            )}
          </div>
        </div>
        <div>
          <label className={labelClass}>Calle</label>
          {isEditingProfile ? (
            <input type="text" value={profile.calle} onChange={(e) => handleChange('calle', e.target.value)} placeholder="Av. Principal" className={inputClass} />
          ) : (
            <input type="text" value={profile.calle} readOnly placeholder="Av. Principal" className={readonlyClass} />
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Número Exterior</label>
            {isEditingProfile ? (
              <input type="text" value={profile.numExterior} onChange={(e) => handleChange('numExterior', e.target.value)} placeholder="123" className={inputClass} />
            ) : (
              <input type="text" value={profile.numExterior} readOnly placeholder="123" className={readonlyClass} />
            )}
          </div>
          <div>
            <label className={labelClass}>Número Interior (Opcional)</label>
            {isEditingProfile ? (
              <input type="text" value={profile.numInterior} onChange={(e) => handleChange('numInterior', e.target.value)} placeholder="A" className={inputClass} />
            ) : (
              <input type="text" value={profile.numInterior} readOnly placeholder="A" className={readonlyClass} />
            )}
          </div>
        </div>
      </div>

      {savedOk && <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-500"><CheckCircle size={15} />Cambios guardados correctamente</div>}
      {saveError && <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-500"><AlertCircle size={15} />{saveError}</div>}
      {isEditingProfile && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || (!rfcOriginal && !!profile.rfc && !rfcValidated)}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Guardar Cambios
          </button>
          <button
            onClick={() => { setIsEditingProfile(false); setRfcError(''); setSaveError(''); }}
            className="flex items-center gap-2 px-4 py-2.5 border border-border text-foreground rounded-lg text-sm font-500 hover:bg-gray-50 transition-colors"
          >
            <X size={14} />
            Cancelar
          </button>
        </div>
      )}
    </div>
  );

  // ─── Espacios de Trabajo ─────────────────────────────────────────────────

  const renderEspaciosTrabajo = () => {
    const currentWsId = selectedWorkspaceId || activeWorkspace?.id;
    const currentWs = workspaces.find((w) => w.id === currentWsId);

    // Compute stats from workspaceDocs
    const totalDocumentos = workspaceDocs.length;
    const completados = workspaceDocs.filter((d) => ['completado', 'completed'].includes(d.estado || d.status || '')).length;
    const enProceso = workspaceDocs.filter((d) => ['en_proceso', 'pendiente', 'en proceso', 'in_progress'].includes(d.estado || d.status || '')).length;
    const borradores = workspaceDocs.filter((d) => ['borrador', 'draft'].includes(d.estado || d.status || '')).length;
    const vencidos = workspaceDocs.filter((d) => ['vencido', 'expired', 'expirado'].includes(d.estado || d.status || '')).length;
    const rechazados = workspaceDocs.filter((d) => ['rechazado', 'rejected', 'cancelado', 'cancelled'].includes(d.estado || d.status || '')).length;

    // Determine sharing info
    const otherMembers = workspaceMembers.filter((m) => m.user_id !== user?.id);
    const isShared = otherMembers.length > 0;
    const currentUserMember = workspaceMembers.find((m) => m.user_id === user?.id);
    const isOwner = currentWs?.ownerId === user?.id || currentUserMember?.role === 'owner';

    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Building2 size={24} className="text-primary" />
              Mis Espacios de Trabajo
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Gestiona tus perfiles personales y de empresa.</p>
          </div>
        </div>

        {/* Inner Tabs */}
        <div className="flex border-b border-border gap-1">
          <button
            onClick={() => setWsInnerTab('mis-espacios')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-600 border-b-2 transition-all -mb-px ${wsInnerTab === 'mis-espacios' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <Building2 size={15} />
            Mis Espacios de Trabajo
          </button>
          <button
            onClick={() => setWsInnerTab('unirse')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-600 border-b-2 transition-all -mb-px ${wsInnerTab === 'unirse' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <UserPlus size={15} />
            Unirse a Espacio de Trabajo
            {wsInvitations.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-primary text-white text-[10px] font-700 rounded-full">{wsInvitations.length}</span>
            )}
          </button>
        </div>

        {/* ── Tab: Mis Espacios de Trabajo ── */}
        {wsInnerTab === 'mis-espacios' && (
          <>
            {/* Workspace selector */}
            <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
              <h3 className="text-sm font-700 text-primary flex items-center gap-2"><Building2 size={15} />Mis Espacios de Trabajo</h3>
              <div className="flex flex-wrap gap-2">
                {workspaces.map((ws) => {
                  const wsIsSelected = currentWsId === ws.id;
                  // Per-workspace sharing/role info
                  const wsIsOwner = ws.ownerId === user?.id;
                  return (
                    <button
                      key={ws.id}
                      onClick={() => { setSelectedWorkspaceId(ws.id); setActiveWorkspace(ws); }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-500 border transition-all ${wsIsSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <Building2 size={15} className={wsIsSelected ? 'text-primary' : 'text-muted-foreground'} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-sm font-600 text-foreground truncate">{ws.name}</p>
                        <p className="text-xs text-muted-foreground">{ws.workspaceType === 'personal' ? 'Personal' : 'Empresarial'}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            {wsIsOwner ? (
                              <><Lock size={9} className="text-gray-400" />No compartido</>
                            ) : (
                              <><Link2 size={9} className="text-blue-400" />Compartido</>
                            )}
                          </span>
                          <span className="text-gray-300 text-[10px]">|</span>
                          <span className="flex items-center gap-1 text-[10px]">
                            {wsIsOwner ? (
                              <><ShieldCheck size={9} className="text-emerald-500" /><span className="text-emerald-600">Propietario</span></>
                            ) : (
                              <><User size={9} className="text-orange-400" /><span className="text-orange-500">Invitado</span></>
                            )}
                          </span>
                        </div>
                      </div>
                      {wsIsSelected && <CheckCircle size={16} className="text-primary flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Workspace Stats */}
            {currentWsId && (
              <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Building2 size={15} className="text-primary" /></div>
                    <div>
                      <h3 className="text-sm font-700 text-primary flex items-center gap-2">
                        <Activity size={15} />
                        Estadísticas del Espacio
                        {currentWs && <span className="text-xs font-400 text-muted-foreground ml-1">— {currentWs.name}</span>}
                      </h3>
                      <p className="text-xs text-muted-foreground">Documentos por estado en este espacio</p>
                    </div>
                  </div>
                  {docsLoading && <Loader2 size={14} className="text-primary animate-spin" />}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1 bg-blue-50 border border-blue-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-blue-600 mb-1">
                      <FileText size={16} />
                      <span className="text-xs font-600 uppercase tracking-wide">Documentos</span>
                    </div>
                    <span className="text-2xl font-700 text-blue-700">{totalDocumentos}</span>
                    <span className="text-xs text-blue-500">Total en el espacio</span>
                  </div>
                  <div className="flex flex-col gap-1 bg-green-50 border border-green-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-green-600 mb-1">
                      <CheckCircle size={16} />
                      <span className="text-xs font-600 uppercase tracking-wide">Completados</span>
                    </div>
                    <span className="text-2xl font-700 text-green-700">{completados}</span>
                    <span className="text-xs text-green-500">Documentos finalizados</span>
                  </div>
                  <div className="flex flex-col gap-1 bg-yellow-50 border border-yellow-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-yellow-600 mb-1">
                      <Clock size={16} />
                      <span className="text-xs font-600 uppercase tracking-wide">En Proceso</span>
                    </div>
                    <span className="text-2xl font-700 text-yellow-700">{enProceso}</span>
                    <span className="text-xs text-yellow-500">Pendientes de firma</span>
                  </div>
                  <div className="flex flex-col gap-1 bg-red-50 border border-red-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-red-500 mb-1">
                      <AlertCircle size={16} />
                      <span className="text-xs font-600 uppercase tracking-wide">Vencidos</span>
                    </div>
                    <span className="text-2xl font-700 text-red-600">{vencidos}</span>
                    <span className="text-xs text-red-400">Plazo expirado</span>
                  </div>
                  <div className="flex flex-col gap-1 bg-orange-50 border border-orange-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-orange-500 mb-1">
                      <X size={16} />
                      <span className="text-xs font-600 uppercase tracking-wide">Rechazados</span>
                    </div>
                    <span className="text-2xl font-700 text-orange-600">{rechazados}</span>
                    <span className="text-xs text-orange-400">No aceptados</span>
                  </div>
                  <div className="flex flex-col gap-1 bg-gray-50 border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-gray-500 mb-1">
                      <Edit3 size={16} />
                      <span className="text-xs font-600 uppercase tracking-wide">Borradores</span>
                    </div>
                    <span className="text-2xl font-700 text-gray-700">{borradores}</span>
                    <span className="text-xs text-gray-400">En edición</span>
                  </div>
                </div>
              </div>
            )}

            {/* Shared with users section */}
            {currentWsId && (
              <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-3">
                <h3 className="text-sm font-700 text-primary flex items-center gap-2">
                  <UserPlus size={15} />
                  Compartido con
                  {membersLoading && <Loader2 size={12} className="text-primary animate-spin ml-1" />}
                </h3>
                {!membersLoading && otherMembers.length === 0 ? (
                  <div className="flex items-center gap-2 py-3 px-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                    <Lock size={14} className="text-gray-400 flex-shrink-0" />
                    <p className="text-sm text-muted-foreground">Este espacio de trabajo no está compartido con otros usuarios.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {otherMembers.map((member) => (
                      <div key={member.id} className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-lg border border-border">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {member.avatarUrl ? (
                            <img src={member.avatarUrl} alt={member.nombre || member.email || ''} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-primary text-xs font-700">{(member.nombre || member.email || '?').charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {member.nombre && <p className="text-sm font-600 text-foreground truncate">{member.nombre}</p>}
                          <p className="text-xs text-muted-foreground truncate">{member.email || member.user_id}</p>
                        </div>
                        <span className={`text-xs font-500 px-2 py-0.5 rounded-full flex-shrink-0 ${member.role === 'owner' ? 'bg-emerald-100 text-emerald-700' : member.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {member.role === 'owner' ? 'Propietario' : member.role === 'admin' ? 'Admin' : 'Miembro'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Tab: Unirse a Espacio de Trabajo ── */}
        {wsInnerTab === 'unirse' && (
          <>
            {/* Join by code */}
            <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-700 text-primary flex items-center gap-2"><UserPlus size={15} />Unirse a Espacio de Trabajo</h3>
                <p className="text-xs text-muted-foreground mt-1">Ingresa el código de invitación o nombre del espacio al que deseas unirte.</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={wsJoinCode}
                  onChange={(e) => setWsJoinCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleWsJoin()}
                  placeholder="Ej: EMPRESA-2024 o nombre del espacio"
                  className="flex-1 px-3 py-2.5 border border-border rounded-lg text-sm text-foreground bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors placeholder:text-gray-400"
                />
                <button
                  onClick={handleWsJoin}
                  disabled={wsJoinLoading || !wsJoinCode.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  {wsJoinLoading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  Unirse
                </button>
              </div>
              {wsJoinError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle size={14} />{wsJoinError}
                </div>
              )}
              {wsJoinSuccess && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                  <CheckCircle size={14} />{wsJoinSuccess}
                </div>
              )}
            </div>

            {/* Received invitations */}
            <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-700 text-primary flex items-center gap-2">
                    <Mail size={15} />
                    Invitaciones Recibidas
                    {wsInvitationsLoading && <Loader2 size={12} className="text-primary animate-spin ml-1" />}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Invitaciones de propietarios de otros espacios de trabajo.</p>
                </div>
                <button
                  onClick={loadWsInvitations}
                  disabled={wsInvitationsLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-500 text-muted-foreground hover:text-primary border border-border rounded-lg hover:border-primary/40 transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={12} className={wsInvitationsLoading ? 'animate-spin' : ''} />
                  Actualizar
                </button>
              </div>

              {wsInvitationError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle size={14} />{wsInvitationError}
                </div>
              )}

              {!wsInvitationsLoading && wsInvitations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                    <Mail size={20} className="text-gray-400" />
                  </div>
                  <p className="text-sm text-muted-foreground text-center">No tienes invitaciones pendientes.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {wsInvitations.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-3 py-3 px-4 bg-blue-50 border border-blue-100 rounded-xl">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Building2 size={18} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-600 text-foreground truncate">{inv.workspace_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          Invitado por: {inv.owner_name || inv.owner_email || 'Propietario'}
                          {inv.owner_email && inv.owner_name && <span className="ml-1 text-gray-400">({inv.owner_email})</span>}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {new Date(inv.invited_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      <button
                        onClick={() => handleAcceptInvitation(inv.id, inv.workspace_id, inv.workspace_name)}
                        disabled={wsInvitationAccepting === inv.id}
                        className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-xs font-600 hover:bg-primary/90 transition-colors disabled:opacity-60 whitespace-nowrap flex-shrink-0"
                      >
                        {wsInvitationAccepting === inv.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        Aceptar invitación
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  // ─── Verificación ─────────────────────────────────────────────────────────

  const renderVerificacion = () => {
    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return null;
      return new Date(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    };
    const steps = verificationStatus?.verification_steps_completed ?? 0;
    const progressPct = Math.round((steps / 3) * 100);
    const verificationItems = [
      { key: 'email', label: 'Correo Electrónico', description: profile.correo || user?.email || 'Sin correo registrado', icon: Mail, verified: verificationStatus?.email_verified ?? false, verifiedAt: verificationStatus?.email_verified_at ?? null, actionLabel: 'Verificar correo', actionLoading: verificationAction === 'email', onAction: handleVerifyEmail, color: 'blue' },
      { key: 'phone', label: 'Número Telefónico', description: profile.telefono || verificationStatus?.phone_number || 'Sin teléfono registrado', icon: Smartphone, verified: verificationStatus?.phone_verified ?? false, verifiedAt: verificationStatus?.phone_verified_at ?? null, actionLabel: 'Verificar teléfono', actionLoading: verificationAction === 'phone', onAction: handleVerifyPhone, color: 'green' },
      { key: 'biometric', label: 'Enrolamiento Biométrico', description: verificationStatus?.biometric_source === 'enrollment' ? 'Verificado mediante enrolamiento facial' : 'Verificación de identidad mediante biometría facial', icon: Fingerprint, verified: verificationStatus?.biometric_verified ?? false, verifiedAt: verificationStatus?.biometric_verified_at ?? null, actionLabel: 'Iniciar enrolamiento', actionLoading: false, onAction: () => { setEnrollBiometricCompleted(false); setEnrollQrUrl(null); setEnrollQrExpired(false); setEnrollQrError(null); setShowEnrollmentQrModal(true); }, color: 'purple' },
    ];
    const colorMap: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
      blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', iconBg: 'bg-blue-100' },
      green: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', iconBg: 'bg-green-100' },
      purple: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', iconBg: 'bg-purple-100' },
    };

    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck size={24} className="text-primary" />
              Verificación de Identidad
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Completa las 3 verificaciones para habilitar todas las funciones de firma.</p>
          </div>
        </div>
        <div className="bg-white border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-700 text-foreground">Progreso de verificación</p>
              <p className="text-xs text-muted-foreground mt-0.5">{steps} de 3 verificaciones completadas</p>
            </div>
            {verificationLoading && <Loader2 size={15} className="text-primary animate-spin" />}
            {verificationStatus?.all_verified && (
              <span className="flex items-center gap-1.5 text-xs font-600 text-green-700 bg-green-100 px-2.5 py-1 rounded-full"><CheckCircle size={13} />Identidad verificada</span>
            )}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
            <div className="h-2.5 rounded-full bg-primary transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-muted-foreground">0%</span>
            <span className="text-xs font-600 text-primary">{progressPct}%</span>
            <span className="text-xs text-muted-foreground">100%</span>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {verificationItems.map((item) => {
            const colors = colorMap[item.color];
            const Icon = item.icon;
            return (
              <div key={item.key} className={`bg-white border rounded-xl p-5 flex items-start gap-4 transition-all duration-150 ${item.verified ? `border-${item.color}-200` : 'border-border'}`}>
                <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${item.verified ? colors.iconBg : 'bg-gray-100'}`}>
                  <Icon size={20} className={item.verified ? colors.text : 'text-muted-foreground'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-700 text-foreground">{item.label}</p>
                    {item.verified ? (
                      <span className={`flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}><CheckCircle size={11} />Verificado</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"><Clock size={11} />Pendiente</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</p>
                  {item.verified && item.verifiedAt && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><CheckCircle size={10} className="text-green-500" />Verificado el {formatDate(item.verifiedAt)}</p>
                  )}
                </div>
                {!item.verified && (
                  <button onClick={item.onAction} disabled={item.actionLoading} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-600 hover:bg-primary/90 transition-colors disabled:opacity-60 flex-shrink-0">
                    {item.actionLoading ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
                    {item.actionLabel}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
          <ShieldCheck size={15} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">La verificación completa es necesaria para firmar documentos con validez legal. Los datos se actualizan en tiempo real.</p>
        </div>

      </div>
    );
  };

  // ─── Protección de Acceso a Cuenta ────────────────────────────────────────

  const renderProteccionAcceso = () => {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Lock size={24} className="text-primary" />
              Protección de acceso a cuenta
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Configura métodos adicionales para proteger el acceso a tu cuenta.</p>
          </div>
        </div>

        {/* TOTP 2FA Card */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="flex items-start gap-4 p-5">
          <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${totpEnabled ? 'bg-indigo-100' : totpPaired ? 'bg-amber-100' : 'bg-gray-100'}`}>
            <Shield size={20} className={totpEnabled ? 'text-indigo-600' : totpPaired ? 'text-amber-600' : 'text-muted-foreground'} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-700 text-foreground">Tóken Móvil (TOTP)</p>
              {totpLoading ? (
                <Loader2 size={12} className="animate-spin text-muted-foreground" />
              ) : totpEnabled ? (
                <span className="flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700"><CheckCircle size={11} />Activa</span>
              ) : totpPaired ? (
                <span className="flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700"><Smartphone size={11} />Dispositivo emparejado</span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"><Clock size={11} />No configurada</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Protege tu cuenta con una app autenticadora como Google Authenticator o Authy.</p>
            {totpSuccessMsg && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><CheckCircle size={11} />{totpSuccessMsg}</p>
            )}
            {totpEnabled && (
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <Shield size={14} className="text-indigo-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-600 text-indigo-800">Propósito: M2FA — Autenticación de doble factor</p>
                    <p className="text-xs text-indigo-600 mt-0.5">
                      Al iniciar sesión, se te solicitará el código de 6 dígitos generado por tu app autenticadora para verificar tu identidad antes de acceder a tu cuenta.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          {!totpEnabled && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowTotpModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-600 hover:bg-primary/90 transition-colors"
              >
                <Shield size={12} />
                Configurar
              </button>
            </div>
          )}
          </div>

          {/* Dispositivos emparejados — sub-section inside TOTP card */}
          {totpEnabled && totpDeviceInfo && (
            <div className="border-t border-border">
              <div className="flex items-center justify-between px-4 py-3 bg-indigo-50/40">
                <div className="flex items-center gap-2">
                  <Smartphone size={14} className="text-indigo-600" />
                  <span className="text-xs font-700 text-foreground">Dispositivos emparejados</span>
                  <span className="text-xs font-600 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">1</span>
                </div>
              </div>
              <div className="divide-y divide-border">
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50/20 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <Smartphone size={14} className="text-indigo-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {totpDeviceInfo.configuredAt && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Configurado el {new Date(totpDeviceInfo.configuredAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })} a las {new Date(totpDeviceInfo.configuredAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => { setShowTotpDisableModal(true); setTotpDisablePassword(''); setTotpDisableShowPwd(false); setTotpDisableError(null); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-red-500 hover:bg-red-50 border border-red-200 rounded-lg text-[10px] font-600 transition-colors flex-shrink-0"
                  >
                    <Trash2 size={11} />
                    Revocar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* WebAuthn Device Registration Card */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="flex items-start gap-4 p-5">
            <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 bg-violet-100">
              <Fingerprint size={20} className="text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-700 text-foreground">Dispositivos Biométricos (WebAuthn)</p>
                <span className="flex items-center gap-1 text-xs font-600 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                  <MonitorSmartphone size={11} />FIDO2
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Registra tu computadora o dispositivo móvil para autenticarte sin contraseña usando biometría.</p>
            </div>
            <button
              onClick={openWebAuthnModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-600 hover:bg-violet-700 transition-colors flex-shrink-0"
            >
              <MonitorSmartphone size={12} />
              Agregar dispositivo
            </button>
          </div>

          {/* Registered WebAuthn Devices List — inside the same card */}
          <div className="border-t border-border">
            <div className="flex items-center justify-between px-4 py-3 bg-violet-50/40">
              <div className="flex items-center gap-2">
                <MonitorSmartphone size={14} className="text-violet-600" />
                <span className="text-xs font-700 text-foreground">Dispositivos registrados</span>
                {webAuthnDevices.length > 0 && (
                  <span className="text-xs font-600 px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">{webAuthnDevices.length}</span>
                )}
              </div>
              <button
                onClick={fetchWebAuthnDevices}
                disabled={webAuthnDevicesLoading}
                className="text-muted-foreground hover:text-violet-600 transition-colors"
                title="Actualizar lista"
              >
                <RefreshCw size={13} className={webAuthnDevicesLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {webAuthnDevicesLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={16} className="animate-spin text-violet-400" />
              </div>
            ) : webAuthnDevices.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 px-4">
                <Fingerprint size={24} className="text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground text-center">No hay dispositivos biométricos registrados.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {webAuthnDevices.map((device) => {
                  const categoryIcon = device.device_category === 'mobile' ? <Smartphone size={14} className="text-violet-500" /> : device.device_category === 'tablet' ? <Tablet size={14} className="text-violet-500" /> : <Laptop size={14} className="text-violet-500" />;
                  const registeredLabel = device.registered_from === 'qr' ? 'Móvil (QR)' : 'Directo';
                  const formattedDate = device.created_at ? new Date(device.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                  const lastUsed = device.last_used_at ? new Date(device.last_used_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
                  return (
                    <div key={device.id} className="flex items-center gap-3 px-4 py-3 hover:bg-violet-50/30 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                        {categoryIcon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-700 text-foreground truncate">{device.device_name}</p>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          {device.os && <span className="text-[10px] text-muted-foreground">{device.os}</span>}
                          {device.browser && <span className="text-[10px] text-muted-foreground">· {device.browser}</span>}
                          <span className="text-[10px] text-muted-foreground">· {registeredLabel}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">Registrado: {formattedDate}</span>
                          {lastUsed && <span className="text-[10px] text-muted-foreground">· Último uso: {lastUsed}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRevokeWebAuthnDevice(device.id, device.device_name)}
                        disabled={webAuthnRevoking === device.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-red-500 hover:bg-red-50 border border-red-200 rounded-lg text-[10px] font-600 transition-colors flex-shrink-0 disabled:opacity-50"
                        title="Revocar dispositivo"
                      >
                        {webAuthnRevoking === device.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                        Revocar
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* WebAuthn Modal */}
        {showWebAuthnModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Fingerprint size={18} className="text-violet-600" />
                  <h3 className="text-sm font-700 text-foreground">Agregar dispositivo biométrico</h3>
                </div>
                <button onClick={closeWebAuthnModal} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X size={18} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border">
                <button
                  onClick={() => { setWebAuthnModalTab('desktop'); setWebAuthnError(null); setWebAuthnSuccess(null); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-600 transition-colors border-b-2 ${webAuthnModalTab === 'desktop' ? 'border-violet-600 text-violet-700 bg-violet-50/50' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  <Laptop size={13} />Esta computadora
                </button>
                <button
                  onClick={() => { setWebAuthnModalTab('qr'); setWebAuthnError(null); setWebAuthnSuccess(null); if (webAuthnQrStatus === 'loading') handleWebAuthnGenerateQR(); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-600 transition-colors border-b-2 ${webAuthnModalTab === 'qr' ? 'border-violet-600 text-violet-700 bg-violet-50/50' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  <Smartphone size={13} />Dispositivo móvil (QR)
                </button>
              </div>

              <div className="p-5">
                {/* Success message */}
                {webAuthnSuccess && (
                  <div className="mb-4 flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
                    <CheckCircle size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-green-700 font-600">{webAuthnSuccess}</p>
                  </div>
                )}

                {/* Error message */}
                {webAuthnError && (
                  <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600">{webAuthnError}</p>
                  </div>
                )}

                {/* Desktop tab */}
                {webAuthnModalTab === 'desktop' && (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 bg-violet-50 border border-violet-200 rounded-xl">
                      <Fingerprint size={14} className="text-violet-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-violet-700">Registra esta computadora para autenticarte con Touch ID, Windows Hello o huella dactilar.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-600 text-foreground mb-1">Nombre del dispositivo</label>
                      <input
                        type="text"
                        value={webAuthnDeviceName}
                        onChange={(e) => setWebAuthnDeviceName(e.target.value)}
                        placeholder="Ej: MacBook de trabajo"
                        className="w-full px-3 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300 transition-all bg-white"
                      />
                    </div>
                    {webAuthnSuccess ? (
                      <button onClick={closeWebAuthnModal} className="w-full py-2.5 bg-green-600 text-white rounded-xl text-sm font-700 hover:bg-green-700 transition-colors">
                        Cerrar
                      </button>
                    ) : (
                      <button
                        onClick={handleWebAuthnRegisterDesktop}
                        disabled={webAuthnLoading || !webAuthnDeviceName.trim()}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-700 hover:bg-violet-700 disabled:opacity-60 transition-all active:scale-95"
                        style={{ minHeight: '44px' }}
                      >
                        {webAuthnLoading ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <><Fingerprint size={15} />Registrar con biométrico</>
                        )}
                      </button>
                    )}
                    <p className="text-[10px] text-center text-muted-foreground">FIDO2 Certified · Tu biométrico nunca sale del dispositivo</p>
                  </div>
                )}

                {/* QR tab */}
                {webAuthnModalTab === 'qr' && (
                  <div className="space-y-4">
                    {webAuthnQrStatus === 'loading' && (
                      <div className="flex flex-col items-center gap-3 py-6">
                        <Loader2 size={24} className="animate-spin text-violet-600" />
                        <p className="text-xs text-muted-foreground">Generando código QR...</p>
                      </div>
                    )}

                    {webAuthnQrStatus === 'active' && webAuthnQrData && (
                      <>
                        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                          <Smartphone size={13} className="text-blue-600 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-blue-700">Escanea con la cámara de tu iPhone o Android. Solo necesitas internet en ambos dispositivos.</p>
                        </div>
                        <div className="flex flex-col items-center gap-3">
                          {/* QR with animated border countdown */}
                          <div className="relative p-3 rounded-2xl border-4 border-violet-400" style={{ borderColor: webAuthnQrSeconds < 60 ? '#ef4444' : webAuthnQrSeconds < 120 ? '#f59e0b' : '#7c3aed' }}>
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(webAuthnQrData.qrUrl)}`}
                              alt="QR para registrar dispositivo móvil"
                              className="w-44 h-44"
                            />
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock size={12} />
                            <span>Expira en {Math.floor(webAuthnQrSeconds / 60)}:{(webAuthnQrSeconds % 60).toString().padStart(2, '0')}</span>
                          </div>
                          <p className="text-[10px] text-center text-muted-foreground max-w-xs">URL: <span className="font-mono break-all">{webAuthnQrData.qrUrl}</span></p>
                        </div>
                      </>
                    )}

                    {webAuthnQrStatus === 'completed' && (
                      <div className="flex flex-col items-center gap-4 py-4">
                        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                          <CheckCircle size={32} className="text-green-600" />
                        </div>
                        <p className="text-sm font-700 text-green-700 text-center">{webAuthnSuccess || '✅ Dispositivo registrado correctamente.'}</p>
                        <button onClick={closeWebAuthnModal} className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-700 hover:bg-green-700 transition-colors">
                          Cerrar
                        </button>
                      </div>
                    )}

                    {webAuthnQrStatus === 'expired' && (
                      <div className="flex flex-col items-center gap-4 py-4">
                        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                          <Clock size={32} className="text-amber-600" />
                        </div>
                        <p className="text-sm font-600 text-amber-700 text-center">El código QR expiró.</p>
                        <button onClick={handleWebAuthnGenerateQR} className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-700 hover:bg-violet-700 transition-colors">
                          <RefreshCw size={14} />Generar nuevo QR
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    );
  };

  // ─── Firmas ───────────────────────────────────────────────────────────────

  const renderFirmas = () => {
    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return '—';
      return new Date(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    };

    const tabs: { id: 'autografa' | 'efirma' | 'clicksign'; label: string; icon: React.ReactNode }[] = [
      { id: 'autografa', label: 'Autógrafa', icon: <PenTool size={14} /> },
      { id: 'efirma', label: 'e.Firma SAT', icon: <ShieldCheck size={14} /> },
      { id: 'clicksign', label: 'Click & Sign', icon: <CheckCircle2 size={14} /> },
    ];

    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <PenTool size={24} className="text-primary" />
              Firmas y Sellos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Gestiona tus firmas para agilizar tus procesos.</p>
          </div>
        </div>

        {/* Horizontal tabs */}
        <div className="flex gap-1 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFirmasTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-600 border-b-2 transition-colors -mb-px ${
                firmasTab === tab.id
                  ? 'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Autógrafa ── */}
        {firmasTab === 'autografa' && (
          <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-700 text-foreground">Firma Autógrafa Digital</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Esta firma se usará cuando elijas el método de{' '}
                  <span className="text-primary">firma autógrafa</span>.
                </p>
              </div>
              {savedSignature && (
                <button
                  onClick={() => setShowSignatureFullscreen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-gray-50 transition-colors"
                  title="Ver firma en pantalla completa"
                >
                  <Maximize2 size={13} />
                  Ver firma
                </button>
              )}
            </div>

            {savedSignature ? (
              <div className="flex flex-col gap-4">
                {/* Signature image */}
                <div className="w-full max-w-sm mx-auto border border-border rounded-xl bg-gray-50 flex items-center justify-center" style={{ minHeight: '120px' }}>
                  <img src={savedSignature} alt="Firma autógrafa guardada" className="max-h-28 max-w-full object-contain p-2" />
                </div>

                {/* Verified badge */}
                <div className="w-full max-w-sm mx-auto flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                  <ShieldCheck size={13} className="text-green-600 flex-shrink-0" />
                  <p className="text-xs text-green-700 font-medium">Firma vinculada y almacenada de forma segura</p>
                </div>

                {/* Metadata grid */}
                {firmaMetaLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="border border-border rounded-xl overflow-hidden">
                    <div className="bg-muted/40 px-4 py-2.5 border-b border-border">
                      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Detalles de la firma</p>
                    </div>
                    <div className="p-4 flex flex-col gap-3">
                      {/* Hash */}
                      {firmaHash && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Hash SHA-256</p>
                          <p className="text-xs font-mono break-all text-foreground bg-gray-50 border border-border rounded-lg px-3 py-2 select-all">{firmaHash}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                        {/* Creation date */}
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Fecha de creación</p>
                          <p className="text-sm text-foreground">{formatDate(firmaCreatedAt)}</p>
                        </div>
                        {/* Save date */}
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Fecha de guardado</p>
                          <p className="text-sm text-foreground">{formatDate(firmaLastUsed || firmaCreatedAt)}</p>
                        </div>
                      </div>

                      {/* Linked documents */}
                      {firmaLinkedDocs.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Documentos vinculados ({firmaLinkedDocs.length})</p>
                          <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                            {firmaLinkedDocs.map((doc) => (
                              <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-muted/30 border border-border rounded-lg">
                                <FileText size={13} className="text-muted-foreground flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-foreground truncate">{doc.nombre}</p>
                                  <p className="text-[10px] text-muted-foreground">{formatDate(doc.created_at)}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {firmaLinkedDocs.length === 0 && !firmaMetaLoading && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Documentos vinculados</p>
                          <p className="text-xs text-muted-foreground">Sin documentos vinculados aún</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-full max-w-sm mx-auto border border-border rounded-xl bg-gray-50 flex items-center justify-center" style={{ minHeight: '120px' }}>
                  <p className="text-sm text-muted-foreground/60">No hay firma guardada</p>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Tu firma autógrafa se guardará automáticamente cuando firmes un documento y elijas conservarla.
                </p>
              </div>
            )}

            {/* Autógrafa Stamp Selector */}
            <div className="border-t border-border pt-4">
              <AutografaStampSelector
                signatureUrl={savedSignature}
                userName={profile.nombre ? `${profile.nombre} ${profile.apellidoPaterno}`.trim() : null}
                userRfc={profile.rfc || null}
                currentStampStyle={autografaStampStyle}
                onSave={handleSaveAutografaStamp}
              />
            </div>
          </div>
        )}

        {/* ── Tab: e.Firma SAT ── */}
        {firmasTab === 'efirma' && (
          <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-700 text-foreground">e.Firma (SAT)</h3>
            </div>

            {efirmaLinked && efirmaData ? (
              <div className="flex flex-col gap-3">
                {/* Linked state */}
                <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
                        <ShieldCheck size={18} className="text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-sm font-700 text-foreground">e.Firma (SAT) vinculada</p>
                        <span className="flex items-center gap-1 text-xs font-600 text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full w-fit mt-0.5">
                          <CheckCircle size={10} />Vinculada
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleUnlinkEfirma}
                      disabled={efirmaUnlinking}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-lg text-xs text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                    >
                      {efirmaUnlinking ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Desvincular
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 pt-1 border-t border-emerald-200">
                    {efirmaData.nombre && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">TITULAR</p>
                        <p className="text-xs font-600 text-foreground mt-0.5">{efirmaData.nombre}</p>
                      </div>
                    )}
                    {efirmaData.rfc && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">RFC</p>
                        <p className="text-xs font-600 text-foreground font-mono mt-0.5">{efirmaData.rfc}</p>
                      </div>
                    )}
                    {efirmaData.vigenciaFin && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">VIGENCIA</p>
                        <p className="text-xs font-600 text-foreground mt-0.5">{efirmaData.vigenciaFin}</p>
                      </div>
                    )}
                    {efirmaData.linkedAt && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">VINCULADA EL</p>
                        <p className="text-xs font-600 text-foreground mt-0.5">{formatDate(efirmaData.linkedAt)}</p>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setShowEfirmaModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors"
                >
                  <RefreshCw size={15} />
                  Actualizar e.Firma
                </button>

                {/* Stamp Selector */}
                <div className="border-t border-border pt-4">
                  <EfirmaStampSelector
                    efirmaData={{
                      rfc: efirmaData.rfc,
                      nombre: efirmaData.nombre,
                      vigenciaFin: efirmaData.vigenciaFin,
                    }}
                    currentStampStyle={efirmaStampStyle}
                    onSave={handleSaveEfirmaStamp}
                  />
                </div>
              </div>
            ) : (
              <div className="border border-border rounded-xl p-8 flex flex-col items-center gap-3 bg-gray-50/50">
                <div className="w-12 h-12 rounded-full border-2 border-gray-300 flex items-center justify-center">
                  <X size={20} className="text-gray-400" />
                </div>
                <p className="text-sm font-700 text-foreground">Sin e.Firma (SAT) vinculada</p>
                <p className="text-xs text-muted-foreground text-center max-w-xs">
                  <span className="text-primary">Vincula tu e.Firma</span> para firmar documentos con la{' '}
                  <span className="text-primary">máxima validez legal</span>.
                </p>
                <button
                  onClick={() => setShowEfirmaModal(true)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors"
                >
                  <Link2 size={15} />
                  Vincular e.Firma
                </button>

                {/* Stamp Selector even when not linked */}
                <div className="w-full border-t border-border pt-4 mt-2">
                  <EfirmaStampSelector
                    efirmaData={{ rfc: null, nombre: null, vigenciaFin: null }}
                    currentStampStyle={efirmaStampStyle}
                    onSave={handleSaveEfirmaStamp}
                  />
                </div>
              </div>
            )}

            <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
              <ShieldCheck size={15} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                La e.Firma es emitida por el SAT y tiene la misma validez legal que una firma autógrafa.
                Requiere tu archivo <strong>.cer</strong>, <strong>.key</strong> y contraseña de clave privada.
              </p>
            </div>
          </div>
        )}

        {/* ── Tab: Click & Sign ── */}
        {firmasTab === 'clicksign' && (
          <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-700 text-foreground">Click &amp; Sign</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Firma electrónica simple mediante{' '}
                <span className="text-primary">clic confirmado</span> y código OTP de un solo uso.
              </p>
            </div>
            <ClickSignStampSelector
              userName={profile?.nombre ? `${profile.nombre} ${profile.apellidoPaterno}`.trim() : null}
              userRfc={profile?.rfc || null}
              currentStampStyle={clickSignStampStyle}
              onSave={handleSaveClickSignStamp}
            />
          </div>
        )}
      </div>
    );
  };

  // ─── Render Seguridad ─────────────────────────────────────────────────────

  const renderSeguridad = () => {
    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return '—';
      return new Date(dateStr).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    };
    const formatDateTime = (dateStr: string | null) => {
      if (!dateStr) return '—';
      return new Date(dateStr).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    const getDeviceIcon = (type: string | null) => {
      switch (type) {
        case 'mobile': return <Smartphone size={16} className="text-muted-foreground" />;
        case 'tablet': return <Tablet size={16} className="text-muted-foreground" />;
        default: return <Laptop size={16} className="text-muted-foreground" />;
      }
    };
    const getEventLabel = (type: string) => {
      switch (type) {
        case 'login': return 'Inicio de sesión';
        case 'logout': return 'Cierre de sesión';
        case 'password_change': return 'Cambio de contraseña';
        case 'session_revoked': return 'Sesión revocada';
        case 'mfa_enabled': return '2FA activado';
        case 'mfa_disabled': return '2FA desactivado';
        default: return type;
      }
    };
    const getEventColor = (type: string, status: string) => {
      if (status === 'failed') return 'text-red-600 bg-red-50';
      switch (type) {
        case 'login': return 'text-green-700 bg-green-50';
        case 'logout': return 'text-gray-600 bg-gray-100';
        case 'password_change': return 'text-blue-700 bg-blue-50';
        case 'session_revoked': return 'text-orange-700 bg-orange-50';
        default: return 'text-primary bg-primary/10';
      }
    };
    const passwordStrength = (pwd: string) => {
      if (!pwd) return { score: 0, label: '', color: '' };
      let score = 0;
      if (pwd.length >= 8) score++;
      if (pwd.length >= 12) score++;
      if (/[A-Z]/.test(pwd)) score++;
      if (/[0-9]/.test(pwd)) score++;
      if (/[^A-Za-z0-9]/.test(pwd)) score++;
      if (score <= 1) return { score, label: 'Muy débil', color: 'bg-red-500' };
      if (score === 2) return { score, label: 'Débil', color: 'bg-orange-400' };
      if (score === 3) return { score, label: 'Regular', color: 'bg-yellow-400' };
      if (score === 4) return { score, label: 'Fuerte', color: 'bg-green-400' };
      return { score, label: 'Muy fuerte', color: 'bg-green-600' };
    };
    const strength = passwordStrength(passwordForm.newPassword);

    // Filter activity by period
    const getFilteredActivity = () => {
      const now = new Date();
      // Use UTC date parts to match how timestamps are stored in the DB
      const todayY = now.getUTCFullYear();
      const todayM = now.getUTCMonth();
      const todayD = now.getUTCDate();
      return loginActivity.filter((a) => {
        // Ensure the timestamp is parsed as UTC (add Z if missing)
        const rawTs = a.created_at || '';
        const ts = rawTs && !rawTs.endsWith('Z') && !rawTs.includes('+') ? rawTs + 'Z' : rawTs;
        const d = new Date(ts);
        if (activityFilter === 'today') {
          // Compare UTC date parts to match DB storage timezone
          return d.getUTCFullYear() === todayY && d.getUTCMonth() === todayM && d.getUTCDate() === todayD;
        } else if (activityFilter === 'week') {
          const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
          return d >= weekAgo;
        } else if (activityFilter === '30days') {
          const ago = new Date(now); ago.setDate(now.getDate() - 30);
          return d >= ago;
        } else if (activityFilter === '90days') {
          const ago = new Date(now); ago.setDate(now.getDate() - 90);
          return d >= ago;
        }
        return true; // 'all'
      });
    };
    const filteredActivity = getFilteredActivity();
    const ACTIVITY_PAGE_SIZE = 10;
    const activityTotalPages = Math.max(1, Math.ceil(filteredActivity.length / ACTIVITY_PAGE_SIZE));
    const pagedActivity = filteredActivity.slice((activityPage - 1) * ACTIVITY_PAGE_SIZE, activityPage * ACTIVITY_PAGE_SIZE);

    const filterOptions: { value: typeof activityFilter; label: string }[] = [
      { value: 'today', label: 'Hoy' },
      { value: 'week', label: 'Esta semana' },
      { value: '30days', label: 'Últimos 30 días' },
      { value: '90days', label: 'Últimos 90 días' },
      { value: 'all', label: 'Todo el historial' },
    ];

    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Lock size={24} className="text-primary" />
              Seguridad
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Gestiona tu contraseña y sesiones activas.</p>
          </div>
        </div>

        {/* Contraseña */}
        <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><KeyRound size={15} className="text-primary" /></div>
            <div>
              <h3 className="text-sm font-700 text-foreground">Contraseña</h3>
              <p className="text-xs text-muted-foreground">Gestiona tu contraseña de acceso</p>
            </div>
          </div>

          {/* Info box: password creation date */}
          {!showPasswordForm && (
            <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <KeyRound size={16} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-600 text-foreground">Contraseña establecida</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock size={11} />
                    {passwordCreatedAt ? `Última actualización: ${formatDate(passwordCreatedAt)}` : 'Fecha no disponible'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { setShowPasswordForm(true); setPasswordMsg(null); setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-xs font-600 hover:bg-primary/90 transition-colors flex-shrink-0"
              >
                <RefreshCw size={12} />
                Cambiar contraseña
              </button>
            </div>
          )}

          {/* Change password form */}
          {showPasswordForm && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3">
                {(['current', 'new', 'confirm'] as const).map((field) => {
                  const labels = { current: 'Contraseña actual', new: 'Nueva contraseña', confirm: 'Confirmar nueva contraseña' };
                  const keys = { current: 'currentPassword', new: 'newPassword', confirm: 'confirmPassword' } as const;
                  return (
                    <div key={field}>
                      <label className={labelClass}>{labels[field]}</label>
                      <div className="relative">
                        <input
                          type={showPasswords[field] ? 'text' : 'password'}
                          value={passwordForm[keys[field]]}
                          onChange={(e) => setPasswordForm((prev) => ({ ...prev, [keys[field]]: e.target.value }))}
                          placeholder={field === 'current' ? '••••••••' : field === 'new' ? 'Mínimo 8 caracteres' : 'Repite la nueva contraseña'}
                          className={inputClass + ' pr-10'}
                        />
                        <button type="button" onClick={() => setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPasswords[field] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      {field === 'new' && passwordForm.newPassword && (
                        <div className="mt-1.5 space-y-1">
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((i) => (
                              <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= strength.score ? strength.color : 'bg-gray-200'}`} />
                            ))}
                          </div>
                          {strength.label && <p className="text-xs text-muted-foreground">Seguridad: <span className="font-600">{strength.label}</span></p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {passwordMsg && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${passwordMsg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                  {passwordMsg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  {passwordMsg.text}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={handlePasswordChange} disabled={passwordSaving} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-60">
                  {passwordSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Guardar contraseña
                </button>
                <button onClick={() => { setShowPasswordForm(false); setPasswordMsg(null); setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); }} className="flex items-center gap-2 px-4 py-2 border border-border text-foreground rounded-lg text-sm font-600 hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sesiones Activas */}
        <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><MonitorSmartphone size={15} className="text-primary" /></div>
              <div>
                <h3 className="text-sm font-700 text-foreground">Sesiones Activas</h3>
                <p className="text-xs text-muted-foreground">Dispositivos con sesión iniciada</p>
              </div>
            </div>
            {sessionsLoading && <Loader2 size={14} className="text-primary animate-spin" />}
          </div>
          <div className="flex flex-col gap-2">
            {sessions.map((session) => (
              <div key={session.id} className={`flex items-center gap-3 p-3 rounded-lg border ${session.is_current ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">{getDeviceIcon(session.device_type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-600 text-foreground truncate">{session.device_name || 'Dispositivo desconocido'}</p>
                    {session.is_current && <span className="text-[10px] font-600 text-primary bg-primary/10 px-1.5 py-0.5 rounded-full flex-shrink-0">Actual</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{[session.browser, session.os].filter(Boolean).join(' · ')}</p>
                  <p className="text-xs text-muted-foreground">Última actividad: {formatDate(session.last_active_at)}</p>
                </div>
                <button
                  onClick={() => handleRevokeSession(session.id)}
                  disabled={revokingSession === session.id}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-red-200 rounded-lg text-xs text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60 flex-shrink-0"
                >
                  {revokingSession === session.id ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} />}
                  Cerrar sesión
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Actividad de Acceso */}
        <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Activity size={15} className="text-primary" /></div>
              <div>
                <h3 className="text-sm font-700 text-foreground">Actividad de Acceso</h3>
                <p className="text-xs text-muted-foreground">Historial de sesiones registradas</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {filterOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setActivityFilter(opt.value); setActivityPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-600 transition-colors ${activityFilter === opt.value ? 'bg-primary text-white' : 'bg-gray-100 text-muted-foreground hover:bg-gray-200'}`}
                >
                  {opt.label}
                </button>
              ))}
              {activityLoading && <Loader2 size={14} className="text-primary animate-spin ml-1" />}
            </div>
          </div>

          {filteredActivity.length === 0 && !activityLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">No hay actividad registrada en este período.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-border">
                    <th className="text-left px-3 py-2.5 text-xs font-600 text-muted-foreground whitespace-nowrap">Fecha</th>
                    <th className="text-left px-3 py-2.5 text-xs font-600 text-muted-foreground whitespace-nowrap">Hora</th>
                    <th className="text-left px-3 py-2.5 text-xs font-600 text-muted-foreground whitespace-nowrap">Evento</th>
                    <th className="text-left px-3 py-2.5 text-xs font-600 text-muted-foreground whitespace-nowrap">Dispositivo</th>
                    <th className="text-left px-3 py-2.5 text-xs font-600 text-muted-foreground whitespace-nowrap">Navegador</th>
                    <th className="text-left px-3 py-2.5 text-xs font-600 text-muted-foreground whitespace-nowrap">Sistema Operativo</th>
                    <th className="text-left px-3 py-2.5 text-xs font-600 text-muted-foreground whitespace-nowrap">Ubicación</th>
                    <th className="text-left px-3 py-2.5 text-xs font-600 text-muted-foreground whitespace-nowrap">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedActivity.map((activity, idx) => {
                    const d = new Date(activity.created_at);
                    const dateStr = d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const timeStr = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <tr key={activity.id} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                        <td className="px-3 py-2.5 text-xs text-foreground whitespace-nowrap">{dateStr}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{timeStr}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-600 ${getEventColor(activity.event_type, activity.status)}`}>
                            {getEventLabel(activity.event_type)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-foreground whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {getDeviceIcon(activity.device_type)}
                            <span>{activity.device_name || activity.device_type || '—'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{activity.browser || '—'}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{activity.os || '—'}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {activity.location ? (
                            <span className="flex items-center gap-1"><Globe size={10} />{activity.location}</span>
                          ) : activity.ip_address ? activity.ip_address : '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-600 ${activity.status === 'success' ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                            {activity.status === 'success' ? 'Exitoso' : 'Fallido'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filteredActivity.length > 0 && (
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                Mostrando {Math.min((activityPage - 1) * ACTIVITY_PAGE_SIZE + 1, filteredActivity.length)}–{Math.min(activityPage * ACTIVITY_PAGE_SIZE, filteredActivity.length)} de {filteredActivity.length} registros
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActivityPage(1)}
                  disabled={activityPage === 1}
                  className="px-2 py-1 rounded text-xs font-600 bg-gray-100 text-muted-foreground hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >«</button>
                <button
                  onClick={() => setActivityPage(p => Math.max(1, p - 1))}
                  disabled={activityPage === 1}
                  className="px-2 py-1 rounded text-xs font-600 bg-gray-100 text-muted-foreground hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >‹</button>
                {Array.from({ length: activityTotalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === activityTotalPages || Math.abs(p - activityPage) <= 1)
                  .reduce<(number | '...')[]>((acc, p, i, arr) => {
                    if (i > 0 && typeof arr[i - 1] === 'number' && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === '...' ? (
                      <span key={`ellipsis-${i}`} className="px-1.5 py-1 text-xs text-muted-foreground">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setActivityPage(p as number)}
                        className={`px-2.5 py-1 rounded text-xs font-600 transition-colors ${activityPage === p ? 'bg-primary text-white' : 'bg-gray-100 text-muted-foreground hover:bg-gray-200'}`}
                      >{p}</button>
                    )
                  )}
                <button
                  onClick={() => setActivityPage(p => Math.min(activityTotalPages, p + 1))}
                  disabled={activityPage === activityTotalPages}
                  className="px-2 py-1 rounded text-xs font-600 bg-gray-100 text-muted-foreground hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >›</button>
                <button
                  onClick={() => setActivityPage(activityTotalPages)}
                  disabled={activityPage === activityTotalPages}
                  className="px-2 py-1 rounded text-xs font-600 bg-gray-100 text-muted-foreground hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >»</button>
              </div>
            </div>
          )}
        </div>

        {/* Eventos de Seguridad */}
        {(() => {
          const SEC_PAGE_SIZE = 10;

          const getSecEventLabel = (type: string) => {
            switch (type) {
              case 'session_timeout_inactivity': return 'Timeout por inactividad';
              case 'session_timeout_absolute': return 'Timeout límite absoluto';
              case 'login_attempt': return 'Intento de inicio de sesión';
              case 'login_success': return 'Inicio de sesión exitoso';
              case 'login_failed': return 'Inicio de sesión fallido';
              case 'LOGIN_TOTP_SUCCESS': return 'Login con TOTP exitoso';
              case 'LOGIN_TOTP_FAILED': return 'Intento fallido de TOTP';
              case 'LOGIN_TOTP_LOCKED': return 'Cuenta bloqueada temporalmente';
              case 'device_enrolled': return 'Dispositivo enrolado';
              case 'device_revoked': return 'Dispositivo revocado';
              case 'mfa_enabled': case 'TOTP_ENABLED': return 'MFA activado';
              case 'mfa_disabled': case 'TOTP_DISABLED': return 'MFA desactivado';
              case 'TOTP_SETUP_STARTED': return 'Configuración MFA iniciada';
              case 'TOTP_SETUP_FAILED': return 'Código incorrecto en configuración';
              case 'webauthn_registered': return 'Dispositivo WebAuthn registrado';
              case 'webauthn_revoked': return 'Dispositivo WebAuthn revocado';
              case 'password_change': return 'Cambio de contraseña';
              default: return type.replace(/_/g, ' ');
            }
          };

          const getSecEventCategory = (type: string): 'timeout' | 'login' | 'device' | 'mfa' | 'other' => {
            if (type.includes('timeout') || type.includes('session_timeout')) return 'timeout';
            if (type.includes('login') || type.includes('LOGIN')) return 'login';
            if (type.includes('device') || type.includes('webauthn') || type.includes('enrolled')) return 'device';
            if (type.includes('mfa') || type.includes('totp') || type.includes('TOTP')) return 'mfa';
            return 'other';
          };

          const getSecEventBadge = (type: string) => {
            const cat = getSecEventCategory(type);
            switch (cat) {
              case 'timeout': return 'bg-orange-50 text-orange-700 border-orange-200';
              case 'login':
                if (type.includes('failed') || type.includes('FAILED') || type.includes('LOCKED')) return 'bg-red-50 text-red-700 border-red-200';
                return 'bg-blue-50 text-blue-700 border-blue-200';
              case 'device': return 'bg-purple-50 text-purple-700 border-purple-200';
              case 'mfa':
                if (type.includes('disabled') || type.includes('DISABLED') || type.includes('FAILED')) return 'bg-red-50 text-red-700 border-red-200';
                return 'bg-green-50 text-green-700 border-green-200';
              default: return 'bg-gray-50 text-gray-700 border-gray-200';
            }
          };

          const parseSecUserAgent = (ua: string | null) => {
            if (!ua) return null;
            let browser = '';
            let os = '';
            if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
            else if (ua.includes('Firefox')) browser = 'Firefox';
            else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
            else if (ua.includes('Edg')) browser = 'Edge';
            if (ua.includes('Windows')) os = 'Windows';
            else if (ua.includes('Mac OS')) os = 'macOS';
            else if (ua.includes('Android')) os = 'Android';
            else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
            else if (ua.includes('Linux')) os = 'Linux';
            return [browser, os].filter(Boolean).join(' · ') || null;
          };

          // Filter by date
          const now = new Date();
          const dateFiltered = securityEvents.filter((ev) => {
            const raw = ev.created_at;
            const ts = raw && !raw.endsWith('Z') && !raw.includes('+') ? raw + 'Z' : raw;
            const d = new Date(ts);
            if (secEventDateFilter === 'today') {
              return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate();
            } else if (secEventDateFilter === 'week') {
              const ago = new Date(now); ago.setDate(now.getDate() - 7); return d >= ago;
            } else if (secEventDateFilter === '30days') {
              const ago = new Date(now); ago.setDate(now.getDate() - 30); return d >= ago;
            } else if (secEventDateFilter === '90days') {
              const ago = new Date(now); ago.setDate(now.getDate() - 90); return d >= ago;
            }
            return true;
          });

          // Filter by event type
          const typeFiltered = secEventTypeFilter === 'all'
            ? dateFiltered
            : dateFiltered.filter((ev) => getSecEventCategory(ev.event_type) === secEventTypeFilter);

          // Unique devices from user_agent
          const allDevices = Array.from(new Set(
            securityEvents.map((ev) => parseSecUserAgent(ev.user_agent)).filter(Boolean)
          )) as string[];

          // Filter by device
          const fullyFiltered = secEventDeviceFilter === 'all'
            ? typeFiltered
            : typeFiltered.filter((ev) => parseSecUserAgent(ev.user_agent) === secEventDeviceFilter);

          const totalPages = Math.max(1, Math.ceil(fullyFiltered.length / SEC_PAGE_SIZE));
          const paged = fullyFiltered.slice((secEventsPage - 1) * SEC_PAGE_SIZE, secEventsPage * SEC_PAGE_SIZE);

          const dateFilterOpts: { value: typeof secEventDateFilter; label: string }[] = [
            { value: 'today', label: 'Hoy' },
            { value: 'week', label: 'Esta semana' },
            { value: '30days', label: 'Últimos 30 días' },
            { value: '90days', label: 'Últimos 90 días' },
            { value: 'all', label: 'Todo' },
          ];

          const typeFilterOpts = [
            { value: 'all', label: 'Todos los tipos' },
            { value: 'timeout', label: 'Timeouts de sesión' },
            { value: 'login', label: 'Intentos de login' },
            { value: 'device', label: 'Enrolamiento de dispositivos' },
            { value: 'mfa', label: 'Cambios de MFA' },
          ];

          return (
            <div className="bg-white border border-border rounded-xl p-5 flex flex-col gap-4">
              {/* Header */}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Shield size={15} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-700 text-foreground">Eventos de Seguridad</h3>
                  <p className="text-xs text-muted-foreground">Registro completo de eventos de seguridad de la cuenta</p>
                </div>
                {secEventsLoading && <Loader2 size={14} className="text-primary animate-spin ml-auto" />}
              </div>

              {/* Filters */}
              <div className="flex flex-col gap-2.5">
                {/* Date filter */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground font-600 mr-1">Fecha:</span>
                  {dateFilterOpts.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setSecEventDateFilter(opt.value); setSecEventsPage(1); }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-600 transition-colors ${secEventDateFilter === opt.value ? 'bg-primary text-white' : 'bg-gray-100 text-muted-foreground hover:bg-gray-200'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Type + Device filters */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground font-600">Tipo:</span>
                  <select
                    value={secEventTypeFilter}
                    onChange={(e) => { setSecEventTypeFilter(e.target.value); setSecEventsPage(1); }}
                    className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                  >
                    {typeFilterOpts.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>

                  {allDevices.length > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground font-600 ml-2">Dispositivo:</span>
                      <select
                        value={secEventDeviceFilter}
                        onChange={(e) => { setSecEventDeviceFilter(e.target.value); setSecEventsPage(1); }}
                        className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                      >
                        <option value="all">Todos los dispositivos</option>
                        {allDevices.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              </div>

              {/* Events list */}
              {secEventsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={20} className="text-primary animate-spin" />
                </div>
              ) : fullyFiltered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Shield size={28} className="text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">No hay eventos de seguridad en este período.</p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col divide-y divide-border">
                    {paged.map((ev) => {
                      const raw = ev.created_at;
                      const ts = raw && !raw.endsWith('Z') && !raw.includes('+') ? raw + 'Z' : raw;
                      const d = new Date(ts);
                      const dateStr = d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
                      const timeStr = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                      const deviceLabel = parseSecUserAgent(ev.user_agent);
                      return (
                        <div key={ev.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                          <div className="flex-shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center">
                            {getSecEventCategory(ev.event_type) === 'timeout' && <Clock size={13} className="text-orange-500" />}
                            {getSecEventCategory(ev.event_type) === 'login' && (
                              ev.event_type.includes('failed') || ev.event_type.includes('FAILED') || ev.event_type.includes('LOCKED')
                                ? <AlertCircle size={13} className="text-red-500" />
                                : <LogOut size={13} className="text-blue-500" />
                            )}
                            {getSecEventCategory(ev.event_type) === 'device' && <Smartphone size={13} className="text-purple-500" />}
                            {getSecEventCategory(ev.event_type) === 'mfa' && <Shield size={13} className="text-green-600" />}
                            {getSecEventCategory(ev.event_type) === 'other' && <Shield size={13} className="text-muted-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className={`inline-flex items-center text-xs font-600 px-2 py-0.5 rounded-full border ${getSecEventBadge(ev.event_type)}`}>
                                {getSecEventLabel(ev.event_type)}
                              </span>
                            </div>
                            {ev.description && (
                              <p className="text-xs text-muted-foreground mb-1">{ev.description}</p>
                            )}
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-xs text-muted-foreground">{dateStr} {timeStr}</span>
                              {ev.ip_address && ev.ip_address !== 'unknown' && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Globe size={10} />
                                  {ev.ip_address}
                                </span>
                              )}
                              {deviceLabel && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Laptop size={10} />
                                  {deviceLabel}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Pagination */}
                  {fullyFiltered.length > SEC_PAGE_SIZE && (
                    <div className="flex items-center justify-between pt-1 border-t border-border">
                      <p className="text-xs text-muted-foreground">
                        Mostrando {Math.min((secEventsPage - 1) * SEC_PAGE_SIZE + 1, fullyFiltered.length)}–{Math.min(secEventsPage * SEC_PAGE_SIZE, fullyFiltered.length)} de {fullyFiltered.length} eventos
                      </p>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setSecEventsPage(1)} disabled={secEventsPage === 1} className="px-2 py-1 rounded text-xs font-600 bg-gray-100 text-muted-foreground hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">«</button>
                        <button onClick={() => setSecEventsPage(p => Math.max(1, p - 1))} disabled={secEventsPage === 1} className="px-2 py-1 rounded text-xs font-600 bg-gray-100 text-muted-foreground hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">‹</button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                          .filter(p => p === 1 || p === totalPages || Math.abs(p - secEventsPage) <= 1)
                          .reduce<(number | '...')[]>((acc, p, i, arr) => {
                            if (i > 0 && typeof arr[i - 1] === 'number' && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
                            acc.push(p);
                            return acc;
                          }, [])
                          .map((p, i) =>
                            p === '...' ? (
                              <span key={`sec-ellipsis-${i}`} className="px-1.5 py-1 text-xs text-muted-foreground">…</span>
                            ) : (
                              <button
                                key={p}
                                onClick={() => setSecEventsPage(p as number)}
                                className={`px-2.5 py-1 rounded text-xs font-600 transition-colors ${secEventsPage === p ? 'bg-primary text-white' : 'bg-gray-100 text-muted-foreground hover:bg-gray-200'}`}
                              >{p}</button>
                            )
                          )}
                        <button onClick={() => setSecEventsPage(p => Math.min(totalPages, p + 1))} disabled={secEventsPage === totalPages} className="px-2 py-1 rounded text-xs font-600 bg-gray-100 text-muted-foreground hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">›</button>
                        <button onClick={() => setSecEventsPage(totalPages)} disabled={secEventsPage === totalPages} className="px-2 py-1 rounded text-xs font-600 bg-gray-100 text-muted-foreground hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">»</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}
      </div>
    );
  };

  // ─── Browser/OS Detection Helpers ─────────────────────────────────────────────

  function getBrowserName(): string {
    if (typeof window === 'undefined') return 'Desconocido';
    const ua = navigator.userAgent;
    if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
    if (ua.includes('Edg')) return 'Edge';
    if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera';
    return 'Navegador desconocido';
  }

  function getOSName(): string {
    if (typeof window === 'undefined') return 'Desconocido';
    const ua = navigator.userAgent;
    if (ua.includes('Windows')) return 'Windows';
    if (ua.includes('Mac OS')) return 'macOS';
    if (ua.includes('Linux')) return 'Linux';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    return 'SO desconocido';
  }

  const renderContent = () => {
    switch (activeSection) {
      case 'informacion-personal': return renderInformacionPersonal();
      case 'espacios-trabajo': return renderEspaciosTrabajo();
      case 'verificacion': return renderVerificacion();
      case 'proteccion-acceso': return renderProteccionAcceso();
      case 'firmas': return renderFirmas();
      case 'seguridad': return renderSeguridad();
      case 'mi-expediente': return renderMiExpediente();
      case 'privacidad': return renderPrivacidad();
      default: return null;
    }
  };

  // ─── Mi Expediente ────────────────────────────────────────────────────────

  const renderMiExpediente = () => {
    return (
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <FolderOpen size={22} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Mi Expediente</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Documentos de respaldo que puedes compartir cuando te los soliciten</p>
          </div>
        </div>

        {/* Info box */}
        <div className="bg-gray-50 border border-border rounded-xl px-4 py-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Privacidad:</span> Estos documentos son privados por defecto y solo se comparten cuando tú lo autorizas explícitamente. Son distintos de los documentos que envías o firmas dentro de la plataforma.
          </p>
        </div>

        {/* Documentos solicitados */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-sm font-700 text-foreground">Documentos solicitados</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Documentos que un workspace ha solicitado y aún no has subido</p>
          </div>
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <CheckCircle size={22} className="text-gray-400" />
            </div>
            <p className="text-sm font-600 text-foreground">No tienes documentos pendientes por subir</p>
            <p className="text-xs text-muted-foreground">Cuando un workspace te solicite documentos, aparecerán aquí</p>
          </div>
        </div>

        {/* Documentos de mi expediente */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-700 text-foreground">Documentos de mi expediente</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Catálogo de documentos de identidad y respaldo</p>
            </div>
            <button className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-xs font-600 hover:bg-primary/90 transition-colors">
              <Upload size={13} />
              Agregar documento
            </button>
          </div>
          <div className="divide-y divide-border">
            {[
              { tipo: 'INE', desc: 'Credencial para votar', slots: ['Frente', 'Reverso'], vigencia: true },
              { tipo: 'Comprobante de domicilio', desc: 'Máximo 3 meses de antigüedad', slots: null, vigencia: true },
              { tipo: 'Constancia de situación fiscal (SAT)', desc: 'Constancia actualizada del SAT', slots: null, vigencia: false },
              { tipo: 'Poder notarial', desc: 'Solo para persona moral', slots: null, vigencia: true },
              { tipo: 'Comprobante de ingresos', desc: 'Recibo de nómina o estado de cuenta', slots: null, vigencia: false },
              { tipo: 'Otro', desc: 'Documento adicional', slots: null, vigencia: false },
            ].map((doc) => (
              <div key={doc.tipo} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-600 text-foreground">{doc.tipo}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">Sin subir</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{doc.desc}</p>
                  {doc.slots && (
                    <div className="flex gap-2 mt-1.5">
                      {doc.slots.map((slot) => (
                        <span key={slot} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{slot}</span>
                      ))}
                    </div>
                  )}
                </div>
                <button className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs text-foreground hover:bg-gray-50 transition-colors flex-shrink-0">
                  <Upload size={12} />
                  Subir
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Compartidos activos */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-sm font-700 text-foreground">Compartidos activos</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Documentos actualmente compartidos con workspaces</p>
          </div>
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <Globe size={22} className="text-gray-400" />
            </div>
            <p className="text-sm font-600 text-foreground">No tienes documentos compartidos activos</p>
          </div>
        </div>

        {/* Historial de accesos */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-sm font-700 text-foreground">Historial de accesos y consentimiento</h3>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Este registro sirve como evidencia de consentimiento para el uso de datos personales conforme a la <span className="font-semibold">LFPDPPP</span>.
            </p>
          </div>
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <Activity size={22} className="text-gray-400" />
            </div>
            <p className="text-sm font-600 text-foreground">Sin registros de acceso</p>
            <p className="text-xs text-muted-foreground">Los accesos a tus documentos compartidos aparecerán aquí</p>
          </div>
        </div>
      </div>
    );
  };

  // ─── Privacidad ───────────────────────────────────────────────────────────

  const renderPrivacidad = () => {
    return (
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Shield size={22} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Privacidad</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Quién puede ver tu información</p>
          </div>
        </div>

        {/* Legal note */}
        <div className="bg-gray-50 border border-border rounded-xl px-4 py-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Nota legal:</span> La información dentro de documentos firmados (nombre, RFC, evidencia legal) siempre es visible para las partes del documento por requerimiento legal. Esta sección solo controla la visibilidad de tu perfil general.
          </p>
        </div>

        {/* Alcance de visibilidad */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-sm font-700 text-foreground">Alcance de visibilidad de mi perfil</h3>
          </div>
          <div className="p-5 flex flex-col gap-3">
            {[
              { id: 'workspaces', label: 'Solo mis workspaces', desc: 'Solo los miembros de tus espacios de trabajo pueden ver tu perfil' },
              { id: 'contactos', label: 'Mis contactos', desc: 'Tus contactos y miembros de workspaces pueden ver tu perfil' },
              { id: 'cualquiera', label: 'Cualquier usuario de DOCUBOX', desc: 'Cualquier usuario registrado en la plataforma puede ver tu perfil' },
              { id: 'nadie', label: 'Nadie', desc: 'Tu perfil es completamente privado' },
            ].map((opt, idx) => (
              <label key={opt.id} className="flex items-start gap-3 p-3 border border-border rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
                <input type="radio" name="visibilidad" defaultChecked={idx === 0} className="mt-0.5 accent-primary" />
                <div>
                  <p className="text-sm font-600 text-foreground">{opt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Visibilidad por campo */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-sm font-700 text-foreground">Visibilidad por campo</h3>
          </div>
          <div className="divide-y divide-border">
            {[
              { campo: 'Foto de perfil', desc: 'Tu imagen de perfil' },
              { campo: 'Teléfono', desc: 'Número de contacto' },
              { campo: 'Puesto o cargo', desc: 'Tu rol o posición' },
              { campo: 'Empresa', desc: 'Organización a la que perteneces' },
              { campo: 'Última conexión', desc: 'Cuándo fue tu última actividad' },
            ].map((item) => (
              <div key={item.campo} className="px-5 py-3.5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-600 text-foreground">{item.campo}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <select className="text-xs border border-border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground">
                  <option>Mi workspace</option>
                  <option>Mis contactos</option>
                  <option>Público</option>
                  <option>Privado</option>
                </select>
              </div>
            ))}
            {/* Firma autógrafa — locked */}
            <div className="px-5 py-3.5 flex items-center justify-between gap-4 bg-gray-50/50">
              <div>
                <p className="text-sm font-600 text-foreground">Firma autógrafa</p>
                <p className="text-xs text-muted-foreground">Tu firma digitalizada</p>
                <p className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                  <Lock size={10} />
                  No puede hacerse público por razones de seguridad
                </p>
              </div>
              <select disabled className="text-xs border border-border rounded-lg px-2 py-1.5 bg-gray-100 text-muted-foreground cursor-not-allowed opacity-70">
                <option>Privado</option>
              </select>
            </div>
          </div>
        </div>

        {/* Solicitudes de acceso */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-700 text-foreground">Solicitudes de acceso</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Requerir aprobación</span>
                <button className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors bg-gray-200 focus:outline-none">
                  <span className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform translate-x-1" />
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Requerir mi aprobación antes de que alguien fuera de mis workspaces vea mi perfil completo</p>
          </div>
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <UserPlus size={22} className="text-gray-400" />
            </div>
            <p className="text-sm font-600 text-foreground">No tienes solicitudes pendientes</p>
          </div>
        </div>

        {/* Quién ha visto tu perfil */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-sm font-700 text-foreground">Quién ha visto tu perfil</h3>
          </div>
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <Eye size={22} className="text-gray-400" />
            </div>
            <p className="text-sm font-600 text-foreground">Sin visitas registradas</p>
            <p className="text-xs text-muted-foreground">Las visitas a tu perfil aparecerán aquí</p>
          </div>
        </div>

        {/* Usuarios bloqueados */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-sm font-700 text-foreground">Usuarios bloqueados</h3>
          </div>
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <Shield size={22} className="text-gray-400" />
            </div>
            <p className="text-sm font-600 text-foreground">No tienes usuarios bloqueados</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <AppLayout noPadding>
      <div className="flex min-h-[calc(100vh-128px)]">
        <div className="flex flex-col md:flex-row w-full flex-1">
        {/* Internal Sidebar — horizontal tabs on mobile, vertical sidebar on md+ */}
        <aside className="w-full md:w-52 2xl:w-64 flex-shrink-0 bg-white border-b md:border-b-0 md:border-r border-border flex flex-col">
          <nav className="flex flex-row md:flex-col overflow-x-auto md:overflow-x-visible space-x-1 md:space-x-0 md:space-y-0.5 pt-2 md:pt-3 px-2 pb-2 md:pb-4 scrollbar-thin">
            {sidebarItems.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`flex-shrink-0 md:w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 text-left whitespace-nowrap ${
                    isActive ? 'bg-primary/10 text-primary font-600 shadow-sm' : 'text-foreground hover:bg-gray-100 hover:text-primary'
                  }`}
                >
                  <item.icon size={15} className={`flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <div className="flex-1 overflow-auto bg-background px-4 md:px-6 py-5">
          {renderContent()}
        </div>
        </div>
      </div>

      {/* Modals */}
      {showJoinModal && <JoinWorkspaceModal onClose={() => setShowJoinModal(false)} />}

      {/* Enrollment QR Modal */}
      {showEnrollmentQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                  <Fingerprint size={20} className="text-purple-600" />
                </div>
                <div>
                  <h2 className="text-base font-700 text-foreground">Enrolamiento Biométrico</h2>
                  <p className="text-xs text-muted-foreground">Validación facial</p>
                </div>
              </div>
              <button onClick={() => { setShowEnrollmentQrModal(false); if (enrollRealtimeChannelRef.current) { const supabase = createClient(); supabase.removeChannel(enrollRealtimeChannelRef.current); enrollRealtimeChannelRef.current = null; } if (enrollPollingRef.current) { clearInterval(enrollPollingRef.current); enrollPollingRef.current = null; } }} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              {enrollBiometricCompleted ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle2 size={32} className="text-green-600" />
                  </div>
                  <p className="text-base font-700 text-green-700 text-center">¡Enrolamiento completado!</p>
                  <p className="text-sm text-muted-foreground text-center">Tu identidad biométrica ha sido verificada exitosamente.</p>
                  <button onClick={() => setShowEnrollmentQrModal(false)} className="mt-2 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors">Cerrar</button>
                </div>
              ) : (
                <>
                  {/* QR area */}
                  <div className="flex flex-col items-center gap-3 py-4 bg-gray-50 rounded-xl border border-gray-200">
                    {enrollQrLoading ? (
                      <div className="w-40 h-40 flex items-center justify-center">
                        <Loader2 size={32} className="text-primary animate-spin" />
                      </div>
                    ) : enrollQrExpired ? (
                      <div className="w-40 h-40 flex flex-col items-center justify-center gap-2">
                        <AlertCircle size={32} className="text-red-400" />
                        <p className="text-sm text-red-500 font-semibold text-center">Código expirado</p>
                      </div>
                    ) : enrollQrUrl ? (
                      <div className="p-2 bg-white rounded-xl border border-border shadow-sm">
                        <QRCodeSVG value={enrollQrUrl} size={160} level="M" includeMargin={false} />
                      </div>
                    ) : (
                      <div className="w-40 h-40 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-300 rounded-xl">
                        <QrCode size={36} className="text-gray-300" />
                        <p className="text-xs text-muted-foreground text-center leading-tight px-3">Genera el código QR para comenzar</p>
                      </div>
                    )}
                    {enrollQrUrl && !enrollQrExpired && (
                      <div className="flex items-center gap-1.5">
                        <Clock size={13} className={enrollQrTimeLeft < 60 ? 'text-red-500' : 'text-muted-foreground'} />
                        <span className={`text-sm font-mono font-semibold ${enrollQrTimeLeft < 60 ? 'text-red-500' : 'text-muted-foreground'}`}>
                          Válido por {Math.floor(enrollQrTimeLeft / 60)}:{String(enrollQrTimeLeft % 60).padStart(2, '0')}
                        </span>
                      </div>
                    )}
                  </div>

                  {enrollQrError && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                      <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-600">{enrollQrError}</p>
                    </div>
                  )}

                  {(!enrollQrUrl || enrollQrExpired) && (
                    <button onClick={generateEnrollQrToken} disabled={enrollQrLoading} className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-white text-sm font-600 rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                      {enrollQrLoading ? <><Loader2 size={14} className="animate-spin" /> Generando...</> : enrollQrExpired ? <><RefreshCw size={14} /> Generar nuevo código</> : <><QrCode size={14} /> Generar código QR</>}
                    </button>
                  )}

                  {enrollQrUrl && !enrollQrExpired && (
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
                      <Loader2 size={13} className="text-blue-500 animate-spin flex-shrink-0" />
                      <span className="text-xs text-blue-600 font-medium leading-tight">Esperando enrolamiento, no cierres esta pantalla</span>
                    </div>
                  )}

                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-1.5">
                    <p className="text-xs font-bold text-blue-700">¿Cómo funciona?</p>
                    {['1. Haz clic en "Generar código QR"', '2. Escanea el QR con la cámara de tu teléfono', '3. Sigue las instrucciones en tu dispositivo móvil', '4. Toma fotos de tu ID y una selfie', '5. Los datos se validarán automáticamente aquí'].map((s) => (
                      <p key={s} className="text-xs text-blue-600 leading-tight">{s}</p>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {showSignatureModal && (
        <SignatureCanvasModal
          onClose={() => setShowSignatureModal(false)}
          onSave={handleSaveSignature}
        />
      )}

      {/* Fullscreen signature modal */}
      {showSignatureFullscreen && savedSignature && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowSignatureFullscreen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <PenTool size={20} className="text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-700 text-foreground">Firma Autógrafa Digital</h2>
                  <p className="text-xs text-muted-foreground">Vista previa de tu firma registrada</p>
                </div>
              </div>
              <button onClick={() => setShowSignatureFullscreen(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>
            <div className="p-8 flex flex-col items-center gap-6">
              <div className="w-full border-2 border-dashed border-border rounded-2xl bg-gray-50 flex items-center justify-center" style={{ minHeight: '200px' }}>
                <img src={savedSignature} alt="Firma autógrafa" className="max-h-48 max-w-full object-contain p-4" />
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
                <ShieldCheck size={14} className="text-green-600 flex-shrink-0" />
                <p className="text-xs text-green-700 font-medium">Firma almacenada de forma segura con cifrado AES-256</p>
              </div>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => { setShowSignatureFullscreen(false); setShowSignatureModal(true); }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-border rounded-lg text-sm text-foreground hover:bg-gray-50 transition-colors"
                >
                  <RotateCcw size={14} />
                  Cambiar firma
                </button>
                <button
                  onClick={() => setShowSignatureFullscreen(false)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors"
                >
                  <Check size={14} />
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showEfirmaModal && (
        <EfirmaModal
          onClose={() => setShowEfirmaModal(false)}
          onSave={handleSaveEfirma}
        />
      )}
      {showTotpModal && (
        <TotpSetupModal
          onClose={() => setShowTotpModal(false)}
          onSuccess={() => {
            setShowTotpModal(false);
            setTotpEnabled(true);
            setTotpSuccessMsg('App autenticadora activada correctamente.');
            setTimeout(() => setTotpSuccessMsg(null), 4000);
          }}
        />
      )}
      {showTotpDisableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                  <Shield size={20} className="text-red-500" />
                </div>
                <div>
                  <h2 className="text-base font-700 text-foreground">Desactivar Tóken Móvil (TOTP)</h2>
                  <p className="text-xs text-muted-foreground">Confirma con tu contraseña de acceso</p>
                </div>
              </div>
              <button onClick={() => setShowTotpDisableModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Para desactivar el Tóken Móvil, ingresa tu contraseña de usuario para confirmar la acción.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-600 text-foreground">Contraseña</label>
                <div className="relative">
                  <input
                    type={totpDisableShowPwd ? 'text' : 'password'}
                    value={totpDisablePassword}
                    onChange={(e) => setTotpDisablePassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleTotpDisable(); }}
                    disabled={totpDisableLoading}
                    placeholder="Ingresa tu contraseña"
                    className="w-full px-3 py-2.5 pr-10 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 disabled:opacity-60"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setTotpDisableShowPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {totpDisableShowPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              {totpDisableError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle size={14} />{totpDisableError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-gray-50">
              <button onClick={() => setShowTotpDisableModal(false)} className="px-4 py-2 text-sm text-foreground hover:bg-gray-100 transition-colors font-500 rounded-lg">Cancelar</button>
              <button
                onClick={handleTotpDisable}
                disabled={totpDisableLoading || !totpDisablePassword.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-500 text-white rounded-lg text-sm font-600 hover:bg-red-600 transition-colors disabled:opacity-60"
              >
                {totpDisableLoading ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                Desactivar Tóken Móvil
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}