'use client';

import { BottomNotice } from '@/components/ui/BottomNotice';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { ArrowUpRight, Link2, ListPlus, Pencil, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  CONTACT_FIELD,
  CONTACT_FIELD_COLUMNS,
  CONTACT_FIELD_OPTION_LENGTH,
  CONTACT_FIELD_OPTION_LIMIT,
  CONTACT_RELATION_PREFIX,
  CONTACT_SECTION,
  canKeepContactFieldValue,
  contactFieldChoiceTypes,
  contactFieldCurrencies,
  contactFieldTypes,
  getContactFieldValue,
  normalizeContactFieldValue,
  readContactField,
  readContactRelationship,
  type ContactField,
  type ContactFieldDefinition,
  type ContactFieldRow,
  type ContactRelationship,
} from '@/lib/contacts/detail';
import {
  ContactEditorDialog,
  ContactPanelHeading,
  contactButton,
  contactCard,
  contactControl,
  contactPrimaryButton,
} from './contact-detail-ui';
import { ContactFieldControl, type RelatedContactOption } from './ContactFieldControl';

type Props = {
  contactId: string;
  userId: string;
  rows: ContactFieldRow[];
  onSaved: (row: ContactFieldRow) => void;
};

export type { RelatedContactOption } from './ContactFieldControl';

const labelClass = 'grid gap-1.5 text-sm font-medium text-foreground';
const normalizeLabel = (value: string) => value.trim().toLocaleLowerCase('es-MX');

class ContactFieldConflict extends Error {
  constructor(readonly latest: ContactFieldRow | null) {
    super('El campo cambió en otra vista. Revisa la información antes de guardar.');
  }
}

