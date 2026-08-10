'use client';

import { LockKeyhole, ScrollText, ShieldCheck } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { NotificaHeader, NotificaWorkspace } from '../components/NotificaUI';

export default function NotificationAuditPage() {
  return <AppLayout noPadding><NotificaWorkspace><NotificaHeader title="Auditoria de Notifica" description="Supervisa eventos, integridad de la cadena y resultados de entrega por espacio de trabajo." /><section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card"><header className="flex h-14 items-center gap-2 border-b border-slate-200 px-5 dark:border-border"><ScrollText size={16} className="text-slate-500" /><h2 className="text-sm font-600">Bitacora inmutable</h2></header><div className="grid gap-6 p-6 md:grid-cols-2"><div className="flex gap-3"><LockKeyhole size={20} className="shrink-0 text-cyan-700" /><div><p className="text-sm font-600">Cadena hash por notificacion</p><p className="mt-1 text-sm leading-6 text-slate-500">Cada evento incorpora el hash anterior, actor, momento, resultado y metadatos tecnicos.</p></div></div><div className="flex gap-3"><ShieldCheck size={20} className="shrink-0 text-emerald-700" /><div><p className="text-sm font-600">Aislamiento por tenant</p><p className="mt-1 text-sm leading-6 text-slate-500">Las politicas RLS limitan lectura y escritura a miembros del espacio de trabajo.</p></div></div></div></section></NotificaWorkspace></AppLayout>;
}
