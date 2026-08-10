'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive, BarChart3, CheckCircle2, ChevronDown, CirclePause, Copy, Edit3, Eye,
  FileCheck2, FilePlus2, FileText, Link2, Loader2, MoreHorizontal, PenLine, Plus,
  Search, Send, ShieldCheck, Trash2, Users, X,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { getSignatureTypeLabel, normalizeFormTemplate, type SignatureType } from '@/lib/forms/schema';

interface FormRow {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'published' | 'paused' | 'closed' | 'archived';
  schema: unknown[];
  settings: Record<string, any>;
  updated_at: string;
  created_by: string;
  responseCount: number;
}

const statusStyles: Record<string, { label: string; className: string; dot: string }> = {
  draft: { label: 'Borrador', className: 'border-slate-200 bg-slate-50 text-slate-600', dot: 'bg-slate-400' },
  published: { label: 'Publicado', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  paused: { label: 'Pausado', className: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  closed: { label: 'Cerrado', className: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500' },
  archived: { label: 'Archivado', className: 'border-slate-200 bg-slate-100 text-slate-500', dot: 'bg-slate-400' },
};

export default function FormulariosPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const supabase = createClient();
  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [shareForm, setShareForm] = useState<FormRow | null>(null);
  const [notice, setNotice] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const loadForms = async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    const [{ data: templateData, error }, { data: responseData }] = await Promise.all([
      supabase.from('form_templates').select('*').eq('workspace_id', activeWorkspace.id).order('updated_at', { ascending: false }),
      supabase.from('form_responses').select('template_id').eq('workspace_id', activeWorkspace.id),
    ]);
    if (!error) {
      const counts = (responseData || []).reduce<Record<string, number>>((acc, row: any) => {
        acc[row.template_id] = (acc[row.template_id] || 0) + 1;
        return acc;
      }, {});
      setForms((templateData || []).map((item: any) => ({ ...item, responseCount: counts[item.id] || 0 })));
    } else {
      setNotice('No se pudieron cargar los formularios.');
    }
    setLoading(false);
  };

  useEffect(() => { loadForms(); }, [activeWorkspace?.id]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setActiveMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const filtered = useMemo(() => forms.filter((form) => {
    const matchesQuery = `${form.name} ${form.description || ''}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === 'all' || form.status === status);
  }), [forms, query, status]);

  const metrics = useMemo(() => ({
    total: forms.length,
    published: forms.filter((form) => form.status === 'published').length,
    responses: forms.reduce((sum, form) => sum + form.responseCount, 0),
    signing: forms.filter((form) => form.settings?.requiresSignature).length,
  }), [forms]);

  const duplicateForm = async (form: FormRow) => {
    if (!activeWorkspace || !user) return;
    const normalized = normalizeFormTemplate({ schema: form.schema as any, sections: form.settings?.sections, settings: form.settings as any });
    const { error } = await supabase.from('form_templates').insert({
      workspace_id: activeWorkspace.id,
      created_by: user.id,
      name: `${form.name} (copia)`,
      description: form.description || '',
      status: 'draft',
      schema: normalized.schema,
      settings: { ...normalized.settings, sections: normalized.sections },
    });
    if (!error) { setNotice('Formulario duplicado.'); loadForms(); }
  };

  const closeForm = async (form: FormRow) => {
    let result = await supabase.from('form_templates').update({ status: 'closed' }).eq('id', form.id);
    if (result.error) result = await supabase.from('form_templates').update({ status: 'archived' }).eq('id', form.id);
    if (!result.error) { setNotice('Formulario cerrado.'); loadForms(); }
  };

  const deleteForm = async (form: FormRow) => {
    if (!window.confirm(`¿Eliminar “${form.name}”? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from('form_templates').delete().eq('id', form.id);
    if (!error) setForms((current) => current.filter((item) => item.id !== form.id));
  };

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-4 dark:bg-background sm:px-5 md:-my-6 md:py-5 lg:px-6">
        <div className="mx-auto w-full max-w-[1560px]">
          <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-border sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-600 text-slate-950 dark:text-foreground">Formularios</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
                Crea, publica y administra formularios que generan documentos listos para firma.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push('/formularios/builder')}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              <Plus size={16} />
              Nuevo formulario
            </button>
          </header>

          <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-border">
              <div>
                <h2 className="text-sm font-600 text-slate-950 dark:text-foreground">Resumen de formularios</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">Actividad del espacio de trabajo actual.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-600 text-slate-600 dark:bg-muted dark:text-muted-foreground">
                {metrics.total} {metrics.total === 1 ? 'formulario' : 'formularios'}
              </span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 dark:divide-border lg:grid-cols-4 lg:divide-y-0">
              <MetricCard icon={FileText} label="Total" value={metrics.total} />
              <MetricCard icon={CheckCircle2} label="Publicados" value={metrics.published} tone="emerald" />
              <MetricCard icon={BarChart3} label="Respuestas" value={metrics.responses} tone="blue" />
              <MetricCard icon={PenLine} label="Requieren firma" value={metrics.signing} tone="indigo" />
            </div>
          </section>

          <section className="mt-5 overflow-visible rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-border lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-600 text-slate-950 dark:text-foreground">Mis formularios</h2>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-600 text-primary dark:bg-primary/10">
                    {filtered.length}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">Gestiona borradores, publicaciones y respuestas.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 sm:w-80">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar formularios..."
                    className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background dark:text-foreground"
                  />
                </div>
                <div className="relative">
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    aria-label="Filtrar por estado"
                    className="h-10 w-full appearance-none rounded-md border border-slate-200 bg-white pl-3 pr-9 text-sm text-slate-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background dark:text-foreground sm:w-44"
                  >
                    <option value="all">Todos los estados</option>
                    <option value="draft">Borrador</option>
                    <option value="published">Publicado</option>
                    <option value="paused">Pausado</option>
                    <option value="closed">Cerrado</option>
                    <option value="archived">Archivado</option>
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                </div>
              </div>
            </div>

          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center"><Loader2 size={24} className="animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState onCreate={() => router.push('/formularios/builder')} filtered={Boolean(query || status !== 'all')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse">
                <thead><tr className="border-b border-slate-200 bg-slate-50/80 text-left dark:border-border dark:bg-muted/40">
                  <TableHeading>Formulario</TableHeading><TableHeading>Estado</TableHeading><TableHeading>Respuestas</TableHeading><TableHeading>Configuración de firma</TableHeading><TableHeading>Última modificación</TableHeading><TableHeading align="right">Acciones</TableHeading>
                </tr></thead>
                <tbody className="divide-y divide-slate-200 dark:divide-border">
                  {filtered.map((form) => {
                    const signatureTypes = (form.settings?.allowedSignatureTypes || []) as SignatureType[];
                    return (
                      <tr key={form.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-muted/30">
                        <td className="px-5 py-4"><button type="button" onClick={() => router.push(`/formularios/builder?id=${form.id}`)} className="group flex items-center gap-3 text-left"><span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-primary transition-colors group-hover:bg-blue-100 dark:border-primary/20 dark:bg-primary/10"><FileCheck2 size={18} /></span><span className="min-w-0"><span className="block max-w-[320px] truncate text-sm font-600 text-slate-950 group-hover:text-primary dark:text-foreground">{form.name}</span><span className="mt-0.5 block max-w-[320px] truncate text-xs text-slate-500 dark:text-muted-foreground">{form.description || `${Array.isArray(form.schema) ? form.schema.length : 0} campos configurados`}</span></span></button></td>
                        <td className="px-4 py-3.5"><StatusBadge status={form.status} /></td>
                        <td className="px-4 py-4"><button type="button" onClick={() => router.push(`/formularios/respuestas?id=${form.id}`)} className="inline-flex items-center gap-2 text-sm font-500 text-slate-700 hover:text-primary dark:text-foreground"><Users size={15} className="text-slate-400" /><span className="tabular-nums">{form.responseCount}</span><span className="text-xs text-slate-400">{form.responseCount === 1 ? 'respuesta' : 'respuestas'}</span></button></td>
                        <td className="px-4 py-4">{form.settings?.requiresSignature ? <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-emerald-600" /><div><span className="text-xs font-600 text-slate-900 dark:text-foreground">Firma requerida</span><p className="mt-0.5 max-w-[230px] truncate text-[11px] text-slate-500 dark:text-muted-foreground">{signatureTypes.length ? signatureTypes.map(getSignatureTypeLabel).join(', ') : 'Click & Sign'}</p></div></div> : <span className="text-xs text-slate-500 dark:text-muted-foreground">Sin firma requerida</span>}</td>
                        <td className="whitespace-nowrap px-4 py-4"><span className="block text-xs font-500 text-slate-700 dark:text-foreground">{new Date(form.updated_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</span><span className="mt-0.5 block text-[11px] text-slate-400">{new Date(form.updated_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span></td>
                        <td className="relative px-5 py-4 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button type="button" onClick={() => router.push(`/formularios/builder?id=${form.id}`)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-600 text-slate-700 transition-colors hover:bg-slate-50 dark:border-border dark:bg-card dark:text-foreground"><Edit3 size={14} /> Editar</button>
                            <button type="button" onClick={() => { setShareForm(form); setActiveMenu(null); }} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary dark:border-border dark:bg-card" title="Compartir" aria-label={`Compartir ${form.name}`}><Send size={14} /></button>
                            <button type="button" onClick={() => setActiveMenu(activeMenu === form.id ? null : form.id)} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-border dark:bg-card" title="Más acciones" aria-label={`Más acciones para ${form.name}`}><MoreHorizontal size={16} /></button>
                          </div>
                          {activeMenu === form.id && <ActionMenu ref={menuRef} form={form} onPreview={() => router.push(`/formularios/preview?id=${form.id}`)} onResponses={() => router.push(`/formularios/respuestas?id=${form.id}`)} onDuplicate={() => duplicateForm(form)} onClose={() => closeForm(form)} onDelete={() => deleteForm(form)} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </section>
        </div>
      </div>

      {shareForm && <ShareDialog form={shareForm} onClose={() => setShareForm(null)} onSuccess={(message) => { setNotice(message); setShareForm(null); }} />}
      {notice && <div className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-md bg-slate-950 px-4 py-3 text-xs font-500 text-white shadow-xl">{notice}<button type="button" onClick={() => setNotice('')} className="text-white/60 hover:text-white" aria-label="Cerrar aviso"><X size={14} /></button></div>}
    </AppLayout>
  );
}

const ActionMenu = React.forwardRef<HTMLDivElement, { form: FormRow; onPreview: () => void; onResponses: () => void; onDuplicate: () => void; onClose: () => void; onDelete: () => void }>(function ActionMenu({ onPreview, onResponses, onDuplicate, onClose, onDelete }, ref) {
  return (
    <div ref={ref} className="absolute right-5 top-14 z-30 w-52 rounded-md border border-slate-200 bg-white p-1.5 text-left shadow-[0_16px_40px_-18px_rgba(15,23,42,0.35)] dark:border-border dark:bg-card">
      <MenuAction icon={Eye} label="Vista previa" onClick={onPreview} />
      <MenuAction icon={BarChart3} label="Ver respuestas" onClick={onResponses} />
      <MenuAction icon={Copy} label="Duplicar" onClick={onDuplicate} />
      <MenuAction icon={CirclePause} label="Cerrar formulario" onClick={onClose} />
      <div className="my-1 border-t border-slate-200 dark:border-border" />
      <MenuAction icon={Trash2} label="Eliminar" destructive onClick={onDelete} />
    </div>
  );
});

function ShareDialog({ form, onClose, onSuccess }: { form: FormRow; onClose: () => void; onSuccess: (message: string) => void }) {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [hours, setHours] = useState(form.settings?.expirationHours || 72);
  const [loading, setLoading] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [error, setError] = useState('');
  const createLink = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Ingresa un correo electrónico válido.'); return; }
    setLoading(true); setError('');
    const { data: sessionData } = await supabase.auth.getSession();
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-form-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session?.access_token || ''}` },
        body: JSON.stringify({ template_id: form.id, recipient_email: email, recipient_name: name, expiration_hours: hours }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo generar el enlace.');
      setGeneratedUrl(data.form_url);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'No se pudo generar el enlace.'); }
    setLoading(false);
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_70px_-24px_rgba(15,23,42,0.5)] dark:border-border dark:bg-card">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-border">
          <div className="min-w-0">
            <h2 className="text-base font-600 text-slate-950 dark:text-foreground">Compartir formulario</h2>
            <p className="mt-1 truncate text-xs text-slate-500 dark:text-muted-foreground">{form.name}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-muted" aria-label="Cerrar">
            <X size={15} />
          </button>
        </header>
        <div className="space-y-4 p-5">
          {generatedUrl ? (
            <>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                <div className="flex items-center gap-2 text-sm font-600 text-emerald-800 dark:text-emerald-300"><CheckCircle2 size={16} /> Enlace seguro generado</div>
                <p className="mt-2 break-all text-xs leading-5 text-emerald-700 dark:text-emerald-400">{generatedUrl}</p>
              </div>
              <button type="button" onClick={async () => { await navigator.clipboard.writeText(generatedUrl); onSuccess('Enlace copiado al portapapeles.'); }} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-600 text-white transition-colors hover:bg-primary/90">
                <Link2 size={15} /> Copiar enlace
              </button>
            </>
          ) : (
            <>
              <DialogInput label="Correo del participante" value={email} onChange={setEmail} type="email" />
              <DialogInput label="Nombre (opcional)" value={name} onChange={setName} />
              <label className="block">
                <span className="mb-1.5 block text-xs font-500 text-slate-600 dark:text-muted-foreground">Vigencia</span>
                <select value={hours} onChange={(event) => setHours(Number(event.target.value))} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background dark:text-foreground">
                  <option value={24}>24 horas</option>
                  <option value={72}>3 días</option>
                  <option value={168}>7 días</option>
                  <option value={720}>30 días</option>
                </select>
              </label>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button type="button" onClick={createLink} disabled={loading} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-600 text-white transition-colors hover:bg-primary/90 disabled:opacity-50">
                {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Generar y enviar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DialogInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-500 text-slate-600 dark:text-muted-foreground">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background dark:text-foreground" /></label>;
}
function MetricCard({ icon: Icon, label, value, tone = 'zinc' }: { icon: React.ElementType; label: string; value: number; tone?: 'zinc' | 'emerald' | 'blue' | 'indigo' }) {
  const tones = { zinc: 'bg-slate-100 text-slate-600', emerald: 'bg-emerald-50 text-emerald-700', blue: 'bg-blue-50 text-blue-700', indigo: 'bg-indigo-50 text-indigo-600' };
  return <div className="flex min-h-24 items-center gap-3 px-5 py-4"><span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md ${tones[tone]}`}><Icon size={17} /></span><div><p className="text-xl font-600 tabular-nums text-slate-950 dark:text-foreground">{value}</p><p className="text-xs text-slate-500 dark:text-muted-foreground">{label}</p></div></div>;
}
function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] || statusStyles.draft;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-600 ${style.className}`}><span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />{style.label}</span>;
}
function TableHeading({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`whitespace-nowrap px-4 py-3.5 text-xs font-600 text-slate-500 dark:text-muted-foreground ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}
function MenuAction({ icon: Icon, label, onClick, destructive }: { icon: React.ElementType; label: string; onClick: () => void; destructive?: boolean }) {
  return <button type="button" onClick={onClick} className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-xs font-500 transition-colors ${destructive ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30' : 'text-slate-700 hover:bg-slate-100 dark:text-foreground dark:hover:bg-muted'}`}><Icon size={14} />{label}</button>;
}
function EmptyState({ onCreate, filtered }: { onCreate: () => void; filtered: boolean }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-primary dark:border-primary/20 dark:bg-primary/10">{filtered ? <Search size={21} /> : <FilePlus2 size={21} />}</span>
      <h3 className="mt-4 text-sm font-600 text-slate-950 dark:text-foreground">{filtered ? 'No encontramos formularios' : 'Crea tu primer formulario'}</h3>
      <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500 dark:text-muted-foreground">{filtered ? 'Prueba con otro término o cambia el filtro de estado.' : 'Diseña las preguntas, configura el PDF espejo y define cómo se firmarán las respuestas.'}</p>
      {!filtered && <button type="button" onClick={onCreate} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-600 text-white transition-colors hover:bg-primary/90"><Plus size={14} /> Nuevo formulario</button>}
    </div>
  );
}
