'use client';

import React, { useState } from 'react';
import { CheckCircle, Save, Loader2, ChevronDown, ChevronUp, X, Edit2, Info } from 'lucide-react';
import { DEFAULT_SIGNATURE_STAMP_STYLES } from '@/lib/signatures/stamp-sizing';
import { SignatureQrCode } from '@/components/signatures/SignatureQrCode';
import { getPublicAppUrl } from '@/lib/publicAppUrl';

const DEFAULT_STAMP_STYLE = DEFAULT_SIGNATURE_STAMP_STYLES.clicksign;

// ─── Types ────────────────────────────────────────────────────────────────────

interface StampVariant {
  id: string;
  label: string;
  description: string;
  category: 'corta' | 'mediana' | 'larga';
}

interface ClickSignStampSelectorProps {
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
    id: 'CC1',
    label: 'CC1 · Mínima',
    description: 'Diseño mínimo de lectura horizontal.',
    category: 'corta',
  },
  {
    id: 'CC2',
    label: 'CC2 · Check + QR',
    description: 'Verificación compacta con QR lateral.',
    category: 'corta',
  },
  {
    id: 'CC3',
    label: 'CC3 · Franja lateral',
    description: 'Lectura compacta con barra lateral sutil.',
    category: 'corta',
  },
  {
    id: 'CC4',
    label: 'CC4 · Centrada + QR',
    description: 'Composición centrada con QR al pie.',
    category: 'corta',
  },
  {
    id: 'CC5',
    label: 'CC5 · Ticket vertical',
    description: 'Formato vertical tipo ticket.',
    category: 'corta',
  },
  // Medianas
  {
    id: 'CM1',
    label: 'CM1 · Estándar mediana',
    description: 'Diseño equilibrado con la información esencial.',
    category: 'mediana',
  },
  {
    id: 'CM2',
    label: 'CM2 · Franja 3 columnas',
    description: 'Distribución en tres columnas con franja lateral.',
    category: 'mediana',
  },
  {
    id: 'CM3',
    label: 'CM3 · Encabezado sobrio',
    description: 'Encabezado destacado con cuerpo estructurado.',
    category: 'mediana',
  },
  {
    id: 'CM4',
    label: 'CM4 · Marco centrado',
    description: 'Composición centrada y limpia.',
    category: 'mediana',
  },
  {
    id: 'CM5',
    label: 'CM5 · Ticket QR grande',
    description: 'Formato vertical con QR protagonista.',
    category: 'mediana',
  },
  // Largas
  {
    id: 'CL1',
    label: 'CL1 · Resumen integral',
    description: 'Formato amplio y equilibrado con la información principal.',
    category: 'larga',
  },
  {
    id: 'CL2',
    label: 'CL2 · Constancia estructurada',
    description: 'Ficha documental de constancia estructurada.',
    category: 'larga',
  },
  {
    id: 'CL3',
    label: 'CL3 · Franja analítica',
    description: 'Barra lateral con distribución analítica de la información.',
    category: 'larga',
  },
  {
    id: 'CL4',
    label: 'CL4 · Marco formal',
    description: 'Diseño amplio y ordenado de composición formal.',
    category: 'larga',
  },
];

const CATEGORY_LABELS: Record<
  string,
  { label: string; range: string; color: string; bg: string; border: string }
