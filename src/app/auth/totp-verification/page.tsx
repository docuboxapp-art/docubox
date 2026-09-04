'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import TotpVerificationPage from '@/components/totp/TotpVerificationPage';
import { createClient } from '@/lib/supabase/client';

function TotpVerificationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedRedirect = searchParams?.get('redirect') || '/inicio';
  const redirect =
    requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//')
      ? requestedRedirect
      : '/inicio';
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!data.session) router.replace('/login');
        else setSessionReady(true);
      });
  }, [router]);

  if (!sessionReady) return null;

  return (
    <TotpVerificationPage
      onSuccess={() => {
        window.location.href = redirect;
      }}
      onPasskeyRequired={() => {
        router.replace(`/auth/passkey-verification?redirect=${encodeURIComponent(redirect)}`);
      }}
      onBack={async () => {
        await createClient().auth.signOut();
        router.replace('/login');
      }}
    />
  );
}

export default function TotpVerificationRoute() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <TotpVerificationContent />
    </Suspense>
  );
}
