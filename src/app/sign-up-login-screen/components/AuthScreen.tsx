'use client';

import React, { Suspense } from 'react';
import LoginForm from './LoginForm';

import AppLogo from '@/components/ui/AppLogo';
import { Shield, FileText, Clock, CheckCircle2 } from 'lucide-react';

export default function AuthScreen() {
  return (
    <div className="min-h-screen flex bg-background">
      {/* Left brand panel */}
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
            Firma electrónica avanzada con validez legal en México
          </h1>
          <p className="text-lg text-white/75 mb-10 leading-relaxed max-w-lg">
            Integra tu e.firma del SAT, gestiona flujos multiusuario y genera evidencia digital con cumplimiento NOM-151.
          </p>

          {/* Feature list */}
          <div className="space-y-4 mb-10">
            {[
              {
                icon: <Shield size={18} className="text-accent" />,
                title: 'e.firma SAT (FIEL)',
                desc: 'Firma con tu certificado del SAT — RFC, CURP y datos extraídos automáticamente',
              },
              {
                icon: <FileText size={18} className="text-accent" />,
                title: 'Flujos multiusuario',
                desc: 'Firma secuencial o paralela con notificaciones automáticas por email y OTP',
              },
              {
                icon: <Clock size={18} className="text-accent" />,
                title: 'Sellado NOM-151',
                desc: 'Timestamp de PSC autorizado para constancia de integridad y fecha cierta',
              },
              {
                icon: <CheckCircle2 size={18} className="text-accent" />,
                title: 'Audit trail completo',
                desc: 'Registro inmutable de eventos: IP, geolocalización, timestamp y hash del documento',
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

      {/* Right auth panel */}
      <div className="flex-1 lg:w-[60%] flex flex-col items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-lg">
          {/* Logo above form */}
          <div className="flex items-center justify-center mb-10">
            <AppLogo size={36} />
          </div>

          <Suspense fallback={null}>
            <LoginForm onSwitchToSignup={() => {}} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}