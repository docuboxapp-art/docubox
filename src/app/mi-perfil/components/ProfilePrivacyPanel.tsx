'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Check, Eye, Lock, MessageSquare, Shield, UserPlus } from 'lucide-react';
import { profilePrivacy } from '@/lib/profile-privacy/client';
import {
  formatPrivacyDate,
  PROFILE_FIELDS,
  PROFILE_SCOPE_LABELS,
  PROFILE_SCOPES,
  REQUEST_STATUS_LABELS,
  type ContactAccessRequest,
  type FieldScope,
  type ProfileBlock,
  type ProfileSettings,
  type ProfileVisit,
} from '@/lib/profile-privacy/model';

const actionButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-primary disabled:opacity-50';
const primaryButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-primary disabled:opacity-50';
const formControl =
  'min-h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';
const fieldGroups = [...new Set(PROFILE_FIELDS.map(({ group }) => group))];
const sectionTabLinkClassName =
  'flex min-h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent px-3 text-sm font-medium text-muted-foreground hover:bg-card focus-visible:outline-primary aria-[current=page]:border-border aria-[current=page]:bg-card aria-[current=page]:text-primary';
const protectedFields = [
  'Firma autógrafa',
  'e.firma y certificados',
  'Datos de verificación',
  'Configuración de seguridad',
];
const tabs = [
  ['options', 'Opciones de privacidad', Lock],
  ['requests', 'Solicitudes de acceso', UserPlus],
  ['visits', 'Quién ha visto tu perfil', Eye],
  ['blocks', 'Usuarios bloqueados', Shield],
  ['communication', 'Comunicación', MessageSquare],
] as const;
type Tab = (typeof tabs)[number][0];

function PrivacyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <h3 className="border-b border-border bg-muted/45 px-4 py-3 text-sm font-semibold sm:px-5">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="size-4 shrink-0 accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function usePrivacyRecords<T>(operation: 'requests' | 'visits' | 'blocks' | 'settings') {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    profilePrivacy<T>(operation, {}, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError('');
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : 'No fue posible consultar la información.'
          );
        }
      });
    return () => controller.abort();
  }, [operation, revision]);
  return { data, error, reload: () => setRevision((current) => current + 1) };
}

function Feedback({
  error,
  pending,
  onRetry,
}: {
  error: string;
  pending?: boolean;
  onRetry?: () => void;
}) {
  if (error)
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {error}{' '}
        {onRetry && (
          <button type="button" onClick={onRetry} className="ml-1 font-medium underline">
            Reintentar
          </button>
        )}
      </p>
    );
  return pending ? (
    <p role="status" className="p-4 text-sm text-muted-foreground">
      Cargando…
    </p>
  ) : null;
}

