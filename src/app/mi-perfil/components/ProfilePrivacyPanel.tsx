'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Eye, Loader2, Lock, MessageSquare, Save, Shield, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { InfoTooltip } from '@/components/forms/ExperienceOption';
import { ContactRequestsPanel } from '@/components/profiles/ContactRequestsPanel';
import { profilePrivacy } from '@/lib/profile-privacy/client';
import { useContactRequests } from '@/lib/profile-privacy/useContactRequests';
import {
  CONTACT_REQUEST_APPROVAL_LABEL,
  formatPrivacyDate,
  PROFILE_FIELDS,
  PROFILE_SCOPE_LABELS,
  PROFILE_SCOPES,
  PROFILE_SECTIONS,
  type ProfileBlock,
  type ProfileScope,
  type ProfileSection,
  type ProfileSettings,
  type ProfileVisit,
} from '@/lib/profile-privacy/model';
import { ProfileSectionHeader } from './ProfileSectionHeader';

const actionButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-primary disabled:opacity-50';
const primaryButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-primary disabled:opacity-50';
const formControl =
  'min-h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';
const scopeAudience: Record<ProfileScope, { description: string; summary: string }> = {
  nadie: {
    description: 'Solo tú puedes ver esta información.',
    summary: 'Solo tú',
  },
  workspaces: {
    description: 'Personas con una membresía activa en un espacio de trabajo que compartes.',
    summary: 'Miembros activos de espacios en común',
  },
  solo_contactos: {
    description: 'Personas de tu agenda y personas cuya solicitud para agregarte aprobaste.',
    summary: 'Personas de tu agenda y contactos aprobados',
  },
  contactos: {
    description:
      'Incluye a las personas de tu agenda, a quienes aprobaste como contactos y a los miembros activos de espacios de trabajo en común.',
    summary: 'Contactos de tu agenda, contactos aprobados y miembros activos de espacios en común',
  },
};
const visibilityModes = [
  [
    'general',
    'Permisos generales del perfil',
    'Elige quién puede ver las secciones que compartas.',
  ],
  ['fields', 'Visibilidad por campo', 'Elige quién puede ver cada dato de tu perfil.'],
] as const;
const visibilityOption =
  'flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5 text-sm hover:bg-muted has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5';
