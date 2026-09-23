'use client';

import React, { useState } from 'react';
import {
  CheckCircle,
  Save,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
  Edit2,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { DEFAULT_SIGNATURE_STAMP_STYLES } from '@/lib/signatures/stamp-sizing';
import { SignatureQrCode } from '@/components/signatures/SignatureQrCode';
import { getPublicAppUrl } from '@/lib/publicAppUrl';

const DEFAULT_STAMP_STYLE = DEFAULT_SIGNATURE_STAMP_STYLES.efirma;

// ─── Types ────────────────────────────────────────────────────────────────────

interface StampVariant {
  id: string;
  label: string;
  description: string;
  category: 'corta' | 'mediana' | 'larga';
}

interface EfirmaStampSelectorProps {
  efirmaData: {
    rfc: string | null;
    nombre: string | null;
    numeroSerie?: string | null;
    vigenciaFin: string | null;
  };
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
    id: 'EC1',
    label: 'EC1 · Mínima e.firma',
    description: 'Diseño mínimo de lectura horizontal.',
    category: 'corta',
  },
  {
    id: 'EC2',
    label: 'EC2 · Check + QR',
    description: 'Verificación compacta con QR lateral.',
    category: 'corta',
  },
  {
    id: 'EC3',
    label: 'EC3 · Franja lateral',
    description: 'Lectura compacta con barra lateral sutil.',
    category: 'corta',
  },
  {
    id: 'EC4',
    label: 'EC4 · Centrada + QR',
    description: 'Composición centrada con QR al pie.',
    category: 'corta',
  },
  {
    id: 'EC5',
    label: 'EC5 · Hash + QR lateral',
    description: 'Diseño ultracompacto con QR lateral.',
    category: 'corta',
  },
  // Medianas
  {
    id: 'EM1',
    label: 'EM1 · Estándar certificado',
    description: 'Diseño horizontal equilibrado con información principal.',
    category: 'mediana',
  },
  {
    id: 'EM2',
    label: 'EM2 · Base compacta',
    description: 'Diseño compacto y centrado.',
    category: 'mediana',
  },
  {
    id: 'EM3',
    label: 'EM3 · Franja lateral',
    description: 'Barra lateral sutil con distribución en tres columnas.',
    category: 'mediana',
  },
  {
    id: 'EM4',
    label: 'EM4 · Encabezado sobrio',
    description: 'Encabezado de contraste con cuerpo estructurado.',
    category: 'mediana',
  },
  {
    id: 'EM5',
    label: 'EM5 · Ticket de validación',
    description: 'Formato vertical tipo ticket con evidencia esencial.',
    category: 'mediana',
  },
  // Largas
  {
    id: 'EL1',
    label: 'EL1 · Resumen integral',
    description: 'Formato amplio con lectura integral.',
    category: 'larga',
  },
  {
    id: 'EL2',
    label: 'EL2 · Constancia de certificado',
    description: 'Diseño estructurado con evidencia esencial.',
    category: 'larga',
  },
  {
    id: 'EL3',
    label: 'EL3 · Franja analítica',
    description: 'Diseño limpio con franja lateral de acento.',
    category: 'larga',
  },
  {
    id: 'EL4',
    label: 'EL4 · Formato formal',
    description: 'Diseño simétrico y ordenado.',
    category: 'larga',
  },
];

const CATEGORY_LABELS: Record<
  string,
  { label: string; range: string; color: string; bg: string; border: string }
