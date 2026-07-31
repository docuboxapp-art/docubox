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

interface AutografaStampSelectorProps {
  signatureUrl: string | null;
  userName: string | null;
  userRfc: string | null;
  currentStampStyle: string;
  onSave: (stampStyle: string) => Promise<void>;
}

// ─── Stamp Definitions ────────────────────────────────────────────────────────

const STAMP_VARIANTS: StampVariant[] = [
  // Cortas
  { id: 'AC0', label: 'AC0 · Solo Firma y Hash', subtitle: 'Autógrafa · Mínima absoluta', description: 'Únicamente la firma autógrafa y el hash SHA-256.', category: 'corta' },
  { id: 'AC1', label: 'AC1 · Mínima con QR', subtitle: 'Autógrafa · Información mínima', description: 'Trazo, hash, fecha, IP, QR.', category: 'corta' },
  { id: 'AC2', label: 'AC2 · Avatar + 4 campos', subtitle: 'Autógrafa · Información mínima', description: 'Avatar, trazo libre, hash, RFC, fecha, IP, OTP.', category: 'corta' },
  { id: 'AC3', label: 'AC3 · Notarial Compacta', subtitle: 'Autógrafa · Información mínima', description: 'Esquinas decorativas, firma centrada, QR abajo.', category: 'corta' },
  { id: 'AC4', label: 'AC4 · Franja Lateral', subtitle: 'Autógrafa · Información mínima', description: 'Barra izquierda, trazo libre, hash, 2 campos, URL.', category: 'corta' },
  { id: 'AC5', label: 'AC5 · Ticket Vertical', subtitle: 'Autógrafa · Información mínima', description: 'Angosto centrado, QR grande, ideal para impresión.', category: 'corta' },
  // Medianas
  { id: 'AM1', label: 'AM1 · Estándar Mediana', subtitle: 'Autógrafa · Información intermedia', description: 'Avatar, trazo en caja, hash completo, 6 campos, QR+URL.', category: 'mediana' },
  { id: 'AM2', label: 'AM2 · Notarial Mediana', subtitle: 'Autógrafa · Información intermedia', description: 'Esquinas, centrada, CURP + 5 campos + QR.', category: 'mediana' },
  { id: 'AM3', label: 'AM3 · Franja 3 Columnas', subtitle: 'Autógrafa · Información intermedia', description: 'Barra lateral, trazo libre, hash, 6 campos en 3 col.', category: 'mediana' },
  { id: 'AM4', label: 'AM4 · Dark Header Mediana', subtitle: 'Autógrafa · Información intermedia', description: 'Header oscuro con avatar, body blanco, 6 campos, QR.', category: 'mediana' },
  { id: 'AM5', label: 'AM5 · Ticket QR Grande', subtitle: 'Autógrafa · Información intermedia', description: 'Ticket con QR prominente al pie, 4 campos.', category: 'mediana' },
  // Largas
  { id: 'AL1', label: 'AL1 · Completa 3 columnas', subtitle: 'Autógrafa · Información completa', description: 'Avatar, trazo, biometría, QR+nivel al pie.', category: 'larga' },
  { id: 'AL2', label: 'AL2 · Notarial Larga', subtitle: 'Autógrafa · Información completa', description: 'Esquinas, avatar centrado, hash, 10 campos en 2 col., nivel explícito.', category: 'larga' },
  { id: 'AL3', label: 'AL3 · Franja 3 col. Larga', subtitle: 'Autógrafa · Información completa', description: 'Nivel, 12 campos en grilla de 3, biometría del trazo, precisión GPS.', category: 'larga' },
  { id: 'AL4', label: 'AL4 · Constancia Estructurada', subtitle: 'Autógrafa · Información completa', description: 'Formato constancia, 6 campos identidad + 8 campos evento + nivel explícito.', category: 'larga' },
];

