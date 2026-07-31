'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

import AppLogo from '@/components/ui/AppLogo';
import PublicTokenLayout from '@/components/PublicTokenLayout';
import { KeyRound, RotateCcw, PenLine, HelpCircle, ChevronRight, Loader2, Shield, FileText, Clock, CheckCircle2 } from 'lucide-react';

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
        const res = await fetch(`/api/portal-participante/info?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const data = await res.json();
          setInfo({
            documentName: data.documentName || 'el documento',
            acto: data.acto || 'firmar',
            participantName: data.participantName || null
          });
        } else {
          setInfo({ documentName: 'el documento', acto: 'firmar' });
        }
      } catch {
        setInfo({ documentName: 'el documento', acto: 'firmar' });
      }
      setLoading(false);
    }
    loadParticipantInfo();
  }, [token]);

  // Extract first name only
  const getFirstName = (fullName: string | null | undefined): string | null => {
    if (!fullName) return null;
    const parts = fullName.trim().split(/\s+/);
    return parts[0] || null;
  };

  const firstName = getFirstName(info?.participantName);
  const actoLabel = info?.acto === 'aprobar' ? 'aprobar' : 'firmar';
  const actionButtonLabel = info?.acto === 'aprobar' ? 'Aprobar documento' : 'Firmar documento';

  const options = [
    {
      id: 'login',
      icon: <KeyRound size={22} className="text-primary" />,
      label: `Cuento con mi usuario y contraseña para ${actoLabel} el documento`,
      onClick: () => router.push(`/sign-up-login-screen?redirect=/visor-documento&portal_token=${token}`)
    },
    {
      id: 'forgot',
      icon: <RotateCcw size={22} className="text-primary" />,
      label: `He ${actoLabel === 'aprobar' ? 'aprobado' : 'firmado'} previamente pero no recuerdo mi contraseña`,
      onClick: () => router.push('/olvide-contrasena')
    },
    {
      id: 'register',
      icon: <PenLine size={22} className="text-primary" />,
      label: `Es la primera vez que ${actoLabel} un documento (iniciar proceso)`,
      onClick: () => router.push(`/registro-participante/${token}`)
    },
    {
      id: 'help',
      icon: <HelpCircle size={22} className="text-primary" />,
      label: `Necesito ayuda en el proceso de ${actoLabel === 'aprobar' ? 'aprobación' : 'firmado'} del documento`,
      onClick: () => router.push('/ayuda-firmado')
    }
  ];

  return (
    <PublicTokenLayout token={token} luciaScope="external_participant">
    <div className="min-h-screen flex bg-background">
      {/* Left blue panel */}
      <div className="hidden lg:flex lg:w-[40%] bg-primary flex-col justify-center p-10 xl:p-14 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/5" />
          <div className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-white/5" />
          <div className="absolute top-1/2 right-12 w-48 h-48 rounded-full bg-accent/20" />
          <div className="absolute bottom-1/4 left-1/3 w-32 h-32 rounded-full bg-white/5" />
        </div>

        {/* Hero content */}
        <div className="relative z-10">
          <h1 className="text-[calc(2.25rem-11px)] xl:text-[calc(3rem-11px)] font-800 text-white leading-tight mb-4">
            Portal de participantes
          </h1>
          <p className="text-lg text-white/75 mb-10 leading-relaxed max-w-lg">
            Revisa, firma y aprueba documentos de forma segura con validez legal en México.
          </p>

          {/* Feature list */}
          <div className="space-y-4 mb-10">
            {[
              {
                icon: <Shield size={18} className="text-accent" />,
                title: 'Firma con validez legal',
                desc: 'Documentos firmados con e.Firma SAT o biometría con cumplimiento NOM-151',
              },
              {
                icon: <FileText size={18} className="text-accent" />,
                title: 'Proceso guiado',
                desc: 'Te guiamos paso a paso para que puedas firmar o aprobar sin complicaciones',
              },
              {
                icon: <Clock size={18} className="text-accent" />,
                title: 'Sellado de tiempo',
                desc: 'Timestamp de PSC autorizado para constancia de integridad y fecha cierta',
              },
              {
                icon: <CheckCircle2 size={18} className="text-accent" />,
                title: 'Evidencia digital',
                desc: 'Registro inmutable de tu participación: IP, geolocalización y hash del documento',
              },
            ]?.map((feature) => (
              <div key={`feature-${feature?.title}`} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {feature?.icon}
                </div>
                <div>
                  <p className="text-sm font-600 text-white">{feature?.title}</p>
                  <p className="text-xs text-white/65 mt-0.5 leading-relaxed">{feature?.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Trust badges */}
          <div className="flex items-center gap-4 relative z-10">
            {[
              { label: '+12,000', sub: 'documentos firmados' },
              { label: '99.9%', sub: 'uptime garantizado' },
              { label: 'NOM-151', sub: 'cumplimiento legal' },
            ]?.map((badge) => (
              <div key={`badge-${badge?.label}`} className="text-center">
                <p className="text-lg font-800 text-white tabular-nums">{badge?.label}</p>
                <p className="text-[10px] text-white/60 font-500">{badge?.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right white panel */}
      <div className="flex-1 lg:w-[60%] flex flex-col">
        {/* Header with logo */}
        <header className="flex justify-center pt-8 pb-4">
          <AppLogo size={36} />
        </header>

        <main className="flex-1 flex items-center justify-center px-6 py-8">
          <div className="w-full max-w-lg">
            {/* Greeting */}
            <div className="mb-6">
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">Cargando información...</span>
                </div>
              ) : (
                <h1 className="text-2xl font-700 text-foreground mb-1">
                  {firstName ? `Hola ${firstName}!` : '¡Hola!'}
                </h1>
              )}

              {!loading && (
                <h2 className="text-lg font-600 text-foreground mb-2 leading-snug">
                  Recibiste una invitación a{' '}
                  <span className="text-primary">{actoLabel}</span> el documento{' '}
                  <span className="text-primary">&ldquo;{info?.documentName}&rdquo;</span>
                </h2>
              )}

              <p className="text-sm text-muted-foreground">
                Para ayudarte mejor, por favor selecciona una de las siguientes opciones:
              </p>
            </div>

            {/* Options grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  onClick={opt.onClick}
                  className="flex items-center gap-3 p-4 border border-border rounded-xl text-left hover:border-primary hover:bg-primary/5 transition-all duration-150 group"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {opt.icon}
                  </div>
                  <span className="text-sm font-500 text-foreground leading-snug flex-1">
                    {opt.label}
                  </span>
                  <ChevronRight
                    size={16}
                    className="text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0"
                  />
                </button>
              ))}
            </div>
          </div>
        </main>

        <footer className="text-center py-4 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Docubox — Firma electrónica con validez legal
        </footer>
      </div>
    </div>
    </PublicTokenLayout>
  );
}
