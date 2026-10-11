'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ClipboardList,
  Eye,
  FileCheck2,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';

type ResponseRow = {
  id: string;
  response_data: Record<string, unknown>;
  submitted_at: string | null;
  status?: string;
  respondent_name?: string | null;
  respondent_email?: string | null;
  document_id?: string | null;
  folio?: string | null;
  form_tokens?: { recipient_name?: string | null; recipient_email?: string | null } | null;
};
type Field = { id: string; slug?: string; label: string; sectionId?: string; type?: string };
type Section = { id: string; title: string; order?: number };
type Answer = { key: string; label: string; sectionId?: string; type?: string; value: unknown };
type ResponseDetail = {
  response_id: string;
  document_id: string | null;
  signed_pdf_ready: boolean;
  sent_at: string | null;
};
type DetailTab = 'preview' | 'fields' | 'document';
type StatusFilter = 'all' | 'signed' | 'pending';

const dateFormatter = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-border dark:bg-background dark:text-foreground';

function formatDate(value?: string | null) {
  if (!value) return 'No disponible';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No disponible' : dateFormatter.format(date);
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (value === true) return 'Sí';
  if (value === false) return 'No';
  if (typeof value === 'string' && value.startsWith('data:image/')) return 'Imagen capturada';
  if (Array.isArray(value)) return value.map(formatValue).join(', ') || '—';
  if (typeof value === 'object')
    return (
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => `${key.replace(/_/g, ' ')}: ${formatValue(item)}`)
        .join(' · ') || '—'
    );
  return String(value);
}

function searchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function nameOf(response: ResponseRow) {
  return response.respondent_name || response.form_tokens?.recipient_name || 'Participante';
}

function emailOf(response: ResponseRow) {
  return (
    response.respondent_email || response.form_tokens?.recipient_email || 'Correo no disponible'
  );
}

function answersOf(response: ResponseRow, fields: Field[]): Answer[] {
  const answers = response.response_data || {};
  const used = new Set<string>();
  const ordered = fields
    .filter((field) => !['divider', 'texto_bloque', 'imagen_estatica'].includes(field.type || ''))
    .map((field) => {
      const key = Object.hasOwn(answers, field.id)
        ? field.id
        : field.slug && Object.hasOwn(answers, field.slug)
          ? field.slug
          : null;
      if (key) used.add(key);
      return {
        key: field.id,
        label: field.label,
        sectionId: field.sectionId,
        type: field.type,
        value: key ? answers[key] : null,
      };
    });
  const extras = Object.entries(answers)
    .filter(([key]) => !used.has(key))
    .map(([key, value]) => ({ key, label: key.replace(/_/g, ' '), value }));
  return [...ordered, ...extras];
}

function answerText(answer: Answer, response: ResponseRow) {
  if (
    response.status === 'signed' &&
    ['signature_block', 'firma_click', 'firma_efirma'].includes(answer.type || '') &&
    (answer.value === null || answer.value === undefined || answer.value === '')
  ) {
    return 'Firma registrada. La estampa se consulta en el PDF firmado y certificado.';
  }
  return formatValue(answer.value);
}

