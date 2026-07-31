'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import AppLogo from '@/components/ui/AppLogo';
import {
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  UserPlus,
  FileText,
  PenLine,
  CheckCircle2,
  Shield,
  HelpCircle,
  Mail,
  Smartphone,
  Key,
} from 'lucide-react';

interface FaqItem {
  question: string;
  answer: string;
}

const faqs: FaqItem[] = [
  {
    question: '¿Qué es Docubox y para qué sirve?',
    answer:
      'Docubox es una plataforma de firma electrónica con validez legal en México. Te permite firmar, aprobar y gestionar documentos de forma digital, con la misma validez jurídica que una firma autógrafa en papel, cumpliendo con la NOM-151 y la legislación mexicana.',
  },
  {
    question: '¿Necesito instalar algún programa para firmar?',
    answer:
      'No. Docubox funciona completamente desde tu navegador web (Chrome, Firefox, Safari, Edge). No necesitas instalar ninguna aplicación. Solo necesitas una conexión a internet y el enlace que recibiste por correo o WhatsApp.',
  },
  {
    question: '¿Es seguro firmar documentos en Docubox?',
    answer:
      'Sí. Docubox utiliza cifrado de extremo a extremo, sellado de tiempo NOM-151 y genera un registro de auditoría inmutable con tu IP, geolocalización y timestamp. Cada firma queda vinculada a tu identidad de forma irrefutable.',
  },
  {
    question: '¿Qué necesito para crear mi cuenta?',
    answer:
      'Solo necesitas un correo electrónico válido y crear una contraseña segura. El proceso de registro toma menos de 2 minutos. Opcionalmente puedes completar tu perfil con tu RFC y CURP para habilitar la firma con e.Firma del SAT.',
  },
  {
    question: '¿Qué métodos de firma están disponibles?',
    answer:
      'Docubox ofrece tres métodos: (1) Firma Autógrafa Digital — dibujas tu firma con el mouse o en pantalla táctil; (2) e.Firma SAT (FIEL) — usas tu certificado del SAT para mayor nivel de seguridad; (3) Biometría — verificación facial para confirmar tu identidad.',
  },
  {
    question: '¿Qué hago si no recuerdo mi contraseña?',
    answer:
      'Haz clic en "He firmado previamente pero no recuerdo mi contraseña" en el portal de participantes, o ve directamente a la página de recuperación de contraseña. Recibirás un código OTP en tu correo para restablecer tu acceso en minutos.',
  },
  {
    question: '¿Puedo firmar desde mi celular?',
    answer:
      'Sí. Docubox está optimizado para dispositivos móviles. Puedes abrir el enlace que recibiste por WhatsApp o SMS directamente en tu teléfono y completar el proceso de firma desde ahí.',
  },
  {
    question: '¿Qué pasa después de que firmo?',
    answer:
      'Una vez que firmas, recibirás una confirmación por correo. El propietario del documento será notificado de tu participación. Cuando todos los participantes hayan firmado, el documento quedará completado y podrás descargarlo con su constancia de integridad.',
  },
  {
    question: '¿Puedo rechazar o cancelar mi participación?',
    answer:
      'Sí. En el visor del documento tienes la opción de rechazar o cancelar tu participación. Deberás indicar el motivo, y el propietario del documento será notificado automáticamente.',
  },
  {
    question: '¿Tiene validez legal la firma electrónica en México?',
    answer:
      'Sí. La firma electrónica tiene plena validez legal en México conforme al Código de Comercio (Art. 89-114), el Código Civil Federal y la NOM-151-SCFI-2016. Los documentos firmados en Docubox son admisibles como prueba en procedimientos legales.',
  },
];

const steps = [
  {
    icon: <Mail size={20} className="text-white" />,
    title: 'Recibe la invitación',
    description:
      'Recibirás un enlace por correo electrónico, WhatsApp o SMS. Haz clic en el enlace para acceder al Portal de Participantes.',
    color: 'bg-blue-500',
  },
  {
    icon: <UserPlus size={20} className="text-white" />,
    title: 'Crea tu cuenta o inicia sesión',
    description:
      'Si es tu primera vez, regístrate con tu correo y una contraseña. Si ya tienes cuenta, inicia sesión directamente.',
    color: 'bg-indigo-500',
  },
  {
    icon: <FileText size={20} className="text-white" />,
    title: 'Revisa el documento',
    description:
      'Lee el documento completo en el visor. Puedes hacer zoom, descargar una copia y revisar todos los detalles antes de firmar.',
    color: 'bg-violet-500',
  },
  {
    icon: <PenLine size={20} className="text-white" />,
    title: 'Firma el documento',
    description:
      'Selecciona tu método de firma (autógrafa, e.Firma SAT o biometría) y completa el proceso. Recibirás un OTP de verificación.',
    color: 'bg-purple-500',
  },
  {
    icon: <CheckCircle2 size={20} className="text-white" />,
    title: 'Confirma y descarga',
    description:
      'Una vez firmado, recibirás confirmación por correo. Podrás descargar el documento con su constancia de integridad cuando todos hayan participado.',
    color: 'bg-green-500',
  },
];

