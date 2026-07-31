'use client';

import React, { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { FormBuilderProvider, useFormBuilder } from '@/contexts/FormBuilderContext';
import { useFormAutoSave } from '@/hooks/useFormAutoSave';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import FieldLibrary from '../components/FieldLibrary';
import BuilderCanvas from '../components/BuilderCanvas';
import VisualCanvas from '../components/VisualCanvas';
import FieldProperties from '../components/FieldProperties';
import { useRouter } from 'next/navigation';
import {
  List, Grid, Save, Send, ArrowLeft,
  CheckCircle, Loader2,
} from 'lucide-react';

function BuilderInner() {
  const searchParams = useSearchParams();
  const templateId = searchParams?.get('id') || undefined;
  const { state, dispatch } = useFormBuilder();
  const { save, isSaving, lastSaved, isDirty } = useFormAutoSave(templateId);
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const supabase = createClient();
  const router = useRouter();

  // Load existing template
  useEffect(() => {
    if (!templateId) return;
    const load = async () => {
      const { data } = await supabase?.from('form_templates')?.select('*')?.eq('id', templateId)?.single();
      if (data) {
        dispatch({
          type: 'SET_TEMPLATE',
          payload: {
            id: data?.id,
            name: data?.name,
            description: data?.description || '',
            status: data?.status,
            schema: Array.isArray(data?.schema) ? data?.schema : [],
            sections: data?.settings?.sections || [],
            settings: {
              mode: data?.settings?.mode || 'scroll',
              multiStep: data?.settings?.multiStep || false,
              language: data?.settings?.language || 'es',
              expirationHours: data?.settings?.expirationHours || 72,
              redirectAfterSubmit: data?.settings?.redirectAfterSubmit,
            },
            pdfBasePath: data?.pdf_base_path || undefined,
            workspaceId: data?.workspace_id,
          },
        });
      }
    };
    load();
  }, [templateId]);

  const handlePublish = async () => {
    dispatch({ type: 'SET_TEMPLATE_META', payload: { status: 'published' } });
    await save();
  };

  const saveIndicator = isSaving
    ? 'Guardando...'
    : isDirty
    ? 'Cambios sin guardar'
    : lastSaved
    ? `Guardado ${lastSaved?.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
    : 'Sin cambios';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background flex-shrink-0 z-10">
        <button
          onClick={() => router?.push('/formularios')}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
        >
          <ArrowLeft size={16} />
        </button>

        <input
          type="text"
          value={state?.template?.name}
          onChange={(e) => dispatch({ type: 'SET_TEMPLATE_META', payload: { name: e?.target?.value } })}
          className="text-sm font-semibold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-primary/30 rounded px-2 py-1 text-foreground min-w-0 flex-1 max-w-xs"
        />

        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => dispatch({ type: 'SET_CANVAS_MODE', payload: 'list' })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              state?.canvasMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <List size={13} /> Lista
          </button>
          <button
            onClick={() => dispatch({ type: 'SET_CANVAS_MODE', payload: 'visual' })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              state?.canvasMode === 'visual' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Grid size={13} /> Visual
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isSaving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : isDirty ? (
              <div className="w-2 h-2 rounded-full bg-orange-400" />
            ) : (
              <CheckCircle size={12} className="text-green-500" />
            )}
            <span>{saveIndicator}</span>
          </div>

          <button
            onClick={save}
            disabled={isSaving || !isDirty}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <Save size={13} /> Guardar borrador
          </button>

          <button
            onClick={handlePublish}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Send size={13} /> Publicar
          </button>
        </div>
      </div>
      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[280px] flex-shrink-0 overflow-hidden">
          <FieldLibrary />
        </div>
        <div className="flex-1 overflow-hidden flex flex-col bg-gray-50">
          {state?.canvasMode === 'list' ? <BuilderCanvas /> : <VisualCanvas />}
        </div>
        <div className="w-[320px] flex-shrink-0 overflow-hidden">
          <FieldProperties />
        </div>
      </div>
    </div>
  );
}

function BuilderWithSuspense() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    }>
      <BuilderInner />
    </Suspense>
  );
}

export default function BuilderPage() {
  return (
    <FormBuilderProvider>
      <BuilderWithSuspense />
    </FormBuilderProvider>
  );
}
