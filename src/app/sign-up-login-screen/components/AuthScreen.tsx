'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import AppLogo from '@/components/ui/AppLogo';
import LoginForm from './LoginForm';

export default function AuthScreen() {
  return (
    <main className="min-h-[100dvh] bg-[#f7f9fc] text-foreground dark:bg-background">
      <header className="flex h-16 shrink-0 items-center border-b border-slate-200 bg-white px-4 dark:border-border dark:bg-card lg:px-6">
        <div className="flex min-w-0 flex-1 items-center">
          <AppLogo size={34} />
        </div>
        <div className="flex flex-1 items-center justify-end gap-3">
          <span className="hidden text-sm text-slate-500 sm:inline">¿Nuevo en Docubox?</span>
          <Link
            href="/registro"
            className="inline-flex h-9 items-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-sm font-600 text-primary transition-colors hover:bg-slate-50 dark:border-border dark:bg-card"
          >
            Crear cuenta
          </Link>
        </div>
      </header>

      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-[520px] items-center px-4 py-10 sm:px-6">
        <section
          aria-label="Iniciar sesión"
          className="w-full rounded-lg border border-slate-200 bg-white px-6 py-8 shadow-[0_4px_20px_rgba(15,23,42,0.04)] dark:border-border dark:bg-card sm:px-10 sm:py-10"
        >
          <Suspense fallback={null}>
            <LoginForm onSwitchToSignup={() => {}} />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
