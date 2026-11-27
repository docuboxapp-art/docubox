import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import type { createAnonClient } from '@/lib/supabase/server';

type UserVerification = ReturnType<ReturnType<typeof createAnonClient>['auth']['getUser']>;
type VerifyUser = () => UserVerification;

const bootstrapAuth = new AsyncLocalStorage<{ token: string; verify: VerifyUser }>();

export function withDocumentBootstrapAuth<T>(token: string, verify: VerifyUser, run: () => T): T {
  let pending: UserVerification | undefined;
  return bootstrapAuth.run({ token, verify: () => (pending ??= verify()) }, run);
}

export function verifyDocumentBearer(token: string, verify: VerifyUser): UserVerification {
  const scope = bootstrapAuth.getStore();
  return scope?.token === token ? scope.verify() : verify();
}
