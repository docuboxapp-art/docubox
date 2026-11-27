'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

export type NoticeTone = 'critical' | 'followup' | 'warning' | 'success' | 'neutral';

/** Classify legacy feedback until each caller can pass its intent explicitly. */
export function noticeToneFromMessage(message: string): NoticeTone {
  if (
    /\b(error|fall[oó]|no se (?:pudo|puede|pudieron)|no fue posible|no se logr[oó]|no tienes permiso|expir[oó]|caduc[oó]|rechazad[oa]|inv[aá]lid[oa]|bloquead[oa])(?=$|[\s.,;:!?])/i.test(
      message
    )
  )
    return 'critical';
  if (
    /\b(advertencia|atenci[oó]n|revisa|verifica|requiere|debes|debe|escribe|agrega|selecciona|l[ií]mite)(?=$|[\s.,;:!?])/i.test(
      message
    )
  )
    return 'warning';
  if (
    /enviad[oa] a aprobaci[oó]n|\b(pendiente|programad[oa]|procesando|en curso|reintentando|descargando|preparad[oa])(?=$|[\s.,;:!?])/i.test(
      message
    )
  )
    return 'followup';
  if (
    /\b(guardad[oa]|enviad[oa]|publicad[oa]|cread[oa]|actualizad[oa]|cancelad[oa]|eliminad[oa]|restaurad[oa]|archivad[oa]|duplicad[oa]|completad[oa]|correctamente)(?=$|[\s.,;:!?])/i.test(
      message
    )
  )
    return 'success';
  return 'neutral';
}

const toastByTone = {
  critical: toast.error,
  followup: toast.info,
  warning: toast.warning,
  success: toast.success,
  neutral: toast.info,
};

export function BottomNotice({
  message,
  tone,
  onClose,
}: {
  message: string;
  tone?: NoticeTone;
  onClose?: () => void;
}) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!message.trim()) return;
    const resolvedTone = tone ?? noticeToneFromMessage(message);
    let active = true;
    const close = () => {
      if (active) onCloseRef.current?.();
    };
    let id: ReturnType<typeof toast> | undefined;
    const timer = window.setTimeout(() => {
      id = toastByTone[resolvedTone](message, {
        onDismiss: close,
        onAutoClose: close,
        className: resolvedTone === 'followup' ? 'app-toast-followup' : undefined,
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      if (id !== undefined) toast.dismiss(id);
    };
  }, [message, tone]);

  return null;
}
