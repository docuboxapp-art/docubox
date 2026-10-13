'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RotateCcw, Save } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { participationTermsText } from '@/lib/signing/participation-terms';

type Settings = { termsText: string | null; canEdit: boolean };
const defaultPreview = participationTermsText(null, 'observador');

async function requestSettings(workspaceId: string, method: 'GET' | 'PUT', termsText?: string | null): Promise<Settings> {
  const { data: auth } = await createClient().auth.getSession();
  if (!auth.session?.access_token) throw new Error('Inicia sesión para administrar esta configuración.');
  const response = await fetch(
    method === 'GET'
      ? `/api/configuracion/participation-terms?workspaceId=${encodeURIComponent(workspaceId)}`
      : '/api/configuracion/participation-terms',
    {
      method,
      headers: { Authorization: `Bearer ${auth.session.access_token}`, ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'PUT' ? JSON.stringify({ workspaceId, termsText }) : undefined,
      cache: 'no-store',
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No fue posible guardar los términos.');
  return payload as Settings;
}

export function ParticipationTermsSettingsPanel({ workspaceId }: { workspaceId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    requestSettings(workspaceId, 'GET').then((value) => {
      if (!active) return;
      setSettings(value);
      setDraft(value.termsText || defaultPreview);
    }).catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId]);

  const save = async (termsText: string | null) => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const value = await requestSettings(workspaceId, 'PUT', termsText);
      setSettings(value);
      setDraft(value.termsText || defaultPreview);
      setEditing(false);
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No fue posible guardar los términos.');
    } finally { setSaving(false); }
  };

  return <section className="rounded-lg border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-slate-950">Términos de participación</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">Se muestran antes de firmar o aprobar un documento. Cada documento nuevo conserva la versión vigente al crearse.</p>
      </div>
      {settings && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{settings.termsText ? 'Personalizados' : 'Predeterminados'}</span>}
    </div>
    {loading ? <p className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Cargando términos...</p> : <>
      {error && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={16} /> Términos guardados.</p>}
      {settings && (editing ? <>
        <label htmlFor="participation-terms-editor" className="mt-5 block text-sm font-medium text-slate-800">Texto que verán los participantes</label>
        <textarea id="participation-terms-editor" value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} rows={13} maxLength={12000} className="mt-2 w-full rounded-md border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
        <p className="mt-1 text-xs text-slate-500">El mismo texto se aplicará a todos los roles. Conserva los saltos de línea que quieras mostrar. {draft.trim().length}/12 000 caracteres.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void save(draft.trim())} disabled={saving || draft.trim().length < 30 || draft.trim().length > 12000} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Save size={15} /> Guardar cambios</button>
          <button type="button" onClick={() => { setDraft(settings.termsText || defaultPreview); setEditing(false); setError(''); }} disabled={saving} className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700">Cancelar</button>
        </div>
      </> : <>
        <div className="mt-5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">{settings.termsText || defaultPreview}</div>
        {settings.canEdit ? <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => { setDraft(settings.termsText || defaultPreview); setEditing(true); setSaved(false); }} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white">Editar términos</button>
          {settings.termsText && <button type="button" onClick={() => void save(null)} disabled={saving} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700 disabled:opacity-50"><RotateCcw size={15} /> Restaurar predeterminados</button>}
        </div> : <p className="mt-3 text-sm text-slate-500">Solo los administradores del espacio pueden editar estos términos.</p>}
      </>)}
    </>}
  </section>;
}
