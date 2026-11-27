'use client';

import { useRef, useState, type FormEvent } from 'react';
import { CustomFilterIconGrid } from '@/components/filters/CustomFilterIconGrid';
import { createClient } from '@/lib/supabase/client';
import { CUSTOM_FILTER_ICON_OPTIONS } from '@/lib/filters/custom-filter-icons';
import {
  cleanContactGroupName,
  DEFAULT_CONTACT_GROUP_ICON,
  saveContactGroup,
  type ContactGroupIcon,
  type ContactGroupInfo,
} from '@/lib/contacts/groups';
import { ContactEditorDialog, contactControl } from './contact-detail-ui';

export function ContactGroupEditorDialog({
  group,
  userId,
  onSaved,
  onClose,
}: {
  group?: ContactGroupInfo;
  userId: string;
  onSaved: (saved: ContactGroupInfo) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [icon, setIcon] = useState<ContactGroupIcon>(group?.icon ?? DEFAULT_CONTACT_GROUP_ICON);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const normalizedName = cleanContactGroupName(name);
  const valid = Boolean(normalizedName && [...normalizedName].length <= 80);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await saveContactGroup(
        createClient(),
        userId,
        { name: normalizedName, icon },
        group?.id
      );
      onSaved(saved);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo guardar el grupo. Intenta de nuevo.'
      );
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <ContactEditorDialog
      title={group ? 'Editar grupo' : 'Crear grupo'}
      submitLabel={group ? 'Guardar cambios' : 'Crear grupo'}
      submitDisabled={!valid}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
    >
      <label className="block space-y-1.5 text-sm">
        <span className="block font-medium">Nombre del grupo</span>
        <input
          type="text"
          className={`${contactControl} w-full`}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError('');
          }}
          placeholder="Ej. Proveedores frecuentes"
          maxLength={80}
          autoFocus
          required
        />
      </label>
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Ícono <span className="font-normal">({CUSTOM_FILTER_ICON_OPTIONS.length} opciones)</span>
        </p>
        <CustomFilterIconGrid value={icon} onSelect={setIcon} />
      </div>
    </ContactEditorDialog>
  );
}
