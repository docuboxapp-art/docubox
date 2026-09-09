'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowRight,
  CircleHelp,
  FileText,
  CalendarClock,
  KeyRound,
  LockKeyhole,
  PenLine,
  RotateCcw,
  UserRound,
} from 'lucide-react';

import PublicTokenLayout from '@/components/PublicTokenLayout';
import AppLogo from '@/components/ui/AppLogo';

interface ParticipantInfo {
  documentName: string;
  acto: string;
  participantName?: string | null;
  isRegistered: boolean;
  inviterName?: string | null;
  expiresAt?: string | null;
}

function formatExpiration(expiresAt?: string | null) {
  if (!expiresAt || !Number.isFinite(new Date(expiresAt).getTime())) return null;
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(expiresAt));
}

export default function PortalParticipantePage() {
  const router = useRouter();
  const params = useParams();
  const token = params?.token as string;

  const [info, setInfo] = useState<ParticipantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const canonicalRedirectRef = useRef<string | null>(null);

  useEffect(() => {
    async function loadParticipantInfo() {
      if (!token) {
        setInfo({ documentName: 'Documento sin nombre', acto: 'firmar', isRegistered: false });
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/portal-participante/info?token=${encodeURIComponent(token)}`,
          { cache: 'no-store' }
        );

        if (response.ok) {
          const data = await response.json();
          if (
            data.canonicalToken &&
            data.canonicalToken !== token &&
            canonicalRedirectRef.current !== data.canonicalToken
          ) {
            canonicalRedirectRef.current = data.canonicalToken;
            router.replace(`/portal-participante/${encodeURIComponent(data.canonicalToken)}`);
            return;
          }
          setInfo({
            documentName: data.documentName || 'Documento sin nombre',
            acto: data.acto || 'firmar',
            participantName: data.participantName || null,
            isRegistered: data.isRegistered === true,
            inviterName: data.inviterName || null,
            expiresAt: data.expiresAt || null,
          });
        } else {
          setInfo({ documentName: 'Documento sin nombre', acto: 'firmar', isRegistered: false });
        }
      } catch {
        setInfo({ documentName: 'Documento sin nombre', acto: 'firmar', isRegistered: false });
      } finally {
        setLoading(false);
      }
    }

    loadParticipantInfo();
  }, [router, token]);

  const isApproval = info?.acto === 'aprobar';
  const actionLabel = isApproval ? 'aprobar' : 'firmar';
  const isRegistered = info?.isRegistered === true;
  const expirationLabel = formatExpiration(info?.expiresAt);
  const greetingName = info?.participantName?.trim();

  const options = isRegistered
    ? [
        {
          id: 'login',
          icon: KeyRound,
          title: 'Acceder con mi cuenta',
          description: 'Cuento con mi usuario y contraseña para revisar y participar.',
          onClick: () => router.push(`/login?redirect=/visor-documento&portal_token=${token}`),
        },
        {
          id: 'forgot',
          icon: RotateCcw,
          title: 'Restablecer contraseña',
          description: 'He firmado previamente pero no recuerdo mi contraseña.',
          onClick: () => router.push('/olvide-contrasena'),
        },
        {
          id: 'help',
          icon: CircleHelp,
          title: 'Solicitar ayuda',
          description: 'Necesito ayuda con el proceso de participación en el documento.',
          onClick: () => router.push('/ayuda-firmado'),
        },
      ]
    : [
        {
          id: 'register',
          icon: PenLine,
          title: 'Crear mi acceso',
          description: `Regístrate para revisar y ${actionLabel} el documento.`,
          onClick: () => router.push(`/registro-participante/${token}`),
        },
        {
          id: 'help',
          icon: CircleHelp,
          title: 'Solicitar ayuda',
          description: 'Necesito ayuda con el proceso de participación en el documento.',
          onClick: () => router.push('/ayuda-firmado'),
        },
      ];

  return (
    <PublicTokenLayout token={token} luciaScope="external_participant" compactAssistant>
      <div className="min-h-screen bg-slate-50 text-slate-950">
        <div className="grid min-h-screen lg:grid-cols-[minmax(320px,0.7fr)_minmax(0,1.3fr)]">
          <aside className="hidden border-r border-white/15 bg-primary px-10 py-9 text-white lg:flex lg:flex-col xl:px-12">
            <AppLogo variant="light" className="shrink-0" />

            <div className="flex flex-1 items-center justify-center py-10">
              <div className="w-full max-w-sm">
                <h1 className="text-3xl font-700 leading-tight">Tu participación te espera</h1>

                <div className="mt-7 border border-white/20 bg-white/10 p-5">
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
                    {!loading && (info?.inviterName || expirationLabel) && (
                      <div className="mt-4 space-y-2 border-t border-white/15 pt-4 text-xs text-white/75">
                        {info?.inviterName && (
                          <p className="flex items-center gap-2">
                            <UserRound size={13} aria-hidden="true" />
                            Invitado por <span className="font-600 text-white">{info.inviterName}</span>
                          </p>
                        )}
                        {expirationLabel && (
                          <p className="flex items-center gap-2">
                            <CalendarClock size={13} aria-hidden="true" />
                            Vence <time dateTime={info?.expiresAt || undefined}>{expirationLabel}</time>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-white/15 pt-4 text-sm">
                    <span className="text-white/70">Acción requerida</span>
                    <span className="font-700 capitalize">{actionLabel}</span>
                  </div>
                </div>

                <div className="mt-12 flex items-center gap-2 text-xs text-white/70">
                  <LockKeyhole size={14} aria-hidden="true" />
                  Tu acceso está vinculado a esta invitación.
                </div>
              </div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-col bg-white">
            <header className="flex h-20 items-center border-b border-slate-200 px-5 sm:px-8 lg:hidden">
              <AppLogo />
            </header>

            <main className="flex flex-1 items-center px-5 py-10 sm:px-8 lg:px-14 xl:px-20">
              <div className="mx-auto w-full max-w-3xl">
                <section className="mb-10">
                  {loading ? (
                    <div className="space-y-3" aria-label="Cargando información">
                      <div className="h-7 w-44 animate-pulse rounded bg-slate-200" />
                      <div className="h-5 w-full max-w-xl animate-pulse rounded bg-slate-100" />
                    </div>
                  ) : (
                    <>
                      <h2 className="text-2xl font-700 leading-tight text-slate-950 sm:text-3xl">
                        ¡Hola{greetingName ? `, ${greetingName}` : ''}!
                      </h2>
                      <div className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
                        <p>Tienes una invitación para participar en este documento.</p>
                        <p className="mt-3">Selecciona una opción para continuar.</p>
                      </div>
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
                        {info?.documentName || 'Documento sin nombre'}
                      </p>
                      {(info?.inviterName || expirationLabel) && (
                        <div className="mt-3 space-y-1.5 text-xs text-slate-500">
                          {info?.inviterName && <p>Invitado por {info.inviterName}</p>}
                          {expirationLabel && <p>Vence {expirationLabel}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {!loading && <section aria-label="Opciones para continuar">
                  <div className={`grid gap-3 ${isRegistered ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
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
                </section>}
              </div>
            </main>

          </div>
        </div>
      </div>
    </PublicTokenLayout>
  );
}