const CATEGORY_LABELS: Record<string, { label: string; range: string; color: string; bg: string; border: string }> = {
  corta: { label: 'Corta', range: 'Información mínima · 4 a 5 campos', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  mediana: { label: 'Mediana', range: 'Información intermedia · 7 a 9 campos', color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
  larga: { label: 'Larga', range: 'Información completa · 11 a 14 campos', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
};

// ─── Stamp Preview ────────────────────────────────────────────────────────────

function StampPreview({ variant, signatureUrl, userName, userRfc }: {
  variant: StampVariant;
  signatureUrl: string | null;
  userName: string | null;
  userRfc: string | null;
}) {
  const nombre = userName || 'Luis García M.';
  const rfc = userRfc || 'GAML880512AB1';
  const hashShort = '4af2c8b1d3e9f0a2...e7f0a3';
  const hashFull = '4af2c8b1d3e9f0a2c7b4e1d8f3a9c2b7e0d4f1a8c3b6e9f2a5c8b1d4e7f0a3';
  const fecha = '25/03/2025 CST';
  const ip = '189.203.12.45';
  const geoloc = 'CDMX ±80m';
  const otp = 'WhatsApp ✓';

  const signatureImg = signatureUrl ? (
    <img src={signatureUrl} alt="Firma autógrafa" className="max-h-10 max-w-full object-contain" />
  ) : (
    <svg viewBox="0 0 120 30" width="100%" height="30" className="opacity-60">
      <path d="M5,20 Q20,5 35,18 Q50,30 65,12 Q80,0 95,15 Q110,28 118,18" stroke="#374151" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );

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
      <p className="text-[6px] font-semibold text-amber-700 uppercase tracking-wide">🔑 HASH FIRMADO SHA-256</p>
      <p className="text-[7px] font-mono text-gray-700 break-all leading-tight mt-0.5">{full ? hashFull : hashShort}</p>
    </div>
  );

  const sigBox = () => (
    <div className="border border-gray-300 rounded bg-gray-50 flex items-center justify-center p-1 min-h-[32px]">
      {signatureImg}
    </div>
  );

  const urlLine = () => (
    <p className="text-[7px] text-blue-600 leading-tight">verify.docubox.mx/4af2c8b1</p>
  );

  // ── AC0 Solo Firma y Hash ──
  if (variant.id === 'AC0') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full items-center justify-center">
      <div className="border border-gray-300 rounded bg-gray-50 flex items-center justify-center p-1.5 min-h-[36px] w-full">
        {signatureImg}
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded px-1.5 py-1 w-full">
        <p className="text-[6px] font-semibold text-amber-700 uppercase tracking-wide">🔑 HASH FIRMADO SHA-256</p>
        <p className="text-[7px] font-mono text-gray-700 break-all leading-tight mt-0.5">{hashShort}</p>
      </div>
    </div>
  );

  // ── AC1 Mínima con QR ──
  if (variant.id === 'AC1') return (
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

  // ── AC2 Avatar + 4 campos ──
  if (variant.id === 'AC2') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <span className="text-[9px] font-bold text-blue-700">{nombre.charAt(0)}</span>
        </div>
        <div>
          <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
          <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
        </div>
      </div>
      {sigBox()}
      {hashBlock()}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FECHA/TZ', fecha)}
        {fieldRow('IP', ip)}
        {fieldRow('OTP', otp)}
        {fieldRow('GEOLOC', geoloc)}
      </div>
    </div>
  );

  // ── AC3 Notarial Compacta ──
  if (variant.id === 'AC3') return (
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

  // ── AC4 Franja Lateral ──
  if (variant.id === 'AC4') return (
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

  // ── AC5 Ticket Vertical ──
  if (variant.id === 'AC5') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full items-center">
      <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
      {sigBox()}
      {hashBlock()}
      {qrBlock}
    </div>
  );

  // ── AM1 Estándar Mediana ──
  if (variant.id === 'AM1') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <span className="text-[9px] font-bold text-blue-700">{nombre.charAt(0)}</span>
        </div>
        <div>
          <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
          <p className="text-[7px] text-gray-500">{rfc} · Firmante #1</p>
        </div>
      </div>
      {sigBox()}
      {hashBlock(true)}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FECHA', fecha)}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', geoloc)}
        {fieldRow('OTP', otp)}
        {fieldRow('DISPOSITIVO', 'Chrome / macOS')}
        {fieldRow('NIVEL', 'Simple')}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">{urlLine()}</div>
        {qrBlock}
      </div>
    </div>
  );

  // ── AM2 Notarial Mediana ──
  if (variant.id === 'AM2') return (
    <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
      <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
      <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
      <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
      <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
      <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
      <p className="text-[7px] text-gray-500 text-center">CURP: GAML880512HMCRCR08</p>
      {sigBox()}
      {hashBlock()}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FECHA', fecha)}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', geoloc)}
        {fieldRow('OTP', otp)}
        {fieldRow('NIVEL', 'Simple')}
        {fieldRow('RFC', rfc)}
      </div>
      <div className="flex justify-center">{qrBlock}</div>
    </div>
  );

  // ── AM3 Franja 3 Columnas ──
  if (variant.id === 'AM3') return (
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
          {fieldRow('OTP', otp)}
          {fieldRow('DISPOSITIVO', 'Chrome')}
          {fieldRow('NIVEL', 'Simple')}
        </div>
      </div>
    </div>
  );

  // ── AM4 Dark Header Mediana ──
  if (variant.id === 'AM4') return (
    <div className="border border-gray-200 rounded-lg bg-white text-left flex flex-col w-full overflow-hidden">
      <div className="bg-gray-800 px-2 py-1.5 flex items-center gap-1.5">
        <div className="w-5 h-5 rounded-full bg-blue-400 flex items-center justify-center flex-shrink-0">
          <span className="text-[8px] font-bold text-white">{nombre.charAt(0)}</span>
        </div>
        <p className="text-[9px] font-bold text-white">{nombre}</p>
        <span className="ml-auto text-[6px] text-gray-300">{rfc}</span>
      </div>
      <div className="p-2 flex flex-col gap-1.5">
        {sigBox()}
        {hashBlock(true)}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', geoloc)}
          {fieldRow('OTP', otp)}
          {fieldRow('DISPOSITIVO', 'Chrome / macOS')}
          {fieldRow('NIVEL', 'Simple')}
        </div>
        <div className="flex justify-center">{qrBlock}</div>
      </div>
    </div>
  );

  // ── AM5 Ticket QR Grande ──
  if (variant.id === 'AM5') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full items-center">
      <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
      {sigBox()}
      {hashBlock()}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 w-full">
        {fieldRow('FECHA', fecha)}
        {fieldRow('IP', ip)}
        {fieldRow('OTP', otp)}
        {fieldRow('NIVEL', 'Simple')}
      </div>
      {qrBlock}
    </div>
  );

  // ── AL1 Completa 3 columnas ──
  if (variant.id === 'AL1') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <span className="text-[9px] font-bold text-blue-700">{nombre.charAt(0)}</span>
        </div>
        <div>
          <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
          <p className="text-[7px] text-gray-500">{rfc}</p>
        </div>
      </div>
      {sigBox()}
      {hashBlock(true)}
      <div className="grid grid-cols-3 gap-x-1 gap-y-1">
        {fieldRow('FECHA', fecha)}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', geoloc)}
        {fieldRow('OTP', otp)}
        {fieldRow('DISPOSITIVO', 'Chrome')}
        {fieldRow('NIVEL', 'Simple')}
        {fieldRow('BIOMETRÍA', 'Presión · Vel.')}
        {fieldRow('ORDEN', '#1 de 2')}
        {fieldRow('CURP', 'GAML880512...')}
        {fieldRow('RFC', rfc)}
        {fieldRow('SELLO', 'DigiCert ✓')}
        {fieldRow('CADENA', 'XML Evidence')}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">{urlLine()}</div>
        {qrBlock}
      </div>
    </div>
  );

  // ── AL2 Notarial Larga ──
  if (variant.id === 'AL2') return (
    <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
      <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
      <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
      <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
      <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
      <div className="flex justify-center">
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <span className="text-[10px] font-bold text-blue-700">{nombre.charAt(0)}</span>
        </div>
      </div>
      <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
      {sigBox()}
      {hashBlock(true)}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FECHA', fecha)}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', geoloc)}
        {fieldRow('OTP', otp)}
        {fieldRow('DISPOSITIVO', 'Chrome / macOS')}
        {fieldRow('NIVEL', 'Simple')}
        {fieldRow('BIOMETRÍA', 'Presión · Vel.')}
        {fieldRow('ORDEN', '#1 de 2')}
        {fieldRow('CURP', 'GAML880512...')}
        {fieldRow('RFC', rfc)}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">{urlLine()}</div>
        {qrBlock}
      </div>
    </div>
  );

  // ── AL3 Franja 3 col. Larga ──
  if (variant.id === 'AL3') return (
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
          {fieldRow('OTP', otp)}
          {fieldRow('DISPOSITIVO', 'Chrome')}
          {fieldRow('NIVEL', 'Simple')}
          {fieldRow('BIOMETRÍA', 'Presión · Vel.')}
          {fieldRow('PRECISIÓN GPS', '±80m')}
          {fieldRow('ORDEN', '#1 de 2')}
          {fieldRow('CURP', 'GAML880512...')}
          {fieldRow('RFC', rfc)}
          {fieldRow('SELLO', 'DigiCert ✓')}
        </div>
        {urlLine()}
      </div>
    </div>
  );

  // ── AL4 Constancia Estructurada ──
  if (variant.id === 'AL4') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FIRMANTE', nombre)}
        {fieldRow('RFC', rfc)}
        {fieldRow('CURP', 'GAML880512HMCRCR08')}
        {fieldRow('ROL', 'Apoderado Legal')}
        {fieldRow('NIVEL', 'Firma Electrónica Simple')}
        {fieldRow('ORDEN', '#1 de 2')}
      </div>
      {sigBox()}
      {hashBlock(true)}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FECHA / TZ', `2025-03-25 · 14:32:07 CST`)}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', `19.43°N 99.13°W · ±80m`)}
        {fieldRow('DISPOSITIVO', `Chrome 123 · macOS 14.3`)}
        {fieldRow('OTP CANAL', otp)}
        {fieldRow('SELLO RFC 3161', 'DigiCert TSA ✓')}
        {fieldRow('BIOMETRÍA TRAZO', 'Presión · Velocidad · Ángulo')}
        {fieldRow('NIVEL FIRMA', 'Firma Electrónica Simple')}
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
  AC0: { label: 'AC0 · Solo Firma y Hash', elements: ['Trazo de firma autógrafa digitalizada', 'Hash SHA-256 del documento firmado'] },
  AC1: { label: 'AC1 · Mínima con QR', elements: ['Nombre del firmante', 'RFC', 'Trazo de firma autógrafa', 'Hash SHA-256 (corto)', 'Fecha y zona horaria', 'Dirección IP', 'URL de verificación', 'Código QR de verificación'] },
  AC2: { label: 'AC2 · Avatar + 4 campos', elements: ['Avatar / inicial del nombre', 'Nombre del firmante', 'RFC', 'Trazo de firma autógrafa', 'Hash SHA-256 (corto)', 'Fecha y zona horaria', 'Dirección IP', 'Canal OTP (WhatsApp)', 'Geolocalización'] },
  AC3: { label: 'AC3 · Notarial Compacta', elements: ['Esquinas decorativas notariales', 'Nombre del firmante', 'Trazo de firma autógrafa centrado', 'Hash SHA-256 (corto)', 'Código QR de verificación'] },
  AC4: { label: 'AC4 · Franja Lateral', elements: ['Barra lateral verde', 'Nombre del firmante', 'Trazo de firma autógrafa', 'Hash SHA-256 (corto)', 'Fecha y zona horaria', 'Dirección IP', 'URL de verificación'] },
  AC5: { label: 'AC5 · Ticket Vertical', elements: ['Nombre del firmante', 'Trazo de firma autógrafa', 'Hash SHA-256 (corto)', 'Código QR grande de verificación'] },
  AM1: { label: 'AM1 · Estándar Mediana', elements: ['Avatar / inicial del nombre', 'Nombre del firmante', 'RFC', 'Número de firmante', 'Trazo de firma autógrafa', 'Hash SHA-256 (completo)', 'Fecha y zona horaria', 'Dirección IP', 'Geolocalización', 'Canal OTP', 'Dispositivo y navegador', 'Nivel de firma', 'URL de verificación', 'Código QR'] },
  AM2: { label: 'AM2 · Notarial Mediana', elements: ['Esquinas decorativas notariales', 'Nombre del firmante', 'CURP', 'Trazo de firma autógrafa', 'Hash SHA-256 (corto)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Canal OTP', 'Nivel de firma', 'RFC', 'Código QR'] },
  AM3: { label: 'AM3 · Franja 3 Columnas', elements: ['Barra lateral verde', 'Nombre del firmante', 'Trazo de firma autógrafa', 'Hash SHA-256 (completo)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Canal OTP', 'Dispositivo', 'Nivel de firma'] },
  AM4: { label: 'AM4 · Dark Header Mediana', elements: ['Encabezado oscuro con avatar', 'Nombre del firmante', 'RFC', 'Trazo de firma autógrafa', 'Hash SHA-256 (completo)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Canal OTP', 'Dispositivo', 'Nivel de firma', 'Código QR'] },
  AM5: { label: 'AM5 · Ticket QR Grande', elements: ['Nombre del firmante', 'Trazo de firma autógrafa', 'Hash SHA-256 (corto)', 'Fecha', 'Dirección IP', 'Canal OTP', 'Nivel de firma', 'Código QR'] },
  AL1: { label: 'AL1 · Completa 3 columnas', elements: ['Avatar / inicial', 'Nombre del firmante', 'RFC', 'Trazo de firma autógrafa', 'Hash SHA-256 (completo)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Canal OTP', 'Dispositivo', 'Nivel de firma', 'Biometría del trazo (presión, velocidad)', 'Orden de firma', 'CURP', 'Sello RFC 3161', 'Cadena XML Evidence', 'URL de verificación', 'Código QR'] },
  AL2: { label: 'AL2 · Notarial Larga', elements: ['Esquinas decorativas notariales', 'Avatar centrado', 'Nombre del firmante', 'Trazo de firma autógrafa', 'Hash SHA-256 (completo)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Canal OTP', 'Dispositivo', 'Nivel de firma', 'Biometría del trazo', 'Orden de firma', 'CURP', 'RFC', 'URL de verificación', 'Código QR'] },
  AL3: { label: 'AL3 · Franja 3 col. Larga', elements: ['Barra lateral verde', 'Nombre del firmante', 'Trazo de firma autógrafa', 'Hash SHA-256 (completo)', 'Fecha', 'Dirección IP', 'Geolocalización', 'Canal OTP', 'Dispositivo', 'Nivel de firma', 'Biometría del trazo', 'Precisión GPS', 'Orden de firma', 'CURP', 'RFC', 'Sello DigiCert', 'URL de verificación'] },
  AL4: { label: 'AL4 · Constancia Estructurada', elements: ['Nombre del firmante', 'RFC', 'CURP', 'Rol del firmante', 'Nivel de firma', 'Orden de firma', 'Trazo de firma autógrafa', 'Hash SHA-256 (completo)', 'Fecha y hora', 'Dirección IP', 'Geolocalización con coordenadas', 'Dispositivo y navegador', 'Canal OTP', 'Sello RFC 3161 DigiCert', 'Biometría del trazo (presión, velocidad, ángulo)', 'Nivel de firma explícito', 'URL de verificación', 'Código QR'] },
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
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-700 text-foreground">{detail.label}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{variant.description}</p>
            <span className={`inline-block text-[9px] font-600 px-2 py-0.5 rounded-full mt-1.5 ${catInfo.bg} ${catInfo.color} border ${catInfo.border}`}>
              {variant.subtitle}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors flex-shrink-0 ml-3"
          >
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        {/* Body */}
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
        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/10">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm font-600 text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted/30 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AutografaStampSelector({
  signatureUrl,
  userName,
  userRfc,
  currentStampStyle,
  onSave,
}: AutografaStampSelectorProps) {
  const [selected, setSelected] = useState(currentStampStyle || 'AC1');
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
    setSelected(currentStampStyle || 'AC1');
    setSelectorOpen(false);
  };

  const categories: Array<'corta' | 'mediana' | 'larga'> = ['corta', 'mediana', 'larga'];
  const currentVariant = STAMP_VARIANTS.find(v => v.id === (currentStampStyle || 'AC1'));
  const currentCat = currentVariant ? CATEGORY_LABELS[currentVariant.category] : null;

  return (
    <>
      {/* ── Compact preview box ── */}
      <div className="flex flex-col gap-3">
        <div>
          <h4 className="text-sm font-700 text-foreground">Estampa de Firma Autógrafa</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Elige el estilo de estampa que se imprimirá en los documentos firmados con tu firma autógrafa digitalizada.
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
              onClick={() => { setSelected(currentStampStyle || 'AC1'); setSelectorOpen(true); }}
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
                <h3 className="text-sm font-700 text-foreground">Seleccionar Estampa · Firma Autógrafa</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Elige el diseño de estampa para tus documentos firmados con firma autógrafa.</p>
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
                                    <StampPreview
                                      variant={variant}
                                      signatureUrl={signatureUrl}
                                      userName={userName}
                                      userRfc={userRfc}
                                    />
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
