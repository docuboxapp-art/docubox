'use client';

import { useState, useEffect } from 'react';

interface SmsResult {
  success: boolean;
  message: string;
  details?: unknown;
  debugUrl?: string;
}

interface TestResult {
  email_direct: { success: boolean; message: string; details?: unknown };
  edge_function: { success: boolean; message: string; details?: unknown };
  sms: SmsResult;
}

interface RegisteredUser {
  id: string;
  name: string;
  email: string;
}

const DEFAULT_VARS: Record<string, string> = {
  var_nombre: 'Luis',
  var_documento: 'Prueba DocuBox',
  var_mensaje: 'Este es un mensaje de prueba desde DocuBox.',
};

const EMAIL_TEMPLATES = [
  {
    value: 'test_email',
    label: '🧪 Correo de Prueba (genérico)',
    description: 'Plantilla de prueba básica para verificar que el sistema funciona',
    category: 'prueba',
  },
  {
    value: 'participant_invitation',
    label: '📨 Invitación a Participar',
    description: 'Correo que recibe un participante cuando es invitado a firmar un documento',
    category: 'participante',
  },
  {
    value: 'signature_request',
    label: '✍️ Solicitud de Firma',
    description: 'Correo de solicitud de firma enviado a participantes',
    category: 'participante',
  },
  {
    value: 'participation_reminder',
    label: 'Recordatorio de participaci\u00f3n',
    description: 'Aviso para continuar una participaci\u00f3n pendiente',
    category: 'participante',
  },
  {
    value: 'action_required',
    label: '⚡ Acción Requerida',
    description: 'Correo indicando que se requiere una acción del destinatario',
    category: 'participante',
  },
  {
    value: 'document_completed',
    label: '✅ Documento Completado',
    description: 'Correo al propietario cuando todos firmaron el documento',
    category: 'propietario',
  },
  {
    value: 'certificate_expiry',
    label: '⏰ Certificado Próximo a Vencer',
    description: 'Aviso de que el documento está próximo a vencer',
    category: 'propietario',
  },
  {
    value: 'document_expired',
    label: '🚫 Documento Vencido',
    description: 'Notificación de que el plazo de firma ha vencido',
    category: 'propietario',
  },
  {
    value: 'participation_completed_firmado',
    label: '🖊️ Participación: Firmado',
    description: 'Confirmación al participante de que firmó exitosamente',
    category: 'participacion',
  },
  {
    value: 'participation_completed_rechazado',
    label: '❌ Participación: Rechazado',
    description: 'Confirmación al participante de que rechazó el documento',
    category: 'participacion',
  },
  {
    value: 'participation_completed_cancelado',
    label: '🚫 Participación: Cancelado',
    description: 'Confirmación al participante de que su participación fue cancelada',
    category: 'participacion',
  },
  {
    value: 'participation_completed_vencido',
    label: '⌛ Participación: Vencido',
    description: 'Notificación al participante de que su participación venció',
    category: 'participacion',
  },
  {
    value: 'owner_participant_signed',
    label: '📋 Aviso Propietario: Firmó',
    description: 'Aviso al propietario de que un participante firmó',
    category: 'aviso_propietario',
  },
  {
    value: 'owner_participant_approved',
    label: '📋 Aviso Propietario: Aprobó',
    description: 'Aviso al propietario de que un participante aprobó',
    category: 'aviso_propietario',
  },
  {
    value: 'owner_participant_cancelled',
    label: '📋 Aviso Propietario: Canceló',
    description: 'Aviso al propietario de que un participante canceló',
    category: 'aviso_propietario',
  },
  {
    value: 'owner_participant_rejected',
    label: '📋 Aviso Propietario: Rechazó',
    description: 'Aviso al propietario de que un participante rechazó',
    category: 'aviso_propietario',
  },
  {
    value: 'new_device_login',
    label: 'Nuevo dispositivo detectado',
    description: 'Alerta de seguridad por acceso desde un dispositivo nuevo',
    category: 'seguridad',
  },
  {
    value: 'login_otp',
    label: 'C\u00f3digo OTP de acceso',
    description: 'C\u00f3digo temporal para iniciar sesi\u00f3n',
    category: 'seguridad',
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  seguridad: 'Seguridad y acceso',
  prueba: '🧪 Prueba',
  participante: '👤 Para Participantes',
  propietario: '📁 Para Propietarios',
  participacion: '🖊️ Confirmación de Participación',
  aviso_propietario: '🔔 Avisos al Propietario',
};

export default function TestNotificationsPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ timestamp: string; testMode: boolean; testTarget: string; emailTemplate: string; results: TestResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(true);
  const [testTarget, setTestTarget] = useState<'edge_function' | 'email_direct' | 'sms' | 'all'>('edge_function');
  const [emailTemplate, setEmailTemplate] = useState('participant_invitation');
  const [testRecipient, setTestRecipient] = useState('');
  const [recipientMode, setRecipientMode] = useState<'registered' | 'manual'>('registered');
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [varNames, setVarNames] = useState<Record<string, string>>(DEFAULT_VARS);
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarValue, setNewVarValue] = useState('');

  useEffect(() => {
    fetch('/api/test-notifications/users')
      .then((r) => r.json())
      .then((data) => {
        const users: RegisteredUser[] = data.users || [];
        setRegisteredUsers(users);
        if (users.length > 0) {
          setSelectedUserId(users[0].id);
          setTestRecipient(users[0].email);
        }
      })
      .catch(() => {
        setRecipientMode('manual');
      })
      .finally(() => setLoadingUsers(false));
  }, []);

  const selectedUser = registeredUsers.find((u) => u.id === selectedUserId);

  const handleUserSelect = (userId: string) => {
    setSelectedUserId(userId);
    const user = registeredUsers.find((u) => u.id === userId);
    if (user) setTestRecipient(user.email);
  };

  const effectiveRecipient = recipientMode === 'registered' ? (selectedUser?.email || '') : testRecipient;
  const effectiveRecipientName = recipientMode === 'registered' ? (selectedUser?.name || '') : '';

  const handleRun = async () => {
    if (!effectiveRecipient) {
      setError('Por favor selecciona o ingresa un destinatario.');
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/test-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testMode,
          testTarget,
          testRecipient: effectiveRecipient,
          recipientName: effectiveRecipientName,
          emailTemplate,
          varNames,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const updateVar = (key: string, value: string) => {
    setVarNames((prev) => ({ ...prev, [key]: value }));
  };

  const removeVar = (key: string) => {
    setVarNames((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addVar = () => {
    const key = newVarKey.trim().startsWith('var_') ? newVarKey.trim() : `var_${newVarKey.trim()}`;
    if (!key || key === 'var_') return;
    setVarNames((prev) => ({ ...prev, [key]: newVarValue }));
    setNewVarKey('');
    setNewVarValue('');
  };

  const targetOptions = [
    { value: 'edge_function', label: '📧 Edge Function (correo con plantilla)', description: 'Envía el correo usando la plantilla seleccionada vía Supabase Edge Function' },
    { value: 'email_direct', label: '📨 Email Directo (Resend API)', description: 'Prueba si el dominio noreply@docubox.com.mx está verificado en Resend' },
    { value: 'sms', label: '📱 Solo SMS', description: 'Prueba el envío de SMS vía envia-sms.com' },
    { value: 'all', label: '🔄 Todo (Email + Edge Function + SMS)', description: 'Ejecuta todas las pruebas' },
  ];

  // Group templates by category
  const templatesByCategory = EMAIL_TEMPLATES.reduce<Record<string, typeof EMAIL_TEMPLATES>>((acc, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});

  const selectedTemplate = EMAIL_TEMPLATES.find((t) => t.value === emailTemplate);

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Prueba de Notificaciones</h1>
          <p className="text-sm text-gray-500 mt-1">
            Prueba todas las plantillas de correo y SMS con datos de prueba precargados
          </p>
        </div>

        {/* Recipient Selector */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-medium text-gray-800 text-sm">Destinatario</p>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setRecipientMode('registered')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${recipientMode === 'registered' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Usuarios registrados
              </button>
              <button
                onClick={() => setRecipientMode('manual')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${recipientMode === 'manual' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Ingresar manualmente
              </button>
            </div>
          </div>

          {recipientMode === 'registered' ? (
            <div className="space-y-2">
              {loadingUsers ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                  Cargando usuarios registrados…
                </div>
              ) : registeredUsers.length === 0 ? (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No se encontraron usuarios registrados con correo. Usa la opción manual.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {registeredUsers.map((user) => (
                    <label
                      key={user.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedUserId === user.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <input
                        type="radio"
                        name="recipientUser"
                        value={user.id}
                        checked={selectedUserId === user.id}
                        onChange={() => handleUserSelect(user.id)}
                        className="accent-blue-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{user.name}</p>
                        <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <input
                type="email"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                placeholder="correo@ejemplo.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400">El correo de prueba se enviará a esta dirección</p>
            </div>
          )}

          {effectiveRecipient && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <span>✓</span>
              <span>Se enviará a: <strong>{effectiveRecipient}</strong></span>
            </div>
          )}
        </div>

        {/* Email Template Selector */}
        {(testTarget === 'edge_function' || testTarget === 'all') && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div>
              <p className="font-medium text-gray-800 text-sm">Plantilla de correo</p>
              <p className="text-xs text-gray-500 mt-0.5">Selecciona la plantilla que deseas probar. Los datos de prueba se precargan automáticamente.</p>
            </div>

            {Object.entries(templatesByCategory).map(([category, templates]) => (
              <div key={category}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{CATEGORY_LABELS[category] || category}</p>
                <div className="space-y-1">
                  {templates.map((tpl) => (
                    <label
                      key={tpl.value}
                      className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${emailTemplate === tpl.value ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}
                    >
                      <input
                        type="radio"
                        name="emailTemplate"
                        value={tpl.value}
                        checked={emailTemplate === tpl.value}
                        onChange={() => setEmailTemplate(tpl.value)}
                        className="mt-0.5 accent-blue-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{tpl.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{tpl.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {selectedTemplate && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
                <strong>Plantilla seleccionada:</strong> {selectedTemplate.label} — Los datos de prueba se enviarán automáticamente con estructura real.
              </div>
            )}
          </div>
        )}

        {/* Test Target */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <p className="font-medium text-gray-800 text-sm">¿Qué canal quieres probar?</p>
          <div className="space-y-2">
            {targetOptions.map((opt) => (
              <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${testTarget === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input
                  type="radio"
                  name="testTarget"
                  value={opt.value}
                  checked={testTarget === opt.value}
                  onChange={() => setTestTarget(opt.value as typeof testTarget)}
                  className="mt-0.5 accent-blue-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Test Mode Toggle (SMS only) */}
        {(testTarget === 'sms' || testTarget === 'all') && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-800">Modo prueba SMS</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Activo: usa <code className="bg-gray-100 px-1 rounded">pruebas_TOKEN</code> — no consume créditos
                </p>
              </div>
              <button
                onClick={() => setTestMode((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${testMode ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${testMode ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        )}

        {/* Variables Editor (SMS only) */}
        {(testTarget === 'sms' || testTarget === 'all') && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div>
              <p className="font-medium text-gray-800">Variables de la plantilla SMS</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Ajusta los nombres para que coincidan con los de tu plantilla en envia-sms.com.
              </p>
            </div>

            {Object.entries(varNames).map(([key, value]) => (
              <div key={key} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={key}
                  readOnly
                  className="w-40 text-xs font-mono bg-gray-100 border border-gray-200 rounded px-2 py-1.5 text-gray-600"
                />
                <input
                  type="text"
                  value={value}
                  onChange={(e) => updateVar(key, e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => removeVar(key)}
                  className="text-red-400 hover:text-red-600 text-xs px-2 py-1.5 rounded border border-red-100 hover:border-red-300"
                >
                  ✕
                </button>
              </div>
            ))}

            <div className="flex gap-2 items-center pt-1 border-t border-gray-100">
              <input
                type="text"
                placeholder="nombre_var (sin var_)"
                value={newVarKey}
                onChange={(e) => setNewVarKey(e.target.value)}
                className="w-40 text-xs font-mono border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="valor"
                value={newVarValue}
                onChange={(e) => setNewVarValue(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={addVar}
                className="text-blue-600 hover:text-blue-800 text-xs px-2 py-1.5 rounded border border-blue-200 hover:border-blue-400"
              >
                + Agregar
              </button>
            </div>
          </div>
        )}

        {/* Run Button */}
        <button
          onClick={handleRun}
          disabled={loading || !effectiveRecipient}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          {loading ? 'Enviando…' : `Enviar prueba${selectedTemplate ? ` — ${selectedTemplate.label}` : ''}`}
        </button>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs text-gray-400">
                {new Date(result.timestamp).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}
              </p>
              {result.testMode && <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs font-medium">MODO PRUEBA SMS</span>}
              {result.emailTemplate && (
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">
                  {EMAIL_TEMPLATES.find((t) => t.value === result.emailTemplate)?.label || result.emailTemplate}
                </span>
              )}
            </div>

            {(result.testTarget === 'all' || result.testTarget === 'edge_function') && (
              <ResultCard
                label="Edge Function — Correo con plantilla"
                success={result.results.edge_function.success}
                message={result.results.edge_function.message}
                details={result.results.edge_function.details}
                hint={!result.results.edge_function.success ? 'Si el error menciona "domain not verified" o "403", el dominio noreply@docubox.com.mx no está verificado en Resend. Ve a resend.com → Domains y verifica el dominio.' : undefined}
              />
            )}

            {(result.testTarget === 'all' || result.testTarget === 'email_direct') && (
              <ResultCard
                label="Email Directo (Resend API)"
                success={result.results.email_direct.success}
                message={result.results.email_direct.message}
                details={result.results.email_direct.details}
                hint={!result.results.email_direct.success ? 'Si falla aquí pero el edge function también falla, el problema es el dominio. Si solo falla el edge function, el RESEND_API_KEY no está configurado en Supabase secrets.' : undefined}
              />
            )}

            {(result.testTarget === 'all' || result.testTarget === 'sms') && (
              <ResultCard
                label="SMS"
                success={result.results.sms.success}
                message={result.results.sms.message}
                details={result.results.sms.details}
                debugUrl={(result.results.sms as SmsResult).debugUrl}
              />
            )}

            {result.testTarget === 'all' && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm space-y-2">
                <p className="font-semibold text-gray-800">📋 Diagnóstico</p>
                {result.results.email_direct.success && result.results.edge_function.success && (
                  <p className="text-green-700">✅ Todo funciona correctamente. Si los correos no llegan, revisa la carpeta de spam del destinatario.</p>
                )}
                {result.results.email_direct.success && !result.results.edge_function.success && (
                  <p className="text-red-700">⚠️ El dominio está verificado en Resend pero el edge function falla. Verifica que <strong>RESEND_API_KEY</strong> esté configurado en los secrets del edge function en Supabase Dashboard → Edge Functions → send-email-notifications → Secrets.</p>
                )}
                {!result.results.email_direct.success && !result.results.edge_function.success && (
                  <p className="text-red-700">❌ El dominio <strong>noreply@docubox.com.mx</strong> no está verificado en Resend. Ve a <strong>resend.com → Domains</strong>, agrega el dominio <strong>docubox.com.mx</strong> y configura los registros DNS requeridos.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Help */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800 space-y-2">
          <p className="font-semibold">📌 Plantillas disponibles ({EMAIL_TEMPLATES.length})</p>
          <ul className="space-y-1 text-blue-700 text-xs">
            {EMAIL_TEMPLATES.map((t) => (
              <li key={t.value} className="flex items-start gap-1.5">
                <span className="mt-0.5">•</span>
                <span><strong>{t.label}</strong> — {t.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ResultCard({
  label,
  success,
  message,
  details,
  debugUrl,
  hint,
}: {
  label: string;
  success: boolean;
  message: string;
  details?: unknown;
  debugUrl?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);

  return (
    <div className={`rounded-xl border p-4 ${success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex items-start gap-3">
        <span className="text-xl">{success ? '✅' : '❌'}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800">{label}</p>
          <p className={`text-sm mt-0.5 ${success ? 'text-green-700' : 'text-red-700'}`}>{message}</p>

          {hint && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">{hint}</p>
          )}

          {debugUrl && (
            <div className="mt-2">
              <button
                onClick={() => setUrlOpen((v) => !v)}
                className="text-xs text-blue-600 hover:underline"
              >
                {urlOpen ? '▲ Ocultar URL enviada' : '▼ Ver URL enviada a la API'}
              </button>
              {urlOpen && (
                <pre className="mt-1 text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-gray-700">
                  {debugUrl}
                </pre>
              )}
            </div>
          )}

          {details != null && (
            <div className="mt-2">
              <button
                onClick={() => setOpen((v) => !v)}
                className="text-xs text-gray-500 hover:underline"
              >
                {open ? '▲ Ocultar detalles' : '▼ Ver detalles técnicos'}
              </button>
              {open && (
                <pre className="mt-1 text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-gray-700">
                  {JSON.stringify(details, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
