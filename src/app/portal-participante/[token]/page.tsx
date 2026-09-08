'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowRight,
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
          `/api/portal-participante/info?token=${encodeURIComponent(token)}`
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

  const firstName = info?.participantName?.trim().split(/\s+/)[0] || null;
  const isApproval = info?.acto === 'aprobar';
  const actionLabel = isApproval ? 'aprobar' : 'firmar';

  const options = [
    {
      id: 'login',
      icon: KeyRound,
      title: 'Ingresar con mi cuenta',
      description: `Ya tengo usuario y contraseña para ${actionLabel} el documento.`,
      onClick: () => router.push(`/login?redirect=/visor-documento&portal_token=${token}`),
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
    <PublicTokenLayout token={token} luciaScope="external_participant" compactAssistant>
      <div className="min-h-screen bg-slate-50 text-slate-950">
        <div className="grid min-h-screen lg:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.18fr)]">
          <aside className="hidden bg-primary px-10 py-9 text-white lg:flex lg:flex-col xl:px-14">
            <AppLogo variant="light" className="mb-auto" />

            <div className="max-w-md py-12">
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/20 bg-white/10">
                <ShieldCheck size={22} aria-hidden="true" />
              </div>
              <p className="text-sm font-600 text-white/75">Portal de participantes</p>
              <h1 className="mt-2 text-3xl font-700 leading-tight">Tu participación está lista</h1>
              <p className="mt-4 text-base leading-7 text-white/80">
                Revisa el documento asignado y elige cómo deseas continuar.
              </p>

              <div className="mt-9 border border-white/20 bg-white/10 p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15">
                    <FileText size={20} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-600 uppercase text-white/65">Documento asignado</p>
                    {loading ? (
                      <div className="mt-2 h-5 w-48 animate-pulse rounded bg-white/20" />
                    ) : (
                      <p className="mt-1 break-words text-sm font-700 leading-5 text-white">
                        {info?.documentName}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-white/15 pt-4 text-sm">
                  <span className="text-white/70">Acción requerida</span>
                  <span className="font-700 capitalize">{actionLabel}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-white/70">
              <LockKeyhole size={14} aria-hidden="true" />
              Tu acceso está vinculado a esta invitación.
            </div>
          </aside>

          <div className="flex min-w-0 flex-col bg-white">
            <header className="flex h-20 items-center justify-between border-b border-slate-200 px-5 sm:px-8 lg:px-10">
              <div className="flex min-w-0 items-center gap-3">
                <AppLogo className="lg:hidden" />
                <div className="hidden h-7 w-px bg-slate-200 lg:block" />
                <div className="min-w-0">
                  <p className="text-sm font-700 text-slate-900">Portal de participantes</p>
                  <p className="mt-0.5 text-xs text-slate-500">Acceso a invitaciones</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-600 text-slate-500">
                <ShieldCheck size={16} className="text-emerald-600" aria-hidden="true" />
                <span className="hidden sm:inline">Conexión segura</span>
              </div>
            </header>

            <main className="flex flex-1 items-center px-5 py-10 sm:px-8 lg:px-12 xl:px-16">
              <div className="mx-auto w-full max-w-2xl">
                <section className="mb-7">
                  {loading ? (
                    <div className="space-y-3" aria-label="Cargando información">
                      <div className="h-7 w-44 animate-pulse rounded bg-slate-200" />
                      <div className="h-5 w-full max-w-xl animate-pulse rounded bg-slate-100" />
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-600 text-primary">Invitación a participar</p>
                      <h2 className="mt-2 text-2xl font-700 leading-tight text-slate-950 sm:text-3xl">
                        {firstName ? `Hola, ${firstName}` : 'Hola'}
                      </h2>
                      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
                        Recibiste una invitación para {actionLabel} un documento. Elige cómo deseas
                        continuar.
                      </p>
                    </>
                  )}
                </section>

                <div className="mb-5 border border-slate-200 bg-slate-50 p-4 lg:hidden">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText size={19} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-600 text-slate-500">Documento asignado</p>
                      <p className="mt-1 break-words text-sm font-700 text-slate-900">
                        {info?.documentName || 'el documento'}
                      </p>
                    </div>
                  </div>
                </div>

                <section aria-labelledby="continuar-title">
                  <div className="mb-4">
                    <h3 id="continuar-title" className="text-base font-700 text-slate-950">
                      ¿Cómo deseas continuar?
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Selecciona la opción que corresponda a tu caso.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {options.map((option) => {
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={option.onClick}
                          className="group flex min-h-[142px] flex-col items-start border border-slate-200 bg-white p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/15 bg-primary/5 text-primary">
                            <Icon size={19} aria-hidden="true" />
                          </span>
                          <span className="mt-4 flex w-full items-start gap-3">
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-700 text-slate-900">
                                {option.title}
                              </span>
                              <span className="mt-1.5 block text-xs leading-5 text-slate-500 sm:text-sm">
                                {option.description}
                              </span>
                            </span>
                            <ArrowRight
                              size={17}
                              className="mt-0.5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                              aria-hidden="true"
                            />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </main>

            <footer className="border-t border-slate-200 px-5 py-4 text-center text-xs text-slate-500 sm:px-8">
              © {new Date().getFullYear()} Docubox · Participación documental segura
            </footer>
          </div>
        </div>
      </div>
    </PublicTokenLayout>
  );
}
