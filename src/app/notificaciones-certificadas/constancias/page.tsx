'use client';

import { BadgeCheck, FileClock, ShieldCheck } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { NotificaHeader, NotificaWorkspace } from '../components/NotificaUI';

export default function NotificationCertificatesPage() {
  return <AppLayout noPadding><NotificaWorkspace><NotificaHeader title="Constancias" description="Consulta las constancias verificables generadas por cada hito de la comunicacion." /><div className="grid gap-4 md:grid-cols-3"><Certificate title="Puesta a disposicion" description="Acredita el documento, su hash, la fecha y el acceso seguro generado." icon={FileClock} /><Certificate title="Acuse de recepcion" description="Acredita autenticacion, consulta y manifestacion del destinatario." icon={BadgeCheck} /><Certificate title="Actuacion final" description="Consolida respuesta, aceptacion, rechazo o cumplimiento y su evidencia." icon={ShieldCheck} /></div><div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center dark:border-border dark:bg-card"><p className="text-sm font-600">Aun no hay constancias persistentes</p><p className="mt-1 text-sm text-slate-500">Se generaran conforme las notificaciones alcancen los niveles E2, E5 y E6.</p></div></NotificaWorkspace></AppLayout>;
}
function Certificate({ title, description, icon: Icon }: { title: string; description: string; icon: React.ElementType }) { return <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card"><Icon size={20} className="text-cyan-700" /><h2 className="mt-4 text-sm font-600">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>; }