const protectedFields = [
  'Firma autógrafa',
  'e.firma y certificados',
  'Datos de verificación',
  'Configuración de seguridad',
];
const privacyHeading = {
  title: 'Privacidad',
  description: 'Elige quién puede ver tu perfil y contactarte.',
};
const tabs = [
  ['options', 'Opciones de privacidad', Lock],
  ['requests', 'Solicitudes de contacto', UserPlus],
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

function usePrivacyRecords<T>(operation: 'visits' | 'blocks' | 'settings_v2') {
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
  async function change(peerId?: string) {
    setBusy(true);
    try {
      if (peerId) await profilePrivacy('unblock', { peerId });
      else {
        await profilePrivacy('block', { email: email.trim() });
        setEmail('');
      }
      reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'No fue posible actualizar el bloqueo.');
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
      <Feedback error={error} pending={!data} onRetry={error ? () => void reload() : undefined} />
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
  const { data, error, reload } = usePrivacyRecords<ProfileSettings>('settings_v2');
  return data ? (
    <PrivacyPreferences settings={data} />
  ) : (
    <div className="space-y-4">
      <ProfileSectionHeader {...privacyHeading} />
      <PrivacyCard title="Opciones de privacidad">
        <Feedback error={error} pending onRetry={reload} />
      </PrivacyCard>
    </div>
  );
}

function PrivacyPreferences({ settings }: { settings: ProfileSettings }) {
  const [saved, setSaved] = useState(settings);
  const [draft, setDraft] = useState(settings);
  const [active, setActive] = useState<Tab>('options');
  const [saving, setSaving] = useState(false);
  const requests = useContactRequests({ watch: active === 'requests' });
  const visibilityId = useId();
  const preferencesFormId = `${visibilityId}-preferences`;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const editable = active === 'options' || active === 'communication';
  const fields: ProfileSettings['fields'] =
    draft.mode === 'fields' && saved.mode === 'general' && Object.keys(draft.fields).length === 0
      ? Object.fromEntries(
          PROFILE_FIELDS.map((field) => [
            field.key,
            draft.sections.includes(field.group) ? draft.scope : 'nadie',
          ])
        )
      : draft.fields;

  function selectTab(tab: Tab) {
    setActive(tab);
    if (tab === 'requests') requests.reload();
  }

  function edit(update: Partial<ProfileSettings>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function toggleSection(section: ProfileSection, checked: boolean) {
    edit({
      sections: PROFILE_SECTIONS.map(({ key }) => key).filter((key) =>
        key === section ? checked : draft.sections.includes(key)
      ),
    });
  }

  async function save() {
    if (saving || !changed) return;
    const preferences = { ...draft, fields };
    setSaving(true);
    const notice = toast.loading('Guardando preferencias…');
    try {
      await profilePrivacy('save_v2', preferences);
      if (draft.allowContacts !== saved.allowContacts) requests.reload();
      setSaved(preferences);
      setDraft(preferences);
      toast.success('Preferencias guardadas.', { id: notice });
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'No se pudieron guardar las preferencias.',
        { id: notice }
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ProfileSectionHeader
        {...privacyHeading}
        actions={
          editable && changed ? (
            <button
              type="submit"
              form={preferencesFormId}
              className="ml-auto flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-600 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-primary disabled:opacity-60"
              disabled={saving}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          ) : undefined
        }
      />
      <nav aria-label="Secciones de privacidad" className="min-w-0 overflow-x-auto">
        <div className="flex min-w-max gap-1 border-b border-border">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-current={active === id ? 'page' : undefined}
              className={`-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 ${
                active === id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`}
              onClick={() => selectTab(id)}
            >
              <Icon size={14} className="shrink-0" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </nav>
      {active === 'requests' && <ContactRequestsPanel {...requests} />}
      {active === 'visits' && <PrivacyVisits />}
      {active === 'blocks' && <PrivacyBlocks />}
      {editable && (
        <form
          id={preferencesFormId}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            {active === 'options' ? (
              <>
                <PrivacyCard title="Recepción de solicitudes">
                  <Toggle
                    label={CONTACT_REQUEST_APPROVAL_LABEL}
                    description={
                      draft.allowContacts !== saved.allowContacts
                        ? 'Guarda los cambios para aplicar esta opción.'
                        : 'Si la activas, te pedirán aprobación. Si la desactivas, podrán agregarte directamente a su agenda.'
                    }
                    checked={draft.allowContacts}
                    onChange={(allowContacts) => edit({ allowContacts })}
                  />
                </PrivacyCard>
                <PrivacyCard title="Alcance de visibilidad de mi perfil">
                  <fieldset className="grid min-w-0 gap-2 p-4 sm:grid-cols-2 sm:px-5">
                    <legend className="sr-only">Cómo configurar la visibilidad</legend>
                    {visibilityModes.map(([mode, label, description]) => {
                      const modeId = `${visibilityId}-mode-${mode}`;
                      return (
                        <label key={mode} className={visibilityOption}>
                          <input
                            type="radio"
                            name={`${visibilityId}-mode`}
                            aria-labelledby={modeId}
                            aria-describedby={`${modeId}-description`}
                            className="mt-0.5 size-4 shrink-0 accent-primary"
                            checked={draft.mode === mode}
                            onChange={() => edit({ mode })}
                          />
                          <span className="min-w-0">
                            <span id={modeId} className="block font-medium">
                              {label}
                            </span>
                            <span
                              id={`${modeId}-description`}
                              className="mt-0.5 block text-xs leading-relaxed text-muted-foreground"
                            >
                              {description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                  {draft.mode === 'general' && (
                    <div className="space-y-4 px-4 pb-4 sm:px-5">
                      <fieldset className="min-w-0 space-y-2">
                        <legend className="mb-2 text-sm font-semibold">
                          Quién puede ver tu perfil
                        </legend>
                        {PROFILE_SCOPES.map((scope) => {
                          const scopeId = `${visibilityId}-scope-${scope}`;

                          return (
                            <label key={scope} className={visibilityOption}>
                              <input
                                type="radio"
                                name={`${visibilityId}-scope`}
                                aria-labelledby={scopeId}
                                aria-describedby={`${scopeId}-description`}
                                className="mt-0.5 size-4 shrink-0 accent-primary"
                                checked={draft.scope === scope}
                                onChange={() => edit({ scope })}
                              />
                              <span className="min-w-0">
                                <span id={scopeId} className="block font-medium">
                                  {PROFILE_SCOPE_LABELS[scope]}
                                </span>
                                <span
                                  id={`${scopeId}-description`}
                                  className="mt-0.5 block text-xs leading-relaxed text-muted-foreground"
                                >
                                  {scopeAudience[scope].description}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </fieldset>
                      {draft.scope !== 'nadie' && (
                        <fieldset className="min-w-0 space-y-2">
                          <legend className="mb-2 text-sm font-semibold">
                            Secciones para compartir
                          </legend>
                          <p className="text-sm text-muted-foreground">
                            Las secciones que marques serán visibles para el grupo seleccionado.
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {PROFILE_SECTIONS.map(({ key, label, description }) => {
                              const sectionId = `${visibilityId}-section-${key}`;
                              return (
                                <label key={key} className={visibilityOption}>
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 size-4 shrink-0 accent-primary"
                                    aria-labelledby={sectionId}
                                    aria-describedby={`${sectionId}-description`}
                                    checked={draft.sections.includes(key)}
                                    onChange={(event) =>
                                      toggleSection(key, event.currentTarget.checked)
                                    }
                                  />
                                  <span className="min-w-0">
                                    <span id={sectionId} className="block font-medium">
                                      {label}
                                    </span>
                                    <span
                                      id={`${sectionId}-description`}
                                      className="mt-0.5 block text-xs leading-relaxed text-muted-foreground"
                                    >
                                      {description}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      )}
                    </div>
                  )}
                </PrivacyCard>
                {draft.mode === 'fields' && (
                  <PrivacyCard title="Visibilidad por campo">
                    {PROFILE_SECTIONS.map(({ key: group, label }) => (
                      <div key={group} className="divide-y divide-border">
                        <h4 className="border-t border-border bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground sm:px-5">
                          {label}
                        </h4>
                        {PROFILE_FIELDS.filter((field) => field.group === group).map((field) => {
                          const fieldScope = fields[field.key] ?? 'nadie';
                          const fieldId = `${visibilityId}-${field.key}`;
                          const audienceId = `${fieldId}-audience`;

                          return (
                            <div
                              key={field.key}
                              className="grid gap-2 px-4 py-2.5 text-sm sm:px-5 md:grid-cols-[minmax(0,1fr)_20rem] md:items-center"
                            >
                              <span className="min-w-0">
                                <label htmlFor={fieldId} className="block font-medium">
                                  {field.label}
                                </label>
                                <span
                                  id={audienceId}
                                  className="mt-0.5 block text-xs leading-relaxed text-muted-foreground"
                                >
                                  {scopeAudience[fieldScope].summary}
                                  {field.key === 'full_name' && fieldScope !== 'nadie' && (
                                    <span className="block">
                                      También se aplica la visibilidad del nombre y los apellidos.
                                    </span>
                                  )}
                                </span>
                              </span>
                              <span className="min-w-0">
                                <span className="flex items-center gap-2">
                                  <select
                                    id={fieldId}
                                    aria-describedby={audienceId}
                                    className={`${formControl} min-w-0 flex-1`}
                                    value={fieldScope}
                                    onChange={(event) =>
                                      edit({
                                        fields: {
                                          ...fields,
                                          [field.key]: event.target.value as ProfileScope,
                                        },
                                      })
                                    }
                                  >
                                    {PROFILE_SCOPES.map((scope) => (
                                      <option key={scope} value={scope}>
                                        {PROFILE_SCOPE_LABELS[scope]}
                                      </option>
                                    ))}
                                  </select>
                                  <InfoTooltip
                                    label={`la visibilidad de ${field.label}`}
                                    description={scopeAudience[fieldScope].description}
                                  />
                                </span>
                              </span>
                            </div>
                          );
                        })}
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
                )}
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
        </form>
      )}
    </div>
  );
}
