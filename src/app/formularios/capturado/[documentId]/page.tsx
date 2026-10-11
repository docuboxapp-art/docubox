'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardList, Loader2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';

type CapturedForm = {
  formName: string;
  description: string | null;
  version: number | null;
  respondentName: string | null;
  respondentEmail: string | null;
  submittedAt: string | null;
  folio: string | null;
  sections: Array<{ title: string; fields: Array<{ label: string; value: string }> }>;
};

function formattedDate(value: string | null) {
  if (!value) return 'No disponible';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'No disponible'
    : new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

export default function CapturedFormPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const router = useRouter();
  const [form, setForm] = useState<CapturedForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!documentId) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const {
          data: { session },
        } = await createClient().auth.getSession();
        if (!session?.access_token)
          throw new Error('Inicia sesión para consultar el formulario capturado.');
        const response = await fetch(
          `/api/documentos/${encodeURIComponent(documentId)}/form-response`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
            cache: 'no-store',
            signal: controller.signal,
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'No se pudo consultar el formulario.');
        if (!controller.signal.aborted) setForm(payload as CapturedForm);
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'No se pudo consultar el formulario.'
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [documentId]);

  return (
    <AppLayout noPadding>
      <main className="min-h-full bg-slate-50 px-4 py-6 dark:bg-background sm:px-6">
        <div className="mx-auto max-w-3xl">
          <button
            type="button"
            onClick={() => router.push(`/visor-documento/${encodeURIComponent(documentId)}?tab=form-origin`)}
            className="mb-5 inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-border dark:bg-card dark:text-foreground"
          >
            <ArrowLeft size={16} /> Volver al documento
          </button>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-border dark:bg-card">
              <Loader2
                size={24}
                className="animate-spin text-blue-600"
                aria-label="Cargando formulario capturado"
              />
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-white p-6 text-sm text-red-700 dark:bg-card"
            >
              {error}
            </div>
          ) : form ? (
            <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
              <header className="border-b border-slate-200 p-6 dark:border-border sm:p-8">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <ClipboardList size={22} />
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                  Formulario capturado
                </p>
                <h1 className="mt-2 break-words text-2xl font-semibold text-slate-950 dark:text-foreground">
                  {form.formName}
                </h1>
                {form.description && (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-muted-foreground">
                    {form.description}
                  </p>
                )}
                <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-5 text-sm dark:border-border sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Respondido por</dt>
                    <dd className="mt-1 break-words text-slate-800 dark:text-foreground">
                      {form.respondentName || form.respondentEmail || 'No disponible'}
                    </dd>
                    {form.respondentName && form.respondentEmail && (
                      <dd className="break-all text-xs text-slate-500">{form.respondentEmail}</dd>
                    )}
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Fecha de respuesta</dt>
                    <dd className="mt-1 text-slate-800 dark:text-foreground">
                      {formattedDate(form.submittedAt)}
                    </dd>
                  </div>
                  {form.folio && (
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Folio</dt>
                      <dd className="mt-1 break-all text-slate-800 dark:text-foreground">
                        {form.folio}
                      </dd>
                    </div>
                  )}
                  {form.version && (
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Versión del formulario</dt>
                      <dd className="mt-1 text-slate-800 dark:text-foreground">v{form.version}</dd>
                    </div>
                  )}
                </dl>
              </header>

              <div className="space-y-8 p-6 sm:p-8">
                {form.sections.length ? (
                  form.sections.map((section, index) => (
                    <section key={`${section.title}-${index}`}>
                      <h2 className="border-l-4 border-blue-600 pl-3 text-base font-semibold text-slate-900 dark:text-foreground">
                        {section.title}
                      </h2>
                      <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
                        {section.fields.map((field, fieldIndex) => (
                          <div
                            key={`${field.label}-${fieldIndex}`}
                            className="min-w-0 border-b border-slate-100 pb-3 dark:border-border"
                          >
                            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              {field.label}
                            </dt>
                            <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900 dark:text-foreground">
                              {field.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No hay respuestas visibles para mostrar.</p>
                )}
              </div>
            </article>
          ) : null}
        </div>
      </main>
    </AppLayout>
  );
}
