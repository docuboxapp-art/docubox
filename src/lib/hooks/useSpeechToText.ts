'use client';

import { useState, useCallback } from 'react';
import { speechToText } from '@/lib/ai/speechToText';
import { createClient } from '@/lib/supabase/client';

export function useSpeechToText(workspaceId?: string) {
  const [text, setText] = useState<string | null>(null);
  const [fullResponse, setFullResponse] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const transcribe = useCallback(
    async (file: Blob | File, parameters: object = {}) => {
      setText(null);
      setFullResponse(null);
      setIsLoading(true);
      setError(null);

      try {
        if (!workspaceId) throw new Error('Selecciona un espacio de trabajo para transcribir.');
        const {
          data: { session },
        } = await createClient().auth.getSession();
        if (!session?.access_token) throw new Error('La sesión expiró. Vuelve a iniciar sesión.');
        const result = await speechToText(file, session.access_token, workspaceId, parameters);
        setText(result?.text ?? null);
        setFullResponse(result);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceId]
  );

  return { text, fullResponse, isLoading, error, transcribe };
}
