'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { SignatureQrCode } from '@/components/signatures/SignatureQrCode';
import { getPublicAppUrl } from '@/lib/publicAppUrl';
import { getStampSizePreset } from '@/lib/signatures/stamp-sizing';

export interface StampDisplayProps {
  stampStyle: string;
  signatureType: 'efirma' | 'autografa' | 'clicksign';
  signatureUrl: string | null;
  userName: string;
  userRfc: string;
  userCurp?: string;
  participantRole?: string;
  participantAct?: string;
  signatureHash: string;
  signedAt: string;
  ipAddress: string;
  coordinates: { lat: number; lng: number } | null;
  efirmaSerial?: string | null;
  efirmaVigenciaFin?: string | null;
  verificationUrl?: string;
}

export function FittedSignatureStamp(props: StampDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ width: 220, scale: 1, left: 0, top: 0 });

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const measure = () => {
      const width = Math.max(
        getStampSizePreset(props.stampStyle).minimumRenderWidth,
        container.clientWidth
      );
      content.style.width = `${width}px`;
      const height = Math.max(content.scrollHeight, 1);
      const scale = Math.min(1, container.clientWidth / width, container.clientHeight / height);
      setLayout({
        width,
        scale,
        left: Math.max(0, (container.clientWidth - width * scale) / 2),
        top: Math.max(0, (container.clientHeight - height * scale) / 2),
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [props.stampStyle, props.signatureUrl, props.signatureHash]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-white">
      <div
        ref={contentRef}
        className="absolute [&>div]:border-0"
        style={{
          width: layout.width,
          left: layout.left,
          top: layout.top,
          transform: `scale(${layout.scale})`,
          transformOrigin: 'top left',
        }}
      >
        <SignatureStampDisplay {...props} />
      </div>
    </div>
  );
}

export function SignatureStampDisplay({
  stampStyle,
  signatureType,
  signatureUrl,
  userName,
  userRfc,
  userCurp,
  participantRole,
  participantAct,
  signatureHash,
  signedAt,
  ipAddress,
  coordinates,
  efirmaSerial,
  efirmaVigenciaFin,
  verificationUrl,
}: StampDisplayProps) {
  const nombre = userName || 'Firmante';
  const rfc = userRfc || '—';
  const hashShort = signatureHash
    ? signatureHash.slice(0, 16) + '...' + signatureHash.slice(-6)
    : '—';
  const efirmaHashShort = signatureHash
    ? signatureHash.slice(0, 12) + '...' + signatureHash.slice(-8)
    : '—';
  const hashFull = signatureHash || '—';
  const signedDate = signedAt ? new Date(signedAt) : null;
  const fecha = signedDate
    ? signedDate.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }) + ' CST'
    : 'Pendiente de firmar';
  const fechaHora = signedDate
    ? signedDate.toLocaleString('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + ' CST'
    : 'Pendiente de firmar';
  const role = participantRole || 'Firmante';
  const act = participantAct || 'Firmante';
  const maskIdentifier = (value?: string) => {
    const normalized = String(value || '')
      .trim()
      .toUpperCase();
    if (!normalized) return 'No disponible';
    if (normalized.length <= 7) return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
    return `${normalized.slice(0, 4)}******${normalized.slice(-3)}`;
  };
  const maskedRfc = maskIdentifier(userRfc);
  const maskedCurp = maskIdentifier(userCurp);
  const ip = ipAddress && ipAddress !== '—' ? ipAddress : '—';
  const geoloc = coordinates
    ? `${coordinates.lat.toFixed(2)}°N ${Math.abs(coordinates.lng).toFixed(2)}°W ±80m`
    : '—';
  const clickSignLocation = geoloc === '—' ? 'Ubicación no disponible' : geoloc;
  const clickSignDevice = 'Navegador web';
  const clickSignChannel = 'Click & Sign';
  const vigencia = efirmaVigenciaFin
    ? new Date(efirmaVigenciaFin).toLocaleDateString('es-MX', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    : '—';
  const serial = efirmaSerial ? efirmaSerial.slice(0, 20) : '—';

  const qrBlock = (
    <SignatureQrCode
      value={verificationUrl || `${getPublicAppUrl()}/verificar-documento`}
      example={!verificationUrl}
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

  const hashBlock = (full = false) => (
    <div
      className={`border rounded px-1.5 py-1 ${signatureType === 'efirma' ? 'bg-amber-50 border-amber-200' : signatureType === 'autografa' ? 'bg-amber-50 border-amber-200' : 'bg-gray-100 border-gray-200'}`}
    >
      <p
        className={`text-[6px] font-semibold uppercase tracking-wide ${signatureType === 'efirma' ? 'text-amber-700' : signatureType === 'autografa' ? 'text-amber-700' : 'text-gray-500'}`}
      >
        {signatureType === 'efirma'
          ? 'HUELLA SHA-256'
          : signatureType === 'autografa'
            ? '🔑 HASH FIRMADO SHA-256'
            : '○ HASH ACEPTACIÓN SHA-256'}
      </p>
      <p className="text-[7px] font-mono text-gray-700 break-all leading-tight mt-0.5">
        {full ? hashFull : hashShort}
      </p>
    </div>
  );

  const signatureTrace = (
    <>
      {signatureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signatureUrl}
          alt="Firma autógrafa"
          className="block h-full w-full object-contain"
        />
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
      )}
    </>
  );

  const sigBox = () => (
    <div className="flex h-10 w-full items-center justify-center overflow-hidden bg-slate-50 p-1">
      {signatureTrace}
    </div>
  );

  const certLine = (expanded = false) => (
    <p className="text-[7px] text-gray-500 leading-tight">
      {expanded
        ? `Serie: ${serial} · RSA/SHA-256 · OCSP vigente · Válido hasta ${vigencia}`
        : `Serie: ${serial} · Válido hasta ${vigencia}`}
    </p>
  );

  const validationPill = (label = 'Certificado vigente') => (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[7px] font-semibold text-emerald-700">
      <svg
        width="8"
        height="8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
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

  const evidenceHashBlock = (
    <div className="rounded bg-blue-50 px-2 py-1.5">
      <p className="text-[7px] font-semibold text-blue-700 uppercase">HUELLA SHA-256</p>
      <p className="mt-0.5 break-all font-mono text-[7px] leading-tight text-gray-700">
        {hashFull}
      </p>
    </div>
  );

  const autographIdentityBlock = (
    <div className="w-full min-w-0 text-left leading-tight">
      <p className="break-words text-[9px] font-bold text-gray-800">{nombre}</p>
      <p className="text-[7px] text-gray-600">
        Rol: {role} · Acto: {act}
      </p>
    </div>
  );

  const urlLine = () => (
    <p className="text-[7px] text-blue-600 leading-tight">
      {verificationUrl || 'Verificación disponible al finalizar'}
    </p>
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

  const acceptBox = (short = true) => (
    <div className="bg-gray-50 border border-gray-200 rounded px-1.5 py-1 flex items-start gap-1">
      <div className="w-3 h-3 rounded border border-gray-400 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <p className="text-[7px] text-gray-700 leading-tight">
        {short
          ? `Aceptó expresamente · clic confirmado`
          : `Aceptó expresamente el documento mediante clic confirmado + OTP ✓`}
      </p>
    </div>
  );

  const acceptancePill = (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[7px] font-semibold text-blue-700">
      <svg
        width="8"
        height="8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      Aceptación confirmada
    </span>
  );

  // ── e.Firma stamps ──────────────────────────────────────────────────────────
  if (signatureType === 'efirma') {
    if (stampStyle === 'EC1')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-2 w-full">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
              <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
            </div>
            {shieldBlock}
          </div>
          <div className="grid grid-cols-2 gap-2 rounded bg-slate-50 px-2 py-1.5">
            {fieldRow('HUELLA SHA-256', efirmaHashShort)}
            {fieldRow('FECHA Y HORA', fechaHora)}
          </div>
          <p className="text-[7px] text-gray-500">Firmado con e.firma</p>
        </div>
      );
    if (stampStyle === 'EC2')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-2 w-full">
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
              {fieldRow('HUELLA SHA-256', efirmaHashShort)}
              {fieldRow('FECHA Y HORA', fechaHora)}
            </div>
            {qrVerificationBlock}
          </div>
          <p className="text-[7px] text-gray-500">Firmado con e.firma</p>
        </div>
      );
    if (stampStyle === 'EC3')
      return (
        <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
          <div className="w-1.5 bg-blue-500 flex-shrink-0" />
          <div className="flex-1 p-2 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
                <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
              </div>
              {shieldBlock}
            </div>
            {fieldRow('SERIE DEL CERTIFICADO', serial)}
            {fieldRow('HUELLA SHA-256', efirmaHashShort)}
            {fieldRow('FECHA Y HORA', fechaHora)}
            <p className="text-right text-[7px] text-gray-500">Firmado con e.firma</p>
          </div>
        </div>
      );
    if (stampStyle === 'EC4')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-1.5 w-full items-center">
          <div className="flex w-full items-start justify-center gap-2">
            <div className="text-center">
              <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
              <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
            </div>
            {shieldBlock}
          </div>
          <p className="text-[7px] text-gray-600 text-center">HUELLA SHA-256: {efirmaHashShort}</p>
          <p className="text-[7px] text-gray-600 text-center">FECHA Y HORA: {fechaHora}</p>
          {qrVerificationBlock}
        </div>
      );
    if (stampStyle === 'EC5')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col gap-2 w-full">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
              <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
            </div>
            {shieldBlock}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-1 flex-col gap-2">
              {fieldRow('SERIE DEL CERTIFICADO', serial)}
              {fieldRow('HUELLA SHA-256', efirmaHashShort)}
            </div>
            {qrVerificationBlock}
          </div>
        </div>
      );
    // Medianas
    if (stampStyle === 'EM1')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col justify-between gap-2 w-full">
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
            {fieldRow('FECHA Y HORA', fechaHora)}
            {fieldRow('SERIE DEL CERTIFICADO', serial)}
          </div>
        </div>
      );
    if (stampStyle === 'EM2')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col items-center justify-between gap-2 w-full">
          <div className="text-center">
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
            <p className="text-[7px] text-gray-500">
              Rol: {role} · Acto: {act}
            </p>
          </div>
          <div className="w-full">{evidenceHashBlock}</div>
          <div className="grid w-full grid-cols-2 gap-3">
            {fieldRow('FECHA Y HORA', fechaHora)}
            {fieldRow('SERIE DEL CERTIFICADO', serial)}
          </div>
          {qrVerificationBlock}
        </div>
      );
    if (stampStyle === 'EM3')
      return (
        <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
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
              {fieldRow('FECHA Y HORA', fechaHora)}
              {fieldRow('SERIE DEL CERTIFICADO', serial)}
            </div>
          </div>
        </div>
      );
    if (stampStyle === 'EM4')
      return (
        <div className="border border-gray-200 rounded-lg bg-white text-left flex flex-col w-full overflow-hidden">
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
              {fieldRow('FECHA Y HORA', fechaHora)}
              {fieldRow('SERIE DEL CERTIFICADO', serial)}
            </div>
          </div>
        </div>
      );
    if (stampStyle === 'EM5')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex w-3/5 mx-auto flex-col items-center justify-between gap-2">
          <div className="w-full text-center">
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">RFC: {rfc}</p>
            <p className="text-[7px] text-gray-500">Rol: {role}</p>
            <p className="text-[7px] text-gray-500">Acto: {act}</p>
          </div>
          <div className="w-full">{evidenceHashBlock}</div>
          <div className="w-full">{fieldRow('FECHA Y HORA', fechaHora)}</div>
          <div className="w-full">{fieldRow('SERIE DEL CERTIFICADO', serial)}</div>
          {qrVerificationBlock}
        </div>
      );
    // Largas — EL1-EL4
    if (stampStyle === 'EL1')
      return (
        <div className="border border-gray-200 rounded-lg p-3 bg-white text-left flex flex-col justify-between gap-2 w-full">
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
              {fieldRow('FECHA Y HORA', fechaHora)}
              {fieldRow('SERIE DEL CERTIFICADO', serial)}
              {fieldRow('VIGENCIA', `Hasta ${vigencia}`)}
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-gray-200 pt-2">
            <div className="flex-1">{evidenceHashBlock}</div>
            {qrVerificationBlock}
          </div>
        </div>
      );
    if (stampStyle === 'EL2')
      return (
        <div className="border border-gray-200 rounded-lg p-3 bg-white text-left flex flex-col justify-between gap-2 w-full">
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
              {fieldRow('FECHA Y HORA', fechaHora)}
              {fieldRow('SERIE DEL CERTIFICADO', serial)}
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
    if (stampStyle === 'EL3')
      return (
        <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
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
                {fieldRow('FECHA Y HORA', fechaHora)}
                {fieldRow('SERIE DEL CERTIFICADO', serial)}
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
    if (stampStyle === 'EL4')
      return (
        <div className="border border-gray-200 rounded-lg p-3 bg-white text-left flex flex-col justify-between gap-2 w-full">
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
            {fieldRow('FECHA Y HORA', fechaHora)}
            {fieldRow('SERIE DEL CERTIFICADO', serial)}
            {fieldRow('VIGENCIA', `Hasta ${vigencia}`)}
          </div>
        </div>
      );
  }

  // ── Autógrafa stamps ────────────────────────────────────────────────────────
  if (signatureType === 'autografa') {
    if (stampStyle === 'AC0')
      return (
        <div className="flex h-20 w-full items-center justify-center bg-white p-1.5">
          {signatureTrace}
        </div>
      );
    if (stampStyle === 'AC1')
      return (
        <div className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white p-1.5 text-left">
          <div className="w-full">{sigBox()}</div>
          {evidenceHashBlock}
          <p className="w-full text-left text-[7px] text-gray-600">
            Rol: {role} · Acto: {act}
          </p>
        </div>
      );
    if (stampStyle === 'AC2')
      return (
        <div className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white p-1.5 text-left">
          <div className="w-full">{sigBox()}</div>
          {evidenceHashBlock}
          {autographIdentityBlock}
        </div>
      );
    if (stampStyle === 'AC3')
      return (
        <div className="relative flex w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
          <div className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-blue-500" />
          <div className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-blue-500" />
          <div className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-blue-500" />
          <div className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-blue-500" />
          {sigBox()}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">{evidenceHashBlock}</div>
            {qrBlock}
          </div>
          {autographIdentityBlock}
          <p className="text-[7px] text-gray-500">Firmado: {fechaHora}</p>
        </div>
      );
    if (stampStyle === 'AC4')
      return (
        <div className="flex w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
          <div className="w-1.5 flex-shrink-0 bg-blue-600" />
          <div className="flex flex-1 flex-col justify-between gap-2 p-2">
            {sigBox()}
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">{evidenceHashBlock}</div>
              {qrBlock}
            </div>
            {autographIdentityBlock}
            <p className="text-[7px] text-gray-500">Firmado: {fechaHora}</p>
          </div>
        </div>
      );
    if (stampStyle === 'AC5')
      return (
        <div className="mx-auto flex w-3/5 flex-col items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
          {sigBox()}
          {evidenceHashBlock}
          {autographIdentityBlock}
          <p className="text-center text-[7px] text-gray-500">Firmado: {fechaHora}</p>
          <div className="flex justify-center">{qrBlock}</div>
        </div>
      );
    // Medianas
    if (stampStyle === 'AM1')
      return (
        <div className="flex w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
          <div className="flex items-center gap-2">
            {avatarBlock()}
            <div className="flex-1">
              <p className="text-[8px] text-gray-600">Firma autógrafa</p>
            </div>
          </div>
          {sigBox()}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">{evidenceHashBlock}</div>
            {qrBlock}
          </div>
          {autographIdentityBlock}
          <p className="text-[7px] text-gray-500">Firmado: {fechaHora}</p>
        </div>
      );
    if (stampStyle === 'AM2')
      return (
        <div className="relative flex w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
          <div className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-blue-500" />
          <div className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-blue-500" />
          <div className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-blue-500" />
          <div className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-blue-500" />
          {sigBox()}
          {evidenceHashBlock}
          {autographIdentityBlock}
          <p className="text-center text-[7px] text-gray-500">Firmado: {fechaHora}</p>
          <div className="flex justify-center">{qrBlock}</div>
          <div className="flex justify-center">
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[7px] font-semibold text-blue-700">
              Autenticación verificada
            </span>
          </div>
        </div>
      );
    if (stampStyle === 'AM3')
      return (
        <div className="flex w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
          <div className="w-1.5 flex-shrink-0 bg-blue-600" />
          <div className="flex flex-1 flex-col justify-between gap-2 p-2">
            <p className="text-[7px] text-gray-500">Firma autógrafa</p>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">{sigBox()}</div>
              {qrBlock}
            </div>
            {evidenceHashBlock}
            {autographIdentityBlock}
            <div className="grid grid-cols-3 gap-x-1 gap-y-1">
              {fieldRow('FECHA', fechaHora)}
              {fieldRow('AUTENTICACIÓN', 'OTP verificado')}
              {fieldRow('MÉTODO', 'Autógrafa')}
            </div>
          </div>
        </div>
      );
    if (stampStyle === 'AM4')
      return (
        <div className="flex w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
          <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-1.5">
            {avatarBlock()}
            <div>
              <p className="text-[8px] font-bold text-white">Firma autógrafa</p>
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-between gap-2 p-2">
            {sigBox()}
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">{evidenceHashBlock}</div>
              {qrBlock}
            </div>
            {autographIdentityBlock}
            <p className="text-[7px] text-gray-500">Firmado: {fechaHora}</p>
          </div>
        </div>
      );
    if (stampStyle === 'AM5')
      return (
        <div className="mx-auto flex w-3/5 flex-col items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
          {sigBox()}
          {evidenceHashBlock}
          {autographIdentityBlock}
          <p className="text-center text-[7px] text-gray-500">Firmado: {fechaHora}</p>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[7px] font-semibold text-blue-700">
            Firma autógrafa
          </span>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[7px] font-semibold text-blue-700">
            OTP verificado
          </span>
          <div className="flex justify-center">{qrBlock}</div>
        </div>
      );
    // Largas
    if (stampStyle === 'AL1')
      return (
        <div className="flex w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
          <div className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2">
            {avatarBlock()}
            <div>
              <p className="text-[8px] text-gray-600">Firma autógrafa</p>
            </div>
            {sigBox()}
            {qrBlock}
          </div>
          {evidenceHashBlock}
          {autographIdentityBlock}
          <p className="text-[7px] text-gray-500">Firmado: {fechaHora}</p>
        </div>
      );
    if (stampStyle === 'AL2')
      return (
        <div className="relative flex w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
          <div className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-blue-500" />
          <div className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-blue-500" />
          <div className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-blue-500" />
          <div className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-blue-500" />
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            {sigBox()}
            {qrBlock}
          </div>
          {evidenceHashBlock}
          {autographIdentityBlock}
          <p className="text-[7px] text-gray-500">Firmado: {fechaHora}</p>
        </div>
      );
    if (stampStyle === 'AL3')
      return (
        <div className="flex w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
          <div className="w-1.5 flex-shrink-0 bg-blue-600" />
          <div className="flex flex-1 flex-col justify-between gap-2 p-2">
            <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <p className="text-[8px] text-gray-600">Firma autógrafa</p>
              {sigBox()}
              {qrBlock}
            </div>
            {evidenceHashBlock}
            {autographIdentityBlock}
            <p className="text-[7px] text-gray-500">Firmado: {fechaHora}</p>
          </div>
        </div>
      );
    if (stampStyle === 'AL4')
      return (
        <div className="flex w-full flex-col justify-between gap-2 overflow-hidden rounded-lg border border-gray-200 bg-white p-2 text-left">
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
          {evidenceHashBlock}
          {autographIdentityBlock}
          <p className="text-[7px] text-gray-500">Firmado: {fechaHora}</p>
        </div>
      );
  }

  // ── Click & Sign stamps ─────────────────────────────────────────────────────
  if (signatureType === 'clicksign') {
    if (stampStyle === 'CC1')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col justify-between gap-2 w-full">
          <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
          <p className="text-[7px] text-gray-500">
            Rol: {role} · Acto: {act}
          </p>
          {evidenceHashBlock}
          {fieldRow('FECHA Y HORA', fechaHora)}
        </div>
      );
    if (stampStyle === 'CC2')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col justify-between gap-2 w-full">
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
            <div className="flex-1">{evidenceHashBlock}</div>
            {qrBlock}
          </div>
          {fieldRow('FECHA Y HORA', fechaHora)}
        </div>
      );
    if (stampStyle === 'CC3')
      return (
        <div className="border border-gray-200 rounded-lg bg-white text-left flex w-full overflow-hidden">
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
            {evidenceHashBlock}
            {fieldRow('FECHA Y HORA', fechaHora)}
          </div>
        </div>
      );
    if (stampStyle === 'CC4')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex flex-col items-center justify-between gap-2 w-full">
          {acceptancePill}
          <div className="text-center">
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">
              Rol: {role} · Acto: {act}
            </p>
          </div>
          <div className="w-full">{evidenceHashBlock}</div>
          {fieldRow('FECHA Y HORA', fechaHora)}
          {qrBlock}
        </div>
      );
    if (stampStyle === 'CC5')
      return (
        <div className="border border-gray-200 rounded-lg p-2 bg-white text-left flex w-3/5 mx-auto flex-col items-center justify-between gap-2">
          {acceptancePill}
          <div className="text-center">
            <p className="text-[9px] font-bold text-gray-800 leading-tight">{nombre}</p>
            <p className="text-[7px] text-gray-500">Rol: {role}</p>
            <p className="text-[7px] text-gray-500">Acto: {act}</p>
          </div>
          <div className="w-full">{evidenceHashBlock}</div>
          {fieldRow('FECHA Y HORA', fechaHora)}
          {qrBlock}
        </div>
      );
    // Medianas
    if (stampStyle === 'CM1')
      return (
        <div className="flex w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
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
            <div className="flex-1">{evidenceHashBlock}</div>
            {qrBlock}
          </div>
          {fieldRow('FECHA Y HORA', fechaHora)}
        </div>
      );
    if (stampStyle === 'CM2')
      return (
        <div className="flex w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
          <div className="w-2 flex-shrink-0 bg-blue-600" />
          <div className="flex flex-1 flex-col justify-between gap-2 p-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
              {acceptancePill}
            </div>
            <div className="grid grid-cols-3 gap-x-2">
              {fieldRow('ROL', role)}
              {fieldRow('ACTO', act)}
              {fieldRow('FECHA Y HORA', fechaHora)}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">{evidenceHashBlock}</div>
              {qrBlock}
            </div>
          </div>
        </div>
      );
    if (stampStyle === 'CM3')
      return (
        <div className="flex w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
          <div className="flex items-center justify-between gap-2 bg-slate-800 px-2 py-2">
            <p className="text-[9px] font-bold leading-tight text-white">{nombre}</p>
            {acceptancePill}
          </div>
          <div className="flex flex-1 flex-col justify-between gap-2 p-2">
            <p className="text-[7px] text-gray-500">
              Rol: {role} · Acto: {act}
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1">{evidenceHashBlock}</div>
              {qrBlock}
            </div>
            {fieldRow('FECHA Y HORA', fechaHora)}
          </div>
        </div>
      );
    if (stampStyle === 'CM4')
      return (
        <div className="relative flex w-full flex-col items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
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
          <div className="w-full">{evidenceHashBlock}</div>
          {fieldRow('FECHA Y HORA', fechaHora)}
          {qrBlock}
        </div>
      );
    if (stampStyle === 'CM5')
      return (
        <div className="mx-auto flex w-3/5 flex-col items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
          {acceptancePill}
          <div className="text-center">
            <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
            <p className="text-[7px] text-gray-500">Rol: {role}</p>
            <p className="text-[7px] text-gray-500">Acto: {act}</p>
          </div>
          <div className="w-full">{evidenceHashBlock}</div>
          {fieldRow('FECHA Y HORA', fechaHora)}
          <div className="scale-125">{qrBlock}</div>
        </div>
      );
    // Largas
    if (stampStyle === 'CL1')
      return (
        <div className="flex w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
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
          {evidenceHashBlock}
          <div className="grid grid-cols-[1.1fr_0.8fr_1.4fr_auto] items-end gap-x-2 border-t border-gray-200 pt-2">
            {fieldRow('FECHA Y HORA', fechaHora)}
            {fieldRow('IP', ip)}
            {fieldRow('UBICACIÓN', clickSignLocation)}
            {qrBlock}
          </div>
        </div>
      );
    if (stampStyle === 'CL2')
      return (
        <div className="flex w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[9px] font-bold leading-tight text-gray-800">{nombre}</p>
              <p className="text-[7px] text-gray-500">
                RFC: {rfc} · Rol: {role} · Acto: {act}
              </p>
            </div>
            {acceptancePill}
          </div>
          {evidenceHashBlock}
          <div className="grid grid-cols-2 gap-x-4 border-t border-gray-200 pt-2">
            <div className="flex flex-col gap-1.5 border-r border-gray-200 pr-3">
              {fieldRow('FECHA Y HORA', fechaHora)}
              {fieldRow('IP', ip)}
              {fieldRow('DISPOSITIVO', clickSignDevice)}
            </div>
            <div className="flex flex-col gap-1.5">
              {fieldRow('CANAL / MÉTODO', clickSignChannel)}
              {fieldRow('UBICACIÓN', clickSignLocation)}
              {fieldRow('ACEPTACIÓN', 'Documento aceptado electrónicamente')}
            </div>
          </div>
        </div>
      );
    if (stampStyle === 'CL3')
      return (
        <div className="flex w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left">
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
            {evidenceHashBlock}
            <div className="grid grid-cols-[1fr_1.2fr_1fr_auto] items-end gap-x-2 border-t border-gray-200 pt-2">
              <div className="flex flex-col gap-1.5">
                {fieldRow('FECHA Y HORA', fechaHora)}
                {fieldRow('IP', ip)}
              </div>
              {fieldRow('UBICACIÓN', clickSignLocation)}
              <div className="flex flex-col gap-1.5">
                {fieldRow('DISPOSITIVO', clickSignDevice)}
                {fieldRow('CANAL / MÉTODO', clickSignChannel)}
              </div>
              {qrBlock}
            </div>
          </div>
        </div>
      );
    if (stampStyle === 'CL4')
      return (
        <div className="relative flex w-full flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left">
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
          {evidenceHashBlock}
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-x-2 border-t border-gray-200 pt-2">
            {fieldRow('FECHA Y HORA', fechaHora)}
            {fieldRow('DISPOSITIVO', clickSignDevice)}
            {fieldRow('CANAL / MÉTODO', clickSignChannel)}
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
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-slate-300"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
      <p className="text-xs text-slate-400">Sin estampa visual</p>
    </div>
  );
}
