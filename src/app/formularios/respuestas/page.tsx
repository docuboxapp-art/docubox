'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Download, Eye, FileCheck2, Loader2, Search, ShieldCheck } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';

interface ResponseRow { id: string; response_data: Record<string, unknown>; submitted_at: string; ip_address?: string; pdf_output_hash?: string; pdf_output_path?: string; status?: string; respondent_email?: string; }

function ResponsesContent() {
  const router = useRouter();
  const formId = useSearchParams().get('id');
  const [formName, setFormName] = useState('Formulario');
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [selected, setSelected] = useState<ResponseRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!formId) { setLoading(false); return; }
    const load = async () => {
      const supabase = createClient();
      const [{ data: form }, { data }] = await Promise.all([
        supabase.from('form_templates').select('name').eq('id', formId).single(),
        supabase.from('form_responses').select('*').eq('template_id', formId).order('submitted_at', { ascending: false }),
      ]);
      if (form?.name) setFormName(form.name);
      setResponses(data || []);
      setLoading(false);
    };
    load();
  }, [formId]);

  const filtered = useMemo(() => responses.filter((response) => JSON.stringify(response.response_data).toLowerCase().includes(query.toLowerCase()) || (response.respondent_email || '').toLowerCase().includes(query.toLowerCase())), [responses, query]);

  return <AppLayout noPadding><div className="mx-auto max-w-[1500px]"><header className="flex items-center gap-3 border-b border-[#EBEBF0] pb-5 dark:border-border"><button type="button" onClick={() => router.push('/formularios')} className="flex h-9 w-9 items-center justify-center rounded-md border border-[#EBEBF0] text-[#52525B] hover:bg-[#F4F4F5] dark:border-border"><ArrowLeft size={15} /></button><div><h1 className="text-xl font-semibold text-[#18181B] dark:text-foreground">Respuestas</h1><p className="mt-1 text-xs text-[#71717A]">{formName} · {responses.length} registros</p></div></header><div className="grid gap-4 py-5 xl:grid-cols-[minmax(0,1fr)_380px]"><section className="overflow-hidden rounded-md border border-[#EBEBF0] bg-white dark:border-border dark:bg-card"><div className="border-b border-[#EBEBF0] p-4 dark:border-border"><div className="relative max-w-md"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en respuestas" className="h-9 w-full rounded-md border border-[#EBEBF0] bg-[#F8F8FB] pl-9 pr-3 text-xs outline-none focus:border-[#4F46E5] dark:border-border dark:bg-background" /></div></div>{loading ? <div className="flex min-h-[420px] items-center justify-center"><Loader2 size={22} className="animate-spin text-[#4F46E5]" /></div> : filtered.length ? <div className="divide-y divide-[#EBEBF0] dark:divide-border">{filtered.map((response, index) => <button key={response.id} type="button" onClick={() => setSelected(response)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#FAFAFC] dark:hover:bg-muted/30 ${selected?.id === response.id ? 'bg-[#F7F7FF]' : ''}`}><span className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><FileCheck2 size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[#18181B] dark:text-foreground">Respuesta {filtered.length - index}</span><span className="mt-0.5 block text-xs text-[#71717A]">{response.respondent_email || 'Participante por enlace'} · {new Date(response.submitted_at).toLocaleString('es-MX')}</span></span><span className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">{response.status === 'signed' ? 'Firmada' : 'Enviada'}</span></button>)}</div> : <div className="flex min-h-[420px] flex-col items-center justify-center text-center"><FileCheck2 size={24} className="text-[#A1A1AA]" /><p className="mt-3 text-sm font-medium">Aún no hay respuestas</p><p className="mt-1 text-xs text-[#71717A]">Las respuestas enviadas aparecerán aquí.</p></div>}</section><aside className="rounded-md border border-[#EBEBF0] bg-white dark:border-border dark:bg-card">{selected ? <div><header className="flex items-center justify-between border-b border-[#EBEBF0] p-4 dark:border-border"><div><p className="text-sm font-semibold">Detalle de respuesta</p><p className="mt-1 text-[11px] text-[#71717A]">ID {selected.id.slice(0, 8).toUpperCase()}</p></div><button type="button" className="flex h-8 items-center gap-1.5 rounded-md border border-[#EBEBF0] px-2.5 text-xs"><Eye size={13} /> PDF</button></header><dl className="space-y-4 p-4">{Object.entries(selected.response_data || {}).map(([key, value]) => <div key={key}><dt className="text-[10px] font-semibold uppercase text-[#71717A]">{key.replace(/_/g, ' ')}</dt><dd className="mt-1 break-words text-xs leading-5 text-[#27272A] dark:text-foreground">{formatValue(value)}</dd></div>)}</dl><div className="border-t border-[#EBEBF0] p-4 dark:border-border"><div className="rounded-md border border-emerald-200 bg-emerald-50 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-emerald-800"><ShieldCheck size={14} /> Evidencia registrada</div><p className="mt-1 text-[10px] leading-4 text-emerald-700">IP, user agent, fecha, hashes por campo y evento de envío.</p></div></div></div> : <div className="flex min-h-[420px] flex-col items-center justify-center p-6 text-center"><Eye size={22} className="text-[#A1A1AA]" /><p className="mt-3 text-sm font-medium">Selecciona una respuesta</p><p className="mt-1 text-xs leading-5 text-[#71717A]">Consulta sus datos, evidencia y PDF generado.</p></div>}</aside></div></div></AppLayout>;
}

function formatValue(value: unknown): string { if (value === true) return 'Sí'; if (value === false) return 'No'; if (Array.isArray(value)) return value.join(', '); if (value && typeof value === 'object') return JSON.stringify(value); return String(value ?? '—'); }
export default function ResponsesPage() { return <Suspense fallback={null}><ResponsesContent /></Suspense>; }
