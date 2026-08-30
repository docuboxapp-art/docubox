import { notFound, redirect } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { createServiceClient } from '@/lib/supabase/server';
import {
  getServerCookieUser,
  lifecycleRunnerEnabled,
  requireCryptoLifecycleE2EAccess,
} from '@/lib/security/crypto-lifecycle-e2e-access';
import CryptoLifecycleRunnerCard from './CryptoLifecycleRunnerCard';

export const dynamic = 'force-dynamic';

export default async function CryptoLifecycleE2ePage() {
  if (!lifecycleRunnerEnabled()) notFound();
  const user = await getServerCookieUser();
  if (!user) redirect('/login');
  const access = await requireCryptoLifecycleE2EAccess(user, createServiceClient());
  if (!access.allowed) notFound();

  return (
    <AppLayout noPadding>
      <main className="min-h-[calc(100vh-104px)] bg-slate-50 px-4 py-8 dark:bg-background sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-5">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              Administración temporal
            </p>
            <h1 className="mt-2 text-2xl font-medium text-foreground">
              Validación criptográfica E2E
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Herramienta restringida para validar el ciclo productivo completo con un documento
              técnico artificial.
            </p>
          </div>
          <CryptoLifecycleRunnerCard />
        </div>
      </main>
    </AppLayout>
  );
}
