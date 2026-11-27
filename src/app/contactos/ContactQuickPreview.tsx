'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarClock,
  FileText,
  Folder,
  Hash,
  IdCard,
  Mail,
  Phone,
  Star,
  X,
} from 'lucide-react';
import {
  contactName,
  contactTags,
  formatContactDate,
  type ContactDocument,
} from '@/lib/contacts/agenda';
import { getDocumentStatusConfig } from '@/lib/documentStatusConfig';
import { ContactAvatar, ContactFollowUpBadge, type ContactAgendaRow } from './ContactAgendaTable';
import { contactButton, contactCard, contactPrimaryButton } from './contact-detail-ui';

export type ContactPreviewNote = { id: string; content: string; created_at: string };
const tabs = [
  { id: 'informacion', label: 'Información' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'actividad', label: 'Actividad' },
] as const;
const quickCard = `${contactCard} space-y-2 p-3.5`;
const cardTitle = 'text-sm font-semibold text-foreground';

function documentDetails(document: ContactDocument) {
  const fragments = [];
  if (document.urgent) fragments.push('Urgente');
  if (document.recentRejection)
    fragments.push(`Rechazado el ${formatContactDate(document.recentRejection)}`);
  if (document.action) fragments.push(document.action);
  if (document.dueAt) fragments.push(`Vence el ${formatContactDate(document.dueAt, true)}`);
  if (!fragments.length) {
    fragments.push(getDocumentStatusConfig(document.estado || '').label);
    fragments.push(formatContactDate(document.created_at));
  }
  return fragments.join(' · ');
}

