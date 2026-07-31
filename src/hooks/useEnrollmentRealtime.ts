'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface EnrollmentResult {
  id: string;
  enrollment_token_id: string;
  user_id: string | null;
  token: string;
  session_id: string;
  nombre: string | null;
  apellido_paterno: string | null;
  apellido_materno: string | null;
  curp: string | null;
  rfc: string | null;
  fecha_nacimiento: string | null;
  sexo: string | null;
  tipo_identificacion: string | null;
  face_match_score: number | null;
  face_match_passed: boolean;
  document_metadata: Record<string, unknown> | null;
  status: string;
  notified_at: string | null;
  created_at: string;
}

interface UseEnrollmentRealtimeOptions {
  sessionId?: string;
  onEnrollmentComplete?: (result: EnrollmentResult) => void;
  onError?: (error: string) => void;
}

export function useEnrollmentRealtime({
  sessionId,
  onEnrollmentComplete,
  onError,
}: UseEnrollmentRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabase = createClient();

  const subscribe = useCallback(() => {
    if (!sessionId) return;

    // Clean up existing subscription
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`enrollment_results:session_${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'enrollment_results',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const result = payload.new as EnrollmentResult;
          if (result.status === 'completed') {
            onEnrollmentComplete?.(result);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          onError?.('Error connecting to enrollment updates');
        }
      });

    channelRef.current = channel;
  }, [sessionId, onEnrollmentComplete, onError, supabase]);

  useEffect(() => {
    subscribe();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [subscribe, supabase]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, [supabase]);

  return { unsubscribe };
}

// Hook to watch ALL enrollment completions (for admin/dashboard use)
export function useAllEnrollmentsRealtime({
  onEnrollmentComplete,
  onError,
}: Omit<UseEnrollmentRealtimeOptions, 'sessionId'>) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const channel = supabase
      .channel('enrollment_results:all')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'enrollment_results',
        },
        (payload) => {
          const result = payload.new as EnrollmentResult;
          onEnrollmentComplete?.(result);
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          onError?.('Error connecting to enrollment updates');
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onEnrollmentComplete, onError, supabase]);
}
