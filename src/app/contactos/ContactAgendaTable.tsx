'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Eye, FileText, Flag, IdCard, Mail, Phone, Star, Trash2 } from 'lucide-react';
import { WorkspaceRowActions, type WorkspaceRowAction } from '@/components/WorkspaceRowActions';
import ResizableTableHeader from '@/components/workspaces/ResizableTableHeader';
import TableScrollArea from '@/components/workspaces/TableScrollArea';
import { TableSortButton } from '@/components/workspaces/TableSortButton';
import type { ColumnMovement } from '@/components/workspaces/useColumnReorder';
import {
  tableAriaSort,
  tableDate,
  type ListDirection,
  type TableSortValue,
} from '@/lib/workspaces/list-order';
import {
  contactAvatarColors,
  contactInitials,
  contactName,
  contactTags,
  formatContactDate,
  type AgendaContact,
  type ContactSummary,
} from '@/lib/contacts/agenda';
import {
  CONTACT_COLUMN_MAX_WIDTH,
  CONTACT_COLUMN_WIDTHS,
  contactColumnMinWidth,
  type ContactColumnId,
  type ContactColumnWidths,
  type ContactFieldId,
} from '@/lib/contacts/view-preferences';
import { contactCard } from './contact-detail-ui';

export type ContactAgendaRow = {
  contact: AgendaContact;
  index: number;
  groups: string[];
  summary: ContactSummary;
  favorite: boolean;
};

export type ContactSort = { column: ContactColumnId; direction: ListDirection };

export const contactSortColumns: Partial<
  Record<
    ContactColumnId,
    { defaultDirection: ListDirection; value: (row: ContactAgendaRow) => TableSortValue }
  >
> = {
  contacto: { defaultDirection: 'asc', value: ({ contact }) => contactName(contact) },
  documentos: { defaultDirection: 'desc', value: ({ summary }) => summary.documents.length },
  pendientes: { defaultDirection: 'desc', value: ({ summary }) => summary.pending },
  seguimiento: {
    defaultDirection: 'desc',
    value: ({ summary }) => {
      if (!summary.followUp) return null;
      return summary.followUp === 'urgent' ? 2 : 1;
    },
  },
  actividad: {
    defaultDirection: 'desc',
    value: ({ summary }) => tableDate(summary.documents[0]?.created_at),
  },
  vencimiento: {
    defaultDirection: 'asc',
    value: ({ summary }) => tableDate(summary.nextDue?.dueAt),
  },
  interaccion: {
    defaultDirection: 'desc',
    value: ({ summary }) => tableDate(summary.lastInteraction?.date),
  },
  correo: { defaultDirection: 'asc', value: ({ contact }) => contact.email },
  tipo: { defaultDirection: 'asc', value: ({ contact }) => contact.tipo_persona },
  alta: { defaultDirection: 'desc', value: ({ contact }) => tableDate(contact.created_at) },
};

type ContactAgendaActions = {
  favoritesEnabled: boolean;
  onPreview: (contact: AgendaContact) => void;
  onOpen: (contact: AgendaContact) => void;
  onFavorite: (contact: AgendaContact) => void;
  onDelete: (contact: AgendaContact) => void;
};
type Field = { id: ContactFieldId; label: string };

