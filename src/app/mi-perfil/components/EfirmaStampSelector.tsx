'use client';

import React, { useState } from 'react';
import { CheckCircle, Save, Loader2, ChevronDown, ChevronUp, X, Edit2, Info } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StampVariant {
  id: string;
  label: string;
  subtitle: string;
  description: string;
  category: 'corta' | 'mediana' | 'larga';
}

interface EfirmaStampSelectorProps {
  efirmaData: {
    rfc: string | null;
    nombre: string | null;
    vigenciaFin: string | null;
  };
  currentStampStyle: string;
  onSave: (stampStyle: string) => Promise<void>;
}

// ─── Stamp Definitions ────────────────────────────────────────────────────────

const STAMP_VARIANTS: StampVariant[] = [
  // Cortas
  { id: 'EC1', label: 'EC1 · Mínima', subtitle: 'e.Firma SAT · Información mínima', description: 'Nivel, cert., hash RSA, OCSP, fecha, URL.', category: 'corta' },
  { id: 'EC2', label: 'EC2 · Check + QR', subtitle: 'e.Firma SAT · Información mínima', description: 'Ícono check, cert. expandido, hash RSA, fecha+IP, QR.', category: 'corta' },
  { id: 'EC3', label: 'EC3 · Franja Lateral', subtitle: 'e.Firma SAT · Información mínima', description: 'Barra izq., cert. inline, hash RSA, fecha, URL.', category: 'corta' },
  { id: 'EC4', label: 'EC4 · Centrada + QR', subtitle: 'e.Firma SAT · Información mínima', description: 'Layout centrado, cert. + OCSP inline, QR al pie.', category: 'corta' },
  { id: 'EC5', label: 'EC5 · Hash + QR Lateral', subtitle: 'e.Firma SAT · Información mínima', description: 'Hash+cert izquierda, QR grande derecha. Ultra compacta.', category: 'corta' },
  // Medianas
  { id: 'EM1', label: 'EM1 · Estándar', subtitle: 'e.Firma SAT · Información intermedia', description: 'Check, cert., hash RSA completo, 6 campos, QR+nivel.', category: 'mediana' },
  { id: 'EM2', label: 'EM2 · Notarial Mediana', subtitle: 'e.Firma SAT · Información intermedia', description: 'Esquinas, centrada, cert. + OCSP inline, hash, 4 campos.', category: 'mediana' },
  { id: 'EM3', label: 'EM3 · Franja 3 Columnas', subtitle: 'e.Firma SAT · Información intermedia', description: 'Barra lateral, cert. + hash RSA, 6 campos en 3 col.', category: 'mediana' },
  { id: 'EM4', label: 'EM4 · Dark Header Mediana', subtitle: 'e.Firma SAT · Información intermedia', description: 'Header oscuro, cert. + hash RSA, 4 campos, QR.', category: 'mediana' },
  { id: 'EM5', label: 'EM5 · Ticket QR Grande', subtitle: 'e.Firma SAT · Información intermedia', description: 'Ticket centrado, cert. + hash, 4 campos, QR prominente.', category: 'mediana' },
  // Largas
  { id: 'EL1', label: 'EL1 · Completa 3 columnas', subtitle: 'e.Firma SAT · Información completa', description: 'Cert. expandido con OCSP, hash RSA completo, 12 campos en 3 col., nivel al pie.', category: 'larga' },
  { id: 'EL2', label: 'EL2 · Constancia Completa', subtitle: 'e.Firma SAT · Información completa', description: '10 campos identidad+cert. + hash RSA completo + 6 campos evento + XML Evidence.', category: 'larga' },
  { id: 'EL3', label: 'EL3 · Franja 3 col. Larga', subtitle: 'e.Firma SAT · Información completa', description: 'Nivel, cert., hash RSA, 12 campos en 3 col., cadena de custodia.', category: 'larga' },
  { id: 'EL4', label: 'EL4 · Notarial Larga', subtitle: 'e.Firma SAT · Información completa', description: 'Esquinas, avatar centrado, cert. expandido, hash RSA, 8 campos, nivel + cadena.', category: 'larga' },
];

