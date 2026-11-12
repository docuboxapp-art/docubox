'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Users, Search, Plus, Mail, Phone, Trash2, Check, LayoutGrid, LayoutList, MoreVertical, Eye, Star, Tag, FileText, ChevronDown, ChevronLeft, ChevronRight, Hash, X, ExternalLink, SlidersHorizontal, Building2, ArrowUpDown, Maximize2, Minimize2, Filter } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import ContactDetailWorkspace from './ContactDetailWorkspace';


// ─── Types ────────────────────────────────────────────────────────────────────
interface Contact {
  id: string;
  nombre: string;
  apellido_paterno: string | null;
  apellido_materno: string | null;
  email: string | null;
  telefono: string | null;
  rfc: string | null;
  curp: string | null;
  notas: string | null;
  etiqueta_rol?: string | null;
  tipo_persona?: string | null;
  empresa?: string | null;
  cargo?: string | null;
  direccion?: string | null;
  canal_preferido?: string | null;
  tags?: string[] | null;
  created_at: string;
}

interface ContactNote {
  id: string;
  contact_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

interface PlatformUser {
  id: string;
  full_name: string;
  email: string;
}

interface SharedDocument {
  id: string;
  nombre: string;
  tipo: string | null;
  estado: string | null;
  created_at: string;
}

const avatarColors = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
  'bg-orange-500', 'bg-pink-500', 'bg-teal-500',
];

function getInitials(c: Contact) {
  const parts = [c.nombre, c.apellido_paterno].filter(Boolean);
  return parts.map((p) => p![0].toUpperCase()).join('').slice(0, 2) || 'C';
}

