'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Pencil, Plus, Save, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  organizationCatalogs,
  organizationValueLabels,
  type CatalogField,
} from '@/lib/organization/catalog';
import { useOrganizationAccess } from './OrganizationAccessContext';

type Values = Record<string, unknown>;
type Editor = {
  fields: CatalogField[];
  data: Values[];
  options: Record<string, Array<{ value: string; label: string }>>;
  canManage: boolean;
  statuses: string[];
  sensitive: boolean;
  versioned: boolean;
};
const defaults: Record<string, Values> = {
  directory: { person_type: 'individual', relationship_type: 'collaborator' },
  authorities: {
    modality: 'individual',
    currency: 'MXN',
    required_representatives: 1,
    identity_required: true,
  },
  policies: {
    security_level: 'basic',
    allowed_signature_types: ['autografa', 'click_sign'],
    resource_scope: ['documents'],
  },
  centers: { currency: 'MXN', alert_threshold_percent: 80 },
  networks: { mode: 'allow' },
  alerts: { severity: 'warning', channels: ['in_app'], enabled: true },
};

export default function OrganizationRecordActions({
  resource,
  id,
  onSaved,
  label,
  actionLabel,
  initialStatus,
}: {
  resource: string;
  id?: string;
  onSaved: () => void | Promise<void>;
  label?: string;
  actionLabel?: string;
  initialStatus?: string;
}) {
  const { session } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const { canAccess } = useOrganizationAccess();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [values, setValues] = useState<Values>({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<Values | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const config = organizationCatalogs[resource];
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  if (!config || !canAccess(`${config.permission}.manage`) || (!id && !config.create)) return null;
  const api = async (path: string, init?: Parameters<typeof fetch>[1]) => {
    if (!session?.access_token) throw new Error('La sesión no está disponible.');
    const response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...init?.headers,
      },
      cache: 'no-store',
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo guardar el registro.');
    return result;
  };
  const load = async () => {
    setOpen(true);
    setLoading(true);
    setError('');
    setPending(null);
    setPassword('');
    try {
      const result = await api(
        `/api/organizacion/catalog?workspace_id=${activeWorkspace!.id}&resource=${resource}${id ? `&id=${id}` : ''}`
      );
      setEditor(result);
      const nextValues = id ? result.data[0] : defaults[resource] || {};
      if (resource === 'resources')
        setValues({ ...nextValues, configuration: nextValues.configuration?.text || '' });
      else setValues(nextValues);
      setStatus(initialStatus || (id ? result.data[0]?.status || '' : ''));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el registro.');
    } finally {
      setLoading(false);
    }
  };
  const finish = async (payload: Values, token?: string) => {
    await api('/api/organizacion/catalog', {
      method: 'POST',
      headers: token ? { 'X-Organization-Reauth': token } : undefined,
      body: JSON.stringify({
        workspace_id: activeWorkspace!.id,
        resource,
        id: id || null,
        expected_updated_at: typeof values.updated_at === 'string' ? values.updated_at : null,
        ...payload,
      }),
    });
    setOpen(false);
    setPassword('');
    setPending(null);
    await onSaved();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const fields: Values = {};
    for (const field of editor?.fields || []) {
      const value = values[field.key];
      fields[field.key] =
        field.type === 'list'
          ? Array.isArray(value)
            ? value
            : String(value || '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
          : field.type === 'checkbox'
            ? Boolean(value)
            : field.type === 'number'
              ? value === '' || value === undefined || value === null
                ? null
                : Number(value)
              : value === '' || value === undefined
                ? null
                : value;
    }
    const payload = { action: 'save', values: fields };
    if (editor?.sensitive) {
      setPending(payload);
      return;
    }
    setSaving(true);
    try {
      await finish(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };
  const changeStatus = async () => {
    const payload = { action: 'status', status };
    if (editor?.sensitive) {
      setPending(payload);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await finish(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el estado.');
    } finally {
      setSaving(false);
    }
  };
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (!pending || !password) return;
    setSaving(true);
    setError('');
    try {
      const result = await api('/api/organizacion/reauthenticate', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: activeWorkspace!.id,
          password,
          scopes: [`${config.permission}.manage`],
        }),
      });
      await finish(pending, result.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la identidad.');
    } finally {
      setSaving(false);
    }
  };
  const locked = Boolean(id && editor?.versioned && values.status !== 'draft');
  return (
    <>
      <button
        type="button"
        onClick={load}
        aria-label={label || `${id ? 'Editar' : 'Crear'} ${config.title}`}
        title={label || `${id ? 'Editar' : 'Crear'} ${config.title}`}
        className={
          actionLabel
            ? 'text-primary text-sm'
            : id
              ? 'organization-record-action'
              : 'organization-primary-button'
        }
      >
        {actionLabel ||
          (id ? (
            <Pencil size={15} />
          ) : (
            <>
              <Plus size={15} />
              {label || `Crear ${config.title.toLowerCase()}`}
            </>
          ))}
      </button>
      <dialog
        ref={dialog}
        aria-label={`${id ? 'Editar' : 'Crear'} ${config.title.toLowerCase()}`}
        className="organization-record-dialog"
        onCancel={(event) => {
          event.preventDefault();
          if (!saving) setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !saving) setOpen(false);
        }}
      >
        <div className="organization-record-dialog-header">
          <div>
            <h3>
              {pending
                ? 'Confirmar cambio'
                : `${id ? 'Editar' : 'Crear'} ${config.title.toLowerCase()}`}
            </h3>
            <p>
              {pending
                ? 'Confirma tu identidad para aplicar este cambio.'
                : 'Actualiza la información de este registro.'}
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => setOpen(false)}
            aria-label="Cerrar editor"
          >
            <X size={19} />
          </button>
        </div>
        {error && (
          <div role="alert" className="organization-record-error">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
            <Loader2 size={17} className="animate-spin" />
            Cargando...
          </div>
        ) : pending ? (
          <form onSubmit={confirm}>
            <div className="organization-record-dialog-body">
              <label className="block text-sm">
                Contraseña
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3"
                />
              </label>
            </div>
            <div className="organization-record-dialog-footer">
              <button
                type="button"
                className="organization-secondary-button"
                disabled={saving}
                onClick={() => setPending(null)}
              >
                Atrás
              </button>
              <button className="organization-primary-button" disabled={saving || !password}>
                {saving && <Loader2 size={15} className="animate-spin" />}Confirmar y guardar
              </button>
            </div>
          </form>
        ) : (
          editor && (
            <form onSubmit={submit}>
              <div className="organization-record-dialog-body">
                {locked && (
                  <p className="mb-4 text-sm text-muted-foreground">
                    Este registro está publicado o archivado. Crea una nueva versión desde su
                    listado para editarlo.
                  </p>
                )}
                <fieldset
                  disabled={saving || locked || !editor.canManage}
                  className="grid min-w-0 gap-4 sm:grid-cols-2"
                >
                  {editor.fields.map((field) => (
                    <label
                      key={field.key}
                      className={`block min-w-0 text-sm ${field.type === 'textarea' ? 'sm:col-span-2' : ''}`}
                    >
                      {field.type === 'checkbox' ? (
                        <span className="flex items-center gap-2 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(values[field.key])}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [field.key]: event.target.checked,
                              }))
                            }
                          />
                          {field.label}
                        </span>
                      ) : (
                        <>
                          {field.label}
                          {field.required && (
                            <span aria-hidden="true" className="ml-1 text-red-500">
                              *
                            </span>
                          )}
                          {field.type === 'textarea' ? (
                            <textarea
                              required={field.required}
                              value={String(values[field.key] ?? '')}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                              className="mt-1.5 min-h-28 w-full rounded-md border border-border bg-background p-3"
                            />
                          ) : field.type === 'select' || field.type === 'relation' ? (
                            <select
                              required={field.required}
                              value={String(values[field.key] ?? '')}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                              className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3"
                            >
                              <option value="">Sin especificar</option>
                              {field.type === 'relation'
                                ? (editor.options[field.relation!] || []).map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))
                                : (field.choices || []).map((value) => (
                                    <option key={value} value={value}>
                                      {organizationValueLabels[value] || value}
                                    </option>
                                  ))}
                            </select>
                          ) : (
                            <input
                              required={field.required}
                              type={
                                ['number', 'email', 'date'].includes(field.type || '')
                                  ? field.type
                                  : 'text'
                              }
                              min={field.min}
                              max={field.max}
                              step={
                                field.type === 'number'
                                  ? [
                                      'required_representatives',
                                      'alert_threshold_percent',
                                    ].includes(field.key)
                                    ? 1
                                    : 'any'
                                  : undefined
                              }
                              value={
                                Array.isArray(values[field.key])
                                  ? (values[field.key] as string[]).join(', ')
                                  : String(values[field.key] ?? '')
                              }
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                              className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3"
                            />
                          )}
                        </>
                      )}
                    </label>
                  ))}
                </fieldset>
                {id && editor.statuses.length > 0 && (
                  <div className="mt-6 flex flex-wrap items-end gap-2 border-t border-border pt-4">
                    <label className="min-w-40 flex-1 text-sm">
                      Estado
                      <select
                        value={status}
                        onChange={(event) => setStatus(event.target.value)}
                        className="mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3"
                      >
                        {Boolean(values.status) &&
                          !editor.statuses.includes(String(values.status)) && (
                            <option value={String(values.status)}>
                              {organizationValueLabels[String(values.status)] ||
                                String(values.status)}
                            </option>
                          )}
                        {editor.statuses.map((state) => (
                          <option value={state} key={state}>
                            {organizationValueLabels[state] || state}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={saving || status === values.status}
                      onClick={changeStatus}
                      className="organization-secondary-button"
                    >
                      Aplicar estado
                    </button>
                  </div>
                )}
              </div>
              <div className="organization-record-dialog-footer">
                {resource === 'certificate_access' && id && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setPending({ action: 'remove' })}
                    className="mr-auto text-sm text-red-600"
                  >
                    Revocar permiso
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="organization-secondary-button"
                >
                  Cancelar
                </button>
                {!locked && (
                  <button
                    disabled={saving || !editor.canManage}
                    className="organization-primary-button"
                  >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Guardar cambios
                  </button>
                )}
              </div>
            </form>
          )
        )}
      </dialog>
    </>
  );
}
