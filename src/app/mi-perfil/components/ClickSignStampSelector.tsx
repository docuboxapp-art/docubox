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

interface ClickSignStampSelectorProps {
  userName: string | null;
  userRfc: string | null;
  currentStampStyle: string;
  onSave: (stampStyle: string) => Promise<void>;
}

// ─── Stamp Definitions ────────────────────────────────────────────────────────

const STAMP_VARIANTS: StampVariant[] = [
  // Cortas
  { id: 'CC1', label: 'CC1 · Mínima', subtitle: 'Click & Sign · Información mínima', description: 'Nivel, accept-box, hash, fecha, IP, URL.', category: 'corta' },
  { id: 'CC2', label: 'CC2 · Check circular + QR', subtitle: 'Click & Sign · Información mínima', description: 'Check redondo, frase + OTP, hash, 2 campos, QR.', category: 'corta' },
  { id: 'CC3', label: 'CC3 · Franja + Accept', subtitle: 'Click & Sign · Información mínima', description: 'Barra lateral, frase + fecha inline, hash, URL.', category: 'corta' },
  { id: 'CC4', label: 'CC4 · Centrada Check Grande', subtitle: 'Click & Sign · Información mínima', description: 'Check circular grande, accept-box, hash, QR central.', category: 'corta' },
  { id: 'CC5', label: 'CC5 · Ticket Vertical', subtitle: 'Click & Sign · Información mínima', description: 'Angosto, accept-box centrada, QR grande, ideal para impresión.', category: 'corta' },
  // Medianas
  { id: 'CM1', label: 'CM1 · Estándar Mediana', subtitle: 'Click & Sign · Información intermedia', description: 'Avatar, accept-box + timestamp, hash completo, 6 campos, QR.', category: 'mediana' },
  { id: 'CM2', label: 'CM2 · Franja 3 Columnas', subtitle: 'Click & Sign · Información intermedia', description: 'Barra, accept-box + timestamp, hash, 6 campos en 3 col.', category: 'mediana' },
  { id: 'CM3', label: 'CM3 · Dark Header Mediana', subtitle: 'Click & Sign · Información intermedia', description: 'Header oscuro con check, accept-box, hash, 4 campos, QR.', category: 'mediana' },
  { id: 'CM4', label: 'CM4 · Notarial Mediana', subtitle: 'Click & Sign · Información intermedia', description: 'Esquinas, centrada, accept-box con texto completo, 4 campos.', category: 'mediana' },
  { id: 'CM5', label: 'CM5 · Ticket QR Grande', subtitle: 'Click & Sign · Información intermedia', description: 'Ticket, accept-box + timestamp, hash, 2 campos, QR prominente.', category: 'mediana' },
  // Largas
  { id: 'CL1', label: 'CL1 · Completa 3 columnas', subtitle: 'Click & Sign · Información completa', description: 'Nivel, accept-box texto largo, hash completo, 12 campos en 3 col., nivel al pie.', category: 'larga' },
  { id: 'CL2', label: 'CL2 · Constancia Estructurada', subtitle: 'Click & Sign · Información completa', description: '6 campos identidad + declaración extendida + hash + 6 campos evento + session token.', category: 'larga' },
  { id: 'CL3', label: 'CL3 · Franja 3 col. Larga', subtitle: 'Click & Sign · Información completa', description: 'Nivel, accept-box, hash, 12 campos en 3 col., session token.', category: 'larga' },
  { id: 'CL4', label: 'CL4 · Notarial Larga', subtitle: 'Click & Sign · Información completa', description: 'Esquinas, avatar centrado, accept-box extendida, hash, 8 campos, session token.', category: 'larga' },
];

