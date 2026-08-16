'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, CheckSquare2, Clock3, FileSearch, FolderKanban, Loader2, ShieldAlert } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaborationApi } from '@/lib/collaboration/client';

type Overview = {
  counters: { assigned_to_me: number; due_soon: number; overdue: number; blocked: number; reviews: number; requests: number };
  tasks: Array<{ id: string; title: string; estado: string; prioridad: string; due_date: string | null; document_name: string | null }>;
  reviews: Array<{ id: string; title: string; status: string; due_at: string | null; round_number: number }>;
  spaces: Array<{ id: string; name: string; status: string; space_type: string; confidentiality: string }>;
  activity: Array<{ id: string; summary: string; event_type: string; occurred_at: string }>;
};

const emptyOverview: Overview = { counters: { assigned_to_me: 0, due_soon: 0, overdue: 0, blocked: 0, reviews: 0, requests: 0 }, tasks: [], reviews: [], spaces: [], activity: [] };

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(new Date(value)) : 'Sin fecha';
}

export default function ColaboraDashboardPage() {
  const { activeWorkspace } = useWorkspace();
  const api = useCollaborationApi();
  const [data, setData] = useState(emptyOverview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let active = true;
    setLoading(true);
    api<{ data: Overview }>(`/api/colabora/overview?workspace_id=${activeWorkspace.id}`)
      .then((payload) => { if (active) setData(payload.data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar Colabora.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activeWorkspace?.id, api]);

  if (loading) return <div className="min-h-[420px] grid place-items-center"><Loader2 className="animate-spin text-primary" size={24} /></div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700"><AlertCircle size={18} className="mb-2" />{error}</div>;

  const counters = [
    { label: 'Asignadas a mi', value: data.counters.assigned_to_me, icon: CheckSquare2, href: '/colabora/tareas' },
    { label: 'Vencen pronto', value: data.counters.due_soon, icon: Clock3, href: '/colabora/calendario' },
    { label: 'Vencidas', value: data.counters.overdue, icon: AlertCircle, href: '/colabora/tareas' },
    { label: 'Bloqueadas', value: data.counters.blocked, icon: ShieldAlert, href: '/colabora/tareas' },
    { label: 'En revision', value: data.counters.reviews, icon: FileSearch, href: '/colabora/revisiones' },
    { label: 'Solicitudes abiertas', value: data.counters.requests, icon: FolderKanban, href: '/colabora/solicitudes' },
  ];

  return <div className="mx-auto max-w-[1500px] space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-medium text-foreground">Centro de trabajo</h2><p className="mt-1 text-sm text-muted-foreground">Prioridades, revisiones y actividad que requieren seguimiento.</p></div><Link href="/colabora/tareas?new=1" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-white">Crear tarea</Link></div>

    <section className="grid overflow-hidden rounded-lg border border-border bg-background sm:grid-cols-2 xl:grid-cols-6 sm:divide-x divide-border">
      {counters.map((item, index) => <Link href={item.href} key={item.label} className={`min-h-28 p-4 hover:bg-muted/40 ${index > 1 ? 'border-t border-border xl:border-t-0' : index > 0 ? 'border-t border-border sm:border-t-0' : ''}`}><item.icon size={18} className={item.label === 'Vencidas' || item.label === 'Bloqueadas' ? 'text-amber-600' : 'text-primary'} /><p className="mt-3 text-2xl font-medium tabular-nums text-foreground">{item.value}</p><p className="mt-1 text-sm text-muted-foreground">{item.label}</p></Link>)}
    </section>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)]">
      <section className="overflow-hidden rounded-lg border border-border bg-background"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-medium text-foreground">Siguiente trabajo</h3><p className="mt-0.5 text-sm text-muted-foreground">Ordenado por fecha y riesgo.</p></div><Link href="/colabora/tareas" className="text-sm font-medium text-primary">Ver todas</Link></div>{data.tasks.length ? <div className="divide-y divide-border">{data.tasks.slice(0, 7).map((task) => <Link href={`/colabora/tareas/${task.id}`} key={task.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40"><span className={`h-2 w-2 rounded-full ${task.prioridad === 'critica' ? 'bg-red-500' : task.prioridad === 'alta' ? 'bg-amber-500' : 'bg-blue-500'}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{task.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{task.document_name || task.estado.replaceAll('_', ' ')}</p></div><span className="text-xs text-muted-foreground">{date(task.due_date)}</span><ArrowRight size={15} className="text-muted-foreground" /></Link>)}</div> : <div className="px-5 py-14 text-center text-sm text-muted-foreground">No hay tareas abiertas.</div>}</section>
      <section className="overflow-hidden rounded-lg border border-border bg-background"><div className="border-b border-border px-5 py-4"><h3 className="font-medium text-foreground">Actividad reciente</h3><p className="mt-0.5 text-sm text-muted-foreground">Cambios visibles en tu alcance.</p></div>{data.activity.length ? <div className="divide-y divide-border">{data.activity.slice(0, 8).map((event) => <div key={event.id} className="px-5 py-3.5"><p className="text-sm text-foreground">{event.summary}</p><p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.occurred_at))}</p></div>)}</div> : <div className="px-5 py-14 text-center text-sm text-muted-foreground">La actividad aparecerá conforme el equipo trabaje.</div>}</section>
    </div>

    <section className="overflow-hidden rounded-lg border border-border bg-background"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-medium text-foreground">Espacios activos</h3><p className="mt-0.5 text-sm text-muted-foreground">Clientes, proyectos y operaciones en curso.</p></div><Link href="/colabora/espacios" className="text-sm font-medium text-primary">Explorar</Link></div><div className="grid sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">{data.spaces.slice(0, 4).map((space) => <Link href={`/colabora/espacios/${space.id}`} key={space.id} className="p-5 hover:bg-muted/40"><FolderKanban size={18} className="text-primary" /><p className="mt-3 truncate text-sm font-medium text-foreground">{space.name}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{space.space_type.replaceAll('_', ' ')} · {space.status.replaceAll('_', ' ')}</p></Link>)}{!data.spaces.length && <div className="col-span-full px-5 py-10 text-center text-sm text-muted-foreground">Crea el primer espacio para concentrar documentos, tareas e hitos.</div>}</div></section>
  </div>;
}

