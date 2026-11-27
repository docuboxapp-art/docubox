'use client';

import { BottomNotice } from '@/components/ui/BottomNotice';
import { useRef, useState, type FormEvent } from 'react';
import { FileText } from 'lucide-react';
import { reminderSentToday } from '@/lib/contacts/document-reminders';
import { ContactEditorDialog } from './contact-detail-ui';

export type ContactReminder = {
  id: string;
  name: string;
  email: string;
  action: string;
  sentAt?: string | null;
};

export function ContactReminderDialog({
  contactName,
  email,
  reminders,
  loading,
  unavailable,
  onClose,
  onSent,
}: {
  contactName: string;
  email?: string | null;
  reminders: ContactReminder[];
  loading: boolean;
  unavailable: boolean;
  onClose: () => void;
  onSent: (id: string, sentAt: string) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const submitting = useRef(false);
  const [openedAt] = useState(Date.now);
  const choice = reminders.find((item) => item.id === selectedId);
  const alreadySent = (item: ContactReminder) => reminderSentToday(item.sentAt, openedAt);
  const canSend = Boolean(choice && !alreadySent(choice) && !blocked.includes(choice.id));

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice || !canSend || submitting.current || loading || unavailable) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/documentos/send-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: choice.id, participantEmail: choice.email }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success !== true) {
        if (response.status === 429) onSent(choice.id, new Date().toISOString());
        if (response.status === 409) setBlocked((current) => [...current, choice.id]);
        setError(
          response.status < 500 && typeof payload?.error === 'string'
            ? payload.error
            : 'No se pudo enviar el recordatorio. Intenta de nuevo más tarde.'
        );
        return;
      }
      onSent(choice.id, payload.sentAt || new Date().toISOString());
      setSelectedId('');
      setNotice('Recordatorio enviado.');
    } catch {
      setError('No se pudo confirmar el envío. Intenta de nuevo.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <ContactEditorDialog
      title="Enviar recordatorio"
      submitLabel="Enviar recordatorio"
      busyLabel="Enviando…"
      submitDisabled={!canSend || loading || unavailable}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={(event) => void send(event)}
    >
      <div className="min-w-0 text-sm">
        <p className="break-words font-medium">{contactName}</p>
        {email && <p className="break-all text-muted-foreground">{email}</p>}
      </div>
      {notice && <BottomNotice message={notice} tone="success" onClose={() => setNotice('')} />}
      {!email || loading || unavailable || !reminders.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          {!email
            ? 'Agrega un correo al contacto para enviarle recordatorios.'
            : loading
              ? 'Buscando acciones pendientes…'
              : unavailable
                ? 'No se pudieron consultar las acciones pendientes. Recarga la ficha para intentarlo de nuevo.'
                : 'Este contacto no tiene acciones pendientes para recordar.'}
        </p>
      ) : (
        <fieldset className="min-w-0 space-y-2">
          <legend className="mb-2 text-sm font-medium">Selecciona un documento</legend>
          <div className="max-h-72 space-y-2 overflow-auto p-0.5">
            {reminders.map((item) => {
              const sent = alreadySent(item);
              const inactive = blocked.includes(item.id);
              return (
                <label
                  key={item.id}
                  className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm hover:border-primary/40"
                >
                  <input
                    type="radio"
                    name="documento"
                    checked={selectedId === item.id}
                    disabled={sent || inactive}
                    className="shrink-0 accent-primary"
                    onChange={() => {
                      setSelectedId(item.id);
                      setError('');
                      setNotice('');
                    }}
                  />
                  <FileText size={16} className="shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="block font-medium">{item.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {sent
                        ? 'Recordatorio enviado hoy'
                        : inactive
                          ? 'Acción no disponible'
                          : item.action}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </ContactEditorDialog>
  );
}
