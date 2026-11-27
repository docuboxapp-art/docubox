'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Plus, Users, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  assignContactToGroup,
  removeContactGroupAssignment,
  type ContactGroup,
  type ContactGroupChange,
  type ContactGroups,
} from '@/lib/contacts/groups';
import { ContactGroupEditorDialog } from './ContactGroupEditorDialog';
import {
  ContactEditorDialog,
  ContactPanelHeading,
  contactButton,
  contactCard,
  contactControl,
} from './contact-detail-ui';

export function ContactGroupsPanel({
  contactId,
  userId,
  collection,
  loadError,
  onRetry,
  onChange,
  onRemoved,
}: {
  contactId: string;
  userId?: string;
  collection: ContactGroups | null;
  loadError: boolean;
  onRetry: () => void;
  onChange: (change: ContactGroupChange) => void;
  onRemoved: (name: string) => void;
}) {
  const [dialog, setDialog] = useState<'create' | 'assign' | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [panelError, setPanelError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const writing = useRef(false);
  const assigned = (collection?.groups ?? []).filter((group) =>
    group.members.some((member) => member.contactId === contactId)
  );
  const assignedIds = new Set(assigned.map((group) => group.id));
  const available = (collection?.groups ?? []).filter((group) => !assignedIds.has(group.id));
  const selection = available.find((group) => group.id === value);

  function open(mode: 'create' | 'assign', groupId = '') {
    setDialog(mode);
    setValue(groupId);
    setDialogError('');
    setPanelError('');
    setConfirmation('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !selection || writing.current) return;
    writing.current = true;
    setBusy(true);
    setDialogError('');
    try {
      const change = await assignContactToGroup(createClient(), userId, contactId, selection);
      onChange(change);
      setDialog(null);
      setConfirmation('Contacto asignado al grupo.');
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'No se pudo guardar el grupo.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function remove(group: ContactGroup) {
    if (!collection || !userId || writing.current) return;
    writing.current = true;
    setBusy(true);
    setPanelError('');
    setConfirmation('');
    try {
      const change = await removeContactGroupAssignment(
        createClient(),
        userId,
        contactId,
        group.id
      );
      onChange(change);
      onRemoved(group.name);
      setConfirmation('Contacto retirado del grupo.');
    } catch {
      setPanelError('No se pudo quitar al contacto del grupo. Intenta de nuevo.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={contactCard} aria-label="Grupos de contactos">
      <ContactPanelHeading icon={Users} title="Grupos de contactos" />
      <div className="space-y-2.5 p-4">
        {!collection && !loadError && (
          <p role="status" className="text-sm text-muted-foreground">
            Cargando grupos…
          </p>
        )}
        {loadError && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <p role="alert" className="text-destructive">
              No se pudieron consultar los grupos.
            </p>
            <button type="button" onClick={onRetry} className="font-medium text-primary">
              Reintentar
            </button>
          </div>
        )}
        {collection &&
          (assigned.length ? (
            <ul className="space-y-2">
              {assigned.map((group) => (
                <li
                  key={group.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/65 py-1 pl-3 pr-1 text-sm"
                >
                  <span className="shrink-0 text-base" aria-hidden="true">
                    {group.icon}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{group.name}</span>
                  <button
                    type="button"
                    onClick={() => void remove(group)}
                    disabled={busy}
                    aria-label={`Quitar del grupo ${group.name}`}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Este contacto aún no pertenece a un grupo.
            </p>
          ))}
        {panelError && (
          <p role="alert" className="text-xs text-destructive">
            {panelError}
          </p>
        )}
        <p role="status" className="sr-only">
          {confirmation}
        </p>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => open('assign')}
            disabled={!collection || !userId || busy}
            className={`${contactButton} px-2 text-xs text-primary`}
          >
            <Plus size={14} className="shrink-0" aria-hidden="true" />
            Asignar a grupo
          </button>
          <button
            type="button"
            onClick={() => open('create')}
            disabled={!collection || !userId || busy}
            className={`${contactButton} px-2 text-xs text-primary`}
          >
            <Users size={14} className="shrink-0" aria-hidden="true" />
            Crear grupo
          </button>
        </div>
      </div>
      {dialog === 'create' && collection && userId && (
        <ContactGroupEditorDialog
          userId={userId}
          onClose={() => setDialog(null)}
          onSaved={(group) => {
            onChange({ group });
            open('assign', group.id);
            setConfirmation('Grupo creado. Puedes asignarlo al contacto.');
          }}
        />
      )}
      {dialog === 'assign' && (
        <ContactEditorDialog
          title="Asignar a grupo"
          submitLabel="Asignar grupo"
          submitDisabled={!selection}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(event) => void save(event)}
        >
          {available.length ? (
            <label className="block space-y-1.5 text-sm">
              <span className="block font-medium">Grupo existente</span>
              <select
                className={`${contactControl} w-full`}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setDialogError('');
                }}
                autoFocus
                required
              >
                <option value="">Selecciona un grupo</option>
                {available.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.icon} {group.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {collection?.groups.length
                  ? 'Este contacto ya está en todos los grupos de tu agenda.'
                  : 'Todavía no tienes grupos en tu agenda.'}
              </p>
              <button
                type="button"
                onClick={() => open('create')}
                className={`${contactButton} text-primary`}
              >
                <Plus size={14} aria-hidden="true" /> Crear grupo
              </button>
            </div>
          )}
        </ContactEditorDialog>
      )}
    </section>
  );
}
