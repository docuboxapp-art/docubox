import 'server-only';

import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';

export async function requestUser(request: NextRequest): Promise<User | null> {
  const authorization = request.headers.get('authorization');
  const cookieStore = await cookies();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: authorization ? { headers: { authorization } } : undefined,
      cookies: { getAll: () => cookieStore.getAll(), setAll: () => undefined },
    }
  );
  const result = await client.auth.getUser();
  return result.error ? null : result.data.user;
}

export async function canManageDocument(service: SupabaseClient, documentId: string, user: User) {
  const document = await service
    .from('documentos')
    .select('owner_id,workspace_id')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle();
  if (document.error || !document.data) return false;
  if (document.data.owner_id === user.id) return true;
  if (!document.data.workspace_id) return false;
  const member = await service
    .from('workspace_members')
    .select('role,status')
    .eq('workspace_id', document.data.workspace_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  return !member.error && ['owner', 'admin'].includes(String(member.data?.role || ''));
}

export async function canAccessDocument(service: SupabaseClient, documentId: string, user: User) {
  if (await canManageDocument(service, documentId, user)) return true;
  const byUserId = await service
    .from('participation_responses')
    .select('id')
    .eq('documento_id', documentId)
    .eq('participante_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!byUserId.error && byUserId.data) return true;
  if (!user.email) return false;
  const byEmail = await service
    .from('participation_responses')
    .select('id')
    .eq('documento_id', documentId)
    .eq('participante_email', user.email)
    .limit(1)
    .maybeSingle();
  return !byEmail.error && Boolean(byEmail.data);
}

export async function authorizedEvidence(request: NextRequest, documentId: string) {
  const user = await requestUser(request);
  if (!user) return { user: null, service: null, evidence: null, authorized: false };
  const service = createServiceClient();
  const [authorized, manageable] = await Promise.all([
    canAccessDocument(service, documentId, user),
    canManageDocument(service, documentId, user),
  ]);
  if (!authorized) return { user, service, evidence: null, authorized: false };
  const result = await service
    .from('document_blockchain_evidence')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return { user, service, evidence: result.data, authorized: true, manageable };
}
