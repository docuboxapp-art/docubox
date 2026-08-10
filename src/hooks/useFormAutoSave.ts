import { useEffect, useRef, useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useFormBuilder } from '@/contexts/FormBuilderContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import type { FormTemplate } from '@/contexts/FormBuilderContext';

export function useFormAutoSave(templateId?: string) {
  const { state, dispatch } = useFormBuilder();
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [persistedId, setPersistedId] = useState<string | undefined>(templateId);
  const supabase = createClient();

  const save = useCallback(async (overrides?: Partial<FormTemplate>) => {
    if ((!state.isDirty && !overrides) || !activeWorkspace || !user) return persistedId;

    dispatch({ type: 'SET_SAVING', payload: true });

    try {
      const template = { ...state.template, ...(overrides || {}) };
      const payload = {
        name: template.name,
        description: template.description,
        status: template.status,
        schema: template.schema,
        settings: {
          ...template.settings,
          sections: template.sections,
        },
        pdf_base_path: template.pdfBasePath || null,
        workspace_id: activeWorkspace.id,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      };

      const currentId = templateId || persistedId || template.id;
      let savedId = currentId;
      if (currentId) {
        const { error } = await supabase
          .from('form_templates')
          .update(payload)
          .eq('id', currentId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('form_templates')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        if (data?.id) {
          savedId = data.id;
          setPersistedId(data.id);
          dispatch({ type: 'SET_TEMPLATE_META', payload: { id: data.id } });
        }
      }

      dispatch({ type: 'SET_LAST_SAVED', payload: new Date() });
      return savedId;
    } catch (err) {
      console.error('Auto-save error:', err);
    } finally {
      dispatch({ type: 'SET_SAVING', payload: false });
    }
  }, [state.isDirty, state.template, activeWorkspace, user, templateId, persistedId, dispatch, supabase]);

  // Debounce auto-save: 3 seconds after last change
  useEffect(() => {
    if (!state.isDirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      save();
    }, 3000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.isDirty, state.template, save]);

  return {
    save,
    templateId: templateId || persistedId || state.template.id,
    isSaving: state.isSaving,
    lastSaved: state.lastSaved,
    isDirty: state.isDirty,
  };
}
