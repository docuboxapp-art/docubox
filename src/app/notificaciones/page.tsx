'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, ChevronDown, FileText, MailCheck, MoreHorizontal, Plus, Search, ShieldCheck } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { DEMO_NOTIFICATIONS, mapNotificationRow, NOTIFICATION_STATUS_META, type CertifiedNotificationSummary } from '@/lib/notifica/schema';
import { EvidenceBadge, Metric, NotificaHeader, NotificaWorkspace, NotificationStatusBadge } from './components/NotificaUI';

export default function NotificacionesPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [items, setItems] = useState<CertifiedNotificationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await createClient()
        .from('certified_notifications')
        .select('*, notification_recipients(name,email)')
        .eq('workspace_id', activeWorkspace.id)
        .order('updated_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        const localItems = readLocalNotifications();
        setItems(localItems.length ? localItems : DEMO_NOTIFICATIONS);
        setDemoMode(true);
      } else {
        setItems((data || []).map(mapNotificationRow));
        setDemoMode(false);
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [activeWorkspace?.id]);

  const filtered = useMemo(() => items.filter((item) => {
    const text = `${item.folio} ${item.subject} ${item.documentName} ${item.recipientName} ${item.recipientEmail} ${item.category}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (status === 'all' || item.status === status);
  }), [items, query, status]);

  const metrics = useMemo(() => ({
    active: items.filter((item) => !['draft', 'completed', 'expired', 'cancelled'].includes(item.status)).length,
    pending: items.filter((item) => ['available', 'notice_sent', 'delivered', 'in_progress'].includes(item.status)).length,
    acknowledged: items.filter((item) => ['acknowledged', 'responded', 'accepted', 'completed'].includes(item.status)).length,
    expiring: items.filter((item) => item.dueAt && new Date(item.dueAt).getTime() - Date.now() < 72 * 60 * 60 * 1000 && new Date(item.dueAt).getTime() > Date.now()).length,
  }), [items]);

  return <AppLayout noPadding><NotificaWorkspace>
    <NotificaHeader title="Notificaciones certificadas" description="Pon documentos a disposicion y conserva evidencia verificable de cada comunicacion." action={<button onClick={() => router.push('/notificaciones/nueva')} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white shadow-sm transition hover:bg-primary/90"><Plus size={16} /> Nueva notificacion</button>} />

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="Activas" value={metrics.active} detail="En entrega, acceso o respuesta" />
      <Metric label="Pendientes de atencion" value={metrics.pending} detail="Aun requieren una actuacion" tone="amber" />
      <Metric label="Con acuse" value={metrics.acknowledged} detail="Recepcion o conocimiento acreditado" tone="green" />
      <Metric label="Vencen en 72 horas" value={metrics.expiring} detail="Requieren seguimiento oportuno" tone="gray" />
    </div>

    <section className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
      <header className="border-b border-slate-200 p-4 dark:border-border">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por folio, documento, asunto o destinatario" className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background" /></div>
          <div className="relative"><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 min-w-52 appearance-none rounded-md border border-slate-200 bg-white px-3 pr-9 text-sm text-slate-700 outline-none dark:border-border dark:bg-card dark:text-foreground"><option value="all">Todos los estados</option>{Object.entries(NOTIFICATION_STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" /></div>
        </div>
        {demoMode && <div className="mt-3 flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-slate-600"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />Vista local de referencia. Al aplicar la migracion de Docubox Notifica, los registros quedaran aislados por espacio de trabajo y protegidos con RLS.</div>}
      </header>

      {loading ? <div className="flex min-h-72 items-center justify-center"><span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" /></div> : filtered.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><MailCheck size={28} className="text-slate-400" /><h2 className="mt-3 text-sm font-600">No hay notificaciones con estos filtros</h2><p className="mt-1 text-sm text-slate-500">Crea una nueva comunicacion o ajusta los filtros.</p></div> : <>
        <div className="divide-y divide-slate-200 md:hidden dark:divide-border">{filtered.map((item) => <button key={item.id} onClick={() => router.push(`/notificaciones/${item.id}`)} className="w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-600">{item.subject}</p><p className="mt-1 text-xs text-primary">{item.folio}</p></div><NotificationStatusBadge status={item.status} /></div><p className="mt-3 truncate text-xs text-slate-500">{item.recipientName} · {item.documentName}</p><div className="mt-3"><EvidenceBadge level={item.evidenceLevel} /></div></button>)}</div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[1120px] border-collapse"><thead><tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-border dark:bg-muted/40"><Heading>Folio y documento</Heading><Heading>Destinatario</Heading><Heading>Categoria</Heading><Heading>Estado</Heading><Heading>Evidencia</Heading><Heading>Ultimo evento</Heading><Heading align="right">Acciones</Heading></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-border">{filtered.map((item) => <tr key={item.id} className="transition hover:bg-slate-50/80 dark:hover:bg-muted/30"><td className="px-4 py-4"><button onClick={() => router.push(`/notificaciones/${item.id}`)} className="flex items-center gap-3 text-left"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-cyan-100 bg-cyan-50 text-cyan-700"><FileText size={18} /></span><span className="min-w-0"><span className="block max-w-72 truncate text-sm font-600 text-slate-950 dark:text-foreground">{item.subject}</span><span className="mt-0.5 block text-xs text-slate-500"><span className="font-600 text-primary">{item.folio}</span> · {item.documentName}</span></span></button></td><td className="px-4 py-4"><p className="max-w-56 truncate text-sm text-slate-700 dark:text-foreground">{item.recipientName}</p><p className="mt-0.5 text-xs text-slate-500">{item.recipientEmail}</p></td><td className="px-4 py-4 text-sm text-slate-600 dark:text-muted-foreground">{item.category}</td><td className="px-4 py-4"><NotificationStatusBadge status={item.status} /></td><td className="px-4 py-4"><EvidenceBadge level={item.evidenceLevel} /></td><td className="px-4 py-4"><p className="text-sm text-slate-700 dark:text-foreground">{item.lastEvent}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><CalendarClock size={12} />{formatDateTime(item.updatedAt)}</p></td><td className="px-4 py-4 text-right"><button onClick={() => router.push(`/notificaciones/${item.id}`)} className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-600 text-slate-700 hover:bg-slate-50 dark:border-border dark:text-foreground">Abrir <MoreHorizontal size={14} /></button></td></tr>)}</tbody></table></div>
      </>}
    </section>
  </NotificaWorkspace></AppLayout>;
}

function Heading({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) { return <th className={`px-4 py-3 text-xs font-600 text-slate-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>; }
function formatDateTime(value: string) { return new Date(value).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function readLocalNotifications(): CertifiedNotificationSummary[] { try { return JSON.parse(localStorage.getItem('docubox_notifica_drafts') || '[]'); } catch { return []; } }