function DocumentList({ documents }: { documents: ContactDocument[] }) {
  return (
    <ul className="divide-y divide-border">
      {documents.map((document) => (
        <li key={document.id} className="flex items-center gap-2 py-2.5 first:pt-1 last:pb-0">
          <FileText size={15} className="shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium">{document.nombre}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{documentDetails(document)}</p>
          </div>
          <Link
            href={`/visor-documento/${document.id}`}
            aria-label={`Ver documento ${document.nombre}`}
            title="Ver documento"
            className="grid size-8 shrink-0 place-items-center rounded-md text-primary hover:bg-primary/10 focus-visible:outline-primary"
          >
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ContactQuickPreview({
  row,
  documentsLoaded,
  documentsError,
  notes,
  loadingNotes,
  notesError,
  favoritesEnabled,
  onFavorite,
  onClose,
  onOpen,
}: {
  row: ContactAgendaRow;
  documentsLoaded: boolean;
  documentsError: boolean;
  notes: ContactPreviewNote[];
  loadingNotes: boolean;
  notesError: boolean;
  favoritesEnabled: boolean;
  onFavorite: () => void;
  onClose: () => void;
  onOpen: () => void;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('informacion');
  const tabId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const { contact, index, summary, groups, favorite } = row;
  const name = contactName(contact);
  const tags = contactTags(contact);
  const attention = [
    ...summary.documents.filter((item) => item.urgent || item.dueSoon),
    ...summary.documents.filter(
      (item) => !item.urgent && !item.dueSoon && (item.recentRejection || item.pending)
    ),
  ].slice(0, 3);
  const activity = [
    ...summary.documents.map((document) => ({
      id: document.id,
      label: document.interaction?.label || 'Documento registrado',
      detail: document.nombre,
      date: document.interaction?.date || document.created_at,
    })),
    ...notes.map((note) => ({
      id: note.id,
      label: 'Nota interna',
      detail: note.content,
      date: note.created_at,
    })),
  ]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 8);
  const documentMessage = documentsError
    ? 'No se pudo consultar el resumen documental.'
    : 'Cargando documentos…';

  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[110] bg-black/30 xl:hidden"
        onClick={onClose}
      />
      <aside
        ref={panel}
        aria-label={`Vista previa de ${name}`}
        className="fixed inset-y-0 right-0 z-[120] flex w-full max-w-sm flex-col border-l border-border bg-card shadow-xl xl:sticky xl:top-4 xl:z-auto xl:max-h-[calc(100dvh-var(--app-header-height)-1.5rem)] xl:w-[20rem] xl:shrink-0 xl:self-start xl:overflow-hidden xl:rounded-lg xl:border xl:shadow-sm 2xl:w-[22rem]"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border p-4">
          <ContactAvatar contact={contact} index={index} large />
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-base font-semibold leading-tight">{name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {contact.tipo_persona || 'Contacto'}
            </p>
            <div className="mt-1.5">
              <ContactFollowUpBadge summary={summary} />
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              aria-pressed={favorite}
              aria-label={favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
              disabled={!favoritesEnabled}
              onClick={onFavorite}
              className={`${contactButton} min-w-8 px-1.5 ${favorite ? 'text-amber-500' : 'text-muted-foreground'}`}
            >
              <Star size={16} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
            <button
              ref={closeButton}
              type="button"
              aria-label="Cerrar vista previa"
              onClick={onClose}
              className={`${contactButton} min-w-8 px-1.5 text-muted-foreground`}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div
          role="tablist"
          aria-label="Vista rápida del contacto"
          className="grid shrink-0 grid-cols-3 border-b border-border px-2"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = tabs.findIndex(({ id }) => id === tab);
            const next =
              tabs[
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
              ].id;
            setTab(next);
            panel.current
              ?.querySelector<HTMLButtonElement>(`[data-preview-tab="${next}"]`)
              ?.focus();
          }}
        >
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${tabId}-${id}`}
              data-preview-tab={id}
              aria-selected={tab === id}
              aria-controls={`${tabId}-panel`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              className={`border-b-2 px-1 py-3 text-xs font-medium focus-visible:outline-primary ${tab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`${tabId}-${tab}`}
          id={`${tabId}-panel`}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-muted/50 p-3"
        >
          {tab === 'informacion' && (
            <>
              {attention.length > 0 && (
                <section className={quickCard}>
                  <h3 className={`${cardTitle} flex items-center gap-2`}>
                    <CalendarClock size={16} className="text-primary" aria-hidden="true" /> Por
                    atender
                  </h3>
                  {summary.dueSoon > 0 && (
                    <p className="text-xs font-medium text-rose-700 dark:text-rose-300">
                      {summary.dueSoon}{' '}
                      {summary.dueSoon === 1 ? 'documento vence' : 'documentos vencen'} en las
                      próximas 72 horas
                    </p>
                  )}
                  <DocumentList documents={attention} />
                </section>
              )}
              <section className={quickCard}>
                <h3 className={cardTitle}>Datos de contacto</h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  {contact.email && (
                    <p className="flex items-start gap-2">
                      <Mail size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="break-all">{contact.email}</span>
                    </p>
                  )}
                  {contact.telefono && (
                    <p className="flex items-center gap-2">
                      <Phone size={14} className="shrink-0" aria-hidden="true" />
                      {contact.telefono}
                    </p>
                  )}
                  {contact.rfc && (
                    <p className="flex items-center gap-2">
                      <Hash size={14} className="shrink-0" aria-hidden="true" />
                      {contact.rfc}
                    </p>
                  )}
                  {!contact.email && !contact.telefono && !contact.rfc && (
                    <p>Sin datos de contacto registrados.</p>
                  )}
                </div>
              </section>
              <section className={quickCard}>
                <h3 className={cardTitle}>Resumen documental</h3>
                {documentsLoaded ? (
                  <dl className="grid grid-cols-3 gap-1 text-center">
                    {[
                      {
                        label: 'Compartidos',
                        value: summary.documents.length,
                        tone: 'text-primary',
                      },
                      {
                        label: 'Pendientes',
                        value: summary.pending,
                        tone: 'text-amber-700 dark:text-amber-300',
                      },
                      {
                        label: 'Completados',
                        value: summary.completed,
                        tone: 'text-emerald-700 dark:text-emerald-300',
                      },
                    ].map(({ label, value, tone }) => (
                      <div key={label} className="flex flex-col-reverse gap-0.5">
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">{documentMessage}</p>
                )}
              </section>
              {(tags.length > 0 || groups.length > 0) && (
                <section className={quickCard}>
                  <h3 className={cardTitle}>Grupos y etiquetas</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {groups.map((group) => (
                      <span
                        key={group}
                        className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs [overflow-wrap:anywhere]"
                      >
                        <Folder size={12} className="shrink-0" aria-hidden="true" />
                        {group}
                      </span>
                    ))}
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="max-w-full rounded-md bg-primary/10 px-2 py-1 text-xs text-primary [overflow-wrap:anywhere]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </section>
              )}
              {summary.lastInteraction && (
                <section className={quickCard}>
                  <h3 className={cardTitle}>Última interacción</h3>
                  <p className="break-words text-sm">
                    {summary.lastInteraction.label} · {summary.lastInteraction.documentName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatContactDate(summary.lastInteraction.date, true)}
                  </p>
                </section>
              )}
              {(contact.notas || notes[0]) && (
                <section className={quickCard}>
                  <h3 className={cardTitle}>Nota interna</h3>
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {notes[0]?.content || contact.notas}
                  </p>
                </section>
              )}
            </>
          )}
          {tab === 'documentos' && (
            <section className={quickCard}>
              <h3 className={cardTitle}>Documentos compartidos</h3>
              {summary.documents.length ? (
                <DocumentList documents={summary.documents} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {documentsLoaded
                    ? 'Este contacto aún no tiene documentos compartidos.'
                    : documentMessage}
                </p>
              )}
            </section>
          )}
          {tab === 'actividad' && (
            <section className={quickCard}>
              <h3 className={cardTitle}>Actividad reciente</h3>
              {(loadingNotes || notesError || documentsError) && (
                <p className="text-xs text-muted-foreground">
                  {loadingNotes ? 'Cargando notas…' : 'Parte de la actividad no está disponible.'}
                </p>
              )}
              {activity.length ? (
                <ul className="space-y-2.5">
                  {activity.map((item) => (
                    <li
                      key={item.id}
                      className="space-y-0.5 border-l-2 border-primary/20 pl-2.5 text-sm"
                    >
                      <p className="font-medium">{item.label}</p>
                      <p className="line-clamp-2 break-words text-muted-foreground">
                        {item.detail}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatContactDate(item.date, true)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                !loadingNotes && (
                  <p className="text-sm text-muted-foreground">Sin interacciones registradas.</p>
                )
              )}
            </section>
          )}
        </div>
        <footer className="shrink-0 border-t border-border p-3">
          <button type="button" className={`${contactPrimaryButton} w-full`} onClick={onOpen}>
            <IdCard size={16} aria-hidden="true" /> Ver contacto
          </button>
        </footer>
      </aside>
    </>
  );
}