> = {
  corta: {
    label: 'Corta',
    range: 'e.firma · información mínima',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  mediana: {
    label: 'Mediana',
    range: 'e.firma · información intermedia',
    color: 'text-violet-700',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
  },
  larga: {
    label: 'Larga',
    range: 'e.firma · evidencia completa visible',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
};

// ─── Stamp Preview ────────────────────────────────────────────────────────────

function StampPreview({
  variant,
  efirmaData,
}: {
  variant: StampVariant;
  efirmaData: EfirmaStampSelectorProps['efirmaData'];
}) {
  const nombre = efirmaData.nombre || 'Luis García Martínez';
  const rfc = efirmaData.rfc || 'GAML880512AB1';
  const numeroSerie = efirmaData.numeroSerie || '00001000000704149680';
  const vigencia = efirmaData.vigenciaFin || '2026-04-01';
  const hashFull = '4af2c8b1d3e9f0a2c7b4e1d8f3a9c2b7e0d4f1a8c3b6e9f2a5c8b1d4e7f0a3';
  const hashShort = `${hashFull.slice(0, 12)}...${hashFull.slice(-8)}`;
  const fecha = '25/03/2025 14:32:16 CST';
  const role = 'Proveedor';
  const act = 'Firmante';
  const qrBlock = <SignatureQrCode value={`${getPublicAppUrl()}/verificar-documento`} example />;

  const fieldRow = (label: string, value: string) => (
    <div key={label}>
      <p className="text-[7px] font-semibold text-gray-400 uppercase tracking-wide leading-none">
        {label}
      </p>
      <p className="text-[8px] text-gray-700 leading-tight mt-0.5">{value}</p>
    </div>
  );

  const evidenceHashBlock = (
    <div className="rounded bg-blue-50 px-2 py-1.5">
      <p className="text-[7px] font-semibold text-blue-700 uppercase">HUELLA SHA-256</p>
      <p className="mt-0.5 break-all font-mono text-[7px] leading-tight text-gray-700">
        {hashFull}
      </p>
    </div>
  );

  const validationPill = (label = 'Certificado vigente') => (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[7px] font-semibold text-emerald-700">
      <CheckCircle size={8} />
      {label}
    </span>
  );

  const shieldBlock = <ShieldCheck size={14} className="flex-shrink-0 text-blue-500" />;

  const qrVerificationBlock = (
    <div className="flex flex-col items-center gap-0.5">
      {qrBlock}
      <span className="text-[6px] text-blue-600">Verificar</span>
    </div>
  );

  if (variant.id === 'EC1')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] flex-col justify-between gap-2 w-full">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
          </div>
          {shieldBlock}
        </div>
        <div className="grid grid-cols-2 gap-2 rounded bg-slate-50 px-2 py-1.5">
          {fieldRow('HUELLA SHA-256', hashShort)}
          {fieldRow('FECHA Y HORA', fecha)}
        </div>
        <p className="text-[7px] text-gray-500">Firmado con e.firma</p>
      </div>
    );

  if (variant.id === 'EC2')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] flex-col justify-between gap-2 w-full">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
          </div>
          {shieldBlock}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            {validationPill('Certificado válido')}
            {fieldRow('HUELLA SHA-256', hashShort)}
            {fieldRow('FECHA Y HORA', fecha)}
          </div>
          {qrVerificationBlock}
        </div>
        <p className="text-[7px] text-gray-500">Firmado con e.firma</p>
      </div>
    );

  if (variant.id === 'EC3')
    return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex min-h-[190px] w-full overflow-hidden">
        <div className="w-1.5 bg-blue-500 flex-shrink-0" />
        <div className="flex-1 p-2 flex flex-col justify-between gap-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
              <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
            </div>
            {shieldBlock}
          </div>
          {fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}
          {fieldRow('HUELLA SHA-256', hashShort)}
          {fieldRow('FECHA Y HORA', fecha)}
          <p className="text-right text-[7px] text-gray-500">Firmado con e.firma</p>
        </div>
      </div>
    );

  if (variant.id === 'EC4')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] flex-col justify-center gap-1.5 w-full items-center">
        <div className="flex w-full items-start justify-center gap-2">
          <div className="text-center">
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
          </div>
          {shieldBlock}
        </div>
        <p className="text-[7px] text-gray-600 text-center">HUELLA SHA-256: {hashShort}</p>
        <p className="text-[7px] text-gray-600 text-center">FECHA Y HORA: {fecha}</p>
        {qrVerificationBlock}
      </div>
    );

  if (variant.id === 'EC5')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] flex-col justify-between gap-2 w-full">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
          </div>
          {shieldBlock}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-1 flex-col gap-2">
            {fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}
            {fieldRow('HUELLA SHA-256', hashShort)}
          </div>
          {qrVerificationBlock}
        </div>
      </div>
    );

  if (variant.id === 'EM1')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] flex-col justify-between gap-2 w-full">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
            <p className="text-[7px] text-gray-500">
              Rol: {role} · Acto: {act}
            </p>
          </div>
          {qrVerificationBlock}
        </div>
        {evidenceHashBlock}
        <div className="grid grid-cols-2 gap-3">
          {fieldRow('FECHA Y HORA', fecha)}
          {fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}
        </div>
      </div>
    );

  if (variant.id === 'EM2')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] flex-col items-center justify-between gap-2 w-full">
        <div className="text-center">
          <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
          <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
          <p className="text-[7px] text-gray-500">
            Rol: {role} · Acto: {act}
          </p>
        </div>
        <div className="w-full">{evidenceHashBlock}</div>
        <div className="grid w-full grid-cols-2 gap-3">
          {fieldRow('FECHA Y HORA', fecha)}
          {fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}
        </div>
        {qrVerificationBlock}
      </div>
    );

  if (variant.id === 'EM3')
    return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex min-h-[190px] w-full overflow-hidden">
        <div className="w-1.5 bg-blue-300 flex-shrink-0" />
        <div className="flex flex-1 flex-col justify-between gap-2 p-2">
          <div>
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
            <p className="text-[7px] text-gray-500">
              Rol: {role} · Acto: {act}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">{evidenceHashBlock}</div>
            {qrVerificationBlock}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {fieldRow('FECHA Y HORA', fecha)}
            {fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}
          </div>
        </div>
      </div>
    );

  if (variant.id === 'EM4')
    return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex min-h-[190px] flex-col w-full overflow-hidden">
        <div className="bg-slate-800 px-2 py-2">
          <p className="text-[9px] font-bold text-white leading-tight">{nombre}</p>
        </div>
        <div className="flex flex-1 flex-col justify-between gap-2 p-2">
          <div>
            <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
            <p className="text-[7px] text-gray-500">
              Rol: {role} · Acto: {act}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">{evidenceHashBlock}</div>
            {qrVerificationBlock}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {fieldRow('FECHA Y HORA', fecha)}
            {fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}
          </div>
        </div>
      </div>
    );

  if (variant.id === 'EM5')
    return (
      <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex min-h-[190px] w-3/5 mx-auto flex-col items-center justify-between gap-2">
        <div className="w-full text-center">
          <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
          <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
          <p className="text-[7px] text-gray-500">Rol: {role}</p>
          <p className="text-[7px] text-gray-500">Acto: {act}</p>
        </div>
        <div className="w-full">{evidenceHashBlock}</div>
        <div className="w-full">{fieldRow('FECHA Y HORA', fecha)}</div>
        <div className="w-full">{fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}</div>
        {qrVerificationBlock}
      </div>
    );

  if (variant.id === 'EL1')
    return (
      <div className="border border-gray-200 rounded-lg p-3 bg-white text-left flex min-h-[190px] flex-col justify-between gap-2 w-full">
        <p className="border-b border-gray-200 pb-2 text-[10px] font-bold text-gray-800">
          {nombre}
        </p>
        <div className="grid grid-cols-2 gap-5">
          <div className="grid grid-cols-3 gap-2">
            {fieldRow('RFC', rfc)}
            {fieldRow('ROL', role)}
            {fieldRow('ACTO', act)}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {fieldRow('FECHA Y HORA', fecha)}
            {fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}
            {fieldRow('VIGENCIA', `Hasta ${vigencia}`)}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-gray-200 pt-2">
          <div className="flex-1">{evidenceHashBlock}</div>
          {qrVerificationBlock}
        </div>
      </div>
    );

  if (variant.id === 'EL2')
    return (
      <div className="border border-gray-200 rounded-lg p-3 bg-white text-left flex min-h-[190px] flex-col justify-between gap-2 w-full">
        <p className="border-b border-gray-200 pb-2 text-[10px] font-bold text-gray-800">
          {nombre}
        </p>
        <div className="grid grid-cols-2 gap-5">
          <div className="grid grid-cols-3 gap-2">
            {fieldRow('RFC', rfc)}
            {fieldRow('ROL', role)}
            {fieldRow('ACTO', act)}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {fieldRow('FECHA Y HORA', fecha)}
            {fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}
            {fieldRow('VIGENCIA', `Hasta ${vigencia}`)}
          </div>
        </div>
        {evidenceHashBlock}
        <div className="grid grid-cols-2 gap-5">
          {fieldRow('ALGORITMO', 'RSA-2048 / SHA-256')}
          <div>
            <p className="text-[7px] font-semibold text-gray-400 uppercase leading-none">
              VALIDACIÓN
            </p>
            <div className="mt-1">{validationPill('Certificado verificado')}</div>
          </div>
        </div>
      </div>
    );

  if (variant.id === 'EL3')
    return (
      <div className="border border-gray-200 rounded-lg bg-white text-left flex min-h-[190px] w-full overflow-hidden">
        <div className="w-2 bg-blue-500 flex-shrink-0" />
        <div className="flex flex-1 flex-col justify-between gap-2 p-3">
          <p className="text-[10px] font-bold text-gray-800">{nombre}</p>
          <div className="grid grid-cols-2 gap-5">
            <div className="grid grid-cols-3 gap-2">
              {fieldRow('RFC', rfc)}
              {fieldRow('ROL', role)}
              {fieldRow('ACTO', act)}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {fieldRow('FECHA Y HORA', fecha)}
              {fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}
              <div>
                <p className="text-[7px] font-semibold text-gray-400 uppercase leading-none">
                  VALIDACIÓN
                </p>
                <div className="mt-1">{validationPill('Certificado verificado')}</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-gray-200 pt-2">
            <div className="flex-1">{evidenceHashBlock}</div>
            {qrVerificationBlock}
          </div>
        </div>
      </div>
    );

  if (variant.id === 'EL4')
    return (
      <div className="border border-gray-200 rounded-lg p-3 bg-white text-left flex min-h-[190px] flex-col justify-between gap-2 w-full">
        <div className="flex items-start border-b border-gray-200 pb-2">
          <p className="flex-1 text-center text-[10px] font-bold text-gray-800">{nombre}</p>
          {qrVerificationBlock}
        </div>
        <div className="grid grid-cols-3 divide-x divide-gray-200 text-center">
          {fieldRow('RFC', rfc)}
          {fieldRow('ROL', role)}
          {fieldRow('ACTO', act)}
        </div>
        {evidenceHashBlock}
        <div className="grid grid-cols-3 gap-3">
          {fieldRow('FECHA Y HORA', fecha)}
          {fieldRow('SERIE DEL CERTIFICADO', numeroSerie)}
          {fieldRow('VIGENCIA', `Hasta ${vigencia}`)}
        </div>
      </div>
    );

  return null;
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

