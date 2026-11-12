'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileText,
  FolderArchive,
  Loader2,
  RefreshCw,
  Upload,
  ExternalLink,
  UserRound,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { CASE_STATUS_META } from '@/lib/case-files/schema';
import {
  portalMime,
  portalStatus,
  type CasePortal,
  type PortalItem,
} from '@/lib/case-files/portal';

async function portalRequest(token: string, body?: Record<string, unknown>) {
  const response = await fetch('/api/public/case-portal', {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    headers: {
      'x-case-invitation': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok)
    throw new Error(
      json.error || 'No se pudo completar la operación en el expediente. Vuelve a intentarlo.'
    );
  return json;
}
const toBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export default function ParticipantWorkspace({
  token,
  initial,
}: {
  token: string;
  initial: CasePortal;
}) {
  const [portal, setPortal] = useState(initial),
    [error, setError] = useState(''),
    [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const refresh = useCallback(
    async (manual = false) => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      if (manual) setRefreshing(true);
      try {
        const result = await portalRequest(
          token,
          portal.status === 'sealed' ? undefined : { action: 'refresh' }
        );
        setPortal(result.data);
        setError('');
      } catch (cause) {
        if (manual)
          setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el avance.');
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    },
    [token, portal.status]
  );
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(focus, 30000);
    const initialRefresh = window.setTimeout(focus, 0);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initialRefresh);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [refresh]);
  const role =
    (
      {
        subject: 'Titular',
        representative: 'Representante',
        contact: 'Contacto de seguimiento',
      } as Record<string, string>
    )[portal.role] || 'Participante';
  const state =
    CASE_STATUS_META[portal.status as keyof typeof CASE_STATUS_META]?.label || 'En integración';
  const progress = Math.min(100, Math.max(0, Number(portal.progress) || 0));
  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="mb-2 text-sm font-medium text-primary">Tu participación en el expediente</p>
        <h1 className="break-words text-2xl font-semibold">{portal.title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {portal.folio} · Invitación de {portal.sender}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-primary">
            <UserRound size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-semibold">{portal.participantName}</p>
            <p className="text-xs text-slate-500">{role}</p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-primary">
            {state}
          </span>
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <FolderArchive size={18} className="text-primary" />
            Avance del expediente
          </h2>
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Actualizar avance
          </button>
        </div>
        <div className="mt-4 flex items-center gap-4" aria-live="polite">
          <div
            role="progressbar"
            aria-label="Avance del expediente"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-sm tabular-nums text-slate-600">{progress}%</span>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          El avance reúne las entregas, revisiones, verificaciones y firmas de este expediente. Aquí
          puedes consultar y atender los requisitos que corresponden a tu participación.
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </section>
      {portal.requirements.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-100 p-5 text-base font-semibold">
            Documentos solicitados para el expediente
          </h2>
          <div className="divide-y divide-slate-100">
            {portal.requirements.map((item) => (
              <Requirement
                key={item.id}
                token={token}
                item={item}
                onReceipt={async (data) => {
                  if (data) setPortal(data);
                  await refresh(true);
                }}
              />
            ))}
          </div>
        </section>
      )}
      {portal.forms.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-100 p-5 text-base font-semibold">
            Formularios vinculados al expediente
          </h2>
          <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-500">
            Estos formularios son requisitos de tu participación en este expediente.
          </p>
          <div className="divide-y divide-slate-100">
            {portal.forms.map((item) => (
              <AssignedForm key={item.id} token={token} item={item} />
            ))}
          </div>
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Cada formulario vinculado se abre en otra pestaña. Al terminar, regresa al portal del
            expediente para consultar el avance actualizado.
          </p>
        </section>
      )}
      {!portal.requirements.length && !portal.forms.length && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold">Participación de seguimiento</h2>
          <p className="mt-2 text-sm text-slate-500">
            Tu participación es de consulta y seguimiento. No tienes entregas asignadas en este
            expediente.
          </p>
        </section>
      )}
    </>
  );
}
function ItemTitle({ item }: { item: PortalItem }) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="break-words text-sm font-semibold">
        {item.title}
        <span className="ml-2 text-xs font-normal text-slate-400">
          {item.required ? 'Obligatorio' : 'Adicional'}
        </span>
      </h3>
      {item.description && <p className="mt-1 text-sm text-slate-500">{item.description}</p>}
    </div>
  );
}
function Requirement({
  token,
  item,
  onReceipt,
}: {
  token: string;
  item: PortalItem;
  onReceipt: (portal: CasePortal | null) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [issueDate, setIssueDate] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(false);
  const pending = useRef<{
    operation: string;
    file: File;
    issueDate: string;
    uploadId?: string;
    uploaded?: boolean;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  async function submit() {
    if (!file || busy) return;
    setError('');
    setSuccess(false);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      const mime = portalMime[extension as keyof typeof portalMime];
      const allowed = (item.formats?.length ? item.formats : ['pdf', 'jpg', 'png']).map((x) =>
        x.toLowerCase()
      );
      if (
        !mime ||
        (!allowed.includes(extension) &&
          !allowed.includes(mime) &&
          !(extension === 'jpeg' && allowed.includes('jpg')))
      )
        throw new Error('El formato del archivo no está permitido.');
      if (file.size <= 0 || file.size > (item.maxBytes || 15 * 1024 * 1024))
        throw new Error('El archivo excede el tamaño permitido o está vacío.');
      if (item.askIssueDate && !issueDate)
        throw new Error('Indica la fecha de emisión del documento.');
      if (
        !pending.current ||
        pending.current.file !== file ||
        pending.current.issueDate !== issueDate
      )
        pending.current = { operation: crypto.randomUUID(), file, issueDate };
      const operation = pending.current;
      if (!operation.uploaded) {
        setBusy('Preparando archivo…');
        const bytes = await file.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
          n.toString(16).padStart(2, '0')
        ).join('');
        const prepared = (
          await portalRequest(token, {
            action: 'prepare',
            requirementId: item.id,
            operationKey: operation.operation,
            name: file.name,
            mime,
            size: file.size,
            sha256: hash,
            issueDate: issueDate || null,
          })
        ).data;
        operation.uploadId = prepared.id;
        if (!prepared.completed) {
          setBusy('Cifrando y cargando…');
          const key = await crypto.subtle.importKey(
            'raw',
            toBase64(prepared.key),
            'AES-GCM',
            false,
            ['encrypt']
          );
          const encrypted = await crypto.subtle.encrypt(
            {
              name: 'AES-GCM',
              iv: toBase64(prepared.nonce),
              additionalData: new TextEncoder().encode(prepared.id),
            },
            key,
            bytes
          );
          new Uint8Array(bytes).fill(0);
          const upload = await createClient()
            .storage.from(prepared.bucket)
            .uploadToSignedUrl(
              prepared.path,
              prepared.uploadToken,
              new Blob([encrypted], { type: 'application/octet-stream' }),
              { contentType: 'application/octet-stream' }
            );
          new Uint8Array(encrypted).fill(0);
          if (upload.error && !/already exists|duplicate/i.test(upload.error.message))
            throw new Error(
              'No se pudo cargar el archivo. Conservamos tu selección para reintentar.'
            );
        }
        operation.uploaded = true;
      }
      setBusy('Registrando entrega…');
      const result = await portalRequest(token, { action: 'finish', uploadId: operation.uploadId });
      setSuccess(true);
      setFile(null);
      pending.current = null;
      if (input.current) input.current.value = '';
      await onReceipt(result.portal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar la entrega.');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="p-5">
      <div className="flex items-start gap-3">
        <FileText size={19} className="mt-0.5 shrink-0 text-primary" />
        <ItemTitle item={item} />
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {portalStatus(item.status)}
        </span>
      </div>
      {item.canSubmit && (
        <div className="mt-4 space-y-3 sm:ml-8">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-xs text-slate-600">
              Archivo para el expediente
              <input
                ref={input}
                type="file"
                disabled={!!busy}
                accept={(item.formats?.length ? item.formats : ['pdf', 'jpg', 'png'])
                  .map((f) => (f.includes('/') ? f : `.${f}`))
                  .join(',')}
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  pending.current = null;
                  setError('');
                  setSuccess(false);
                }}
                className="mt-1 block w-full rounded-lg border border-slate-200 p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1 file:text-primary"
              />
            </label>
            {item.askIssueDate && (
              <label className="text-xs text-slate-600">
                Fecha de emisión
                <input
                  type="date"
                  disabled={!!busy}
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  max={new Date().toLocaleDateString('en-CA')}
                  className="mt-1 block rounded-lg border border-slate-200 p-2 text-sm"
                />
              </label>
            )}
            <button
              type="button"
              disabled={!file || !!busy}
              onClick={() => void submit()}
              className="flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}{' '}
              {busy || 'Entregar al expediente'}
            </button>
          </div>
          <p className="text-xs text-slate-400">
            {(item.formats?.length ? item.formats : ['pdf', 'jpg', 'png']).join(', ').toUpperCase()}{' '}
            · Máximo {Math.round((item.maxBytes || 15 * 1024 * 1024) / 1048576)} MB
          </p>
        </div>
      )}
      {success && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 size={16} />
          Documento recibido. Su revisión seguirá el proceso del expediente.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
function AssignedForm({ token, item }: { token: string; item: PortalItem }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [url, setUrl] = useState('');
  async function open() {
    setBusy(true);
    setError('');
    // Open during the user gesture so browser popup protection does not discard
    // an asynchronous navigation. Keep a normal link as an accessible fallback.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const result = await portalRequest(token, { action: 'form', formId: item.id });
      setUrl(result.data.url);
      if (tab) tab.location.href = result.data.url;
    } catch (cause) {
      tab?.close();
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo abrir el formulario vinculado al expediente.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <FileText size={19} className="mt-0.5 text-primary" />
        <ItemTitle item={item} />
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {portalStatus(item.status)}
        </span>
        {(item.canSubmit || item.canResume) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void open()}
            className="flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm text-primary disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
            {item.canResume ? 'Continuar formulario vinculado' : 'Responder formulario vinculado'}
          </button>
        )}
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block text-sm text-primary underline"
        >
          Abrir formulario vinculado en otra pestaña
        </a>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