const CATEGORY_LABELS: Record<string, { label: string; range: string; color: string; bg: string; border: string }> = {
  corta: { label: 'Corta', range: 'Información mínima · 4 a 5 campos', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  mediana: { label: 'Mediana', range: 'Información intermedia · 7 a 9 campos', color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
  larga: { label: 'Larga', range: 'Información completa · 11 a 14 campos', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
};

// ─── Stamp Preview ────────────────────────────────────────────────────────────

function StampPreview({ variant, efirmaData }: { variant: StampVariant; efirmaData: EfirmaStampSelectorProps['efirmaData'] }) {
  const nombre = efirmaData.nombre || 'Luis García Martínez';
  const rfc = efirmaData.rfc || 'GAML880512AB1';
  const vigencia = efirmaData.vigenciaFin || '2026-04-01';
  const hashShort = 'MIIBcjANBgkq...7c91Zp==';
  const hashFull = 'MIIBcjANBgkqhkiG9w0BAQEFAAOCAg8AMIIBCgKCAQEA3k9xRf2a...7c91Zp==';
  const fecha = '25/03/2025 CST';
  const ip = '189.203.12.45';
  const geoloc = 'CDMX ±80m';
  const dispositivo = 'Chrome / macOS';
  const ocsp = 'Válido ✓';
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
    <div className="bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
      <p className="text-[6px] font-semibold text-amber-700 uppercase tracking-wide">🔑 HASH FIRMADO RSA / SHA-256</p>
      <p className="text-[7px] font-mono text-gray-700 break-all leading-tight mt-0.5">{full ? hashFull : hashShort}</p>
    </div>
  );

  const certLine = (expanded = false) => (
    <p className="text-[7px] text-gray-500 leading-tight">
      {expanded
        ? `Cert.: 200010.2815 · RSA-2048/SHA-256 · OCSP: Válido ✓ · Vigencia: 2022-04-01 → ${vigencia}`
        : `Cert.: 200010.2815 · RSA-2048 · → ${vigencia}`}
    </p>
  );

  const urlLine = () => (
    <p className="text-[7px] text-blue-600 leading-tight">verify.docubox.mx/MIIBcjAN</p>
  );

  if (variant.id === 'EC1') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
      <p className="text-[7px] text-gray-500">RFC: {rfc} · #1</p>
      {certLine()}
      {hashBlock()}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('OCSP', ocsp)}
        {fieldRow('FECHA/TZ', fecha)}
      </div>
      {urlLine()}
    </div>
  );

  if (variant.id === 'EC2') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded border-2 border-blue-500 flex items-center justify-center flex-shrink-0">
            <CheckCircle size={10} className="text-blue-500" />
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc}</p>
          </div>
        </div>
        <span className="text-[6px] text-blue-600 font-semibold border border-blue-300 rounded px-1">OCSP ✓</span>
      </div>
      <p className="text-[7px] text-gray-500">No.: 200010.2815 · RSA-2048/SHA-256<br />Vigencia: 2022-04-01 → {vigencia}</p>
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

  if (variant.id === 'EC3') return (
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

  if (variant.id === 'EC4') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
      <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
      {certLine(true)}
      {hashBlock()}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FIRMA/TZ', fecha)}
        {fieldRow('IP', ip)}
      </div>
      <div className="flex justify-center mt-1">{qrBlock}</div>
    </div>
  );

  if (variant.id === 'EC5') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex gap-2 w-full">
      <div className="flex-1 flex flex-col gap-1.5">
        <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
        <p className="text-[7px] text-gray-500">{rfc} · #1</p>
        <p className="text-[7px] text-gray-500">Cert.: 200010.2815 · RSA-2048 · OCSP ✓</p>
        {hashBlock()}
        {fieldRow('FECHA/TZ', fecha)}
      </div>
      <div className="flex-shrink-0 flex items-center">{qrBlock}</div>
    </div>
  );

  if (variant.id === 'EM1') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded border-2 border-blue-500 flex items-center justify-center flex-shrink-0">
            <CheckCircle size={10} className="text-blue-500" />
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc} · Firmante #1</p>
          </div>
        </div>
        <span className="text-[6px] text-blue-600 font-semibold border border-blue-300 rounded px-1">OCSP ✓</span>
      </div>
      <p className="text-[7px] text-gray-500">No.: 200010.2815 · RSA-2048/SHA-256 · Vigencia: → {vigencia}</p>
      {hashBlock(true)}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('ESTADO OCSP', 'Válido · No revocado')}
        {fieldRow('FECHA', fecha)}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', geoloc)}
        {fieldRow('DISPOSITIVO', dispositivo)}
        {fieldRow('SELLO RFC 3161', 'No configurado')}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">{urlLine()}</div>
        {qrBlock}
      </div>
    </div>
  );

  if (variant.id === 'EM2') return (
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
        {fieldRow('OCSP', ocsp)}
      </div>
    </div>
  );

  if (variant.id === 'EM3') return (
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
          {fieldRow('OCSP', ocsp)}
          {fieldRow('DISPOSITIVO', dispositivo)}
          {fieldRow('RFC 3161', 'No configurado')}
        </div>
      </div>
    </div>
  );

  if (variant.id === 'EM4') return (
    <div className="border border-gray-200 rounded-lg bg-white text-left flex flex-col w-full overflow-hidden">
      <div className="bg-gray-800 px-2 py-1.5 flex items-center gap-1.5">
        <CheckCircle size={10} className="text-green-400" />
        <p className="text-[9px] font-bold text-white">{nombre}</p>
        <span className="ml-auto text-[6px] text-gray-300">{rfc}</span>
      </div>
      <div className="p-2 flex flex-col gap-1.5">
        {certLine(true)}
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('OCSP', ocsp)}
        </div>
        <div className="flex justify-center">{qrBlock}</div>
      </div>
    </div>
  );

  if (variant.id === 'EM5') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full items-center">
      <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
      <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
      {certLine()}
      {hashBlock()}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 w-full">
        {fieldRow('FECHA', fecha)}
        {fieldRow('IP', ip)}
      </div>
      {qrBlock}
    </div>
  );

  if (variant.id === 'EL1') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
      {certLine(true)}
      {hashBlock(true)}
      <div className="grid grid-cols-3 gap-x-1 gap-y-1">
        {fieldRow('FECHA', fecha)}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', geoloc)}
        {fieldRow('OCSP', ocsp)}
        {fieldRow('DISPOSITIVO', dispositivo)}
        {fieldRow('RFC 3161', 'No configurado')}
        {fieldRow('NIVEL FIRMA', 'Avanzada')}
        {fieldRow('ORDEN', '#1 de 2')}
        {fieldRow('VIGENCIA', vigencia)}
        {fieldRow('CERT. NO.', '200010.2815')}
        {fieldRow('ALGORITMO', 'RSA-2048/SHA-256')}
        {fieldRow('CADENA', 'XML Evidence')}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">{urlLine()}</div>
        {qrBlock}
      </div>
    </div>
  );

  if (variant.id === 'EL2') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('NOMBRE', nombre)}
        {fieldRow('RFC', rfc)}
        {fieldRow('CERT. NO.', '200010.2815')}
        {fieldRow('ALGORITMO', 'RSA-2048/SHA-256')}
        {fieldRow('OCSP', ocsp)}
        {fieldRow('VIGENCIA', vigencia)}
        {fieldRow('EMISOR', 'SAT México')}
        {fieldRow('NIVEL', 'Avanzada')}
        {fieldRow('CURP', 'GAML880512HDFRCX01')}
        {fieldRow('SERIE', 'AB1234567890')}
      </div>
      {hashBlock(true)}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FECHA FIRMA', fecha)}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', geoloc)}
        {fieldRow('DISPOSITIVO', dispositivo)}
        {fieldRow('OTP', 'WhatsApp ✓')}
        {fieldRow('XML EVIDENCE', 'Incluido ✓')}
      </div>
      {urlLine()}
    </div>
  );

  if (variant.id === 'EL3') return (
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
          {fieldRow('OCSP', ocsp)}
          {fieldRow('DISPOSITIVO', dispositivo)}
          {fieldRow('RFC 3161', 'No configurado')}
          {fieldRow('NIVEL', 'Avanzada')}
          {fieldRow('ORDEN', '#1 de 2')}
          {fieldRow('VIGENCIA', vigencia)}
          {fieldRow('CERT. NO.', '200010.2815')}
          {fieldRow('ALGORITMO', 'RSA-2048')}
          {fieldRow('CADENA', 'XML Evidence')}
        </div>
        {urlLine()}
      </div>
    </div>
  );

  if (variant.id === 'EL4') return (
    <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
      <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
      <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
      <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
      <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
      <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
      <p className="text-[7px] text-gray-500 text-center">RFC: {rfc}</p>
      {certLine(true)}
      {hashBlock(true)}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FECHA', fecha)}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', geoloc)}
        {fieldRow('OCSP', ocsp)}
        {fieldRow('DISPOSITIVO', dispositivo)}
        {fieldRow('RFC 3161', 'No configurado')}
        {fieldRow('NIVEL', 'Avanzada')}
        {fieldRow('CADENA', 'XML Evidence')}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">{urlLine()}</div>
        {qrBlock}
      </div>
    </div>
  );

  return null;
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

