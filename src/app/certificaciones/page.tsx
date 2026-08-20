'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Archive, ArrowRight, BadgeCheck, Clock3, Layers3, Plus, Search, ShieldCheck } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { CertificationHeader, CertificationStatusBadge, CertificationWorkspace, EmptyCertification, SandboxNotice } from '@/components/certifica/CertificationUI';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCertificaApi } from '@/lib/certifica/client';
import { CERTIFICATION_SERVICES } from '@/lib/certifica/domain';

type CaseRow = { id: string; human_folio: string; title: string; service_key: keyof typeof CERTIFICATION_SERVICES; status: string; provider_mode: string; original_filename?: string; created_at: string; warnings?: string[] };

export default function CertificationsPage() {
  const { activeWorkspace } = useWorkspace();
  const api = useCertificaApi();
  const [items, setItems] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (!activeWorkspace?.id) return; setLoading(true); api<{ cases: CaseRow[] }>(`/api/certifica/cases?workspace_id=${activeWorkspace.id}`).then((data) => setItems(data.cases)).catch((cause) => setError(cause.message)).finally(() => setLoading(false)); }, [activeWorkspace?.id, api]);
  const metrics = useMemo(() => ({ issued: items.filter((item) => ['issued', 'validated', 'stored', 'issued_with_warnings'].includes(item.status)).length, processing: items.filter((item) => ['analyzing', 'submitted_to_psc', 'processing'].includes(item.status)).length, incidents: items.filter((item) => ['provider_error', 'requires_review', 'rejected'].includes(item.status)).length, custody: items.filter((item) => ['stored', 'retention_due'].includes(item.status)).length }), [items]);
  const filtered = items.filter((item) => `${item.human_folio} ${item.title} ${item.original_filename || ''}`.toLowerCase().includes(query.toLowerCase()));
  return <AppLayout noPadding><CertificationWorkspace>
    <CertificationHeader title="Docubox Certifica" description="Certifica integridad, existencia, conservacion y evidencia sin alterar el documento original." actions={<><Link href="/certificaciones/lotes/nuevo" className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"><Layers3 size={15} />Certificar lote</Link><Link href="/certificaciones/nueva" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-semibold text-white"><Plus size={16} />Nueva certificacion</Link></>} />
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Emitidas y validadas" value={metrics.issued} icon={BadgeCheck} tone="green" /><Metric label="En proceso" value={metrics.processing} icon={Clock3} tone="blue" /><Metric label="Con incidencias" value={metrics.incidents} icon={AlertTriangle} tone="red" /><Metric label="Bajo custodia" value={metrics.custody} icon={Archive} tone="amber" /></div>
    <SandboxNotice />
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card"><header className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-semibold">Certificaciones recientes</h2><p className="mt-0.5 text-xs text-slate-500">Actividad del espacio de trabajo seleccionado.</p></div><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar folio o documento" className="h-9 w-64 rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-primary" /></div></header>
        {error ? <p className="p-5 text-sm text-red-600">{error}</p> : loading ? <div className="flex min-h-64 items-center justify-center"><span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" /></div> : filtered.length === 0 ? <EmptyCertification title="Aun no hay certificaciones" message="Inicia una certificacion para conservar el original, calcular su huella y emitir evidencia verificable." /> : <div className="divide-y divide-slate-200">{filtered.map((item) => <Link href={`/certificaciones/${item.id}`} key={item.id} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-slate-50"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-primary"><ShieldCheck size={17} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.title}</span><span className="mt-0.5 block text-xs text-slate-500">{item.human_folio} · {CERTIFICATION_SERVICES[item.service_key]?.name || item.service_key}</span></span><CertificationStatusBadge status={item.status} /><ArrowRight size={15} className="text-slate-400" /></Link>)}</div>}
      </section>
      <aside className="space-y-4"><section className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="text-sm font-semibold">Accesos de confianza</h2><div className="mt-3 space-y-1"><Quick href="/certificaciones/conservados" label="Documentos conservados" /><Quick href="/verificar-certificacion" label="Verificador publico" /><Quick href="/certificaciones/configuracion" label="Estado del proveedor" /></div></section><section className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="text-sm font-semibold">Consumo del periodo</h2><p className="mt-3 text-2xl font-semibold">{metrics.issued}</p><p className="text-xs text-slate-500">operaciones registradas en este espacio</p><div className="mt-3 h-1.5 rounded-full bg-slate-100"><div className="h-full w-[18%] rounded-full bg-primary" /></div></section></aside>
    </div>
  </CertificationWorkspace></AppLayout>;
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: string }) { const colors: Record<string, string> = { green: 'bg-emerald-50 text-emerald-700', blue: 'bg-blue-50 text-primary', red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700' }; return <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium text-slate-500">{label}</p><span className={`flex h-8 w-8 items-center justify-center rounded-md ${colors[tone]}`}><Icon size={16} /></span></div><p className="mt-2 text-2xl font-semibold">{value}</p></div>; }
function Quick({ href, label }: { href: string; label: string }) { return <Link href={href} className="flex items-center justify-between rounded-md px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-primary"><span>{label}</span><ArrowRight size={14} /></Link>; }

