'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileText, FolderOpen, LayoutTemplate, ListChecks, UserRound, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fetchAllPages } from '@/lib/tasks/pagination';
import { completionMode } from '@/lib/tasks/completion-policy';

type SourceKind = 'document' | 'form_template' | 'template' | 'case_file' | 'form_response' | 'user' | 'task' | 'participant_requirement';
type Option = { id: string; name: string; status?: string };
type Member = { id: string; name: string };

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

export default function NewTaskWizard({ workspaceId, userId, canAssign, isPersonal, onClose, onCreated }: {
  workspaceId: string; userId: string; canAssign: boolean; isPersonal: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<'accion' | 'actividad'>('actividad');
  const [sourceKind, setSourceKind] = useState<SourceKind>('document');
  const [sourceId, setSourceId] = useState('');
  const [type, setType] = useState('revisar_documento');
  const [priority, setPriority] = useState<'baja' | 'media' | 'alta' | 'critica'>('media');
  const [dueDate, setDueDate] = useState('');
  const [assignee, setAssignee] = useState(userId);
  const [description, setDescription] = useState('');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Record<SourceKind, Option[]>>({ document: [], form_template: [], template: [], case_file: [], form_response: [], user: [], task: [], participant_requirement: [] });
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
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
        fetchAllPages((from,to) => supabase.from('form_responses').select('id,folio,status,respondent_name').eq('workspace_id', workspaceId).order('submitted_at', { ascending: false }).order('id').range(from,to)),
        fetchAllPages((from,to) => supabase.from('tareas').select('id,title,estado').eq('workspace_id', workspaceId).not('estado', 'in', '(completada,cancelada,rechazada)').order('created_at', { ascending: false }).order('id').range(from,to)),
        fetchAllPages((from,to) => supabase.from('workspace_members').select('user_id,user_profiles!workspace_members_user_id_fkey(full_name,email)').eq('workspace_id', workspaceId).eq('status', 'active').order('user_id').range(from,to)),
        fetchAllPages((from,to) => supabase.from('participant_document_requirements').select('id,name,status,document_id').eq('workspace_id', workspaceId).in('status', ['pending', 'rejected']).order('created_at', { ascending: false }).order('id').range(from,to)),
      ]);
      if (cancelled) return;
      setOptions({
        document: [...docs, ...personalDocs].map(row => ({ id: row.id, name: row.nombre, status: row.estado })),
        form_template: forms.map(row => ({ id: row.id, name: row.name, status: row.status })),
        template: templates.map(row => ({ id: row.id, name: row.nombre, status: row.estado })),
        case_file: cases.map(row => ({ id: row.id, name: row.title, status: row.status })),
        form_response: responses.map(row => ({ id: row.id, name: row.folio || row.respondent_name || 'Respuesta', status: row.status })),
        user: memberRows.filter(row => canAssign || row.user_id === userId).map((row: any) => ({ id: row.user_id, name: row.user_profiles?.full_name || row.user_profiles?.email || 'Usuario', status: 'Miembro activo' })),
        task: relatedTasks.map(row => ({ id: row.id, name: row.title, status: row.estado })),
        participant_requirement: requirements.map(row => ({ id: row.id, name: `${row.name} · ${[...docs, ...personalDocs].find(doc => doc.id === row.document_id)?.nombre || 'Documento'}`, status: row.status })),
      });
      setMembers(memberRows.map((row: any) => ({ id: row.user_id, name: row.user_profiles?.full_name || row.user_profiles?.email || 'Usuario' })));
      setLoading(false);
    }
    void load().catch(loadError => { if (!cancelled) { setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los recursos.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [workspaceId, userId, canAssign, isPersonal, supabase]);

  const selectedSource = sources.find(item => item.key === sourceKind)!;
  const filteredOptions = options[sourceKind].filter(option => option.name?.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  const next = () => {
    if (step === 1 && !sourceId) { setError('Selecciona un recurso real para continuar.'); return; }
    setError(''); setStep(value => Math.min(value + 1, 2));
  };
  const save = async () => {
    if (!sourceId) return;
    setSaving(true); setError('');
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) { setError('Tu sesión expiró. Inicia sesión de nuevo.'); setSaving(false); return; }
    const response = await fetch('/api/tareas', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspaceId, sourceKind, sourceId, workKind: kind, type, priority,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        assigneeId: assignee, description }) });
    const result = await response.json();
    if (!response.ok) { setError(result.error || 'No se pudo crear la tarea.'); setSaving(false); return; }
    onCreated(); onClose();
  };

  return <div role="dialog" aria-modal="true" aria-label="Nueva tarea" className="fixed inset-0 z-[70] overflow-y-auto bg-[#f6f8fb]">
    <div className="mx-auto min-h-screen w-full max-w-5xl bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-8">
        <div><h2 className="text-lg font-semibold text-slate-950">Nueva tarea</h2><p className="text-sm text-slate-500">Vincula el trabajo a un recurso existente.</p></div>
        <button onClick={onClose} className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"><X size={16} /> Cerrar</button>
      </header>
      <div className="border-b border-slate-200 px-5 py-4 sm:px-8"><div className="flex gap-2 text-sm">{['Tipo', 'Recurso', 'Asignación'].map((label, index) => <span key={label} className={`rounded-full px-3 py-1 ${step === index ? 'bg-blue-600 text-white' : index < step ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{index + 1}. {label}</span>)}</div></div>
      <div className="space-y-6 px-5 py-8 sm:px-8">
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {step === 0 && <>
          <div><h3 className="text-base font-semibold text-slate-950">¿Qué tipo de trabajo necesitas?</h3><p className="mt-1 text-sm text-slate-500">Una acción del proceso se resuelve en su documento, formulario o expediente. Una actividad coordina trabajo de tu equipo.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">{([['accion','Acción del proceso','Tiene una operación concreta en el recurso.'],['actividad','Actividad','Seguimiento que se puede completar desde tareas.']] as const).map(([value,label,help]) => <button key={value} onClick={() => setKind(value)} className={`rounded-lg border p-4 text-left ${kind === value ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}><span className="font-semibold text-slate-950">{label}</span><span className="mt-1 block text-sm text-slate-500">{help}</span></button>)}</div>
          <div><label className="mb-2 block text-sm font-medium text-slate-700">Recurso de origen</label><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{sources.map(source => { const Icon = source.icon; return <button key={source.key} onClick={() => { setSourceKind(source.key); setSourceId(''); setType(source.types[0].key); setKind(completionMode(source.types[0].key, source.key) === 'verified' ? 'accion' : 'actividad'); setAssignee(userId); setQuery(''); }} className={`flex items-center gap-2 rounded-md border px-3 py-3 text-sm ${sourceKind === source.key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-700'}`}><Icon size={16} />{source.label}</button>; })}</div></div>
          <div><label htmlFor="task-type" className="mb-2 block text-sm font-medium text-slate-700">Trabajo requerido</label><select id="task-type" value={type} onChange={event => { setType(event.target.value); setKind(completionMode(event.target.value, sourceKind) === 'verified' ? 'accion' : 'actividad'); }} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{selectedSource.types.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div>
        </>}
        {step === 1 && <>
          <div><h3 className="text-base font-semibold text-slate-950">Selecciona el {selectedSource.label.toLocaleLowerCase('es')}</h3><p className="mt-1 text-sm text-slate-500">Solo aparecen recursos existentes que puedes consultar en este espacio.</p></div>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Buscar ${selectedSource.label.toLocaleLowerCase('es')}...`} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
          {loading ? <p className="text-sm text-slate-500">Cargando recursos...</p> : filteredOptions.length === 0 ? <p className="rounded-md border border-dashed border-slate-200 p-6 text-sm text-slate-500">No hay recursos disponibles para esta selección.</p> : <div className="max-h-[420px] space-y-2 overflow-y-auto">{filteredOptions.map(option => <button key={option.id} onClick={() => { setSourceId(option.id); if (sourceKind === 'user') setAssignee(option.id); }} className={`flex w-full items-center gap-3 rounded-md border p-3 text-left ${sourceId === option.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}><span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{option.name}</span><span className="text-xs text-slate-500">{option.status || ''}</span>{sourceId === option.id && <Check size={16} className="text-blue-600" />}</button>)}</div>}
        </>}
        {step === 2 && <>
          <div><h3 className="text-base font-semibold text-slate-950">Responsable y plazo</h3><p className="mt-1 text-sm text-slate-500">El título se generará con el tipo de trabajo y el recurso que elegiste.</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Prioridad<select value={priority} onChange={event => setPriority(event.target.value as typeof priority)} className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3"><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="critica">Crítica</option></select></label><label className="text-sm font-medium text-slate-700">Fecha límite<input type="datetime-local" value={dueDate} onChange={event => setDueDate(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3" /></label></div>
          {canAssign && <label className="block text-sm font-medium text-slate-700">Responsable<select value={assignee} onChange={event => setAssignee(event.target.value)} disabled={sourceKind === 'user'} className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 disabled:bg-slate-50"><option value={userId}>Yo</option>{members.filter(member => member.id !== userId).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>{sourceKind === 'user' && <span className="mt-1 block text-xs text-slate-500">La validación corresponde a la persona seleccionada.</span>}</label>}
          <label className="block text-sm font-medium text-slate-700">Contexto adicional, si hace falta<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={4} placeholder="Indica qué debe revisar o entregar la persona responsable." className="mt-2 w-full rounded-md border border-slate-200 p-3 text-sm" /></label>
        </>}
      </div>
      <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-4 sm:px-8"><button onClick={() => step === 0 ? onClose() : setStep(value => value - 1)} className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm text-slate-700"><ArrowLeft size={15} />{step === 0 ? 'Cancelar' : 'Atrás'}</button><button onClick={step === 2 ? save : next} disabled={saving || (step === 1 && !sourceId)} className="flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Guardando...' : step === 2 ? 'Crear tarea' : 'Siguiente'}{step < 2 && <ArrowRight size={15} />}</button></footer>
    </div>
  </div>;
}
