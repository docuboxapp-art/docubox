import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useFormBuilder } from '@/contexts/FormBuilderContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  formSaveError,
  persistFormDraft,
  publicationError,
  publishFormDraft,
} from '@/lib/forms/lifecycle';

export function useFormAutoSave(enabled = true, autoSave = true) {
  const { state, dispatch } = useFormBuilder();
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const [error, setError] = useState('');
  const latest = useRef({ state, activeWorkspace, user, enabled });
  useLayoutEffect(() => {
    latest.current = { state, activeWorkspace, user, enabled };
  });
  const inFlight = useRef<Promise<string | undefined> | null>(null);
  const supabase = createClient();

  const save = useCallback(
    function saveOperation(publish = false): Promise<string | undefined> {
      if (inFlight.current) return inFlight.current.then(() => saveOperation(publish));
      const current = latest.current;
      if (!current.enabled || !current.activeWorkspace || !current.user)
        return Promise.reject(new Error('No hay un espacio de trabajo o una sesión disponible.'));
      const snapshot = current.state.template;
      if (snapshot.status !== 'draft')
        return Promise.reject(new Error('Crea una nueva versión para editar este formulario.'));
      const invalid = publish ? publicationError(snapshot) : null;
      if (invalid) return Promise.reject(new Error(invalid));
      if (!current.state.isDirty && snapshot.id && !publish) {
        setError('');
        return Promise.resolve(snapshot.id);
      }

      dispatch({ type: 'SET_SAVING', payload: true });
      setError('');
      const operation = (async () => {
        try {
          let saved = await persistFormDraft(
            supabase,
            snapshot,
            current.activeWorkspace!.id,
            current.user!.id
          );
          // Keep the row identity if publication fails; retries must update this draft.
          latest.current = {
            ...latest.current,
            state: {
              ...latest.current.state,
              template: {
                ...latest.current.state.template,
                id: saved.id,
                updatedAt: saved.updatedAt,
                workspaceId: saved.workspaceId,
              },
            },
          };
          dispatch({ type: 'ACK_SAVE', payload: { snapshot, saved } });
          if (publish) {
            const published = await publishFormDraft(supabase, saved);
            dispatch({ type: 'ACK_SAVE', payload: { snapshot: saved, saved: published } });
            saved = published;
          }
          return saved.id;
        } catch (cause) {
          setError(formSaveError(cause));
          throw cause;
        } finally {
          inFlight.current = null;
          dispatch({ type: 'SET_SAVING', payload: false });
        }
      })();
      inFlight.current = operation;
      return operation;
    },
    [dispatch, supabase]
  );

  useEffect(() => {
    if (!enabled || !autoSave || !state.isDirty || state.isSaving || state.template.status !== 'draft' || error)
      return;
    const timer = setTimeout(() => {
      void save().catch(() => undefined);
    }, 3000);
    return () => clearTimeout(timer);
  }, [enabled, autoSave, state.isDirty, state.isSaving, state.template, save, error]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!latest.current.state.isDirty && !inFlight.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return {
    save,
    error,
    clearError: () => setError(''),
    templateId: state.template.id,
    isSaving: state.isSaving,
    lastSaved: state.lastSaved,
    isDirty: state.isDirty,
  };
}
