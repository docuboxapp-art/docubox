'use client';

import React, { useState } from 'react';
import { CheckCircle, Save, Loader2, ChevronDown, ChevronUp, X, Edit2, Info } from 'lucide-react';
import { DEFAULT_SIGNATURE_STAMP_STYLES } from '@/lib/signatures/stamp-sizing';
import { SignatureQrCode } from '@/components/signatures/SignatureQrCode';
import { getPublicAppUrl } from '@/lib/publicAppUrl';

const DEFAULT_STAMP_STYLE = DEFAULT_SIGNATURE_STAMP_STYLES.autografa;

// ─── Types ────────────────────────────────────────────────────────────────────

interface StampVariant {
  id: string;
  label: string;
  description: string;
  category: 'corta' | 'mediana' | 'larga';
}

interface AutografaStampSelectorProps {
  signatureUrl: string | null;
  userName: string | null;
  userRfc: string | null;
  currentStampStyle: string;
  onSave: (stampStyle: string) => Promise<void>;
  initiallyOpen?: boolean;
  showSummary?: boolean;
  onCancel?: () => void;
}

// ─── Stamp Definitions ────────────────────────────────────────────────────────

const STAMP_VARIANTS: StampVariant[] = [
  // Cortas
  {
    id: 'AC0',
    label: 'AC0 · Firma mínima sin nombre',
    description: 'Trazo, huella y participación sin nombre visible.',
    category: 'corta',
  },
  {
    id: 'AC1',
    label: 'AC1 · Firma mínima con nombre',
    description: 'Diseño minimalista de una sola columna.',
    category: 'corta',
  },
  {
    id: 'AC2',
    label: 'AC2 · Base compacta con QR',
    description: 'Diseño compacto horizontal con QR lateral.',
    category: 'corta',
  },
  {
    id: 'AC3',
    label: 'AC3 · Marco compacto',
    description: 'Marco compacto con composición centrada.',
    category: 'corta',
  },
  {
    id: 'AC4',
    label: 'AC4 · Franja lateral',
    description: 'Barra lateral con lectura vertical.',
    category: 'corta',
  },
  {
    id: 'AC5',
    label: 'AC5 · Ticket vertical',
    description: 'Formato vertical tipo ticket.',
    category: 'corta',
  },
  // Medianas
  {
    id: 'AM1',
    label: 'AM1 · Estándar mediana',
    description: 'Diseño estándar con encabezado de identidad.',
    category: 'mediana',
  },
  {
    id: 'AM2',
    label: 'AM2 · Marco mediano',
    description: 'Marco mediano de composición centrada.',
    category: 'mediana',
  },
  {
    id: 'AM3',
    label: 'AM3 · Franja 3 columnas',
    description: 'Barra lateral con distribución en tres columnas.',
    category: 'mediana',
  },
  {
    id: 'AM4',
    label: 'AM4 · Encabezado sobrio',
    description: 'Encabezado oscuro con cuerpo estructurado.',
    category: 'mediana',
  },
  {
    id: 'AM5',
    label: 'AM5 · Ticket QR grande',
    description: 'Formato vertical con QR protagonista.',
    category: 'mediana',
  },
  // Largas
  {
    id: 'AL1',
    label: 'AL1 · Estándar larga',
    description: 'Diseño horizontal amplio y equilibrado.',
    category: 'larga',
  },
  {
    id: 'AL2',
    label: 'AL2 · Marco formal',
    description: 'Marco institucional de composición formal.',
    category: 'larga',
  },
  {
    id: 'AL3',
    label: 'AL3 · Franja analítica',
    description: 'Barra lateral con distribución analítica.',
    category: 'larga',
  },
  {
    id: 'AL4',
    label: 'AL4 · Ficha estructurada',
    description: 'Formato de ficha documental estructurada.',
    category: 'larga',
  },
];

const CATEGORY_LABELS: Record<
  string,
  { label: string; range: string; color: string; bg: string; border: string }
