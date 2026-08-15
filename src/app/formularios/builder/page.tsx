'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, Eye, FileText, Loader2, PanelLeftOpen, Save, Send,
  ShieldCheck, SlidersHorizontal, X,
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { FormBuilderProvider, useFormBuilder } from '@/contexts/FormBuilderContext';
import { normalizeFormTemplate } from '@/lib/forms/schema';
import { useFormAutoSave } from '@/hooks/useFormAutoSave';
import { createClient } from '@/lib/supabase/client';
import FieldLibrary from '../components/FieldLibrary';
import BuilderCanvas from '../components/BuilderCanvas';
import FieldProperties from '../components/FieldProperties';
import FormPreview from '../components/FormPreview';

function BuilderWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTemplateId = searchParams.get('id') || undefined;
  const { state, dispatch } = useFormBuilder();
  const { save, templateId, isSaving, lastSaved, isDirty } = useFormAutoSave(initialTemplateId);
  const [loading, setLoading] = useState(Boolean(initialTemplateId));
  const [notice, setNotice] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!initialTemplateId) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase.from('form_templates').select('*').eq('id', initialTemplateId).single();
      if (!active) return;
      if (!error && data) {
        const canonicalFields = Array.isArray(data.form_schema?.fields)
          ? data.form_schema.fields
          : Array.isArray(data.schema) ? data.schema : [];
        const canonicalSections = Array.isArray(data.form_schema?.sections)
          ? data.form_schema.sections
          : data.settings?.sections || [];
        dispatch({
          type: 'SET_TEMPLATE',
          payload: normalizeFormTemplate({
            id: data.id,
            name: data.name,
            description: data.description || '',
            status: data.status,
            schema: canonicalFields,
            sections: canonicalSections,
            settings: {
              ...data.settings,
              pdfSchema: data.pdf_schema && Object.keys(data.pdf_schema).length ? data.pdf_schema : data.settings?.pdfSchema,
            },
            pdfBasePath: data.pdf_base_path || undefined,
            workspaceId: data.workspace_id,
          }),
        });
      } else {
        setNotice('No se pudo cargar el formulario solicitado.');
      }
      setLoading(false);
    };
    load();
    return () => { active = false; };
  }, [initialTemplateId]);

  useEffect(() => {
    if (!initialTemplateId && templateId) router.replace(`/formularios/builder?id=${templateId}`);
  }, [initialTemplateId, templateId, router]);

  const handlePublish = async () => {
    if (!state.template.schema.length) {
      setNotice('Agrega al menos un campo antes de publicar.');
      return;
    }
    dispatch({ type: 'SET_TEMPLATE_META', payload: { status: 'published' } });
    await save({ status: 'published' });
    setNotice('Formulario publicado y listo para compartir.');
  };

  const saveLabel = isSaving
    ? 'Guardando cambios'
    : isDirty
      ? 'Cambios pendientes'
      : lastSaved
        ? `Guardado ${lastSaved.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
        : 'Guardado automático';

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-[#F6F8FB]"><Loader2 size={24} className="animate-spin text-[#1E6BFF]" /></div>;
  }

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#F6F8FB] text-[#0F172A] dark:bg-background dark:text-foreground">
      <header className="flex h-[72px] flex-shrink-0 items-center gap-4 border-b border-[#E2E8F0] bg-white px-4 dark:border-border dark:bg-card lg:px-6">
        <button type="button" onClick={() => router.push('/formularios')} className="flex h-9 w-9 items-center justify-center rounded-md border border-[#E2E8F0] text-[#475569] transition hover:bg-[#F8FAFC] dark:border-border dark:text-muted-foreground dark:hover:bg-muted" title="Volver a Mis formularios">
          <ArrowLeft size={16} />
        </button>
        <AppLogo className="hidden sm:flex" />
        <span className="hidden h-8 w-px bg-[#E2E8F0] sm:block" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{state.template.name}</p>
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${state.template.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {state.template.status === 'published' ? 'Publicado' : 'Borrador'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-[#64748B]">Formularios Firmables · esquema único web/PDF</p>
        </div>

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center rounded-md border border-[#E2E8F0] bg-[#F6F8FB] p-1 md:flex dark:border-border dark:bg-muted">
          <ModeButton active={state.canvasMode === 'list'} icon={FileText} label="Estructura" onClick={() => dispatch({ type: 'SET_CANVAS_MODE', payload: 'list' })} />
          <ModeButton active={state.canvasMode === 'preview'} icon={Eye} label="Formulario web" onClick={() => dispatch({ type: 'SET_CANVAS_MODE', payload: 'preview' })} />
          <ModeButton active={state.canvasMode === 'pdf'} icon={ShieldCheck} label="PDF espejo" onClick={() => dispatch({ type: 'SET_CANVAS_MODE', payload: 'pdf' })} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="mr-2 hidden items-center gap-1.5 text-[11px] text-[#64748B] xl:flex">
            {isSaving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} className={isDirty ? 'text-amber-500' : 'text-emerald-600'} />}
            {saveLabel}
          </div>
          <button type="button" onClick={() => save()} disabled={isSaving || !isDirty} className="flex h-9 items-center gap-2 rounded-md border border-[#E2E8F0] px-3 text-xs font-medium text-[#334155] transition hover:bg-[#F8FAFC] disabled:opacity-40 dark:border-border dark:text-foreground">
            <Save size={14} /> <span className="hidden sm:inline">Guardar</span>
          </button>
          <button type="button" onClick={() => setLibraryOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-md border border-[#E2E8F0] text-[#475569] transition hover:bg-[#F8FAFC] lg:hidden dark:border-border dark:text-foreground" title="Abrir biblioteca de campos">
            <PanelLeftOpen size={15} />
          </button>
          <button type="button" onClick={() => setPropertiesOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-md border border-[#E2E8F0] text-[#475569] transition hover:bg-[#F8FAFC] xl:hidden dark:border-border dark:text-foreground" title="Abrir propiedades">
            <SlidersHorizontal size={15} />
          </button>
          <button type="button" onClick={handlePublish} disabled={isSaving} className="flex h-9 items-center gap-2 rounded-md bg-[#1E6BFF] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1D4ED8] disabled:opacity-50">
            <Send size={14} /> Publicar
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[260px] flex-shrink-0 lg:block"><FieldLibrary /></div>
        <main className="min-w-0 flex-1 overflow-hidden">
          {state.canvasMode === 'list' && <BuilderCanvas />}
          {state.canvasMode !== 'list' && (
            <div className="h-full overflow-y-auto bg-[#F1F5F9] px-4 py-7 dark:bg-background md:px-8">
              <FormPreview template={state.template} mode={state.canvasMode === 'pdf' ? 'pdf' : 'web'} />
            </div>
          )}
        </main>
        <div className="hidden w-[340px] flex-shrink-0 xl:block"><FieldProperties /></div>
      </div>

      {libraryOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button type="button" aria-label="Cerrar biblioteca" onClick={() => setLibraryOpen(false)} className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]" />
          <div className="absolute inset-y-0 left-0 w-[min(310px,88vw)] bg-white shadow-2xl dark:bg-card">
            <button type="button" onClick={() => setLibraryOpen(false)} className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-muted" aria-label="Cerrar biblioteca"><X size={16} /></button>
            <FieldLibrary />
          </div>
        </div>
      )}

      {propertiesOpen && (
        <div className="fixed inset-0 z-[80] xl:hidden">
          <button type="button" aria-label="Cerrar propiedades" onClick={() => setPropertiesOpen(false)} className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]" />
          <div className="absolute inset-y-0 right-0 w-[min(360px,92vw)] bg-white shadow-2xl dark:bg-card">
            <button type="button" onClick={() => setPropertiesOpen(false)} className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-500 shadow-sm hover:bg-slate-100 dark:bg-card dark:hover:bg-muted" aria-label="Cerrar propiedades"><X size={16} /></button>
            <FieldProperties />
          </div>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md bg-[#0F172A] px-4 py-3 text-xs font-medium text-white shadow-xl">
          {notice}
          <button type="button" onClick={() => setNotice('')} className="ml-2 text-white/60 hover:text-white">Cerrar</button>
        </div>
      )}
    </div>
  );
}

function ModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: React.ElementType; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-[11px] font-medium transition ${active ? 'bg-white text-[#1E6BFF] shadow-sm dark:bg-card' : 'text-[#64748B] hover:text-[#0F172A] dark:text-muted-foreground dark:hover:text-foreground'}`}><Icon size={13} />{label}</button>;
}

export default function FormBuilderPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-[#F6F8FB]"><Loader2 size={24} className="animate-spin text-[#1E6BFF]" /></div>}>
      <FormBuilderProvider><BuilderWorkspace /></FormBuilderProvider>
    </Suspense>
  );
}
