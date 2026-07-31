'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import { CheckCircle2, XCircle, Loader2, AlertTriangle, ArrowRight } from 'lucide-react';

type VerificationState = 'loading' | 'success' | 'already_used' | 'expired' | 'error';

function VerificarCorreoContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<VerificationState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const token = searchParams?.get('token');
    if (!token) {
      setState('error');
      setErrorMessage('No se encontró el token de verificación en el enlace.');
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch('/api/registro/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();

        if (res.ok && data.success) {
          setState('success');
        } else if (data.alreadyUsed) {
          setState('already_used');
        } else if (data.expired) {
          setState('expired');
        } else {
          setState('error');
          setErrorMessage(data.error || 'Error desconocido al verificar el correo.');
        }
      } catch {
        setState('error');
        setErrorMessage('Error de conexión. Por favor intenta de nuevo.');
      }
    };

    verify();
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <AppLogo className="h-10 w-auto" />
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          {/* Loading */}
          {state === 'loading' && (
            <div className="p-10 text-center">
              <div className="flex justify-center mb-5">
                <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Verificando tu correo...
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Por favor espera un momento.
              </p>
            </div>
          )}

          {/* Success */}
          {state === 'success' && (
            <>
              <div className="bg-gradient-to-r from-green-500 to-emerald-500 p-8 text-center">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                    <CheckCircle2 className="w-9 h-9 text-white" />
                  </div>
                </div>
                <h1 className="text-2xl font-bold text-white mb-1">¡Correo verificado!</h1>
                <p className="text-green-100 text-sm">Tu cuenta está completamente activa</p>
              </div>
              <div className="p-8 text-center">
                <p className="text-gray-600 dark:text-gray-300 text-sm mb-6 leading-relaxed">
                  Tu dirección de correo electrónico ha sido verificada exitosamente. Ya puedes crear y enviar documentos en Docubox.
                </p>
                <button
                  onClick={() => router.push('/documents-dashboard')}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm"
                >
                  Ir al dashboard
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {/* Already used */}
          {state === 'already_used' && (
            <>
              <div className="bg-gradient-to-r from-blue-500 to-indigo-500 p-8 text-center">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                    <CheckCircle2 className="w-9 h-9 text-white" />
                  </div>
                </div>
                <h1 className="text-2xl font-bold text-white mb-1">Ya verificado</h1>
                <p className="text-blue-100 text-sm">Este enlace ya fue utilizado anteriormente</p>
              </div>
              <div className="p-8 text-center">
                <p className="text-gray-600 dark:text-gray-300 text-sm mb-6 leading-relaxed">
                  Tu correo electrónico ya fue verificado. Puedes iniciar sesión normalmente.
                </p>
                <button
                  onClick={() => router.push('/sign-up-login-screen')}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm"
                >
                  Iniciar sesión
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {/* Expired */}
          {state === 'expired' && (
            <>
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-8 text-center">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                    <AlertTriangle className="w-9 h-9 text-white" />
                  </div>
                </div>
                <h1 className="text-2xl font-bold text-white mb-1">Enlace expirado</h1>
                <p className="text-amber-100 text-sm">Este enlace de verificación ya no es válido</p>
              </div>
              <div className="p-8 text-center">
                <p className="text-gray-600 dark:text-gray-300 text-sm mb-6 leading-relaxed">
                  El enlace de verificación ha expirado (válido por 72 horas). Inicia sesión y solicita un nuevo correo de verificación desde tu perfil.
                </p>
                <button
                  onClick={() => router.push('/sign-up-login-screen')}
                  className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm"
                >
                  Iniciar sesión
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {/* Error */}
          {state === 'error' && (
            <>
              <div className="bg-gradient-to-r from-red-500 to-rose-500 p-8 text-center">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                    <XCircle className="w-9 h-9 text-white" />
                  </div>
                </div>
                <h1 className="text-2xl font-bold text-white mb-1">Error de verificación</h1>
                <p className="text-red-100 text-sm">No se pudo verificar tu correo</p>
              </div>
              <div className="p-8 text-center">
                <p className="text-gray-600 dark:text-gray-300 text-sm mb-2 leading-relaxed">
                  {errorMessage || 'Ocurrió un error al verificar tu correo electrónico.'}
                </p>
                <p className="text-gray-500 dark:text-gray-400 text-xs mb-6">
                  Si el problema persiste, contacta a soporte.
                </p>
                <button
                  onClick={() => router.push('/sign-up-login-screen')}
                  className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-800 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm"
                >
                  Ir al inicio
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          © {new Date().getFullYear()} Docubox. Todos los derechos reservados.
        </p>
      </div>
    </div>
  );
}

export default function VerificarCorreoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    }>
      <VerificarCorreoContent />
    </Suspense>
  );
}
