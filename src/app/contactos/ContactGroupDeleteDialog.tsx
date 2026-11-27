'use client';

import { useRef, useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  deleteContactGroup,
  type ContactGroup,
  type ContactGroupInfo,
} from '@/lib/contacts/groups';
import { ContactEditorDialog, contactControl } from './contact-detail-ui';

export function ContactGroupDeleteDialog({
  group,
  destinations,
  onDeleted,
  onClose,
}: {
  group: ContactGroup;
  destinations: ContactGroupInfo[];
  onDeleted: (destination?: ContactGroupInfo) => void;
  onClose: () => void;
}) {
  const [destinationId, setDestinationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const destination = destinations.find(({ id }) => id === destinationId);
  const count = group.members.length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writing.current || (destinationId && !destination)) return;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await deleteContactGroup(createClient(), group.id, destination?.id);
      onDeleted(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el grupo.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <ContactEditorDialog
      title="Eliminar grupo"
      submitLabel={destination ? 'Reasignar y eliminar' : 'Eliminar grupo'}
      busyLabel="Eliminando…"
      destructive
      submitDisabled={Boolean(destinationId && !destination)}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
    >
      <p className="text-sm text-muted-foreground">
        Se eliminará <strong className="font-semibold text-foreground">{group.name}</strong>.{' '}
        {count === 0
          ? 'El grupo está vacío.'
          : count === 1
            ? 'Hay un contacto asignado.'
            : `Hay ${count} contactos asignados.`}
      </p>
      {count > 0 && (
        <>
          <label className="block space-y-1.5 text-sm">
            <span className="block font-medium">Asignación de los contactos</span>
            <select
              className={`${contactControl} w-full`}
              value={destinationId}
              onChange={(event) => {
                setDestinationId(event.target.value);
                setError('');
              }}
            >
              <option value="">Quitar la asignación de este grupo</option>
              {destinations.map(({ id, name, icon }) => (
                <option key={id} value={id}>
                  Reasignar a {icon} {name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">Los contactos se conservan en tu agenda.</p>
        </>
      )}
    </ContactEditorDialog>
  );
}
