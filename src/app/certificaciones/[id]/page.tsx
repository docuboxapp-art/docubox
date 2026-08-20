'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CalendarClock, Copy, Download, FileCheck2, Fingerprint, History, ShieldCheck } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { CertificationHeader, CertificationStatusBadge, CertificationWorkspace, SandboxNotice } from '@/components/certifica/CertificationUI';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCertificaApi } from '@/lib/certifica/client';
import { CERTIFICATION_SERVICES } from '@/lib/certifica/domain';

type Payload = { case: any; files: any[]; signatures: any[]; evidences: any[]; events: any[]; declaration?: any; manifest?: any };
export default function CertificationDetailPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const { activeWorkspace } = useWorkspace(); const api = useCertificaApi(); const [data, setData] = useState<Payload | null>(null); const [error, setError] = useState('');
  useEffect(() => { if (!activeWorkspace?.id || !id) return; api<Payload>(`/api/certifica/cases/${id}?workspace_id=${activeWorkspace.id}`).then(setData).catch((cause) => setError(cause.message)); }, [activeWorkspace?.id, api, id]);
  if (error) return <AppLayout noPadding><CertificationWorkspace><p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p></CertificationWorkspace></AppLayout>;
  if (!data) return <AppLayout noPadding><CertificationWorkspace><div className="flex min-h-96 items-center justify-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" /></div></CertificationWorkspace></AppLayout>;
  const item = data.case; const service = CERTIFICATION_SERVICES[item.service_key as keyof typeof CERTIFICATION_SERVICES];
  return <AppLayout noPadding><CertificationWorkspace>
    <CertificationHeader title={item.title} description={`${item.human_folio} · ${service?.name || item.service_key}`} actions={<><button onClick={() => router.push('/certificaciones')} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold"><ArrowLeft size={15} />Volver</button><CertificationStatusBadge status={item.status} /></>} />
    {item.provider_mode === 'sandbox' && item.service_key !== 'integrity' && <div className="mb-4"><SandboxNotice /></div>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4"><Panel title="Documento original" icon={FileCheck2}><div className="grid gap-4 sm:grid-cols-2"><Field label="Archivo" value={item.original_filename || 'Sin archivo'} /><Field label="Clasificacion" value={format(item.file_classification)} /><Field label="SHA-256 original" value={item.original_sha256 || 'Pendiente'} mono /><Field label="SHA-256 final" value={item.final_sha256 || 'Pendiente'} mono /></div></Panel>
      <Panel title="Evidencias emitidas" icon={ShieldCheck}>{data.evidences.length ? <div className="divide-y divide-slate-200">{data.evidences.map((evidence) => <div key={evidence.id || evidence.sha256} className="flex items-center gap-3 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><Fingerprint size={17} /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{format(evidence.evidence_type)}</p><p className="mt-0.5 truncate font-mono text-xs text-slate-500">{evidence.sha256}</p></div><CertificationStatusBadge status={evidence.status === 'valid' ? 'validated' : 'issued_with_warnings'} /></div>)}</div> : <p className="text-sm text-slate-500">Todavia no existen evidencias emitidas.</p>}</Panel>
      <Panel title="Bitacora encadenada" icon={History}>{data.events.length ? <ol className="space-y-3">{data.events.map((event) => <li key={event.id} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" /><div><p className="text-sm font-semibold">{format(event.event_type)}</p><p className="mt-0.5 text-xs text-slate-500">{new Date(event.occurred_at).toLocaleString('es-MX')} · evento #{event.sequence_number}</p><p className="mt-1 max-w-3xl break-all font-mono text-[11px] text-slate-400">{event.event_hash}</p></div></li>)}</ol> : <p className="text-sm text-slate-500">Sin eventos.</p>}</Panel></div>
      <aside className="space-y-4"><Panel title="Resumen tecnico" icon={CalendarClock}><div className="space-y-3"><Field label="Servicio" value={service?.name || item.service_key} /><Field label="Entorno" value={item.provider_mode === 'production' ? 'Produccion' : 'Sandbox'} /><Field label="Emitida" value={item.issued_at ? new Date(item.issued_at).toLocaleString('es-MX') : 'Pendiente'} /><Field label="Manifiesto" value={data.manifest?.canonical_sha256 || 'Pendiente'} mono /></div></Panel><Panel title="Acciones" icon={Download}><button onClick={() => navigator.clipboard.writeText(item.original_sha256 || '')} className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 text-sm font-semibold"><Copy size={15} />Copiar huella</button><p className="mt-3 text-xs leading-5 text-slate-500">Las descargas probatorias se habilitan cuando existe un archivo generado y su huella fue verificada.</p></Panel></aside>
    </div>
  </CertificationWorkspace></AppLayout>;
}
function Panel({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) { return <section className="rounded-lg border border-slate-200 bg-white"><header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3"><Icon size={16} className="text-primary" /><h2 className="text-sm font-semibold">{title}</h2></header><div className="p-4">{children}</div></section>; }
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div><p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p><p className={`mt-1 break-all text-sm text-slate-800 ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{value}</p></div>; }
function format(value?: string) { return value ? value.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()) : 'Pendiente'; }