function PrivacyRequests() {
  const { data, error, reload } = usePrivacyRecords<ContactAccessRequest[]>('requests');
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');
  async function decide(id: string, decision: 'approve' | 'decline' | 'revoke') {
    setBusy(id);
    setFailure('');
    try {
      await profilePrivacy('decide', { requestId: id, decision });
      reload();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'No fue posible resolver la solicitud.');
    } finally {
      setBusy('');
    }
  }
  return (
    <PrivacyCard title="Solicitudes de acceso">
      <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
        Al aprobar una solicitud, la persona puede agregarte a su agenda y ver los campos que
        compartes con ella.
      </p>
      <Feedback
        error={error || failure}
        pending={!data}
        onRetry={error ? () => void reload() : undefined}
      />
      {data?.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">No hay solicitudes de acceso.</p>
      )}
      <ul className="divide-y divide-border">
        {data?.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 break-words">
              <p className="text-sm font-medium">{item.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatPrivacyDate(item.created_at)} · {REQUEST_STATUS_LABELS[item.status]}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {item.status === 'pending' && (
                <>
                  <button
                    type="button"
                    className={actionButton}
                    disabled={Boolean(busy)}
                    onClick={() => void decide(item.id, 'decline')}
                  >
                    Rechazar
                  </button>
                  <button
                    type="button"
                    className={primaryButton}
                    disabled={Boolean(busy)}
                    onClick={() => void decide(item.id, 'approve')}
                  >
                    Aprobar
                  </button>
                </>
              )}
              {item.status === 'approved' && (
                <button
                  type="button"
                  className={actionButton}
                  disabled={Boolean(busy)}
                  onClick={() => void decide(item.id, 'revoke')}
                >
                  Revocar acceso
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </PrivacyCard>
  );
}

function PrivacyVisits() {
  const { data, error, reload } = usePrivacyRecords<ProfileVisit[]>('visits');
  return (
    <PrivacyCard title="Quién ha visto tu perfil">
      <Feedback error={error} pending={!data} onRetry={() => void reload()} />
      {data?.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">Aún no hay visitas registradas.</p>
      )}
      <ul className="divide-y divide-border">
        {data?.map((item) => (
          <li key={item.viewer_id} className="flex flex-wrap justify-between gap-2 p-4 text-sm">
            <span className="break-words font-medium">{item.name}</span>
            <time className="text-muted-foreground" dateTime={item.viewed_at}>
              {formatPrivacyDate(item.viewed_at)}
            </time>
          </li>
        ))}
      </ul>
    </PrivacyCard>
  );
}

function PrivacyBlocks() {
  const { data, error, reload } = usePrivacyRecords<ProfileBlock[]>('blocks');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  async function change(peerId?: string) {
    setBusy(true);
    setFailure('');
    try {
      if (peerId) await profilePrivacy('unblock', { peerId });
      else {
        await profilePrivacy('block', { email: email.trim() });
        setEmail('');
      }
      reload();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'No fue posible actualizar el bloqueo.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <PrivacyCard title="Usuarios bloqueados">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && email.trim()) void change();
        }}
        className="flex flex-wrap items-end gap-2 border-b border-border p-4"
      >
        <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm">
          Correo del usuario
          <input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={formControl}
          />
        </label>
        <button type="submit" disabled={!email.trim() || busy || !data} className={actionButton}>
          Bloquear usuario
        </button>
      </form>
      <Feedback
        error={error || failure}
        pending={!data}
        onRetry={error ? () => void reload() : undefined}
      />
      {data?.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">No tienes usuarios bloqueados.</p>
      )}
      <ul className="divide-y divide-border">
        {data?.map((item) => (
          <li
            key={item.blocked_id}
            className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
          >
            <div className="min-w-0 break-words">
              <p className="font-medium">{item.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatPrivacyDate(item.created_at)}
              </p>
            </div>
            <button
              type="button"
              className={actionButton}
              disabled={busy}
              onClick={() => void change(item.blocked_id)}
            >
              Desbloquear
            </button>
          </li>
        ))}
      </ul>
    </PrivacyCard>
  );
}

export function ProfilePrivacyPanel() {
  const { data, error, reload } = usePrivacyRecords<ProfileSettings>('settings');
  return data ? (
    <PrivacyPreferences settings={data} />
  ) : (
    <PrivacyCard title="Opciones de privacidad">
      <Feedback error={error} pending onRetry={() => void reload()} />
    </PrivacyCard>
  );
}