const CATEGORY_LABELS: Record<string, { label: string; range: string; color: string; bg: string; border: string }> = {
  corta: { label: 'Corta', range: 'Información mínima · 4 a 5 campos', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  mediana: { label: 'Mediana', range: 'Información intermedia · 7 a 9 campos', color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
  larga: { label: 'Larga', range: 'Información completa · 11 a 14 campos', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
};

// ─── Stamp Preview ────────────────────────────────────────────────────────────

function StampPreview({ variant, userName, userRfc }: {
  variant: StampVariant;
  userName: string | null;
  userRfc: string | null;
}) {
  const nombre = userName || 'Luis García M.';
  const rfc = userRfc || 'GAML880512AB1';
  const hashShort = '9d2e4f1a...f5b8';
  const hashFull = '9d2e4f1a8c3b6e0f5b8e1c4f7a0d3e6b9f2c5a8d1e4b7f0c3a6d9e2f5b8';
  const fecha = '25/03/2025 CST';
  const ip = '189.203.12.45';
  const geoloc = 'CDMX ±80m';
  const otp = 'WhatsApp ✓';
  const sessionToken = 'tok_4af2c8b1_e7f0';
  const dispositivo = 'Chrome / macOS';

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

  const qrLarge = (
    <div className="w-14 h-14 bg-gray-800 rounded flex items-center justify-center mx-auto">
      <svg viewBox="0 0 20 20" width="48" height="48" fill="white">
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
    <div className="bg-gray-100 border border-gray-200 rounded px-1.5 py-1">
      <p className="text-[6px] font-semibold text-gray-500 uppercase tracking-wide">○ HASH ACEPTACIÓN SHA-256</p>
      <p className="text-[7px] font-mono text-gray-700 break-all leading-tight mt-0.5">{full ? hashFull : hashShort}</p>
    </div>
  );

  const acceptBox = (short = true) => (
    <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1 flex items-start gap-1">
      <div className="w-3 h-3 rounded border border-gray-400 flex items-center justify-center flex-shrink-0 mt-0.5">
        <CheckCircle size={8} className="text-gray-600" />
      </div>
      <p className="text-[7px] text-gray-700 leading-tight">
        {short
          ? `Aceptó expresamente · clic confirmado`
          : `Aceptó expresamente el documento mediante clic confirmado + OTP ✓`}
      </p>
    </div>
  );

  const urlLine = () => (
    <p className="text-[7px] text-blue-600 leading-tight">verify.docubox.mx/9d2e4f1a</p>
  );

  const avatarBlock = () => (
    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[7px] font-bold text-gray-600 flex-shrink-0">
      {nombre.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}
    </div>
  );

  if (variant.id === 'CC1') return (
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

  if (variant.id === 'CC2') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1">
          <div className="w-5 h-5 rounded-full border-2 border-gray-700 flex items-center justify-center flex-shrink-0">
            <CheckCircle size={10} className="text-gray-700" />
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
        {fieldRow('IP/GEOLOC', `${ip} · CDMX`)}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">{urlLine()}</div>
        {qrBlock}
      </div>
    </div>
  );

  if (variant.id === 'CC3') return (
    <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
      <div className="w-1.5 bg-gray-700 flex-shrink-0" />
      <div className="flex-1 p-2 flex flex-col gap-1.5">
        <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
        <p className="text-[7px] text-gray-500">{rfc}</p>
        {acceptBox(false)}
        {hashBlock()}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {fieldRow('IP/GEOLOC', `${ip} · CDMX ±80m`)}
          {fieldRow('FECHA', fecha)}
        </div>
        {urlLine()}
      </div>
    </div>
  );

  if (variant.id === 'CC4') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-1.5">
        <div className="w-6 h-6 rounded-full border-2 border-gray-700 flex items-center justify-center flex-shrink-0">
          <CheckCircle size={12} className="text-gray-700" />
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
        {fieldRow('OTP', otp)}
      </div>
      <div className="flex justify-center mt-1">{qrBlock}</div>
    </div>
  );

  if (variant.id === 'CC5') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
      <p className="text-[7px] text-gray-500 text-center">RFC: {rfc}</p>
      {acceptBox()}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('Clic + OTP ✓', fecha)}
        {fieldRow('IP', ip)}
      </div>
      {hashBlock()}
      {qrLarge}
    </div>
  );

  if (variant.id === 'CM1') return (
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
        {fieldRow('DISPOSITIVO', dispositivo)}
        {fieldRow('OTP CANAL', otp)}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">{urlLine()}</div>
        {qrBlock}
      </div>
    </div>
  );

  if (variant.id === 'CM2') return (
    <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
      <div className="w-1.5 bg-gray-700 flex-shrink-0" />
      <div className="flex-1 p-2 flex flex-col gap-1.5">
        <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
        <p className="text-[7px] text-gray-500">{rfc} · #1 de 3</p>
        {acceptBox(false)}
        {hashBlock()}
        <div className="grid grid-cols-3 gap-x-1 gap-y-1">
          {fieldRow('RFC', rfc)}
          {fieldRow('FECHA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', `CDMX ±80m`)}
          {fieldRow('DISPOSITIVO', 'Chrome/macOS')}
          {fieldRow('OTP', otp)}
        </div>
        {urlLine()}
      </div>
    </div>
  );

  if (variant.id === 'CM3') return (
    <div className="border border-gray-200 rounded-lg bg-white text-left flex flex-col w-full overflow-hidden">
      <div className="bg-gray-800 px-2 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <CheckCircle size={10} className="text-white" />
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
          {fieldRow('IP/GEOLOC', `${ip} · CDMX`)}
          {fieldRow('DISPOSITIVO', dispositivo)}
          {fieldRow('OTP', otp)}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    </div>
  );

  if (variant.id === 'CM4') return (
    <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
      <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
      <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
      <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
      <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
      <p className="text-[9px] font-bold text-gray-800 text-center">{nombre}</p>
      <p className="text-[7px] text-gray-500 text-center">RFC: {rfc} · Apoderado Legal</p>
      <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1">
        <p className="text-[7px] text-gray-700 leading-tight">
          Aceptó expresamente el documento mediante clic confirmado + OTP ✓ · {fecha}
        </p>
      </div>
      {hashBlock(true)}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FECHA/TZ', fecha)}
        {fieldRow('IP/GEOLOC', `${ip} · CDMX ±80m`)}
        {fieldRow('DISPOSITIVO', 'Chrome · macOS')}
        {fieldRow('OTP CANAL', otp)}
      </div>
      <div className="flex justify-center mt-1">{qrBlock}</div>
    </div>
  );

  if (variant.id === 'CM5') return (
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
        {fieldRow('GEOLOC', `CDMX ±80m`)}
      </div>
      {qrLarge}
    </div>
  );

  if (variant.id === 'CL1') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="flex items-start gap-1.5">
        {avatarBlock()}
        <div className="flex-1">
          <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
          <p className="text-[7px] text-gray-500">{rfc} · Firmante #1 de 2</p>
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
        {fieldRow('CURP', 'GAML880512HMCRCR08')}
        {fieldRow('ROL', 'Apoderado Legal')}
        {fieldRow('FECHA', '2025-03-25')}
        {fieldRow('HORA/TZ', '14:32:07 CST')}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', '19.43°N 99.13°W')}
        {fieldRow('PRECISIÓN GPS', '±80 metros')}
        {fieldRow('DISPOSITIVO', 'Chrome 123 · macOS')}
        {fieldRow('OTP CANAL', otp)}
        {fieldRow('SESSION TOKEN', sessionToken)}
        {fieldRow('ORDEN / TOTAL', '#1 de 2')}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">{urlLine()}</div>
        {qrBlock}
      </div>
    </div>
  );

  if (variant.id === 'CL2') return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FIRMANTE', nombre)}
        {fieldRow('RFC', rfc)}
        {fieldRow('CURP', 'GAML880512HMCRCR08')}
        {fieldRow('ROL', 'Apoderado Legal')}
        {fieldRow('NIVEL', 'Firma Electrónica Simple')}
        {fieldRow('ORDEN', 'Firmante #1 de 2')}
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1">
        <div className="flex items-start gap-1">
          <CheckCircle size={8} className="text-gray-600 flex-shrink-0 mt-0.5" />
          <p className="text-[7px] text-gray-700 leading-tight">
            <strong>Declaración:</strong> El firmante aceptó expresamente el contenido del documento mediante clic confirmado y código OTP de un solo uso.
          </p>
        </div>
      </div>
      {hashBlock(true)}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FECHA', '2025-03-25')}
        {fieldRow('HORA/TZ', '14:32:07 CST')}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', '19.43°N 99.13°W')}
        {fieldRow('DISPOSITIVO', 'Chrome 123 · macOS 14.3')}
        {fieldRow('OTP CANAL', otp)}
        {fieldRow('SESSION TOKEN', sessionToken)}
        {fieldRow('NIVEL FIRMA', 'Firma Electrónica Simple')}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">{urlLine()}</div>
        {qrBlock}
      </div>
    </div>
  );

  if (variant.id === 'CL3') return (
    <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
      <div className="w-1.5 bg-gray-700 flex-shrink-0" />
      <div className="flex-1 p-2 flex flex-col gap-1.5">
        <div className="flex items-start gap-1.5">
          {avatarBlock()}
          <div className="flex-1">
            <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">{rfc} · Firmante #1 de 2</p>
          </div>
          <span className="text-[6px] text-blue-600 font-semibold border border-blue-300 rounded px-1">OTP ✓</span>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1">
          <p className="text-[7px] text-gray-700 leading-tight">
            El firmante aceptó expresamente el documento mediante clic confirmado + OTP WhatsApp ✓ · {fecha}
          </p>
        </div>
        {hashBlock(true)}
        <div className="grid grid-cols-3 gap-x-1 gap-y-1">
          {fieldRow('RFC', rfc)}
          {fieldRow('CURP', 'GAML880512HMCRCR08')}
          {fieldRow('ROL', 'Apoderado Legal')}
          {fieldRow('FECHA', '2025-03-25')}
          {fieldRow('HORA/TZ', '14:32:07 CST')}
          {fieldRow('IP', ip)}
          {fieldRow('GEOLOC', '19.43°N 99.13°W')}
          {fieldRow('PRECISIÓN GPS', '±80 metros')}
          {fieldRow('DISPOSITIVO', 'Chrome 123 · macOS')}
          {fieldRow('OTP CANAL', otp)}
          {fieldRow('SESSION TOKEN', sessionToken)}
          {fieldRow('NIVEL FIRMA', 'Firma Electrónica Simple')}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">{urlLine()}</div>
          {qrBlock}
        </div>
      </div>
    </div>
  );

  if (variant.id === 'CL4') return (
    <div className="border-2 border-gray-300 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full relative">
      <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-gray-400" />
      <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-gray-400" />
      <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-gray-400" />
      <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-gray-400" />
      <div className="flex items-center gap-1.5 justify-center">
        {avatarBlock()}
        <div className="text-center">
          <p className="text-[9px] font-bold text-gray-800">{nombre}</p>
          <p className="text-[7px] text-gray-500">RFC: {rfc} · CURP: GAML880512HMCRCR08</p>
          <p className="text-[7px] text-gray-500">Apoderado Legal · Firmante #1 de 2</p>
        </div>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1">
        <p className="text-[7px] text-gray-700 leading-tight">
          El firmante aceptó expresamente el contenido del documento mediante clic confirmado y código OTP de un solo uso entregado vía WhatsApp. Nivel: Firma Electrónica Simple.
        </p>
      </div>
      {hashBlock(true)}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fieldRow('FECHA', '2025-03-25')}
        {fieldRow('HORA/TZ', '14:32:07 CST')}
        {fieldRow('TIMEZONE', 'CST (UTC-6)')}
        {fieldRow('IP', ip)}
        {fieldRow('GEOLOC', '19.43°N 99.13°W')}
        {fieldRow('PRECISIÓN GPS', '±80 metros')}
        {fieldRow('DISPOSITIVO', 'Chrome 123 · macOS 14.3')}
        {fieldRow('OTP CANAL', otp)}
        {fieldRow('NIVEL FIRMA', 'Firma Electrónica Simple')}
        {fieldRow('SESSION TOKEN', sessionToken)}
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
  CC1: { label: 'CC1 · Mínima', elements: ['Nombre del firmante', 'RFC y número de firmante', 'Caja de aceptación (accept-box)', 'Hash SHA-256 (corto)', 'Fecha y zona horaria', 'Dirección IP', 'URL de verificación'] },
  CC2: { label: 'CC2 · Check circular + QR', elements: ['Ícono check circular', 'Nombre del firmante', 'RFC y número de firmante', 'Badge OTP ✓', 'Declaración de aceptación extendida', 'Hash SHA-256 (corto)', 'Fecha y zona horaria', 'IP y geolocalización', 'URL de verificación', 'Código QR'] },
  CC3: { label: 'CC3 · Franja + Accept', elements: ['Barra lateral oscura', 'Nombre del firmante', 'RFC', 'Declaración de aceptación con fecha inline', 'Hash SHA-256 (corto)', 'IP y geolocalización', 'Fecha', 'URL de verificación'] },
  CC4: { label: 'CC4 · Centrada Check Grande', elements: ['Check circular grande', 'Nombre del firmante', 'RFC y número de firmante', 'Declaración de aceptación extendida', 'Hash SHA-256 (corto)', 'Fecha y zona horaria', 'Canal OTP', 'Código QR centrado'] },
  CC5: { label: 'CC5 · Ticket Vertical', elements: ['Nombre del firmante', 'RFC', 'Caja de aceptación (accept-box)', 'Clic + OTP confirmado', 'Dirección IP', 'Hash SHA-256 (corto)', 'Código QR grande'] },
  CM1: { label: 'CM1 · Estándar Mediana', elements: ['Avatar / iniciales', 'Nombre del firmante', 'RFC y número de firmante', 'Badge nivel de firma', 'Declaración de aceptación extendida', 'Hash SHA-256 (completo)', 'RFC', 'Fecha y zona horaria', 'Dirección IP', 'Geolocalización', 'Dispositivo y navegador', 'Canal OTP', 'URL de verificación', 'Código QR'] },
  CM2: { label: 'CM2 · Franja 3 Columnas', elements: ['Barra lateral oscura', 'Nombre del firmante', 'RFC y número de firmante', 'Declaración de aceptación extendida', 'Hash SHA-256 (corto)', 'RFC', 'Fecha', 'Dirección IP', 'Geolocalización', 'Dispositivo', 'Canal OTP', 'URL de verificación'] },
  CM3: { label: 'CM3 · Dark Header Mediana', elements: ['Encabezado oscuro con check', 'Nombre del firmante', 'RFC y número de firmante', 'Badge nivel de firma', 'Declaración de aceptación extendida', 'Hash SHA-256 (corto)', 'Fecha y zona horaria', 'IP y geolocalización', 'Dispositivo', 'Canal OTP', 'URL de verificación', 'Código QR'] },
  CM4: { label: 'CM4 · Notarial Mediana', elements: ['Esquinas decorativas notariales', 'Nombre del firmante', 'RFC y rol', 'Declaración de aceptación con fecha y OTP', 'Hash SHA-256 (completo)', 'Fecha y zona horaria', 'IP y geolocalización', 'Dispositivo', 'Canal OTP', 'Código QR'] },
  CM5: { label: 'CM5 · Ticket QR Grande', elements: ['Avatar / iniciales', 'Nombre del firmante', 'Número de firmante y nivel', 'Declaración de aceptación extendida', 'Hash SHA-256 (corto)', 'Dirección IP', 'Geolocalización', 'Código QR grande'] },
  CL1: { label: 'CL1 · Completa 3 columnas', elements: ['Avatar / iniciales', 'Nombre del firmante', 'RFC y número de firmante', 'Badge OTP ✓', 'Declaración extendida de aceptación', 'Hash SHA-256 (completo)', 'RFC', 'CURP', 'Rol del firmante', 'Fecha', 'Hora y zona horaria', 'Dirección IP', 'Geolocalización con coordenadas', 'Precisión GPS', 'Dispositivo y navegador', 'Canal OTP', 'Session token', 'Orden de firma', 'URL de verificación', 'Código QR'] },
  CL2: { label: 'CL2 · Constancia Estructurada', elements: ['Nombre del firmante', 'RFC', 'CURP', 'Rol del firmante', 'Nivel de firma', 'Orden de firma', 'Declaración extendida con check', 'Hash SHA-256 (completo)', 'Fecha', 'Hora y zona horaria', 'Dirección IP', 'Geolocalización', 'Dispositivo y navegador', 'Canal OTP', 'Session token', 'Nivel de firma explícito', 'URL de verificación', 'Código QR'] },
  CL3: { label: 'CL3 · Franja 3 col. Larga', elements: ['Barra lateral oscura', 'Avatar / iniciales', 'Nombre del firmante', 'RFC y número de firmante', 'Badge OTP ✓', 'Declaración de aceptación extendida', 'Hash SHA-256 (completo)', 'RFC', 'CURP', 'Rol del firmante', 'Fecha', 'Hora y zona horaria', 'Dirección IP', 'Geolocalización', 'Precisión GPS', 'Dispositivo', 'Canal OTP', 'Session token', 'Nivel de firma', 'URL de verificación', 'Código QR'] },
  CL4: { label: 'CL4 · Notarial Larga', elements: ['Esquinas decorativas notariales', 'Avatar / iniciales centrado', 'Nombre del firmante', 'RFC', 'CURP', 'Rol y número de firmante', 'Declaración extendida de aceptación', 'Hash SHA-256 (completo)', 'Fecha', 'Hora y zona horaria', 'Timezone', 'Dirección IP', 'Geolocalización con coordenadas', 'Precisión GPS', 'Dispositivo y navegador', 'Canal OTP', 'Nivel de firma', 'Session token', 'URL de verificación', 'Código QR'] },
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

