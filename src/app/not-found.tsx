'use client';

import { ArrowLeft, FileQuestion, Home } from 'lucide-react';
import { useRouter } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';

export default function NotFound() {
  const router = useRouter();

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-slate-50 px-5 py-6 dark:bg-background sm:px-8 sm:py-8">
      <header className="mx-auto flex w-full max-w-6xl items-center">
        <AppLogo className="h-7" />
      </header>

      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center py-14 text-center">
        <div className="relative mb-8 grid h-20 w-20 place-items-center rounded-lg border border-blue-100 bg-blue-50 text-primary dark:border-blue-900/60 dark:bg-blue-950/30">
          <FileQuestion size={34} strokeWidth={1.7} aria-hidden="true" />
          <span className="absolute -bottom-3 -right-3 grid h-9 w-9 place-items-center rounded-full border-4 border-slate-50 bg-primary text-xs font-semibold text-white dark:border-background">
            404
          </span>
        </div>

        <p className="text-sm font-medium text-primary">Página no disponible</p>
        <h1 className="mt-3 text-3xl font-medium tracking-normal text-foreground sm:text-4xl">
          No encontramos esta página
        </h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
          Es posible que el enlace haya cambiado, que ya no esté disponible o que no tengas acceso a
          este contenido.
        </p>

        <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Volver
          </button>
          <button
            type="button"
            onClick={() => router.push('/inicio')}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90"
          >
            <Home size={16} aria-hidden="true" />
            Ir al inicio
          </button>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-6xl border-t border-border pt-4 text-center text-xs text-muted-foreground sm:text-left">
        Docubox · Gestión documental y firma electrónica
      </footer>
    </main>
  );
}
