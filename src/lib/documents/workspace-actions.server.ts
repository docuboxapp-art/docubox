import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { canEditDocumentInProgress } from './workspace-actions';

export async function canEditUnsignedDocument(
  service: SupabaseClient,
  document: Parameters<typeof canEditDocumentInProgress>[0] & { id: string }
) {
  if (!canEditDocumentInProgress(document)) return false;
  const [responses, evidence, attempts] = await Promise.all([
    service
      .from('participation_responses')
      .select('id')
      .eq('documento_id', document.id)
      .eq('firma_completada', true)
      .limit(1)
      .maybeSingle(),
    service
      .from('signature_evidence')
      .select('id')
      .eq('document_id', document.id)
      .eq('evidence_role', 'FINAL_SIGNATURE')
      .eq('is_voided', false)
      .limit(1)
      .maybeSingle(),
    service
      .from('participant_completion_attempts')
      .select('id')
      .eq('document_id', document.id)
      .eq('action_type', 'signature')
      .or(
        `status.eq.committed,and(status.eq.claimed,claim_expires_at.gt.${new Date().toISOString()})`
      )
      .limit(1)
      .maybeSingle(),
  ]);
  const error = responses.error || evidence.error || attempts.error;
  if (error) throw error;
  return !responses.data && !evidence.data && !attempts.data;
}
