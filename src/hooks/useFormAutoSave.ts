import { useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useFormBuilder } from '@/contexts/FormBuilderContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';

export function useFormAutoSave(templateId?: string) {
  const { state, dispatch } = useFormBuilder();
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supabase = createClient();

  const save = useCallback(async () => {
    if (!state.isDirty || !activeWorkspace || !user) return;

    dispatch({ type: 'SET_SAVING', payload: true });

    try {
      const payload = {
        name: state.template.name,
        description: state.template.description,
        status: state.template.status,
        schema: state.template.schema,
        settings: {
          ...state.template.settings,
          sections: state.template.sections,
        },
        pdf_base_path: state.template.pdfBasePath || null,
        workspace_id: activeWorkspace.id,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      };

      if (templateId) {
        const { error } = await supabase
          .from('form_templates')
          .update(payload)
          .eq('id', templateId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('form_templates')
          .insert(payload);
        if (error) throw error;
      }

      dispatch({ type: 'SET_LAST_SAVED', payload: new Date() });
    } catch (err) {
      console.error('Auto-save error:', err);
    } finally {
      dispatch({ type: 'SET_SAVING', payload: false });
    }
  }, [state.isDirty, state.template, activeWorkspace, user, templateId, dispatch, supabase]);

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

  return { save, isSaving: state.isSaving, lastSaved: state.lastSaved, isDirty: state.isDirty };
}
