'use client';
import { CheckCircle2, Clock, Edit3, Mail, ShieldCheck } from 'lucide-react';
import { caseSignatureLabels, type CaseSignatureType } from '@/lib/case-files/launch-settings';
import { dateInTimeZone, getTimeZoneOffsetLabel } from '@/lib/datetime';
const card = 'space-y-4 rounded-lg border border-slate-200 bg-white p-5 sm:p-6';
export function SignatureSettings({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: CaseSignatureType) => void;
}) {
  const icons = { click_sign: CheckCircle2, autografa_digital: Edit3, efirma_sat: ShieldCheck };
  return (
    <section className={card}>
      <div>
        <h2 className="text-base font-semibold">Tipo de firma</h2>
        <p className="mt-1 text-sm text-slate-500">
          Se aplicará a los documentos y formularios que requieran firma en este expediente.
        </p>
      </div>
      <div className="space-y-3">
        {Object.entries(caseSignatureLabels).map(([key, label]) => {
          const Icon = icons[key as CaseSignatureType],
            disabled = !options.includes(key);
          return (
            <label
              key={key}
              className={`flex gap-3 rounded-lg border p-4 ${disabled ? 'cursor-not-allowed opacity-45' : value === key ? 'border-primary bg-blue-50/60' : 'cursor-pointer border-slate-200'}`}
            >
              <input
                type="radio"
                name="case-signature-method"
                value={key}
                checked={value === key}
                disabled={disabled}
                onChange={() => onChange(key as CaseSignatureType)}
                className="mt-1 accent-primary"
              />
              <Icon size={20} className="shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-semibold">{label}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {disabled
                    ? 'No compatible con los documentos o formularios vinculados.'
                    : key === 'click_sign'
                      ? 'Confirmación electrónica desde el documento.'
                      : key === 'autografa_digital'
                        ? 'Firma trazada en el documento.'
                        : 'Firma con los archivos y contraseña de e.firma del participante.'}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-slate-500">
        Elegir un método no firma ni envía documentos automáticamente. Las revisiones y aprobaciones
        se mantienen según el expediente publicado.
      </p>
    </section>
  );
}
export function DeliverySettings({
  mode,
  onMode,
  date,
  onDate,
  time,
  onTime,
  timezone,
  hours,
  onHours,
}: {
  mode: 'now' | 'scheduled';
  onMode: (v: 'now' | 'scheduled') => void;
  date: string;
  onDate: (v: string) => void;
  time: string;
  onTime: (v: string) => void;
  timezone: string;
  hours: number;
  onHours: (v: number) => void;
}) {
  return (
    <section className={card}>
      <div>
        <h2 className="text-base font-semibold">Envío de invitaciones</h2>
        <p className="mt-1 text-sm text-slate-500">
          Confirma cuándo se enviarán los enlaces personales.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Momento del envío"
        className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1"
      >
        {(['now', 'scheduled'] as const).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={mode === v}
            onClick={() => onMode(v)}
            className={`flex h-10 items-center justify-center gap-2 rounded-md text-sm font-semibold ${mode === v ? 'bg-white text-primary shadow-sm' : 'text-slate-600'}`}
          >
            {v === 'now' ? <Mail size={16} /> : <Clock size={16} />}{' '}
            {v === 'now' ? 'Enviar ahora' : 'Programar envío'}
          </button>
        ))}
      </div>
      {mode === 'scheduled' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Fecha
            <input
              type="date"
              min={dateInTimeZone(timezone)}
              value={date}
              onChange={(e) => onDate(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3"
            />
          </label>
          <label className="text-sm">
            Hora
            <input
              type="time"
              value={time}
              onChange={(e) => onTime(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3"
            />
          </label>
          <p className="text-xs text-slate-500 sm:col-span-2">
            {timezone} ({getTimeZoneOffsetLabel(timezone)})
          </p>
        </div>
      )}
      <label className="block text-sm">
        Vigencia del enlace (horas)
        <input
          type="number"
          min={1 / 60}
          max={720}
          step="any"
          value={Number.isFinite(hours) ? hours : ''}
          onChange={(e) => onHours(e.target.value === '' ? NaN : Number(e.target.value))}
          className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3"
        />
      </label>
      <p className="text-xs text-slate-500">
        Entre 1 minuto y 720 horas. La vigencia comienza en la fecha de envío prevista.
      </p>
    </section>
  );
}