export default function AyudaFirmadoPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-border bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />
            <span>Volver</span>
          </Link>
          <AppLogo size={28} />
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <HelpCircle size={28} className="text-primary" />
          </div>
          <h1 className="text-3xl font-700 text-foreground mb-3">
            Centro de ayuda para participantes
          </h1>
          <p className="text-base text-muted-foreground max-w-xl mx-auto">
            Todo lo que necesitas saber para firmar o aprobar documentos en Docubox de forma rápida y segura.
          </p>
        </div>

        {/* Step-by-step guide */}
        <section className="mb-14">
          <h2 className="text-xl font-700 text-foreground mb-6 flex items-center gap-2">
            <Shield size={20} className="text-primary" />
            Guía paso a paso para participar
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {steps.map((step, index) => (
              <div
                key={`step-${index}`}
                className="relative flex flex-col items-start p-5 rounded-2xl border border-border bg-white hover:border-primary/30 hover:shadow-sm transition-all"
              >
                {/* Step number badge */}
                <div className="absolute -top-3 -left-2 w-6 h-6 rounded-full bg-foreground text-white text-xs font-700 flex items-center justify-center">
                  {index + 1}
                </div>
                <div className={`w-10 h-10 rounded-xl ${step.color} flex items-center justify-center mb-3`}>
                  {step.icon}
                </div>
                <h3 className="text-sm font-700 text-foreground mb-1">{step.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Quick access cards */}
        <section className="mb-14">
          <h2 className="text-xl font-700 text-foreground mb-6">Accesos rápidos</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link
              href="/sign-up-login-screen"
              className="flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Key size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-600 text-foreground">Iniciar sesión</p>
                <p className="text-xs text-muted-foreground">Ya tengo cuenta</p>
              </div>
            </Link>
            <Link
              href="/registro"
              className="flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <UserPlus size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-600 text-foreground">Crear cuenta</p>
                <p className="text-xs text-muted-foreground">Primera vez en Docubox</p>
              </div>
            </Link>
            <Link
              href="/olvide-contrasena"
              className="flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all group"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Smartphone size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-600 text-foreground">Recuperar contraseña</p>
                <p className="text-xs text-muted-foreground">Olvidé mis credenciales</p>
              </div>
            </Link>
          </div>
        </section>

        {/* FAQ */}
        <section>
          <h2 className="text-xl font-700 text-foreground mb-6 flex items-center gap-2">
            <HelpCircle size={20} className="text-primary" />
            Preguntas frecuentes
          </h2>

          <div className="space-y-2">
            {faqs.map((faq, index) => (
              <div
                key={`faq-${index}`}
                className="border border-border rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => toggleFaq(index)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
                >
                  <span className="text-sm font-600 text-foreground pr-4">{faq.question}</span>
                  {openFaq === index ? (
                    <ChevronUp size={16} className="text-primary flex-shrink-0" />
                  ) : (
                    <ChevronDown size={16} className="text-muted-foreground flex-shrink-0" />
                  )}
                </button>
                {openFaq === index && (
                  <div className="px-4 pb-4 border-t border-border bg-muted/20">
                    <p className="text-sm text-muted-foreground leading-relaxed pt-3">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Contact support */}
        <div className="mt-12 p-6 rounded-2xl bg-primary/5 border border-primary/20 text-center">
          <p className="text-sm font-600 text-foreground mb-1">¿No encontraste lo que buscabas?</p>
          <p className="text-sm text-muted-foreground mb-4">
            Nuestro equipo de soporte está disponible para ayudarte en cada paso del proceso.
          </p>
          <a
            href="mailto:soporte@docubox.mx"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-600 hover:bg-primary/90 transition-colors"
          >
            <Mail size={15} />
            Contactar soporte
          </a>
        </div>
      </main>

      <footer className="text-center py-6 text-xs text-muted-foreground border-t border-border mt-8">
        © {new Date().getFullYear()} Docubox — Firma electrónica con validez legal en México
      </footer>
    </div>
  );
}
