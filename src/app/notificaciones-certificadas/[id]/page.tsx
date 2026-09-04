'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CalendarClock, Check, Clipboard, ExternalLink, FileCheck2, FileText, KeyRound, Loader2, Mail, Send, ShieldCheck, UserRound } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { DEMO_NOTIFICATIONS, EVIDENCE_META, type CertifiedNotificationSummary } from '@/lib/notifica/schema';
import { EvidenceBadge, NotificaWorkspace, NotificationStatusBadge } from '../components/NotificaUI';

type EventItem = { id?: string; sequence_no: number; label: string; actor_label: string; occurred_at: string; event_hash?: string };
type Detail = CertifiedNotificationSummary & { message?: string; requireOtp?: boolean; responseMode?: string; channels?: string[]; documentSnapshot?: any; recipient?: any; notification_evidence_events?: EventItem[]; notification_delivery_channels?: any[]; notification_recipients?: any[]; persisted?: boolean; error?: string };

export default function NotificationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [accessUrl, setAccessUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (id.startsWith('local-')) {
        const local = readLocalDetail(id);
        if (!cancelled) { setDetail(local); setLoading(false); }
        return;
      }
      const demo = DEMO_NOTIFICATIONS.find((item) => item.id === id);
      if (demo) {
        if (!cancelled) { setDetail(withDemoDetail(demo)); setLoading(false); }
        return;
      }
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      const response = await fetch(`/api/notificaciones/${id}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const result = await response.json();
      if (!cancelled) {
        if (response.ok) setDetail(mapApiDetail(result.data));
        else setError(result.error || 'No fue posible abrir la notificacion.');
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id]);

  const events = useMemo(() => detail?.notification_evidence_events || [], [detail]);
  const publish = async () => {
    if (!detail?.persisted) { setError('Aplica la migracion del modulo para publicar este borrador local con un token seguro.'); return; }
    setPublishing(true); setError('');
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session) throw new Error('Debes iniciar sesion.');
      const response = await fetch(`/api/notificaciones/${id}/publicar`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No fue posible publicar.');
      setAccessUrl(result.data.accessUrl);
      setDetail({ ...detail, status: 'available', evidenceLevel: 'E2', lastEvent: 'Documento puesto a disposicion', updatedAt: new Date().toISOString(), notification_evidence_events: [...events, { sequence_no: events.length + 1, label: 'Documento puesto a disposicion', actor_label: 'Usuario Docubox', occurred_at: new Date().toISOString() }] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible publicar.'); }
    finally { setPublishing(false); }
  };

  const copyAccess = async () => { await navigator.clipboard.writeText(accessUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };

  if (loading) return <AppLayout noPadding><div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div></AppLayout>;
  if (!detail) return <AppLayout noPadding><div className="p-8 text-center"><p className="font-600">Notificacion no encontrada</p><button onClick={() => router.push('/notificaciones')} className="mt-4 text-sm text-primary">Volver a Notifica</button></div></AppLayout>;

  const recipient = detail.notification_recipients?.[0] || detail.recipient || { name: detail.recipientName, email: detail.recipientEmail };
  const snapshot = detail.documentSnapshot || { name: detail.documentName };

  return <AppLayout noPadding><NotificaWorkspace>
    <header className="mb-5 flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-border xl:flex-row xl:items-center xl:justify-between"><div className="flex min-w-0 items-start gap-3"><button onClick={() => router.push('/notificaciones')} aria-label="Volver" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-border dark:bg-card"><ArrowLeft size={16} /></button><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-600 text-slate-950 dark:text-foreground">{detail.subject}</h1><NotificationStatusBadge status={detail.status} /></div><p className="mt-1 text-sm text-slate-500"><span className="font-600 text-primary">{detail.folio}</span> · {detail.category}</p></div></div><div className="flex flex-wrap gap-2">{detail.status === 'draft' && <button onClick={publish} disabled={publishing} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white disabled:opacity-60">{publishing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Poner a disposicion</button>}</div></header>

    {error && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}
    {accessUrl && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-600 text-emerald-950">Acceso seguro generado</p><p className="mt-1 break-all text-xs text-emerald-800">{accessUrl}</p></div><div className="flex gap-2"><button onClick={copyAccess} className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 text-xs font-600 text-emerald-800">{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? 'Copiado' : 'Copiar enlace'}</button><a href={accessUrl} target="_blank" className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-xs font-600 text-white">Abrir <ExternalLink size={13} /></a></div></div></div>}

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card"><SectionTitle icon={FileText} title="Documento notificado" /><div className="p-5"><div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-cyan-100 bg-cyan-50 text-cyan-700"><FileCheck2 size={22} /></span><div className="min-w-0"><p className="truncate text-base font-600">{snapshot.name || detail.documentName}</p><p className="mt-1 text-sm text-slate-500">Version canonica capturada al crear la notificacion.</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500"><span>Estado: <strong className="font-600 text-slate-700">{snapshot.status || 'Registrado'}</strong></span><span>SHA-256: <strong className="font-mono font-500 text-slate-700">{snapshot.hash ? `${snapshot.hash.slice(0, 18)}...` : 'Se fija al persistir'}</strong></span></div></div></div></div></section>
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card"><SectionTitle icon={CalendarClock} title="Linea de evidencia" /><div className="p-5">{events.length ? <ol>{events.map((event, index) => <li key={event.id || event.sequence_no} className="relative flex gap-4 pb-6 last:pb-0"><div className="flex flex-col items-center"><span className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-200 bg-cyan-50 text-xs font-600 text-cyan-800">{event.sequence_no}</span>{index < events.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}</div><div className="pt-1"><p className="text-sm font-600">{event.label}</p><p className="mt-1 text-xs text-slate-500">{event.actor_label} · {formatDateTime(event.occurred_at)}</p>{event.event_hash && <p className="mt-1 font-mono text-[10px] text-slate-400">{event.event_hash.slice(0, 28)}...</p>}</div></li>)}</ol> : <p className="text-sm text-slate-500">La linea de evidencia se iniciara al persistir el borrador.</p>}</div></section>
      </div>
      <aside className="space-y-4">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card"><SectionTitle icon={ShieldCheck} title="Evidencia actual" /><div className="p-5"><EvidenceBadge level={detail.evidenceLevel} /><p className="mt-3 text-sm leading-6 text-slate-500">{EVIDENCE_META[detail.evidenceLevel].description}</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-600" style={{ width: `${(Number(detail.evidenceLevel.slice(1)) / 6) * 100}%` }} /></div><div className="mt-2 flex justify-between text-[10px] font-600 text-slate-400"><span>E0</span><span>E6</span></div></div></section>
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card"><SectionTitle icon={UserRound} title="Destinatario" /><dl className="space-y-4 p-5"><Info label="Nombre" value={recipient.name || detail.recipientName} /><Info label="Correo" value={recipient.email || detail.recipientEmail} /><Info label="Autenticacion" value={detail.requireOtp === false ? 'Enlace seguro' : 'Enlace seguro + OTP'} /></dl></section>
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card"><SectionTitle icon={Mail} title="Configuracion" /><dl className="space-y-4 p-5"><Info label="Canales" value={(detail.channels || detail.notification_delivery_channels?.map((item) => item.channel) || ['email']).join(', ')} /><Info label="Actuacion esperada" value={formatResponseMode(detail.responseMode)} /><Info label="Fecha limite" value={detail.dueAt ? new Date(detail.dueAt).toLocaleDateString('es-MX', { dateStyle: 'long' }) : 'Sin fecha limite'} /></dl></section>
      </aside>
    </div>
  </NotificaWorkspace></AppLayout>;
}

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) { return <header className="flex h-14 items-center gap-2 border-b border-slate-200 px-5 dark:border-border"><Icon size={16} className="text-slate-500" /><h2 className="text-sm font-600">{title}</h2></header>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-[11px] font-600 uppercase tracking-[0.06em] text-slate-400">{label}</dt><dd className="mt-1 break-words text-sm font-500 text-slate-800 dark:text-foreground">{value}</dd></div>; }
function formatDateTime(value: string) { return new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }); }
function formatResponseMode(value?: string) { return value === 'respond' ? 'Acusar y responder' : value === 'accept_or_reject' ? 'Aceptar o rechazar' : 'Acuse de recepcion'; }
function readLocalDetail(id: string): Detail | null { try { return JSON.parse(localStorage.getItem(`docubox_notifica_detail_${id}`) || 'null'); } catch { return null; } }
function withDemoDetail(item: CertifiedNotificationSummary): Detail { return { ...item, message: 'Consulta el documento y registra la actuacion solicitada dentro del plazo indicado.', requireOtp: true, responseMode: 'acknowledge', channels: ['email'], documentSnapshot: { name: item.documentName, status: 'completado', hash: '8d967b4fb301bfbc2c6f50f7ff4ae083cd23007e591754b464f1b78abdf92400' }, recipient: { name: item.recipientName, email: item.recipientEmail }, notification_evidence_events: [{ sequence_no: 1, label: 'Notificacion creada', actor_label: 'Luis Alberto Hernandez Beltran', occurred_at: '2026-08-08T13:00:00.000Z' }, { sequence_no: 2, label: 'Documento puesto a disposicion', actor_label: 'Sistema Docubox', occurred_at: '2026-08-08T13:02:00.000Z' }, ...(item.evidenceLevel >= 'E3' ? [{ sequence_no: 3, label: item.lastEvent, actor_label: 'Proveedor de correo', occurred_at: item.updatedAt }] : [])], persisted: false }; }
function mapApiDetail(row: any): Detail { const recipient = row.notification_recipients?.[0]; return { id: row.id, folio: row.folio, subject: row.subject, documentName: row.document_snapshot?.name || 'Documento', recipientName: recipient?.name || 'Sin destinatario', recipientEmail: recipient?.email || '', category: row.category, status: row.status, evidenceLevel: row.evidence_level, dueAt: row.due_at || undefined, updatedAt: row.updated_at, lastEvent: row.last_event_label, message: row.message, requireOtp: row.require_otp, responseMode: row.response_mode, channels: row.channels, documentSnapshot: row.document_snapshot, notification_recipients: row.notification_recipients, notification_delivery_channels: row.notification_delivery_channels, notification_evidence_events: row.notification_evidence_events || [], persisted: true }; }