function ResponsesContent() {
  const router = useRouter();
  const formId = useSearchParams().get('id');
  const [formName, setFormName] = useState('Formulario');
  const [formDescription, setFormDescription] = useState('');
  const [fields, setFields] = useState<Field[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [tab, setTab] = useState<DetailTab>('preview');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [detail, setDetail] = useState<ResponseDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!formId) return;
    let cancelled = false;
    const load = async () => {
      const supabase = createClient();
      const formResult = await supabase
        .from('form_templates')
        .select('name,description,status,schema,form_schema')
        .eq('id', formId)
        .single();
      if (cancelled) return;
      if (
        formResult.error ||
        !formResult.data ||
        !['published', 'paused'].includes(formResult.data.status)
      ) {
        setUnavailable(true);
        setLoading(false);
        return;
      }
      const form = formResult.data;
      const formSchema = form.form_schema as { fields?: Field[]; sections?: Section[] } | null;
      setFields(
        Array.isArray(formSchema?.fields)
          ? formSchema.fields
          : Array.isArray(form.schema)
            ? form.schema
            : []
      );
      setSections(Array.isArray(formSchema?.sections) ? formSchema.sections : []);
      setFormName(form.name);
      setFormDescription(form.description || '');
      setUnavailable(false);
      const responseResult = await supabase
        .from('form_responses')
        .select(
          'id,response_data,submitted_at,status,respondent_name,respondent_email,document_id,folio,form_tokens(recipient_name,recipient_email)'
        )
        .eq('template_id', formId)
        .order('submitted_at', { ascending: false });
      if (cancelled) return;
      if (responseResult.error) {
        setLoadError(
          'No se pudieron cargar las respuestas. Actualiza la página para intentar de nuevo.'
        );
      } else {
        const rows = (responseResult.data || []) as ResponseRow[];
        setResponses(rows);
        setSelectedId((current) =>
          current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null
        );
      }
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [formId]);

  const filtered = useMemo(() => {
    const needle = searchText(query);
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    return responses.filter((response) => {
      if (statusFilter === 'signed' && response.status !== 'signed') return false;
      if (statusFilter === 'pending' && response.status === 'signed') return false;
      const submitted = response.submitted_at ? new Date(response.submitted_at).getTime() : 0;
      if (from !== null && submitted < from) return false;
      if (to !== null && submitted > to) return false;
      if (!needle) return true;
      const searchable = [
        nameOf(response),
        emailOf(response),
        response.id,
        response.folio || '',
        ...Object.entries(response.response_data || {}).flatMap(([key, value]) => [
          key,
          formatValue(value),
        ]),
      ];
      return searchText(searchable.join(' ')).includes(needle);
    });
  }, [responses, query, statusFilter, fromDate, toDate]);

  const selected = filtered.find((response) => response.id === selectedId) || filtered[0] || null;
  const selectedResponseId = selected?.id;
  const selectedDocumentId = selected?.document_id;
  const currentDetail = detail?.response_id === selectedResponseId ? detail : null;
  const answers = selected ? answersOf(selected, fields) : [];
  const hasFilters = Boolean(query || fromDate || toDate || statusFilter !== 'all');

  useEffect(() => {
    if (!selectedResponseId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loadDetail = async (showBusy: boolean) => {
      if (showBusy) setDetailBusy(true);
      try {
        const { data } = await createClient().auth.getSession();
        if (!data.session?.access_token) throw new Error('Tu sesión expiró.');
        const result = await fetch(`/api/formularios/respuestas/${selectedResponseId}/detalle`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
        });
        const payload = await result.json();
        if (!result.ok) throw new Error(payload.error || 'No se pudo consultar el detalle.');
        if (cancelled) return;
        const next: ResponseDetail = {
          response_id: selectedResponseId,
          document_id: payload.document_id || selectedDocumentId || null,
          signed_pdf_ready: payload.signed_pdf_ready === true,
          sent_at: payload.sent_at || null,
        };
        setDetail(next);
        setDetailError('');
        if (!next.signed_pdf_ready) timer = setTimeout(() => void loadDetail(false), 20_000);
      } catch (error) {
        if (!cancelled)
          setDetailError(
            error instanceof Error ? error.message : 'No se pudo consultar el detalle.'
          );
      } finally {
        if (!cancelled && showBusy) setDetailBusy(false);
      }
    };
    void loadDetail(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selectedResponseId, selectedDocumentId, refreshKey]);

  const clearFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setFromDate('');
    setToDate('');
  };
  const openSignedPdf = () => {
    const documentId = currentDetail?.document_id || selected?.document_id;
    if (documentId && currentDetail?.signed_pdf_ready)
      router.push(`/visor-documento/${documentId}`);
  };

  if (!formId || (!loading && unavailable))
    return (
      <AppLayout noPadding>
        <div className="mx-auto max-w-[1500px] px-6 py-8">
          <button
            type="button"
            onClick={() => router.push('/formularios')}
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ArrowLeft size={16} /> Volver a formularios
          </button>
          <h1 className="mt-8 text-xl font-semibold">Respuestas no disponibles</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Solo puedes consultar respuestas de formularios publicados o pausados.
          </p>
        </div>
      </AppLayout>
    );

  return (
    <AppLayout noPadding>
      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
        <header className="flex items-center gap-3 border-b border-slate-200 pb-5 dark:border-border">
          <button
            type="button"
            onClick={() => router.push('/formularios')}
            aria-label="Volver a formularios"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-border"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-slate-950 dark:text-foreground">
              Respuestas
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              {formName} · {responses.length} {responses.length === 1 ? 'registro' : 'registros'}
            </p>
          </div>
        </header>
        <div className="grid gap-4 py-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section
            aria-label="Lista de respuestas"
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card"
          >
            <div className="space-y-3 border-b border-slate-200 p-4 dark:border-border">
              <div className="relative">
                <Search
                  size={17}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="search"
                  aria-label="Buscar respuestas"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por nombre, correo, folio o respuesta"
                  className={`${inputClass} pl-10`}
                />
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[150px] flex-1 text-[11px] font-medium text-slate-600">
                  Estado
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className={`${inputClass} mt-1 !h-9 !text-xs`}
                  >
                    <option value="all">Todos los estados</option>
                    <option value="signed">Firmadas</option>
                    <option value="pending">Pendientes de firma</option>
                  </select>
                </label>
                <label className="min-w-[140px] flex-1 text-[11px] font-medium text-slate-600">
                  Respuesta desde
                  <input
                    type="date"
                    value={fromDate}
                    max={toDate || undefined}
                    onChange={(event) => setFromDate(event.target.value)}
                    className={`${inputClass} mt-1 !h-9 !text-xs`}
                  />
                </label>
                <label className="min-w-[140px] flex-1 text-[11px] font-medium text-slate-600">
                  Respuesta hasta
                  <input
                    type="date"
                    value={toDate}
                    min={fromDate || undefined}
                    onChange={(event) => setToDate(event.target.value)}
                    className={`${inputClass} mt-1 !h-9 !text-xs`}
                  />
                </label>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-blue-700 hover:bg-blue-50"
                  >
                    <X size={14} /> Limpiar
                  </button>
                )}
              </div>
              <p aria-live="polite" className="text-xs text-slate-500">
                {filtered.length} de {responses.length} respuestas
              </p>
            </div>
            {loading ? (
              <div className="flex min-h-[420px] items-center justify-center">
                <Loader2 size={24} className="animate-spin text-blue-600" />
              </div>
            ) : loadError ? (
              <p role="alert" className="p-6 text-sm text-red-600">
                {loadError}
              </p>
            ) : filtered.length ? (
              <div className="divide-y divide-slate-100 dark:divide-border">
                {filtered.map((response) => (
                  <button
                    key={response.id}
                    type="button"
                    aria-pressed={selected?.id === response.id}
                    onClick={() => {
                      setSelectedId(response.id);
                      setTab('preview');
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-muted/30 ${selected?.id === response.id ? 'bg-blue-50/70 dark:bg-blue-950/20' : ''}`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${response.status === 'signed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                    >
                      <FileCheck2 size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900 dark:text-foreground">
                        {nameOf(response)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {emailOf(response)}
                      </span>
                      <span className="mt-1 block text-[11px] text-slate-500">
                        Respuesta: {formatDate(response.submitted_at)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${response.status === 'signed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                    >
                      {response.status === 'signed' ? 'Firmada' : 'Pendiente de firma'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
                <Search size={24} className="text-slate-400" />
                <p className="mt-3 text-sm font-medium">
                  {hasFilters ? 'No hay respuestas con estos filtros' : 'Aún no hay respuestas'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {hasFilters
                    ? 'Cambia la búsqueda o limpia los filtros.'
                    : 'Las respuestas enviadas aparecerán aquí.'}
                </p>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-4 text-xs font-medium text-blue-700 hover:underline"
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
            )}
          </section>
          <aside
            aria-label="Detalle de respuesta"
            className="self-start overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card"
          >
            {selected ? (
              <>
                <header className="border-b border-slate-200 p-4 dark:border-border">
                  <p className="text-sm font-semibold">Detalle de respuesta</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    ID {selected.id.slice(0, 8).toUpperCase()}
                  </p>
                  <p className="mt-3 text-sm font-medium">{nameOf(selected)}</p>
                  <p className="mt-0.5 break-all text-xs text-slate-500">{emailOf(selected)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 dark:bg-muted/40">
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">
                        Envío de invitación
                      </dt>
                      <dd className="mt-1 text-xs font-medium">
                        {detailBusy && !currentDetail
                          ? 'Consultando…'
                          : formatDate(currentDetail?.sent_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">
                        Respuesta recibida
                      </dt>
                      <dd className="mt-1 text-xs font-medium">
                        {formatDate(selected.submitted_at)}
                      </dd>
                    </div>
                  </dl>
                </header>
                <div className="border-b border-slate-200 p-4 dark:border-border">
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    <Eye size={16} /> Ver formulario contestado
                  </button>
                </div>
                <div
                  role="tablist"
                  aria-label="Información de la respuesta"
                  className="flex gap-1 border-b border-slate-200 px-3 pt-2 dark:border-border"
                >
                  {(
                    [
                      ['preview', 'Vista previa', Eye],
                      ['fields', 'Campos', ClipboardList],
                      ['document', 'PDF firmado', FileText],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => setTab(key)}
                      className={`inline-flex flex-1 items-center justify-center gap-1 border-b-2 px-1 py-2.5 text-[11px] font-medium ${tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                      <Icon size={14} /> {label}
                    </button>
                  ))}
                </div>
                {tab === 'preview' && (
                  <div role="tabpanel" className="space-y-3 p-4">
                    <p className="text-xs text-slate-500">Vista rápida de los datos capturados</p>
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-border dark:border-border">
                      {answers.slice(0, 5).map((answer) => (
                        <div key={answer.key} className="px-3 py-2.5">
                          <p className="text-[10px] font-medium uppercase text-slate-500">
                            {answer.label}
                          </p>
                          <p className="mt-1 break-words text-xs">{answerText(answer, selected)}</p>
                        </div>
                      ))}
                      {answers.length === 0 && (
                        <p className="p-3 text-xs text-slate-500">No hay campos capturados.</p>
                      )}
                    </div>
                    {answers.length > 5 && (
                      <button
                        type="button"
                        onClick={() => setTab('fields')}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Ver los {answers.length} campos
                      </button>
                    )}
                  </div>
                )}
                {tab === 'fields' && (
                  <div role="tabpanel" className="max-h-[540px] overflow-y-auto p-4">
                    <p className="mb-3 text-xs text-slate-500">
                      Campos y respuestas del formulario
                    </p>
                    <dl className="space-y-3">
                      {answers.map((answer) => (
                        <div
                          key={answer.key}
                          className="rounded-lg border border-slate-200 p-3 dark:border-border"
                        >
                          <dt className="text-[10px] font-medium uppercase text-slate-500">
                            {answer.label}
                          </dt>
                          <dd className="mt-1 break-words text-xs leading-5">
                            {answerText(answer, selected)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {answers.length === 0 && (
                      <p className="text-xs text-slate-500">No hay campos capturados.</p>
                    )}
                  </div>
                )}
                {tab === 'document' && (
                  <div role="tabpanel" className="space-y-3 p-4">
                    <p className="text-sm font-medium">PDF firmado y certificado</p>
                    {currentDetail?.signed_pdf_ready ? (
                      <>
                        <p className="text-xs leading-5 text-slate-600">
                          El documento final ya está disponible para consultar en el visor.
                        </p>
                        <button
                          type="button"
                          onClick={openSignedPdf}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                        >
                          <Eye size={16} /> Ver PDF firmado
                        </button>
                      </>
                    ) : (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                        {detailBusy && !currentDetail
                          ? 'Comprobando la certificación del documento…'
                          : 'El PDF firmado aún no se puede visualizar. Estará disponible cuando concluya la certificación y la verificación NOM-151.'}
                      </p>
                    )}
                    {detailError && (
                      <p role="alert" className="text-xs text-red-600">
                        {detailError}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setRefreshKey((current) => current + 1)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline"
                    >
                      <RefreshCw size={13} /> Actualizar estado
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center p-6 text-center">
                <Eye size={23} className="text-slate-400" />
                <p className="mt-3 text-sm font-medium">Selecciona una respuesta</p>
                <p className="mt-1 text-xs text-slate-500">
                  Consulta sus campos y el estado del PDF firmado.
                </p>
              </div>
            )}
          </aside>
        </div>
        {previewOpen && selected && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setPreviewOpen(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="response-preview-title"
              className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-slate-100 shadow-2xl dark:bg-background"
            >
              <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 dark:border-border dark:bg-card">
                <div>
                  <h2 id="response-preview-title" className="text-base font-semibold">
                    Formulario contestado
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {nameOf(selected)} · {formatDate(selected.submitted_at)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar vista previa"
                  onClick={() => setPreviewOpen(false)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                >
                  <X size={19} />
                </button>
              </header>
              <div className="overflow-y-auto p-4 sm:p-7">
                <article className="mx-auto max-w-2xl space-y-6 bg-white p-5 shadow-sm sm:p-9 dark:bg-card">
                  <header className="border-b border-slate-200 pb-5 dark:border-border">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">
                      Docubox · Respuesta registrada
                    </p>
                    <h3 className="mt-2 text-xl font-semibold">{formName}</h3>
                    {formDescription && (
                      <p className="mt-2 text-sm text-slate-500">{formDescription}</p>
                    )}
                    <p className="mt-3 text-xs text-slate-500">
                      Respondido por {nameOf(selected)} · {emailOf(selected)}
                    </p>
                  </header>
                  {(sections.length
                    ? [...sections].sort((a, b) => (a.order || 0) - (b.order || 0))
                    : [{ id: '', title: 'Datos del formulario' }]
                  ).map((section) => {
                    const sectionAnswers = answers.filter((answer) =>
                      sections.length ? answer.sectionId === section.id : true
                    );
                    return sectionAnswers.length ? (
                      <section key={section.id}>
                        <h4 className="border-l-4 border-blue-600 pl-3 text-sm font-semibold">
                          {section.title}
                        </h4>
                        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                          {sectionAnswers.map((answer) => (
                            <div
                              key={answer.key}
                              className="border-b border-slate-200 pb-2 dark:border-border"
                            >
                              <dt className="text-[10px] font-medium uppercase text-slate-500">
                                {answer.label}
                              </dt>
                              <dd className="mt-1 break-words text-sm">
                                {answerText(answer, selected)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    ) : null;
                  })}
                  {sections.length > 0 &&
                    answers.some(
                      (answer) =>
                        !answer.sectionId ||
                        !sections.some((section) => section.id === answer.sectionId)
                    ) && (
                      <section>
                        <h4 className="border-l-4 border-blue-600 pl-3 text-sm font-semibold">
                          Otros campos
                        </h4>
                        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                          {answers
                            .filter(
                              (answer) =>
                                !answer.sectionId ||
                                !sections.some((section) => section.id === answer.sectionId)
                            )
                            .map((answer) => (
                              <div
                                key={answer.key}
                                className="border-b border-slate-200 pb-2 dark:border-border"
                              >
                                <dt className="text-[10px] font-medium uppercase text-slate-500">
                                  {answer.label}
                                </dt>
                                <dd className="mt-1 break-words text-sm">
                                  {answerText(answer, selected)}
                                </dd>
                              </div>
                            ))}
                        </dl>
                      </section>
                    )}
                  {answers.length === 0 && (
                    <p className="text-sm text-slate-500">
                      No hay campos capturados para esta respuesta.
                    </p>
                  )}
                  <footer className="border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-border">
                    Respuesta recibida: {formatDate(selected.submitted_at)}
                  </footer>
                </article>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export default function ResponsesPage() {
  return (
    <Suspense fallback={null}>
      <ResponsesContent />
    </Suspense>
  );
}