export function ContactAvatar({
  contact,
  index,
  large = false,
}: {
  contact: AgendaContact;
  index: number;
  large?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${large ? 'size-11 text-sm' : 'size-9 text-xs'} ${contactAvatarColors[index % contactAvatarColors.length]}`}
    >
      {contactInitials(contact)}
    </span>
  );
}

export function ContactFollowUpBadge({ summary }: { summary: ContactSummary }) {
  if (!summary.followUp) return null;
  const urgent = summary.followUp === 'urgent';
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${urgent ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {urgent ? 'Urgente' : 'En seguimiento'}
    </span>
  );
}

function ContactIdentity({
  row,
  onOpen,
}: {
  row: ContactAgendaRow;
  onOpen: ContactAgendaActions['onOpen'];
}) {
  const name = contactName(row.contact);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ContactAvatar contact={row.contact} index={row.index} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title={name}
            className="min-w-0 truncate rounded-sm text-left font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
            onClick={() => onOpen(row.contact)}
          >
            {name}
          </button>
          {row.favorite && (
            <span
              role="img"
              aria-label="Favorito"
              title="Favorito"
              className="shrink-0 text-yellow-400"
            >
              <Star size={12} fill="currentColor" aria-hidden="true" />
            </span>
          )}
          {row.summary.followUp === 'urgent' && (
            <span
              role="img"
              aria-label="Seguimiento urgente"
              title="Seguimiento urgente"
              className="shrink-0 text-red-500"
            >
              <Flag size={12} strokeWidth={2.25} aria-hidden="true" />
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {row.contact.tipo_persona || 'Contacto'}
        </p>
      </div>
    </div>
  );
}

function contactValues(
  row: ContactAgendaRow,
  documentsLoaded: boolean
): Record<ContactFieldId, ReactNode> {
  const { contact, groups, summary } = row;
  const tags = contactTags(contact);
  const latestDocument = summary.documents[0];
  const nextDue = summary.nextDue;
  const lastInteraction = summary.lastInteraction;
  const shortNames = (names: string[]) =>
    names.length ? (
      <span title={names.join(', ')} className="block max-w-[13rem] truncate">
        {names.join(', ')}
      </span>
    ) : null;
  return {
    datos:
      contact.email || contact.telefono ? (
        <div className="space-y-1">
          {contact.email && (
            <p className="flex items-center gap-1.5">
              <Mail size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{contact.email}</span>
            </p>
          )}
          {contact.telefono && (
            <p className="flex items-center gap-1.5">
              <Phone size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{contact.telefono}</span>
            </p>
          )}
        </div>
      ) : null,
    etiquetas: tags.length ? (
      <div className="flex flex-wrap items-center gap-1">
        {tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            title={tag}
            className="max-w-[11rem] truncate rounded-md border border-primary/10 bg-primary/5 px-1.5 py-0.5 text-[11px] text-primary"
          >
            {tag}
          </span>
        ))}
        {tags.length > 2 && (
          <span title={tags.slice(2).join(', ')} className="text-xs text-muted-foreground">
            +{tags.length - 2}
          </span>
        )}
      </div>
    ) : null,
    documentos: documentsLoaded ? (
      <div>
        <p className="flex items-center gap-1.5">
          <FileText size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          {summary.documents.length} {summary.documents.length === 1 ? 'documento' : 'documentos'}
        </p>
        <p
          className={`mt-1 pl-[19px] ${summary.pending ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}
        >
          {summary.pending} {summary.pending === 1 ? 'pendiente' : 'pendientes'}
        </p>
      </div>
    ) : null,
    seguimiento: summary.followUp ? <ContactFollowUpBadge summary={summary} /> : null,
    actividad: latestDocument ? (
      <div>
        <p className="max-w-[11rem] truncate" title={latestDocument.nombre}>
          {latestDocument.nombre}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {formatContactDate(latestDocument.created_at)}
        </p>
      </div>
    ) : null,
    grupo: shortNames(groups),
    pendientes: documentsLoaded ? summary.pending : null,
    vencimiento: nextDue?.dueAt ? (
      <div>
        <p
          className={
            nextDue.dueSoon ? 'font-medium text-rose-700 dark:text-rose-300' : 'font-medium'
          }
        >
          {formatContactDate(nextDue.dueAt, true)}
        </p>
        <p className="max-w-[13rem] truncate text-muted-foreground" title={nextDue.nombre}>
          {nextDue.nombre}
        </p>
      </div>
    ) : null,
    interaccion: lastInteraction ? (
      <div>
        <p className="font-medium" title={lastInteraction.documentName}>
          {lastInteraction.label}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {formatContactDate(lastInteraction.date, true)}
        </p>
      </div>
    ) : null,
    correo: contact.email ? (
      <span className="[overflow-wrap:anywhere]">{contact.email}</span>
    ) : null,
    telefono: contact.telefono,
    tipo: contact.tipo_persona,
    rfc: contact.rfc,
    alta: formatContactDate(contact.created_at),
  };
}

function ContactRowControls({
  row,
  active,
  actions,
}: {
  row: ContactAgendaRow;
  active: boolean;
  actions: ContactAgendaActions;
}) {
  const name = contactName(row.contact);
  const entries: WorkspaceRowAction[] = [
    { label: 'Ver contacto', icon: IdCard, onSelect: () => actions.onOpen(row.contact) },
    {
      label: row.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos',
      icon: Star,
      iconClassName: row.favorite ? 'text-amber-500' : undefined,
      fillIcon: row.favorite,
      disabled: !actions.favoritesEnabled,
      onSelect: () => actions.onFavorite(row.contact),
    },
    {
      label: 'Eliminar contacto',
      icon: Trash2,
      iconClassName: 'text-destructive',
      onSelect: () => actions.onDelete(row.contact),
    },
  ];
  return (
    <div className="flex shrink-0 items-center justify-center gap-1">
      <button
        type="button"
        title="Vista rápida"
        aria-label={`Vista rápida de ${name}`}
        aria-pressed={active}
        onClick={() => actions.onPreview(row.contact)}
        className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
      >
        <Eye size={16} aria-hidden="true" />
      </button>
      <WorkspaceRowActions
        title={name}
        actions={entries}
        className="[&>button]:grid [&>button]:size-7 [&>button]:place-items-center"
      />
    </div>
  );
}

const actionsWidth = 88;