> = {
  corta: {
    label: 'Corta',
    range: 'click & sign · información mínima',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  mediana: {
    label: 'Mediana',
    range: 'click & sign · información intermedia',
    color: 'text-violet-700',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
  },
  larga: {
    label: 'Larga',
    range: 'click & sign · información completa visible',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
};

// ─── Stamp Preview ────────────────────────────────────────────────────────────

function StampPreview({
  variant,
  userName,
  userRfc,
}: {
  variant: StampVariant;
  userName: string | null;
  userRfc: string | null;
}) {
  const nombre = userName || 'Luis García M.';
  const rfc = userRfc || 'GAML880512AB1';
  const hashFull = '9d2e4f1a8c3b6e0f5b8e1c4f7a0d3e6b9f2c5a8d1e4b7f0c3a6d9e2f5b8';
  const fecha = '25/03/2025 14:32:16 CST';
  const ip = '189.203.12.45';
  const location = 'Ciudad de México, CDMX, México';
  const device = 'Chrome 137 · macOS 14.3';
  const channel = 'WhatsApp';
  const role = 'Proveedor';
  const act = 'Firmante';

  const qrBlock = <SignatureQrCode value={`${getPublicAppUrl()}/verificar-documento`} example />;

  const qrLarge = (
    <SignatureQrCode
      value={`${getPublicAppUrl()}/verificar-documento`}
      example
      className="mx-auto h-16 w-16"
    />
  );

  const fieldRow = (label: string, value: string) => (
    <div key={label}>
      <p className="text-[7px] font-semibold text-gray-400 uppercase tracking-wide leading-none">
        {label}
      </p>
      <p className="text-[8px] text-gray-700 leading-tight mt-0.5">{value}</p>
    </div>
  );

  const shortHashBlock = (
    <div className="rounded bg-blue-50 px-2 py-1.5">
      <p className="text-[7px] font-semibold text-blue-700 uppercase">HUELLA SHA-256</p>
      <p className="mt-0.5 break-all font-mono text-[7px] leading-tight text-gray-700">
        {hashFull}
      </p>
    </div>
  );

  const acceptancePill = (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[7px] font-semibold text-blue-700">
      <CheckCircle size={8} />
      Aceptación confirmada
    </span>
  );

  const avatarBlock = () => (
    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[7px] font-bold text-gray-600 flex-shrink-0">
      {nombre
        .split(' ')
        .map((w: string) => w[0])
        .slice(0, 2)
        .join('')}
    </div>
  );

  if (variant.id === 'CC1')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] flex-col justify-between gap-2 w-full">
        <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
        <p className="text-[7px] text-gray-500">
          Rol: {role} · Acto: {act}
        </p>
        {shortHashBlock}
        {fieldRow('FECHA Y HORA', fecha)}
      </div>
    );

  if (variant.id === 'CC2')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] flex-col justify-between gap-2 w-full">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">
              Rol: {role} · Acto: {act}
            </p>
          </div>
          {acceptancePill}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">{shortHashBlock}</div>
          {qrBlock}
        </div>
        {fieldRow('FECHA Y HORA', fecha)}
      </div>
    );

  if (variant.id === 'CC3')
    return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex min-h-[190px] w-full overflow-hidden">
        <div className="w-2 bg-blue-600 flex-shrink-0" />
        <div className="flex flex-1 flex-col justify-between gap-2 p-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
              <p className="text-[7px] text-gray-500">
                Rol: {role} · Acto: {act}
              </p>
            </div>
            {acceptancePill}
          </div>
          {shortHashBlock}
          {fieldRow('FECHA Y HORA', fecha)}
        </div>
      </div>
    );

  if (variant.id === 'CC4')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] flex-col items-center justify-between gap-2 w-full">
        {acceptancePill}
        <div className="text-center">
          <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
          <p className="text-[7px] text-gray-500">
            Rol: {role} · Acto: {act}
          </p>
        </div>
        <div className="w-full text-center">{shortHashBlock}</div>
        {fieldRow('FECHA Y HORA', fecha)}
        {qrBlock}
      </div>
    );

  if (variant.id === 'CC5')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] w-3/5 mx-auto flex-col items-center justify-between gap-2">
        {acceptancePill}
        <div className="text-center">
          <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
          <p className="text-[7px] text-gray-500">Rol: {role}</p>
          <p className="text-[7px] text-gray-500">Acto: {act}</p>
        </div>
        <div className="w-full">{shortHashBlock}</div>
        {fieldRow('FECHA Y HORA', fecha)}
        {qrBlock}
      </div>
    );

  if (variant.id === 'CM1')
    return (
      <div className="flex min-h-[190px] w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">
              Rol: {role} · Acto: {act}
            </p>
          </div>
          {acceptancePill}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">{shortHashBlock}</div>
          {qrBlock}
        </div>
        {fieldRow('FECHA Y HORA', fecha)}
      </div>
    );

  if (variant.id === 'CM2')
    return (
      <div className="flex min-h-[190px] w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
        <div className="w-2 flex-shrink-0 bg-blue-600" />
        <div className="flex flex-1 flex-col justify-between gap-2 p-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
            {acceptancePill}
          </div>
          <div className="grid grid-cols-3 gap-x-2">
            {fieldRow('ROL', role)}
            {fieldRow('ACTO', act)}
            {fieldRow('FECHA Y HORA', fecha)}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">{shortHashBlock}</div>
            {qrBlock}
          </div>
        </div>
      </div>
    );

  if (variant.id === 'CM3')
    return (
      <div className="flex min-h-[190px] w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
        <div className="flex items-center justify-between gap-2 bg-slate-800 px-2 py-2">
          <p className="text-[9px] font-bold leading-tight text-white">{nombre}</p>
          {acceptancePill}
        </div>
        <div className="flex flex-1 flex-col justify-between gap-2 p-2">
          <p className="text-[7px] text-gray-500">
            Rol: {role} · Acto: {act}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1">{shortHashBlock}</div>
            {qrBlock}
          </div>
          {fieldRow('FECHA Y HORA', fecha)}
        </div>
      </div>
    );

  if (variant.id === 'CM4')
    return (
      <div className="relative flex min-h-[190px] w-full flex-col items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-blue-500" />
        <div className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-blue-500" />
        <div className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-blue-500" />
        <div className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-blue-500" />
        {acceptancePill}
        <div className="text-center">
          <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
          <p className="text-[7px] text-gray-500">
            Rol: {role} · Acto: {act}
          </p>
        </div>
        <div className="w-full">{shortHashBlock}</div>
        {fieldRow('FECHA Y HORA', fecha)}
        {qrBlock}
      </div>
    );

  if (variant.id === 'CM5')
    return (
      <div className="mx-auto flex min-h-[190px] w-3/5 flex-col items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        {acceptancePill}
        <div className="text-center">
          <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
          <p className="text-[7px] text-gray-500">Rol: {role}</p>
          <p className="text-[7px] text-gray-500">Acto: {act}</p>
        </div>
        <div className="w-full">{shortHashBlock}</div>
        {fieldRow('FECHA Y HORA', fecha)}
        {qrLarge}
      </div>
    );

  if (variant.id === 'CL1')
    return (
      <div className="flex min-h-[190px] w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="flex items-start gap-2">
          {avatarBlock()}
          <div className="flex-1">
            <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">
              RFC: {rfc} · Rol: {role} · Acto: {act}
            </p>
          </div>
          {acceptancePill}
        </div>
        {shortHashBlock}
        <div className="grid grid-cols-[1.1fr_0.8fr_1.4fr_auto] items-end gap-x-2 border-t border-gray-200 pt-2">
          {fieldRow('FECHA Y HORA', fecha)}
          {fieldRow('IP', ip)}
          {fieldRow('UBICACIÓN', location)}
          {qrBlock}
        </div>
      </div>
    );

  if (variant.id === 'CL2')
    return (
      <div className="flex min-h-[190px] w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">
              RFC: {rfc} · Rol: {role} · Acto: {act}
            </p>
          </div>
          {acceptancePill}
        </div>
        {shortHashBlock}
        <div className="grid grid-cols-2 gap-x-4 border-t border-gray-200 pt-2">
          <div className="flex flex-col gap-1.5 border-r border-gray-200 pr-3">
            {fieldRow('FECHA Y HORA', fecha)}
            {fieldRow('IP', ip)}
            {fieldRow('DISPOSITIVO', device)}
          </div>
          <div className="flex flex-col gap-1.5">
            {fieldRow('CANAL / MÉTODO', channel)}
            {fieldRow('UBICACIÓN', location)}
            {fieldRow('ACEPTACIÓN', 'Documento aceptado electrónicamente')}
          </div>
        </div>
      </div>
    );

  if (variant.id === 'CL3')
    return (
      <div className="flex min-h-[190px] w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
        <div className="w-2 flex-shrink-0 bg-blue-600" />
        <div className="flex flex-1 flex-col justify-between gap-2 p-2">
          <div className="flex items-start gap-2">
            {avatarBlock()}
            <div className="flex-1">
              <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
              <p className="text-[7px] text-gray-500">
                RFC: {rfc} · Rol: {role} · Acto: {act}
              </p>
            </div>
            {acceptancePill}
          </div>
          {shortHashBlock}
          <div className="grid grid-cols-[1fr_1.2fr_1fr_auto] items-end gap-x-2 border-t border-gray-200 pt-2">
            <div className="flex flex-col gap-1.5">
              {fieldRow('FECHA Y HORA', fecha)}
              {fieldRow('IP', ip)}
            </div>
            {fieldRow('UBICACIÓN', location)}
            <div className="flex flex-col gap-1.5">
              {fieldRow('DISPOSITIVO', device)}
              {fieldRow('CANAL / MÉTODO', channel)}
            </div>
            {qrBlock}
          </div>
        </div>
      </div>
    );

  if (variant.id === 'CL4')
    return (
      <div className="relative flex min-h-[190px] w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
        <div className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-blue-500" />
        <div className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-blue-500" />
        <div className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-blue-500" />
        <div className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-blue-500" />
        <div className="flex items-start gap-2 px-1">
          {avatarBlock()}
          <div className="flex-1">
            <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">
              RFC: {rfc} · Rol: {role} · Acto: {act}
            </p>
          </div>
        </div>
        {shortHashBlock}
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-x-2 border-t border-gray-200 pt-2">
          {fieldRow('FECHA Y HORA', fecha)}
          {fieldRow('DISPOSITIVO', device)}
          {fieldRow('CANAL / MÉTODO', channel)}
          {qrBlock}
        </div>
      </div>
    );

  return null;
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

