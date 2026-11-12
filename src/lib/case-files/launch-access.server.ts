import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPublicCode, hashPublicCode } from '@/lib/forms/public-access-code';
import {
  createInvitationCredential,
  decryptInvitationSecret,
  encryptInvitationSecret,
} from './invitations';
import { CaseRuntimeError } from './runtime.server';
export function caseLaunchCredential(secret: string) {
  const code = createPublicCode();
  return {
    ...createInvitationCredential(secret),
    codeHash: hashPublicCode(code),
    codeCiphertext: encryptInvitationSecret(code, secret),
  };
}
export async function casePublicLaunchAccess(
  service: SupabaseClient,
  caseId: string,
  actorId: string,
  secret: string
) {
  const allowed = await service.rpc('case_invitation_authorize', {
    p_case: caseId,
    p_actor: actorId,
  });
  if (allowed.error) throw allowed.error;
  if (!allowed.data)
    throw new CaseRuntimeError(
      'CASE_ACCESS_DENIED',
      'No tienes permiso para consultar el acceso.',
      403
    );
  const config = await service
    .from('case_launches')
    .select('access_mode')
    .eq('case_file_id', caseId)
    .maybeSingle();
  if (config.error) throw config.error;
  if (config.data?.access_mode !== 'public') return null;
  const row = await service
    .from('case_participant_invitations')
    .select('id,token_ciphertext,app_origin')
    .eq('case_file_id', caseId)
    .eq('participant_role', 'subject')
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('generation', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) return null;
  const code = await service
    .from('case_invitation_codes')
    .select('code_ciphertext')
    .eq('invitation_id', row.data.id)
    .single();
  if (code.error) throw code.error;
  return {
    url: `${row.data.app_origin}/expediente/${decryptInvitationSecret(row.data.token_ciphertext, secret)}`,
    code: decryptInvitationSecret(code.data.code_ciphertext, secret),
  };
}
