'use client';

import React, { useState, useRef } from 'react';
import { FormField } from '@/contexts/FormBuilderContext';
import { validateRFC, validateCURP, validatePhoneMX, formatPhoneMX } from '@/utils/mexicanValidators';
import SignaturePad from './SignaturePad';
import { Upload, X, CheckCircle, AlertCircle, FileKey2, Loader2, ShieldCheck } from 'lucide-react';

const ESTADOS_MX = [
  'Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas',
  'Chihuahua','Ciudad de México','Coahuila','Colima','Durango','Estado de México',
  'Guanajuato','Guerrero','Hidalgo','Jalisco','Michoacán','Morelos','Nayarit',
  'Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí',
  'Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas',
];

interface FieldRendererProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  formToken?: string;
}

export default function FieldRenderer({ field, value, onChange, error, formToken }: FieldRendererProps) {
  const [rfcResult, setRfcResult] = useState<{ valid: boolean; type?: string | null; error?: string } | null>(null);
  const [curpResult, setCurpResult] = useState<{ valid: boolean; sex?: string | null; state?: string | null; error?: string } | null>(null);
  const [phoneFormatted, setPhoneFormatted] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const baseInputClass = `w-full px-4 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${
    error ? 'border-red-400 bg-red-50' : 'border-border bg-background focus:border-primary'
  }`;

  if (field.type === 'divider') {
    return <hr className="border-border my-2" />;
  }

  if (field.type === 'texto_bloque') {
    return (
      <div className="py-2">
        <p className="text-sm text-muted-foreground">{field.description || field.label}</p>
      </div>
    );
  }

  if (field.type === 'imagen_estatica') {
    return null;
  }

  return (
    <div className="space-y-1.5">
      {/* Label */}
      {!['checkbox', 'firma_click', 'consentimiento', 'declaration', 'signature_block', 'firma_efirma'].includes(field.type) && (
        <label className="block text-sm font-medium text-foreground">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}

      {/* Input by type */}
      {['text', 'business_name'].includes(field.type) && (
        <input
          type="text"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          readOnly={field.readOnly}
          className={baseInputClass}
        />
      )}

      {['textarea', 'fiscal_address'].includes(field.type) && (
        <textarea
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          readOnly={field.readOnly}
          rows={4}
          className={`${baseInputClass} resize-none`}
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          readOnly={field.readOnly}
          min={field.minValue}
          max={field.maxValue}
          className={baseInputClass}
        />
      )}

      {field.type === 'currency' && (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <input
            type="number"
            step="0.01"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || '0.00'}
            readOnly={field.readOnly}
            min={field.minValue}
            max={field.maxValue}
            className={`${baseInputClass} pl-8 pr-14`}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">MXN</span>
        </div>
      )}

      {field.type === 'email' && (
        <input
          type="email"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || 'correo@ejemplo.com'}
          readOnly={field.readOnly}
          className={baseInputClass}
        />
      )}

      {field.type === 'phone' && (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">+52</span>
          <input
            type="tel"
            value={(value as string) || ''}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '').slice(0, 10);
              const formatted = formatPhoneMX(raw);
              onChange(raw);
              const result = validatePhoneMX(raw);
              setPhoneFormatted(result.formatted);
            }}
            placeholder="(55) 1234-5678"
            className={`${baseInputClass} pl-12`}
          />
        </div>
      )}

      {field.type === 'date' && (
        <input
          type="date"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          readOnly={field.readOnly}
          className={baseInputClass}
        />
      )}

      {field.type === 'time' && (
        <input
          type="time"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          readOnly={field.readOnly}
          className={baseInputClass}
        />
      )}

      {field.type === 'checkbox' && (
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={!!(value as boolean)}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
          />
          <span className="text-sm text-foreground">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </span>
        </label>
      )}

      {field.type === 'checkbox_group' && (
        <div className="space-y-2">
          {(field.options || []).map((opt) => (
            <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={((value as string[]) || []).includes(opt.value)}
                onChange={(e) => {
                  const current = (value as string[]) || [];
                  onChange(e.target.checked ? [...current, opt.value] : current.filter((v) => v !== opt.value));
                }}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
              />
              <span className="text-sm text-foreground">{opt.label}</span>
            </label>
          ))}
        </div>
      )}

      {['radio', 'yes_no'].includes(field.type) && (
        <div className="space-y-2">
          {(field.options || []).map((opt) => (
            <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name={field.id}
                value={opt.value}
                checked={(value as string) === opt.value}
                onChange={() => onChange(opt.value)}
                className="w-4 h-4 border-border text-primary focus:ring-primary/30"
              />
              <span className="text-sm text-foreground">{opt.label}</span>
            </label>
          ))}
        </div>
      )}

      {field.type === 'select' && (
        <select
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseInputClass}
        >
          <option value="">{field.placeholder || 'Selecciona una opción'}</option>
          {(field.options || []).map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {field.type === 'estado_mx' && (
        <select
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseInputClass}
        >
          <option value="">Selecciona un estado</option>
          {ESTADOS_MX.map((estado) => (
            <option key={estado} value={estado}>{estado}</option>
          ))}
        </select>
      )}

      {field.type === 'rfc' && (
        <div className="space-y-1">
          <div className="relative">
            <input
              type="text"
              value={(value as string) || ''}
              onChange={(e) => {
                const v = e.target.value.toUpperCase().slice(0, 13);
                onChange(v);
                if (v.length >= 12) setRfcResult(validateRFC(v));
                else setRfcResult(null);
              }}
              placeholder="XAXX010101000"
              maxLength={13}
              className={`${baseInputClass} uppercase pr-10`}
            />
            {rfcResult && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                {rfcResult.valid
                  ? <CheckCircle size={16} className="text-green-500" />
                  : <AlertCircle size={16} className="text-red-500" />}
              </span>
            )}
          </div>
          {rfcResult && rfcResult.valid && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle size={11} /> RFC válido — Persona {rfcResult.type === 'fisica' ? 'Física' : 'Moral'}
            </p>
          )}
          {rfcResult && !rfcResult.valid && (
            <p className="text-xs text-red-500">{rfcResult.error}</p>
          )}
        </div>
      )}

      {field.type === 'curp' && (
        <div className="space-y-1">
          <div className="relative">
            <input
              type="text"
              value={(value as string) || ''}
              onChange={(e) => {
                const v = e.target.value.toUpperCase().slice(0, 18);
                onChange(v);
                if (v.length === 18) setCurpResult(validateCURP(v));
                else setCurpResult(null);
              }}
              placeholder="XEXX010101HNEXXXA4"
              maxLength={18}
              className={`${baseInputClass} uppercase pr-10`}
            />
            {curpResult && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                {curpResult.valid
                  ? <CheckCircle size={16} className="text-green-500" />
                  : <AlertCircle size={16} className="text-red-500" />}
              </span>
            )}
          </div>
          {curpResult && curpResult.valid && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle size={11} /> CURP válida — {curpResult.sex === 'H' ? 'Hombre' : 'Mujer'} · {curpResult.state}
            </p>
          )}
          {curpResult && !curpResult.valid && (
            <p className="text-xs text-red-500">{curpResult.error}</p>
          )}
        </div>
      )}

      {field.type === 'nss' && (
        <input
          type="text"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 11))}
          placeholder="12345678901"
          maxLength={11}
          className={baseInputClass}
        />
      )}

      {field.type === 'clave_elector' && (
        <input
          type="text"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value.toUpperCase().slice(0, 18))}
          placeholder="XXXXXN000000HXXXXX00"
          maxLength={18}
          className={`${baseInputClass} uppercase`}
        />
      )}

      {field.type === 'firma_autografa' && (
        <SignaturePad
          value={(value as string) || null}
          onChange={onChange}
        />
      )}

      {field.type === 'iniciales' && (
        <div className="border-2 border-dashed border-border rounded-xl p-4 bg-white">
          <SignaturePad
            value={(value as string) || null}
            onChange={onChange}
          />
        </div>
      )}

      {field.type === 'firma_click' && (
        <div className="border border-border rounded-xl p-4 bg-muted/30 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {field.description || 'Al marcar esta casilla, acepto que mi firma electrónica tiene la misma validez legal que una firma autógrafa, conforme a la legislación mexicana vigente.'}
          </p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!(value as boolean)}
              onChange={(e) => onChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
            />
            <span className="text-sm font-medium text-foreground">
              Acepto y firmo electrónicamente
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </span>
          </label>
          {Boolean(value) && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle size={11} /> Firmado el {new Date().toLocaleString('es-MX')}
            </p>
          )}
        </div>
      )}

      {['consentimiento', 'declaration'].includes(field.type) && (
        <div className="border border-border rounded-xl p-4 bg-muted/30 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {field.description || 'He leído y acepto los términos y condiciones del presente documento.'}
          </p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!(value as boolean)}
              onChange={(e) => onChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
            />
            <span className="text-sm font-medium text-foreground">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </span>
          </label>
        </div>
      )}

      {field.type === 'signature_block' && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
            <ShieldCheck size={16} /> {field.label}
          </div>
          <p className="text-xs leading-5 text-indigo-700">
            Selecciona el mecanismo que utilizarás para formalizar el documento después de revisar el PDF.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(field.signature?.allowedTypes || ['efirma_sat', 'autografa_digital', 'click_sign']).map((signatureType) => (
              <button
                key={signatureType}
                type="button"
                onClick={() => onChange(signatureType)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${value === signatureType ? 'border-indigo-600 bg-white text-indigo-700 shadow-sm' : 'border-indigo-200 text-indigo-700 hover:bg-white/70'}`}
              >
                {signatureType === 'efirma_sat' ? 'e.firma SAT' : signatureType === 'autografa_digital' ? 'Autógrafa' : 'Click & Sign'}
              </button>
            ))}
          </div>
        </div>
      )}

      {field.type === 'firma_efirma' && (
        <EfirmaField formToken={formToken} value={value} onChange={onChange} />
      )}

      {field.type === 'imagen' && (
        <FileUploadField
          accept="image/jpeg,image/jpg,image/png"
          maxSizeMB={2}
          label="Arrastra una imagen o haz clic para seleccionar (JPG/PNG, máx 2 MB)"
          value={value as string | null}
          onChange={onChange}
        />
      )}

      {field.type === 'documento' && (
        <FileUploadField
          accept="application/pdf"
          maxSizeMB={10}
          label="Arrastra un PDF o haz clic para seleccionar (máx 10 MB)"
          value={value as string | null}
          onChange={onChange}
        />
      )}

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  );
}

function EfirmaField({ formToken, value, onChange }: { formToken?: string; value: unknown; onChange: (value: unknown) => void }) {
  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const certificate = value && typeof value === 'object' ? value as Record<string, string> : null;

  const validate = async () => {
    if (!cerFile || !keyFile || !password) {
      setError('Selecciona los archivos .cer y .key e ingresa la contraseña.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [cerB64, keyB64] = await Promise.all([fileToBase64(cerFile), fileToBase64(keyFile)]);
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/validate-efirma`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
        },
        body: JSON.stringify({
          form_token: formToken,
          cer_b64: cerB64,
          key_b64: keyB64,
          password,
          session_evidence: { user_agent: navigator.userAgent, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo validar la e.firma.');
      onChange({
        validated: true,
        rfc: data.cert_rfc,
        holder: data.cert_subject,
        serial: data.cert_serial,
        validUntil: data.cert_not_after,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo validar la e.firma.');
    } finally {
      // Sensitive material is released after every attempt and is never sent to form state.
      setCerFile(null);
      setKeyFile(null);
      setPassword('');
      setLoading(false);
    }
  };

  if (certificate?.validated) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle size={16} /> Certificado validado</div>
        <dl className="mt-3 grid gap-2 text-xs text-emerald-800 sm:grid-cols-2">
          <div><dt className="text-emerald-600">RFC</dt><dd className="font-medium">{certificate.rfc || '—'}</dd></div>
          <div><dt className="text-emerald-600">No. de serie</dt><dd className="font-medium">{certificate.serial || '—'}</dd></div>
          <div className="sm:col-span-2"><dt className="text-emerald-600">Titular</dt><dd className="font-medium">{certificate.holder || '—'}</dd></div>
        </dl>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600"><FileKey2 size={17} /></span>
        <div><p className="text-sm font-semibold text-indigo-950">Validar e.firma SAT</p><p className="mt-1 text-xs leading-5 text-indigo-700">Los archivos y la contraseña se usan temporalmente en memoria y se descartan después de validar.</p></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-indigo-900">Certificado .cer</span><input type="file" accept=".cer" onChange={(event) => setCerFile(event.target.files?.[0] || null)} className="block w-full text-xs text-indigo-800 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-medium file:text-indigo-700" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-indigo-900">Llave privada .key</span><input type="file" accept=".key" onChange={(event) => setKeyFile(event.target.files?.[0] || null)} className="block w-full text-xs text-indigo-800 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-medium file:text-indigo-700" /></label>
      </div>
      <label className="block"><span className="mb-1 block text-xs font-medium text-indigo-900">Contraseña de la llave</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-10 w-full rounded-lg border border-indigo-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10" /></label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="button" onClick={validate} disabled={loading} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white disabled:opacity-50">{loading ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Validar certificado</button>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function FileUploadField({
  accept,
  maxSizeMB,
  label,
  value,
  onChange,
}: {
  accept: string;
  maxSizeMB: number;
  label: string;
  value: string | null;
  onChange: (v: unknown) => void;
}) {
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(value || null);
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setError('');
    if (file.size > maxSizeMB * 1024 * 1024) {
      setError(`El archivo supera el límite de ${maxSizeMB} MB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setPreview(result);
      setFileName(file.name);
      onChange(result);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div>
      {preview ? (
        <div className="flex items-center gap-3 p-3 border border-border rounded-xl bg-muted/30">
          {preview.startsWith('data:image') ? (
            <img src={preview} alt="Preview" className="w-12 h-12 object-cover rounded-lg" />
          ) : (
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center text-red-600 text-xs font-bold">PDF</div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{fileName}</p>
            <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11} /> Archivo cargado</p>
          </div>
          <button
            type="button"
            onClick={() => { setPreview(null); setFileName(''); onChange(null); }}
            className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
        >
          <Upload size={20} className="mx-auto mb-2 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{label}</p>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
