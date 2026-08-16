'use client';

import { FormEvent, useState } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaboration } from '@/contexts/CollaborationContext';
import { useCollaborationApi } from '@/lib/collaboration/client';

export default function CollaborationSettingsPage() {
  const { activeWorkspace } = useWorkspace();
  const { settings, can, refresh } = useCollaboration();
  const api = useCollaborationApi();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeWorkspace?.id) return;
    const form = new FormData(event.currentTarget);
    setSaving(true); setMessage('');
    try {
      await api('/api/colabora/access', { method: 'POST', body: JSON.stringify({ workspace_id: activeWorkspace.id, action: 'update_settings', settings: { allow_external_comments: form.get('allow_external_comments') === 'on', allow_external_downloads: form.get('allow_external_downloads') === 'on', watermark_external_files: form.get('watermark_external_files') === 'on', default_due_days: Number(form.get('default_due_days')), default_sla_hours: Number(form.get('default_sla_hours')), retention_days: Number(form.get('retention_days')), timezone: String(form.get('timezone')) } }) });
      await refresh(); setMessage('Configuracion guardada.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar.'); }
    finally { setSaving(false); }
  };
  const writable = can('collaboration.manage_settings', true);
  return <div className="mx-auto max-w-5xl space-y-5"><div><h2 className="text-xl font-medium">Configuracion de Colabora</h2><p className="mt-1 text-sm text-muted-foreground">Valores operativos de la organización y controles para invitados.</p></div><form onSubmit={submit} className="overflow-hidden rounded-lg border border-border bg-background"><div className="border-b border-border px-5 py-4"><h3 className="font-medium">Política operativa</h3><p className="mt-1 text-sm text-muted-foreground">Los cambios se aplican al espacio empresarial activo.</p></div><div className="grid gap-5 p-5 sm:grid-cols-2"><label className="text-sm font-medium">Días predeterminados para una tarea<input disabled={!writable} name="default_due_days" type="number" min="1" max="365" defaultValue={Number(settings?.default_due_days || 5)} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3" /></label><label className="text-sm font-medium">SLA predeterminado (horas)<input disabled={!writable} name="default_sla_hours" type="number" min="1" max="8760" defaultValue={Number(settings?.default_sla_hours || 72)} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3" /></label><label className="text-sm font-medium">Retención (días)<input disabled={!writable} name="retention_days" type="number" min="30" max="36500" defaultValue={Number(settings?.retention_days || 2555)} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3" /></label><label className="text-sm font-medium">Zona horaria<input disabled={!writable} name="timezone" defaultValue={String(settings?.timezone || 'America/Mexico_City')} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3" /></label></div><div className="border-t border-border px-5 py-4"><h3 className="font-medium">Acceso externo</h3></div><div className="divide-y divide-border">{[
    ['allow_external_comments','Permitir comentarios de invitados','Los comentarios externos conservan su audiencia y autor.'],
    ['allow_external_downloads','Permitir descargas externas','Cada sala puede aplicar una restricción más estricta.'],
    ['watermark_external_files','Marca de agua externa','Identifica documentos mostrados a invitados.'],
  ].map(([name, label, description]) => <label key={name} className="flex items-start gap-3 px-5 py-4"><input disabled={!writable} type="checkbox" name={name} defaultChecked={Boolean(settings?.[name])} className="mt-0.5 h-4 w-4 rounded border-border text-primary" /><span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span></span></label>)}</div><div className="flex items-center justify-between border-t border-border px-5 py-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={15} /> Registro auditable</div><div className="flex items-center gap-3">{message && <span className="text-sm text-muted-foreground">{message}</span>}<button disabled={!writable || saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Guardar</button></div></div></form></div>;
}