const STAMP_ELEMENTS: Record<string, { label: string; elements: string[] }> = {
  CC1: {
    label: 'CC1 · Mínima',
    elements: [
      'Diseño horizontal mínimo',
      'Nombre del firmante',
      'Rol',
      'Acto',
      'Huella SHA-256 completa',
      'Fecha y hora',
    ],
  },
  CC2: {
    label: 'CC2 · Check + QR',
    elements: [
      'Nombre del firmante',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Código QR lateral',
    ],
  },
  CC3: {
    label: 'CC3 · Franja lateral',
    elements: [
      'Barra lateral azul',
      'Nombre del firmante',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
    ],
  },
  CC4: {
    label: 'CC4 · Centrada + QR',
    elements: [
      'Composición centrada',
      'Nombre del firmante',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Código QR al pie',
    ],
  },
  CC5: {
    label: 'CC5 · Ticket vertical',
    elements: [
      'Formato vertical tipo ticket',
      'Nombre del firmante',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Código QR al pie',
    ],
  },
  CM1: {
    label: 'CM1 · Estándar mediana',
    elements: [
      'Diseño equilibrado',
      'Nombre del firmante',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Código QR lateral',
    ],
  },
  CM2: {
    label: 'CM2 · Franja 3 columnas',
    elements: [
      'Barra lateral azul',
      'Distribución en tres columnas',
      'Nombre del firmante',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Código QR lateral',
    ],
  },
  CM3: {
    label: 'CM3 · Encabezado sobrio',
    elements: [
      'Encabezado oscuro',
      'Nombre del firmante',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Código QR lateral',
    ],
  },
  CM4: {
    label: 'CM4 · Marco centrado',
    elements: [
      'Composición centrada',
      'Marcas de esquina',
      'Nombre del firmante',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Código QR al pie',
    ],
  },
  CM5: {
    label: 'CM5 · Ticket QR grande',
    elements: [
      'Formato vertical tipo ticket',
      'Nombre del firmante',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Código QR grande',
    ],
  },
  CL1: {
    label: 'CL1 · Resumen integral',
    elements: [
      'Avatar / iniciales',
      'Nombre del firmante',
      'RFC',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Dirección IP',
      'Ubicación',
      'Código QR',
    ],
  },
  CL2: {
    label: 'CL2 · Constancia estructurada',
    elements: [
      'Nombre del firmante',
      'RFC',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Dirección IP',
      'Dispositivo y navegador',
      'Canal o método',
      'Ubicación',
      'Confirmación de aceptación',
    ],
  },
  CL3: {
    label: 'CL3 · Franja analítica',
    elements: [
      'Barra lateral azul',
      'Avatar / iniciales',
      'Nombre del firmante',
      'RFC',
      'Rol',
      'Acto',
      'Aceptación confirmada',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Dirección IP',
      'Ubicación',
      'Dispositivo y navegador',
      'Canal o método',
      'Código QR',
    ],
  },
  CL4: {
    label: 'CL4 · Marco formal',
    elements: [
      'Marco con marcas de esquina',
      'Avatar / iniciales',
      'Nombre del firmante',
      'RFC',
      'Rol',
      'Acto',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Dispositivo y navegador',
      'Canal o método',
      'Código QR',
    ],
  },
};

