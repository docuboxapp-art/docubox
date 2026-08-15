'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, Mail, MessageSquareText, Send, Settings2, ShieldCheck, Tags, UserRound } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { NOTIFICATION_CATEGORIES, type CertifiedNotificationSummary } from '@/lib/notifica/schema';

type DocumentOption = { id: string; nombre: string; file_size?: number; estado?: string; documento_id?: string; updated_at?: string };
type Draft = { documentId: string; subject: string; message: string; category: string; recipientName: string; recipientEmail: string; recipientPhone: string; channels: string[]; requireOtp: boolean; responseMode: string; allowedActions: string[]; dueAt: string };

const steps = [
  { label: 'Documento', icon: FileText },
  { label: 'Clasificacion', icon: Tags },
  { label: 'Destinatario', icon: UserRound },
  { label: 'Configuracion', icon: Settings2 },
  { label: 'Confirmacion', icon: ShieldCheck },
];

const initialDraft: Draft = { documentId: '', subject: '', message: '', category: NOTIFICATION_CATEGORIES[0], recipientName: '', recipientEmail: '', recipientPhone: '', channels: ['email'], requireOtp: true, responseMode: 'acknowledge', allowedActions: ['acknowledge'], dueAt: '' };

export default function NuevaNotificacionPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(initialDraft);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoadingDocuments(false); return; }
      try {
        const response = await fetch('/api/documentos/listar?tipo=todos', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const result = await response.json();
        if (!cancelled) setDocuments((result.data || []).filter((item: DocumentOption) => !['eliminado', 'cancelado'].includes(item.estado || '')));
      } finally { if (!cancelled) setLoadingDocuments(false); }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const selectedDocument = useMemo(() => documents.find((item) => item.id === draft.documentId), [documents, draft.documentId]);
  const canContinue = [Boolean(draft.documentId), Boolean(draft.subject.trim() && draft.category), Boolean(draft.recipientName.trim() && /^\S+@\S+\.\S+$/.test(draft.recipientEmail)), draft.channels.length > 0, true][step];

  const createNotification = async () => {
    if (!activeWorkspace?.id || !selectedDocument) { setError('Selecciona un espacio de trabajo y un documento.'); return; }
    setSaving(true); setError('');
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Debes iniciar sesion.');
      const response = await fetch('/api/notificaciones', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ workspaceId: activeWorkspace.id, documentId: draft.documentId, subject: draft.subject, message: draft.message, category: draft.category, recipient: { name: draft.recipientName, email: draft.recipientEmail, phone: draft.recipientPhone }, channels: draft.channels, requireOtp: draft.requireOtp, responseMode: draft.responseMode, allowedActions: draft.allowedActions, dueAt: draft.dueAt ? new Date(`${draft.dueAt}T23:59:00`).toISOString() : null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No fue posible crear la notificacion.');
      router.push(`/notificaciones/${result.data.id}`);
    } catch (caught) {
      const id = `local-${crypto.randomUUID()}`;
      const local: CertifiedNotificationSummary = { id, folio: `NTF-${new Date().getFullYear()}-LOCAL`, subject: draft.subject, documentName: selectedDocument.nombre, recipientName: draft.recipientName, recipientEmail: draft.recipientEmail, category: draft.category, status: 'draft', evidenceLevel: 'E1', dueAt: draft.dueAt ? new Date(`${draft.dueAt}T23:59:00`).toISOString() : undefined, updatedAt: new Date().toISOString(), lastEvent: 'Borrador guardado localmente' };
      const previous = readLocal();
      localStorage.setItem('docubox_notifica_drafts', JSON.stringify([local, ...previous.filter((item) => item.id !== id)]));
      localStorage.setItem(`docubox_notifica_detail_${id}`, JSON.stringify({ ...local, message: draft.message, requireOtp: draft.requireOtp, channels: draft.channels, responseMode: draft.responseMode, documentSnapshot: { id: selectedDocument.id, name: selectedDocument.nombre, size: selectedDocument.file_size, status: selectedDocument.estado }, recipient: { name: draft.recipientName, email: draft.recipientEmail, phone: draft.recipientPhone }, error: caught instanceof Error ? caught.message : '' }));
      router.push(`/notificaciones/${id}`);
    } finally { setSaving(false); }
  };

  return <div className="min-h-screen bg-[#f6f8fb] text-slate-950 dark:bg-background dark:text-foreground">
    <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-border dark:bg-card md:px-6">
      <div className="flex items-center gap-4"><button onClick={() => router.push('/notificaciones')} aria-label="Salir" className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-border"><ArrowLeft size={17} /></button><AppLogo className="[&_img]:h-auto [&_img]:w-[126px]" /><div className="hidden h-8 w-px bg-slate-200 md:block" /><div className="hidden md:block"><p className="text-sm font-600">Nueva notificacion</p><p className="text-xs text-slate-500">Comunicacion certificada</p></div></div>
      <div className="text-right"><p className="text-xs font-500 text-slate-600">Paso {step + 1} de {steps.length}</p><div className="mt-1.5 h-1.5 w-32 overflow-hidden rounded-full bg-slate-100 md:w-52"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div></div>
    </header>
    <div className="mx-auto grid max-w-[1500px] md:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden min-h-[calc(100vh-72px)] border-r border-slate-200 bg-white p-4 dark:border-border dark:bg-card md:block"><p className="mb-3 px-2 text-[11px] font-600 uppercase tracking-[0.08em] text-slate-400">Configuracion</p><ol className="space-y-1">{steps.map((item, index) => { const Icon = item.icon; const active = index === step; const done = index < step; return <li key={item.label}><button onClick={() => index < step && setStep(index)} className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition ${active ? 'bg-blue-50 font-600 text-primary dark:bg-primary/10' : done ? 'text-slate-700 hover:bg-slate-50 dark:text-foreground' : 'cursor-default text-slate-400'}`}><span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${done ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-primary bg-white text-primary' : 'border-slate-200'}`}>{done ? <Check size={13} /> : <Icon size={13} />}</span>{item.label}</button></li>; })}</ol></aside>
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8 lg:px-12"><div className="mx-auto max-w-4xl"><div className="mb-6"><p className="text-xs font-600 text-primary">{steps[step].label}</p><h1 className="mt-1 text-2xl font-600">{titles[step]}</h1><p className="mt-1 text-sm text-slate-500">{descriptions[step]}</p></div><section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-border dark:bg-card md:p-6">
        {step === 0 && <DocumentStep documents={documents} selected={draft.documentId} loading={loadingDocuments} onChange={(documentId) => setDraft({ ...draft, documentId })} />}
        {step === 1 && <ClassificationStep draft={draft} setDraft={setDraft} />}
        {step === 2 && <RecipientStep draft={draft} setDraft={setDraft} />}
        {step === 3 && <ConfigurationStep draft={draft} setDraft={setDraft} />}
        {step === 4 && <ConfirmationStep draft={draft} document={selectedDocument} />}
      </section>{error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}<footer className="mt-6 flex items-center justify-between"><button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-600 text-slate-600 disabled:opacity-0 dark:border-border dark:bg-card"><ArrowLeft size={15} /> Atras</button>{step < steps.length - 1 ? <button onClick={() => canContinue && setStep(step + 1)} disabled={!canContinue} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-600 text-white disabled:opacity-50">Guardar y continuar <ArrowRight size={15} /></button> : <button onClick={createNotification} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-600 text-white disabled:opacity-60">{saving ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Crear borrador</button>}</footer></div></main>
    </div>
  </div>;
}

