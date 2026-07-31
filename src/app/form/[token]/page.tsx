'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

import FieldRenderer from '../../formularios/components/FieldRenderer';
import PublicTokenLayout from '@/components/PublicTokenLayout';
import { FormField } from '@/contexts/FormBuilderContext';
import { CheckCircle, AlertCircle, Loader2, Clock, ChevronLeft, ChevronRight, Send } from 'lucide-react';

interface FormSchema {
  templateId: string;
  name: string;
  description: string;
  fields: FormField[];
  settings: {
    mode: 'scroll' | 'multistep';
    multiStep: boolean;
    language: string;
  };
  workspaceName: string;
  workspaceLogo?: string;
  expiresAt: string;
}

type PageState = 'loading' | 'form' | 'expired' | 'used' | 'error' | 'success';

export default function FormViewPage() {
  const params = useParams();
  const token = params?.token as string;

  const [pageState, setPageState] = useState<PageState>('loading');
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [redirectToSign, setRedirectToSign] = useState(false);

  // Honeypot
  const [honeypot, setHoneypot] = useState('');

  useEffect(() => {
    if (!token) { setPageState('error'); return; }
    loadForm();
  }, [token]);

  const loadForm = async () => {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/get-form-schema?token=${encodeURIComponent(token)}`,
        { headers: { 'Content-Type': 'application/json' } }
      );
      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'TOKEN_EXPIRED') { setPageState('expired'); return; }
        if (data.code === 'TOKEN_USED') { setPageState('used'); return; }
        setErrorMessage(data.error || 'Error al cargar el formulario');
        setPageState('error');
        return;
      }

      setSchema(data);
      setPageState('form');
    } catch {
      setErrorMessage('No se pudo conectar con el servidor');
      setPageState('error');
    }
  };

  const validateField = (field: FormField, val: unknown): string => {
    if (field.required) {
      if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
        return 'Este campo es obligatorio';
      }
    }
    if (field.type === 'email' && val) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val as string)) return 'Correo electrónico inválido';
    }
    if (field.type === 'phone' && val) {
      const digits = (val as string).replace(/\D/g, '');
      if (digits.length !== 10) return 'Teléfono debe tener 10 dígitos';
    }
    if (field.minLength && typeof val === 'string' && val.length < field.minLength) {
      return `Mínimo ${field.minLength} caracteres`;
    }
    if (field.maxLength && typeof val === 'string' && val.length > field.maxLength) {
      return `Máximo ${field.maxLength} caracteres`;
    }
    if (field.regex && val) {
      try {
        if (!new RegExp(field.regex).test(val as string)) {
          return field.regexError || 'Formato inválido';
        }
      } catch { /* invalid regex */ }
    }
    return '';
  };

  const getVisibleFields = (): FormField[] => {
    if (!schema) return [];
    return schema.fields.filter((field) => {
      if (!field.conditionalVisible || !field.conditionalRule) return true;
      const { fieldId, operator, value: ruleValue } = field.conditionalRule;
      const fieldValue = values[fieldId];
      switch (operator) {
        case 'eq': return String(fieldValue) === ruleValue;
        case 'neq': return String(fieldValue) !== ruleValue;
        case 'contains': return String(fieldValue || '').includes(ruleValue);
        case 'empty': return !fieldValue || fieldValue === '';
        case 'not_empty': return !!fieldValue && fieldValue !== '';
        default: return true;
      }
    });
  };

  const visibleFields = getVisibleFields();

  // Multi-step: split fields into sections
  const steps = schema?.settings?.multiStep
    ? (() => {
        const sections: FormField[][] = [[]];
        visibleFields.forEach((f) => {
          if (f.type === 'divider' && sections[sections.length - 1].length > 0) {
            sections.push([]);
          } else {
            sections[sections.length - 1].push(f);
          }
        });
        return sections.filter((s) => s.length > 0);
      })()
    : [visibleFields];

  const currentFields = steps[currentStep] || [];
  const totalSteps = steps.length;
  const progress = visibleFields.length > 0
    ? Math.round((Object.keys(values).filter((k) => values[k] !== '' && values[k] !== null && values[k] !== undefined).length / visibleFields.length) * 100)
    : 0;

  const validateCurrentStep = (): boolean => {
    const newErrors: Record<string, string> = {};
    currentFields.forEach((field) => {
      const err = validateField(field, values[field.id]);
      if (err) newErrors[field.id] = err;
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateCurrentStep()) setCurrentStep((s) => s + 1);
  };

  const handlePrev = () => setCurrentStep((s) => s - 1);

  const handleSubmit = async () => {
    if (honeypot) return; // Bot detected
    if (!validateCurrentStep()) return;

    setSubmitting(true);
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/form-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, response_data: values }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Error al enviar el formulario');
        setSubmitting(false);
        return;
      }

      setRedirectToSign(data.redirect_to_sign || false);
      setPageState('success');
    } catch {
      setErrorMessage('Error de conexión. Intenta de nuevo.');
      setSubmitting(false);
    }
  };

  // ── Render states ──────────────────────────────────────────
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <Loader2 size={32} className="animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Cargando formulario...</p>
        </div>
      </div>
    );
  }

  if (pageState === 'expired') {
    return (
      <StatusScreen
        icon={<Clock size={40} className="text-orange-500" />}
        title="Enlace expirado"
        message="Este formulario ya no está disponible. El enlace ha expirado."
        hint="Contacta al remitente para solicitar un nuevo enlace."
      />
    );
  }

  if (pageState === 'used') {
    return (
      <StatusScreen
        icon={<CheckCircle size={40} className="text-green-500" />}
        title="Formulario ya respondido"
        message="Este formulario ya fue completado anteriormente."
        hint="Si crees que esto es un error, contacta al remitente."
      />
    );
  }

  if (pageState === 'error') {
    return (
      <StatusScreen
        icon={<AlertCircle size={40} className="text-red-500" />}
        title="Error"
        message={errorMessage || 'No se pudo cargar el formulario.'}
        hint="Verifica el enlace o contacta al remitente."
      />
    );
  }

  if (pageState === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle size={32} className="text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-foreground">¡Formulario enviado!</h1>
          <p className="text-sm text-muted-foreground">
            Tu respuesta ha sido registrada exitosamente. Recibirás una confirmación por correo electrónico.
          </p>
          {redirectToSign && (
            <button className="w-full py-3 px-6 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
              Continuar con la firma <ChevronRight size={16} />
            </button>
          )}
          <p className="text-xs text-muted-foreground pt-2">
            Enviado el {new Date().toLocaleString('es-MX')}
          </p>
        </div>
      </div>
    );
  }

  if (!schema) return null;

  return (
    <PublicTokenLayout token={token} luciaScope="public_form">
    <div className="min-h-screen bg-gray-50">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-gray-200 z-50">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <header className="bg-white border-b border-border px-4 py-4 mt-1">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          {schema.workspaceLogo && (
            <img src={schema.workspaceLogo} alt={schema.workspaceName} className="h-8 w-auto object-contain" />
          )}
          <div>
            <h1 className="text-base font-semibold text-foreground">{schema.name}</h1>
            <p className="text-xs text-muted-foreground">{schema.workspaceName}</p>
          </div>
          {totalSteps > 1 && (
            <div className="ml-auto text-xs text-muted-foreground">
              Paso {currentStep + 1} de {totalSteps}
            </div>
          )}
        </div>
      </header>

      {/* Form */}
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {schema.description && (
          <p className="text-sm text-muted-foreground bg-white rounded-xl p-4 border border-border">
            {schema.description}
          </p>
        )}

        {/* Fields */}
        <div className="bg-white rounded-2xl shadow-sm border border-border p-6 space-y-6">
          {currentFields.map((field) => (
            <FieldRenderer
              key={field.id}
              field={field}
              value={values[field.id]}
              onChange={(val) => setValues((prev) => ({ ...prev, [field.id]: val }))}
              error={errors[field.id]}
            />
          ))}
        </div>

        {/* Honeypot (hidden) */}
        <input
          type="text"
          name="website"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          className="hidden"
          tabIndex={-1}
          autoComplete="off"
        />

        {/* Footer */}
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground text-center">
            Al enviar este formulario, acepto que mis datos sean utilizados conforme a la LFPDPPP.
          </p>

          <div className="flex items-center gap-3">
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
              >
                <ChevronLeft size={16} /> Anterior
              </button>
            )}

            {currentStep < totalSteps - 1 ? (
              <button
                onClick={handleNext}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Siguiente <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
              >
                {submitting ? (
                  <><Loader2 size={16} className="animate-spin" /> Enviando...</>
                ) : (
                  <><Send size={16} /> Enviar formulario</>
                )}
              </button>
            )}
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            Powered by <span className="font-semibold">DOCUBOX</span>
          </p>
        </div>
      </main>
    </div>
    </PublicTokenLayout>
  );
}

function StatusScreen({ icon, title, message, hint }: { icon: React.ReactNode; title: string; message: string; hint: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8 text-center space-y-4">
        <div className="flex justify-center">{icon}</div>
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
