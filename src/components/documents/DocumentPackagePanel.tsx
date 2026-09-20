'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, Eye, FileText, Paperclip, RefreshCw, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type PackageResource = {
  id: string;
  interaction_mode: 'informative' | 'read_required' | 'acceptance_required' | 'downloadable';
  title: string;
  description: string | null;
  original_name: string;
  mime_type: string;
  byte_size: number;
  malware_scan_status: string;
};

type Requirement = {
  id: string;
  name: string;
  description: string | null;
  required: boolean;
  status: string;
  provided_at: string | null;
};

type Interaction = {
  resource_id: string;
  interaction_type: string;
};

const MODE_LABELS: Record<PackageResource['interaction_mode'], string> = {
  informative: 'Informativo',
  read_required: 'Lectura requerida',
  acceptance_required: 'Aceptación requerida',
  downloadable: 'Descargable',
};

export function DocumentPackagePanel({
  documentId,
  onReadinessChange,
}: {
  documentId: string;
  onReadinessChange?: (readiness: { ready: boolean; blockers: unknown[] }) => void;
}) {
  const [resources, setResources] = useState<PackageResource[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [participantReferenceId, setParticipantReferenceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const authHeaders = useCallback(async (json = false) => {
    const { data } = await createClient().auth.getSession();
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(data.session?.access_token
        ? { Authorization: `Bearer ${data.session.access_token}` }
        : {}),
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/documentos/${encodeURIComponent(documentId)}/package`, {
        headers: await authHeaders(),
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No fue posible consultar el paquete.');
      setResources(body.data.resources || []);
      setRequirements(body.data.requirements || []);
      setInteractions(body.data.interactions || []);
      setParticipantReferenceId(body.data.participantReferenceId || null);
      onReadinessChange?.(body.data.readiness || { ready: true, blockers: [] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible consultar el paquete.');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, documentId, onReadinessChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openResource = async (resource: PackageResource, download = false) => {
    setBusyId(resource.id);
    setError('');
    try {
      const response = await fetch(
        `/api/documentos/${encodeURIComponent(documentId)}/package/resources/${resource.id}/file${download ? '?download=1' : ''}`,
        { headers: await authHeaders() }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'El recurso no está disponible.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (download) {
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = resource.original_name;
        anchor.click();
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'El recurso no está disponible.');
    } finally {
      setBusyId(null);
    }
  };

  const acceptResource = async (resourceId: string) => {
    setBusyId(resourceId);
    setError('');
    try {
      const response = await fetch(`/api/documentos/${encodeURIComponent(documentId)}/package`, {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({
          operation: 'record_interaction',
          resourceId,
          interactionType: 'accepted',
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No fue posible registrar la aceptación.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible registrar la aceptación.');
    } finally {
      setBusyId(null);
    }
  };

  const uploadRequirement = async (requirement: Requirement, file: File | null) => {
    if (!file) return;
    setBusyId(requirement.id);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const response = await fetch(
        `/api/documentos/${encodeURIComponent(documentId)}/package/requirements/${requirement.id}/upload`,
        { method: 'POST', headers: await authHeaders(), body: form }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No fue posible cargar el archivo.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar el archivo.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-slate-500">
        <RefreshCw size={14} className="mr-2 animate-spin" />
        Cargando paquete...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3">
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </p>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-700 uppercase text-slate-500">Documentos complementarios</h3>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
            {resources.length}
          </span>
        </div>
        {resources.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-500">
            Este documento no tiene recursos complementarios.
          </div>
        ) : (
          <div className="space-y-2">
            {resources.map((resource) => {
              const viewed = interactions.some(
                (item) => item.resource_id === resource.id && item.interaction_type === 'viewed'
              );
              const accepted = interactions.some(
                (item) => item.resource_id === resource.id && item.interaction_type === 'accepted'
              );
              return (
                <article
                  key={resource.id}
                  className="rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-primary">
                      <FileText size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-600 text-slate-900">{resource.title}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {MODE_LABELS[resource.interaction_mode]}
                      </p>
                      {resource.description && (
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          {resource.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void openResource(resource)}
                      disabled={busyId === resource.id}
                      className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Eye size={13} />
                      {viewed ? 'Consultado' : 'Ver'}
                    </button>
                    {resource.interaction_mode === 'downloadable' && (
                      <button
                        type="button"
                        onClick={() => void openResource(resource, true)}
                        disabled={busyId === resource.id}
                        className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Download size={13} />
                        Descargar
                      </button>
                    )}
                    {resource.interaction_mode === 'acceptance_required' && (
                      <button
                        type="button"
                        onClick={() => void acceptResource(resource.id)}
                        disabled={
                          !participantReferenceId || !viewed || accepted || busyId === resource.id
                        }
                        className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-600 text-white disabled:opacity-50"
                        title={!viewed ? 'Consulta el documento antes de aceptarlo' : undefined}
                      >
                        <Check size={13} />
                        {accepted ? 'Aceptado' : 'Aceptar'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {requirements.length > 0 && (
        <section className="mt-5 border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-700 uppercase text-slate-500">Requisitos documentales</h3>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
              {requirements.length}
            </span>
          </div>
          <div className="space-y-2">
            {requirements.map((requirement) => (
              <article
                key={requirement.id}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex items-start gap-2">
                  <Paperclip size={14} className="mt-0.5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-600 text-slate-900">{requirement.name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {requirement.required ? 'Obligatorio' : 'Opcional'} ·{' '}
                      {requirement.status === 'provided' ? 'Archivo recibido' : 'Pendiente'}
                    </p>
                  </div>
                </div>
                {participantReferenceId && !['accepted', 'waived'].includes(requirement.status) && (
                  <>
                    <input
                      ref={(node) => {
                        fileInputs.current[requirement.id] = node;
                      }}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      className="hidden"
                      onChange={(event) => {
                        void uploadRequirement(requirement, event.target.files?.[0] || null);
                        event.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputs.current[requirement.id]?.click()}
                      disabled={busyId === requirement.id}
                      className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 text-xs font-600 text-primary hover:bg-blue-100 disabled:opacity-50"
                    >
                      <Upload size={13} />
                      {busyId === requirement.id
                        ? 'Cargando...'
                        : requirement.status === 'provided'
                          ? 'Reemplazar archivo'
                          : 'Cargar archivo'}
                    </button>
                  </>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