const STAMP_ELEMENTS: Record<string, { label: string; elements: string[] }> = {
  EC1: { label: 'EC1 · Mínima', elements: ['Nombre del firmante', 'RFC y número de firmante', 'Certificado (número, algoritmo, vigencia)', 'Hash RSA / SHA-256 (corto)', 'Estado OCSP', 'Fecha y zona horaria', 'URL de verificación'] },
  EC2: { label: 'EC2 · Check + QR', elements: ['Ícono de verificación (check)', 'Nombre del firmante', 'RFC', 'Badge OCSP ✓', 'Número de certificado', 'Algoritmo RSA-2048/SHA-256', 'Vigencia del certificado', 'Hash RSA / SHA-256 (corto)', 'Fecha y zona horaria', 'IP y geolocalización', 'URL de verificación', 'Código QR'] },
  EC3: { label: 'EC3 · Franja Lateral', elements: ['Barra lateral azul', 'Nombre del firmante', 'Certificado expandido (número, OCSP, vigencia)', 'Hash RSA / SHA-256 (corto)', 'Fecha y zona horaria', 'Dirección IP', 'URL de verificación'] },
  EC4: { label: 'EC4 · Centrada + QR', elements: ['Nombre del firmante', 'RFC', 'Certificado expandido con OCSP inline', 'Hash RSA / SHA-256 (corto)', 'Fecha y zona horaria', 'Dirección IP', 'Código QR centrado'] },
  EC5: { label: 'EC5 · Hash + QR Lateral', elements: ['Nombre del firmante', 'RFC y número de firmante', 'Número de certificado, algoritmo, OCSP', 'Hash RSA / SHA-256 (corto)', 'Fecha y zona horaria', 'Código QR grande lateral'] },
  EM1: { label: 'EM1 · Estándar', elements: ['Ícono de verificación (check)', 'Nombre del firmante', 'RFC y número de firmante', 'Badge OCSP ✓', 'Número de certificado', 'Algoritmo RSA-2048/SHA-256', 'Vigencia del certificado', 'Hash RSA / SHA-256 (completo)', 'Estado OCSP detallado', 'Fecha', 'Dirección IP', 'Geolocalización', 'Dispositivo y navegador', 'Sello RFC 3161', 'URL de verificación', 'Código QR'] },
  EM2: { label: 'EM2 · Notarial Mediana', elements: ['Esquinas decorativas notariales', 'Nombre del firmante', 'RFC', 'Certificado expandido con OCSP inline', 'Hash RSA / SHA-256 (corto)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Estado OCSP'] },
  EM3: { label: 'EM3 · Franja 3 Columnas', elements: ['Barra lateral azul', 'Nombre del firmante', 'Certificado expandido', 'Hash RSA / SHA-256 (completo)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Estado OCSP', 'Dispositivo', 'Sello RFC 3161'] },
  EM4: { label: 'EM4 · Dark Header Mediana', elements: ['Encabezado oscuro con ícono check', 'Nombre del firmante', 'RFC', 'Certificado expandido', 'Hash RSA / SHA-256 (completo)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Estado OCSP', 'Código QR'] },
  EM5: { label: 'EM5 · Ticket QR Grande', elements: ['Nombre del firmante', 'RFC', 'Certificado (número, algoritmo, vigencia)', 'Hash RSA / SHA-256 (corto)', 'Fecha', 'Dirección IP', 'Código QR'] },
  EL1: { label: 'EL1 · Completa 3 columnas', elements: ['Nombre del firmante', 'Certificado expandido con OCSP', 'Hash RSA / SHA-256 (completo)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Estado OCSP', 'Dispositivo', 'Sello RFC 3161', 'Nivel de firma (Avanzada)', 'Orden de firma', 'Vigencia del certificado', 'Número de certificado', 'Algoritmo', 'Cadena XML Evidence', 'URL de verificación', 'Código QR'] },
  EL2: { label: 'EL2 · Constancia Completa', elements: ['Nombre del firmante', 'RFC', 'Número de certificado', 'Algoritmo RSA-2048/SHA-256', 'Estado OCSP', 'Vigencia del certificado', 'Emisor (SAT México)', 'Nivel de firma (Avanzada)', 'CURP', 'Serie del certificado', 'Hash RSA / SHA-256 (completo)', 'Fecha de firma', 'Dirección IP', 'Geolocalización', 'Dispositivo', 'Canal OTP', 'XML Evidence incluido', 'URL de verificación'] },
  EL3: { label: 'EL3 · Franja 3 col. Larga', elements: ['Barra lateral azul', 'Nombre del firmante', 'Certificado expandido', 'Hash RSA / SHA-256 (completo)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Estado OCSP', 'Dispositivo', 'Sello RFC 3161', 'Nivel de firma', 'Orden de firma', 'Vigencia', 'Número de certificado', 'Algoritmo', 'Cadena XML Evidence', 'URL de verificación'] },
  EL4: { label: 'EL4 · Notarial Larga', elements: ['Esquinas decorativas notariales', 'Nombre del firmante', 'RFC', 'Certificado expandido con OCSP', 'Hash RSA / SHA-256 (completo)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Estado OCSP', 'Dispositivo', 'Sello RFC 3161', 'Nivel de firma', 'Cadena XML Evidence', 'URL de verificación', 'Código QR'] },
};

