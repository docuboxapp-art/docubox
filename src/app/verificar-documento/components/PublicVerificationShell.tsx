import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';

export default function PublicVerificationShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8f8fb] text-[#18181b]">
      <header className="border-b border-[#ebebf0] bg-white">
        <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between px-4 sm:px-6">
          <Link href="/verificar-documento" aria-label="Centro de Verificación Docubox">
            <AppLogo className="w-[136px]" />
          </Link>
          <span className="inline-flex items-center gap-2 text-xs font-600 text-[#52525b]">
            <ShieldCheck size={16} className="text-[#4f46e5]" />
            Centro público de verificación
          </span>
        </div>
      </header>
      {children}
      <footer className="border-t border-[#ebebf0] bg-white">
        <div className="mx-auto flex min-h-16 w-full max-w-[1180px] flex-col justify-center gap-1 px-4 py-4 text-xs text-[#71717a] sm:px-6">
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
