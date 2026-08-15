'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import { QRCodeSVG } from 'qrcode.react';
import { createClient } from '@/lib/supabase/client';
import { Mail, Phone, Lock, Eye, EyeOff, User, Building2, UserCheck, Shield, Upload, CheckCircle2, QrCode, ArrowRight, ArrowLeft, FileKey, Check, AlertCircle, RefreshCw, Loader2, XCircle, Clock } from 'lucide-react';

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

interface RegistrationData {
  // Step 1
  email: string;
  phone: string;
  acceptTerms: boolean;
  // Step 2
  password: string;
  confirmPassword: string;
  // Step 3
  accountType: 'personal' | 'empresarial' | null;
  // Step 4
  personalidadJuridica: 'fisica' | 'moral' | null;
  // Step 5
  identityMethod: 'efirma' | 'biometrico' | null;
  // e.Firma files
  cerFile: File | null;
  keyFile: File | null;
  efirmaPassword: string;
  // Validated data
  validatedData: {
    nombre: string;
    rfc: string;
    curp: string;
    vigencia: string;
  } | null;
  efirmaValidationResult: EfirmaValidationResult | null;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Contacto' },
  { id: 2, label: 'Contraseña' },
  { id: 3, label: 'Tipo de cuenta' },
  { id: 4, label: 'Personalidad' },
  { id: 5, label: 'Identidad' },
];

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

// ─── Parse CER file to extract RFC, CURP, serial ─────────────────────────────