> = {
  corta: {
    label: 'Corta',
    range: 'autógrafa · información mínima',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  mediana: {
    label: 'Mediana',
    range: 'autógrafa · información intermedia',
    color: 'text-violet-700',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
  },
  larga: {
    label: 'Larga',
    range: 'autógrafa · información completa visible',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
};

// ─── Stamp Preview ────────────────────────────────────────────────────────────

function StampPreview({
  variant,
  signatureUrl,
  userName,
}: {
  variant: StampVariant;
  signatureUrl: string | null;
  userName: string | null;
  userRfc: string | null;
}) {
  const nombre = userName || 'Luis García M.';
  const hashFull = '4af2c8b1d3e9f0a2c7b4e1d8f3a9c2b7e0d4f1a8c3b6e9f2a5c8b1d4e7f0a3';
  const fecha = '25/03/2025 · 14:32:08 · UTC-06:00';
  const method = 'Firma autógrafa';
  const authentication = 'OTP verificado';
  const participantRole = 'Proveedor';
  const participantAct = 'Firmante';
  const maskedRfc = 'GAML******AB1';
  const maskedCurp = 'GAML******R08';
  const nameParts = nombre.trim().split(/\s+/).filter(Boolean);
  const surnameIndex = nameParts.length >= 3 ? nameParts.length - 2 : nameParts.length - 1;
  const previewInitials = nameParts.length
    ? `${nameParts[0].charAt(0)}${nameParts[surnameIndex].charAt(0)}`.toUpperCase()
    : 'F';

  const signatureImg = signatureUrl ? (
    <img src={signatureUrl} alt="Firma autógrafa" className="max-h-10 max-w-full object-contain" />
  ) : (
    <svg viewBox="0 0 120 30" width="100%" height="30" className="opacity-60">
      <path
        d="M5,20 Q20,5 35,18 Q50,30 65,12 Q80,0 95,15 Q110,28 118,18"
        stroke="#374151"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );

  const qrBlock = <SignatureQrCode value={`${getPublicAppUrl()}/verificar-documento`} example />;

  const fieldRow = (label: string, value: string) => (
    <div key={label}>
      <p className="text-[7px] font-semibold text-gray-400 uppercase tracking-wide leading-none">
        {label}
      </p>
      <p className="text-[8px] text-gray-700 leading-tight mt-0.5">{value}</p>
    </div>
  );

  const sigBox = () => (
    <div className="flex min-h-[32px] items-center justify-center rounded border-[1.5px] border-blue-400 bg-blue-50/40 p-1 ring-1 ring-blue-100">
      {signatureImg}
    </div>
  );

  const shortHashBlock = (
    <div className="w-full rounded bg-blue-50 px-2 py-1.5">
      <p className="text-[7px] font-semibold text-blue-700">Huella SHA-256</p>
      <p className="mt-0.5 break-all font-mono text-[7px] leading-tight text-gray-700">
        {hashFull}
      </p>
    </div>
  );

  const identityBlock = (
    <div className="w-full min-w-0 text-left leading-tight">
      <p className="break-words text-[9px] font-bold text-gray-800">{nombre}</p>
      <p className="text-[7px] text-gray-600">Rol: {participantRole} · Acto: {participantAct}</p>
    </div>
  );

  const roleActBlock = (
    <p className="w-full text-left text-[7px] text-gray-600">
      Rol: {participantRole} · Acto: {participantAct}
    </p>
  );

  const statusPill = (value: string) => (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[7px] font-semibold text-blue-700">
      <CheckCircle size={8} />
      {value}
    </span>
  );

  // ── AC0 Firma mínima sin nombre ──
  if (variant.id === 'AC0')
    return (
      <div className="flex min-h-[190px] w-full flex-col items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left">
        <div className="w-full">{sigBox()}</div>
        {shortHashBlock}
        {roleActBlock}
      </div>
    );

  // ── AC1 Firma mínima con nombre ──
  if (variant.id === 'AC1')
    return (
      <div className="flex min-h-[190px] w-full flex-col items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left">
        <div className="w-full">{sigBox()}</div>
        {shortHashBlock}
        {identityBlock}
      </div>
    );

  // ── AC2 Base compacta con QR ──
  if (variant.id === 'AC2')
    return (
      <div className="flex min-h-[190px] w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        {sigBox()}
        {shortHashBlock}
        {identityBlock}
        <div className="flex items-end justify-between gap-2">
          <p className="flex-1 text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
          {qrBlock}
        </div>
      </div>
    );

  // ── AC3 Marco compacto ──
  if (variant.id === 'AC3')
    return (
      <div className="relative flex min-h-[190px] w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-blue-500" />
        <div className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-blue-500" />
        <div className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-blue-500" />
        <div className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-blue-500" />
        {sigBox()}
        <div className="flex items-end gap-2">
          <div className="flex-1">{shortHashBlock}</div>
          {qrBlock}
        </div>
        {identityBlock}
        <p className="text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
      </div>
    );

  // ── AC4 Franja lateral ──
  if (variant.id === 'AC4')
    return (
      <div className="flex min-h-[190px] w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
        <div className="w-2 flex-shrink-0 bg-blue-600" />
        <div className="flex flex-1 flex-col justify-between gap-2 p-2">
          {sigBox()}
          <div className="flex items-end gap-2">
            <div className="flex-1">{shortHashBlock}</div>
            {qrBlock}
          </div>
          {identityBlock}
          <div className="flex items-end justify-between gap-2">
            <p className="flex-1 text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
          </div>
        </div>
      </div>
    );

  // ── AC5 Ticket vertical ──
  if (variant.id === 'AC5')
    return (
      <div className="mx-auto flex min-h-[190px] w-3/5 flex-col items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        {sigBox()}
        {shortHashBlock}
        {identityBlock}
        <p className="text-center text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
        {qrBlock}
      </div>
    );

  // ── AM1 Estándar mediana ──
  if (variant.id === 'AM1')
    return (
      <div className="flex min-h-[230px] w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100">
            <span className="text-[9px] font-bold text-blue-700">{nombre.charAt(0)}</span>
          </div>
          <div>
            <p className="text-[8px] text-gray-600">Firma autógrafa</p>
          </div>
        </div>
        {sigBox()}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">{shortHashBlock}</div>
          {qrBlock}
        </div>
        {identityBlock}
        <p className="text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
      </div>
    );

  // ── AM2 Marco mediano ──
  if (variant.id === 'AM2')
    return (
      <div className="relative flex min-h-[230px] w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-blue-500" />
        <div className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-blue-500" />
        <div className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-blue-500" />
        <div className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-blue-500" />
        {sigBox()}
        {shortHashBlock}
        {identityBlock}
        <p className="text-center text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
        <div className="flex justify-center">{qrBlock}</div>
        <div className="flex justify-center">{statusPill('Autenticación verificada')}</div>
      </div>
    );

  // ── AM3 Franja 3 Columnas ──
  if (variant.id === 'AM3')
    return (
      <div className="flex min-h-[230px] w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
        <div className="w-2 flex-shrink-0 bg-blue-600" />
        <div className="flex flex-1 flex-col justify-between gap-2 p-2">
          <p className="text-[7px] text-gray-500">{method}</p>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{sigBox()}</div>
            {qrBlock}
          </div>
          {shortHashBlock}
          {identityBlock}
          <div className="grid grid-cols-3 items-end gap-x-1">
            {fieldRow('FECHA', fecha)}
            {fieldRow('AUTENTICACIÓN', authentication)}
            {fieldRow('MÉTODO', method)}
          </div>
        </div>
      </div>
    );

  // ── AM4 Encabezado sobrio ──
  if (variant.id === 'AM4')
    return (
      <div className="flex min-h-[230px] w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
        <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-1.5">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-400">
            <span className="text-[8px] font-bold text-white">{nombre.charAt(0)}</span>
          </div>
          <div>
            <p className="text-[9px] font-bold text-white">Firma autógrafa</p>
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-between gap-2 p-2">
          {sigBox()}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">{shortHashBlock}</div>
            {qrBlock}
          </div>
          {identityBlock}
          <p className="text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
        </div>
      </div>
    );

  // ── AM5 Ticket QR grande ──
  if (variant.id === 'AM5')
    return (
      <div className="mx-auto flex min-h-[230px] w-3/5 flex-col items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        {sigBox()}
        {shortHashBlock}
        {identityBlock}
        <p className="text-center text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
        {statusPill(method)}
        {statusPill(authentication)}
        {qrBlock}
      </div>
    );

  // ── AL1 Estándar larga ──
  if (variant.id === 'AL1')
    return (
      <div className="flex min-h-[230px] w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100">
            <span className="text-[9px] font-bold text-blue-700">{previewInitials}</span>
          </div>
          <div>
            <p className="text-[8px] text-gray-600">Firma autógrafa</p>
          </div>
          {sigBox()}
          {qrBlock}
        </div>
        {shortHashBlock}
        {identityBlock}
        <p className="text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
      </div>
    );

  // ── AL2 Marco formal ──
  if (variant.id === 'AL2')
    return (
      <div className="relative flex min-h-[230px] w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-blue-500" />
        <div className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-blue-500" />
        <div className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-blue-500" />
        <div className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-blue-500" />
        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          {sigBox()}
          {qrBlock}
        </div>
        {shortHashBlock}
        {identityBlock}
        <p className="text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
      </div>
    );

  // ── AL3 Franja analítica ──
  if (variant.id === 'AL3')
    return (
      <div className="flex min-h-[230px] w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
        <div className="w-2 flex-shrink-0 bg-blue-600" />
        <div className="flex flex-1 flex-col justify-between gap-2 p-2">
          <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <p className="text-[8px] text-gray-600">Firma autógrafa</p>
            {sigBox()}
            {qrBlock}
          </div>
          {shortHashBlock}
          {identityBlock}
          <p className="text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
        </div>
      </div>
    );

  // ── AL4 Ficha estructurada ──
  if (variant.id === 'AL4')
    return (
      <div className="flex min-h-[230px] w-full flex-col justify-between gap-2 overflow-hidden rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="grid grid-cols-3 border-b border-gray-200">
          <div className="border-r border-gray-200 p-1.5">
            <p className="text-[8px] text-gray-600">Firma autógrafa</p>
          </div>
          <div className="border-r border-gray-200 p-1.5">
            {fieldRow('RFC (OPCIONAL)', maskedRfc)}
          </div>
          <div className="p-1.5">{fieldRow('CURP (OPCIONAL)', maskedCurp)}</div>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <div>{sigBox()}</div>
          {qrBlock}
        </div>
        {shortHashBlock}
        {identityBlock}
        <p className="text-[7px] leading-tight text-gray-600">Firmado: {fecha}</p>
      </div>
    );

  return null;
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

const STAMP_ELEMENTS: Record<string, { label: string; elements: string[] }> = {
  AC0: {
    label: 'AC0 · Firma mínima sin nombre',
    elements: [
      'Trazo de firma autógrafa digitalizada',
      'Huella SHA-256 completa del documento firmado',
      'Rol y acto de participación, sin nombre visible',
    ],
  },
  AC1: {
    label: 'AC1 · Firma mínima con nombre',
    elements: [
      'Nombre del firmante',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Rol y acto de participación',
    ],
  },
  AC2: {
    label: 'AC2 · Base compacta con QR',
    elements: [
      'Nombre del firmante',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Código QR de verificación',
    ],
  },
  AC3: {
    label: 'AC3 · Marco compacto',
    elements: [
      'Esquinas de marco',
      'Nombre del firmante',
      'Trazo de firma autógrafa centrado',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Código QR de verificación',
    ],
  },
  AC4: {
    label: 'AC4 · Franja lateral',
    elements: [
      'Barra lateral azul',
      'Nombre del firmante',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Código QR de verificación',
    ],
  },
  AC5: {
    label: 'AC5 · Ticket vertical',
    elements: [
      'Nombre del firmante',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Código QR grande de verificación',
    ],
  },
  AM1: {
    label: 'AM1 · Estándar mediana',
    elements: [
      'Avatar / inicial del nombre',
      'Nombre del firmante',
      'Rol o capacidad',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Código QR de verificación',
    ],
  },
  AM2: {
    label: 'AM2 · Marco mediano',
    elements: [
      'Esquinas de marco',
      'Nombre del firmante',
      'Capacidad del firmante',
      'Trazo de firma autógrafa centrado',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Estado real de autenticación',
      'Código QR de verificación',
    ],
  },
  AM3: {
    label: 'AM3 · Franja 3 columnas',
    elements: [
      'Barra lateral azul',
      'Nombre del firmante',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Método de firma',
      'Estado real de autenticación',
      'Rol del participante',
      'Código QR de verificación',
    ],
  },
  AM4: {
    label: 'AM4 · Encabezado sobrio',
    elements: [
      'Encabezado oscuro con avatar',
      'Nombre del firmante',
      'Rol o capacidad',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Código QR de verificación',
    ],
  },
  AM5: {
    label: 'AM5 · Ticket QR grande',
    elements: [
      'Nombre del firmante',
      'Rol o capacidad',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Método de firma',
      'Estado real de autenticación',
      'Código QR grande de verificación',
    ],
  },
  AL1: {
    label: 'AL1 · Estándar larga',
    elements: [
      'Avatar / iniciales',
      'Nombre del firmante',
      'Rol del participante',
      'Acto realizado',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Código QR de verificación',
    ],
  },
  AL2: {
    label: 'AL2 · Marco formal',
    elements: [
      'Marco institucional',
      'Nombre del firmante',
      'Rol del participante',
      'Acto realizado',
      'Trazo de firma autógrafa centrado',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Código QR de verificación',
    ],
  },
  AL3: {
    label: 'AL3 · Franja analítica',
    elements: [
      'Barra lateral azul',
      'Nombre del firmante',
      'Rol del participante',
      'Acto realizado',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Código QR de verificación',
    ],
  },
  AL4: {
    label: 'AL4 · Ficha estructurada',
    elements: [
      'Nombre del firmante',
      'RFC enmascarado cuando esté disponible',
      'CURP enmascarada cuando esté disponible',
      'Rol del participante',
      'Acto realizado',
      'Trazo de firma autógrafa',
      'Huella SHA-256 completa',
      'Fecha, hora y zona horaria',
      'Código QR de verificación',
    ],
  },
};

function StampDetailModal({
  variant,
  signatureUrl,
  userName,
  userRfc,
  onClose,
}: {
  variant: StampVariant;
  signatureUrl: string | null;
  userName: string | null;
  userRfc: string | null;
  onClose: () => void;
}) {
  const detail = STAMP_ELEMENTS[variant.id];
  const catInfo = CATEGORY_LABELS[variant.category];
  if (!detail) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-600 text-foreground">{detail.label}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{variant.description}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors flex-shrink-0 ml-3"
          >
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
            <section>
              <p className="text-xs font-600 text-foreground mb-3">Vista ampliada</p>
              <div className="min-h-[320px] rounded-lg border border-border bg-gray-50 p-5 flex items-center">
                <div className="w-full [&>div]:border-0">
                  <StampPreview
                    variant={variant}
                    signatureUrl={signatureUrl}
                    userName={userName}
                    userRfc={userRfc}
                  />
                </div>
              </div>
            </section>
            <section>
              <p className="text-xs font-600 text-foreground mb-3">
                Elementos incluidos en esta estampa
              </p>
              <ul className="flex flex-col gap-2.5">
                {detail.elements.map((el, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div
                      className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${catInfo.color.replace('text-', 'bg-')}`}
                    />
                    <span className="text-xs text-foreground leading-snug">{el}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/10">
          <button
            onClick={onClose}
            className="ml-auto block px-4 py-2 text-sm font-600 text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted/30 transition-colors"
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
  initiallyOpen = false,
  showSummary = true,
  onCancel,
}: AutografaStampSelectorProps) {
  const [selected, setSelected] = useState(currentStampStyle || DEFAULT_STAMP_STYLE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(initiallyOpen);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(
    STAMP_VARIANTS.find((variant) => variant.id === (currentStampStyle || DEFAULT_STAMP_STYLE))
      ?.category || 'corta'
  );
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
    setSelected(currentStampStyle || DEFAULT_STAMP_STYLE);
    setSelectorOpen(false);
    onCancel?.();
  };

  const categories: Array<'corta' | 'mediana' | 'larga'> = ['corta', 'mediana', 'larga'];
  const currentVariant = STAMP_VARIANTS.find(
    (v) => v.id === (currentStampStyle || DEFAULT_STAMP_STYLE)
  );
  const currentCat = currentVariant ? CATEGORY_LABELS[currentVariant.category] : null;

  return (
    <>
      {/* ── Compact preview box ── */}
      <div className="flex flex-col gap-3">
        {showSummary && (
          <>
            <div>
              <h4 className="text-sm font-600 text-foreground">Estampa de Firma Autógrafa</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Elige el estilo de estampa que se imprimirá en los documentos firmados con tu firma
                autógrafa digitalizada.
              </p>
            </div>

            <div className="flex items-center gap-3 p-3 border border-border rounded-xl bg-muted/20">
              {/* Info */}
              <div className="flex-1 min-w-0">
                {currentVariant && currentCat ? (
                  <>
                    <p className="text-xs font-600 text-foreground leading-tight">
                      {currentVariant.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {currentVariant.description}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin estampa seleccionada</p>
                )}
              </div>
              {/* Change button */}
              {!selectorOpen && (
                <button
                  onClick={() => {
                    setSelected(currentStampStyle || DEFAULT_STAMP_STYLE);
                    setSelectorOpen(true);
                  }}
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
          </>
        )}

        {/* ── Inline selector panel ── */}
        {selectorOpen && (
          <div className="border border-border rounded-xl overflow-hidden bg-white">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
              <div>
                <h3 className="text-sm font-600 text-foreground">
                  Seleccionar Estampa · Firma Autógrafa
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Elige el diseño de estampa para tus documentos firmados con firma autógrafa.
                </p>
              </div>
              <button
                onClick={handleCancel}
                className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>

            {/* Panel body */}
            <div className="p-4 flex flex-col gap-4">
              {/* Selected info */}
              {(() => {
                const current = STAMP_VARIANTS.find((v) => v.id === selected);
                const cat = current ? CATEGORY_LABELS[current.category] : null;
                if (!current || !cat) return null;
                return (
                  <div
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${cat.bg} ${cat.border}`}
                  >
                    <CheckCircle size={13} className={cat.color} />
                    <p className={`text-xs font-600 ${cat.color}`}>
                      Seleccionada: <span className="font-600">{current.label}</span> —{' '}
                      {current.description}
                    </p>
                  </div>
                );
              })()}

              {/* Category sections */}
              {categories.map((cat) => {
                const catInfo = CATEGORY_LABELS[cat];
                const variants = STAMP_VARIANTS.filter((v) => v.category === cat);
                const isOpen = expandedCategory === cat;
                const hasSelected = variants.some((v) => v.id === selected);

                return (
                  <div key={cat} className="border border-border rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedCategory(isOpen ? null : cat)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`text-xs font-600 uppercase tracking-wider ${catInfo.color}`}
                        >
                          {catInfo.label.toUpperCase()}S
                        </span>
                        <span className="text-xs text-muted-foreground">— {catInfo.range}</span>
                        {hasSelected && (
                          <span
                            className={`text-[10px] font-600 px-2 py-0.5 rounded-full ${catInfo.bg} ${catInfo.color} border ${catInfo.border}`}
                          >
                            ✓ Activa
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-600 px-2 py-0.5 rounded-full ${catInfo.bg} ${catInfo.color} border ${catInfo.border}`}
                        >
                          {catInfo.label}
                        </span>
                        {isOpen ? (
                          <ChevronUp size={14} className="text-muted-foreground" />
                        ) : (
                          <ChevronDown size={14} className="text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="p-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
                        {variants.map((variant) => {
                          const isSelected = selected === variant.id;
                          return (
                            <div
                              key={variant.id}
                              className={`relative flex flex-col gap-2 p-2.5 rounded-xl border-2 text-left transition-all hover:shadow-md ${
                                isSelected
                                  ? 'border-primary bg-primary/5 shadow-sm'
                                  : 'border-border bg-white hover:border-primary/40'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelected(variant.id)}
                                aria-label={`Seleccionar ${variant.label}`}
                                className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                              />
                              {isSelected && (
                                <div className="pointer-events-none absolute top-2 right-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                                  <CheckCircle size={12} className="text-white" />
                                </div>
                              )}
                              <div
                                className="relative z-10 pointer-events-none w-full overflow-hidden rounded-lg border border-border bg-gray-50"
                                style={{ height: '180px' }}
                              >
                                <div
                                  style={{
                                    transform: 'scale(0.72)',
                                    transformOrigin: 'top left',
                                    width: '138.9%',
                                    pointerEvents: 'none',
                                  }}
                                >
                                  <div className="p-1.5 [&>div]:border-0">
                                    <StampPreview
                                      variant={variant}
                                      signatureUrl={signatureUrl}
                                      userName={userName}
                                      userRfc={userRfc}
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="relative z-10 pointer-events-none flex flex-col gap-0.5">
                                <p
                                  className={`text-xs font-600 leading-tight ${isSelected ? 'text-primary' : 'text-foreground'}`}
                                >
                                  {variant.label}
                                </p>
                                <p className="text-[10px] text-muted-foreground leading-snug">
                                  {variant.description}
                                </p>
                              </div>
                              {/* Ver detalle button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailVariant(variant);
                                }}
                                className="relative z-20 flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-white hover:bg-muted/30 text-[10px] font-600 text-muted-foreground hover:text-foreground transition-colors w-fit"
                              >
                                <Info size={10} />
                                Ver detalle
                              </button>
                            </div>
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
        <StampDetailModal
          variant={detailVariant}
          signatureUrl={signatureUrl}
          userName={userName}
          userRfc={userRfc}
          onClose={() => setDetailVariant(null)}
        />
      )}
    </>
  );
}