const titles = ['Selecciona el documento canonico', 'Clasifica la comunicacion', 'Identifica al destinatario', 'Define acceso y actuacion', 'Revisa antes de crear'];
const descriptions = ['La version y el SHA-256 se fijaran al crear la notificacion.', 'La categoria ayuda a aplicar reglas, plazos y plantillas.', 'Registra a la persona que recibira el acceso seguro.', 'Los canales avisan; el documento permanece dentro de Docubox.', 'El borrador podra publicarse cuando la informacion sea correcta.'];
const inputClass = 'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background';

function DocumentStep({ documents, selected, loading, onChange }: { documents: DocumentOption[]; selected: string; loading: boolean; onChange: (id: string) => void }) { if (loading) return <div className="flex min-h-56 items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>; if (!documents.length) return <div className="rounded-md border border-dashed border-slate-300 p-8 text-center"><FileText className="mx-auto text-slate-400" /><p className="mt-3 text-sm font-600">No hay documentos disponibles</p><p className="mt-1 text-sm text-slate-500">Carga o completa un documento antes de notificarlo.</p></div>; return <div className="space-y-2">{documents.map((document) => <button key={document.id} onClick={() => onChange(document.id)} className={`flex w-full items-center gap-3 rounded-md border p-4 text-left transition ${selected === document.id ? 'border-primary bg-blue-50 dark:bg-primary/10' : 'border-slate-200 hover:border-blue-200 dark:border-border'}`}><span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-600"><FileText size={18} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-600">{document.nombre}</span><span className="mt-1 block text-xs text-slate-500">{document.documento_id || 'Documento Docubox'} · {formatBytes(document.file_size)} · {document.estado || 'Sin estado'}</span></span>{selected === document.id && <Check size={18} className="text-primary" />}</button>)}</div>; }
function ClassificationStep({ draft, setDraft }: { draft: Draft; setDraft: (value: Draft) => void }) { return <div className="space-y-5"><Field label="Asunto" value={draft.subject} onChange={(subject) => setDraft({ ...draft, subject })} placeholder="Ej. Requerimiento de pago de factura vencida" /><div><Label>Categoria</Label><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} className={inputClass}>{NOTIFICATION_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></div><div><Label>Mensaje para el destinatario</Label><textarea value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} rows={5} placeholder="Explica de forma breve que debe revisar o atender." className="w-full rounded-md border border-slate-200 bg-white p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background" /></div></div>; }
function RecipientStep({ draft, setDraft }: { draft: Draft; setDraft: (value: Draft) => void }) { return <div className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2"><Field label="Nombre o razon social" value={draft.recipientName} onChange={(recipientName) => setDraft({ ...draft, recipientName })} placeholder="Destinatario legal" /></div><Field label="Correo electronico" type="email" value={draft.recipientEmail} onChange={(recipientEmail) => setDraft({ ...draft, recipientEmail })} placeholder="persona@empresa.mx" /><Field label="Telefono" value={draft.recipientPhone} onChange={(recipientPhone) => setDraft({ ...draft, recipientPhone })} placeholder="+52 669 000 0000" /></div>; }
function ConfigurationStep({ draft, setDraft }: { draft: Draft; setDraft: (value: Draft) => void }) { const toggleChannel = (channel: string) => setDraft({ ...draft, channels: draft.channels.includes(channel) ? draft.channels.filter((item) => item !== channel) : [...draft.channels, channel] }); return <div className="space-y-6"><div><Label>Canales de aviso</Label><div className="grid gap-3 sm:grid-cols-3">{[['email','Correo',Mail],['sms','SMS',MessageSquareText],['whatsapp','WhatsApp',Send]].map(([value,label,Icon]: any) => <button key={value} onClick={() => toggleChannel(value)} className={`flex h-12 items-center gap-2 rounded-md border px-3 text-sm font-600 ${draft.channels.includes(value) ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200 text-slate-600 dark:border-border'}`}><Icon size={16} />{label}{draft.channels.includes(value) && <Check size={14} className="ml-auto" />}</button>)}</div></div><label className="flex items-start gap-3 rounded-md border border-slate-200 p-4 dark:border-border"><input type="checkbox" checked={draft.requireOtp} onChange={(event) => setDraft({ ...draft, requireOtp: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary" /><span><span className="block text-sm font-600">Solicitar OTP antes de consultar</span><span className="mt-1 block text-xs leading-5 text-slate-500">Recomendado para acreditar que el correo fue controlado por el destinatario.</span></span></label><div className="grid gap-4 md:grid-cols-2"><div><Label>Actuacion esperada</Label><select value={draft.responseMode} onChange={(event) => setDraft({ ...draft, responseMode: event.target.value, allowedActions: event.target.value === 'accept_or_reject' ? ['acknowledge','accept','reject'] : event.target.value === 'respond' ? ['acknowledge','respond'] : ['acknowledge'] })} className={inputClass}><option value="acknowledge">Solo acusar recepcion</option><option value="respond">Acusar y responder</option><option value="accept_or_reject">Aceptar o rechazar</option></select></div><Field label="Fecha limite" type="date" value={draft.dueAt} onChange={(dueAt) => setDraft({ ...draft, dueAt })} /></div></div>; }
function ConfirmationStep({ draft, document }: { draft: Draft; document?: DocumentOption }) { return <div className="space-y-5"><div className="rounded-md border border-emerald-200 bg-emerald-50 p-4"><div className="flex gap-3"><ShieldCheck size={19} className="mt-0.5 text-emerald-700" /><div><p className="text-sm font-600 text-emerald-950">Snapshot verificable</p><p className="mt-1 text-xs leading-5 text-emerald-800">Al crear el borrador se registraran la version, el hash SHA-256 y la configuracion. Publicar generara un acceso seguro independiente.</p></div></div></div><dl className="grid gap-4 sm:grid-cols-2"><Summary label="Documento" value={document?.nombre || 'Sin documento'} /><Summary label="Categoria" value={draft.category} /><Summary label="Destinatario" value={`${draft.recipientName} · ${draft.recipientEmail}`} /><Summary label="Acceso" value={draft.requireOtp ? 'Enlace seguro + OTP' : 'Enlace seguro'} /><Summary label="Canales" value={draft.channels.join(', ')} /><Summary label="Actuacion" value={draft.responseMode === 'acknowledge' ? 'Acuse de recepcion' : draft.responseMode === 'respond' ? 'Respuesta' : 'Aceptar o rechazar'} /></dl></div>; }
function Field({ label, value, onChange, placeholder = '', type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) { return <div><Label>{label}</Label><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={inputClass} /></div>; }
function Label({ children }: { children: React.ReactNode }) { return <label className="mb-1.5 block text-xs font-500 text-slate-600 dark:text-muted-foreground">{children}</label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-md bg-slate-50 p-3 dark:bg-background"><dt className="text-[11px] font-600 uppercase tracking-[0.06em] text-slate-400">{label}</dt><dd className="mt-1 text-sm font-600">{value}</dd></div>; }
function formatBytes(value?: number) { if (!value) return 'Tamano no disponible'; return value > 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`; }
function readLocal(): CertifiedNotificationSummary[] { try { return JSON.parse(localStorage.getItem('docubox_notifica_drafts') || '[]'); } catch { return []; } }
