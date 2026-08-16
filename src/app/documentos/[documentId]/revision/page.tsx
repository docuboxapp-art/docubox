'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { CollaborationProvider, useCollaboration } from '@/contexts/CollaborationContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaborationApi } from '@/lib/collaboration/client';

type ReviewData = {
  document: { id: string; nombre: string; documento_id: string; estado: string; file_name: string };
  versions: Array<{
    id: string;
    version_number: number;
    status: string;
    sha256: string;
    file_url: string | null;
    created_at: string;
  }>;
  rounds: Array<{
    id: string;
    document_version_id: string;
    title: string;
    status: string;
    round_number: number;
    optimistic_version: number;
    due_at: string | null;
  }>;
  comments: Array<{
    id: string;
    document_version_id: string;
    review_round_id: string | null;
    body: string;
    audience: string;
    status: string;
    is_blocking: boolean;
    created_at: string;
    author?: { full_name?: string };
  }>;
};

function ReviewStudio({ documentId }: { documentId: string }) {
  const { activeWorkspace } = useWorkspace();
  const { can } = useCollaboration();
  const api = useCollaborationApi();
  const [data, setData] = useState<ReviewData | null>(null);
  const [versionId, setVersionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    try {
      const payload = await api<{ data: ReviewData }>(
        `/api/colabora/documents/${documentId}?workspace_id=${activeWorkspace.id}`
      );
      setData(payload.data);
      setVersionId((current) => current || payload.data.versions[0]?.id || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la revision.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id, api, documentId]);
  useEffect(() => {
    load();
  }, [load]);
  const selected = data?.versions.find((version) => version.id === versionId);
  const roundsForVersion = useMemo(
    () => (data?.rounds || []).filter((round) => round.document_version_id === versionId),
    [data?.rounds, versionId]
  );
  const currentRound =
    roundsForVersion.find((round) => ['open', 'changes_requested'].includes(round.status)) ||
    roundsForVersion[0];
  const comments = useMemo(
    () => (data?.comments || []).filter((comment) => comment.document_version_id === versionId),
    [data?.comments, versionId]
  );

  const comment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeWorkspace?.id || !versionId) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/documents/${documentId}`, {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action: 'comment',
          document_version_id: versionId,
          review_round_id: currentRound?.id || null,
          body: values.get('body'),
          audience: values.get('audience'),
          comment_type: values.get('blocking') === 'on' ? 'change_request' : 'general',
          is_blocking: values.get('blocking') === 'on',
          recipient_ids: [],
        }),
      });
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo comentar.');
    } finally {
      setSaving(false);
    }
  };

  const decide = async (action: 'approve' | 'request_changes') => {
    if (!activeWorkspace?.id || !currentRound) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/documents/${documentId}`, {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          action,
          review_round_id: currentRound.id,
          optimistic_version: currentRound.optimistic_version,
          note: null,
        }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar la decision.');
    } finally {
      setSaving(false);
    }
  };

  const updateCommentStatus = async (
    commentId: string,
    action: 'resolve_comment' | 'reopen_comment'
  ) => {
    if (!activeWorkspace?.id) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/colabora/documents/${documentId}`, {
        method: 'POST',
        body: JSON.stringify({ workspace_id: activeWorkspace.id, action, comment_id: commentId }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el comentario.');
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="min-h-[560px] grid place-items-center">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  if (!data)
    return (
      <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        {error || 'Revision no disponible.'}
      </div>
    );
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-background">
      <header className="flex flex-col gap-3 border-b border-border bg-background px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/colabora/revisiones"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border"
          >
            <ArrowLeft size={17} />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-medium">{data.document.nombre}</h1>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                {currentRound ? `Ronda ${currentRound.round_number}` : 'Sin ronda'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.document.documento_id} ·{' '}
              {selected ? `Version ${selected.version_number}` : 'Sin version'}
            </p>
          </div>
        </div>
        {currentRound && (
          <div className="flex gap-2">
            {can('reviews.request_changes', true) && (
              <button
                disabled={saving}
                onClick={() => decide('request_changes')}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 text-sm text-amber-700"
              >
                <RefreshCw size={16} /> Solicitar cambios
              </button>
            )}
            {can('reviews.approve', true) && (
              <button
                disabled={saving}
                onClick={() => decide('approve')}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white"
              >
                <CheckCircle2 size={16} /> Aprobar version
              </button>
            )}
          </div>
        )}
      </header>
      {error && (
        <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="grid min-h-[calc(100vh-74px)] lg:grid-cols-[220px_minmax(0,1fr)_360px]">
        <aside className="border-r border-border bg-background p-3">
          <p className="px-2 pb-2 text-xs font-medium uppercase text-muted-foreground">Versiones</p>
          {data.versions.map((version) => (
            <button
              key={version.id}
              onClick={() => setVersionId(version.id)}
              className={`mb-1 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left ${version.id === versionId ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
            >
              <FileText size={17} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">Version {version.version_number}</span>
                <span className="block text-xs capitalize text-muted-foreground">
                  {version.status.replaceAll('_', ' ')}
                </span>
              </span>
            </button>
          ))}
          <Link
            href={`/documentos/${documentId}/versiones`}
            className="mt-3 flex h-9 items-center justify-center rounded-md border border-border text-sm"
          >
            Comparar versiones
          </Link>
        </aside>
        <main className="min-w-0 bg-[#f5f6f8] p-4 lg:p-6">
          {selected?.file_url ? (
            <iframe
              title="Documento en revision"
              src={selected.file_url}
              className="h-[calc(100vh-130px)] w-full border border-border bg-white shadow-sm"
            />
          ) : (
            <div className="grid h-[calc(100vh-130px)] place-items-center border border-border bg-white">
              <div className="max-w-md text-center">
                <FileText size={38} className="mx-auto text-muted-foreground" />
                <h2 className="mt-4 text-lg font-medium">Vista documental</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  La version conserva su hash y metadatos, pero no tiene una URL temporal disponible
                  en este entorno.
                </p>
                <Link
                  href={`/visor-documento/${documentId}`}
                  className="mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white"
                >
                  Abrir visor Docubox
                </Link>
              </div>
            </div>
          )}
        </main>
        <aside className="border-l border-border bg-background">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-medium">Comentarios</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {comments.filter((item) => item.status === 'open').length} abiertos
            </p>
          </div>
          <div className="max-h-[calc(100vh-330px)] divide-y divide-border overflow-y-auto">
            {comments.map((item) => (
              <div key={item.id} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">
                    {item.author?.full_name || 'Miembro del equipo'}
                  </p>
                  {item.is_blocking && <ShieldAlert size={15} className="text-amber-600" />}
                </div>
                <p className="mt-2 text-sm leading-5">{item.body}</p>
                <p className="mt-2 text-xs capitalize text-muted-foreground">
                  {item.audience} ·{' '}
                  {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(
                    new Date(item.created_at)
                  )}
                </p>
                {can('reviews.resolve_comments', true) && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      updateCommentStatus(
                        item.id,
                        item.status === 'open' ? 'resolve_comment' : 'reopen_comment'
                      )
                    }
                    className="mt-3 text-xs font-medium text-primary disabled:opacity-50"
                  >
                    {item.status === 'open' ? 'Marcar resuelto' : 'Reabrir comentario'}
                  </button>
                )}
              </div>
            ))}
            {!comments.length && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <MessageSquareText className="mx-auto mb-3" />
                Sin comentarios.
              </div>
            )}
          </div>
          {can('reviews.comment', true) && selected && (
            <form onSubmit={comment} className="border-t border-border p-4">
              <textarea
                required
                name="body"
                rows={3}
                placeholder="Escribe un comentario..."
                className="w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary"
              />
              <div className="mt-2 flex items-center gap-3">
                <select
                  name="audience"
                  className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                >
                  <option value="internal">Interno</option>
                  <option value="shared">Compartido</option>
                  <option value="formal">Formal</option>
                  <option value="private">Privado</option>
                </select>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" name="blocking" /> Bloqueante
                </label>
                <button
                  disabled={saving}
                  className="grid h-9 w-9 place-items-center rounded-md bg-primary text-white"
                >
                  <Send size={15} />
                </button>
              </div>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function ReviewStudioPage({ params }: { params: Promise<{ documentId: string }> }) {
  const [documentId, setDocumentId] = useState('');
  useEffect(() => {
    params.then((value) => setDocumentId(value.documentId));
  }, [params]);
  return (
    <AppLayout noPadding>
      {documentId && (
        <CollaborationProvider>
          <ReviewStudio documentId={documentId} />
        </CollaborationProvider>
      )}
    </AppLayout>
  );
}