async function saveField(
  { contactId, userId }: Pick<Props, 'contactId' | 'userId'>,
  id: string,
  name: string,
  value: string,
  version?: string
) {
  const table = createClient().from('contact_custom_fields');
  const failure = 'No se pudo guardar el cambio. Intenta nuevamente.';
  if (version) {
    const { data, error } = await table
      .update({ field_value: value })
      .eq('id', id)
      .eq('field_name', name)
      .eq('contact_id', contactId)
      .eq('user_id', userId)
      .eq('updated_at', version)
      .select(CONTACT_FIELD_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(failure);
    if (data) return data as ContactFieldRow;
  } else {
    const { data, error } = await table
      .upsert(
        { id, contact_id: contactId, user_id: userId, field_name: name, field_value: value },
        { onConflict: 'id', ignoreDuplicates: true }
      )
      .select(CONTACT_FIELD_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(failure);
    if (data) return data as ContactFieldRow;
  }

  // A previous attempt may have saved successfully before its response was lost.
  const existing = await table
    .select(CONTACT_FIELD_COLUMNS)
    .eq('id', id)
    .eq('contact_id', contactId)
    .eq('user_id', userId)
    .eq('field_name', name)
    .maybeSingle();
  if (existing.error) throw new Error(failure);
  const latest = existing.data as ContactFieldRow | null;
  if (latest?.field_value === value || (latest && !version)) return latest;
  throw new ContactFieldConflict(latest);
}

type Editor =
  | { mode: 'section'; id: string; label: string; version?: string }
  | {
      mode: 'field';
      id: string;
      definition: ContactFieldDefinition;
      optionText: string;
      version?: string;
    };

type ParsedFieldRow = ContactFieldRow & { field: ContactField };
type SectionRow = ContactFieldRow & { label: string };
type FieldDraft = { value: string; version: string };

function ContactSection({
  section,
  fields,
  contacts,
  contactIds,
  unavailable,
  openEditor,
  ...props
}: Omit<Props, 'rows'> & {
  section: SectionRow;
  fields: ParsedFieldRow[];
  contacts: RelatedContactOption[];
  contactIds: ReadonlySet<string>;
  unavailable: boolean;
  openEditor: (editor: Editor) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const changes = fields.flatMap((row) => (drafts[row.id] ? [{ row, draft: drafts[row.id] }] : []));

  function change(row: ParsedFieldRow, value: string) {
    setNotice(null);
    setDrafts((current) => {
      const next = { ...current };
      if (value === getContactFieldValue(row.field)) delete next[row.id];
      else next[row.id] = { value, version: current[row.id]?.version ?? row.updated_at };
      return next;
    });
  }

  async function submitValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changes.length || busy || unavailable) return;
    const values: string[] = [];
    for (const { row, draft } of changes) {
      if (draft.version !== row.updated_at) {
        setNotice({
          text: `«${row.field.label}» cambió. Cancela la captura y revisa su valor actual.`,
          error: true,
        });
        return;
      }
      try {
        values.push(normalizeContactFieldValue(row.field, draft.value, contactIds));
      } catch (error) {
        setNotice({
          text: `«${row.field.label}». ${error instanceof Error ? error.message : 'Revisa el valor.'}`,
          error: true,
        });
        return;
      }
    }

    setBusy(true);
    setNotice(null);
    const results = await Promise.allSettled(
      changes.map(({ row, draft }, index) =>
        saveField(
          props,
          row.id,
          CONTACT_FIELD,
          JSON.stringify({ ...row.field, value: values[index], captured: true }),
          draft.version
        )
      )
    );
    const savedIds = new Set<string>();
    let conflict = false;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        savedIds.add(result.value.id);
        props.onSaved(result.value);
      } else if (result.reason instanceof ContactFieldConflict) {
        conflict = true;
        if (result.reason.latest) props.onSaved(result.reason.latest);
      }
    }
    setDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !savedIds.has(id)))
    );
    const failed = changes.length - savedIds.size;
    setNotice(
      failed
        ? {
            text: conflict
              ? 'Un campo cambió en otra vista. Cancela la captura pendiente y revisa los datos actuales.'
              : 'Quedaron datos por guardar. Vuelve a intentar con los cambios pendientes.',
            error: true,
          }
        : { text: 'Datos guardados.' }
    );
    setBusy(false);
  }

  return (
    <section aria-label={section.label} className={contactCard}>
      <ContactPanelHeading icon={ListPlus} title={section.label}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={contactButton}
            disabled={unavailable || busy}
            aria-label={`Editar sección ${section.label}`}
            onClick={() =>
              openEditor({
                mode: 'section',
                id: section.id,
                label: section.label,
                version: section.updated_at,
              })
            }
          >
            <Pencil size={14} className="text-primary" aria-hidden="true" /> Editar
          </button>
          <button
            type="button"
            className={contactButton}
            disabled={unavailable || busy}
            aria-label={`Agregar campo en ${section.label}`}
            onClick={() =>
              openEditor({
                mode: 'field',
                id: crypto.randomUUID(),
                definition: { sectionId: section.id, label: '', type: 'text' },
                optionText: '',
              })
            }
          >
            <Plus size={15} className="text-primary" aria-hidden="true" /> Agregar campo
          </button>
        </div>
      </ContactPanelHeading>
      {fields.length ? (
        <form onSubmit={(event) => void submitValues(event)} aria-busy={busy}>
          <fieldset
            disabled={unavailable || busy}
            className="grid min-w-0 gap-x-4 gap-y-3 p-4 sm:p-5 md:grid-cols-2"
          >
            <legend className="sr-only">Datos de {section.label}</legend>
            {fields.map((row) => {
              const { field, id } = row;
              const draft = drafts[id];
              const value = draft?.value ?? getContactFieldValue(field);
              const fullWidth = field.type === 'multiline' || field.type === 'address';
              return (
                <div key={id} className={fullWidth ? 'md:col-span-2' : undefined}>
                  <ContactFieldControl
                    field={field}
                    value={value}
                    contacts={contacts}
                    onChange={(next) => change(row, next)}
                    action={
                      <button
                        type="button"
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-40"
                        disabled={Boolean(draft)}
                        aria-label={`Editar campo ${field.label}`}
                        title={
                          draft
                            ? 'Guarda o cancela los datos para editar el campo'
                            : 'Configurar campo'
                        }
                        onClick={() =>
                          openEditor({
                            mode: 'field',
                            id,
                            definition: field,
                            optionText: field.options?.join('\n') ?? '',
                            version: row.updated_at,
                          })
                        }
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    }
                  />
                </div>
              );
            })}
          </fieldset>
          {notice && (
            <BottomNotice
              message={notice.text}
              tone={notice.error ? 'critical' : 'success'}
              onClose={() => setNotice(null)}
            />
          )}
          {changes.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
              <button
                type="button"
                className={contactButton}
                disabled={busy}
                onClick={() => {
                  setDrafts({});
                  setNotice(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={contactPrimaryButton}
                disabled={unavailable || busy}
              >
                {busy ? 'Guardando datos…' : 'Guardar datos'}
              </button>
            </div>
          )}
        </form>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">Esta sección aún no tiene campos.</p>
      )}
    </section>
  );
}

export function ContactCustomInformation(
  props: Props & { unavailable: boolean; contacts: RelatedContactOption[] }
) {
  const { contactId, userId, rows, onSaved, unavailable } = props;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const typeId = useId();
  const currencyId = useId();
  const contacts = props.contacts.filter((contact) => contact.id !== contactId);
  const contactIds = new Set(contacts.map((contact) => contact.id));
  const sections = rows
    .flatMap((row) => {
      const label = row.field_value?.trim();
      return row.field_name === CONTACT_SECTION && label ? [{ ...row, label }] : [];
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const fields = rows
    .flatMap((row) => {
      const field = readContactField(row);
      return field ? [{ ...row, field }] : [];
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  function open(next: Editor) {
    setError('');
    setEditor(next);
  }

  function readOptions(draft: Extract<Editor, { mode: 'field' }>) {
    return [
      ...new Set(
        draft.optionText
          .split(/\r?\n/)
          .map((option) => option.trim())
          .filter(Boolean)
      ),
    ];
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy || unavailable) return;
    const label = (editor.mode === 'section' ? editor.label : editor.definition.label).trim();
    if (!label) {
      setError('Escribe un nombre.');
      return;
    }
    const duplicate =
      editor.mode === 'section'
        ? sections.some(
            (row) => row.id !== editor.id && normalizeLabel(row.label) === normalizeLabel(label)
          )
        : fields.some(
            (row) =>
              row.id !== editor.id &&
              row.field.sectionId === editor.definition.sectionId &&
              normalizeLabel(row.field.label) === normalizeLabel(label)
          );
    if (duplicate) {
      setError(
        editor.mode === 'section'
          ? 'Ya existe una sección con ese nombre.'
          : 'La sección ya tiene un campo con ese nombre.'
      );
      return;
    }
    let content = label;
    if (editor.mode === 'field') {
      const { sectionId, type, defaultValue, currency } = editor.definition;
      if (!sections.some((row) => row.id === sectionId)) {
        setError('La sección ya no está disponible.');
        return;
      }
      const definition: ContactFieldDefinition = { sectionId, label, type };
      if (contactFieldChoiceTypes.has(type)) {
        const options = readOptions(editor);
        if (
          !options.length ||
          options.length > CONTACT_FIELD_OPTION_LIMIT ||
          options.some((option) => option.length > CONTACT_FIELD_OPTION_LENGTH)
        ) {
          setError(
            `Escribe entre 1 y ${CONTACT_FIELD_OPTION_LIMIT} opciones de hasta ${CONTACT_FIELD_OPTION_LENGTH} caracteres.`
          );
          return;
        }
        definition.options = options;
      }
      if (type === 'currency') definition.currency = currency ?? 'MXN';
      try {
        const normalized = normalizeContactFieldValue(definition, defaultValue ?? '', contactIds);
        if (normalized) definition.defaultValue = normalized;
      } catch (err) {
        setError(
          `Valor predeterminado. ${err instanceof Error ? err.message : 'Revisa el valor.'}`
        );
        return;
      }
      const current = fields.find((row) => row.id === editor.id);
      if (current && !canKeepContactFieldValue(current.field, definition, contactIds)) {
        setError(
          'La configuración es incompatible con el dato guardado. Ajusta o vacía ese dato en la ficha antes de guardar el cambio.'
        );
        return;
      }
      content = JSON.stringify({
        ...definition,
        value: current?.field.value ?? '',
        captured: current?.field.captured ?? false,
      });
    }
    setBusy(true);
    setError('');
    try {
      const saved = await saveField(
        props,
        editor.id,
        editor.mode === 'section' ? CONTACT_SECTION : CONTACT_FIELD,
        content,
        editor.version
      );
      onSaved(saved);
      setEditor(null);
    } catch (err) {
      if (err instanceof ContactFieldConflict) {
        if (err.latest) onSaved(err.latest);
        setError('La configuración cambió. Cierra la ventana y vuelve a editarla.');
      } else {
        setError('No se pudo guardar. Intenta nuevamente.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!sections.length && (
        <section className={contactCard}>
          <ContactPanelHeading icon={ListPlus} title="Información adicional" />
          <p className="p-4 text-sm text-muted-foreground">
            {unavailable
              ? 'La información adicional no está disponible.'
              : 'Aún no hay secciones personalizadas.'}
          </p>
        </section>
      )}
      {sections.map((section) => (
        <ContactSection
          key={section.id}
          section={section}
          fields={fields.filter(({ field }) => field.sectionId === section.id)}
          contacts={contacts}
          contactIds={contactIds}
          contactId={contactId}
          userId={userId}
          onSaved={onSaved}
          unavailable={unavailable}
          openEditor={open}
        />
      ))}
      <div className="flex justify-end">
        <button
          type="button"
          className={contactButton}
          disabled={unavailable}
          onClick={() => open({ mode: 'section', id: crypto.randomUUID(), label: '' })}
        >
          <Plus size={15} className="text-primary" aria-hidden="true" /> Agregar sección
        </button>
      </div>
      {editor && (
        <ContactEditorDialog
          title={
            editor.mode === 'section'
              ? editor.version
                ? 'Editar sección'
                : 'Agregar sección'
              : editor.version
                ? 'Editar campo'
                : 'Agregar campo'
          }
          onClose={() => setEditor(null)}
          onSubmit={(event) => void submit(event)}
          busy={busy}
          error={error}
        >
          <label className={labelClass}>
            {editor.mode === 'section' ? 'Nombre de la sección' : 'Nombre del campo'}
            <input
              required
              maxLength={80}
              autoFocus
              className={contactControl}
              value={editor.mode === 'section' ? editor.label : editor.definition.label}
              onChange={(event) =>
                setEditor(
                  editor.mode === 'section'
                    ? { ...editor, label: event.target.value }
                    : { ...editor, definition: { ...editor.definition, label: event.target.value } }
                )
              }
            />
          </label>
          {editor.mode === 'field' && (
            <>
              <div className={labelClass}>
                <label htmlFor={typeId}>Tipo de campo</label>
                <select
                  id={typeId}
                  className={contactControl}
                  value={editor.definition.type}
                  onChange={(event) => {
                    const type = event.target.value as ContactFieldDefinition['type'];
                    setEditor({
                      ...editor,
                      definition: {
                        sectionId: editor.definition.sectionId,
                        label: editor.definition.label,
                        type,
                      },
                      optionText: contactFieldChoiceTypes.has(type) ? editor.optionText : '',
                    });
                  }}
                >
                  {Object.entries(contactFieldTypes).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {editor.definition.type === 'currency' && (
                <div className={labelClass}>
                  <label htmlFor={currencyId}>Moneda</label>
                  <select
                    id={currencyId}
                    className={contactControl}
                    value={editor.definition.currency ?? 'MXN'}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        definition: {
                          ...editor.definition,
                          currency: event.target.value as ContactFieldDefinition['currency'],
                        },
                      })
                    }
                  >
                    {contactFieldCurrencies.map((currency) => (
                      <option key={currency}>{currency}</option>
                    ))}
                  </select>
                </div>
              )}
              {contactFieldChoiceTypes.has(editor.definition.type) && (
                <label className={labelClass}>
                  Opciones (una por línea)
                  <textarea
                    className={`${contactControl} resize-y py-2`}
                    rows={4}
                    required
                    maxLength={CONTACT_FIELD_OPTION_LIMIT * (CONTACT_FIELD_OPTION_LENGTH + 1)}
                    value={editor.optionText}
                    onChange={(event) => setEditor({ ...editor, optionText: event.target.value })}
                  />
                </label>
              )}
              <ContactFieldControl
                field={{ ...editor.definition, options: readOptions(editor) }}
                label="Valor predeterminado (opcional)"
                value={editor.definition.defaultValue ?? ''}
                contacts={contacts}
                onChange={(value) =>
                  setEditor({
                    ...editor,
                    definition: { ...editor.definition, defaultValue: value },
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Se usa hasta que captures o vacíes el dato en la ficha.
              </p>
            </>
          )}
        </ContactEditorDialog>
      )}
    </>
  );
}

const relationSuggestions = [
  'Representante legal',
  'Apoderado',
  'Socio',
  'Colega',
  'Contacto de seguimiento',
];

export function ContactRelationships(
  props: Props & {
    contacts: RelatedContactOption[];
    loading: boolean;
    unavailable: boolean;
    dialogOpen: boolean;
    setDialogOpen: (open: boolean) => void;
    onOpenContact: (id: string) => void;
  }
) {
  const {
    contactId,
    userId,
    contacts,
    rows,
    onSaved,
    loading,
    unavailable,
    dialogOpen,
    setDialogOpen,
    onOpenContact,
  } = props;
  const [incoming, setIncoming] = useState<{ rows: ContactFieldRow[]; error: string } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const { data, error } = await createClient()
          .from('contact_custom_fields')
          .select(CONTACT_FIELD_COLUMNS)
          .eq('user_id', userId)
          .eq('field_name', CONTACT_RELATION_PREFIX + contactId)
          .order('created_at', { ascending: false })
          .abortSignal(abort.signal);
        if (error) throw error;
        if (!abort.signal.aborted) setIncoming({ rows: data || [], error: '' });
      } catch {
        if (!abort.signal.aborted)
          setIncoming({ rows: [], error: 'No se pudieron cargar todas las relaciones.' });
      }
    }
    void load();
    return () => abort.abort();
  }, [contactId, userId, retry]);

  const candidates = contacts.filter((contact) => contact.id !== contactId);
  const byId = new Map(candidates.map((contact) => [contact.id, contact]));
  const relationships = [...rows, ...(incoming?.rows || [])].flatMap((row) => {
    const relation = readContactRelationship(row);
    if (!relation) return [];
    const outbound = row.contact_id === contactId;
    const contact = byId.get(
      outbound ? row.field_name.slice(CONTACT_RELATION_PREFIX.length) : row.contact_id
    );
    return contact ? [{ ...relation, contact, outbound, id: row.id }] : [];
  });
  const pending = loading || !incoming;
  const canAdd = candidates.length > 0 && !pending && !unavailable && !incoming?.error;

  return (
    <section className={contactCard} aria-label="Relaciones">
      <ContactPanelHeading icon={Link2} title="Relaciones">
        <button
          type="button"
          disabled={!canAdd}
          aria-label="Vincular contacto"
          className={contactButton}
          onClick={() => setDialogOpen(true)}
        >
          <Plus size={15} className="text-primary" aria-hidden="true" /> Vincular
        </button>
      </ContactPanelHeading>
      {relationships.map((row) => (
        <div
          className="flex items-start gap-2 border-b border-border px-4 py-3 last:border-0"
          key={row.id}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Link2 size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium text-foreground">{row.contact.name}</p>
            <p className="break-words text-sm text-muted-foreground">
              {row.label}
              {!row.outbound && ` · Registrada desde ${row.contact.name}`}
            </p>
            {row.note && (
              <p className="mt-1 break-words text-sm text-muted-foreground">{row.note}</p>
            )}
          </div>
          <button
            type="button"
            className={contactButton + ' size-9 shrink-0 !px-0'}
            aria-label={`Abrir ficha de ${row.contact.name}`}
            title="Abrir ficha"
            onClick={() => onOpenContact(row.contact.id)}
          >
            <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
      {pending && !incoming?.error && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Cargando relaciones…
        </p>
      )}
      {incoming?.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm text-muted-foreground"
        >
          {incoming.error}
          <button
            type="button"
            className={contactButton}
            onClick={() => {
              setIncoming(null);
              setRetry((value) => value + 1);
            }}
          >
            Reintentar
          </button>
        </div>
      )}
      {!pending && !incoming?.error && !unavailable && !relationships.length && (
        <p className="p-4 text-sm text-muted-foreground">
          {candidates.length
            ? 'Aún no hay contactos vinculados.'
            : 'Agrega otro contacto a tu agenda para establecer una relación.'}
        </p>
      )}
      {unavailable && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Las relaciones de esta ficha no están disponibles por el momento.
        </p>
      )}
      {dialogOpen && canAdd && (
        <RelationshipDialog
          contacts={candidates}
          onClose={() => setDialogOpen(false)}
          onSave={async (id, otherId, relation) => {
            if (!byId.has(otherId)) throw new Error('El contacto ya no se encuentra en tu agenda.');
            if (
              relationships.some(
                (row) =>
                  row.contact.id === otherId &&
                  normalizeLabel(row.label) === normalizeLabel(relation.label)
              )
            )
              throw new Error('Esa relación ya está registrada.');
            const saved = await saveField(
              props,
              id,
              CONTACT_RELATION_PREFIX + otherId,
              JSON.stringify(relation)
            );
            onSaved(saved);
            setDialogOpen(false);
          }}
        />
      )}
    </section>
  );
}

function RelationshipDialog({
  contacts,
  onClose,
  onSave,
}: {
  contacts: RelatedContactOption[];
  onClose: () => void;
  onSave: (id: string, relatedId: string, relation: ContactRelationship) => Promise<void>;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [relatedId, setRelatedId] = useState('');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!relatedId || !label.trim()) {
      setError('Selecciona el contacto e indica la relación.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(id, relatedId, { label: label.trim(), note: note.trim() });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo guardar la relación. Intenta nuevamente.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ContactEditorDialog
      title="Vincular contacto"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
    >
      <label className={labelClass}>
        Contacto relacionado
        <select
          value={relatedId}
          onChange={(event) => setRelatedId(event.target.value)}
          className={`${contactControl} min-w-0 w-full`}
          required
          autoFocus
        >
          <option value="">Seleccionar contacto</option>
          {contacts.map((contact) => (
            <option value={contact.id} key={contact.id}>
              {contact.name}
              {contact.email ? ` · ${contact.email}` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Tipo de relación
        <input
          required
          maxLength={80}
          list="contact-relationship-types"
          className={contactControl}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <datalist id="contact-relationship-types">
          {relationSuggestions.map((value) => (
            <option value={value} key={value} />
          ))}
        </datalist>
      </label>
      <label className={labelClass}>
        Nota de la relación
        <textarea
          rows={3}
          maxLength={500}
          className={`${contactControl} py-2`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
    </ContactEditorDialog>
  );
}
