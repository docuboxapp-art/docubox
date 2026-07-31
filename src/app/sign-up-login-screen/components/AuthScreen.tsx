'use client';

import React, { Suspense, useEffect, useState } from 'react';
import LoginForm from './LoginForm';

import AppLogo from '@/components/ui/AppLogo';
import { CheckCircle2, Clock, FileText, Shield } from 'lucide-react';

const heroVariants = [
  {
    title: 'Firma tus documentos de forma fácil, segura y confiable',
    description:
      'Agiliza acuerdos, contratos y autorizaciones desde cualquier lugar, con una experiencia simple para ti y tus clientes.',
    features: [
      {
        icon: Shield,
        title: 'Firma desde cualquier lugar',
        desc: 'Envía y firma documentos en minutos desde computadora, tablet o celular.',
      },
      {
        icon: FileText,
        title: 'Invita a todas las personas necesarias',
        desc: 'Organiza fácilmente quién firma, en qué orden y cuándo debe hacerlo.',
      },
      {
        icon: Clock,
        title: 'Protege cada acuerdo',
        desc: 'Tus documentos quedan respaldados para brindarte mayor tranquilidad.',
      },
      {
        icon: CheckCircle2,
        title: 'Mantén todo bajo control',
        desc: 'Consulta el avance de cada firma y recibe notificaciones en tiempo real.',
      },
    ],
    badges: ['Firma en minutos', 'Fácil para todos', 'Respaldo confiable'],
  },
  {
    title: 'Cierra acuerdos más rápido y sin complicaciones',
    description:
      'Envía documentos, reúne firmas y da seguimiento a todo el proceso desde una sola plataforma.',
    features: [
      {
        icon: Shield,
        title: 'Envía documentos en segundos',
        desc: 'Prepara e invita a tus clientes, proveedores o colaboradores fácilmente.',
      },
      {
        icon: FileText,
        title: 'Firma simple y rápida',
        desc: 'Cada participante puede revisar y firmar desde cualquier dispositivo.',
      },
      {
        icon: Clock,
        title: 'Recordatorios automáticos',
        desc: 'Reduce retrasos con avisos para las personas que aún no han firmado.',
      },
      {
        icon: CheckCircle2,
        title: 'Seguimiento en tiempo real',
        desc: 'Conoce el estado de tus documentos sin llamadas ni mensajes adicionales.',
      },
    ],
    badges: ['Menos tiempo de espera', 'Más acuerdos cerrados', 'Todo en un solo lugar'],
  },
  {
    title: 'La forma más simple de formalizar tus acuerdos',
    description:
      'Transforma cualquier documento en una experiencia de firma ágil, profesional y confiable.',
    features: [
      {
        icon: Shield,
        title: 'Una experiencia sencilla',
        desc: 'Tus clientes podrán revisar y firmar sin procesos complicados.',
      },
      {
        icon: FileText,
        title: 'Flujos a tu medida',
        desc: 'Define quién participa y organiza cada firma según tus necesidades.',
      },
      {
        icon: Clock,
        title: 'Mayor confianza',
        desc: 'Cada documento conserva la información necesaria para respaldar el acuerdo.',
      },
      {
        icon: CheckCircle2,
        title: 'Visibilidad completa',
        desc: 'Consulta avances, pendientes y documentos finalizados desde un mismo lugar.',
      },
    ],
    badges: ['Experiencia profesional', 'Procesos más ágiles', 'Acuerdos protegidos'],
  },
  {
    title: 'Firma, envía y avanza',
    description:
      'Olvídate de imprimir, escanear y perseguir firmas. Gestiona tus documentos de principio a fin de forma digital.',
    features: [
      {
        icon: Shield,
        title: 'Envía fácilmente',
        desc: 'Carga tu documento y compártelo con las personas que deben firmar.',
      },
      {
        icon: FileText,
        title: 'Firma desde cualquier dispositivo',
        desc: 'Sin instalaciones ni procesos difíciles para tus clientes.',
      },
      {
        icon: Clock,
        title: 'Recibe avisos automáticos',
        desc: 'Mantente informado cada vez que alguien revise o firme.',
      },
      {
        icon: CheckCircle2,
        title: 'Encuentra todo rápidamente',
        desc: 'Tus documentos y avances siempre organizados y disponibles.',
      },
    ],
    badges: ['Sin papel', 'Sin complicaciones', 'Sin perder tiempo'],
  },
  {
    title: 'Tus acuerdos, más simples y seguros',
    description:
      'Firma documentos importantes con una experiencia clara, rápida y diseñada para generar confianza entre todas las partes.',
    features: [
      {
        icon: Shield,
        title: 'Identifica a cada participante',
        desc: 'Conoce quién revisó y firmó cada documento.',
      },
      {
        icon: FileText,
        title: 'Facilita la firma',
        desc: 'Ofrece un proceso sencillo para clientes, proveedores y colaboradores.',
      },
      {
        icon: Clock,
        title: 'Respalda tus documentos',
        desc: 'Conserva cada acuerdo firmado junto con su historial.',
      },
      {
        icon: CheckCircle2,
        title: 'Consulta todo en un solo lugar',
        desc: 'Accede a documentos pendientes, enviados y completados.',
      },
    ],
    badges: ['Firmas confiables', 'Historial completo', 'Documentos protegidos'],
  },
];

export default function AuthScreen() {
  const [heroContent, setHeroContent] = useState(heroVariants[0]);

  useEffect(() => {
    setHeroContent(heroVariants[Math.floor(Math.random() * heroVariants.length)]);
  }, []);

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
            {heroContent.title}
          </h1>
          <p className="text-lg text-white/75 mb-10 leading-relaxed max-w-lg">
            {heroContent.description}
          </p>

          {/* Feature list */}
          <div className="space-y-4 mb-10">
            {heroContent.features.map((feature) => {
              const Icon = feature.icon;

              return (
                <div key={`feature-${feature.title}`} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon size={18} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-600 text-white">{feature.title}</p>
                    <p className="text-xs text-white/65 mt-0.5 leading-relaxed">{feature.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Trust badges */}
          <div className="flex items-start gap-4 relative z-10">
            {heroContent.badges.map((badge) => (
              <div key={`badge-${badge}`} className="text-center max-w-32">
                <p className="text-base xl:text-lg font-800 text-white leading-tight">{badge}</p>
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