export function ContactAgendaTable({
  rows,
  fields,
  documentsLoaded,
  previewId,
  actions,
  widths,
  sort,
  onSort,
  columnMovement,
  onResizeColumn,
}: {
  rows: ContactAgendaRow[];
  fields: Field[];
  documentsLoaded: boolean;
  previewId: string | null;
  actions: ContactAgendaActions;
  widths: ContactColumnWidths;
  sort: ContactSort;
  onSort: (sort: ContactSort) => void;
  columnMovement?: (id: ContactColumnId, label: string) => ColumnMovement | undefined;
  onResizeColumn?: (id: ContactColumnId, width: number) => void;
}) {
  const [draft, setDraft] = useState<{ id: ContactColumnId; width: number } | null>(null);
  const columns: { id: ContactColumnId; label: string }[] = [
    { id: 'contacto', label: 'Contacto' },
    ...fields,
  ];
  const sizes = columns.map(({ id }) =>
    draft?.id === id ? draft.width : (widths[id] ?? CONTACT_COLUMN_WIDTHS[id])
  );
  const minWidth = sizes.reduce((total, width) => total + width, actionsWidth);

  return (
    <TableScrollArea label="Tabla de contactos" className={`${contactCard} overflow-hidden`}>
      <table
        className="responsive-data-table w-full border-separate border-spacing-0 text-left text-sm xl:min-w-[var(--contact-table-min-width)] xl:table-fixed"
        style={{ '--contact-table-min-width': `${minWidth}px` } as CSSProperties}
      >
        <caption className="sr-only">Contactos de tu agenda</caption>
        <colgroup>
          {columns.map(({ id }, index) => (
            <col key={id} style={{ width: sizes[index] }} />
          ))}
          <col style={{ width: actionsWidth }} />
        </colgroup>
        <thead className="workspace-table-heading">
          <tr className="[&>th]:border-b [&>th]:border-border [&>th]:py-3">
            {columns.map(({ id, label }, index) => {
              const ordering = contactSortColumns[id];
              const direction = sort.column === id ? sort.direction : undefined;
              return (
                <ResizableTableHeader
                  key={id}
                  colKey={id}
                  movement={columnMovement?.(id, label)}
                  width={sizes[index]}
                  minWidth={contactColumnMinWidth(id)}
                  maxWidth={CONTACT_COLUMN_MAX_WIDTH}
                  resizeLabel={`Ajustar ancho de ${label}`}
                  ariaSort={ordering ? tableAriaSort(direction) : undefined}
                  onResize={onResizeColumn && ((key, width) => setDraft({ id: key, width }))}
                  onResizeEnd={(key, width) => {
                    setDraft(null);
                    onResizeColumn?.(key, width);
                  }}
                  className={id === 'contacto' ? 'pl-4 pr-3' : 'px-3'}
                >
                  {ordering ? (
                    <TableSortButton
                      label={label}
                      direction={direction}
                      defaultDirection={ordering.defaultDirection}
                      onSort={(direction) => onSort({ column: id, direction })}
                    />
                  ) : (
                    <span className="block truncate" title={label}>
                      {label}
                    </span>
                  )}
                </ResizableTableHeader>
              );
            })}
            <th scope="col" className="workspace-table-actions">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const values = contactValues(row, documentsLoaded);
            const selected = previewId === row.contact.id;
            return (
              <tr
                key={row.contact.id}
                className={`group xl:[&:not(:last-child)>*]:border-b xl:[&:not(:last-child)>*]:border-border ${selected ? 'xl:bg-primary/5' : 'xl:hover:bg-muted/45'}`}
              >
                <th
                  scope="row"
                  className={`border-l-2 px-4 py-3 text-left font-normal ${selected ? 'border-l-primary' : 'border-l-transparent'}`}
                >
                  <ContactIdentity row={row} onOpen={actions.onOpen} />
                </th>
                {fields.map((field) => (
                  <td
                    key={field.id}
                    data-label={field.label}
                    className="px-3 py-3 text-xs font-normal text-muted-foreground [overflow-wrap:anywhere] [&_.font-medium]:font-normal"
                  >
                    <div className="min-w-0">
                      {values[field.id] ?? <span className="text-muted-foreground">—</span>}
                    </div>
                  </td>
                ))}
                <td
                  data-label="Acciones"
                  className="workspace-table-actions py-2 align-middle"
                >
                  <ContactRowControls row={row} active={selected} actions={actions} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScrollArea>
  );
}

export function ContactAgendaCard({
  row,
  fields,
  documentsLoaded,
  actions,
  active,
}: {
  row: ContactAgendaRow;
  fields: Field[];
  documentsLoaded: boolean;
  actions: ContactAgendaActions;
  active: boolean;
}) {
  const values = contactValues(row, documentsLoaded);
  const available = fields.filter(({ id }) => values[id] != null);
  return (
    <article className={`${contactCard} flex min-w-0 flex-col`}>
      <div className="flex items-start justify-between gap-2 p-4">
        <ContactIdentity row={row} onOpen={actions.onOpen} />
        <ContactRowControls row={row} active={active} actions={actions} />
      </div>
      {available.length > 0 && (
        <dl className="space-y-3 border-t border-border px-4 py-3 text-xs">
          {available.map(({ id, label }) => (
            <div
              key={id}
              className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-2.5"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">{values[id]}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
