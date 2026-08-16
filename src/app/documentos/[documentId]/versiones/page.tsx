'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileDiff, Loader2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaborationApi } from '@/lib/collaboration/client';

type Version = {
  id: string;
  version_number: number;
  status: string;
  sha256: string;
  byte_size: number | null;
  page_count: number | null;
  change_reason: string | null;
  created_at: string;
};

export default function VersionComparatorPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { activeWorkspace } = useWorkspace();
  const api = useCollaborationApi();
  const [documentId, setDocumentId] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [loading, setLoading] = useState(true);
  const [comparisonReady, setComparisonReady] = useState(false);
  const [comparisonError, setComparisonError] = useState('');
  const comparisonKeys = useRef(new Map<string, string>());

  useEffect(() => {
    params.then((value) => setDocumentId(value.documentId));
  }, [params]);

  useEffect(() => {
    if (!activeWorkspace?.id || !documentId) return;
    api<{ data: Version[] }>(
      `/api/colabora/resources/versions?workspace_id=${activeWorkspace.id}&document_id=${documentId}`
    )
      .then((payload) => {
        setVersions(payload.data);
        setLeftId(payload.data[1]?.id || payload.data[0]?.id || '');
        setRightId(payload.data[0]?.id || '');
      })
      .finally(() => setLoading(false));
  }, [activeWorkspace?.id, api, documentId]);

  const left = useMemo(() => versions.find((item) => item.id === leftId), [leftId, versions]);
  const right = useMemo(
    () => versions.find((item) => item.id === rightId),
    [rightId, versions]
  );

  useEffect(() => {
    if (!activeWorkspace?.id || !documentId || !leftId || !rightId || leftId === rightId) {
      setComparisonReady(false);
      setComparisonError(
        leftId && rightId && leftId === rightId ? 'Selecciona dos versiones diferentes.' : ''
      );
      return;
    }

    const pairKey = [leftId, rightId].sort().join(':');
    let idempotencyKey = comparisonKeys.current.get(pairKey);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      comparisonKeys.current.set(pairKey, idempotencyKey);
    }

    let active = true;
    setComparisonReady(false);
    setComparisonError('');
    api('/api/colabora/comparisons', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: activeWorkspace.id,
        document_id: documentId,
        left_version_id: leftId,
        right_version_id: rightId,
        idempotency_key: idempotencyKey,
      }),
    })
      .then(() => {
        if (active) setComparisonReady(true);
      })
      .catch((error: Error) => {
        if (active) setComparisonError(error.message);
      });
    return () => {
      active = false;
    };
  }, [activeWorkspace?.id, api, documentId, leftId, rightId]);

  const rows = left && right
    ? [
        ['Estado', left.status, right.status],
        ['Hash SHA-256', left.sha256, right.sha256],
        ['Tamano', left.byte_size, right.byte_size],
        ['Paginas', left.page_count, right.page_count],
        ['Motivo', left.change_reason, right.change_reason],
        ['Creada', left.created_at, right.created_at],
      ]
    : [];

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-64px)] bg-slate-50 p-5 md:-my-6 lg:p-7 dark:bg-background">
        <div className="mx-auto max-w-[1450px] space-y-5">
          <div>
            <Link
              href={`/documentos/${documentId}/revision`}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground"
            >
              <ArrowLeft size={16} /> Volver a revision
            </Link>
            <h1 className="mt-4 text-2xl font-medium">Comparador de versiones</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Compara metadatos inmutables y huellas del documento.
            </p>
          </div>

          {loading ? (
            <div className="grid min-h-96 place-items-center">
              <Loader2 className="animate-spin text-primary" />
            </div>
          ) : (
            <>
              <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
                <div className="bg-background p-4">
                  <label className="text-xs font-medium uppercase text-muted-foreground">
                    Version base
                    <select
                      value={leftId}
                      onChange={(event) => setLeftId(event.target.value)}
                      className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm normal-case"
                    >
                      <option value="">Seleccionar</option>
                      {versions.map((item) => (
                        <option key={item.id} value={item.id}>
                          Version {item.version_number}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="bg-background p-4">
                  <label className="text-xs font-medium uppercase text-muted-foreground">
                    Version comparada
                    <select
                      value={rightId}
                      onChange={(event) => setRightId(event.target.value)}
                      className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm normal-case"
                    >
                      <option value="">Seleccionar</option>
                      {versions.map((item) => (
                        <option key={item.id} value={item.id}>
                          Version {item.version_number}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              {comparisonError ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                  {comparisonError}
                </div>
              ) : left && right && comparisonReady ? (
                <section className="overflow-hidden rounded-lg border border-border bg-background">
                  <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                    <FileDiff size={18} className="text-primary" />
                    <div>
                      <h2 className="font-medium">Resultado estructural</h2>
                      <p className="text-xs text-muted-foreground">
                        La comparacion no altera ninguna version.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-px bg-border md:grid-cols-[220px_1fr_1fr]">
                    <div className="hidden bg-muted/40 md:block" />
                    {[left, right].map((item) => (
                      <div key={item.id} className="bg-muted/40 px-5 py-3 text-sm font-medium">
                        Version {item.version_number}
                      </div>
                    ))}
                    {rows.flatMap(([label, first, second]) => [
                      <div
                        key={`${label}-label`}
                        className="bg-background px-5 py-4 text-xs font-medium uppercase text-muted-foreground"
                      >
                        {label}
                      </div>,
                      <div key={`${label}-first`} className="break-all bg-background px-5 py-4 text-sm">
                        {first == null ? '-' : String(first)}
                      </div>,
                      <div
                        key={`${label}-second`}
                        className={`break-all bg-background px-5 py-4 text-sm ${first !== second ? 'text-primary' : ''}`}
                      >
                        {second == null ? '-' : String(second)}
                      </div>,
                    ])}
                  </div>
                  <div
                    className={`border-t px-5 py-4 text-sm ${
                      left.sha256 === right.sha256
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {left.sha256 === right.sha256
                      ? 'Las huellas son iguales.'
                      : 'Las huellas son distintas: existe un cambio binario entre versiones.'}
                  </div>
                </section>
              ) : left && right ? (
                <div className="grid min-h-40 place-items-center rounded-lg border border-border bg-background">
                  <Loader2 className="animate-spin text-primary" />
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-background p-16 text-center text-sm text-muted-foreground">
                  Selecciona dos versiones.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
