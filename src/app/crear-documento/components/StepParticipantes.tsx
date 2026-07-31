'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Users, User, UserCheck, UserPlus, Search, X, Mail, Smartphone, ChevronDown, CheckCircle2, Edit3, Eye, ShieldCheck, Bell, GripVertical, Trash2, BookUser } from 'lucide-react';
import { InfoTooltip, FavoriteSearchableSelect } from './SharedComponents';
import { createClient } from '@/lib/supabase/client';
import type { Participant, ParticipantMode } from './types';

const PARTICIPANT_OPTIONS: { id: ParticipantMode; icon: React.ReactNode; title: string; description: string }[] = [
  { id: 'solo_yo', icon: <User size={36} strokeWidth={1.5} />, title: 'Solo yo', description: 'Tú eres el único participante.' },
  { id: 'yo_y_otros', icon: <Users size={36} strokeWidth={1.5} />, title: 'Yo y otros', description: 'Tú y otros participantes.' },
  { id: 'solo_otros', icon: <UserCheck size={36} strokeWidth={1.5} />, title: 'Solo otros', description: 'Únicamente otros participantes.' },
];

const PARTICIPATION_ORDER_OPTIONS = [
  { id: 'paralelo', label: 'Paralelo', description: 'Todos los participantes reciben el documento al mismo tiempo y pueden participar sin esperar a los demás.' },
  { id: 'secuencial', label: 'Secuencial', description: 'El documento pasa de un participante al siguiente, en orden definido. Nadie puede participar fuera de turno.' },
  { id: 'mixto', label: 'Mixto', description: 'Combina grupos que participan en paralelo, pero esos grupos tienen un orden entre sí.' },
  { id: 'condicional', label: 'Condicional', description: 'La solicitud a un participante depende de que otro participe, rechace o apruebe antes.' },
];

// ─── Invite Form ──────────────────────────────────────────────────────────────

interface InviteFormData {
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  contactarPor: { correo: boolean; sms: boolean };
  correo: string;
  telefono: string;
  forzarRfc: boolean;
  rfc: string;
  forzarCurp: boolean;
  curp: string;
  tipoPersona: 'fisica' | 'moral';
  denominacion: string;
}

