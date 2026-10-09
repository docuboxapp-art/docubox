'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, FileText, KeyRound, Loader2, UserPlus } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import PublicTokenLayout from '@/components/PublicTokenLayout';
import { createClient } from '@/lib/supabase/client';

type Invitation = {
  formName: string;
  recipientName: string | null;
  email: string;
  isRegistered: boolean;
  expiresAt: string | null;
};

export default function FormInvitationPortal() {
  const token = useParams().token as string;
  const router = useRouter();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isRecipient, setIsRecipient] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/portal-formulario/info?token=${encodeURIComponent(token)}`,
          { cache: 'no-store' }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo abrir la invitación.');
        const {
          data: { user },
        } = await createClient().auth.getUser();
        if (!active) return;
        setInvitation(data);
        setIsRecipient(
          Boolean(user?.email && user.email.toLowerCase() === data.email.toLowerCase())
        );
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : 'No se pudo abrir la invitación.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const formPath = `/form/${token}`;
  return (
    <PublicTokenLayout token={token} luciaScope="external_participant" compactAssistant>
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
          <AppLogo />
          {loading ? (
            <p className="mt-8 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={17} className="animate-spin" /> Cargando invitación…
            </p>
          ) : error ? (
            <p role="alert" className="mt-8 text-sm text-red-600">
              {error}
            </p>
          ) : (
            invitation && (
              <>
                <span className="mt-8 inline-flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-primary">
                  <FileText size={15} /> Invitación privada
                </span>
                <h1 className="mt-4 text-2xl font-semibold text-slate-950">
                  {invitation.formName}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {invitation.recipientName ? `${invitation.recipientName}, ` : ''}te invitaron a
                  completar y firmar este formulario. El acceso está vinculado a{' '}
                  <strong>{invitation.email}</strong>.
                </p>
                <div className="mt-6 space-y-2">
                  {isRecipient ? (
                    <button
                      type="button"
                      onClick={() => router.push(formPath)}
                      className="flex w-full items-center justify-between rounded-md bg-primary px-4 py-3 text-sm font-medium text-white"
                    >
                      Continuar al formulario <ArrowRight size={16} />
                    </button>
                  ) : invitation.isRegistered ? (
                    <a
                      href={`/login?redirect=${encodeURIComponent(formPath)}&email=${encodeURIComponent(invitation.email)}`}
                      className="flex items-center justify-between rounded-md bg-primary px-4 py-3 text-sm font-medium text-white"
                    >
                      <span className="flex items-center gap-2">
                        <KeyRound size={16} /> Acceder con mi cuenta
                      </span>
                      <ArrowRight size={16} />
                    </a>
                  ) : (
                    <a
                      href={`/registro-participante/${token}?source=form`}
                      className="flex items-center justify-between rounded-md bg-primary px-4 py-3 text-sm font-medium text-white"
                    >
                      <span className="flex items-center gap-2">
                        <UserPlus size={16} /> Crear mi acceso
                      </span>
                      <ArrowRight size={16} />
                    </a>
                  )}
                </div>
                <a href="/formulario-publico/codigo" className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <KeyRound size={16} /> Tengo un código de acceso
                </a>
                <p className="mt-5 text-xs text-slate-500">
                  Si ya tienes una cuenta con otro correo, inicia sesión con el correo de la
                  invitación.
                </p>
              </>
            )
          )}
        </section>
      </main>
    </PublicTokenLayout>
  );
}
