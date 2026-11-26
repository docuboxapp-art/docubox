'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, MessageSquare, RefreshCw, Send, StickyNote, X } from 'lucide-react';
import { profilePrivacy } from '@/lib/profile-privacy/client';
import {
  formatPrivacyDate,
  type Communication,
  type CommunicationContext,
  type CommunicationKind,
  type Conversation,
} from '@/lib/profile-privacy/model';

const control =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-primary disabled:opacity-50';
const composerControl =
  'min-h-9 rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/35';

export function ProfileCommunicationButton({
  label,
  context,
  initialKind = 'message',
  className = control,
}: {
  label: string;
  context?: CommunicationContext;
  initialKind?: CommunicationKind;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = initialKind === 'note' ? StickyNote : MessageSquare;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Icon size={15} aria-hidden="true" /> {label}
      </button>
      {open && (
        <ProfileCommunicationDialog
          initialContext={context}
          initialKind={initialKind}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function ProfileCommunicationDialog({
  initialContext,
  initialKind = 'message',
  onClose,
}: {
  initialContext?: CommunicationContext;
  initialKind?: CommunicationKind;
  onClose: () => void;
}) {
  const [context, setContext] = useState(initialContext);
  const [kind, setKind] = useState<CommunicationKind>(initialKind);
  const [recipientId, setRecipientId] = useState('');
  const [data, setData] = useState<Conversation | null>(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [sending, setSending] = useState(false);
  const [request, setRequest] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const sendingRef = useRef(false);
  const outgoing = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await profilePrivacy<Conversation>(
          context ? 'conversation' : 'inbox',
          context ?? {},
          controller.signal
        );
        if (!controller.signal.aborted) {
          setData(result);
          if (result.peers.length === 1) {
            setRecipientId((current) => current || result.peers[0].id);
          }
          setError('');
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'No se pudo cargar la comunicación.');
      }
    }
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !sendingRef.current) void load();
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [context, request]);

  const peer = data?.peers.find((item) => item.id === recipientId);
  const enabled = kind === 'message' ? peer?.messages : peer?.notes;
  const selectedKind = enabled ? kind : peer?.messages ? 'message' : peer?.notes ? 'note' : kind;
  const canSend = selectedKind === 'message' ? peer?.messages : peer?.notes;
  const messages = data?.messages.filter((item) => !peer || item.peer === peer.id) ?? [];
  const threads = [
    ...new Map(
      (data?.messages ?? [])
        .slice()
        .reverse()
        .map((item) => [`${item.document_id ?? 'agenda'}:${item.peer}`, item])
    ).values(),
  ].reverse();

  function openThread(item: Communication) {
    setData(null);
    setError('');
    setSent('');
    setContent('');
    setRecipientId(item.peer);
    setContext(
      item.document_id ? { documentId: item.document_id, peerId: item.peer } : { peerId: item.peer }
    );
  }

  async function send() {
    if (!peer || !canSend || !content.trim() || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError('');
    setSent('');
    try {
      const key = JSON.stringify([context, peer.id, selectedKind, content.trim()]);
      if (outgoing.current?.key !== key) outgoing.current = { key, id: crypto.randomUUID() };
      await profilePrivacy('send', {
        ...context,
        peerId: peer.id,
        kind: selectedKind,
        content,
        messageId: outgoing.current.id,
      });
      outgoing.current = null;
      setContent('');
      setSent(selectedKind === 'note' ? 'Nota enviada.' : 'Mensaje enviado.');
      setRequest((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible enviar la comunicación.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!sending) onClose();
      }}
      onClick={(event) => {
        if (!sending && event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-slate-950/45"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] min-h-[min(28rem,calc(100dvh-2rem))] flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border p-4">
          {!initialContext && context && (
            <button
              type="button"
              className={control}
              aria-label="Volver a la bandeja"
              disabled={sending}
              onClick={() => {
                setContext(undefined);
                setData(null);
                setRecipientId('');
                setContent('');
                setError('');
                setSent('');
              }}
            >
              <ArrowLeft size={15} aria-hidden="true" />
            </button>
          )}
          <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold">
            {context ? 'Comunicación directa' : 'Bandeja de mensajes y notas'}
          </h2>
          <button
            type="button"
            aria-label="Actualizar conversación"
            className={control}
            disabled={sending}
            onClick={() => setRequest((current) => current + 1)}
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Cerrar"
            className={control}
            disabled={sending}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {context && data && data.peers.length > 0 && (
          <label className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium">
            Destinatario
            <select
              className={`${composerControl} min-w-40 flex-1`}
              disabled={sending}
              value={peer?.id ?? ''}
              onChange={(event) => {
                setRecipientId(event.target.value);
                setContent('');
                setSent('');
              }}
            >
              {(!peer || data.peers.length > 1) && (
                <option value="">Selecciona a una persona</option>
              )}
              {data.peers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && (
            <p
              role="alert"
              className="mb-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {!data && !error && (
            <p role="status" className="text-sm text-muted-foreground">
              Cargando…
            </p>
          )}
          {data &&
            !context &&
            (threads.length ? (
              <ul className="divide-y divide-border">
                {threads.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-3 text-left hover:bg-muted focus-visible:outline-primary"
                      onClick={() => openThread(item)}
                    >
                      <span className="block break-words text-sm font-medium">
                        {item.peer_name}
                      </span>
                      {item.document_name && (
                        <span className="block break-words text-xs text-muted-foreground">
                          {item.document_name}
                        </span>
                      )}
                      <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                        {item.content}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No tienes mensajes ni notas directas.</p>
            ))}
          {data &&
            context &&
            (messages.length ? (
              <ol className="space-y-2">
                {messages
                  .slice()
                  .reverse()
                  .map((item) => (
                    <li
                      key={item.id}
                      className={`w-fit max-w-[90%] rounded-lg border border-border p-3 ${item.sender_id === data.viewerId ? 'ml-auto bg-primary/5' : 'bg-muted/55'}`}
                    >
                      <p className="text-xs text-muted-foreground">
                        {item.sender_id === data.viewerId ? 'Tú' : item.peer_name} ·{' '}
                        {item.kind === 'note' ? 'Nota' : 'Mensaje'} ·{' '}
                        {formatPrivacyDate(item.created_at)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                        {item.content}
                      </p>
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                {data.peers.length
                  ? 'Aún no hay mensajes ni notas en esta conversación.'
                  : 'No hay destinatarios disponibles.'}
              </p>
            ))}
        </div>
        {context &&
          peer &&
          (canSend ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
              className="shrink-0 space-y-2 border-t border-border p-4"
            >
              <fieldset disabled={sending} className="space-y-2">
                <textarea
                  aria-label={selectedKind === 'note' ? 'Nota directa' : 'Mensaje directo'}
                  placeholder={selectedKind === 'note' ? 'Escribe tu nota…' : 'Escribe tu mensaje…'}
                  rows={3}
                  maxLength={2000}
                  className={`${composerControl} w-full resize-y py-2`}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <select
                    aria-label="Tipo de comunicación"
                    className={composerControl}
                    value={selectedKind}
                    onChange={(event) => setKind(event.target.value as CommunicationKind)}
                  >
                    <option value="message" disabled={!peer.messages}>
                      Mensaje
                    </option>
                    <option value="note" disabled={!peer.notes}>
                      Nota
                    </option>
                  </select>
                  <button
                    type="submit"
                    disabled={!content.trim() || sending}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Send size={15} aria-hidden="true" />{' '}
                    {sending
                      ? 'Enviando…'
                      : selectedKind === 'note'
                        ? 'Enviar nota'
                        : 'Enviar mensaje'}
                  </button>
                </div>
              </fieldset>
              {sent && (
                <p role="status" className="text-xs text-muted-foreground">
                  {sent}
                </p>
              )}
            </form>
          ) : (
            <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
              Esta persona tiene desactivada la comunicación directa.
            </p>
          ))}
      </div>
    </dialog>
  );
}
