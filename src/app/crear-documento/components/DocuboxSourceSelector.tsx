'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  Eye,
  FileCheck2,
  FileClock,
  FileText,
  History,
  Loader2,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { DocuboxSourceSelection } from './types';

type RepositoryVersion = {
  key: string;
  id: string | null;
  variant: 'original' | 'version' | 'certified';
  number: number;
  status: string;
  label: string;
  sha256: string;
  byteSize: number | null;
  mimeType: string;
  editable: boolean;
  closed: boolean;
  available: boolean;
  createdAt: string;
  unavailableReason?: string | null;
};

type RepositoryDocument = {
  id: string;
  documentoId: string;
  name: string;
  fileName: string;
  description: string | null;
  status: string;
  statusLabel: string;
  updatedAt: string;
  closed: boolean;
  recommendedKey: string;
  versions: RepositoryVersion[];
  usageCount: number;
  firstUsedAt: string | null;
  usages: Array<{
    id: string;
    documentId: string;
    documentoId: string;
    name: string;
    status: string;
    statusLabel: string;
    createdAt: string;
    relationType: string;
  }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (file: File, selection: DocuboxSourceSelection) => void;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatBytes(value: number | null) {
  if (!value) return 'Tamano no disponible';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function DocuboxSourceSelector({ open, onClose, onSelect }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const { activeWorkspace } = useWorkspace();
  const [documents, setDocuments] = useState<RepositoryDocument[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versionDocument, setVersionDocument] = useState<RepositoryDocument | null>(null);

  useEffect(() => {
    if (!open || !activeWorkspace?.id) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('Tu sesion expiro. Inicia sesion de nuevo.');
        const params = new URLSearchParams({
          workspaceId: activeWorkspace.id,
        });
        if (search.trim()) params.set('search', search.trim());
        const response = await fetch(`/api/documentos/desde-docubox?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: controller.signal,
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'No se pudo consultar Docubox.');
        setDocuments(payload.documents || []);
      } catch (requestError) {
        if ((requestError as Error).name !== 'AbortError') {
          setError(
            requestError instanceof Error ? requestError.message : 'No se pudo consultar Docubox.'
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeWorkspace?.id, open, search, supabase]);

  useEffect(() => {
    if (!open) {
      setVersionDocument(null);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const chooseOriginal = async (document: RepositoryDocument) => {
    if (!activeWorkspace?.id) return;
    const version = document.versions.find((candidate) => candidate.variant === 'original');
    if (!version) {
      setError('Este documento no tiene un archivo original registrado.');
      return;
    }
    if (!version.available) {
      setError(version.unavailableReason || 'El archivo de esta version no esta disponible.');
      return;
    }
    const operationKey = `${document.id}:${version.key}`;
    setLoadingKey(operationKey);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Tu sesion expiro. Inicia sesion de nuevo.');
      const params = new URLSearchParams({
        workspaceId: activeWorkspace.id,
        documentId: document.id,
        variant: 'original',
      });
      const response = await fetch(`/api/documentos/desde-docubox/archivo?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'No se pudo recuperar esta version.');
      }
      const blob = await response.blob();
      const file = new File([blob], document.fileName, {
        type: version.mimeType || blob.type || 'application/octet-stream',
      });
      const downloadedHash = await sha256(file);
      const verifiedHeader = response.headers.get('x-docubox-sha256')?.toLowerCase() || '';
      if (!verifiedHeader || downloadedHash.toLowerCase() !== verifiedHeader) {
        throw new Error(
          'La huella del archivo no coincide. La seleccion fue bloqueada por seguridad.'
        );
      }
      onSelect(file, {
        workspaceId: activeWorkspace.id,
        sourceDocumentId: document.id,
        sourceVersionId: null,
        sourceVariant: 'original',
        sourceDocumentoId: document.documentoId,
        sourceDocumentName: document.name,
        sourceVersionNumber: 1,
        sourceVersionLabel: 'Original cargado',
        sourceStatus: 'original',
        sourceSha256: downloadedHash.toLowerCase(),
        fileName: document.fileName,
        fileSize: file.size,
        fileType: file.type,
        relationType: 'derived_from',
      });
      onClose();
    } catch (selectionError) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : 'No se pudo utilizar el documento original.'
      );
    } finally {
      setLoadingKey(null);
    }
  };

  const viewOriginal = (document: RepositoryDocument) => {
    const original = document.versions.find((version) => version.variant === 'original');
    if (!original?.available) {
      setError(original?.unavailableReason || 'El archivo original no esta disponible.');
      return;
    }
    setError(null);
    const viewerUrl = `/visor-documento/${encodeURIComponent(document.id)}?archivo=original`;
    const previewWindow = window.open(viewerUrl, '_blank', 'noopener,noreferrer');
    if (!previewWindow) {
      setError('El navegador bloqueo la ventana del visor. Habilita las ventanas emergentes.');
    }
  };

  const openVersions = (document: RepositoryDocument) => {
    setVersionDocument(document);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-[1px] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Seleccionar documento desde Docubox"
    >
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-slate-200 px-5 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {versionDocument ? (
              <button
                type="button"
                onClick={() => setVersionDocument(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                title="Volver a documentos"
              >
                <ArrowLeft size={17} />
              </button>
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Copy size={18} />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-base font-700 text-slate-950">
                {versionDocument ? 'Versiones e historial' : 'Seleccionar desde Docubox'}
              </h2>
              <p className="truncate text-xs text-slate-500">
                {versionDocument
                  ? versionDocument.name
                  : 'Reutiliza el archivo original sin duplicarlo fisicamente.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            title="Cerrar"
          >
            <X size={19} />
          </button>
        </header>

        {!versionDocument ? (
          <>
            <div className="border-b border-slate-200 bg-slate-50/70 p-4 sm:px-6">
              <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 focus-within:border-primary">
                <Search size={17} className="shrink-0 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por nombre, folio o descripcion"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  autoFocus
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {error && (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              {loading ? (
                <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 size={18} className="animate-spin text-primary" />
                  Consultando tu repositorio...
                </div>
              ) : documents.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center text-center">
                  <FileText size={32} className="mb-3 text-slate-300" />
                  <p className="text-sm font-600 text-slate-700">
                    No encontramos documentos disponibles
                  </p>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
                    Prueba con otro termino o revisa el espacio de trabajo seleccionado.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {documents.map((document) => {
                    const original = document.versions.find(
                      (version) => version.variant === 'original'
                    );
                    const isLoading = loadingKey === `${document.id}:${original?.key}`;
                    return (
                      <div
                        key={document.id}
                        className="flex flex-col gap-4 bg-white p-4 first:rounded-t-lg last:rounded-b-lg sm:flex-row sm:items-center"
                      >
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${document.closed ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-primary'}`}
                        >
                          {document.closed ? <FileCheck2 size={20} /> : <FileClock size={20} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-700 text-slate-950">
                              {document.name}
                            </p>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] font-600 ${document.closed ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
                            >
                              {document.statusLabel}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                            <span>{document.documentoId}</span>
                            <span>Se utilizara el original</span>
                            <span>{formatDate(document.updatedAt)}</span>
                            {document.usageCount > 0 && (
                              <span>
                                {document.usageCount}{' '}
                                {document.usageCount === 1 ? 'reutilizacion' : 'reutilizaciones'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                          <button
                            type="button"
                            title="Utilizar este documento"
                            aria-label="Utilizar este documento"
                            disabled={!original?.available || Boolean(loadingKey)}
                            onClick={() => chooseOriginal(document)}
                            className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isLoading ? (
                              <Loader2 size={15} className="animate-spin" />
                            ) : (
                              <FileCheck2 size={16} />
                            )}
                          </button>
                          <button
                            type="button"
                            title="Ver documento"
                            aria-label="Ver documento"
                            disabled={!original?.available || Boolean(loadingKey)}
                            onClick={() => viewOriginal(document)}
                            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            type="button"
                            title="Historial de uso"
                            aria-label="Historial de uso"
                            disabled={Boolean(loadingKey)}
                            onClick={() => openVersions(document)}
                            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <History size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm leading-5 text-blue-800">
              Este historial es informativo. Al reutilizar el documento, Docubox siempre toma el
              archivo original cargado y conserva intactas todas sus versiones posteriores.
            </div>
            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-700 text-slate-950">Versiones del documento</h3>
                <span className="text-xs text-slate-500">Solo consulta</span>
              </div>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {versionDocument.versions.map((version) => (
                  <div
                    key={version.key}
                    className={`flex items-start gap-3 p-4 ${!version.available ? 'opacity-50' : ''}`}
                  >
                    <div
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${version.variant === 'original' ? 'bg-blue-50 text-primary' : version.closed ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {version.variant === 'original' ? (
                        <FileText size={16} />
                      ) : version.closed ? (
                        <ShieldCheck size={16} />
                      ) : (
                        <FileClock size={16} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 truncate text-sm font-700 text-slate-950">
                        {versionDocument.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-600 text-slate-600">{version.label}</span>
                        {version.variant === 'original' && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-600 text-primary">
                            Origen reutilizable
                          </span>
                        )}
                        {version.closed && (
                          <span className="flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-600 text-emerald-700">
                            <ShieldCheck size={11} />
                            Inmutable
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{formatBytes(version.byteSize)}</span>
                        <span>Subido el {formatDate(version.createdAt)}</span>
                        <span>
                          {version.sha256
                            ? `SHA-256 ${version.sha256.slice(0, 12)}...`
                            : 'SHA-256 no disponible'}
                        </span>
                        {version.variant === 'original' && (
                          <span>
                            Primera utilización:{' '}
                            {versionDocument.firstUsedAt
                              ? formatDate(versionDocument.firstUsedAt)
                              : 'Sin reutilizar'}
                          </span>
                        )}
                      </div>
                      {!version.available && (
                        <p className="mt-2 text-xs font-600 text-amber-700">
                          {version.unavailableReason ||
                            'El archivo de esta version no esta disponible.'}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-6">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-700 text-slate-950">
                  <History size={16} className="text-slate-500" />
                  Historial de reutilizacion
                </h3>
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-600 text-slate-600">
                  {versionDocument.usageCount} {versionDocument.usageCount === 1 ? 'uso' : 'usos'}
                </span>
              </div>
              {versionDocument.usages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                  Este archivo original todavia no se ha reutilizado.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {versionDocument.usages.map((usage) => (
                    <div
                      key={usage.id}
                      className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-600 text-slate-900">{usage.name}</p>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span>{usage.documentoId}</span>
                          <span>{formatDate(usage.createdAt)}</span>
                        </div>
                      </div>
                      <span className="w-fit rounded bg-slate-100 px-2 py-1 text-xs font-600 text-slate-600">
                        {usage.statusLabel}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setVersionDocument(null)}
                className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-600 text-slate-600 hover:bg-slate-50"
              >
                Cerrar historial
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
