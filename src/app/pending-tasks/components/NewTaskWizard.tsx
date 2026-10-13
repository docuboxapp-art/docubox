'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ClipboardCheck, FileText, FolderOpen, LayoutTemplate, ListChecks, UserRound, X } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { createClient } from '@/lib/supabase/client';
import { fetchAllPages } from '@/lib/tasks/pagination';
import { completionMode } from '@/lib/tasks/completion-policy';
import { taskResourceIsEligible } from '@/lib/tasks/resource-eligibility';
import { scheduleValidationError } from '@/lib/tasks/schedule';
import { resourceStatusLabel } from '@/lib/tasks/resource-labels';

type SourceKind = 'document' | 'form_template' | 'template' | 'case_file' | 'form_response' | 'user' | 'task' | 'participant_requirement';
type Option = { id: string; name: string; status?: string };
type Member = { id: string; name: string };

function memberDisplayName(value: unknown): string {
  const profile = Array.isArray(value) ? value[0] : value;
  if (!profile || typeof profile !== 'object') return 'Usuario';
  const data = profile as { full_name?: string | null; email?: string | null };
  return data.full_name || data.email || 'Usuario';
}

const sources: { key: SourceKind; label: string; icon: typeof FileText; types: { key: string; label: string }[] }[] = [
  { key: 'document', label: 'Documento', icon: FileText, types: [
    { key: 'revisar_documento', label: 'Revisar documento' }, { key: 'aprobar_documento', label: 'Aprobar documento' },
    { key: 'firmar_documento', label: 'Firmar documento' },
    { key: 'corregir_datos', label: 'Corregir datos' },
    { key: 'revisar_vencimiento', label: 'Revisar vencimiento' }, { key: 'confirmar_lectura', label: 'Confirmar lectura' },
    { key: 'retomar_borrador', label: 'Continuar borrador' }, { key: 'obtener_nom151', label: 'Obtener constancia NOM-151' },
  ] },
  { key: 'form_template', label: 'Formulario', icon: FileText, types: [
    { key: 'seguimiento_formulario', label: 'Dar seguimiento' }, { key: 'revisar_documento', label: 'Revisar formulario' },
    { key: 'aprobar_documento', label: 'Aprobar formulario' },
  ] },
  { key: 'template', label: 'Plantilla', icon: LayoutTemplate, types: [
    { key: 'revisar_documento', label: 'Revisar plantilla' }, { key: 'aprobar_documento', label: 'Aprobar plantilla' },
  ] },
  { key: 'case_file', label: 'Expediente', icon: FolderOpen, types: [
    { key: 'revisar_expediente', label: 'Revisar expediente' }, { key: 'cerrar_expediente', label: 'Cerrar expediente' },
  ] },
  { key: 'participant_requirement', label: 'Anexo requerido', icon: FileText, types: [
    { key: 'subir_anexo', label: 'Completar anexo' },
  ] },
  { key: 'form_response', label: 'Respuesta de formulario', icon: FileText, types: [
    { key: 'revisar_documento', label: 'Revisar respuesta' }, { key: 'aprobar_documento', label: 'Aprobar respuesta' },
    { key: 'corregir_datos', label: 'Solicitar corrección' },
  ] },
  { key: 'user', label: 'Usuario del espacio', icon: UserRound, types: [
    { key: 'validar_identidad', label: 'Validar identidad' },
  ] },
  { key: 'task', label: 'Otra tarea', icon: ListChecks, types: [
    { key: 'resolver_comentario', label: 'Resolver comentario' }, { key: 'revisar_documento', label: 'Dar seguimiento' },
  ] },
];

const steps = [
  { label: 'Trabajo', icon: ListChecks, description: 'Selecciona qué trabajo se necesita y dónde se realizará.' },
  { label: 'Recurso', icon: FolderOpen, description: 'Vincula la tarea a un recurso real de este espacio.' },
  { label: 'Planificación', icon: CalendarDays, description: 'Define responsable, prioridad y fechas.' },
  { label: 'Confirmar', icon: ClipboardCheck, description: 'Revisa los datos antes de crear la tarea.' },
] as const;

