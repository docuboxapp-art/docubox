'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';

interface SignupFormData {
  nombreCompleto: string;
  rfc: string;
  empresa: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;

interface Props {
  onSwitchToLogin: () => void;
}

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: 'Mínimo 8 caracteres', ok: password.length >= 8 },
    { label: 'Una mayúscula', ok: /[A-Z]/.test(password) },
    { label: 'Un número', ok: /\d/.test(password) },
    { label: 'Un carácter especial', ok: /[!@#$%^&*(),.?":{}|<>]/.test(password) },
  ];
  const score = checks.filter((c) => c.ok).length;
  const strengthLabel = ['', 'Débil', 'Regular', 'Buena', 'Fuerte'][score];
  const strengthColor = ['', 'bg-red-500', 'bg-amber-500', 'bg-blue-500', 'bg-emerald-500'][score];

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex gap-1">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={`strength-bar-${i}`}
              className={`flex-1 h-1.5 rounded-full transition-all duration-300 ${i <= score ? strengthColor : 'bg-border'}`}
            />
          ))}
        </div>
        <span className={`text-[10px] font-600 ${['', 'text-red-600', 'text-amber-600', 'text-blue-600', 'text-emerald-600'][score]}`}>
          {strengthLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {checks.map((check) => (
          <div key={`check-${check.label}`} className="flex items-center gap-1">
            <CheckCircle2 size={10} className={check.ok ? 'text-emerald-600' : 'text-muted-foreground'} />
            <span className={`text-[10px] ${check.ok ? 'text-emerald-700' : 'text-muted-foreground'}`}>{check.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SignupForm({ onSwitchToLogin }: Props) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rfcValidating, setRfcValidating] = useState(false);
  const [rfcStatus, setRfcStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SignupFormData>();

  const passwordValue = watch('password', '');
  const rfcValue = watch('rfc', '');

  const validateRfc = () => {
    if (!rfcValue || !RFC_REGEX.test(rfcValue)) {
      setRfcStatus('invalid');
      return;
    }
    // Backend integration: POST /api/sat/validate-rfc
    setRfcValidating(true);
    setTimeout(() => {
      setRfcStatus('valid');
      setRfcValidating(false);
      toast.success('RFC encontrado en el padrón del SAT.');
    }, 1200);
  };

  const onSignup = (data: SignupFormData) => {
    if (data.password !== data.confirmPassword) {
      toast.error('Las contraseñas no coinciden.');
      return;
    }
    if (!data.acceptTerms) {
      toast.error('Debes aceptar los términos y condiciones.');
      return;
    }
    // Backend integration: POST /api/auth/signup — Supabase auth + create org
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.success('¡Cuenta creada! Revisa tu correo para verificar tu cuenta.');
      setTimeout(() => onSwitchToLogin(), 2000);
    }, 2000);
  };

  return (
    <div>
      <Toaster position="bottom-right" richColors />
      <div className="mb-5">
        <h2 className="text-2xl font-700 text-foreground">Crea tu cuenta</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Empieza a firmar documentos con validez legal en México. Gratis los primeros 30 días.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSignup)} className="space-y-4">
        {/* Nombre completo */}
        <div>
          <label className="block text-xs font-600 text-foreground mb-1">
            Nombre completo <span className="text-red-500">*</span>
          </label>
          <input
            {...register('nombreCompleto', {
              required: 'El nombre es requerido',
              minLength: { value: 5, message: 'Ingresa tu nombre completo' },
            })}
            type="text"
            placeholder="Ej: María García López"
            className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${errors.nombreCompleto ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
          />
          {errors.nombreCompleto && (
            <p className="text-[11px] text-red-600 mt-1">{errors.nombreCompleto.message}</p>
          )}
        </div>

        {/* RFC */}
        <div>
          <label className="block text-xs font-600 text-foreground mb-1">
            RFC <span className="text-red-500">*</span>
          </label>
          <p className="text-[11px] text-muted-foreground mb-1.5">
            RFC de persona física o moral registrado en el SAT. Se validará automáticamente.
          </p>
          <div className="flex gap-2">
            <input
              {...register('rfc', {
                required: 'El RFC es requerido',
                pattern: { value: RFC_REGEX, message: 'Formato de RFC inválido (Ej: GOMA870312H45)' },
              })}
              type="text"
              placeholder="GOMA870312H45"
              className={`flex-1 px-3 py-2.5 text-sm font-mono border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all uppercase ${errors.rfc ? 'border-red-400 bg-red-50' : rfcStatus === 'valid' ? 'border-emerald-400 bg-emerald-50' : 'border-border bg-white'}`}
            />
            <button
              type="button"
              onClick={validateRfc}
              disabled={rfcValidating}
              className="px-3 py-2.5 border border-border rounded-xl text-xs font-600 text-muted-foreground hover:bg-muted transition-all duration-150 whitespace-nowrap disabled:opacity-50 flex items-center gap-1.5"
            >
              {rfcValidating ? (
                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : 'Validar'}
            </button>
          </div>
          {errors.rfc && (
            <p className="text-[11px] text-red-600 mt-1 flex items-center gap-1">
              <AlertTriangle size={10} />
              {errors.rfc.message}
            </p>
          )}
          {rfcStatus === 'valid' && (
            <p className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1 font-500">
              <CheckCircle2 size={10} />
              RFC válido — encontrado en el padrón del SAT
            </p>
          )}
          {rfcStatus === 'invalid' && (
            <p className="text-[11px] text-red-600 mt-1 flex items-center gap-1">
              <AlertTriangle size={10} />
              RFC no encontrado en el padrón del SAT
            </p>
          )}
        </div>

        {/* Empresa */}
        <div>
          <label className="block text-xs font-600 text-foreground mb-1">
            Empresa u organización
          </label>
          <p className="text-[11px] text-muted-foreground mb-1.5">Opcional — para cuentas empresariales</p>
          <input
            {...register('empresa')}
            type="text"
            placeholder="Ej: Corporativo Innovación SA de CV"
            className="w-full px-3 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-600 text-foreground mb-1">
            Correo electrónico <span className="text-red-500">*</span>
          </label>
          <input
            {...register('email', {
              required: 'El correo es requerido',
              pattern: { value: /^\S+@\S+\.\S+$/, message: 'Formato de email inválido' },
            })}
            type="email"
            placeholder="tu@empresa.com"
            autoComplete="email"
            className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${errors.email ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
          />
          {errors.email && (
            <p className="text-[11px] text-red-600 mt-1">{errors.email.message}</p>
          )}
        </div>

        {/* Password */}
        <div>
          <label className="block text-xs font-600 text-foreground mb-1">
            Contraseña <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              {...register('password', {
                required: 'La contraseña es requerida',
                minLength: { value: 8, message: 'Mínimo 8 caracteres' },
              })}
              type={showPassword ? 'text' : 'password'}
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
              className={`w-full px-3 py-2.5 pr-10 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${errors.password ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {errors.password && (
            <p className="text-[11px] text-red-600 mt-1">{errors.password.message}</p>
          )}
          <PasswordStrength password={passwordValue} />
        </div>

        {/* Confirm password */}
        <div>
          <label className="block text-xs font-600 text-foreground mb-1">
            Confirmar contraseña <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              {...register('confirmPassword', {
                required: 'Confirma tu contraseña',
                validate: (val) => val === passwordValue || 'Las contraseñas no coinciden',
              })}
              type={showConfirm ? 'text' : 'password'}
              placeholder="Repite tu contraseña"
              autoComplete="new-password"
              className={`w-full px-3 py-2.5 pr-10 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${errors.confirmPassword ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {errors.confirmPassword && (
            <p className="text-[11px] text-red-600 mt-1">{errors.confirmPassword.message}</p>
          )}
        </div>

        {/* Terms */}
        <div className="flex items-start gap-2">
          <input
            {...register('acceptTerms', { required: true })}
            id="terms"
            type="checkbox"
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 mt-0.5 flex-shrink-0"
          />
          <label htmlFor="terms" className="text-xs text-muted-foreground cursor-pointer leading-relaxed">
            Acepto los{' '}
            <a href="#" className="text-primary hover:underline font-500">Términos de Servicio</a>,{' '}
            <a href="#" className="text-primary hover:underline font-500">Política de Privacidad</a> y el uso de firma electrónica avanzada conforme a la{' '}
            <a href="#" className="text-primary hover:underline font-500">LFEA</a> y el Código de Comercio de México.
          </label>
        </div>
        {errors.acceptTerms && (
          <p className="text-[11px] text-red-600 -mt-2">Debes aceptar los términos para continuar</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl text-sm font-700 hover:bg-primary-700 disabled:opacity-60 transition-all duration-150 active:scale-95"
          style={{ minHeight: '44px' }}
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            'Crear cuenta gratis'
          )}
        </button>
      </form>

      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2">
        <Info size={13} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-blue-700 leading-relaxed">
          Al crear tu cuenta, recibirás un email de verificación. Tu RFC es validado en tiempo real contra el padrón del SAT mediante integración con Nubarium.
        </p>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-4">
        ¿Ya tienes cuenta?{' '}
        <button onClick={onSwitchToLogin} className="text-primary font-600 hover:underline">
          Iniciar sesión
        </button>
      </p>
    </div>
  );
}