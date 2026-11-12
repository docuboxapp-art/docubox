import Link from 'next/link';
import { FolderArchive } from 'lucide-react';
export default function InvitationNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center">
        <FolderArchive size={30} className="mx-auto text-slate-400" />
        <h1 className="mt-4 text-xl font-semibold">Invitación al expediente no disponible</h1>
        <p className="mt-2 text-sm text-slate-500">
          El enlace no es válido, venció o fue revocado. Solicita una nueva invitación al
          responsable del expediente.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Ir al inicio
        </Link>
      </section>
    </main>
  );
}