function StampDetailModal({ variant, onClose }: { variant: StampVariant; onClose: () => void }) {
  const detail = STAMP_ELEMENTS[variant.id];
  const catInfo = CATEGORY_LABELS[variant.category];
  if (!detail) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-700 text-foreground">{detail.label}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{variant.description}</p>
            <span className={`inline-block text-[9px] font-600 px-2 py-0.5 rounded-full mt-1.5 ${catInfo.bg} ${catInfo.color} border ${catInfo.border}`}>
              {variant.subtitle}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors flex-shrink-0 ml-3">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4">
          <p className="text-xs font-600 text-foreground mb-3">Elementos incluidos en esta estampa:</p>
          <ul className="flex flex-col gap-2">
            {detail.elements.map((el, i) => (
              <li key={i} className="flex items-start gap-2">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${catInfo.color.replace('text-', 'bg-')}`} />
                <span className="text-xs text-foreground leading-snug">{el}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/10">
          <button onClick={onClose} className="w-full px-4 py-2 text-sm font-600 text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted/30 transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EfirmaStampSelector({ efirmaData, currentStampStyle, onSave }: EfirmaStampSelectorProps) {
  const [selected, setSelected] = useState(currentStampStyle || 'EC1');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('corta');
  const [detailVariant, setDetailVariant] = useState<StampVariant | null>(null);

  const isDirty = selected !== currentStampStyle;

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(selected);
      setSaved(true);
      setSelectorOpen(false);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSelected(currentStampStyle || 'EC1');
    setSelectorOpen(false);
  };

  const categories: Array<'corta' | 'mediana' | 'larga'> = ['corta', 'mediana', 'larga'];
  const currentVariant = STAMP_VARIANTS.find(v => v.id === (currentStampStyle || 'EC1'));
  const currentCat = currentVariant ? CATEGORY_LABELS[currentVariant.category] : null;

  return (
    <>
      {/* ── Compact preview box ── */}
      <div className="flex flex-col gap-3">
        <div>
          <h4 className="text-sm font-700 text-foreground">Estampa de e.Firma SAT</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Elige el estilo de estampa que se imprimirá en los documentos firmados con tu e.Firma SAT.
          </p>
        </div>

        <div className="flex items-center gap-3 p-3 border border-border rounded-xl bg-muted/20">
          {/* Info */}
          <div className="flex-1 min-w-0">
            {currentVariant && currentCat ? (
              <>
                <p className="text-xs font-700 text-foreground leading-tight">{currentVariant.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{currentVariant.description}</p>
                <span className={`inline-block text-[9px] font-600 px-2 py-0.5 rounded-full mt-1 ${currentCat.bg} ${currentCat.color} border ${currentCat.border}`}>
                  {currentVariant.subtitle}
                </span>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Sin estampa seleccionada</p>
            )}
          </div>
          {/* Change button */}
          {!selectorOpen && (
            <button
              onClick={() => { setSelected(currentStampStyle || 'EC1'); setSelectorOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-xs font-600 hover:bg-primary/90 transition-colors flex-shrink-0"
            >
              <Edit2 size={12} />
              Cambiar
            </button>
          )}
        </div>

        {saved && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 font-600 w-fit">
            <CheckCircle size={12} />
            Estampa guardada
          </div>
        )}

        {/* ── Inline selector panel ── */}
        {selectorOpen && (
          <div className="border border-border rounded-xl overflow-hidden bg-white">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
              <div>
                <h3 className="text-sm font-700 text-foreground">Seleccionar Estampa · e.Firma SAT</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Elige el diseño de estampa para tus documentos firmados con e.Firma.</p>
              </div>
              <button onClick={handleCancel} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>

            {/* Panel body */}
            <div className="p-4 flex flex-col gap-4">
              {/* Selected info */}
              {(() => {
                const current = STAMP_VARIANTS.find(v => v.id === selected);
                const cat = current ? CATEGORY_LABELS[current.category] : null;
                if (!current || !cat) return null;
                return (
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${cat.bg} ${cat.border}`}>
                    <CheckCircle size={13} className={cat.color} />
                    <p className={`text-xs font-600 ${cat.color}`}>
                      Seleccionada: <span className="font-700">{current.label}</span> — {current.description}
                    </p>
                  </div>
                );
              })()}

              {/* Category sections */}
              {categories.map((cat) => {
                const catInfo = CATEGORY_LABELS[cat];
                const variants = STAMP_VARIANTS.filter(v => v.category === cat);
                const isOpen = expandedCategory === cat;
                const hasSelected = variants.some(v => v.id === selected);

                return (
                  <div key={cat} className="border border-border rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedCategory(isOpen ? null : cat)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-700 uppercase tracking-wider ${catInfo.color}`}>
                          {catInfo.label.toUpperCase()}S
                        </span>
                        <span className="text-xs text-muted-foreground">— {catInfo.range}</span>
                        {hasSelected && (
                          <span className={`text-[10px] font-600 px-2 py-0.5 rounded-full ${catInfo.bg} ${catInfo.color} border ${catInfo.border}`}>
                            ✓ Activa
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-600 px-2 py-0.5 rounded-full ${catInfo.bg} ${catInfo.color} border ${catInfo.border}`}>
                          {catInfo.label}
                        </span>
                        {isOpen ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="p-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
                        {variants.map((variant) => {
                          const isSelected = selected === variant.id;
                          return (
                            <button
                              key={variant.id}
                              onClick={() => setSelected(variant.id)}
                              className={`relative flex flex-col gap-2 p-2.5 rounded-xl border-2 text-left transition-all hover:shadow-md ${
                                isSelected
                                  ? 'border-primary bg-primary/5 shadow-sm'
                                  : 'border-border bg-white hover:border-primary/40'
                              }`}
                            >
                              {isSelected && (
                                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center z-10">
                                  <CheckCircle size={12} className="text-white" />
                                </div>
                              )}
                              <div className="w-full overflow-hidden rounded-lg border border-border bg-gray-50" style={{ height: '180px' }}>
                                <div style={{ transform: 'scale(0.72)', transformOrigin: 'top left', width: '138.9%', pointerEvents: 'none' }}>
                                  <div className="p-1.5">
                                    <StampPreview variant={variant} efirmaData={efirmaData} />
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <p className={`text-xs font-700 leading-tight ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                                  {variant.label}
                                </p>
                                <p className="text-[10px] text-muted-foreground leading-snug">{variant.description}</p>
                                <span className={`text-[9px] font-600 px-1.5 py-0.5 rounded-full w-fit mt-0.5 ${catInfo.bg} ${catInfo.color} border ${catInfo.border}`}>
                                  {variant.subtitle}
                                </span>
                              </div>
                              {/* Ver detalle button */}
                              <button
                                onClick={(e) => { e.stopPropagation(); setDetailVariant(variant); }}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-white hover:bg-muted/30 text-[10px] font-600 text-muted-foreground hover:text-foreground transition-colors w-fit"
                              >
                                <Info size={10} />
                                Ver detalle
                              </button>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Panel footer */}
            <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-border bg-muted/10">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-600 text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted/30 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-600 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Guardando...' : 'Guardar estampa'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detailVariant && (
        <StampDetailModal variant={detailVariant} onClose={() => setDetailVariant(null)} />
      )}
    </>
  );
}
