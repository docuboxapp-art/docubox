import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

type UserResult = Awaited<ReturnType<SupabaseClient['auth']['getUser']>>;
const pendingUsers = new Map<string, Promise<UserResult>>();
const MAX_PENDING_USERS = 128;

/** Share only an identical Auth lookup that is still running. Never retain a
 * completed identity/permission decision, and never combine different tokens
 * or project credentials. The underlying Auth request retains its deadline.
 */
export function getUserForRequest(
  client: SupabaseClient,
  accessToken: string,
  credentialScope: string
): Promise<UserResult> {
  const key = createHash('sha256')
    .update(credentialScope)
    .update('\0')
    .update(accessToken)
    .digest('hex');
  const existing = pendingUsers.get(key);
  if (existing) return existing;

  const result = Promise.resolve().then(() => client.auth.getUser(accessToken));
  if (pendingUsers.size < MAX_PENDING_USERS) {
    pendingUsers.set(key, result);
    const clear = () => {
      if (pendingUsers.get(key) === result) pendingUsers.delete(key);
    };
    void result.then(clear, clear);
  }
  return result;
}