export default function ClickSignStampSelector({
  userName,
  userRfc,
  currentStampStyle,
  onSave,
}: ClickSignStampSelectorProps) {
  const [selected, setSelected] = useState<string>(currentStampStyle || 'CC1');
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
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSelected(currentStampStyle || 'CC1');
    setSelectorOpen(false);
  };

  const categories: Array<'corta' | 'mediana' | 'larga'> = ['corta', 'mediana', 'larga'];
  const currentVariant = STAMP_VARIANTS.find(v => v.id === (currentStampStyle || 'CC1'));
  const currentCat = currentVariant ? CATEGORY_LABELS[currentVariant.category] : null;

  return (
    <>
      {/* ── Compact preview box ── */}
      <div className="flex flex-col gap-3">
        <div>
          <h4 className="text-sm font-700 text-foreground">Estampa de Firma · Click &amp; Sign</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Elige el diseño de estampa para tus firmas de tipo Click &amp; Sign.</p>
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
              onClick={() => { setSelected(currentStampStyle || 'CC1'); setSelectorOpen(true); }}
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
                <h3 className="text-sm font-700 text-foreground">Seleccionar Estampa · Click &amp; Sign</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Elige el diseño de estampa para tus documentos firmados con Click &amp; Sign.</p>
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
                                    <StampPreview variant={variant} userName={userName} userRfc={userRfc} />
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