/**
 * Reads a DER-encoded X.509 certificate (.cer) and extracts:
 *  - noCertificado (serial hex → ASCII → 20-digit string)
 *  - RFC, CURP from subject OIDs / text fields
 *  - subject / issuer raw strings
 *  - notBefore / notAfter validity dates
 *  - SHA-256 fingerprint
 *  - base64 of the certificate
 *
 * IMPORTANT: The SAT serial is stored as ASCII digits encoded in hex.
 * Example: hex "3030303031303030303030373034313439363830"
 *          → bytes [0x30,0x30,...] → ASCII "00001000000704149680"
 * We NEVER convert to BigInt decimal.
 */
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

        // ── Base64 of the raw certificate ──────────────────────────────────
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);

        // ── SHA-256 fingerprint ────────────────────────────────────────────
        let sha256 = '';
        try {
          const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
        } catch { /* ignore */ }

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

        // Read a TLV and return {tag, start, len} without advancing past value
        function peekTLV(): { tag: number; start: number; len: number } {
          const savedPos = pos;
          const tag = readTag();
          let len = readLength();
          const start = pos;
          pos = savedPos;
          return { tag, start, len };
        }

        // Read a TLV and advance past it; return value bytes
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
          console.warn('[parseCerFile] noCertificado no cumple 20 dígitos numéricos:', noCertificado, '| serialHex:', serialHex);
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

        // ── STEP 6: Read issuer SEQUENCE ──────────────────────────────────
        const issuerStart = pos;
        readTag(); // 0x30
        const issuerLen = readLength();
        const issuerBytes = bytes.slice(issuerStart, pos + issuerLen);
        skipValue(issuerLen);
        const issuer = extractDNString(issuerBytes);

        // ── STEP 7: Read validity SEQUENCE ────────────────────────────────
        readTag(); // 0x30 SEQUENCE
        readLength();
        const notBeforeTLV = readTLV();
        const notAfterTLV = readTLV();
        const notBefore = parseAsn1Time(notBeforeTLV.value);
        const notAfter = parseAsn1Time(notAfterTLV.value);

        // ── STEP 8: Read subject SEQUENCE ─────────────────────────────────
        const subjectStart = pos;
        readTag(); // 0x30
        const subjectLen = readLength();
        const subjectBytes = bytes.slice(subjectStart, pos + subjectLen);
        skipValue(subjectLen);
        const subject = extractDNString(subjectBytes);

        // ── Extract RFC and CURP from subject string ───────────────────────
        // RFC pattern: 3-4 uppercase letters (including Ñ &) + 6 digits + 3 alphanumeric
        const rfcMatch = subject.match(/[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}/);
        const rfc = rfcMatch ? rfcMatch[0] : '';

        // CURP pattern: 18 chars
        const curpMatch = subject.match(/[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9]{2}/);
        const curp = curpMatch ? curpMatch[0] : '';

        resolve({
          rfc,
          curp,
          serial: noCertificado,
          subject,
          issuer,
          notBefore,
          notAfter,
          sha256,
          base64,
        });
      } catch (err) {
        console.error('[parseCerFile] Error al parsear certificado:', err);
        resolve(null);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/** Convert ASN.1 UTCTime or GeneralizedTime bytes to ISO string */
function parseAsn1Time(value: Uint8Array): string {
  try {
    const str = Array.from(value).map(b => String.fromCharCode(b)).join('');
    // UTCTime: YYMMDDHHMMSSZ  (13 chars)
    // GeneralizedTime: YYYYMMDDHHMMSSZ (15 chars)
    if (str.length === 13) {
      const yy = parseInt(str.slice(0, 2));
      const year = yy >= 50 ? 1900 + yy : 2000 + yy;
      return `${year}-${str.slice(2, 4)}-${str.slice(4, 6)} ${str.slice(6, 8)}:${str.slice(8, 10)}:${str.slice(10, 12)}`;
    } else if (str.length >= 15) {
      return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)} ${str.slice(8, 10)}:${str.slice(10, 12)}:${str.slice(12, 14)}`;
    }
    return str;
  } catch {
    return '';
  }
}

/** Extract a human-readable DN string from raw DER bytes of a Name SEQUENCE */
function extractDNString(bytes: Uint8Array): string {
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

      // OID
      if (bytes[i] === 0x06) {
        i++;
        const oidLen = derReadLen(bytes, i);
        i += derLenSize(bytes, i) + 1;
        i += oidLen; // skip OID value
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

// ─── Efirma Validation Result Card ───────────────────────────────────────────

function EfirmaValidationCard({
  result,
  onConfirm,
  isExpired,
  isLoading,
  registrationError,
}: {
  result: EfirmaValidationResult;
  onConfirm: () => void;
  isExpired: boolean;
  isLoading?: boolean;
  registrationError?: string | null;
}) {
  const { serialResult, curpResult } = result;
  const isActive = serialResult?.estado === 'Activo';

  // Validation: persona moral (RFC 12 digits) or non-FIEL certificate
  const isMoralPerson = result.rfc ? result.rfc.replace(/\s/g, '').length === 12 : false;
  const certTipo = (serialResult?.tipo || '').toUpperCase();
  const isNotFiel = certTipo !== '' && certTipo !== 'FIEL';
  const hasBlockingError = isMoralPerson || isNotFiel;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isExpired ? 'bg-red-100' : 'bg-emerald-100'}`}>
          {isExpired ? (
            <AlertCircle size={22} className="text-red-600" />
          ) : (
            <CheckCircle2 size={22} className="text-emerald-600" />
          )}
        </div>
        <div>
          <h3 className={`text-lg font-bold ${isExpired ? 'text-red-600' : 'text-foreground'}`}>
            {isExpired ? 'e.Firma Vencida' : 'Validación Exitosa'}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isExpired
              ? 'Tu e.Firma ha vencido. Renuévala en el SAT para continuar.'
              : 'Tu certificado ha sido validado correctamente ante los servicios del SAT y RENAPO.'}
          </p>
        </div>
      </div>

      {/* Expiry warning banner */}
      {isExpired && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">e.Firma vencida</p>
            <p className="text-xs text-red-600 mt-0.5">
              La vigencia de tu e.Firma expiró el {serialResult?.fecha_fin || result.vigenciaFin || '—'}. 
              Para renovarla, visita el SAT o una oficina de atención al contribuyente.
            </p>
          </div>
        </div>
      )}

      {/* Persona Moral error */}
      {isMoralPerson && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">Firma electrónica de persona moral no permitida</p>
            <p className="text-xs text-red-600 mt-0.5">
              El RFC detectado ({result.rfc}) corresponde a una persona moral (12 dígitos). Este registro solo acepta e.Firma de persona física (RFC de 13 caracteres).
            </p>
          </div>
        </div>
      )}

      {/* Non-FIEL certificate error */}
      {isNotFiel && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">Tipo de certificado no válido</p>
            <p className="text-xs text-red-600 mt-0.5">
              El certificado detectado es de tipo <span className="font-semibold">{serialResult?.tipo}</span>. Solo se acepta e.Firma tipo <span className="font-semibold">FIEL</span>. Los certificados de tipo Sello (CSD) no están permitidos para este registro.
            </p>
          </div>
        </div>
      )}

      {/* Personal Info Card — shown first */}
      {curpResult && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="bg-muted/40 px-4 py-3 border-b border-border">
            <p className="text-sm font-bold text-foreground">Información Personal</p>
          </div>
          <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
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

      {/* Certificate Info Card */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-muted/40 px-4 py-3 border-b border-border">
          <p className="text-sm font-bold text-foreground">Información del Certificado</p>
        </div>
        <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
          {/* RFC */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">RFC</p>
            <p className="text-sm font-semibold text-foreground font-mono">{result.rfc || '—'}</p>
          </div>
          {/* Estado */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">ESTADO</p>
            <p className={`text-sm font-bold ${isExpired ? 'text-red-500' : isActive ? 'text-emerald-600' : 'text-red-500'}`}>
              {isExpired ? 'Vencido' : (serialResult?.estado || '—')}
            </p>
          </div>
          {/* Número de Serie */}
          <div className="col-span-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">NÚMERO DE SERIE</p>
            <p className="text-sm font-semibold text-foreground font-mono break-all">{result.serial || '—'}</p>
          </div>
          {/* Tipo de Certificado */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">TIPO DE CERTIFICADO</p>
            <p className="text-sm font-semibold text-foreground">{serialResult?.tipo || '—'}</p>
          </div>
          {/* Inicio Vigencia */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">INICIO VIGENCIA</p>
            <p className="text-sm font-semibold text-foreground">{serialResult?.fecha_inicio || '—'}</p>
          </div>
          {/* Fin Vigencia */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">FIN VIGENCIA</p>
            <p className={`text-sm font-semibold ${isExpired ? 'text-red-500 font-bold' : 'text-foreground'}`}>
              {serialResult?.fecha_fin || result.vigenciaFin || '—'}
              {isExpired && <span className="ml-2 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">VENCIDO</span>}
            </p>
          </div>
          {/* Código de Validación */}
          <div className="col-span-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">CÓDIGO DE VALIDACIÓN</p>
            <p className="text-sm font-semibold text-foreground font-mono">{serialResult?.codigo_validacion || '—'}</p>
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
        {isLoading ? (
          <><Loader2 size={15} className="animate-spin" /> Registrando...</>
        ) : (
          <><CheckCircle2 size={15} />Confirmar datos y registrar usuario</>
        )}
      </button>
      {registrationError && !isExpired && !hasBlockingError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-600">{registrationError}</p>
        </div>
      )}
      {!isExpired && isMoralPerson && (
        <p className="text-xs text-red-500 text-center flex items-center justify-center gap-1">
          <AlertCircle size={12} />
          No es posible registrarse con una e.Firma de persona moral.
        </p>
      )}
      {!isExpired && !isMoralPerson && isNotFiel && (
        <p className="text-xs text-red-500 text-center flex items-center justify-center gap-1">
          <AlertCircle size={12} />
          Solo se permite e.Firma tipo FIEL para el registro.
        </p>
      )}
    </div>
  );
}

// ─── Efirma Moral Validation Result Card ──────────────────────────────────────

interface EfirmaMoralValidationResult {
  serialResult: NubariumSerialResult | null;
  curpResult: NubariumCurpResult | null;
  rfc: string;
  rfcRepresentante: string;
  curp: string;
  serial: string;
  razonSocial: string;
  denominacionSocial: string;
  vigenciaFin: string;
  isExpired: boolean;
}

function EfirmaMoralValidationCard({
  result,
  onConfirm,
  isLoading,
  registrationError,
}: {
  result: EfirmaMoralValidationResult;
  onConfirm: () => void;
  isLoading?: boolean;
  registrationError?: string | null;
}) {
  const { serialResult, curpResult } = result;
  const isActive = serialResult?.estado === 'Activo';
  const isExpired = result.isExpired;

  // Validate certificate type — must be FIEL (not SELLO/CSD)
  const certTipo = (serialResult?.tipo || '').toUpperCase();
  const isNotFiel = certTipo !== '' && certTipo !== 'FIEL';

  // Validate certificate status — must be Activo
  const isInactiveStatus = serialResult?.estado !== undefined && serialResult.estado !== 'Activo';

  // Any blocking error disables the confirm button
  const hasBlockingError = isExpired || isNotFiel || isInactiveStatus;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header — same as EfirmaValidationCard */}
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${hasBlockingError ? 'bg-red-100' : 'bg-emerald-100'}`}>
          {hasBlockingError ? (
            <AlertCircle size={22} className="text-red-600" />
          ) : (
            <CheckCircle2 size={22} className="text-emerald-600" />
          )}
        </div>
        <div>
          <h3 className={`text-lg font-bold ${hasBlockingError ? 'text-red-600' : 'text-foreground'}`}>
            {isExpired ? 'e.Firma Vencida' : isNotFiel ? 'Tipo de Certificado Inválido' : isInactiveStatus ? 'Certificado Inactivo' : 'Validación Exitosa'}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isExpired
              ? 'La e.Firma de la empresa ha vencido. Renuévala en el SAT para continuar.'
              : isNotFiel
              ? 'El certificado detectado no es de tipo FIEL. Solo se aceptan certificados FIEL.'
              : isInactiveStatus
              ? 'El certificado no se encuentra en estado Activo. Verifica su estado en el SAT.'
              : 'El certificado de la empresa ha sido validado correctamente ante los servicios del SAT.'}
          </p>
        </div>
      </div>

      {/* Expiry warning banner */}
      {isExpired && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">e.Firma empresarial vencida</p>
            <p className="text-xs text-red-600 mt-0.5">
              La vigencia expiró el {serialResult?.fecha_fin || result.vigenciaFin || '—'}.
              Para renovarla, visita el SAT o una oficina de atención al contribuyente.
            </p>
          </div>
        </div>
      )}

      {/* Non-FIEL certificate error banner */}
      {!isExpired && isNotFiel && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">Tipo de certificado no permitido</p>
            <p className="text-xs text-red-600 mt-0.5">
              El certificado detectado es de tipo <span className="font-semibold">{serialResult?.tipo}</span>. Solo se acepta e.Firma tipo <span className="font-semibold">FIEL</span>. Los certificados de tipo Sello (CSD) no están permitidos para este registro.
            </p>
          </div>
        </div>
      )}

      {/* Inactive status error banner */}
      {!isExpired && !isNotFiel && isInactiveStatus && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">Certificado no activo</p>
            <p className="text-xs text-red-600 mt-0.5">
              El estado del certificado es <span className="font-semibold">{serialResult?.estado}</span>. Solo se aceptan certificados con estado <span className="font-semibold">Activo</span>. Verifica el estado de tu e.Firma en el portal del SAT.
            </p>
          </div>
        </div>
      )}

      {/* Información General — mirrors "Información Personal" card */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-muted/40 px-4 py-3 border-b border-border">
          <p className="text-sm font-bold text-foreground">Información General</p>
        </div>
        <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <div className="col-span-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">NOMBRE / DENOMINACIÓN SOCIAL</p>
            <p className="text-sm font-semibold text-foreground">{result.denominacionSocial || result.razonSocial || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">RFC (EMPRESA)</p>
            <p className="text-sm font-semibold text-foreground font-mono">{result.rfc || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">CURP (REPRESENTANTE LEGAL)</p>
            <p className="text-sm font-semibold text-foreground font-mono">{result.curp || '—'}</p>
          </div>
        </div>
      </div>

      {/* Representante Legal — mirrors "Información del Certificado" card */}
      {curpResult && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="bg-muted/40 px-4 py-3 border-b border-border">
            <p className="text-sm font-bold text-foreground">Representante Legal vinculado a la e.Firma</p>
          </div>
          <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
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
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">CURP (REPRESENTANTE)</p>
              <p className="text-sm font-semibold text-foreground font-mono">{result.curp || '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Informative box */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <AlertCircle size={16} className="text-blue-600" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold text-blue-800">Acreditación de identidad requerida</p>
          <p className="text-xs text-blue-700 leading-relaxed">
            Para validar correctamente la empresa, el representante legal vinculado debe <span className="font-semibold">acreditar su identidad</span>. Una vez acreditado, podrá <span className="font-semibold">cambiar o designar nuevos representantes legales</span> vinculados a la empresa.
          </p>
        </div>
      </div>

      {/* Certificate Info Card */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="bg-muted/40 px-4 py-3 border-b border-border">
          <p className="text-sm font-bold text-foreground">Información del Certificado Empresarial</p>
        </div>
        <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">ESTADO</p>
            <p className={`text-sm font-bold ${isExpired ? 'text-red-500' : isActive ? 'text-emerald-600' : 'text-red-500'}`}>
              {isExpired ? 'Vencido' : (serialResult?.estado || '—')}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">TIPO DE CERTIFICADO</p>
            <p className="text-sm font-semibold text-foreground">{serialResult?.tipo || '—'}</p>
          </div>
          <div className="col-span-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">NÚMERO DE SERIE</p>
            <p className="text-sm font-semibold text-foreground font-mono break-all">{result.serial || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">INICIO VIGENCIA</p>
            <p className="text-sm font-semibold text-foreground">{serialResult?.fecha_inicio || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">FIN VIGENCIA</p>
            <p className={`text-sm font-semibold ${isExpired ? 'text-red-500 font-bold' : 'text-foreground'}`}>
              {serialResult?.fecha_fin || result.vigenciaFin || '—'}
              {isExpired && <span className="ml-2 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">VENCIDO</span>}
            </p>
          </div>
          {serialResult?.codigo_validacion && (
            <div className="col-span-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">CÓDIGO DE VALIDACIÓN</p>
              <p className="text-sm font-semibold text-foreground font-mono">{serialResult.codigo_validacion}</p>
            </div>
          )}
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
        {isLoading ? (
          <><Loader2 size={15} className="animate-spin" /> Registrando...</>
        ) : (
          <><CheckCircle2 size={15} />Confirmar datos y registrar usuario</>
        )}
      </button>
      {registrationError && !isExpired && !hasBlockingError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-600">{registrationError}</p>
        </div>
      )}
      {!isExpired && isNotFiel && (
        <p className="text-xs text-red-500 text-center flex items-center justify-center gap-1">
          <AlertCircle size={12} />
          Solo se permite e.Firma tipo FIEL (no SELLO/CSD) para el registro de persona moral.
        </p>
      )}
      {!isExpired && !isNotFiel && isInactiveStatus && (
        <p className="text-xs text-red-500 text-center flex items-center justify-center gap-1">
          <AlertCircle size={12} />
          El certificado no está activo. Solo se aceptan certificados con estado Activo.
        </p>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RegistroPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [efirmaValidated, setEfirmaValidated] = useState(false);
  const [biometricoValidated, setBiometricoValidated] = useState(false);
  const [efirmaMoralValidated, setEfirmaMoralValidated] = useState(false);
  const [efirmaMoralValidationResult, setEfirmaMoralValidationResult] = useState<EfirmaMoralValidationResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedIdentityMethod, setSelectedIdentityMethod] = useState<'efirma' | 'biometrico' | null>(null);

  // Moral e.Firma file state
  const [moralCerFile, setMoralCerFile] = useState<File | null>(null);
  const [moralKeyFile, setMoralKeyFile] = useState<File | null>(null);
  const [moralEfirmaPassword, setMoralEfirmaPassword] = useState('');
  const [isValidatingMoral, setIsValidatingMoral] = useState(false);

  // Registration state
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  // QR / biometric enrollment state
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrExpired, setQrExpired] = useState(false);
  const [qrExpiresAt, setQrExpiresAt] = useState<Date | null>(null);
  const [qrTimeLeft, setQrTimeLeft] = useState<number>(600);
  const [enrollmentResult, setEnrollmentResult] = useState<{
    nombre: string;
    apellidoPaterno: string;
    apellidoMaterno: string;
    curp: string;
    rfc: string;
    fechaNacimiento: string;
    sexo: string;
    tipoIdentificacion: string;
  } | null>(null);
  const sessionIdRef = useRef<string>('');
  const realtimeChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
  const realtimeResultsChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 1 duplicate check state
  const [emailCheckStatus, setEmailCheckStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [phoneCheckStatus, setPhoneCheckStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const emailDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [data, setData] = useState<RegistrationData>({
    email: '',
    phone: '',
    acceptTerms: false,
    password: '',
    confirmPassword: '',
    accountType: null,
    personalidadJuridica: null,
    identityMethod: null,
    cerFile: null,
    keyFile: null,
    efirmaPassword: '',
    validatedData: null,
    efirmaValidationResult: null,
  });

  const update = (fields: Partial<RegistrationData>) => setData((prev) => ({ ...prev, ...fields }));

  // ─── Duplicate check functions ───────────────────────────────────────────────

  const checkEmail = useCallback(async (email: string) => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailCheckStatus('idle');
      return;
    }
    setEmailCheckStatus('checking');
    try {
      const res = await fetch('/api/registro/check-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = await res.json();
      setEmailCheckStatus(result.emailExists ? 'taken' : 'available');
    } catch {
      setEmailCheckStatus('idle');
    }
  }, []);

  const checkPhone = useCallback(async (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) {
      setPhoneCheckStatus('idle');
      return;
    }
    setPhoneCheckStatus('checking');
    try {
      const res = await fetch('/api/registro/check-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits }),
      });
      const result = await res.json();
      setPhoneCheckStatus(result.phoneExists ? 'taken' : 'available');
    } catch {
      setPhoneCheckStatus('idle');
    }
  }, []);

  const handleEmailChange = (value: string) => {
    update({ email: value });
    setEmailCheckStatus('idle');
    if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current);
    emailDebounceRef.current = setTimeout(() => checkEmail(value), 600);
  };

  const handlePhoneChange = (value: string) => {
    // Only allow digits, max 10
    const digits = value.replace(/\D/g, '').slice(0, 10);
    update({ phone: digits });
    setPhoneCheckStatus('idle');
    if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current);
    phoneDebounceRef.current = setTimeout(() => checkPhone(digits), 600);
  };

  useEffect(() => {
    return () => {
      if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current);
      if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current);
    };
  }, []);

  // ─── QR countdown timer ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!qrExpiresAt || qrExpired || biometricoValidated) return;
    const interval = setInterval(() => {
      const diff = qrExpiresAt.getTime() - Date.now();
      // Guard against NaN (invalid date) — treat as expired
      if (isNaN(diff)) {
        setQrExpired(true);
        clearInterval(interval);
        return;
      }
      const remaining = Math.max(0, Math.floor(diff / 1000));
      setQrTimeLeft(remaining);
      if (remaining === 0) {
        setQrExpired(true);
        clearInterval(interval);
        // Cleanup realtime channels
        if (realtimeChannelRef.current) {
          const supabase = createClient();
          supabase.removeChannel(realtimeChannelRef.current);
          realtimeChannelRef.current = null;
        }
        if (realtimeResultsChannelRef.current) {
          const supabase = createClient();
          supabase.removeChannel(realtimeResultsChannelRef.current);
          realtimeResultsChannelRef.current = null;
        }
        // Cleanup polling
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [qrExpiresAt, qrExpired, biometricoValidated]);

  // ─── Generate QR token ───────────────────────────────────────────────────────

  const generateQrToken = useCallback(async () => {
    // Reset state for new QR generation (fixes "Código expirado" showing immediately)
    setQrLoading(true);
    setQrExpired(false);
    setQrUrl(null);
    setQrTimeLeft(600);

    // Cleanup previous channel
    if (realtimeChannelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
    if (realtimeResultsChannelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(realtimeResultsChannelRef.current);
      realtimeResultsChannelRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Generate a session ID
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

      // Cross-browser safe date parsing (Safari/Firefox may reject some ISO formats)
      let expiresAtDate: Date;
      try {
        // Normalize ISO string: replace space with T if needed, ensure Z suffix
        const rawExpiry: string = result.expiresAt;
        const normalized = rawExpiry.replace(' ', 'T').replace(/([^Z])$/, '$1Z');
        const parsed = new Date(normalized);
        // Validate the parsed date
        expiresAtDate = isNaN(parsed.getTime())
          ? new Date(Date.now() + 10 * 60 * 1000)
          : parsed;
      } catch {
        expiresAtDate = new Date(Date.now() + 10 * 60 * 1000);
      }

      setQrUrl(result.enrollmentUrl);
      setQrExpiresAt(expiresAtDate);
      setQrTimeLeft(600);

      // Subscribe to Supabase Realtime for this token
      const supabase = createClient();

      // Guard: prevent double-processing if both channels fire
      let enrollmentHandled = false;

      const handleEnrollmentData = (data: {
        status: string;
        nombre?: string | null;
        apellido_paterno?: string | null;
        apellido_materno?: string | null;
        curp?: string | null;
        rfc?: string | null;
        fecha_nacimiento?: string | null;
        sexo?: string | null;
        tipo_identificacion?: string | null;
      }) => {
        if (enrollmentHandled) return;
        enrollmentHandled = true;
        const enrollData = {
          nombre: data.nombre || '',
          apellidoPaterno: data.apellido_paterno || '',
          apellidoMaterno: data.apellido_materno || '',
          curp: data.curp || '',
          rfc: data.rfc || '',
          fechaNacimiento: data.fecha_nacimiento || '',
          sexo: data.sexo || '',
          tipoIdentificacion: data.tipo_identificacion || '',
        };
        setEnrollmentResult(enrollData);
        setBiometricoValidated(true);
        update({
          validatedData: {
            nombre: [enrollData.nombre, enrollData.apellidoPaterno, enrollData.apellidoMaterno]
              .filter(Boolean).join(' '),
            rfc: enrollData.rfc,
            curp: enrollData.curp,
            vigencia: 'Verificado biométricamente',
          },
        });
        // Cleanup both channels
        if (realtimeResultsChannelRef.current) {
          supabase.removeChannel(realtimeResultsChannelRef.current);
          realtimeResultsChannelRef.current = null;
        }
        if (realtimeChannelRef.current) {
          supabase.removeChannel(realtimeChannelRef.current);
          realtimeChannelRef.current = null;
        }
      };

      // Channel 1 (PRIMARY): enrollment_results INSERT filtered by session_id
      // INSERT events always include full row data — no REPLICA IDENTITY needed
      const resultsChannel = supabase
        .channel(`enrollment_results_${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'enrollment_results',
            filter: `session_id=eq.${sessionId}`,
          },
          (payload) => {
            const row = payload.new as {
              status: string;
              nombre?: string | null;
              apellido_paterno?: string | null;
              apellido_materno?: string | null;
              curp?: string | null;
              rfc?: string | null;
              fecha_nacimiento?: string | null;
              sexo?: string | null;
              tipo_identificacion?: string | null;
            };
            if (row.status === 'completed') {
              handleEnrollmentData(row);
            }
          }
        )
        .subscribe();

      realtimeResultsChannelRef.current = resultsChannel;

      // Channel 2 (FALLBACK): enrollment_tokens UPDATE filtered by token
      // Requires REPLICA IDENTITY FULL (set in migration 20260324063000)
      const tokenChannel = supabase
        .channel(`enrollment_token_${result.token}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'enrollment_tokens',
            filter: `token=eq.${result.token}`,
          },
          (payload) => {
            const row = payload.new as {
              status: string;
              nombre?: string | null;
              apellido_paterno?: string | null;
              apellido_materno?: string | null;
              curp?: string | null;
              rfc?: string | null;
              fecha_nacimiento?: string | null;
              sexo?: string | null;
              tipo_identificacion?: string | null;
            };
            if (row.status === 'completed') {
              handleEnrollmentData(row);
            }
          }
        )
        .subscribe();

      realtimeChannelRef.current = tokenChannel;

      // ── POLLING FALLBACK: query enrollment_results every 3s ──────────────
      // Covers cases where Realtime doesn't fire (RLS, network, etc.)
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = setInterval(async () => {
        if (enrollmentHandled) {
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
          return;
        }
        try {
          const response = await fetch(`/api/enrollment/status?token=${encodeURIComponent(result.token)}&session_id=${encodeURIComponent(sessionId)}`, {
            cache: 'no-store',
          });
          const status = await response.json();
          if (response.ok && status.result) {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            handleEnrollmentData(status.result);
          }
        } catch {
          // ignore polling errors
        }
      }, 3000);
    } catch {
      setErrors((prev) => ({ ...prev, biometrico: 'Error de conexión. Intenta nuevamente.' }));
    } finally {
      setQrLoading(false);
    }
  }, []);

  // Cleanup realtime on unmount
  useEffect(() => {
    return () => {
      const supabase = createClient();
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }
      if (realtimeResultsChannelRef.current) {
        supabase.removeChannel(realtimeResultsChannelRef.current);
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // ─── Validation ─────────────────────────────────────────────────────────────

  const validateStep = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (currentStep === 1) {
      if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
        newErrors.email = 'Ingresa un correo electrónico válido';
      if (emailCheckStatus === 'taken')
        newErrors.email = 'Este correo ya está registrado';
      if (!data.phone || data.phone.replace(/\D/g, '').length !== 10)
        newErrors.phone = 'Ingresa un número de teléfono de 10 dígitos';
      if (phoneCheckStatus === 'taken')
        newErrors.phone = 'Este número de teléfono ya está registrado';
      if (!data.acceptTerms)
        newErrors.terms = 'Debes aceptar los términos y condiciones';
    }
    if (currentStep === 2) {
      if (!data.password || data.password.length < 8)
        newErrors.password = 'La contraseña debe tener al menos 8 caracteres';
      if (data.password !== data.confirmPassword)
        newErrors.confirmPassword = 'Las contraseñas no coinciden';
    }
    if (currentStep === 3 && !data.accountType)
      newErrors.accountType = 'Selecciona un tipo de cuenta';
    if (currentStep === 4 && !data.personalidadJuridica)
      newErrors.personalidadJuridica = 'Selecciona tu personalidad jurídica';
    if (currentStep === 5 && !data.identityMethod)
      newErrors.identityMethod = 'Selecciona un método de acreditación';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isStep1NextDisabled =
    currentStep === 1 &&
    (emailCheckStatus === 'taken' ||
      phoneCheckStatus === 'taken' ||
      emailCheckStatus === 'checking' ||
      phoneCheckStatus === 'checking');

  const handleNext = () => {
    if (isStep1NextDisabled) return;
    if (!validateStep()) return;
    if (currentStep < 5) setCurrentStep((s) => s + 1);
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep((s) => s - 1);
    setErrors({});
  };

  // ─── e.Firma validation with Nubarium ────────────────────────────────────────

  const handleValidateEfirma = async () => {
    if (!data.cerFile || !data.keyFile || !data.efirmaPassword) return;
    setIsValidating(true);
    setErrors((prev) => ({ ...prev, efirma: '' }));

    try {
      // ── Step 1: Validate .key password by attempting actual decryption ──────
      const keyFormData = new FormData();
      keyFormData.append('keyFile', data.keyFile);
      keyFormData.append('password', data.efirmaPassword);

      let keyValidationRes: Response;
      try {
        keyValidationRes = await fetch('/api/efirma/validate-key', {
          method: 'POST',
          body: keyFormData,
        });
      } catch {
        setErrors((prev) => ({
          ...prev,
          efirma: 'Error de red al validar la llave privada. Intenta nuevamente.',
        }));
        setIsValidating(false);
        return;
      }

      const keyValidation = await keyValidationRes.json();

      if (!keyValidation.success || !keyValidation.isPasswordValid) {
        let userMessage = 'La contraseña es incorrecta o la llave privada no es válida.';
        if (keyValidation.errorCode === 'CORRUPTED_FILE') {
          userMessage = 'El archivo .key está corrupto o dañado. Verifica el archivo.';
        } else if (keyValidation.errorCode === 'UNSUPPORTED_FORMAT') {
          userMessage = 'El formato de la llave privada no es compatible. Verifica que sea un archivo .key del SAT.';
        } else if (keyValidation.errorCode === 'PARSE_ERROR') {
          userMessage = 'No se pudo procesar el archivo .key. El archivo podría estar dañado.';
        } else if (keyValidation.errorCode === 'MISSING_KEY_FILE') {
          userMessage = 'No se encontró el archivo .key. Vuelve a seleccionarlo.';
        } else if (keyValidation.errorCode === 'EMPTY_PASSWORD') {
          userMessage = 'La contraseña no puede estar vacía.';
        } else if (keyValidation.errorCode === 'INVALID_FILE_TYPE') {
          userMessage = 'El archivo seleccionado no es un archivo .key válido.';
        }
        setErrors((prev) => ({ ...prev, efirma: userMessage }));
        setIsValidating(false);
        return;
      }

      // ── Step 2: Parse the .cer file ──────────────────────────────────────────
      const parsed = await parseCerFile(data.cerFile);

      const rfc = parsed?.rfc || '';
      const curp = parsed?.curp || '';
      const serial = parsed?.serial || '';
      const notAfter = parsed?.notAfter || '';

      if (!serial) {
        setErrors((prev) => ({
          ...prev,
          efirma: 'No se pudo extraer el número de serie del certificado. Verifica que el archivo .cer sea válido.',
        }));
        setIsValidating(false);
        return;
      }

      // ── Step 3: Check certificate expiry ─────────────────────────────────────
      let isCertExpired = false;
      if (notAfter) {
        try {
          const expiryDate = new Date(notAfter.replace(' ', 'T') + 'Z');
          isCertExpired = expiryDate < new Date();
        } catch {
          // If we can't parse the date, don't block
        }
      }

      let serialResult: NubariumSerialResult | null = null;
      let curpResult: NubariumCurpResult | null = null;

      // ── Step 4: Validate serial with Nubarium ─────────────────────────────────
      if (rfc && serial) {
        try {
          const serialRes = await fetch('/api/nubarium/validar-serial', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rfc, serial }),
          });
          serialResult = await serialRes.json();

          // Also check expiry from Nubarium response
          if (serialResult?.fecha_fin) {
            try {
              const nubariumExpiry = new Date(serialResult.fecha_fin.replace(' ', 'T'));
              if (nubariumExpiry < new Date()) {
                isCertExpired = true;
              }
            } catch {
              // ignore parse error
            }
          }
        } catch {
          // continue without serial result
        }
      }

      // ── Step 5: Validate CURP with Nubarium ──────────────────────────────────
      if (curp) {
        try {
          const curpRes = await fetch('/api/nubarium/validar-curp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ curp }),
          });
          curpResult = await curpRes.json();
        } catch {
          // continue without curp result
        }
      }

      let nombre = curpResult?.nombre || '';
      let apellidoPaterno = curpResult?.apellidoPaterno || '';
      let apellidoMaterno = curpResult?.apellidoMaterno || '';
      const vigenciaFin = serialResult?.fecha_fin || notAfter || '';

      const efirmaValidationResult: EfirmaValidationResult = {
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
      };

      setEfirmaValidated(true);
      update({
        efirmaValidationResult,
        validatedData: {
          nombre: [nombre, apellidoPaterno, apellidoMaterno].filter(Boolean).join(' '),
          rfc,
          curp: curpResult?.curp || curp,
          vigencia: vigenciaFin,
        },
      });
    } catch {
      setErrors((prev) => ({
        ...prev,
        efirma: 'Error al procesar el certificado. Verifica que los archivos sean válidos.',
      }));
    } finally {
      setIsValidating(false);
    }
  };

  // ─── Mock biometric validation ────────────────────────────────────────────────

  // ─── e.Firma Moral validation ─────────────────────────────────────────────────

  const handleValidateEfirmaMoral = async () => {
    if (!moralCerFile || !moralKeyFile || !moralEfirmaPassword) return;
    setIsValidatingMoral(true);
    setErrors((prev) => ({ ...prev, efirmaMoral: '' }));

    try {
      // Step 1: Validate .key password
      const keyFormData = new FormData();
      keyFormData.append('keyFile', moralKeyFile);
      keyFormData.append('password', moralEfirmaPassword);

      let keyValidationRes: Response;
      try {
        keyValidationRes = await fetch('/api/efirma/validate-key', {
          method: 'POST',
          body: keyFormData,
        });
      } catch {
        setErrors((prev) => ({ ...prev, efirmaMoral: 'Error de red al validar la llave privada. Intenta nuevamente.' }));
        setIsValidatingMoral(false);
        return;
      }

      const keyValidation = await keyValidationRes.json();

      if (!keyValidation.success || !keyValidation.isPasswordValid) {
        let userMessage = 'La contraseña es incorrecta o la llave privada no es válida.';
        if (keyValidation.errorCode === 'CORRUPTED_FILE') {
          userMessage = 'El archivo .key está corrupto o dañado. Verifica el archivo.';
        } else if (keyValidation.errorCode === 'UNSUPPORTED_FORMAT') {
          userMessage = 'El formato de la llave privada no es compatible.';
        } else if (keyValidation.errorCode === 'PARSE_ERROR') {
          userMessage = 'No se pudo procesar el archivo .key. El archivo podría estar dañado.';
        } else if (keyValidation.errorCode === 'MISSING_KEY_FILE') {
          userMessage = 'No se encontró el archivo .key. Vuelve a seleccionarlo.';
        } else if (keyValidation.errorCode === 'EMPTY_PASSWORD') {
          userMessage = 'La contraseña no puede estar vacía.';
        } else if (keyValidation.errorCode === 'INVALID_FILE_TYPE') {
          userMessage = 'El archivo seleccionado no es un archivo .key válido.';
        }
        setErrors((prev) => ({ ...prev, efirmaMoral: userMessage }));
        setIsValidatingMoral(false);
        return;
      }

      // Step 2: Parse the .cer file
      const parsed = await parseCerFile(moralCerFile);
      const rfc = parsed?.rfc || '';
      const serial = parsed?.serial || '';
      const notAfter = parsed?.notAfter || '';

      if (!serial) {
        setErrors((prev) => ({ ...prev, efirmaMoral: 'No se pudo extraer el número de serie del certificado. Verifica que el archivo .cer sea válido.' }));
        setIsValidatingMoral(false);
        return;
      }

      // Step 3: Validate RFC is 12 chars (persona moral)
      const rfcClean = rfc.replace(/\s/g, '');
      if (rfcClean.length !== 12) {
        setErrors((prev) => ({
          ...prev,
          efirmaMoral: `El RFC detectado (${rfc || 'no encontrado'}) no corresponde a una persona moral. Se requiere RFC de 12 caracteres (empresa).`,
        }));
        setIsValidatingMoral(false);
        return;
      }

      // Step 4: Check certificate expiry
      let isCertExpired = false;
      if (notAfter) {
        try {
          const expiryDate = new Date(notAfter.replace(' ', 'T') + 'Z');
          isCertExpired = expiryDate < new Date();
        } catch { /* ignore */ }
      }

      // Step 5: Validate serial with Nubarium
      let serialResult: NubariumSerialResult | null = null;
      if (rfc && serial) {
        try {
          const serialRes = await fetch('/api/nubarium/validar-serial', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rfc, serial }),
          });
          serialResult = await serialRes.json();
          if (serialResult?.fecha_fin) {
            try {
              const nubariumExpiry = new Date(serialResult.fecha_fin.replace(' ', 'T'));
              if (nubariumExpiry < new Date()) isCertExpired = true;
            } catch { /* ignore */ }
          }
        } catch { /* continue without serial result */ }
      }

      // Step 6: Extract CURP of the legal representative from the certificate
      // For persona moral certificates, the subject contains the CURP of the representative
      const curpRepresentante = parsed?.curp || '';

      // Step 7: Validate CURP with Nubarium to get representative's name
      let curpResult: NubariumCurpResult | null = null;
      if (curpRepresentante) {
        try {
          const curpRes = await fetch('/api/nubarium/validar-curp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ curp: curpRepresentante }),
          });
          curpResult = await curpRes.json();
        } catch { /* continue without curp result */ }
      }

      // Step 8: Extract denominación social from subject
      // Subject is a comma-separated DN string; look for the organization name (O= field)
      // The subject parts are extracted by extractDNString as comma-separated values
      // Typically the denominación social is the longest non-RFC, non-CURP part
      const subjectStr = parsed?.subject || '';
      let denominacionSocial = '';
      if (subjectStr) {
        const parts = subjectStr.split(',').map((p: string) => p.trim()).filter(Boolean);
        // Find the part that is NOT the RFC (12 chars) and NOT the CURP (18 chars)
        // and NOT a short code — typically the company name is the longest meaningful part
        const rfcPattern = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;
        const curpPattern = /^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9]{2}/;
        const candidates = parts.filter((p: string) => {
          const clean = p.replace(/\s/g, '');
          return !rfcPattern.test(clean) && !curpPattern.test(clean) && p.length > 3;
        });
        // Pick the longest candidate as the denominación social
        denominacionSocial = candidates.sort((a: string, b: string) => b.length - a.length)[0] || subjectStr;
      }

      // RFC of the representative (13 chars) may be derivable from CURP result or not present
      // For persona moral certs, the RFC in the cert is the company RFC (12 chars)
      // The representative's RFC is not always in the cert; use curpResult if available
      const rfcRepresentante = curpResult ? '' : '';

      const vigenciaFin = serialResult?.fecha_fin || notAfter || '';

      const moralResult: EfirmaMoralValidationResult = {
        serialResult,
        curpResult,
        rfc,
        rfcRepresentante,
        curp: curpRepresentante,
        serial,
        razonSocial: parsed?.subject || '',
        denominacionSocial,
        vigenciaFin,
        isExpired: isCertExpired,
      };

      setEfirmaMoralValidated(true);
      setEfirmaMoralValidationResult(moralResult);
      update({
        validatedData: {
          nombre: denominacionSocial || rfc,
          rfc,
          curp: curpRepresentante,
          vigencia: vigenciaFin,
        },
      });
    } catch {
      setErrors((prev) => ({ ...prev, efirmaMoral: 'Error al procesar el certificado. Verifica que los archivos sean válidos.' }));
    } finally {
      setIsValidatingMoral(false);
    }
  };

  const simulateBiometricScan = () => {
    setIsValidating(true);
    setTimeout(() => {
      setIsValidating(false);
      setBiometricoValidated(true);
      update({
        validatedData: {
          nombre: 'ALEJANDRO LÓPEZ ESTRADA',
          rfc: 'LOEA800101AAA',
          curp: 'LOEA800101HDFPSL09',
          vigencia: 'Verificado biométricamente',
        },
      });
    }, 3000);
  };

  const handleConfirmAndRegister = async () => {
    setIsRegistering(true);
    setRegistrationError(null);

    try {
      // Determine identity method label for document types
      let documentType1: string | null = null;
      let documentType2: string | null = null;

      if (data.identityMethod === 'biometrico') {
        documentType1 = 'biometrico';
        documentType2 = 'curp';
      } else if (data.identityMethod === 'efirma') {
        documentType1 = 'efirma_fisica';
        documentType2 = 'curp';
      } else if (data.personalidadJuridica === 'moral') {
        documentType1 = 'efirma_moral';
        documentType2 = 'curp';
      }

      const fullName = data.validatedData?.nombre || '';
      const rfc = data.validatedData?.rfc || '';
      const curp = data.validatedData?.curp || '';

      // ── Extract granular name fields ────────────────────────────────────────
      // Priority: biometric enrollment result > e.Firma CURP result > moral e.Firma CURP result
      let nombre = '';
      let apellidoPaterno = '';
      let apellidoMaterno = '';
      let fechaNacimiento = '';
      let sexo = '';
      let tipoIdentificacion = '';

      if (data.identityMethod === 'biometrico' && enrollmentResult) {
        nombre = enrollmentResult.nombre || '';
        apellidoPaterno = enrollmentResult.apellidoPaterno || '';
        apellidoMaterno = enrollmentResult.apellidoMaterno || '';
        fechaNacimiento = enrollmentResult.fechaNacimiento || '';
        sexo = enrollmentResult.sexo || '';
        tipoIdentificacion = enrollmentResult.tipoIdentificacion || '';
      } else if (data.identityMethod === 'efirma' && data.efirmaValidationResult?.curpResult) {
        let curpResult = data.efirmaValidationResult.curpResult;
        nombre = curpResult.nombre || '';
        apellidoPaterno = curpResult.apellidoPaterno || '';
        apellidoMaterno = curpResult.apellidoMaterno || '';
        fechaNacimiento = curpResult.fechaNacimiento || '';
        sexo = curpResult.sexo || '';
      } else if (data.personalidadJuridica === 'moral' && efirmaMoralValidationResult?.curpResult) {
        let curpResult = efirmaMoralValidationResult.curpResult;
        nombre = curpResult.nombre || '';
        apellidoPaterno = curpResult.apellidoPaterno || '';
        apellidoMaterno = curpResult.apellidoMaterno || '';
        fechaNacimiento = curpResult.fechaNacimiento || '';
        sexo = curpResult.sexo || '';
      }

      // ── Extract e.Firma specific fields ─────────────────────────────────────
      let efirmaRfc: string | null = null;
      let efirmaSerial: string | null = null;
      let efirmaNombre: string | null = null;
      let efirmaVigenciaFin: string | null = null;

      if (data.identityMethod === 'efirma' && data.efirmaValidationResult) {
        const ev = data.efirmaValidationResult;
        efirmaRfc = ev.rfc || null;
        efirmaSerial = ev.serial || null;
        efirmaNombre = [nombre, apellidoPaterno, apellidoMaterno].filter(Boolean).join(' ') || ev.curpResult?.nombre || null;
        efirmaVigenciaFin = ev.vigenciaFin || ev.serialResult?.fecha_fin || null;
      } else if (data.personalidadJuridica === 'moral' && efirmaMoralValidationResult) {
        const ev = efirmaMoralValidationResult;
        efirmaRfc = ev.rfc || null;
        efirmaSerial = ev.serial || null;
        efirmaNombre = ev.denominacionSocial || ev.razonSocial || null;
        efirmaVigenciaFin = ev.vigenciaFin || ev.serialResult?.fecha_fin || null;
      }

      const res = await fetch('/api/registro/register-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          phone: data.phone,
          accountType: data.accountType,
          personalidadJuridica: data.personalidadJuridica,
          identityMethod: data.identityMethod || (data.personalidadJuridica === 'moral' ? 'efirma_moral' : null),
          fullName,
          rfc,
          curp,
          documentType1,
          documentType2,
          // Extended profile fields
          nombre,
          apellidoPaterno,
          apellidoMaterno,
          telefono: data.phone,
          fechaNacimiento,
          sexo,
          tipoIdentificacion,
          // e.Firma fields
          efirmaRfc,
          efirmaSerial,
          efirmaNombre,
          efirmaVigenciaFin,
          // Biometric enrollment session — always send so backend can link the result
          enrollmentSessionId: sessionIdRef.current || null,
        }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        setRegistrationError(result.error || 'Error al registrar el usuario. Intenta nuevamente.');
        setIsRegistering(false);
        return;
      }

      setShowSuccess(true);
    } catch {
      setRegistrationError('Error de conexión. Verifica tu internet e intenta nuevamente.');
    } finally {
      setIsRegistering(false);
    }
  };

  const passwordStrength = getPasswordStrength(data.password);

  // ─── Success Screen ──────────────────────────────────────────────────────────

  if (showSuccess) {
    return (
      <div className="fixed inset-0 bg-emerald-500 flex flex-col items-center justify-center z-50 animate-fade-in">
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
                <p className="text-sm font-semibold">{data.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <User size={16} className="text-emerald-200 flex-shrink-0" />
              <div>
                <p className="text-xs text-emerald-200">Tipo de cuenta</p>
                <p className="text-sm font-semibold capitalize">{data.accountType}</p>
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
            onClick={() => router.push('/login')}
            className="mt-2 bg-white text-emerald-600 font-bold px-8 py-3 rounded-xl hover:bg-emerald-50 transition-colors duration-200 text-sm"
          >
            Ir al inicio de sesión
          </button>
        </div>
      </div>
    );
  }

  // ─── Step Content ─────────────────────────────────────────────────────────────

  const renderStep = () => {
    switch (currentStep) {
      // ── Step 1: Datos de contacto ──────────────────────────────────────────
      case 1:
        return (
          <div className="space-y-5">
            {/* Email field */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  placeholder="tu@correo.com"
                  value={data.email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  className={`w-full pl-9 pr-10 py-2.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
                    errors.email || emailCheckStatus === 'taken' ?'border-red-400'
                      : emailCheckStatus === 'available' ?'border-emerald-400' :'border-border'
                  }`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {emailCheckStatus === 'checking' && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                  {emailCheckStatus === 'available' && <CheckCircle2 size={14} className="text-emerald-500" />}
                  {emailCheckStatus === 'taken' && <XCircle size={14} className="text-red-500" />}
                </div>
              </div>
              {emailCheckStatus === 'taken' && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> Este correo ya está registrado
                </p>
              )}
              {emailCheckStatus === 'available' && (
                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Correo disponible
                </p>
              )}
              {errors.email && emailCheckStatus !== 'taken' && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> {errors.email}
                </p>
              )}
            </div>

            {/* Phone field */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">
                Número de teléfono
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
              <p className="text-[11px] text-muted-foreground mt-1">
                {data.phone.length}/10 dígitos
              </p>
              {phoneCheckStatus === 'taken' && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> Este número ya está registrado
                </p>
              )}
              {phoneCheckStatus === 'available' && (
                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Número disponible
                </p>
              )}
              {errors.phone && phoneCheckStatus !== 'taken' && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> {errors.phone}
                </p>
              )}
            </div>

            {/* Terms */}
            <div>
              <label className={`flex items-start gap-3 cursor-pointer group`}>
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={data.acceptTerms}
                    onChange={(e) => update({ acceptTerms: e.target.checked })}
                    className="sr-only"
                  />
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                      data.acceptTerms
                        ? 'bg-primary border-primary'
                        : errors.terms
                        ? 'border-red-400 bg-white' :'border-border bg-white group-hover:border-primary/50'
                    }`}
                  >
                    {data.acceptTerms && <Check size={12} className="text-white" strokeWidth={3} />}
                  </div>
                </div>
                <span className="text-sm text-muted-foreground leading-relaxed">
                  Acepto los{' '}
                  <span className="text-primary font-semibold cursor-pointer hover:underline">
                    Términos y Condiciones
                  </span>{' '}
                  y el{' '}
                  <span className="text-primary font-semibold cursor-pointer hover:underline">
                    Aviso de Privacidad
                  </span>{' '}
                  de DocuBox
                </span>
              </label>
              {errors.terms && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> {errors.terms}
                </p>
              )}
            </div>
          </div>
        );

      // ── Step 2: Crear contraseña ───────────────────────────────────────────
      case 2:
        return (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Mínimo 8 caracteres"
                  value={data.password}
                  onChange={(e) => update({ password: e.target.value })}
                  className={`w-full pl-9 pr-10 py-2.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
                    errors.password ? 'border-red-400' : 'border-border'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> {errors.password}
                </p>
              )}
              {data.password && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                          i <= passwordStrength.score ? passwordStrength.color : 'bg-border'
                        }`}
                      />
                    ))}
                  </div>
                  {passwordStrength.label && (
                    <p className="text-xs text-muted-foreground">
                      Seguridad: <span className="font-semibold">{passwordStrength.label}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">
                Confirmar contraseña
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Repite tu contraseña"
                  value={data.confirmPassword}
                  onChange={(e) => update({ confirmPassword: e.target.value })}
                  className={`w-full pl-9 pr-10 py-2.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
                    errors.confirmPassword ? 'border-red-400' : 'border-border'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> {errors.confirmPassword}
                </p>
              )}
              {data.confirmPassword && data.password === data.confirmPassword && (
                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Las contraseñas coinciden
                </p>
              )}
            </div>
            <div className="bg-muted/50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Requisitos de contraseña
              </p>
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

      // ── Step 3: Tipo de cuenta ─────────────────────────────────────────────
      case 3:
        return (
          <div className="space-y-4">
            {errors.accountType && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={12} /> {errors.accountType}
              </p>
            )}
            {[
              {
                value: 'personal' as const,
                icon: User,
                title: 'Personal',
                desc: 'Para uso individual, freelancers y profesionistas independientes.',
                color: 'text-blue-600',
                bg: 'bg-blue-50',
                border: 'border-blue-200',
                disabled: false,
              },
              {
                value: 'empresarial' as const,
                icon: Building2,
                title: 'Empresarial',
                desc: 'Para empresas, despachos y organizaciones con múltiples usuarios.',
                color: 'text-indigo-600',
                bg: 'bg-indigo-50',
                border: 'border-indigo-200',
                disabled: true,
              },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => !opt.disabled && update({ accountType: opt.value })}
                disabled={opt.disabled}
                className={`w-full flex items-start gap-4 p-5 rounded-xl border-2 text-left transition-all duration-200 group ${
                  opt.disabled
                    ? 'border-border bg-muted/30 opacity-50 cursor-not-allowed'
                    : data.accountType === opt.value
                    ? 'border-primary bg-primary/5 shadow-card'
                    : 'border-border bg-white hover:border-primary/30 hover:bg-primary/5'
                }`}
              >
                <div className={`w-11 h-11 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 ${
                  opt.disabled ? 'bg-muted' : data.accountType === opt.value ? 'bg-primary/10' : 'bg-muted'
                }`}>
                  <opt.icon size={22} className={opt.disabled ? 'text-muted-foreground/50' : data.accountType === opt.value ? 'text-primary' : 'text-muted-foreground'} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`font-bold text-base ${opt.disabled ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {opt.title}
                    </p>
                    {opt.disabled && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Próximamente
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{opt.desc}</p>
                </div>
                {!opt.disabled && (
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                    data.accountType === opt.value ? 'border-primary' : 'border-muted-foreground/40'
                  }`}>
                    {data.accountType === opt.value && (
                      <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        );

      // ── Step 4: Personalidad Jurídica ──────────────────────────────────────
      case 4:
        return (
          <div className="space-y-4">
            {errors.personalidadJuridica && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={12} /> {errors.personalidadJuridica}
              </p>
            )}
            {[
              {
                value: 'fisica' as const,
                icon: UserCheck,
                title: 'Persona Física',
                desc: 'Individuo que actúa en nombre propio. Incluye profesionistas, comerciantes y trabajadores independientes.',
                tag: 'RFC con CURP',
              },
              {
                value: 'moral' as const,
                icon: Building2,
                title: 'Persona Moral',
                desc: 'Entidad jurídica como empresa, asociación o sociedad. Actúa a través de representantes legales.',
                tag: 'RFC empresarial',
              },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => update({ personalidadJuridica: opt.value })}
                className={`w-full flex items-start gap-4 p-5 rounded-xl border-2 text-left transition-all duration-200 group ${
                  data.personalidadJuridica === opt.value
                    ? 'border-primary bg-primary/5' :'border-border bg-white hover:border-primary/40 hover:bg-primary/5'
                }`}
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                  data.personalidadJuridica === opt.value ? 'bg-primary/10' : 'bg-muted group-hover:bg-primary/10'
                }`}>
                  <opt.icon size={22} className={`transition-colors ${data.personalidadJuridica === opt.value ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-base text-foreground">{opt.title}</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      data.personalidadJuridica === opt.value
                        ? 'bg-primary/15 text-primary' :'bg-muted text-muted-foreground'
                    }`}>
                      {opt.tag}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{opt.desc}</p>
                </div>
                {/* Radio circle on the right */}
                <div className="flex-shrink-0 mt-0.5">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    data.personalidadJuridica === opt.value ? 'border-primary' : 'border-muted-foreground/40'
                  }`}>
                    {data.personalidadJuridica === opt.value && (
                      <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        );

      // ── Step 5: Acreditar Identidad ────────────────────────────────────────
      case 5:
        // ── Persona Moral: show only e.Firma empresarial ──────────────────
        if (data.personalidadJuridica === 'moral') {
          // Show validation result if validated
          if (efirmaMoralValidated && efirmaMoralValidationResult) {
            return (
              <div className="space-y-4 animate-fade-in">
                <button
                  onClick={() => { setEfirmaMoralValidated(false); setEfirmaMoralValidationResult(null); setMoralCerFile(null); setMoralKeyFile(null); setMoralEfirmaPassword(''); setCurrentStep(4); }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft size={14} /> Volver a cargar archivos
                </button>
                <EfirmaMoralValidationCard
                  result={efirmaMoralValidationResult}
                  onConfirm={handleConfirmAndRegister}
                  isLoading={isRegistering}
                  registrationError={registrationError}
                />
              </div>
            );
          }

          // e.Firma Moral upload form
          return (
            <div className="space-y-4 animate-fade-in">
              <button
                onClick={() => { update({ personalidadJuridica: null, identityMethod: null }); setEfirmaMoralValidated(false); setEfirmaMoralValidationResult(null); setMoralCerFile(null); setMoralKeyFile(null); setMoralEfirmaPassword(''); setCurrentStep(4); }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft size={14} /> Cambiar método
              </button>
              <div className="flex flex-col items-center gap-3 mx-auto" style={{ width: '500px', maxWidth: '100%' }}>
                <div className="flex items-center gap-2 w-full justify-center">
                  <FileKey size={16} className="text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Archivos e.Firma Empresarial</h3>
                </div>

                <FileUploadZone
                  label="Certificado (.cer)"
                  accept=".cer"
                  file={moralCerFile}
                  onFile={setMoralCerFile}
                  icon={<Upload size={18} />}
                />
                <FileUploadZone
                  label="Llave privada (.key)"
                  accept=".key"
                  file={moralKeyFile}
                  onFile={setMoralKeyFile}
                  icon={<Lock size={18} />}
                />
                <div className="w-full">
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Contraseña de la llave privada
                  </label>
                  <div className="relative">
                    <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="password"
                      placeholder="Contraseña e.Firma empresarial"
                      value={moralEfirmaPassword}
                      onChange={(e) => setMoralEfirmaPassword(e.target.value)}
                      className={`w-full pl-8 pr-4 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                        errors.efirmaMoral ? 'border-red-400' : 'border-border'
                      }`}
                    />
                  </div>
                </div>
                {errors.efirmaMoral && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 w-full">
                    <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600">{errors.efirmaMoral}</p>
                  </div>
                )}
                <button
                  onClick={handleValidateEfirmaMoral}
                  disabled={!moralCerFile || !moralKeyFile || !moralEfirmaPassword || isValidatingMoral}
                  className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                >
                  {isValidatingMoral ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" /> Validando...
                    </>
                  ) : (
                    <>
                      <Shield size={14} /> Validar e.Firma Empresarial
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        }

        // Method selection (persona física)
        if (!data.identityMethod) {
          return (
            <div className="space-y-4">
              {errors.identityMethod && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={12} /> {errors.identityMethod}
                </p>
              )}
              {[
                {
                  value: 'efirma' as const,
                  icon: FileKey,
                  title: 'e.Firma del SAT',
                  desc: 'Usa tu certificado digital (.cer) y llave privada (.key) emitidos por el SAT.',
                  badge: 'Recomendado',
                  badgeColor: 'bg-emerald-100 text-emerald-700',
                },
                {
                  value: 'biometrico' as const,
                  icon: QrCode,
                  title: 'Enrolamiento Biométrico',
                  desc: 'Escanea un código QR con tu teléfono para verificar tu identidad biométricamente.',
                  badge: 'Rápido',
                  badgeColor: 'bg-blue-100 text-blue-700',
                },
              ].map((opt) => {
                const isSelected = selectedIdentityMethod === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedIdentityMethod(opt.value)}
                    className={`w-full flex items-start gap-4 p-5 rounded-xl border-2 text-left transition-all duration-200 group ${
                      isSelected
                        ? 'border-primary bg-primary/5' :'border-border bg-white hover:border-primary/40 hover:bg-primary/5'
                    }`}
                  >
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? 'bg-primary/10' : 'bg-muted group-hover:bg-primary/10'
                    }`}>
                      <opt.icon size={22} className={`transition-colors ${isSelected ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-base text-foreground">{opt.title}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${opt.badgeColor}`}>
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{opt.desc}</p>
                    </div>
                    {/* Radio circle on the right */}
                    <div className="flex-shrink-0 mt-0.5">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                        isSelected ? 'border-primary' : 'border-muted-foreground/40'
                      }`}>
                        {isSelected && (
                          <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        }

        // e.Firma layout
        if (data.identityMethod === 'efirma') {
          return (
            <div className="space-y-3 animate-fade-in">
              <button
                onClick={() => { update({ identityMethod: null }); setEfirmaValidated(false); setEfirmaMoralValidated(false); setEfirmaMoralValidationResult(null); }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft size={14} /> Cambiar método
              </button>

              {/* Show validation result if validated */}
              {efirmaValidated && data.efirmaValidationResult ? (
                <EfirmaValidationCard
                  result={data.efirmaValidationResult}
                  onConfirm={handleConfirmAndRegister}
                  isExpired={data.efirmaValidationResult.isExpired}
                  isLoading={isRegistering}
                  registrationError={registrationError}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 mx-auto" style={{ width: '500px', maxWidth: '100%' }}>
                  <div className="flex items-center gap-2 w-full justify-center">
                    <FileKey size={16} className="text-primary" />
                    <h3 className="text-sm font-bold text-foreground">Archivos e.Firma</h3>
                  </div>
                  <FileUploadZone
                    label="Certificado (.cer)"
                    accept=".cer"
                    file={data.cerFile}
                    onFile={(f) => update({ cerFile: f })}
                    icon={<Upload size={18} />}
                  />
                  <FileUploadZone
                    label="Llave privada (.key)"
                    accept=".key"
                    file={data.keyFile}
                    onFile={(f) => update({ keyFile: f })}
                    icon={<Lock size={18} />}
                  />
                  <div className="w-full">
                    <label className="block text-xs font-semibold text-foreground mb-1.5">
                      Contraseña de la llave privada
                    </label>
                    <div className="relative">
                      <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="password"
                        placeholder="Contraseña e.Firma"
                        value={data.efirmaPassword}
                        onChange={(e) => update({ efirmaPassword: e.target.value })}
                        className={`w-full pl-8 pr-4 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                          errors.efirma ? 'border-red-400' : 'border-border'
                        }`}
                      />
                    </div>
                  </div>
                  {errors.efirma && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 w-full">
                      <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-600">{errors.efirma}</p>
                    </div>
                  )}
                  <button
                    onClick={handleValidateEfirma}
                    disabled={!data.cerFile || !data.keyFile || !data.efirmaPassword || isValidating}
                    className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                  >
                    {isValidating ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" /> Validando...
                      </>
                    ) : (
                      <>
                        <Shield size={14} /> Validar e.Firma
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        }

        // Biométrico layout
        if (data.identityMethod === 'biometrico') {
          const minutes = Math.floor(qrTimeLeft / 60);
          const seconds = qrTimeLeft % 60;
          const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

          // After enrollment completed — show validated data + register button
          if (biometricoValidated && enrollmentResult) {
            return (
              <div className="space-y-4 animate-fade-in">
                <button
                  onClick={() => {
                    update({ identityMethod: null });
                    setBiometricoValidated(false);
                    setEnrollmentResult(null);
                    setQrUrl(null);
                    const supabase = createClient();
                    if (realtimeChannelRef.current) {
                      supabase.removeChannel(realtimeChannelRef.current);
                      realtimeChannelRef.current = null;
                    }
                    if (realtimeResultsChannelRef.current) {
                      supabase.removeChannel(realtimeResultsChannelRef.current);
                      realtimeResultsChannelRef.current = null;
                    }
                    if (pollingIntervalRef.current) {
                      clearInterval(pollingIntervalRef.current);
                      pollingIntervalRef.current = null;
                    }
                  }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft size={14} /> Cambiar método
                </button>

                {/* Success header — matches e.Firma validation style */}
                <div className="flex items-center gap-3 bg-white border border-border rounded-xl p-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 size={22} className="text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">Validación Exitosa</h3>
                    <p className="text-xs text-muted-foreground">Tu identidad ha sido verificada correctamente mediante enrolamiento biométrico.</p>
                  </div>
                </div>

                {/* Personal info card */}
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-muted/40 px-4 py-3 border-b border-border">
                    <p className="text-sm font-bold text-foreground">Información Personal</p>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">NOMBRE</p>
                      <p className="text-sm font-semibold text-foreground">{enrollmentResult.nombre || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">APELLIDO PATERNO</p>
                      <p className="text-sm font-semibold text-foreground">{enrollmentResult.apellidoPaterno || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">APELLIDO MATERNO</p>
                      <p className="text-sm font-semibold text-foreground">{enrollmentResult.apellidoMaterno || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">CURP</p>
                      <p className="text-sm font-semibold text-foreground font-mono">{enrollmentResult.curp || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">FECHA NACIMIENTO</p>
                      <p className="text-sm font-semibold text-foreground">{enrollmentResult.fechaNacimiento || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">SEXO</p>
                      <p className="text-sm font-semibold text-foreground">{enrollmentResult.sexo === 'M' ? 'Masculino' : enrollmentResult.sexo === 'F' ? 'Femenino' : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">TIPO DE ID</p>
                      <p className="text-sm font-semibold text-foreground">{enrollmentResult.tipoIdentificacion || '—'}</p>
                    </div>
                    {enrollmentResult.rfc && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">RFC</p>
                        <p className="text-sm font-semibold text-foreground font-mono">{enrollmentResult.rfc}</p>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleConfirmAndRegister}
                  disabled={isRegistering}
                  className="w-full py-3 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isRegistering ? (
                    <><Loader2 size={16} className="animate-spin" /> Registrando...</>
                  ) : (
                    <><CheckCircle2 size={16} />Confirmar datos y registrar usuario</>
                  )}
                </button>
                {registrationError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 w-full">
                    <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600">{registrationError}</p>
                  </div>
                )}
              </div>
            );
          }

          // QR display
          return (
            <div className="space-y-4">
              <button
                onClick={() => {
                  update({ identityMethod: null });
                  setBiometricoValidated(false);
                  setQrUrl(null);
                  const supabase = createClient();
                  if (realtimeChannelRef.current) {
                    supabase.removeChannel(realtimeChannelRef.current);
                    realtimeChannelRef.current = null;
                  }
                  if (realtimeResultsChannelRef.current) {
                    supabase.removeChannel(realtimeResultsChannelRef.current);
                    realtimeResultsChannelRef.current = null;
                  }
                  if (pollingIntervalRef.current) {
                    clearInterval(pollingIntervalRef.current);
                    pollingIntervalRef.current = null;
                  }
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft size={14} /> Cambiar método
              </button>

              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-2 w-full justify-center">
                  <QrCode size={16} className="text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Código QR de enrolamiento</h3>
                </div>

                <div className="bg-white border-2 border-border rounded-xl p-5 flex flex-col items-center gap-4 w-full max-w-[500px]">
                  {qrLoading ? (
                    <div className="w-44 h-44 flex items-center justify-center">
                      <Loader2 size={32} className="text-primary animate-spin" />
                    </div>
                  ) : qrExpired ? (
                    <div className="w-44 h-44 flex flex-col items-center justify-center gap-3">
                      <AlertCircle size={32} className="text-red-400" />
                      <p className="text-xs text-red-500 font-semibold text-center">Código expirado</p>
                    </div>
                  ) : qrUrl ? (
                    <div className="p-2 bg-white rounded-lg border border-border">
                      <QRCodeSVG
                        value={qrUrl}
                        size={160}
                        level="M"
                        includeMargin={false}
                      />
                    </div>
                  ) : (
                    <div className="w-44 h-44 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-xl">
                      <QrCode size={32} className="text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground text-center">Genera el código QR para comenzar</p>
                    </div>
                  )}

                  {/* Timer */}
                  {qrUrl && !qrExpired && (
                    <div className="flex items-center gap-2">
                      <Clock size={13} className={qrTimeLeft < 60 ? 'text-red-500' : 'text-muted-foreground'} />
                      <span className={`text-xs font-mono font-semibold ${qrTimeLeft < 60 ? 'text-red-500' : 'text-muted-foreground'}`}>
                        Válido por {timeStr}
                      </span>
                    </div>
                  )}

                  {/* Generate / Regenerate button */}
                  {(!qrUrl || qrExpired) && (
                    <button
                      onClick={generateQrToken}
                      disabled={qrLoading}
                      className="w-full py-2 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                    >
                      {qrLoading ? (
                        <><Loader2 size={12} className="animate-spin" /> Generando...</>
                      ) : qrExpired ? (
                        <><RefreshCw size={12} /> Generar nuevo código</>
                      ) : (
                        <><QrCode size={12} /> Generar código QR</>
                      )}
                    </button>
                  )}

                  {/* Waiting indicator */}
                  {qrUrl && !qrExpired && (
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 w-full">
                      <Loader2 size={13} className="text-blue-500 animate-spin flex-shrink-0" />
                      <span className="text-xs text-blue-600 font-medium">Esperando enrolamiento, no cierres esta pantalla</span>
                    </div>
                  )}
                </div>
              </div>

              {errors.biometrico && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 w-full max-w-[500px]">
                  <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{errors.biometrico}</p>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-1.5 w-full max-w-[500px]">
                <p className="text-xs font-bold text-blue-700">¿Cómo funciona?</p>
                {[
                  '1. Haz clic en "Generar código QR"',
                  '2. Escanea el QR con la cámara de tu teléfono',
                  '3. Sigue las instrucciones en tu dispositivo móvil',
                  '4. Toma fotos de tu ID y una selfie',
                  '5. Los datos se validarán automáticamente aquí',
                ].map((step) => (
                  <p key={step} className="text-[11px] text-blue-600">{step}</p>
                ))}
              </div>
            </div>
          );
        }

        return null;

      default:
        return null;
    }
  };

  const stepTitles: Record<number, { title: string; subtitle: string }> = {
    1: { title: 'Datos de contacto', subtitle: 'Ingresa tu correo y teléfono para comenzar' },
    2: { title: 'Crear contraseña', subtitle: 'Elige una contraseña segura para tu cuenta' },
    3: { title: '¿Cómo usarás DocuBox?', subtitle: 'Selecciona el tipo de cuenta que mejor se adapte a ti' },
    4: { title: 'Define tu Personalidad Jurídica', subtitle: 'Esto determina cómo firmarás y serás identificado legalmente' },
    5: { title: 'Acredita tu Identidad', subtitle: 'Verifica tu identidad para activar tu cuenta' },
  };

  const isStep5WithMethod = currentStep === 5 && (data.identityMethod !== null || data.personalidadJuridica === 'moral');
  const isStep5Wide = currentStep === 5 && (
    (biometricoValidated && !!enrollmentResult) ||
    (data.personalidadJuridica === 'moral' && (efirmaMoralValidated))
  );

  const isStep5Efirma = currentStep === 5 && (
    data.identityMethod === 'efirma' ||
    data.identityMethod === 'biometrico' ||
    (data.personalidadJuridica === 'moral' && !efirmaMoralValidated)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 bg-white/80 backdrop-blur-sm border-b border-border/50">
        <AppLogo size={32} />
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">¿Ya tienes cuenta?</span>
          <button
            onClick={() => router.push('/login')}
            className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            Iniciar sesión
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-start justify-center py-8 px-4">
        <div className={`w-full transition-all duration-300 ${isStep5Wide ? 'max-w-3xl' : isStep5Efirma ? 'max-w-[500px]' : 'max-w-md'}`}>
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-0 mb-8">
            {STEPS.map((step, idx) => (
              <React.Fragment key={step.id}>
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                      step.id < currentStep
                        ? 'bg-primary text-white'
                        : step.id === currentStep
                        ? 'bg-primary text-white ring-4 ring-primary/20' :'bg-muted text-muted-foreground'
                    }`}
                  >
                    {step.id < currentStep ? (
                      <Check size={14} strokeWidth={3} />
                    ) : (
                      step.id
                    )}
                  </div>
                  <span className={`text-[10px] font-medium whitespace-nowrap ${
                    step.id === currentStep ? 'text-primary' : 'text-muted-foreground'
                  }`}>
                    {step.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`h-0.5 w-10 mb-4 mx-1 transition-all duration-300 ${
                    step.id < currentStep ? 'bg-primary' : 'bg-border'
                  }`} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-modal border border-border/50 overflow-hidden">
            {/* Card header */}
            <div className="px-7 pt-7 pb-5 border-b border-border/50">
              <h1 className="text-xl font-bold text-foreground">
                {stepTitles[currentStep]?.title}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {stepTitles[currentStep]?.subtitle}
              </p>
            </div>

            {/* Card body */}
            <div className="px-7 py-6">
              {renderStep()}
            </div>

            {/* Card footer — hide when step 5 has method selected */}
            {!isStep5WithMethod && (
              <div className="px-7 pb-7 flex items-center justify-between gap-3">
                <button
                  onClick={currentStep === 1 ? () => router.push('/login') : handleBack}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150"
                >
                  <ArrowLeft size={15} />
                  {currentStep === 1 ? 'Cancelar' : 'Anterior'}
                </button>
                {currentStep < 5 && (
                  <button
                    onClick={handleNext}
                    disabled={isStep1NextDisabled}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-all duration-150 shadow-card disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Siguiente
                    <ArrowRight size={15} />
                  </button>
                )}
                {currentStep === 5 && !data.identityMethod && (
                  <button
                    onClick={() => {
                      if (!selectedIdentityMethod) {
                        setErrors((prev) => ({ ...prev, identityMethod: 'Selecciona un método de acreditación' }));
                        return;
                      }
                      setErrors((prev) => ({ ...prev, identityMethod: '' }));
                      update({ identityMethod: selectedIdentityMethod });
                    }}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-all duration-150 shadow-card disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Continuar
                    <ArrowRight size={15} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Progress text */}
          <p className="text-center text-xs text-muted-foreground mt-4">
            Paso {currentStep} de {STEPS.length}
          </p>
        </div>
      </main>
    </div>
  );
}
