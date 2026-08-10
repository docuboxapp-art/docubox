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
  },
];

export default function AuthScreen() {
  const [heroContent, setHeroContent] = useState(heroVariants[0]);

  useEffect(() => {
    setHeroContent(heroVariants[Math.floor(Math.random() * heroVariants.length)]);
  }, []);

  return (
    <main className="flex min-h-screen bg-[#f7f8fb]">
      {/* Left brand panel */}
      <aside className="relative hidden w-[43%] min-w-[520px] flex-col justify-center overflow-hidden border-r border-blue-700 bg-[#2563eb] px-12 py-14 lg:flex xl:px-16">
        <div className="absolute inset-x-0 top-0 h-px bg-white/25" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-blue-800" />

        <div className="relative mx-auto w-full max-w-[590px]">
          <h1 className="mb-5 max-w-[560px] text-[23px] font-700 leading-tight text-white xl:text-[33px]">
            {heroContent.title}
          </h1>
          <p className="mb-11 max-w-[570px] text-base leading-7 text-blue-100">
            {heroContent.description}
          </p>

          {/* Feature list */}
          <div className="border-y border-white/15">
            {heroContent.features.map((feature) => {
              const Icon = feature.icon;

              return (
                <div
                  key={`feature-${feature.title}`}
                  className="flex items-start gap-4 border-b border-white/15 py-4 last:border-b-0"
                >
                  <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/10">
                    <Icon size={18} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-600 text-white">{feature.title}</p>
                    <p className="mt-1 max-w-[520px] text-xs leading-5 text-blue-100">
                      {feature.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Right auth panel */}
      <section className="flex min-w-0 flex-1 flex-col items-center justify-start bg-white px-5 pb-10 pt-14 sm:px-10 lg:justify-center lg:px-14 lg:py-10">
        <div className="w-full max-w-[460px]">
          {/* Logo above form */}
          <div className="mb-10 flex items-center justify-start">
            <AppLogo size={44} />
          </div>

          <Suspense fallback={null}>
            <LoginForm onSwitchToSignup={() => {}} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
