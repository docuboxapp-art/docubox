'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import TotpVerificationPage from '@/components/totp/TotpVerificationPage';

function TotpVerificationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const userId = searchParams?.get('userId') || '';
  const redirect = searchParams?.get('redirect') || '/inicio';

  useEffect(() => {
    if (!userId) {
      router?.replace('/login');
    }
  }, [userId, router]);

  if (!userId) return null;

  return (
    <TotpVerificationPage
      userId={userId}
      onSuccess={() => {
        window.location.href = redirect;
      }}
      onBack={() => {
        router?.replace('/login');
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