const typeGuidance: Record<string, string> = {
  revisar_documento: 'Revisa el contenido y registra el resultado al completar la actividad.',
  aprobar_documento: 'Revisa la aprobación y registra el resultado en la tarea. Esto no cambia por sí solo el estado del recurso.',
  firmar_documento: 'La tarea se cerrará cuando se compruebe la firma de la persona responsable en el documento.',
  corregir_datos: 'Realiza o solicita la corrección y registra el resultado al cerrar la actividad.',
  revisar_vencimiento: 'Revisa la vigencia del documento y deja constancia del resultado.',
  confirmar_lectura: 'Registra la confirmación de lectura y el resultado en la tarea.',
  retomar_borrador: 'Se cerrará cuando el documento avance o deje de ser un borrador inactivo.',
  obtener_nom151: 'Se cerrará cuando se emita la constancia NOM-151 del documento.',
  seguimiento_formulario: 'Revisa el estado del formulario y registra el resultado del seguimiento.',
  revisar_expediente: 'Revisa el expediente y registra las observaciones al completar la actividad.',
  cerrar_expediente: 'Se cerrará cuando el expediente se cierre en su módulo.',
  subir_anexo: 'Se cerrará cuando el anexo requerido sea entregado y atendido.',
  validar_identidad: 'Se cerrará cuando se compruebe la validación biométrica de la persona.',
  resolver_comentario: 'Resuelve el comentario en la tarea vinculada y registra el resultado.',
};

