'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFormBuilder } from '@/contexts/FormBuilderContext';
import { useFormAutoSave } from '@/hooks/useFormAutoSave';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import FieldLibrary from './components/FieldLibrary';
import BuilderCanvas from './components/BuilderCanvas';
import VisualCanvas from './components/VisualCanvas';
import FieldProperties from './components/FieldProperties';
import AppLayout from '@/components/AppLayout';
import { List, Grid, Save, Send, ArrowLeft, Plus, FileText, CheckCircle, Loader2, Search, Copy, Trash2, ChevronRight,  } from 'lucide-react';

// ── Builder Inner (needs context) ────────────────────────────
function BuilderInner({ templateId }: { templateId?: string }) {
  const { state, dispatch } = useFormBuilder();
  const { save, isSaving, lastSaved, isDirty } = useFormAutoSave(templateId);
  const router = useRouter();

  const handlePublish = async () => {
    dispatch({ type: 'SET_TEMPLATE_META', payload: { status: 'published' } });
    await save();
  };

  const saveIndicator = isSaving
    ? 'Guardando...'
    : isDirty
    ? 'Cambios sin guardar'
    : lastSaved
    ? `Guardado ${lastSaved.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
    : 'Sin cambios';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background flex-shrink-0">
        <button
          onClick={() => router.push('/formularios')}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
        >
          <ArrowLeft size={16} />
        </button>

        <input
          type="text"
          value={state.template.name}
          onChange={(e) => dispatch({ type: 'SET_TEMPLATE_META', payload: { name: e.target.value } })}
          className="text-sm font-semibold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-primary/30 rounded px-2 py-1 text-foreground min-w-0 flex-1 max-w-xs"
        />

        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => dispatch({ type: 'SET_CANVAS_MODE', payload: 'list' })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              state.canvasMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <List size={13} /> Lista
          </button>
          <button
            onClick={() => dispatch({ type: 'SET_CANVAS_MODE', payload: 'visual' })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              state.canvasMode === 'visual' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Grid size={13} /> Visual
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Save indicator */}
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
        {/* Left panel */}
        <div className="w-[280px] flex-shrink-0 overflow-hidden">
          <FieldLibrary />
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-hidden flex flex-col bg-gray-50">
          {state.canvasMode === 'list' ? <BuilderCanvas /> : <VisualCanvas />}
        </div>

        {/* Right panel */}
        <div className="w-[320px] flex-shrink-0 overflow-hidden">
          <FieldProperties />
        </div>
      </div>
    </div>
  );
}

// ── Form Management Table ─────────────────────────────────────
interface FormTemplate {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  schema: unknown[];
  created_at: string;
  updated_at: string;
  created_by: string;
}

function FormManagement() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const supabase = createClient();

  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'formularios' | 'respuestas'>('formularios');

  useEffect(() => {
    if (activeWorkspace) loadTemplates();
  }, [activeWorkspace]);

  const loadTemplates = async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('form_templates')
        .select('*')
        .eq('workspace_id', activeWorkspace.id)
        .order('updated_at', { ascending: false });
      if (!error) setTemplates(data || []);
    } catch { /* silent */ }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este formulario?')) return;
    await supabase.from('form_templates').delete().eq('id', id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const handleDuplicate = async (template: FormTemplate) => {
    if (!activeWorkspace || !user) return;
    const { data } = await supabase
      .from('form_templates')
      .insert({
        workspace_id: activeWorkspace.id,
        name: `${template.name} (copia)`,
        status: 'draft',
        schema: template.schema,
        settings: {},
        created_by: user.id,
      })
      .select()
      .single();
    if (data) setTemplates((prev) => [data, ...prev]);
  };

  const filtered = templates.filter((t) => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      draft: 'bg-yellow-100 text-yellow-700',
      published: 'bg-green-100 text-green-700',
      archived: 'bg-gray-100 text-gray-600',
    };
    const labels: Record<string, string> = { draft: 'Borrador', published: 'Publicado', archived: 'Archivado' };
    return (
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${map[status] || ''}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Formularios</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Crea y gestiona formularios para recopilar información de tus destinatarios.
            </p>
          </div>
          <button
            onClick={() => router.push('/formularios/builder')}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} /> Nuevo formulario
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {(['formularios', 'respuestas'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'formularios' ? 'Formularios' : 'Respuestas'}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar formularios..."
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">Todos los estados</option>
            <option value="draft">Borrador</option>
            <option value="published">Publicado</option>
            <option value="archived">Archivado</option>
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <FileText size={24} className="text-primary" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">
              {search || statusFilter !== 'all' ? 'Sin resultados' : 'Sin formularios aún'}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {search || statusFilter !== 'all' ?'Intenta con otros filtros' :'Crea tu primer formulario para comenzar.'}
            </p>
            {!search && statusFilter === 'all' && (
              <button
                onClick={() => router.push('/formularios/builder')}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={16} /> Crear formulario
              </button>
            )}
          </div>
        ) : (
          <div className="bg-background rounded-2xl border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Nombre</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Estado</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Campos</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Última modificación</th>
                  <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((template) => (
                  <tr key={template.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => router.push(`/formularios/builder?id=${template.id}`)}
                        className="text-sm font-medium text-foreground hover:text-primary transition-colors text-left"
                      >
                        {template.name}
                      </button>
                    </td>
                    <td className="px-4 py-3">{statusBadge(template.status)}</td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-muted-foreground">
                        {Array.isArray(template.schema) ? template.schema.length : 0} campos
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-muted-foreground">
                        {new Date(template.updated_at).toLocaleDateString('es-MX')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => router.push(`/formularios/builder?id=${template.id}`)}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                          title="Editar"
                        >
                          <ChevronRight size={14} />
                        </button>
                        <button
                          onClick={() => handleDuplicate(template)}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                          title="Duplicar"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(template.id)}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ── Main page router ──────────────────────────────────────────
export default function FormulariosPage() {
  return <FormManagement />;
}