function PrivacyPreferences({ settings }: { settings: ProfileSettings }) {
  const [saved, setSaved] = useState(settings);
  const [draft, setDraft] = useState(settings);
  const [active, setActive] = useState<Tab>('options');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const editable = active === 'options' || active === 'communication';

  function edit(update: Partial<ProfileSettings>) {
    setDraft((current) => ({ ...current, ...update }));
    setStatus('');
    setError('');
  }

  async function save() {
    if (saving || !changed) return;
    setSaving(true);
    setStatus('');
    setError('');
    try {
      await profilePrivacy('save', draft);
      setSaved(draft);
      setStatus('Preferencias guardadas.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar las preferencias.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <nav
        aria-label="Secciones de privacidad"
        className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1"
      >
        {tabs
          .filter(([id]) => id !== 'requests' || saved.allowContacts)
          .map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-current={active === id ? 'page' : undefined}
              className={sectionTabLinkClassName}
              onClick={() => setActive(id)}
            >
              <Icon size={15} className="shrink-0" aria-hidden="true" /> {label}
            </button>
          ))}
      </nav>
      {active === 'requests' && <PrivacyRequests />}
      {active === 'visits' && <PrivacyVisits />}
      {active === 'blocks' && <PrivacyBlocks />}
      {editable && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            {active === 'options' ? (
              <>
                <PrivacyCard title="Alcance de visibilidad de mi perfil">
                  <div className="space-y-2 p-4">
                    {PROFILE_SCOPES.map((scope) => (
                      <label
                        key={scope}
                        className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                      >
                        <input
                          type="radio"
                          name="profile-scope"
                          className="size-4 accent-primary"
                          checked={draft.scope === scope}
                          onChange={() => edit({ scope })}
                        />
                        {PROFILE_SCOPE_LABELS[scope]}
                      </label>
                    ))}
                  </div>
                  <div className="border-t border-border">
                    <Toggle
                      label="Aceptar solicitudes para ser contacto"
                      description="Podrás revisar y aprobar quién te agrega a su agenda."
                      checked={draft.allowContacts}
                      onChange={(allowContacts) => edit({ allowContacts })}
                    />
                  </div>
                </PrivacyCard>
                <PrivacyCard title="Visibilidad por campo">
                  <p className="px-4 py-3 text-sm text-muted-foreground">
                    Cada campo se comparte dentro del alcance de tu perfil.
                  </p>
                  {fieldGroups.map((group) => (
                    <div key={group} className="divide-y divide-border">
                      <h4 className="border-t border-border bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground sm:px-5">
                        {group}
                      </h4>
                      {PROFILE_FIELDS.filter((field) => field.group === group).map((field) => (
                        <label
                          key={field.key}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-5"
                        >
                          <span>{field.label}</span>
                          <select
                            aria-label={field.label}
                            className={formControl}
                            value={
                              draft.fields[field.key] ?? ('private' in field ? 'nadie' : 'heredar')
                            }
                            onChange={(event) =>
                              edit({
                                fields: {
                                  ...draft.fields,
                                  [field.key]: event.target.value as FieldScope,
                                },
                              })
                            }
                          >
                            <option value="heredar">Alcance del perfil</option>
                            {PROFILE_SCOPES.map((scope) => (
                              <option key={scope} value={scope}>
                                {PROFILE_SCOPE_LABELS[scope]}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  ))}
                  <div className="divide-y divide-border border-t border-border bg-muted/30">
                    {protectedFields.map((label) => (
                      <div
                        key={label}
                        className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-5"
                      >
                        <span>{label}</span>
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Lock size={12} aria-hidden="true" /> Privado
                        </span>
                      </div>
                    ))}
                  </div>
                </PrivacyCard>
              </>
            ) : (
              <PrivacyCard title="Comunicación directa">
                <div className="divide-y divide-border">
                  <Toggle
                    label="Recibir mensajes directos"
                    description="Desde Contactos o el visor de documentos."
                    checked={draft.allowMessages}
                    onChange={(allowMessages) => edit({ allowMessages })}
                  />
                  <Toggle
                    label="Recibir notas directas"
                    description="Notas enviadas a tu cuenta desde Contactos o el visor."
                    checked={draft.allowNotes}
                    onChange={(allowNotes) => edit({ allowNotes })}
                  />
                </div>
              </PrivacyCard>
            )}
          </fieldset>
          <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
            <div>
              {status && (
                <p
                  role="status"
                  className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300"
                >
                  <Check size={15} aria-hidden="true" /> {status}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <button type="submit" className={primaryButton} disabled={saving || !changed}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
