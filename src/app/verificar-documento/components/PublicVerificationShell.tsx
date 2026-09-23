import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import AppLogo from '@/components/ui/AppLogo';

export default function PublicVerificationShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between px-4 sm:px-6">
          <Link href="/verificar-documento" aria-label="Centro de Verificación Docubox">
            <AppLogo className="[&_img]:h-auto [&_img]:w-[126px]" />
          </Link>
          <span className="inline-flex items-center gap-2 text-xs font-600 text-slate-600">
            <ShieldCheck size={16} className="text-primary" />
            Centro público de verificación
          </span>
        </div>
      </header>
      {children}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 w-full max-w-[1180px] flex-col justify-center gap-1 px-4 py-4 text-xs text-slate-500 sm:px-6">
          <p>
            Docubox informa resultados técnicos de integridad y evidencia. No sustituye una
            resolución de autoridad.
          </p>
          <p>
            Las consultas públicas no muestran correos, RFC, CURP, IP, biometría ni rutas privadas
            de almacenamiento.
          </p>
        </div>
      </footer>
    </div>
  );
}
