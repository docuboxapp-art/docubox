'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, User, UserPlus, X } from 'lucide-react';
import {
  ParticipantSearchFields,
  type ParticipantSearchCriterion,
} from '@/components/profiles/ParticipantSearchFields';
import { profilePrivacy } from '@/lib/profile-privacy/client';
import {
  PROFILE_FIELDS,
  SENT_REQUEST_STATUS_LABELS,
  formatPrivacyDate,
  type DirectoryResult,
  type RequestStatus,
  type SharedProfile,
} from '@/lib/profile-privacy/model';
import { contactButton, contactPrimaryButton } from './contact-detail-ui';

export function AddContactDialog({
  onClose,
  onRequestSaved,
}: {
  onClose: () => void;
  onRequestSaved: (status: 'pending' | 'approved' | 'saved') => void;
}) {
  const [criterion, setCriterion] = useState<ParticipantSearchCriterion>('correo');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<DirectoryResult[] | null>(null);
  const [profile, setProfile] = useState<{ id: string; fields: SharedProfile } | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const titleId = useId();
  const searchedEmail =
    criterion === 'correo' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.trim()) ? query.trim() : '';

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      request.current?.abort();
      element?.close();
    };
  }, []);

  function reset() {
    request.current?.abort();
    setSearching(false);
    setMatches(null);
    setProfile(null);
    setError('');
  }

  async function search() {
    const current = new AbortController();
    request.current?.abort();
    request.current = current;
    setSearching(true);
    setMatches(null);
    setProfile(null);
    setError('');
    try {
      const data = await profilePrivacy<DirectoryResult[]>(
        'search',
        { criterion, query },
        current.signal
      );
      if (!current.signal.aborted) setMatches(data);
    } catch (cause) {
      if (!current.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'No fue posible buscar el contacto.');
    } finally {
      if (!current.signal.aborted) setSearching(false);
    }
  }

  async function select(result: DirectoryResult, action: 'request' | 'profile') {
    setBusy(result.id);
    setError('');
    try {
      if (action === 'request') {
        const { status } = await profilePrivacy<{ status: RequestStatus }>('request', {
          peerId: result.id,
          ...(criterion === 'correo' && { emailHint: query.trim() }),
        });
        if (status === 'pending' || status === 'approved') {
          onRequestSaved(status);
          return;
        }
        setMatches(
          (current) =>
            current?.map((item) =>
              item.id === result.id ? { ...item, requestStatus: status, canRequest: false } : item
            ) ?? null
        );
      } else {
        const { fields } = await profilePrivacy<{ fields: SharedProfile }>('profile', {
          peerId: result.id,
        });
        setProfile({ id: result.id, fields });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible completar la operación.');
    } finally {
      setBusy(null);
    }
  }

  async function addDirectly(peerId?: string) {
    setBusy(peerId ?? 'email');
    setError('');
    try {
      await profilePrivacy('add_contact', {
        ...(peerId && { peerId }),
        ...(searchedEmail && { email: searchedEmail }),
      });
      onRequestSaved('saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar el contacto.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-slate-950/45"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] min-h-[min(29rem,calc(100dvh-2rem))] flex-col">
        <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-5 sm:px-6">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              Agregar contacto
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Busca un usuario de Docubox para agregarlo a tu agenda. Al enviar una solicitud, la
              persona verá tu nombre.
            </p>
          </div>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onClose}
            aria-label="Cerrar"
            className={`${contactButton} px-2`}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="shrink-0 px-4 pb-2 sm:px-6">
          <ParticipantSearchFields
            criterion={criterion}
            value={query}
            searching={searching || Boolean(busy)}
            onCriterion={(value) => {
              setCriterion(value);
              setQuery('');
              reset();
            }}
            onValue={(value) => {
              setQuery(value);
              reset();
            }}
            onSearch={() => void search()}
          />
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4 sm:px-6">
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {searching && (
            <p
              role="status"
              className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
            >
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Buscando…
            </p>
          )}
          {matches?.length === 0 && (
            <div className="space-y-3 py-10 text-center">
              <p role="status" className="text-sm text-muted-foreground">
                No se encontró ningún perfil visible con ese criterio.
              </p>
              {searchedEmail && (
                <button
                  type="button"
                  className={contactButton}
                  disabled={Boolean(busy)}
                  onClick={() => void addDirectly()}
                >
                  <UserPlus size={15} aria-hidden="true" /> Agregar correo a mi agenda
                </button>
              )}
            </div>
          )}
          {matches?.map((result) => (
            <div key={result.id} className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center gap-3 p-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <User size={16} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 break-words text-sm">
                  <p className="font-medium">{result.full_name || 'Usuario de Docubox'}</p>
                  {result.email && <p className="text-xs text-muted-foreground">{result.email}</p>}
                  {!result.contactId &&
                    !result.canAddDirectly &&
                    (result.requestStatus === 'pending' ||
                      (result.canRequest && result.requestStatus !== 'approved')) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Esta persona debe aprobar la solicitud para que se agregue a tu agenda.
                      </p>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {result.canView && (
                    <button
                      type="button"
                      className={contactButton}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        profile?.id === result.id
                          ? setProfile(null)
                          : void select(result, 'profile')
                      }
                    >
                      {profile?.id === result.id ? 'Ocultar perfil' : 'Ver perfil'}
                    </button>
                  )}
                  {result.canAddDirectly || result.canRequest ? (
                    <button
                      type="button"
                      className={contactPrimaryButton}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        result.canAddDirectly
                          ? void addDirectly(result.id)
                          : void select(result, 'request')
                      }
                    >
                      <UserPlus size={15} aria-hidden="true" />{' '}
                      {result.canAddDirectly || result.requestStatus === 'approved'
                        ? 'Agregar a mi agenda'
                        : 'Enviar solicitud'}
                    </button>
                  ) : (
                    <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                      {result.contactId
                        ? 'En tu agenda'
                        : result.requestStatus
                          ? SENT_REQUEST_STATUS_LABELS[result.requestStatus]
                          : 'No recibe solicitudes de contacto'}
                    </span>
                  )}
                </div>
              </div>
              {profile?.id === result.id && (
                <dl className="grid gap-3 border-t border-border bg-muted/35 p-3 text-sm sm:grid-cols-2">
                  {PROFILE_FIELDS.map(({ key, label }) => {
                    const value = profile.fields[key];
                    if (!value) return null;
                    return (
                      <div key={key} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="break-words">
                          {key === 'last_sign_in_at' ? (
                            formatPrivacyDate(value)
                          ) : key === 'avatar_url' && /^https?:\/\//i.test(value) ? (
                            <a
                              className="font-medium text-primary hover:underline"
                              href={value}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Ver imagen
                            </a>
                          ) : (
                            value
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </div>
          ))}
        </div>
        <footer className="flex justify-end border-t border-border px-4 py-3 sm:px-6">
          <button
            type="button"
            className={contactButton}
            disabled={Boolean(busy)}
            onClick={onClose}
          >
            Cancelar
          </button>
        </footer>
      </div>
    </dialog>
  );
}