function InvitarParticipanteForm({ prefilledEmail, prefilledPhone, onBack, onSubmit }: { prefilledEmail: string; prefilledPhone: string; onBack: () => void; onSubmit: (data: InviteFormData) => void }) {
  const [form, setForm] = useState<InviteFormData>({
    nombre: '', apellidoPaterno: '', apellidoMaterno: '',
    contactarPor: { correo: !!prefilledEmail, sms: !!prefilledPhone },
    correo: prefilledEmail, telefono: prefilledPhone,
    forzarRfc: false, rfc: '', forzarCurp: false, curp: '',
    tipoPersona: 'fisica', denominacion: '',
  });
  const set = (field: keyof InviteFormData, value: unknown) => setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h2 className="text-base font-bold text-gray-900">Invitar a Participante</h2>
            <p className="text-xs text-gray-400 mt-0.5">Completa la información para invitar a un nuevo participante al documento.</p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Tipo de Persona */}
        <div>
          <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 mb-2">
            <User size={15} className="text-gray-500" />Tipo de Persona <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => set('tipoPersona', 'fisica')}
              className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${form.tipoPersona === 'fisica' ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
            >
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${form.tipoPersona === 'fisica' ? 'border-primary' : 'border-gray-300'}`}>
                {form.tipoPersona === 'fisica' && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
              <div className="text-left">
                <p className="font-semibold">Persona Física</p>
                <p className="text-xs font-normal text-gray-400">Individuo natural</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => set('tipoPersona', 'moral')}
              className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${form.tipoPersona === 'moral' ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
            >
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${form.tipoPersona === 'moral' ? 'border-primary' : 'border-gray-300'}`}>
                {form.tipoPersona === 'moral' && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
              <div className="text-left">
                <p className="font-semibold">Persona Moral</p>
                <p className="text-xs font-normal text-gray-400">Empresa u organización</p>
              </div>
            </button>
          </div>
        </div>

        {/* Denominación o Razón Social — solo para Persona Moral */}
        {form.tipoPersona === 'moral' && (
          <div>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 mb-2">
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="text-gray-500"><rect x="2" y="7" width="20" height="14" rx="2" strokeWidth="2"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
              Denominación o Razón Social <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.denominacion}
              onChange={(e) => set('denominacion', e.target.value.toUpperCase())}
              placeholder="Ej: EMPRESA EJEMPLO S.A. DE C.V."
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-gray-300 uppercase"
            />
            <p className="text-xs text-gray-400 mt-1.5">Nombre legal de la empresa u organización.</p>
          </div>
        )}

        {form.tipoPersona === 'fisica' && (
        <div>
          <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 mb-2"><User size={15} className="text-gray-500" />
            Nombre completo <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              value={form.nombre}
              onChange={(e) => set('nombre', e.target.value.toUpperCase())}
              placeholder="Nombre"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-gray-300 uppercase"
            />
            <input
              type="text"
              value={form.apellidoPaterno}
              onChange={(e) => set('apellidoPaterno', e.target.value.toUpperCase())}
              placeholder="Apellido paterno"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-gray-300 uppercase"
            />
            <input
              type="text"
              value={form.apellidoMaterno}
              onChange={(e) => set('apellidoMaterno', e.target.value.toUpperCase())}
              placeholder="Apellido materno"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-gray-300 uppercase"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">Ej: Juan Pérez García</p>
        </div>
        )}
        <div>
          <label className="text-sm font-semibold text-gray-800 mb-2 block">Contactar por <span className="text-red-500">*</span></label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.contactarPor.correo} onChange={(e) => set('contactarPor', { ...form.contactarPor, correo: e.target.checked })} className="w-4 h-4 rounded accent-primary" />
              <span className="text-sm text-gray-700">Correo electrónico</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.contactarPor.sms} onChange={(e) => set('contactarPor', { ...form.contactarPor, sms: e.target.checked })} className="w-4 h-4 rounded accent-primary" />
              <span className="text-sm text-gray-700">SMS</span>
            </label>
          </div>
        </div>
        {form.contactarPor.correo && (
          <div>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 mb-2"><Mail size={15} className="text-gray-500" />Correo electrónico <span className="text-red-500">*</span></label>
            <input type="email" value={form.correo} onChange={(e) => set('correo', e.target.value)} placeholder="ejemplo@correo.com" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-gray-300" />
          </div>
        )}
        {form.contactarPor.sms && (
          <div>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 mb-2"><Smartphone size={15} className="text-gray-500" />Número de teléfono <span className="text-red-500">*</span></label>
            <input type="tel" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} placeholder="+52 55 1234 5678" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-gray-300" />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-gray-800">Forzar identidad del participante (opcional)</span>
            <InfoTooltip text="Puedes requerir que el participante tenga un RFC o CURP específico para firmar el documento." />
          </div>
          <div className="mb-3">
            <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
              <input type="checkbox" checked={form.forzarRfc} onChange={(e) => set('forzarRfc', e.target.checked)} className="w-4 h-4 rounded accent-primary" />
              <span className="text-sm text-gray-700">Añadir RFC</span>
            </label>
            {form.forzarRfc && (
              <div className="ml-6">
                <label className="text-xs font-medium text-gray-600 mb-1 block">RFC del participante <span className="text-red-500">*</span></label>
                <input type="text" value={form.rfc} onChange={(e) => set('rfc', e.target.value.toUpperCase())} placeholder="Escribe el RFC" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-gray-300" />
              </div>
            )}
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
              <input type="checkbox" checked={form.forzarCurp} onChange={(e) => set('forzarCurp', e.target.checked)} className="w-4 h-4 rounded accent-primary" />
              <span className="text-sm text-gray-700">Añadir CURP</span>
            </label>
            {form.forzarCurp && (
              <div className="ml-6">
                <label className="text-xs font-medium text-gray-600 mb-1 block">CURP del participante <span className="text-red-500">*</span></label>
                <input type="text" value={form.curp} onChange={(e) => set('curp', e.target.value.toUpperCase())} placeholder="Escribe la CURP" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-gray-300" />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="px-6 py-4 border-t border-gray-100 shrink-0">
        <button type="button" onClick={() => onSubmit(form)} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
          <UserPlus size={16} />Siguiente: Configurar participante
        </button>
      </div>
    </div>
  );
}

// ─── Configurar Participación Modal ──────────────────────────────────────────

function ConfigurarParticipacionModal({ participant, onClose, onSave, isCurrentUser = false, userId, soloYo = false }: { participant: Participant; onClose: () => void; onSave: (updated: Participant) => void; isCurrentUser?: boolean; userId?: string; soloYo?: boolean }) {
  const [nombreCompleto, setNombreCompleto] = useState(participant.name || '');
  const [correo, setCorreo] = useState(participant.email || '');
  const [telefono, setTelefono] = useState(participant.phone || '');
  // In soloYo mode, acto is always 'Firmante'
  const [acto, setActo] = useState(soloYo ? 'Firmante' : (participant.acto || ''));
  const [rolDocumento, setRolDocumento] = useState('');
  const [rolOtro, setRolOtro] = useState('');
  const [tipoFirma, setTipoFirma] = useState<string[]>(participant.tipoFirma || []);
  const [tipoNotificacion, setTipoNotificacion] = useState<string[]>(participant.tipoNotificacion || []);
  const [actoDropdownOpen, setActoDropdownOpen] = useState(false);
  const [rolesDocumento, setRolesDocumento] = useState<{ id: string; nombre: string }[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [enviarMensaje, setEnviarMensaje] = useState(!!participant.mensajePersonalizado);
  const [mensajePersonalizado, setMensajePersonalizado] = useState(participant.mensajePersonalizado || '');

  useEffect(() => {
    const loadRoles = async () => {
      setRolesLoading(true);
      try {
        const res = await fetch('/api/documentos/roles');
        const data = await res.json();
        if (data.data) {
          setRolesDocumento(data.data);
          if (participant.rolDocumento) {
            const matched = data.data.find((r: { id: string; nombre: string }) => r.nombre === participant.rolDocumento);
            if (matched) {
              setRolDocumento(matched.id);
            } else {
              setRolDocumento('__otro__');
              setRolOtro(participant.rolDocumento);
            }
          } else {
            setRolDocumento('');
          }
        }
      } catch { /* silently fail */ }
      finally { setRolesLoading(false); }
    };
    loadRoles();
  }, [participant.rolDocumento]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const ACTO_OPTIONS = [
    { value: 'Firmante', label: 'Firmante', description: 'Usuario firmará el documento.', icon: <Edit3 size={18} className="text-primary" /> },
    { value: 'Observador', label: 'Observador', description: 'Usuario solo mirará el documento.', icon: <Eye size={18} className="text-primary" /> },
    { value: 'Aprobador', label: 'Aprobador', description: 'Aprueba o rechaza el documento.', icon: <CheckCircle2 size={18} className="text-primary" /> },
  ];
  const FIRMA_OPTIONS = [
    { id: 'autografa', label: 'Firma Autógrafa Digital', icon: <Edit3 size={15} className="text-gray-400" /> },
    { id: 'efirma', label: 'e-Firma SAT', icon: <ShieldCheck size={15} className="text-gray-400" /> },
    { id: 'click_sign', label: 'Click & sign', icon: <CheckCircle2 size={15} className="text-gray-400" /> },
  ];
  const NOTIF_OPTIONS = [
    { id: 'docubox', label: 'Notificación en Docubox', icon: <Bell size={15} className="text-gray-400" /> },
    { id: 'correo', label: 'Correo electrónico', icon: <Mail size={15} className="text-gray-400" /> },
    { id: 'sms', label: 'Mensaje SMS', icon: <Smartphone size={15} className="text-gray-400" /> },
    { id: 'whatsapp', label: 'WhatsApp', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-gray-400"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> },
  ];

  const toggleFirma = (id: string) => setTipoFirma((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleNotif = (id: string) => setTipoNotificacion((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleSave = () => {
    const resolvedRolLabel = rolDocumento === '__otro__' ? rolOtro.trim() : (rolesDocumento.find((r) => r.id === rolDocumento)?.nombre || rolDocumento);
    onSave({
      ...participant,
      name: isCurrentUser ? participant.name : nombreCompleto,
      email: isCurrentUser ? participant.email : correo,
      phone: isCurrentUser ? participant.phone : telefono,
      acto,
      rolDocumento: resolvedRolLabel,
      tipoFirma,
      tipoNotificacion,
      mensajePersonalizado: enviarMensaje ? mensajePersonalizado : '',
      configured: true,
    });
    onClose();
  };

  const isRolValid = rolDocumento !== '' && (rolDocumento !== '__otro__' || rolOtro.trim() !== '');
  const isFirmante = acto === 'Firmante';
  // If Firmante: must have at least 1 tipo de firma AND 1 tipo de notificación
  // For all actos: rol en documento is required
  const canSave = isRolValid && acto !== '' && (!isFirmante || (tipoFirma.length > 0 && tipoNotificacion.length > 0));

  // Validation messages
  const validationErrors: string[] = [];
  if (!acto) validationErrors.push('Selecciona el acto del participante.');
  if (!isRolValid) validationErrors.push('El campo Rol en el documento es obligatorio.');
  if (isFirmante && tipoFirma.length === 0) validationErrors.push('Selecciona al menos un Tipo de Firma.');
  if (isFirmante && tipoNotificacion.length === 0) validationErrors.push('Selecciona al menos un Tipo de Notificación.');

  // Build options for FavoriteSearchableSelect: roles + "Otro"
  const rolOptions = [
    ...rolesDocumento.map((r) => ({ id: r.id, label: r.nombre })),
    { id: '__otro__', label: 'Otro' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] overflow-y-auto flex flex-col">
        <div className="flex items-start justify-between p-6 pb-4 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{isCurrentUser ? 'Configurar mi participación' : 'Configurar Participante'}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ml-4 flex-shrink-0"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 space-y-5">
          {/* Participant card - only for non-current-user */}
          {!isCurrentUser && (
            <div className={`border rounded-xl p-4 flex items-center gap-4 ${participant.isNewUser ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
              <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${participant.isNewUser ? 'bg-amber-100' : 'bg-green-100'}`}>
                <UserPlus size={20} className={participant.isNewUser ? 'text-amber-600' : 'text-green-600'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">
                  {participant.tipoPersona === 'moral' && participant.denominacion
                    ? participant.denominacion
                    : (participant.name || '—')}
                </p>
                {participant.tipoPersona === 'moral' && participant.denominacion ? (
                  <>
                    {participant.email && <p className="text-sm text-gray-500 truncate">{participant.email}</p>}
                    {participant.phone && <p className="text-sm text-gray-500 truncate">{participant.phone}</p>}
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-500 truncate">{participant.email || '—'}</p>
                    {participant.phone && <p className="text-sm text-gray-500 truncate">{participant.phone}</p>}
                  </>
                )}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${participant.isNewUser ? 'bg-amber-200 text-amber-800' : 'bg-green-200 text-green-800'}`}>
                    {participant.isNewUser ? 'Usuario nuevo' : 'Usuario registrado'}
                  </span>
                  {participant.tipoPersona && (
                    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${participant.tipoPersona === 'moral' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                      {participant.tipoPersona === 'moral' ? 'Persona Moral' : 'Persona Física'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* Acto del participante */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Acto del participante <span className="text-red-500">*</span></label>
            {soloYo ? (
              // In Solo yo mode: locked as Firmante, inactive
              <div className="w-full flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2.5 bg-gray-50 opacity-70 cursor-not-allowed select-none">
                <Edit3 size={18} className="text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-800">Firmante</p>
                  <p className="text-xs text-gray-500">Usuario firmará el documento.</p>
                </div>
                <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">Fijo</span>
              </div>
            ) : (
            <div className="relative">
              <button type="button" onClick={() => setActoDropdownOpen((prev) => !prev)} className="w-full flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white hover:bg-gray-50 transition-colors">
                <span className={acto ? "text-gray-700" : "text-gray-400"}>{acto || 'Selecciona un acto'}</span>
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${actoDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {actoDropdownOpen && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                  {ACTO_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => { setActo(opt.value); setActoDropdownOpen(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${acto === opt.value ? 'bg-primary/5' : ''}`}>
                      {opt.icon}
                      <div>
                        <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                        <p className="text-xs text-gray-500">{opt.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
          {/* Rol en el documento — FavoriteSearchableSelect */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Rol en el documento <span className="text-red-500">*</span></label>
            {rolesLoading ? (
              <div className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-400 bg-gray-50 flex items-center gap-2">
                <svg className="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                Cargando roles...
              </div>
            ) : (
              <FavoriteSearchableSelect
                options={rolOptions}
                value={rolDocumento}
                onChange={(id) => { setRolDocumento(id); if (id !== '__otro__') setRolOtro(''); }}
                placeholder="Seleccione o cree un rol..."
                storageKey="fav_roles_documento"
                userId={userId}
              />
            )}
            {rolDocumento === '__otro__' && (
              <div className="mt-2">
                <input type="text" value={rolOtro} onChange={(e) => setRolOtro(e.target.value)} placeholder="Especifica el rol en el documento..." className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" autoFocus />
              </div>
            )}
          </div>
          {/* Tipo de Firma + Tipo de Notificación */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-3">
                Tipo de Firma <span className="text-red-500">*</span>
              </p>
              {acto && acto !== 'Firmante' ? (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-400">
                  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="shrink-0"><circle cx="12" cy="12" r="10" strokeWidth="2"/><line x1="12" y1="8" x2="12" y2="12" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="2" strokeLinecap="round"/></svg>
                  No aplica para {acto}
                </div>
              ) : (
                <div className="space-y-2">
                  {FIRMA_OPTIONS.map((opt) => (
                    <label key={opt.id} className={`flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-2.5 transition-colors ${!acto ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary/40 hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={tipoFirma.includes(opt.id)} onChange={() => acto === 'Firmante' && toggleFirma(opt.id)} disabled={!acto} className="w-4 h-4 accent-primary rounded" />
                      {opt.icon}<span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-3">Tipo de Notificación <span className="text-red-500">*</span></p>
              <div className="space-y-2">
                {NOTIF_OPTIONS.map((opt) => (
                  <label key={opt.id} className="flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-2.5 cursor-pointer hover:border-primary/40 hover:bg-gray-50 transition-colors">
                    <input type="checkbox" checked={tipoNotificacion.includes(opt.id)} onChange={() => toggleNotif(opt.id)} className="w-4 h-4 accent-primary rounded" />
                    {opt.icon}<span className="text-sm text-gray-700">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          {/* Enviar mensaje personalizado */}
          {!isCurrentUser && (
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={enviarMensaje} onChange={(e) => setEnviarMensaje(e.target.checked)} className="w-4 h-4 accent-primary rounded border-gray-300" />
                <span className="text-sm text-gray-700">Enviar mensaje personalizado al participante</span>
              </label>
              {enviarMensaje && (
                <textarea
                  value={mensajePersonalizado}
                  onChange={(e) => setMensajePersonalizado(e.target.value)}
                  placeholder="Escribe un mensaje personalizado para este participante..."
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-gray-300 resize-none"
                />
              )}
            </div>
          )}
          {/* Actions */}
          <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
            {!canSave && validationErrors.length > 0 && (
              <div className="flex flex-col gap-1 px-1">
                {validationErrors.map((err, i) => (
                  <p key={i} className="text-xs text-red-500 flex items-center gap-1.5">
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="shrink-0"><circle cx="12" cy="12" r="10" strokeWidth="2"/><line x1="12" y1="8" x2="12" y2="12" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="2" strokeLinecap="round"/></svg>
                    {err}
                  </p>
                ))}
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button onClick={onClose} className="px-5 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
              <button onClick={handleSave} disabled={!canSave} className="px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Guardar Configuración</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Añadir Participantes Modal ───────────────────────────────────────────────

function AñadirParticipantesModal({ onClose, onAdd, existingParticipants, currentUserId, currentUserEmail, mode, onAddNew, startWithInvite }: { onClose: () => void; onAdd: (participant: Participant) => void; existingParticipants: Participant[]; currentUserId?: string; currentUserEmail?: string; mode?: ParticipantMode; onAddNew?: () => void; startWithInvite?: boolean }) {
  const [activeTab, setActiveTab] = useState<'contactos' | 'buscar'>('contactos');
  const [contactSearch, setContactSearch] = useState('');
  const [platformSearch, setPlatformSearch] = useState('');
  const [platformResults, setPlatformResults] = useState<Participant[]>([]);
  const [platformSearched, setPlatformSearched] = useState(false);
  const [searchCriteria, setSearchCriteria] = useState<'correo' | 'telefono' | 'rfc' | 'curp'>('correo');
  const [criteriaDropdownOpen, setCriteriaDropdownOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(startWithInvite ?? false);
  const [contacts, setContacts] = useState<Participant[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load contacts from Supabase
  useEffect(() => {
    const loadContacts = async () => {
      setContactsLoading(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setContactsLoading(false); return; }
        const { data } = await supabase
          .from('contacts')
          .select('id, nombre, apellido_paterno, apellido_materno, email, telefono')
          .eq('user_id', user.id)
          .order('nombre', { ascending: true });
        if (data) {
          const mapped: Participant[] = data.map((c: { id: string; nombre: string; apellido_paterno: string | null; apellido_materno: string | null; email: string | null; telefono: string | null }) => ({
            id: `contact-${c.id}`,
            name: [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' '),
            email: c.email || '',
            phone: c.telefono || undefined,
            role: 'firmante' as const,
          }));
          setContacts(mapped);
        }
      } catch { /* silent */ }
      finally { setContactsLoading(false); }
    };
    loadContacts();
  }, []);

  const filteredContacts = contacts.filter((c) => c.name.toLowerCase().includes(contactSearch.toLowerCase()) || c.email.toLowerCase().includes(contactSearch.toLowerCase()));

  const performSearch = async (query: string, criteria: string) => {
    if (!query.trim()) { setPlatformResults([]); setPlatformSearched(false); setIsSearching(false); return; }
    setIsSearching(true); setPlatformSearched(true);
    try {
      const res = await fetch(`/api/documentos/buscar-participante?q=${encodeURIComponent(query.trim())}&criteria=${criteria}`);
      const data = await res.json();
      if (data.users) {
        const mapped: Participant[] = data.users.map((u: { id: string; full_name: string; email: string }) => ({ id: u.id, name: u.full_name || u.email, email: u.email, role: 'firmante' as const }));
        setPlatformResults(mapped);
      } else { setPlatformResults([]); }
    } catch { setPlatformResults([]); }
    finally { setIsSearching(false); }
  };

  const handlePlatformSearch = () => { if (debounceRef.current) clearTimeout(debounceRef.current); performSearch(platformSearch, searchCriteria); };

  const handleAddContact = (p: Participant) => {
    const alreadyAdded = existingParticipants.some((ep) => ep.id === p.id || (ep.email && ep.email === p.email));
    if (alreadyAdded) return;
    // Block current user in solo_otros mode
    if (mode === 'solo_otros' && (p.id === currentUserId || (currentUserEmail && p.email && p.email.toLowerCase() === currentUserEmail.toLowerCase()))) return;
    onAdd({ ...p, id: p.id.startsWith('search-') ? `participant-${Date.now()}` : p.id });
    onClose();
  };

  const handleInviteFormSubmit = (data: InviteFormData) => {
    const fullName = [data.nombre, data.apellidoPaterno, data.apellidoMaterno].filter(Boolean).join(' ');
    // Map contactarPor checkboxes → tipoNotificacion array used by the email/SMS sending logic
    const tipoNotificacion: string[] = [];
    if (data.contactarPor.correo) tipoNotificacion.push('correo');
    if (data.contactarPor.sms) tipoNotificacion.push('sms');
    const newParticipant: Participant = {
      id: `invited-${Date.now()}`,
      name: data.tipoPersona === 'moral' ? (data.denominacion || data.correo || data.telefono || 'Nuevo participante') : (fullName || data.correo || data.telefono || 'Nuevo participante'),
      email: data.correo,
      phone: data.telefono,
      role: 'firmante',
      isNewUser: true,
      tipoPersona: data.tipoPersona,
      denominacion: data.tipoPersona === 'moral' ? data.denominacion : undefined,
      tipoNotificacion,
    };
    // Save to unregistered_participants table in Supabase
    const saveUnregistered = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const { data: wsData } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', user?.id)
          .maybeSingle();
        await supabase.from('unregistered_participants').insert({
          invited_by: user?.id ?? null,
          workspace_id: wsData?.workspace_id ?? null,
          nombre: data.nombre,
          apellido_paterno: data.apellidoPaterno || null,
          apellido_materno: data.apellidoMaterno || null,
          email: data.correo || null,
          telefono: data.telefono || null,
          rfc: data.rfc || null,
          curp: data.curp || null,
          tipo_persona: data.tipoPersona,
          denominacion_razon_social: data.tipoPersona === 'moral' ? (data.denominacion || null) : null,
        });
      } catch { /* silent — don't block the flow */ }
    };
    saveUnregistered();
    onAdd(newParticipant); onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => { return () => { if (debounceRef.current) clearTimeout(debounceRef.current); }; }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[680px] overflow-hidden flex flex-col">
        {showInviteForm ? (
          <InvitarParticipanteForm prefilledEmail={searchCriteria === 'correo' ? platformSearch : ''} prefilledPhone={searchCriteria === 'telefono' ? platformSearch : ''} onBack={() => setShowInviteForm(false)} onSubmit={handleInviteFormSubmit} />
        ) : (
          <>
            <div className="flex items-start justify-between p-6 pb-4 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Añadir Participantes</h2>
                <p className="text-sm text-gray-400 mt-0.5">Selecciona un contacto o busca un usuario para configurar su participación.</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ml-4 flex-shrink-0"><X size={18} /></button>
            </div>
            <div className="px-6 shrink-0">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                <button onClick={() => setActiveTab('contactos')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors border-r border-gray-200 ${activeTab === 'contactos' ? 'bg-primary text-white' : 'bg-white text-gray-900 hover:bg-gray-50'}`}>
                  <Users size={16} />Mis Contactos
                </button>
                <button onClick={() => setActiveTab('buscar')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${activeTab === 'buscar' ? 'bg-primary text-white' : 'bg-white text-gray-900 hover:bg-gray-50'}`}>
                  <Search size={16} />Buscar Participante
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {activeTab === 'contactos' && (
                <div className="flex flex-col gap-4">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} placeholder="Buscar en mis contactos..." className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  {contactsLoading ? (
                    <div className="flex items-center justify-center py-10 gap-2 text-sm text-gray-400">
                      <svg className="w-5 h-5 animate-spin text-primary" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                      <span>Cargando contactos...</span>
                    </div>
                  ) : filteredContacts.length > 0 ? (
                    <ul className="space-y-2">
                      {filteredContacts.map((c) => (
                        <li key={c.id} className="flex items-center justify-between px-4 py-3 border border-gray-200 rounded-lg hover:border-primary/40 hover:bg-gray-50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"><User size={16} className="text-primary" /></div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{(c.name || '(sin nombre)').toUpperCase()}</p>
                              <p className="text-xs text-gray-400">{c.email}</p>
                            </div>
                          </div>
                          <button onClick={() => handleAddContact(c)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors">
                            <UserPlus size={13} />Agregar
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 gap-4">
                      <p className="text-sm text-gray-400 text-center">No tienes contactos. Intenta buscar en la plataforma.</p>
                      <button onClick={() => setActiveTab('buscar')} className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                        <UserPlus size={15} />Buscar en la plataforma
                      </button>
                    </div>
                  )}
                </div>
              )}
              {activeTab === 'buscar' && (
                <div className="flex flex-col gap-4">
                  {mode === 'solo_otros' && (
                    <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                      <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 5.133a4 4 0 00-1.732-3z" /></svg>
                      <span>En modo <strong>Solo otros</strong> no puedes agregarte como participante.</span>
                    </div>
                  )}
                  <div className="flex gap-2 relative">
                    <div className="relative">
                      <button type="button" onClick={() => setCriteriaDropdownOpen((o) => !o)} className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors min-w-[120px] justify-between">
                        <span>
                          {searchCriteria === 'correo' && 'Correo Electrónico'}
                          {searchCriteria === 'telefono' && 'Teléfono'}
                          {searchCriteria === 'rfc' && 'RFC'}
                          {searchCriteria === 'curp' && 'CURP'}
                        </span>
                        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {criteriaDropdownOpen && (
                        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                          {([
                            { value: 'correo', label: 'Correo Electrónico' },
                            { value: 'telefono', label: 'Teléfono' },
                            { value: 'rfc', label: 'RFC' },
                            { value: 'curp', label: 'CURP' },
                          ] as { value: 'correo' | 'telefono' | 'rfc' | 'curp'; label: string }[]).map((opt) => (
                            <button key={opt.value} type="button" onClick={() => { setSearchCriteria(opt.value); setCriteriaDropdownOpen(false); setPlatformSearch(''); setPlatformSearched(false); setPlatformResults([]); }}
                              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors ${searchCriteria === opt.value ? 'bg-primary/5' : ''}`}>
                              {searchCriteria === opt.value && <svg className="w-4 h-4 text-gray-700 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                              {searchCriteria !== opt.value && <span className="w-4 flex-shrink-0" />}
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input
                      type={searchCriteria === 'correo' ? 'email' : 'text'}
                      value={platformSearch}
                      onChange={(e) => {
                        let val = e.target.value;
                        if (searchCriteria === 'curp') {
                          val = val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
                        } else if (searchCriteria === 'rfc') {
                          val = val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 13);
                        } else if (searchCriteria === 'telefono') {
                          val = val.replace(/\D/g, '').slice(0, 10);
                        }
                        setPlatformSearch(val);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && handlePlatformSearch()}
                      maxLength={searchCriteria === 'curp' ? 18 : searchCriteria === 'rfc' ? 13 : searchCriteria === 'telefono' ? 10 : undefined}
                      placeholder={
                        searchCriteria === 'correo' ? 'ejemplo@correo.com' :
                        searchCriteria === 'telefono' ? '5512345678' :
                        searchCriteria === 'rfc' ? 'AAAA000000AAA' :'AAAA000000XXXXXXXX'
                      }
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    <button onClick={handlePlatformSearch} className="px-3.5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center">
                      {isSearching ? (<svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>) : (<Search size={16} />)}
                    </button>
                  </div>
                  {!platformSearched ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 5.133a4 4 0 00-1.732-3z" /></svg>
                      <span>Realiza una búsqueda para encontrar participantes en la plataforma.</span>
                    </div>
                  ) : isSearching ? (
                    <div className="flex items-center justify-center py-10 gap-2 text-sm text-gray-400">
                      <svg className="w-5 h-5 animate-spin text-primary" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                      <span>Buscando...</span>
                    </div>
                  ) : platformResults.length > 0 ? (
                    <ul className="space-y-2">
                      {platformResults.map((r) => {
                        const alreadyAdded = existingParticipants.some((ep) => ep.id === r.id || (ep.email && ep.email === r.email));
                        const isCurrentUser = mode === 'solo_otros' && (r.id === currentUserId || (currentUserEmail && r.email && r.email.toLowerCase() === currentUserEmail.toLowerCase()));
                        return (
                          <li key={r.id} className={`flex items-center justify-between px-4 py-3 border rounded-lg transition-colors ${alreadyAdded || isCurrentUser ? 'border-amber-200 bg-amber-50' : 'border-gray-200 hover:border-primary/40 hover:bg-gray-50'}`}>
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${alreadyAdded || isCurrentUser ? 'bg-amber-100' : 'bg-primary/10'}`}><User size={16} className={alreadyAdded || isCurrentUser ? 'text-amber-500' : 'text-primary'} /></div>
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{(r.name || '(sin nombre)').toUpperCase()}</p>
                                <p className="text-xs text-gray-400">{r.email}</p>
                              </div>
                            </div>
                            {alreadyAdded ? (
                              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-lg border border-amber-200">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                                Ya agregado
                              </span>
                            ) : isCurrentUser ? (
                              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-lg border border-amber-200">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                                No permitido
                              </span>
                            ) : (
                              <button onClick={() => handleAddContact({ ...r, isNewUser: false })} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors">
                                <UserPlus size={13} />Agregar
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                      <p className="text-sm text-gray-400 text-center">No se encontró ningún usuario con ese criterio.</p>
                      <button type="button" onClick={() => setShowInviteForm(true)} className="flex items-center gap-2 px-5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                        <UserPlus size={16} className="text-gray-600" />Invitar como nuevo participante
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Step 2: Participantes ────────────────────────────────────────────────────

export function StepParticipantes({ participants, onChange, mode, onModeChange, onOrderChange, participationOrder: participationOrderProp = '', vencimientoSolicitudEnabled = false }: { participants: Participant[]; onChange: (p: Participant[]) => void; mode: ParticipantMode; onModeChange: (m: ParticipantMode) => void; onOrderChange?: (order: string) => void; participationOrder?: string; vencimientoSolicitudEnabled?: boolean }) {
  const [participationOrder, setParticipationOrder] = useState(participationOrderProp);
  const [orderDropdownOpen, setOrderDropdownOpen] = useState(false);
  const [configuringParticipant, setConfiguringParticipant] = useState<Participant | null>(null);
  const [añadirParticipantesOpen, setAñadirParticipantesOpen] = useState(false);
  const [openInviteDirectly, setOpenInviteDirectly] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | undefined>(undefined);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const dragIndexRef = useRef<number | null>(null);

  // Load userId once on mount
  useEffect(() => {
    const loadUser = async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) setUserId(session.user.id);
      if (session?.user?.email) setCurrentUserEmail(session.user.email);
      if (session?.user) {
        // Try to get full name from user_profiles first, then fall back to user_metadata
        let resolvedName = '';
        try {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('nombre, apellido_paterno, apellido_materno')
            .eq('id', session.user.id)
            .maybeSingle();
          if (profile) {
            const fullName = [profile.nombre, profile.apellido_paterno, profile.apellido_materno]
              .filter(Boolean)
              .join(' ')
              .toUpperCase();
            if (fullName.trim()) {
              resolvedName = fullName.trim();
            }
          }
        } catch { /* silent */ }
        // Fallback to user_metadata full_name
        if (!resolvedName) {
          const metaName = session.user.user_metadata?.full_name as string | undefined;
          if (metaName) {
            resolvedName = metaName.toUpperCase();
          } else if (session.user.email) {
            resolvedName = session.user.email;
          }
        }
        setCurrentUserName(resolvedName);
        // Update existing current-user participant in the list if already added
        if (resolvedName) {
          onChange(
            participants.map((p) => {
              if (p.id === 'current-user') {
                const displayName = `${resolvedName} (Tú)`;
                return { ...p, name: displayName };
              }
              return p;
            })
          );
        }
      }
    };
    loadUser();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSecuencial = participationOrder === 'secuencial';

  const handleModeChange = (newMode: ParticipantMode) => {
    onModeChange(newMode);
    const creatorName = currentUserName
      ? `${currentUserName} (Tú)`
      : currentUserEmail
      ? `${currentUserEmail} (Tú)`
      : '(Tú)';
    const creatorEmail = currentUserEmail || '';
    if (newMode === 'solo_yo') {
      onChange([{ id: 'current-user', name: creatorName, email: creatorEmail, role: 'firmante' }]);
      setParticipationOrder('paralelo');
      onOrderChange?.('paralelo');
    } else if (newMode === 'yo_y_otros') {
      onChange([{ id: 'current-user', name: creatorName, email: creatorEmail, role: 'firmante' }]);
      setParticipationOrder('');
      onOrderChange?.('');
    } else {
      onChange([]);
      setParticipationOrder('');
      onOrderChange?.('');
    }
  };

  const handleSaveConfig = (updated: Participant) => onChange(participants.map((p) => p.id === updated.id ? updated : p));

  const handleAddParticipant = (p: Participant) => {
    onChange([...participants, p]);
    setAñadirParticipantesOpen(false);
    if (p.id !== 'current-user') {
      setConfiguringParticipant(p);
    }
  };

  const handleRemoveParticipant = (id: string) => {
    onChange(participants.filter((p) => p.id !== id));
  };

  // Drag & drop handlers
  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragOverIndex(null);
      dragIndexRef.current = null;
      return;
    }
    const reordered = [...participants];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    onChange(reordered);
    setDragOverIndex(null);
    dragIndexRef.current = null;
  };

  const handleDragEnd = () => {
    setDragOverIndex(null);
    dragIndexRef.current = null;
  };

  const handleRegisterContact = async (participant: Participant) => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const nameParts = (participant.name || '').trim().split(' ');
      const nombre = nameParts[0] || '';
      const apellidoPaterno = nameParts[1] || null;
      const apellidoMaterno = nameParts.slice(2).join(' ') || null;
      await supabase.from('contacts').upsert({
        user_id: user.id,
        nombre,
        apellido_paterno: apellidoPaterno,
        apellido_materno: apellidoMaterno,
        email: participant.email || null,
        telefono: participant.phone || null,
      }, { onConflict: 'user_id,email' });
      // Mark participant as saved contact
      onChange(participants.map((p) => p.id === participant.id ? { ...p, savedAsContact: true } : p));
    } catch { /* silent */ }
  };

  const selectedOption = PARTICIPANT_OPTIONS.find((o) => o.id === mode);

  return (
    <div className="w-full">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">¿Quién va a participar?</h1>
        <p className="text-gray-500">Configura los participantes y sus roles en el documento.</p>
      </div>
      {!mode && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {PARTICIPANT_OPTIONS.map((option) => (
              <button key={option.id} onClick={() => handleModeChange(option.id)} className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-gray-200 bg-white hover:border-primary/40 hover:bg-gray-50 transition-all cursor-pointer text-center">
                <span className="text-gray-700">{option.icon}</span>
                <span className="text-sm font-bold text-gray-900">{option.title}</span>
                <span className="text-xs text-gray-500">{option.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {mode && (
        <div className="grid gap-6" style={{ gridTemplateColumns: '30% 70%' }}>
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm h-fit">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">Configuración</h2>
            <div className="border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <User size={20} className="text-primary" />
                <div>
                  <p className="text-xs text-gray-400">Modo seleccionado</p>
                  <p className="text-sm font-semibold text-gray-900">{selectedOption?.title}</p>
                </div>
              </div>
              <button onClick={() => { onModeChange(null); onChange([]); }} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-primary hover:bg-primary/5 transition-colors" title="Cambiar modo">
                <Edit3 size={15} />
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Orden de Participación *</label>
              <div className="relative">
                <button type="button" onClick={() => mode !== 'solo_yo' && setOrderDropdownOpen((v) => !v)} disabled={mode === 'solo_yo'}
                  className={`appearance-none w-full border border-gray-200 rounded-lg px-3 py-2.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 flex items-center justify-between ${mode === 'solo_yo' ? 'border-gray-200 opacity-60 cursor-not-allowed bg-gray-50 text-gray-500' : 'border-gray-200 hover:border-gray-300 cursor-pointer text-gray-500'}`}>
                  <span className={participationOrder ? 'text-gray-800' : 'text-gray-400'}>{PARTICIPATION_ORDER_OPTIONS.find((o) => o.id === participationOrder)?.label ?? 'Seleccione una opción...'}</span>
                  <ChevronDown size={14} className={`text-gray-400 transition-transform ${orderDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {orderDropdownOpen && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    {PARTICIPATION_ORDER_OPTIONS.filter((o) => (mode === 'solo_yo' ? o.id === 'paralelo' : true) && o.id !== 'condicional').map((o) => (
                      <button key={o.id} type="button" onClick={() => { setParticipationOrder(o.id); onOrderChange?.(o.id); setOrderDropdownOpen(false); }}
                        className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors border-b border-gray-100 ${participationOrder === o.id ? 'bg-blue-50' : ''}`}>
                        <div className="text-sm font-semibold text-gray-800">{o.label}</div>
                        <div className="text-xs text-gray-500 mt-0.5 leading-snug">{o.description}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Lista de Participantes</h2>

            {/* Sequential drag hint banner */}
            {isSecuencial && (
              <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-600 font-medium">
                Arrastra y suelta para cambiar el orden de participación.
              </div>
            )}

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    {isSecuencial && (
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 w-16">Orden</th>
                    )}
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Nombre</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Acto/Rol</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Rol</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Tipo de Firma</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Tipo de Notificación</th>
                    {vencimientoSolicitudEnabled && (
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Vencimiento participación</th>
                    )}
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Configuración</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.length === 0 ? (
                    <tr>
                      <td colSpan={isSecuencial ? (vencimientoSolicitudEnabled ? 9 : 8) : (vencimientoSolicitudEnabled ? 8 : 7)} className="px-4 py-8 text-center text-sm text-gray-400">No hay participantes agregados.</td>
                    </tr>
                  ) : (
                    participants.map((p, index) => (
                      <tr
                        key={p.id}
                        className={`border-b border-gray-200 last:border-0 transition-colors ${isSecuencial ? 'cursor-grab active:cursor-grabbing' : ''} ${dragOverIndex === index && isSecuencial ? 'bg-blue-50 border-blue-300' : ''}`}
                        draggable={isSecuencial}
                        onDragStart={isSecuencial ? () => handleDragStart(index) : undefined}
                        onDragOver={isSecuencial ? (e) => handleDragOver(e, index) : undefined}
                        onDrop={isSecuencial ? (e) => handleDrop(e, index) : undefined}
                        onDragEnd={isSecuencial ? handleDragEnd : undefined}
                      >
                        {isSecuencial && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <GripVertical size={16} className="text-gray-400 flex-shrink-0" />
                              <span className="text-sm font-semibold text-gray-700">{index + 1}</span>
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <p className="font-semibold text-gray-900 text-sm">{p.name}</p>
                          <p className="text-xs text-gray-400">{p.email}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{p.acto || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{p.rolDocumento || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {p.tipoFirma && p.tipoFirma.length > 0 ? (
                            <div className="flex flex-wrap gap-1">{p.tipoFirma.map((f) => <span key={f} className="inline-block px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium capitalize">{f}</span>)}</div>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {p.tipoNotificacion && p.tipoNotificacion.length > 0 ? (
                            <div className="flex flex-wrap gap-1">{p.tipoNotificacion.map((n) => <span key={n} className="inline-block px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-xs font-medium capitalize">{n}</span>)}</div>
                          ) : '—'}
                        </td>
                        {vencimientoSolicitudEnabled && (
                          <td className="px-4 py-3">
                            <input
                              type="date"
                              value={p.fechaVencimientoParticipacion || ''}
                              onChange={(e) => onChange(participants.map((pt) => pt.id === p.id ? { ...pt, fechaVencimientoParticipacion: e.target.value } : pt))}
                              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 w-36"
                              title="Fecha de vencimiento para la participación de este firmante"
                            />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          {p.configured ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500 text-white"><CheckCircle2 size={11} /> Configurado</span>
                          ) : (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-red-500 text-white">Sin configurar</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => setConfiguringParticipant(p)} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-primary hover:bg-primary/5 transition-colors" title="Configurar participación">
                              <Edit3 size={14} />
                            </button>
                            {p.id !== 'current-user' && (
                              <>
                                <button
                                  onClick={() => !p.savedAsContact && handleRegisterContact(p)}
                                  className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${p.savedAsContact ? 'text-emerald-600 bg-emerald-50 cursor-default' : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                                  title={p.savedAsContact ? 'Guardado como contacto' : 'Registrar como contacto'}
                                >
                                  <BookUser size={14} />
                                </button>
                                <button onClick={() => handleRemoveParticipant(p.id)} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Eliminar participante">
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {(mode === 'yo_y_otros' || mode === 'solo_otros') && (
              <button onClick={() => setAñadirParticipantesOpen(true)} className="mt-3 w-full border border-dashed border-gray-300 rounded-lg py-2.5 text-sm text-gray-500 hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-2">
                <span className="text-lg leading-none">+</span> Agregar participante
              </button>
            )}
          </div>
        </div>
      )}
      {añadirParticipantesOpen && <AñadirParticipantesModal onClose={() => { setAñadirParticipantesOpen(false); setOpenInviteDirectly(false); }} onAdd={handleAddParticipant} existingParticipants={participants} currentUserId={userId} currentUserEmail={currentUserEmail} mode={mode} onAddNew={() => { setOpenInviteDirectly(true); }} startWithInvite={openInviteDirectly} />}
      {configuringParticipant && <ConfigurarParticipacionModal participant={configuringParticipant} onClose={() => setConfiguringParticipant(null)} onSave={handleSaveConfig} isCurrentUser={configuringParticipant.id === 'current-user'} userId={userId} soloYo={mode === 'solo_yo' && configuringParticipant.id === 'current-user'} />}
    </div>
  );
}