function formatDisplayName(value: string | null | undefined) {
  if (!value) return '';
  return value
    .toLocaleLowerCase('es-MX')
    .replace(/(^|[\s'-])([a-záéíóúüñ])/g, (_, separator: string, letter: string) => (
      `${separator}${letter.toLocaleUpperCase('es-MX')}`
    ));
}

function getFullName(c: Contact) {
  return formatDisplayName(
    [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' '),
  );
}

function Spinner({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';
  return (
    <svg className={`animate-spin ${s}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Search Platform Users Modal ──────────────────────────────────────────────
function SearchUserModal({
  onClose, onSave, existingEmails,
}: {
  onClose: () => void; onSave: () => void; existingEmails: string[];
}) {
  const [searchCriteria, setSearchCriteria] = useState<'correo' | 'rfc' | 'curp' | 'telefono'>('correo');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlatformUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const criteriaPlaceholders: Record<string, string> = {
    correo: 'Ingresa Correo Electrónico...',
    rfc: 'Ingresa el RFC...',
    curp: 'Ingresa el CURP...',
    telefono: 'Ingresa el número de teléfono...',
  };

  const performSearch = async (q: string, criteria: string) => {
    if (!q.trim()) { setResults([]); setSearched(false); setIsSearching(false); return; }
    setIsSearching(true); setSearched(true);
    try {
      const res = await fetch(`/api/documentos/buscar-participante?q=${encodeURIComponent(q.trim())}&criteria=${criteria}`);
      const data = await res.json();
      setResults(data.users || []);
    } catch { setResults([]); }
    finally { setIsSearching(false); }
  };

  const handleSearch = () => performSearch(query, searchCriteria);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleSearch(); };

  const handleAddContact = async (u: PlatformUser) => {
    setSaving(u.id); setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');
      const { data: existing } = await supabase.from('contacts').select('id').eq('user_id', user.id).eq('email', u.email).maybeSingle();
      if (existing) { setSaved((prev) => [...prev, u.id]); return; }
      const nameParts = (u.full_name || u.email).split(' ');
      const { error: err } = await supabase.from('contacts').insert({
        user_id: user.id,
        nombre: (nameParts[0] || u.email).toUpperCase(),
        apellido_paterno: nameParts[1] ? nameParts[1].toUpperCase() : null,
        apellido_materno: nameParts[2] ? nameParts[2].toUpperCase() : null,
        email: u.email,
      });
      if (err) throw err;
      setSaved((prev) => [...prev, u.id]);
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al agregar el contacto.');
    } finally { setSaving(null); }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const userAvatarColors = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];
  const getInitialsFromUser = (name: string) =>
    name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0].toUpperCase()).join('') || 'U';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl" style={{ maxHeight: '90vh' }}>
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Nuevo Contacto</h2>
          <p className="text-sm text-gray-400 mt-1">Busca un usuario registrado en la plataforma para agregarlo a tus contactos.</p>
        </div>
        <div className="px-6 pt-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={searchCriteria}
                onChange={(e) => setSearchCriteria(e.target.value as 'correo' | 'rfc' | 'curp' | 'telefono')}
                className="appearance-none border border-gray-200 rounded-lg pl-3 pr-7 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white cursor-pointer"
              >
                <option value="correo">Correo Electrónico</option>
                <option value="rfc">RFC</option>
                <option value="curp">CURP</option>
                <option value="telefono">Teléfono</option>
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={criteriaPlaceholders[searchCriteria]}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button onClick={handleSearch} className="w-10 h-10 flex items-center justify-center bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors shrink-0">
              <Search size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-[200px]">
          {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 mb-3">{error}</div>}
          {isSearching ? (
            <div className="flex items-center justify-center py-12"><Spinner size="md" /></div>
          ) : !searched ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
              <Search size={14} className="shrink-0" />
              Realiza una búsqueda para encontrar participantes en la plataforma.
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Users size={28} className="text-gray-300" />
              <p className="text-sm text-gray-400">No se encontraron usuarios registrados.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((u, idx) => {
                const isSaved = saved.includes(u.id);
                const isAlreadyContact = existingEmails.includes(u.email);
                const isSaving = saving === u.id;
                return (
                  <div key={u.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 ${userAvatarColors[idx % userAvatarColors.length]}`}>
                      {getInitialsFromUser(u.full_name || u.email)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{u.full_name || u.email}</p>
                      <p className="text-xs text-gray-400 truncate">{u.email}</p>
                    </div>
                    <button
                      onClick={() => handleAddContact(u)}
                      disabled={isSaved || isAlreadyContact || isSaving}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                        isSaved || isAlreadyContact
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default' :'bg-primary hover:bg-primary/90 text-white'
                      } disabled:opacity-60`}
                    >
                      {isSaving ? <Spinner /> : isSaved || isAlreadyContact ? <Check size={13} /> : <Plus size={13} />}
                      {isSaved || isAlreadyContact ? 'Agregado' : 'Agregar'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Contact Card ──────────────────────────────────────────────────────────────
function ContactCard({ contact, idx, onView, onDelete, deleting }: {
  contact: Contact; idx: number; onView: () => void; onDelete: () => void; deleting: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="group relative rounded-lg border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300">
      <div className="mb-3 flex items-start justify-between">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white ${avatarColors[idx % avatarColors.length]}`}>
          {getInitials(contact)}
        </div>
        <div className="relative">
          <button onClick={() => setMenuOpen(!menuOpen)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 opacity-0 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 group-hover:opacity-100" aria-label={`Acciones de ${getFullName(contact)}`} title="Acciones">
            <MoreVertical size={15} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-10 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
              <button onClick={() => { setMenuOpen(false); onView(); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                <Eye size={13} /> Vista previa
              </button>
              <button onClick={() => { setMenuOpen(false); onDelete(); }} disabled={deleting} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50">
                <Trash2 size={13} /> Eliminar
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="font-semibold text-gray-900 text-sm leading-tight mb-0.5">{getFullName(contact)}</p>
      {contact.etiqueta_rol && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 mb-2">
          <Tag size={9} />{contact.etiqueta_rol}
        </span>
      )}
      {contact.rfc && <p className="text-xs text-gray-400 mb-3">RFC: {contact.rfc}</p>}
      {!contact.rfc && <div className="mb-3" />}
      <div className="space-y-1.5">
        {contact.email && (
          <div className="flex items-center gap-2 text-gray-500">
            <Mail size={12} className="shrink-0 text-gray-400" />
            <span className="text-xs truncate">{contact.email}</span>
          </div>
        )}
        {contact.telefono && (
          <div className="flex items-center gap-2 text-gray-500">
            <Phone size={12} className="shrink-0 text-gray-400" />
            <span className="text-xs">{contact.telefono}</span>
          </div>
        )}
      </div>
      <button type="button" onClick={onView} className="mt-4 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 text-xs text-primary hover:bg-blue-50"><Eye size={13} /> Vista previa</button>
    </div>
  );
}

// ─── Contacts workspace ─────────────────────────────────────────────────────
type ContactSort = 'nombre-asc' | 'nombre-desc' | 'recientes';
type ContactFilterKey = 'tipo' | 'favoritos' | 'pendientes' | 'etiqueta' | 'grupo';

function ContactFilterMenu({
  label, value, options, allLabel, open, disabled = false, onToggle, onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label || value;
  return (
    <div className="relative">
      <div className={'group flex min-h-8 max-w-full items-center rounded-md border text-xs font-normal transition-colors sm:max-w-[28rem] ' + (disabled ? 'border-slate-200 bg-white text-slate-400' : value ? 'border-primary/25 bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50')}>
        <button type="button" onClick={onToggle} disabled={disabled} aria-expanded={open} aria-haspopup="menu" className="flex min-h-8 min-w-0 items-center gap-1 px-2.5 py-1 text-left font-normal disabled:cursor-not-allowed">
          <span className="min-w-0 whitespace-normal break-words">{label}{value && <span className="filter-selected-value">: {selectedLabel}</span>}</span>
          <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
        </button>
        {value && <button type="button" onClick={() => onChange('')} aria-label={`Quitar filtro ${label}`} title={`Quitar filtro ${label}`} className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-primary/70 opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary focus:opacity-100 group-hover:opacity-100"><X size={12} /></button>}
      </div>
      {open && <div role="menu" aria-label={`Filtrar por ${label.toLowerCase()}`} className="absolute left-0 top-full z-[200] mt-1 max-h-[60vh] min-w-44 max-w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 font-normal shadow-[0_14px_35px_-20px_rgba(15,23,42,0.4)]">
        {[{ value: '', label: allLabel }, ...options].map(({ value: optionValue, label: optionLabel }) => (
          <button key={optionValue} type="button" role="menuitemradio" aria-checked={value === optionValue} onClick={() => onChange(optionValue)} className={'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 ' + (value === optionValue ? 'bg-primary/5 text-primary' : 'text-slate-700')}><span className="w-4 shrink-0">{value === optionValue && <Check size={14} />}</span><span className="break-words">{optionLabel}</span></button>
        ))}
      </div>}
    </div>
  );
}
type ContactColumn = 'datos' | 'etiquetas' | 'documentos' | 'actividad';
type ContactDocument = SharedDocument & { participantes: Array<{ email?: string; sub_estado?: string; estado?: string; status?: string }> | null };

const pendingDocumentStates = new Set(['en_progreso', 'en_espera', 'borrador']);
const CONTACT_FAVORITES_KEY = 'contactos';
const completeDocumentStates = new Set(['completado']);
const terminalParticipantStates = new Set(['firmo', 'firmado', 'aprobo', 'aprobado', 'rechazo', 'rechazado', 'cancelo', 'cancelado']);
const formatContactDate = (value: string) => new Date(value).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
const contactTags = (contact: Contact) => Array.from(new Set([
  ...(contact.etiqueta_rol ? [`Tipo: ${contact.etiqueta_rol}`] : []),
  ...(contact.tags || []).map((tag) => {
    if (/^(Tipo|Relación|Área):\s*/i.test(tag)) return tag;
    if (/^(cliente|proveedor|colaborador|notar[ií]a)$/i.test(tag)) return `Tipo: ${tag}`;
    if (/^(recurrente|prospecto|estrat[eé]gico)$/i.test(tag)) return `Relación: ${tag}`;
    if (/^(comercial|legal|fiscal|operaciones)$/i.test(tag)) return `Área: ${tag}`;
    return tag;
  }),
]));
const contactKind = (contact: Contact) => /moral|empresa/i.test(contact.tipo_persona || '') ? 'empresas' : 'personas';

function ContactPreviewPanel({ contact, index, docs, pending, documentsLoaded, notes, loadingNotes, onClose, onOpenDetail }: {
  contact: Contact; index: number; docs: SharedDocument[]; pending: number; documentsLoaded: boolean; notes: ContactNote[]; loadingNotes: boolean;
  onClose: () => void; onOpenDetail: () => void;
}) {
  const [tab, setTab] = useState<'informacion' | 'documentos' | 'actividad'>('informacion');
  const completed = docs.filter((doc) => completeDocumentStates.has((doc.estado || '').toLowerCase())).length;
  const latest = [...docs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return (
    <>
      <button type="button" onClick={onClose} aria-label="Cerrar vista previa" className="fixed inset-0 z-40 bg-slate-950/30 lg:hidden" />
      <aside aria-label={'Vista previa de ' + getFullName(contact)} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl lg:sticky lg:top-4 lg:z-auto lg:max-h-[calc(100vh-6rem)] lg:w-[360px] lg:shrink-0 lg:rounded-lg lg:border lg:shadow-sm">
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-5">
          <div className={'flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ' + avatarColors[index % avatarColors.length]}>{getInitials(contact)}</div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-slate-950">{getFullName(contact)}</h2>
            <p className="truncate text-xs text-slate-500">{contact.empresa || contact.tipo_persona || 'Contacto'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar vista previa" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X size={17} /></button>
        </div>
        <div role="tablist" aria-label="Información del contacto" className="grid grid-cols-3 border-b border-slate-200 px-2">
          {(['informacion', 'documentos', 'actividad'] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={'border-b-2 px-2 py-3 text-xs transition-colors ' + (tab === item ? 'border-primary font-medium text-primary' : 'border-transparent text-slate-500 hover:text-slate-800')}>
              {item === 'informacion' ? 'Información' : item === 'documentos' ? 'Documentos' : 'Actividad'}
            </button>
          ))}
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto bg-[#f8fafc] p-4">
          {tab === 'informacion' && (
            <>
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-950">Datos de contacto</h3>
                <div className="space-y-2.5 text-sm text-slate-600">
                  {contact.email && <p className="flex items-start gap-2 break-all"><Mail size={14} className="mt-0.5 shrink-0 text-slate-500" />{contact.email}</p>}
                  {contact.telefono && <p className="flex items-center gap-2"><Phone size={14} className="shrink-0 text-slate-500" />{contact.telefono}</p>}
                  {contact.empresa && <p className="flex items-center gap-2"><Building2 size={14} className="shrink-0 text-slate-500" />{contact.empresa}</p>}
                  {contact.cargo && <p className="flex items-center gap-2"><Users size={14} className="shrink-0 text-slate-500" />{contact.cargo}</p>}
                  {contact.rfc && <p className="flex items-center gap-2"><Hash size={14} className="shrink-0 text-slate-500" />RFC: {contact.rfc}</p>}
                  {!contact.email && !contact.telefono && !contact.empresa && !contact.cargo && !contact.rfc && <p className="text-slate-400">Sin datos adicionales.</p>}
                </div>
              </section>
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-950">Etiquetas</h3>
                <div className="flex flex-wrap gap-1.5">
                  {contactTags(contact).length ? contactTags(contact).map((tag) => <span key={tag} className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-700">{tag}</span>) : <span className="text-sm text-slate-400">Sin etiquetas.</span>}
                </div>
              </section>
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-950">Resumen documental</h3>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-lg font-semibold text-primary">{documentsLoaded ? docs.length : '—'}</p><p className="text-xs text-slate-500">Documentos</p></div>
                  <div><p className="text-lg font-semibold text-amber-600">{documentsLoaded ? pending : '—'}</p><p className="text-xs text-slate-500">Pendientes</p></div>
                  <div><p className="text-lg font-semibold text-emerald-600">{documentsLoaded ? completed : '—'}</p><p className="text-xs text-slate-500">Completados</p></div>
                </div>
              </section>
              {(contact.notas || notes.length > 0) && <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-950">Notas internas</h3>
                {contact.notas && <p className="whitespace-pre-wrap text-sm text-slate-600">{contact.notas}</p>}
                {notes[0] && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{notes[0].content}</p>}
              </section>}
              {latest && <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-950">Documento reciente</h3>
                <p className="text-sm text-slate-700">{latest.nombre}</p>
                <p className="mt-1 text-xs text-slate-500">{formatContactDate(latest.created_at)} · {latest.estado || 'Documento'}</p>
              </section>}
            </>
          )}
          {tab === 'documentos' && <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-950">Documentos compartidos ({docs.length})</h3>
            {docs.length ? <div className="divide-y divide-slate-100">{[...docs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((doc) => <div key={doc.id} className="flex gap-2 py-3">
              <FileText size={15} className="mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{doc.nombre}</p><p className="text-xs text-slate-500">{formatContactDate(doc.created_at)} · {doc.estado || 'Sin estado'}</p></div>
            </div>)}</div> : <p className="text-sm text-slate-500">{documentsLoaded ? 'No hay documentos compartidos con este contacto.' : 'No se pudo cargar el resumen documental.'}</p>}
          </section>}
          {tab === 'actividad' && <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-950">Actividad reciente</h3>
            {loadingNotes && <p className="text-sm text-slate-500">Cargando notas...</p>}
            {!loadingNotes && !docs.length && !notes.length && <p className="text-sm text-slate-500">No hay actividad registrada.</p>}
            {[...docs.map((doc) => ({ id: 'doc-' + doc.id, date: doc.created_at, label: 'Documento creado: ' + doc.nombre })), ...notes.map((note) => ({ id: 'note-' + note.id, date: note.created_at, label: 'Nota interna: ' + note.content }))].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 10).map((event) => <div key={event.id} className="border-l-2 border-blue-100 py-2 pl-3"><p className="text-sm text-slate-700">{event.label}</p><p className="mt-1 text-xs text-slate-500">{formatContactDate(event.date)}</p></div>)}
          </section>}
        </div>
        <div className="border-t border-slate-200 bg-white p-4">
          <button type="button" onClick={onOpenDetail} className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90"><ExternalLink size={14} /> Abrir ficha completa</button>
        </div>
      </aside>
    </>
  );
}

function ContactDataTable({
  contacts,
  visible,
  columns,
  documentsLoaded,
  previewId,
  getDocs,
  getPending,
  onPreview,
  onOpenDetail,
  favoriteIds,
  favoritesReady,
  favoritePendingId,
  onToggleFavorite,
}: {
  contacts: Contact[];
  visible: Contact[];
  columns: Record<ContactColumn, boolean>;
  documentsLoaded: boolean;
  previewId: string | null;
  getDocs: (contact: Contact) => ContactDocument[];
  getPending: (contact: Contact) => number;
  onPreview: (contact: Contact) => void;
  onOpenDetail: (contact: Contact) => void;
  favoriteIds: Set<string>;
  favoritesReady: boolean;
  favoritePendingId: string | null;
  onToggleFavorite: (contact: Contact) => void;
}) {
  const tagTones = [
    'border-blue-100 bg-blue-50 text-blue-700',
    'border-emerald-100 bg-emerald-50 text-emerald-700',
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <table className="w-full min-w-[850px] border-collapse text-left text-sm">
        <caption className="sr-only">Contactos de tu agenda</caption>
        <thead className="bg-slate-50/90">
          <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
            <th scope="col" className="min-w-[180px] px-4 py-3 font-medium">Contacto</th>
            {columns.datos && <th scope="col" className="min-w-[190px] px-4 py-3 font-medium">Datos de contacto</th>}
            {columns.etiquetas && <th scope="col" className="min-w-[130px] px-4 py-3 font-medium">Etiquetas</th>}
            {columns.documentos && <th scope="col" className="min-w-[115px] px-4 py-3 font-medium">Documentos</th>}
            {columns.actividad && <th scope="col" className="min-w-[130px] px-4 py-3 font-medium">Documento reciente</th>}
            <th scope="col" className="w-[144px] px-4 py-3 text-right font-medium">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((contact) => {
            const docs = getDocs(contact);
            const pending = getPending(contact);
            const latest = docs[0];
            const tags = contactTags(contact);
            const selected = previewId === contact.id;

            return (
              <tr
                key={contact.id}
                className={'border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/80 ' + (selected ? 'bg-blue-50/70' : '')}
              >
                <th scope="row" className={'border-l-2 px-4 py-3 text-left font-normal ' + (selected ? 'border-primary' : 'border-transparent')}>
                  <div className="flex items-center gap-3">
                    <div className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ' + avatarColors[contacts.indexOf(contact) % avatarColors.length]}>
                      {getInitials(contact)}
                    </div>
                    <div className="min-w-0">
                      <p className="max-w-[190px] truncate font-medium text-slate-950" title={getFullName(contact)}>{getFullName(contact)}</p>
                      <p className="max-w-[190px] truncate text-xs text-slate-500" title={contact.empresa || contact.tipo_persona || undefined}>
                        {contact.empresa || contact.tipo_persona || 'Contacto'}
                      </p>
                    </div>
                  </div>
                </th>
                {columns.datos && (
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {contact.email && <p className="flex items-center gap-1.5"><Mail size={13} className="shrink-0 text-slate-400" /><span className="max-w-[210px] truncate" title={contact.email}>{contact.email}</span></p>}
                    {contact.telefono && <p className={'flex items-center gap-1.5 ' + (contact.email ? 'mt-1' : '')}><Phone size={13} className="shrink-0 text-slate-400" /><span className="truncate">{contact.telefono}</span></p>}
                    {!contact.email && !contact.telefono && <span className="text-slate-400">—</span>}
                  </td>
                )}
                {columns.etiquetas && (
                  <td className="px-4 py-3">
                    <div className="flex max-w-[175px] flex-wrap items-center gap-1">
                      {tags.length ? tags.slice(0, 2).map((tag, index) => (
                        <span key={tag} className={'max-w-[135px] truncate rounded-md border px-1.5 py-0.5 text-[11px] ' + tagTones[index]} title={tag}>{tag}</span>
                      )) : <span className="text-slate-400">—</span>}
                      {tags.length > 2 && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600" title={tags.slice(2).join(', ')}>+{tags.length - 2}</span>}
                    </div>
                  </td>
                )}
                {columns.documentos && (
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    {documentsLoaded ? (
                      <>
                        <p className="flex items-center gap-1.5 font-medium text-slate-700"><FileText size={13} className="text-slate-400" />{docs.length} {docs.length === 1 ? 'documento' : 'documentos'}</p>
                        <p className={'mt-1 pl-[19px] ' + (pending ? 'text-red-600' : 'text-slate-400')}>{pending} {pending === 1 ? 'pendiente' : 'pendientes'}</p>
                      </>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                )}
                {columns.actividad && (
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {latest ? (
                      <>
                        <p className="max-w-[155px] truncate" title={latest.nombre}>{latest.nombre}</p>
                        <p className="mt-1 text-slate-400">{formatContactDate(latest.created_at)}</p>
                      </>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => onPreview(contact)}
                      aria-label={'Vista previa de ' + getFullName(contact)}
                      title="Vista previa"
                      className={'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (selected ? 'border-primary/30 bg-white text-primary' : 'border-slate-200 bg-white text-primary hover:border-primary/30 hover:bg-blue-50')}
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(contact)}
                      disabled={!favoritesReady || favoritePendingId !== null}
                      aria-label={(favoriteIds.has(contact.id) ? 'Quitar de favoritos a ' : 'Agregar a favoritos a ') + getFullName(contact)}
                      aria-pressed={favoriteIds.has(contact.id)}
                      title={favoriteIds.has(contact.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                      className={'inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 disabled:cursor-not-allowed disabled:opacity-50 ' + (favoriteIds.has(contact.id) ? 'text-amber-500' : 'text-slate-400 hover:bg-amber-50 hover:text-amber-500')}
                    >
                      <Star size={16} fill={favoriteIds.has(contact.id) ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenDetail(contact)}
                      aria-label={'Abrir ficha completa de ' + getFullName(contact)}
                      title="Abrir ficha completa"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <ExternalLink size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ContactosPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritePendingId, setFavoritePendingId] = useState<string | null>(null);
  const [favoriteNotice, setFavoriteNotice] = useState('');
  const [documents, setDocuments] = useState<ContactDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [groupMemberships, setGroupMemberships] = useState<Array<{ contact_id: string; field_value: string | null }>>([]);
  const [sort, setSort] = useState<ContactSort>('nombre-asc');
  const [showSort, setShowSort] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [openFilterDropdown, setOpenFilterDropdown] = useState<ContactFilterKey | 'aplicados' | null>(null);
  const filterDropdownRef = useRef<HTMLElement>(null);
  const [isWideView, setIsWideView] = useState(false);
  const [columns, setColumns] = useState<Record<ContactColumn, boolean>>({ datos: true, etiquetas: true, documentos: true, actividad: true });
  const [page, setPage] = useState(1);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [viewingContact, setViewingContact] = useState<{ contact: Contact; idx: number } | null>(null);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  useEffect(() => {
    if (!openFilterDropdown) return;
    const closeOutside = (event: PointerEvent) => {
      if (!filterDropdownRef.current?.contains(event.target as Node)) setOpenFilterDropdown(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenFilterDropdown(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openFilterDropdown]);

  const loadContacts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.from('contacts').select('*').eq('user_id', user.id).order('nombre', { ascending: true });
      if (!error && data) {
        setContacts(data);
        setViewingContact((current) => {
          if (!current) return null;
          const updated = data.find((contact) => contact.id === current.contact.id);
          return updated ? { ...current, contact: updated } : null;
        });
      }
    } catch { /* Keep the current agenda if the request fails. */ }
    finally { setLoading(false); }
  }, [user]);

  const loadGroups = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await createClient().from('contact_custom_fields')
      .select('contact_id,field_value')
      .eq('user_id', user.id)
      .eq('field_name', 'contact_group');
    if (data) setGroupMemberships(data);
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadContacts(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadContacts]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadGroups(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGroups]);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const loadFavorites = async () => {
      try {
        const { data, error } = await createClient().from('user_favorites')
          .select('item_id')
          .eq('user_id', user.id)
          .eq('storage_key', CONTACT_FAVORITES_KEY);
        if (!active) return;
        if (error) throw error;
        setFavoriteIds(new Set((data || []).map((row) => row.item_id)));
        setFavoritesReady(true);
      } catch {
        if (active) setFavoriteNotice('No se pudieron cargar tus contactos favoritos.');
      }
    };
    void loadFavorites();
    return () => { active = false; };
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const loadDocuments = async () => {
      try {
        const { data, error } = await createClient().from('documentos')
          .select('id, nombre, estado, created_at, participantes')
          .eq('owner_id', user.id).not('participantes', 'is', null)
          .order('created_at', { ascending: false });
        if (active && !error) {
          setDocuments((data || []).map((doc) => ({ ...doc, tipo: null })) as ContactDocument[]);
          setDocumentsLoaded(true);
        }
      } catch { /* Document summary is optional when unavailable. */ }
    };
    loadDocuments();
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    if (!contacts.length || typeof window === 'undefined') return;
    const contactId = new URLSearchParams(window.location.search).get('contact');
    if (contactId && contacts.some((contact) => contact.id === contactId)) {
      const timer = window.setTimeout(() => setPreviewId(contactId), 0);
      return () => window.clearTimeout(timer);
    }
  }, [contacts]);
  useEffect(() => {
    if (!previewId) return;
    let active = true;
    createClient().from('contact_notes').select('*').eq('contact_id', previewId).order('created_at', { ascending: false }).then(({ data }) => {
      if (active) { setNotes(data || []); setLoadingNotes(false); }
    });
    return () => { active = false; };
  }, [previewId]);

  const docsByEmail = new Map<string, ContactDocument[]>();
  for (const document of documents) {
    const emails = new Set((Array.isArray(document.participantes) ? document.participantes : []).map((part) => (part.email || '').trim().toLowerCase()).filter(Boolean));
    for (const email of emails) {
      const list = docsByEmail.get(email) || [];
      list.push(document);
      docsByEmail.set(email, list);
    }
  }
  const getDocs = (contact: Contact) => docsByEmail.get((contact.email || '').trim().toLowerCase()) || [];
  const getPending = (contact: Contact) => getDocs(contact).filter((doc) => {
    if (!pendingDocumentStates.has((doc.estado || '').toLowerCase())) return false;
    const participant = doc.participantes?.find((part) => part.email?.trim().toLowerCase() === contact.email?.trim().toLowerCase());
    return participant && !terminalParticipantStates.has((participant.sub_estado || participant.status || participant.estado || '').toLowerCase());
  }).length;
  const tags = Array.from(new Set(contacts.flatMap(contactTags))).sort((a, b) => a.localeCompare(b, 'es'));
  const groupNames = Array.from(new Set(groupMemberships.map((membership) => membership.field_value).filter((name): name is string => Boolean(name)))).sort((a, b) => a.localeCompare(b, 'es'));
  const favoriteCount = contacts.filter((contact) => favoriteIds.has(contact.id)).length;
  const normalizedSearch = search.trim().toLocaleLowerCase('es-MX');
  const filtered = contacts.filter((contact) => {
    const haystack = [getFullName(contact), contact.email, contact.telefono, contact.rfc, contact.empresa, ...contactTags(contact)].filter(Boolean).join(' ').toLocaleLowerCase('es-MX');
    return (!normalizedSearch || haystack.includes(normalizedSearch))
      && (!typeFilter || contactKind(contact) === typeFilter)
      && (!favoritesOnly || favoriteIds.has(contact.id))
      && (!pendingOnly || getPending(contact) > 0)
      && (!tagFilter || contactTags(contact).includes(tagFilter))
      && (!groupFilter || groupMemberships.some((membership) => membership.contact_id === contact.id && membership.field_value === groupFilter));
  }).sort((a, b) => sort === 'recientes' ? Date.parse(b.created_at) - Date.parse(a.created_at) : getFullName(a).localeCompare(getFullName(b), 'es') * (sort === 'nombre-desc' ? -1 : 1));
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedContact = contacts.find((contact) => contact.id === previewId) || null;
  const selectedIndex = selectedContact ? contacts.findIndex((contact) => contact.id === selectedContact.id) : -1;
  const existingEmails = contacts.map((contact) => contact.email).filter(Boolean) as string[];
  const activeFilterSelections: Array<{ key: ContactFilterKey; label: string }> = [
    ...(typeFilter ? [{ key: 'tipo' as const, label: `Tipo de contacto: ${typeFilter === 'personas' ? 'Personas' : 'Empresas'}` }] : []),
    ...(favoritesOnly ? [{ key: 'favoritos' as const, label: 'Favoritos: Solo favoritos' }] : []),
    ...(pendingOnly ? [{ key: 'pendientes' as const, label: 'Pendientes: Con pendientes' }] : []),
    ...(tagFilter ? [{ key: 'etiqueta' as const, label: `Etiquetas: ${tagFilter}` }] : []),
    ...(groupFilter ? [{ key: 'grupo' as const, label: `Grupos: ${groupFilter}` }] : []),
  ];
  const activeFilterCount = activeFilterSelections.length;
  const clearFilters = () => {
    setTypeFilter('');
    setFavoritesOnly(false);
    setPendingOnly(false);
    setTagFilter('');
    setGroupFilter('');
    setPage(1);
    setOpenFilterDropdown(null);
  };
  const removeAppliedFilter = (key: ContactFilterKey) => {
    if (key === 'tipo') setTypeFilter('');
    if (key === 'favoritos') setFavoritesOnly(false);
    if (key === 'pendientes') setPendingOnly(false);
    if (key === 'etiqueta') setTagFilter('');
    if (key === 'grupo') setGroupFilter('');
    if (activeFilterCount === 1) setOpenFilterDropdown(null);
    setPage(1);
  };
  const openPreview = (contact: Contact) => {
    setNotes([]);
    setLoadingNotes(true);
    setPreviewId(contact.id);
    window.history.replaceState(null, '', '/contactos?contact=' + encodeURIComponent(contact.id));
  };
  const closePreview = () => {
    setPreviewId(null);
    setNotes([]);
    setLoadingNotes(false);
    window.history.replaceState(null, '', '/contactos');
  };
  const openFullContact = (contact: Contact) => {
    if (previewId) closePreview();
    setViewingContact({ contact, idx: contacts.indexOf(contact) });
  };
  const toggleFavorite = async (contact: Contact) => {
    if (!user?.id || !favoritesReady || favoritePendingId) return;
    const wasFavorite = favoriteIds.has(contact.id);
    setFavoritePendingId(contact.id);
    setFavoriteNotice('');
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (wasFavorite) next.delete(contact.id);
      else next.add(contact.id);
      return next;
    });
    try {
      const supabase = createClient();
      const operation = wasFavorite
        ? supabase.from('user_favorites').delete()
            .eq('user_id', user.id)
            .eq('storage_key', CONTACT_FAVORITES_KEY)
            .eq('item_id', contact.id)
        : supabase.from('user_favorites').upsert(
            { user_id: user.id, storage_key: CONTACT_FAVORITES_KEY, item_id: contact.id },
            { onConflict: 'user_id,storage_key,item_id' }
          );
      const { error } = await operation;
      if (error) throw error;
    } catch {
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (wasFavorite) next.add(contact.id);
        else next.delete(contact.id);
        return next;
      });
      setFavoriteNotice('No fue posible actualizar este contacto favorito.');
    } finally {
      setFavoritePendingId(null);
    }
  };
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const { error } = await createClient().from('contacts').delete().eq('id', id).eq('user_id', user?.id);
      if (!error) {
        setContacts((previous) => previous.filter((contact) => contact.id !== id));
        setFavoriteIds((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
        if (previewId === id) closePreview();
        if (viewingContact?.contact.id === id) setViewingContact(null);
      }
    } finally { setDeletingId(null); }
  };

  if (viewingContact) return <AppLayout noPadding><ContactDetailWorkspace
    contact={viewingContact.contact}
    onClose={() => setViewingContact(null)} onUpdated={() => { void loadContacts(); void loadGroups(); }}
    catalogTags={contacts.flatMap(contactTags)}
  /></AppLayout>;

  return (
    <AppLayout noPadding>
      <div className={(isWideView ? 'fixed inset-0 z-[100] overflow-y-auto' : '-mx-4 -my-4 min-h-[calc(100vh-4rem)] md:-my-6') + ' bg-[#f6f8fb]'}>
        <div className={'mx-auto min-w-0 w-full px-4 py-4 sm:px-5 md:py-5 lg:px-6 ' + (isWideView ? '' : 'max-w-[1560px] min-[1920px]:max-w-[1800px]')}>
          <header className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div><h1 className="text-2xl font-600 text-slate-950">Contactos</h1><p className="mt-1 text-sm text-slate-500">Gestiona tu agenda y consulta los documentos compartidos.</p></div>
            <button type="button" onClick={() => setShowSearchModal(true)} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-600 text-white shadow-[0_8px_18px_-12px_rgba(30,107,255,0.85)] transition-colors hover:bg-primary/90"><Plus size={16} /> Agregar contacto</button>
          </header>
          {favoriteNotice && <p role="alert" className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{favoriteNotice}</p>}
          <div className="flex gap-4">
            <main className="min-w-0 flex-1">
              <section ref={filterDropdownRef} className="mb-3 overflow-visible rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]" aria-label="Buscar y filtrar contactos">
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <div className="relative min-w-[160px] flex-1">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input type="text" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar contactos..." aria-label="Buscar contactos por nombre, correo, teléfono, RFC o empresa" className="h-9 w-full rounded-md border border-slate-200 bg-slate-50/70 pl-9 pr-9 text-sm transition-colors focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/10" />
                    {search && <button type="button" onClick={() => { setSearch(''); setPage(1); }} aria-label="Borrar búsqueda" title="Borrar búsqueda" className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X size={14} aria-hidden="true" /></button>}
                  </div>
                  {activeFilterCount > 0 && <div className="relative shrink-0">
                    <div className="flex h-9 items-center rounded-md border border-primary/25 bg-white text-xs text-primary">
                      <button type="button" onClick={() => setOpenFilterDropdown((current) => current === 'aplicados' ? null : 'aplicados')} aria-expanded={openFilterDropdown === 'aplicados'} aria-haspopup="menu" aria-label={`Filtros aplicados: ${activeFilterCount}. Ver criterios`} className="flex h-full items-center gap-1.5 px-2.5 text-left">
                        <Filter size={13} aria-hidden="true" /><span>Filtros aplicados</span><span className="filter-selected-value">({activeFilterCount})</span><ChevronDown size={13} aria-hidden="true" />
                      </button>
                      <button type="button" onClick={clearFilters} aria-label="Quitar todos los filtros" title="Quitar todos los filtros" className="flex h-7 w-7 items-center justify-center border-l border-primary/25 text-primary/70 hover:bg-primary/5 hover:text-primary"><X size={13} aria-hidden="true" /></button>
                    </div>
                    {openFilterDropdown === 'aplicados' && <div role="group" aria-label="Criterios aplicados" className="absolute right-0 top-full z-[200] mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_14px_35px_-20px_rgba(15,23,42,0.4)]">
                      <p className="px-2 py-1.5 text-xs text-slate-500">Criterios aplicados</p>
                      {activeFilterSelections.map((selection) => <div key={selection.key} className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-slate-50"><span className="min-w-0 flex-1 break-words text-sm text-slate-700">{selection.label}</span><button type="button" onClick={() => removeAppliedFilter(selection.key)} aria-label={`Quitar ${selection.label}`} title={`Quitar ${selection.label}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-900"><X size={13} aria-hidden="true" /></button></div>)}
                    </div>}
                  </div>}
                  <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setShowSort(false); }} onKeyDown={(event) => { if (event.key === 'Escape') setShowSort(false); }}>
                    <button type="button" onClick={() => setShowSort((open) => !open)} aria-expanded={showSort} aria-haspopup="menu" className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"><ArrowUpDown size={14} /> Ordenar</button>
                    {showSort && <div role="menu" aria-label="Ordenar contactos" className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">{([['nombre-asc', 'Nombre A–Z'], ['nombre-desc', 'Nombre Z–A'], ['recientes', 'Más recientes']] as [ContactSort, string][]).map(([value, label]) => <button key={value} type="button" role="menuitemradio" aria-checked={sort === value} onClick={() => { setSort(value); setPage(1); setShowSort(false); }} className={'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ' + (sort === value ? 'text-primary' : 'text-slate-700')}><span className="w-4">{sort === value && <Check size={14} />}</span>{label}</button>)}</div>}
                  </div>
                  <div className="flex h-9 items-center overflow-hidden rounded-md border border-slate-200 bg-white p-0.5">
                    <button type="button" onClick={() => setViewMode('list')} aria-label="Vista de lista" aria-pressed={viewMode === 'list'} className={'flex h-7 w-8 items-center justify-center rounded ' + (viewMode === 'list' ? 'bg-slate-100 text-slate-950' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700')}><LayoutList size={16} /></button>
                    <button type="button" onClick={() => setViewMode('grid')} aria-label="Vista de cuadrícula" aria-pressed={viewMode === 'grid'} className={'flex h-7 w-8 items-center justify-center rounded ' + (viewMode === 'grid' ? 'bg-slate-100 text-slate-950' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700')}><LayoutGrid size={16} /></button>
                  </div>
                  <div className="relative">
                    <button type="button" onClick={() => setShowColumns((open) => !open)} aria-expanded={showColumns} aria-label="Configurar columnas" title="Configurar columnas" className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"><SlidersHorizontal size={16} /></button>
                    {showColumns && <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">{([['datos', 'Datos de contacto'], ['etiquetas', 'Etiquetas'], ['documentos', 'Documentos'], ['actividad', 'Documento reciente']] as [ContactColumn, string][]).map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={columns[key]} onChange={(event) => setColumns((previous) => ({ ...previous, [key]: event.target.checked }))} className="accent-blue-600" />{label}</label>)}</div>}
                  </div>
                  <button type="button" onClick={() => setIsWideView((wide) => !wide)} aria-label={isWideView ? 'Salir de vista amplia' : 'Vista amplia'} title={isWideView ? 'Salir de vista amplia' : 'Vista amplia'} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950">{isWideView ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
                </div>
                <div className="mis-documentos-filters flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <ContactFilterMenu label="Tipo de contacto" value={typeFilter} options={[{ value: 'personas', label: 'Personas' }, { value: 'empresas', label: 'Empresas' }]} allLabel="Todos los tipos" open={openFilterDropdown === 'tipo'} onToggle={() => setOpenFilterDropdown((current) => current === 'tipo' ? null : 'tipo')} onChange={(value) => { setTypeFilter(value); setPage(1); setOpenFilterDropdown(null); }} />
                  <ContactFilterMenu label="Favoritos" value={favoritesOnly ? 'favoritos' : ''} options={[{ value: 'favoritos', label: `Solo favoritos (${favoriteCount})` }]} allLabel="Todos los contactos" open={openFilterDropdown === 'favoritos'} disabled={!favoritesReady} onToggle={() => setOpenFilterDropdown((current) => current === 'favoritos' ? null : 'favoritos')} onChange={(value) => { setFavoritesOnly(Boolean(value)); setPage(1); setOpenFilterDropdown(null); }} />
                  <ContactFilterMenu label="Pendientes" value={pendingOnly ? 'pendientes' : ''} options={[{ value: 'pendientes', label: 'Con pendientes' }]} allLabel="Todos los contactos" open={openFilterDropdown === 'pendientes'} disabled={!documentsLoaded} onToggle={() => setOpenFilterDropdown((current) => current === 'pendientes' ? null : 'pendientes')} onChange={(value) => { setPendingOnly(Boolean(value)); setPage(1); setOpenFilterDropdown(null); }} />
                  <ContactFilterMenu label="Etiquetas" value={tagFilter} options={tags.map((tag) => ({ value: tag, label: tag }))} allLabel="Todas las etiquetas" open={openFilterDropdown === 'etiqueta'} onToggle={() => setOpenFilterDropdown((current) => current === 'etiqueta' ? null : 'etiqueta')} onChange={(value) => { setTagFilter(value); setPage(1); setOpenFilterDropdown(null); }} />
                  <ContactFilterMenu label="Grupos" value={groupFilter} options={groupNames.map((name) => ({ value: name, label: name }))} allLabel="Todos los grupos" open={openFilterDropdown === 'grupo'} onToggle={() => setOpenFilterDropdown((current) => current === 'grupo' ? null : 'grupo')} onChange={(value) => { setGroupFilter(value); setPage(1); setOpenFilterDropdown(null); }} />
                </div>
              </section>
              {loading ? <div className="rounded-lg border border-slate-200 bg-white py-24 text-center text-sm text-slate-500">Cargando contactos...</div> : !filtered.length ? <div className="rounded-lg border border-slate-200 bg-white px-5 py-20 text-center"><Users size={28} className="mx-auto mb-3 text-slate-400" /><p className="font-medium text-slate-900">{contacts.length ? 'Sin resultados' : 'Tu agenda de contactos está vacía'}</p><p className="mt-1 text-sm text-slate-500">{contacts.length ? 'Prueba con otra búsqueda o cambia los filtros.' : 'Agrega tu primer contacto para comenzar.'}</p></div> : viewMode === 'grid' ? <div className={'grid grid-cols-1 gap-3 sm:grid-cols-2 ' + (selectedContact ? 'xl:grid-cols-2' : 'xl:grid-cols-3 2xl:grid-cols-4')}>{visible.map((contact) => <ContactCard key={contact.id} contact={contact} idx={contacts.indexOf(contact)} onView={() => openPreview(contact)} onDelete={() => handleDelete(contact.id)} deleting={deletingId === contact.id} />)}</div> : <ContactDataTable contacts={contacts} visible={visible} columns={columns} documentsLoaded={documentsLoaded} previewId={previewId} getDocs={getDocs} getPending={getPending} onPreview={openPreview} onOpenDetail={openFullContact} favoriteIds={favoriteIds} favoritesReady={favoritesReady} favoritePendingId={favoritePendingId} onToggleFavorite={toggleFavorite} />}
              {!loading && filtered.length > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>Mostrando {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} de {filtered.length} contactos</span><div className="flex items-center gap-1"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Página anterior" className="rounded-md border border-slate-200 bg-white p-2 disabled:opacity-40"><ChevronLeft size={14} /></button><span className="px-2">{currentPage} de {totalPages}</span><button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} aria-label="Página siguiente" className="rounded-md border border-slate-200 bg-white p-2 disabled:opacity-40"><ChevronRight size={14} /></button></div></div>}
            </main>
            {selectedContact && <ContactPreviewPanel key={selectedContact.id} contact={selectedContact} index={selectedIndex} docs={getDocs(selectedContact)} pending={getPending(selectedContact)} documentsLoaded={documentsLoaded} notes={notes} loadingNotes={loadingNotes} onClose={closePreview} onOpenDetail={() => openFullContact(selectedContact)} />}
          </div>
          {showSearchModal && <SearchUserModal onClose={() => setShowSearchModal(false)} onSave={loadContacts} existingEmails={existingEmails} />}
        </div>
      </div>
    </AppLayout>
  );
}
