'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

export type NoticeTone = 'critical' | 'followup' | 'warning' | 'success' | 'neutral';

/** Classify legacy feedback until each caller can pass its intent explicitly. */
export function noticeToneFromMessage(message: string): NoticeTone {
  if (/\b(error|fall[oó]|no se (?:pudo|puede|pudieron)|no fue posible|no se logr[oó]|no tienes permiso|expir[oó]|caduc[oó]|rechazad[oa]|inv[aá]lid[oa]|bloquead[oa])(?=$|[\s.,;:!?])/i.test(message)) return 'critical';
  if (/\b(advertencia|atenci[oó]n|revisa|verifica|requiere|debes|debe|escribe|agrega|selecciona|l[ií]mite)(?=$|[\s.,;:!?])/i.test(message)) return 'warning';
  if (/enviad[oa] a aprobaci[oó]n|\b(pendiente|programad[oa]|procesando|en curso|reintentando|descargando|preparad[oa])(?=$|[\s.,;:!?])/i.test(message)) return 'followup';
  if (/\b(guardad[oa]|enviad[oa]|publicad[oa]|cread[oa]|actualizad[oa]|cancelad[oa]|eliminad[oa]|restaurad[oa]|archivad[oa]|duplicad[oa]|completad[oa]|correctamente)(?=$|[\s.,;:!?])/i.test(message)) return 'success';
  return 'neutral';
}

export function NoticeCard({ message, tone, onClose }: { message: string; tone?: NoticeTone; onClose?: () => void }) {
  const resolvedTone = tone || noticeToneFromMessage(message);
  return (
    <div className="app-feedback-toast" data-tone={resolvedTone} role={resolvedTone === 'critical' ? 'alert' : 'status'}>
      <span>{message}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="Cerrar aviso"><X size={14} aria-hidden="true" /></button>}
    </div>
  );
}

export function BottomNotice(props: Parameters<typeof NoticeCard>[0]) {
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  if (dismissedMessage === props.message) return null;
  return <div className="app-feedback-position"><NoticeCard {...props} onClose={props.onClose || (() => setDismissedMessage(props.message))} /></div>;
}