export default function NewTaskWizard({ workspaceId, userId, canAssign, isPersonal, onClose, onCreated }: {
  workspaceId: string; userId: string; canAssign: boolean; isPersonal: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [step, setStep] = useState(0);
  const [sourceKind, setSourceKind] = useState<SourceKind>('document');
  const [sourceId, setSourceId] = useState('');
  const [type, setType] = useState('revisar_documento');
  const [priority, setPriority] = useState<'baja' | 'media' | 'alta' | 'critica'>('media');
  const [dueDate, setDueDate] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [assignee, setAssignee] = useState(userId);
  const [description, setDescription] = useState('');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Record<SourceKind, Option[]>>({ document: [], form_template: [], template: [], case_file: [], form_response: [], user: [], task: [], participant_requirement: [] });
  const [verifiedUsers, setVerifiedUsers] = useState<string[]>([]);
  const [issuedNomDocuments, setIssuedNomDocuments] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [docs, personalDocs, forms, templates, cases, responses, relatedTasks, memberRows, requirements] = await Promise.all([
        fetchAllPages((from,to) => supabase.from('documentos').select('id,nombre,estado,workspace_id').eq('workspace_id', workspaceId).is('deleted_at', null).order('updated_at', { ascending: false }).order('id').range(from,to)),
        isPersonal ? fetchAllPages((from,to) => supabase.from('documentos').select('id,nombre,estado,workspace_id').is('workspace_id', null).eq('owner_id', userId).is('deleted_at', null).order('updated_at', { ascending: false }).order('id').range(from,to)) : Promise.resolve([]),
        fetchAllPages((from,to) => supabase.from('form_templates').select('id,name,status').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).order('id').range(from,to)),
        fetchAllPages((from,to) => supabase.from('plantillas').select('id,nombre,estado').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).order('id').range(from,to)),
        fetchAllPages((from,to) => supabase.from('case_files').select('id,title,status').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).order('id').range(from,to)),
        fetchAllPages((from,to) => supabase.from('form_responses').select('id,folio,status,respondent_name,template_id,submitted_at').eq('workspace_id', workspaceId).order('submitted_at', { ascending: false }).order('id').range(from,to)),
        fetchAllPages((from,to) => supabase.from('tareas').select('id,title,estado').eq('workspace_id', workspaceId).not('estado', 'in', '(completada,cancelada,rechazada)').order('created_at', { ascending: false }).order('id').range(from,to)),
        fetchAllPages((from,to) => supabase.from('workspace_members').select('user_id,user_profiles!workspace_members_user_id_fkey(full_name,email)').eq('workspace_id', workspaceId).eq('status', 'active').order('user_id').range(from,to)),
        fetchAllPages((from,to) => supabase.from('participant_document_requirements').select('id,name,status,document_id').eq('workspace_id', workspaceId).in('status', ['pending', 'rejected']).order('created_at', { ascending: false }).order('id').range(from,to)),
      ]);
      if (cancelled) return;
      const [identityResult, nomResult] = await Promise.allSettled([
        memberRows.length ? fetchAllPages((from,to) => supabase.from('user_verification_status').select('user_id,biometric_verified')
          .in('user_id', memberRows.map(row => row.user_id)).range(from,to)) : Promise.resolve([]),
        docs.length + personalDocs.length ? fetchAllPages((from,to) => supabase.from('nom151_constancias_doc').select('documento_id,status')
          .in('documento_id', [...docs, ...personalDocs].map(row => row.id)).eq('status', 'issued').range(from,to)) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      if (identityResult.status === 'fulfilled') setVerifiedUsers(identityResult.value.filter(row => row.biometric_verified).map(row => row.user_id));
      if (nomResult.status === 'fulfilled') setIssuedNomDocuments(nomResult.value.map(row => row.documento_id));
      setOptions({
        document: [...docs, ...personalDocs].map(row => ({ id: row.id, name: row.nombre, status: row.estado })),
        form_template: forms.map(row => ({ id: row.id, name: row.name, status: row.status })),
        template: templates.map(row => ({ id: row.id, name: row.nombre, status: row.estado })),
        case_file: cases.map(row => ({ id: row.id, name: row.title, status: row.status })),
        form_response: responses.map(row => ({ id: row.id,
          name: `${forms.find(form => form.id === row.template_id)?.name || 'Formulario'} · ${row.folio || row.respondent_name || (row.submitted_at ? new Date(row.submitted_at).toLocaleDateString('es-MX') : row.id.slice(0, 8).toUpperCase())}`,
          status: row.status })),
        user: memberRows.filter(row => canAssign || row.user_id === userId).map(row => ({ id: row.user_id, name: memberDisplayName(row.user_profiles), status: 'Miembro activo' })),
        task: relatedTasks.map(row => ({ id: row.id, name: row.title, status: row.estado })),
        participant_requirement: requirements.map(row => ({ id: row.id, name: `${row.name} · ${[...docs, ...personalDocs].find(doc => doc.id === row.document_id)?.nombre || 'Documento'}`, status: row.status })),
      });
      setMembers(memberRows.map(row => ({ id: row.user_id, name: memberDisplayName(row.user_profiles) })));
      setLoading(false);
    }
    void load().catch(cause => { if (!cancelled) { setLoadError(cause instanceof Error ? cause.message : 'No se pudieron cargar los recursos.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [workspaceId, userId, canAssign, isPersonal, supabase]);

  const selectedSource = sources.find(item => item.key === sourceKind)!;
  const selectionLabel = sourceKind === 'form_response' ? 'la respuesta de formulario'
    : sourceKind === 'task' ? 'la tarea vinculada'
      : sourceKind === 'participant_requirement' ? 'el anexo requerido'
        : `el ${selectedSource.label.toLocaleLowerCase('es')}`;
  const selectedType = selectedSource.types.find(item => item.key === type)!;
  const selectedResource = options[sourceKind].find(item => item.id === sourceId);
  const kind = completionMode(type, sourceKind) === 'verified' ? 'accion' : 'actividad';
  const filteredOptions = options[sourceKind].filter(option =>
    taskResourceIsEligible(sourceKind, type, option.status)
    && !(type === 'validar_identidad' && verifiedUsers.includes(option.id))
    && !(type === 'obtener_nom151' && issuedNomDocuments.includes(option.id))
    && option.name?.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  const isoDate = (value: string) => {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  };
  const next = () => {
    if (step === 1 && !sourceId) { setError('Selecciona un recurso real para continuar.'); return; }
    if (step === 2) {
      if (scheduledFor && !isoDate(scheduledFor) || dueDate && !isoDate(dueDate)) { setError('Revisa el formato de las fechas.'); return; }
      const scheduleError = scheduleValidationError(isoDate(scheduledFor), isoDate(dueDate));
      if (scheduleError) { setError(scheduleError); return; }
    }
    setError(''); setStep(value => Math.min(value + 1, steps.length - 1));
  };
  const save = async () => {
    if (!sourceId) return;
    if (scheduledFor && !isoDate(scheduledFor) || dueDate && !isoDate(dueDate)) { setError('Revisa el formato de las fechas.'); return; }
    const scheduleError = scheduleValidationError(isoDate(scheduledFor), isoDate(dueDate));
    if (scheduleError) { setError(scheduleError); return; }
    setSaving(true); setError('');
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) { setError('Tu sesión expiró. Inicia sesión de nuevo.'); return; }
      const response = await fetch('/api/tareas', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, sourceKind, sourceId, workKind: kind, type, priority,
          dueDate: isoDate(dueDate), scheduledFor: isoDate(scheduledFor), assigneeId: assignee, description }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error || 'No se pudo crear la tarea.'); return; }
      onCreated(); onClose();
    } catch {
      setError('No se pudo conectar al servicio de tareas. Inténtalo de nuevo.');
    } finally { setSaving(false); }
  };

  const progress = Math.round((step / (steps.length - 1)) * 100);
  const ActiveIcon = steps[step].icon;
  const assigneeName = assignee === userId ? 'Yo' : members.find(member => member.id === assignee)?.name || 'Responsable';
  const formatDate = (value: string) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';

  return <div role="dialog" aria-modal="true" aria-label="Nueva tarea" className="fixed inset-0 z-[70] flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-950">
    <header className="grid min-h-16 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 sm:gap-4 sm:px-4 lg:px-6">
      <AppLogo size={34} imageClassName="max-sm:w-24" />
      <nav aria-label="Pasos de creación de tarea" className="mx-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100/80 p-1 sm:gap-1">
        {steps.map((item, index) => { const Icon = item.icon; const active = index === step; const done = index < step; return <span key={item.label} className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button type="button" onClick={() => { if (done) { setError(''); setStep(index); } }} disabled={!done} aria-current={active ? 'step' : undefined} aria-label={item.label}
            className={`flex h-8 items-center gap-1.5 rounded-md px-1.5 text-sm transition-colors sm:px-2.5 ${active ? 'bg-white text-primary shadow-[0_1px_3px_rgba(15,23,42,0.12)]' : done ? 'text-slate-700 hover:bg-white hover:text-primary' : 'text-slate-400'}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded ${active ? 'bg-primary text-white' : done ? 'bg-primary/10 text-primary' : 'bg-slate-200/70 text-slate-400'}`}>{done ? <CheckCircle2 size={13} /> : <Icon size={13} />}</span>
            <span className="hidden md:inline">{item.label}</span>
          </button>{index < steps.length - 1 && <span className={`h-px w-1.5 sm:w-3 ${done ? 'bg-primary/50' : 'bg-slate-200'}`} />}
        </span>; })}
      </nav>
      <button type="button" onClick={onClose} className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 sm:px-3"><X size={16} /><span className="hidden sm:inline">Cerrar</span></button>
    </header>

    <section className="shrink-0 border-b border-slate-200 bg-[#edf3f8] px-4 py-2 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><ActiveIcon size={16} /></span>
          <h1 className="text-[20px] font-normal text-slate-950">{steps[step].label}</h1>
          <span className="rounded-md bg-slate-200/70 px-1.5 py-0.5 text-sm text-slate-600">Paso {step + 1} de {steps.length}</span>
          <p className="hidden min-w-0 truncate text-sm text-slate-500 lg:block">{steps[step].description}</p>
        </div>
        <div className="flex w-full items-center gap-2 text-sm text-slate-500 sm:w-44"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Progreso" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} /></div><span className="w-8 text-right tabular-nums">{progress}%</span></div>
        <p className="w-full truncate text-sm text-slate-500 lg:hidden">{steps[step].description}</p>
      </div>
    </section>

    <main className="min-h-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto w-full max-w-[1080px] space-y-7 px-4 py-6 sm:px-6 lg:py-9">
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {step === 0 && <>
          <div><h2 className="text-lg font-semibold">¿Qué trabajo necesitas realizar?</h2><p className="mt-1 text-sm text-slate-500">Selecciona el origen y la operación. El tipo de cierre se determina automáticamente.</p></div>
          <div><p className="mb-2 text-sm font-medium text-slate-700">Recurso de origen</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{sources.map(source => { const Icon = source.icon; return <button type="button" key={source.key} aria-pressed={sourceKind === source.key} onClick={() => { setSourceKind(source.key); setSourceId(''); setType(source.types[0].key); setAssignee(userId); setQuery(''); setError(''); }} className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${sourceKind === source.key ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}><Icon size={16} className="shrink-0" />{source.label}</button>; })}</div></div>
          <div className="max-w-xl"><label htmlFor="task-type" className="mb-2 block text-sm font-medium text-slate-700">Trabajo requerido</label><select id="task-type" value={type} onChange={event => { setType(event.target.value); setSourceId(''); setError(''); }} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10">{selectedSource.types.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div>
          <div className="border-l-2 border-primary bg-[#f4f8fc] px-4 py-3 text-sm" aria-live="polite"><p className="font-medium text-primary">{kind === 'accion' ? 'Acción del proceso · cierre comprobado' : 'Actividad · cierre con resultado'}</p><p className="mt-1 text-slate-600">{typeGuidance[type] || 'Realiza el trabajo y registra el resultado al completar la actividad.'}</p></div>
        </>}
        {step === 1 && <>
          <div><h2 className="text-lg font-semibold">Selecciona {selectionLabel}</h2><p className="mt-1 text-sm text-slate-500">{selectedType.label}. Se muestran recursos disponibles de este espacio.</p></div>
          <input value={query} onChange={event => setQuery(event.target.value)} aria-label={`Buscar ${selectedSource.label.toLocaleLowerCase('es')}`} placeholder={`Buscar ${selectedSource.label.toLocaleLowerCase('es')}...`} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10" />
          {loading ? <p role="status" className="text-sm text-slate-500">Cargando recursos...</p> : loadError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">No se pudieron cargar los recursos: {loadError}</p> : filteredOptions.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 p-6 text-sm text-slate-500">{query ? 'No hay coincidencias. Prueba otra búsqueda.' : 'No hay recursos disponibles para este trabajo.'}</p> : <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">{filteredOptions.map(option => <button type="button" key={option.id} onClick={() => { setSourceId(option.id); if (sourceKind === 'user') setAssignee(option.id); setError(''); }} aria-pressed={sourceId === option.id} className={`flex min-h-14 w-full items-center gap-3 rounded-lg border p-3 text-left ${sourceId === option.id ? 'border-primary bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}><span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{option.name}</span><span className="shrink-0 text-xs text-slate-500">{resourceStatusLabel(option.status)}{sourceKind !== 'user' ? ` · ${option.id.slice(0, 8).toUpperCase()}` : ''}</span>{sourceId === option.id && <Check size={16} className="shrink-0 text-primary" />}</button>)}</div>}
        </>}
        {step === 2 && <>
          <div><h2 className="text-lg font-semibold">Responsable y plazo</h2><p className="mt-1 text-sm text-slate-500">La tarea se creará para {selectedResource?.name}. Si no defines un límite, se establecerá dentro de tres días.</p></div>
          <div className="grid gap-5 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Prioridad<select value={priority} onChange={event => setPriority(event.target.value as typeof priority)} className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal"><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="critica">Crítica</option></select></label>
            <label className="text-sm font-medium text-slate-700">Inicio programado (opcional)<input type="datetime-local" value={scheduledFor} onChange={event => setScheduledFor(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal" /><span className="mt-1 block text-xs font-normal text-slate-500">Si queda vacío, estará disponible ahora.</span></label>
            <label className="text-sm font-medium text-slate-700">Fecha límite (opcional)<input type="datetime-local" value={dueDate} onChange={event => setDueDate(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal" /><span className="mt-1 block text-xs font-normal text-slate-500">Debe ser futura y posterior al inicio programado.</span></label>
            {canAssign && <label className="text-sm font-medium text-slate-700">Responsable<select value={assignee} onChange={event => setAssignee(event.target.value)} disabled={sourceKind === 'user'} className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal disabled:bg-slate-50"><option value={userId}>Yo</option>{members.filter(member => member.id !== userId).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>{sourceKind === 'user' && <span className="mt-1 block text-xs font-normal text-slate-500">La validación corresponde a la persona seleccionada.</span>}</label>}
          </div>
          <label className="block text-sm font-medium text-slate-700">Contexto adicional (opcional)<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={4} placeholder="Indica qué debe revisar o entregar la persona responsable." className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm font-normal" /><span className="mt-1 block text-right text-xs font-normal text-slate-400">{description.length}/2000</span></label>
        </>}
        {step === 3 && <>
          <div><h2 className="text-lg font-semibold">Confirma la nueva tarea</h2><p className="mt-1 text-sm text-slate-500">Comprueba el trabajo, el recurso y las fechas antes de guardarla.</p></div>
          <dl className="grid gap-x-8 gap-y-5 border-t border-slate-200 pt-5 sm:grid-cols-2">{[
            ['Trabajo requerido', selectedType.label], ['Clase', kind === 'accion' ? 'Acción del proceso' : 'Actividad'],
            ['Recurso', selectedResource?.name || '—'], ['Origen', selectedSource.label],
            ['Responsable', assigneeName], ['Prioridad', { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' }[priority]],
            ['Inicio', scheduledFor ? formatDate(scheduledFor) : 'Disponible ahora'],
            ['Fecha límite', dueDate ? formatDate(dueDate) : 'Tres días después del inicio'],
          ].map(([label, value]) => <div key={label} className="border-b border-slate-100 pb-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-900">{value}</dd></div>)}</dl>
          {description && <div><p className="text-xs text-slate-500">Contexto adicional</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{description}</p></div>}
          <p className="border-l-2 border-primary bg-[#f4f8fc] px-4 py-3 text-sm text-slate-600">{kind === 'accion' ? 'El cierre se comprobará en el recurso vinculado.' : 'La persona responsable registrará el resultado al completar esta actividad.'}</p>
        </>}
      </div>
    </main>
    <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 lg:px-6"><div className="mx-auto flex w-full max-w-[1480px] items-center justify-between gap-3">
      {step === 0 ? <span /> : <button type="button" onClick={() => { setError(''); setStep(value => value - 1); }} className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3.5 text-sm font-medium text-slate-600 hover:bg-slate-50"><ArrowLeft size={16} />Atrás</button>}
      <button type="button" onClick={step === steps.length - 1 ? save : next} disabled={saving || loading && step === 1 || Boolean(loadError) && step === 1 || step === 1 && !sourceId} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Guardando...' : step === steps.length - 1 ? 'Crear tarea' : 'Siguiente'}{step < steps.length - 1 && <ArrowRight size={16} />}</button>
    </div></footer>
  </div>;
}
