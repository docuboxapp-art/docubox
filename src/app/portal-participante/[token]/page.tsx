'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  FileText,
  KeyRound,
  LockKeyhole,
  PenLine,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';

import PublicTokenLayout from '@/components/PublicTokenLayout';
import AppLogo from '@/components/ui/AppLogo';

interface ParticipantInfo {
  documentName: string;
  acto: string;
  participantName?: string | null;
}

export default function PortalParticipantePage() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;

  const [info, setInfo] = useState<ParticipantInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadParticipantInfo() {
      if (!token) {
        setInfo({ documentName: 'el documento', acto: 'firmar' });
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/portal-participante/info?token=${encodeURIComponent(token)}`,
        );

        if (response.ok) {
          const data = await response.json();
          setInfo({
            documentName: data.documentName || 'el documento',
            acto: data.acto || 'firmar',
            participantName: data.participantName || null,
          });
        } else {
          setInfo({ documentName: 'el documento', acto: 'firmar' });
        }
      } catch {
        setInfo({ documentName: 'el documento', acto: 'firmar' });
      } finally {
        setLoading(false);
      }
    }

    loadParticipantInfo();
  }, [token]);

  const getFirstName = (fullName: string | null | undefined): string | null => {
    if (!fullName) return null;
    return fullName.trim().split(/\s+/)[0] || null;
  };

  const firstName = getFirstName(info?.participantName);
  const isApproval = info?.acto === 'aprobar';
  const actionLabel = isApproval ? 'aprobar' : 'firmar';

  const options = [
    {
      id: 'login',
      icon: KeyRound,
      title: 'Ingresar con mi cuenta',
      description: `Ya tengo usuario y contraseña para ${actionLabel} el documento.`,
      onClick: () =>
        router.push(`/login?redirect=/visor-documento&portal_token=${token}`),
    },
    {
      id: 'forgot',
      icon: RotateCcw,
      title: 'Recuperar mi contraseña',
      description: `Ya he ${isApproval ? 'aprobado' : 'firmado'} antes, pero no recuerdo mi acceso.`,
      onClick: () => router.push('/olvide-contrasena'),
    },
    {
      id: 'register',
      icon: PenLine,
      title: 'Registrarme para participar',
      description: `Es la primera vez que voy a ${actionLabel} un documento en Docubox.`,
      onClick: () => router.push(`/registro-participante/${token}`),
    },
    {
      id: 'help',
      icon: CircleHelp,
      title: 'Necesito ayuda',
      description: `Consultar orientación para completar el proceso de ${isApproval ? 'aprobación' : 'firma'}.`,
      onClick: () => router.push('/ayuda-firmado'),
    },
  ];

  return (
    <PublicTokenLayout
      token={token}
      luciaScope="external_participant"
      compactAssistant
    >
      <div className="flex min-h-screen flex-col bg-[#f6f8fb] text-slate-950 dark:bg-slate-950 dark:text-slate-100">
        <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-4">
              <AppLogo className="shrink-0" />
              <div className="hidden h-7 w-px bg-slate-200 sm:block dark:bg-slate-800" />
              <div className="hidden min-w-0 sm:block">
                <p className="text-sm font-600 leading-tight text-slate-800 dark:text-slate-100">
                  Portal de participantes
                </p>
                <p className="mt-0.5 text-xs leading-tight text-slate-500 dark:text-slate-400">
                  Acceso a invitaciones
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs font-600 text-slate-500 dark:text-slate-400">
              <ShieldCheck size={16} className="text-emerald-600" />
              <span className="hidden sm:inline">Conexión segura</span>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
          <div className="mx-auto w-full max-w-5xl">
            <section className="mb-6 border-b border-slate-200 pb-6 dark:border-slate-800">
              {loading ? (
                <div className="space-y-3" aria-label="Cargando información">
                  <div className="h-7 w-44 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="h-5 w-full max-w-2xl animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                </div>
              ) : (
                <>
                  <h1 className="text-2xl font-700 leading-tight tracking-normal text-slate-950 dark:text-white">
                    {firstName ? `Hola, ${firstName}` : 'Hola'}
                  </h1>
                  <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">
                    Recibiste una invitación para {actionLabel} un documento. Elige cómo deseas continuar.
                  </p>
                </>
              )}
            </section>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <aside className="min-w-0">
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <h2 className="text-sm font-700 text-slate-950 dark:text-white">
                      Documento asignado
                    </h2>
                  </div>

                  <div className="p-5">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <FileText size={20} />
                      </div>
                      <div className="min-w-0">
                        {loading ? (
                          <div className="h-5 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                        ) : (
                          <p className="break-words text-sm font-700 leading-5 text-slate-950 dark:text-white">
                            {info?.documentName}
                          </p>
                        )}
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-1 text-xs font-600 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          Participación pendiente
                        </div>
                      </div>
                    </div>

                    <dl className="mt-5 divide-y divide-slate-100 border-t border-slate-100 text-sm dark:divide-slate-800 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-slate-500 dark:text-slate-400">Acción requerida</dt>
                        <dd className="font-600 capitalize text-slate-800 dark:text-slate-200">
                          {actionLabel}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 pt-3">
                        <dt className="text-slate-500 dark:text-slate-400">Acceso</dt>
                        <dd className="flex items-center gap-1.5 font-600 text-slate-800 dark:text-slate-200">
                          <LockKeyhole size={14} className="text-emerald-600" />
                          Protegido
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="mt-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                  <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-primary" />
                  <p className="leading-5">
                    Tu acceso está vinculado a esta invitación. Selecciona la opción que corresponda a tu caso.
                  </p>
                </div>
              </aside>

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                  <h2 className="text-sm font-700 text-slate-950 dark:text-white">
                    ¿Cómo deseas continuar?
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Selecciona una opción para avanzar con tu participación.
                  </p>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {options.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={option.onClick}
                        className="group flex min-h-[82px] w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/5 text-primary transition-colors group-hover:border-primary/25 group-hover:bg-primary/10">
                          <Icon size={19} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-700 text-slate-900 dark:text-slate-100">
                            {option.title}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400 sm:text-sm">
                            {option.description}
                          </span>
                        </span>
                        <ArrowRight
                          size={17}
                          className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                        />
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </main>

        <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          © {new Date().getFullYear()} Docubox · Participación documental segura
        </footer>
      </div>
    </PublicTokenLayout>
  );
}