const STAMP_ELEMENTS: Record<string, { label: string; elements: string[] }> = {
  EC1: {
    label: 'EC1 · Mínima e.firma',
    elements: [
      'Nombre del titular',
      'RFC',
      'Escudo de e.firma',
      'Huella SHA-256 abreviada',
      'Fecha y hora',
      'Leyenda de firma con e.firma',
    ],
  },
  EC2: {
    label: 'EC2 · Check + QR',
    elements: [
      'Nombre del titular',
      'RFC',
      'Escudo de e.firma',
      'Estado del certificado',
      'Huella SHA-256 abreviada',
      'Fecha y hora',
      'Código QR de verificación',
      'Leyenda de firma con e.firma',
    ],
  },
  EC3: {
    label: 'EC3 · Franja lateral',
    elements: [
      'Barra lateral azul',
      'Nombre del titular',
      'RFC',
      'Escudo de e.firma',
      'Serie del certificado',
      'Huella SHA-256 abreviada',
      'Fecha y hora',
      'Leyenda de firma con e.firma',
    ],
  },
  EC4: {
    label: 'EC4 · Centrada + QR',
    elements: [
      'Composición centrada',
      'Nombre del titular',
      'RFC',
      'Escudo de e.firma',
      'Huella SHA-256 abreviada',
      'Fecha y hora',
      'Código QR de verificación',
    ],
  },
  EC5: {
    label: 'EC5 · Hash + QR lateral',
    elements: [
      'Nombre del titular',
      'RFC',
      'Escudo de e.firma',
      'Serie del certificado',
      'Huella SHA-256 abreviada',
      'Código QR de verificación lateral',
    ],
  },
  EM1: {
    label: 'EM1 · Estándar certificado',
    elements: [
      'Diseño horizontal equilibrado',
      'Nombre del titular',
      'RFC',
      'Rol',
      'Acto',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Número de serie del certificado',
      'Código QR de verificación',
    ],
  },
  EM2: {
    label: 'EM2 · Base compacta',
    elements: [
      'Composición compacta y centrada',
      'Nombre del titular',
      'RFC',
      'Rol',
      'Acto',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Número de serie del certificado',
      'Código QR de verificación',
    ],
  },
  EM3: {
    label: 'EM3 · Franja lateral',
    elements: [
      'Barra lateral azul',
      'Distribución en tres columnas',
      'Nombre del titular',
      'RFC',
      'Rol',
      'Acto',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Número de serie del certificado',
      'Código QR de verificación',
    ],
  },
  EM4: {
    label: 'EM4 · Encabezado sobrio',
    elements: [
      'Encabezado de contraste',
      'Cuerpo estructurado',
      'Nombre del titular',
      'RFC',
      'Rol',
      'Acto',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Número de serie del certificado',
      'Código QR de verificación',
    ],
  },
  EM5: {
    label: 'EM5 · Ticket de validación',
    elements: [
      'Formato vertical tipo ticket',
      'Nombre del titular',
      'RFC',
      'Rol',
      'Acto',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Número de serie del certificado',
      'Código QR de verificación',
    ],
  },
  EL1: {
    label: 'EL1 · Resumen integral',
    elements: [
      'Formato horizontal de lectura integral',
      'Nombre del titular',
      'RFC',
      'Rol',
      'Acto',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Vigencia',
      'Número de serie del certificado',
      'Código QR de verificación',
    ],
  },
  EL2: {
    label: 'EL2 · Constancia de certificado',
    elements: [
      'Nombre del titular',
      'RFC',
      'Rol',
      'Acto',
      'Número de serie del certificado',
      'Algoritmo RSA/SHA-256',
      'Vigencia',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Validación del certificado',
    ],
  },
  EL3: {
    label: 'EL3 · Franja analítica',
    elements: [
      'Barra lateral azul',
      'Nombre del titular',
      'RFC',
      'Rol',
      'Acto',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Número de serie del certificado',
      'Validación del certificado',
      'Código QR de verificación',
    ],
  },
  EL4: {
    label: 'EL4 · Formato formal',
    elements: [
      'Composición simétrica',
      'Nombre del titular',
      'RFC',
      'Rol',
      'Acto',
      'Huella SHA-256 completa',
      'Fecha y hora',
      'Número de serie del certificado',
      'Vigencia',
      'Código QR de verificación',
    ],
  },
};

function StampDetailModal({
  variant,
  efirmaData,
  onClose,
}: {
  variant: StampVariant;
  efirmaData: EfirmaStampSelectorProps['efirmaData'];
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
                <div className="w-full [&>div]:border-0">
                  <StampPreview variant={variant} efirmaData={efirmaData} />
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

export default function EfirmaStampSelector({
  efirmaData,
  currentStampStyle,
  onSave,
  initiallyOpen = false,
  showSummary = true,
  onCancel,
}: EfirmaStampSelectorProps) {
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
              <h4 className="text-sm font-600 text-foreground">Estampa de e.Firma SAT</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Elige el estilo de estampa que se imprimirá en los documentos firmados con tu
                e.Firma SAT.
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
                  Seleccionar Estampa · e.Firma SAT
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Elige el diseño de estampa para tus documentos firmados con e.Firma.
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
                        className={`p-4 grid gap-3 ${cat === 'larga' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3'}`}
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
                                  <div className="p-1.5 [&>div]:border-0">
                                    <StampPreview variant={variant} efirmaData={efirmaData} />
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
          efirmaData={efirmaData}
          onClose={() => setDetailVariant(null)}
        />
      )}
    </>
  );
}