function StampDetailModal({
  variant,
  userName,
  userRfc,
  onClose,
}: {
  variant: StampVariant;
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
        <div className="overflow-y-auto flex-1 p-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
            <section>
              <p className="text-xs font-600 text-foreground mb-3">Vista ampliada</p>
              <div className="min-h-[320px] rounded-lg border border-border bg-gray-50 p-5 flex items-center">
                <div className="w-full">
                  <StampPreview variant={variant} userName={userName} userRfc={userRfc} />
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

export default function ClickSignStampSelector({
  userName,
  userRfc,
  currentStampStyle,
  onSave,
  initiallyOpen = false,
  showSummary = true,
  onCancel,
}: ClickSignStampSelectorProps) {
  const [selected, setSelected] = useState<string>(currentStampStyle || DEFAULT_STAMP_STYLE);
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
    } catch {
      /* silent */
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
              <h4 className="text-sm font-600 text-foreground">
                Estampa de Firma · Click &amp; Sign
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Elige el diseño de estampa para tus firmas de tipo Click &amp; Sign.
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
                  Seleccionar Estampa · Click &amp; Sign
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Elige el diseño de estampa para tus documentos firmados con Click &amp; Sign.
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
                      <div
                        className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 ${cat === 'larga' ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}
                      >
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
                                  <div className="p-1.5">
                                    <StampPreview
                                      variant={variant}
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
          userName={userName}
          userRfc={userRfc}
          onClose={() => setDetailVariant(null)}
        />
      )}
    </>
  );
}
