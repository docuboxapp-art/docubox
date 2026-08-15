'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FileText, X, ChevronDown, User, PenLine, Mail, Phone, AlignLeft, Calendar, Clock, Hash, CheckSquare, Image, DollarSign, List, Info, ZoomIn, ZoomOut, Lock, Eye, EyeOff, AlertTriangle, CheckCircle2, Settings, Plus, Circle, Tag, MapPin, ShieldCheck, Fingerprint, Link2, Timer, ScrollText } from 'lucide-react';
import type { CryptographicElementType, DocumentSettings, Participant, PlacedField, SecuritySettings } from './types';
import { PARTICIPANT_COLORS, PARTICIPANT_COLORS_HEX } from './types';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// ── Participant user data cache ───────────────────────────────────────────────
interface ParticipantUserData {
  nombre_completo?: string;
  rfc?: string;
  curp?: string;
  email?: string;
  telefono?: string;
  direccion?: string;
}

// ── Field Label Config Modal ──────────────────────────────────────────────────
function FieldLabelConfigModal({
  field,
  onSave,
  onClose,
}: {
  field: PlacedField;
  onSave: (config: { customName: string; showLabelInDocument: boolean }) => void;
  onClose: () => void;
}) {
  const [customName, setCustomName] = useState(field.fieldConfig?.customName ?? field.label);
  const [showLabel, setShowLabel] = useState(field.fieldConfig?.showLabelInDocument ?? false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900">Configuración del Campo</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-4 mt-0.5"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500 mb-5">Personaliza el nombre y la visibilidad de la etiqueta para este campo.</p>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Nombre del Campo <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            placeholder={field.label}
            autoFocus
          />
          <p className="mt-1.5 text-xs text-primary">Este nombre identificará el campo en los reportes y validaciones.</p>
        </div>

        <label className="flex items-start gap-3 border border-gray-200 rounded-lg px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors mb-6">
          <input
            type="checkbox"
            checked={showLabel}
            onChange={(e) => setShowLabel(e.target.checked)}
            className="w-4 h-4 rounded accent-primary cursor-pointer mt-0.5"
          />
          <div>
            <p className="text-sm font-semibold text-gray-800">Mostrar etiqueta en el documento</p>
            <p className="text-xs text-gray-500 mt-0.5">Si activas esta opción, el nombre del campo aparecerá visiblemente encima del elemento en el PDF final.</p>
          </div>
        </label>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => { onSave({ customName: customName.trim() || field.label, showLabelInDocument: showLabel }); onClose(); }}
            className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            Guardar Cambios
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Field Type Config Modal ───────────────────────────────────────────────────
function FieldTypeConfigModal({
  field,
  onSave,
  onClose,
}: {
  field: PlacedField;
  onSave: (config: PlacedField['fieldTypeConfig']) => void;
  onClose: () => void;
}) {
  const cfg = field.fieldTypeConfig ?? {};
  const [imageType, setImageType] = useState(cfg.imageType ?? 'foto');
  const [decimals, setDecimals] = useState(cfg.decimals ?? 2);
  const [numberFormat, setNumberFormat] = useState(cfg.numberFormat ?? 'decimal');
  const [currency, setCurrency] = useState(cfg.currency ?? 'MXN');
  const [currencySymbol, setCurrencySymbol] = useState(cfg.currencySymbol ?? '$');
  const [dateFormat, setDateFormat] = useState(cfg.dateFormat ?? 'DD/MM/YYYY');
  const [timeFormat, setTimeFormat] = useState(cfg.timeFormat ?? '24h');
  const [timeWithSeconds, setTimeWithSeconds] = useState(cfg.timeWithSeconds ?? false);

  const fieldLabel = field.label;
  const isImagen = fieldLabel === 'Imagen';
  const isNumero = fieldLabel === 'Número';
  const isMoneda = fieldLabel === 'Moneda';
  const isFecha = fieldLabel === 'Fecha';
  const isHora = fieldLabel === 'Hora';

  const handleSave = () => {
    const result: PlacedField['fieldTypeConfig'] = {};
    if (isImagen) result.imageType = imageType as any;
    if (isNumero) { result.decimals = decimals; result.numberFormat = numberFormat as any; }
    if (isMoneda) { result.currency = currency as any; result.currencySymbol = currencySymbol; }
    if (isFecha) result.dateFormat = dateFormat as any;
    if (isHora) { result.timeFormat = timeFormat as any; result.timeWithSeconds = timeWithSeconds; }
    onSave(result);
    onClose();
  };

  const title = `Configuración de ${fieldLabel}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-4 mt-0.5"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500 mb-5">Configura las opciones específicas para este tipo de campo.</p>

        <div className="space-y-4 mb-6">
          {/* Imagen */}
          {isImagen && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Tipo de imagen</label>
              <select value={imageType} onChange={(e) => setImageType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white">
                <option value="foto">Fotografía</option>
                <option value="firma_imagen">Firma como imagen</option>
                <option value="logo">Logotipo</option>
                <option value="documento">Imagen de documento</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          )}

          {/* Número */}
          {isNumero && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Formato de número</label>
                <select value={numberFormat} onChange={(e) => setNumberFormat(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white">
                  <option value="entero">Entero (sin decimales)</option>
                  <option value="decimal">Decimal</option>
                  <option value="porcentaje">Porcentaje (%)</option>
                </select>
              </div>
              {numberFormat === 'decimal' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Decimales</label>
                  <select value={decimals} onChange={(e) => setDecimals(Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white">
                    {[0, 1, 2, 3, 4].map((d) => <option key={d} value={d}>{d} decimal{d !== 1 ? 'es' : ''}</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          {/* Moneda */}
          {isMoneda && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Tipo de moneda</label>
                <select value={currency} onChange={(e) => { setCurrency(e.target.value as any); const symbols: Record<string, string> = { MXN: '$', USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', otro: '' }; setCurrencySymbol(symbols[e.target.value] ?? ''); }} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white">
                  <option value="MXN">MXN — Peso Mexicano</option>
                  <option value="USD">USD — Dólar Estadounidense</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — Libra Esterlina</option>
                  <option value="CAD">CAD — Dólar Canadiense</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Símbolo de moneda</label>
                <input type="text" value={currencySymbol} onChange={(e) => setCurrencySymbol(e.target.value)} maxLength={5} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" placeholder="$" />
              </div>
            </>
          )}

          {/* Fecha */}
          {isFecha && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Formato de fecha</label>
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as any)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white">
                <option value="DD/MM/YYYY">DD/MM/YYYY (ej. 31/12/2025)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (ej. 12/31/2025)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ej. 2025-12-31)</option>
                <option value="DD-MM-YYYY">DD-MM-YYYY (ej. 31-12-2025)</option>
                <option value="DD MMMM YYYY">DD MMMM YYYY (ej. 31 diciembre 2025)</option>
              </select>
            </div>
          )}

          {/* Hora */}
          {isHora && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Formato de hora</label>
                <select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value as any)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white">
                  <option value="24h">24 horas (ej. 14:30)</option>
                  <option value="12h">12 horas AM/PM (ej. 2:30 PM)</option>
                </select>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={timeWithSeconds} onChange={(e) => setTimeWithSeconds(e.target.checked)} className="w-4 h-4 rounded accent-primary cursor-pointer" />
                <span className="text-sm text-gray-700">Incluir segundos</span>
              </label>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-colors">
            Guardar Cambios
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Casilla Label Modal ───────────────────────────────────────────────────────
function CasillaLabelModal({ currentLabel, onSave, onClose }: { currentLabel: string; onSave: (label: string) => void; onClose: () => void }) {
  const [label, setLabel] = useState(currentLabel || 'Etiqueta de casilla');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900">Editar Etiqueta para &quot;Casilla&quot;</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-4 mt-0.5">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-5">Define la etiqueta que se mostrará junto a la casilla de verificación.</p>
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Etiqueta</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            placeholder="Etiqueta de casilla"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => { onSave(label.trim() || 'Casilla'); onClose(); }}
            className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            Guardar Cambios
          </button>
        </div>
      </div>
    </div>
  );
}

function DraggableField({ icon, label, required, participantId, participantName, colorHex, placementKind, cryptographicType, onClickPlace, disabled }: { icon: React.ReactNode; label: string; required?: boolean; participantId?: string; participantName?: string; colorHex?: string; placementKind?: PlacedField['placementKind']; cryptographicType?: CryptographicElementType; onClickPlace?: () => void; disabled?: boolean }) {
  const handleDragStart = (e: React.DragEvent) => {
    if (disabled) { e.preventDefault(); return; }
    e.dataTransfer.setData('application/json', JSON.stringify({ label, participantId, participantName, colorHex, placementKind, cryptographicType }));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && onClickPlace) onClickPlace();
  };
  return (
    <div
      draggable={!disabled}
      onDragStart={handleDragStart}
      onClick={handleClick}
      title={disabled ? 'Este elemento ya está colocado en el documento' : undefined}
      className={`flex items-center gap-2.5 border rounded-lg px-3 py-2.5 select-none transition-colors ${disabled ? 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-50' : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm cursor-grab active:cursor-grabbing'}`}
    >
      {icon}
      <span className="text-sm text-gray-700 flex-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</span>
      {disabled ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
      ) : (
        <span className="text-gray-300 text-base leading-none shrink-0 select-none" style={{ letterSpacing: '0.05em' }}>⠿</span>
      )}
    </div>
  );
}

// ── Dropdown Options Modal ────────────────────────────────────────────────────
function DropdownOptionsModal({ fieldLabel, options, onSave, onClose }: { fieldLabel: string; options: string[]; onSave: (opts: string[]) => void; onClose: () => void }) {
  const [localOptions, setLocalOptions] = useState<string[]>(options.length > 0 ? [...options] : ['Opción A', 'Opción B']);
  const [newOption, setNewOption] = useState('');

  const handleAdd = () => {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    setLocalOptions((prev) => [...prev, trimmed]);
    setNewOption('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
  };

  const handleRemove = (idx: number) => {
    setLocalOptions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleChange = (idx: number, value: string) => {
    setLocalOptions((prev) => prev.map((o, i) => (i === idx ? value : o)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900">Editar Opciones para &quot;{fieldLabel}&quot;</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-4 mt-0.5">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-5">Define las opciones que el participante podrá seleccionar.</p>
        <div className="space-y-2 mb-4">
          {localOptions.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={opt}
                onChange={(e) => handleChange(idx, e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <button type="button" onClick={() => handleRemove(idx)} className="text-gray-400 hover:text-red-500 transition-colors p-1">
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mb-6">
          <input
            type="text"
            value={newOption}
            onChange={(e) => setNewOption(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nueva opción"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-500 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <button
            type="button"
            onClick={handleAdd}
            className="w-10 h-10 flex items-center justify-center bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors shrink-0"
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => { onSave(localOptions.filter((o) => o.trim() !== '')); onClose(); }}
            className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            Guardar Cambios
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper: does this field type have type-specific config?
function hasTypeConfig(label: string): boolean {
  return ['Imagen', 'Número', 'Moneda', 'Fecha', 'Hora'].includes(label);
}

// ── Placed Field Widget ───────────────────────────────────────────────────────
function PlacedFieldWidget({ field, onRemove, onMove, onResize, onUpdateOptions, onUpdateRadioOptions, onUpdateCasillaLabel, onUpdateFieldConfig, onUpdateFieldTypeConfig, userData }: {
  field: PlacedField;
  onRemove: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number, x: number, y: number) => void;
  onUpdateOptions?: (id: string, options: string[]) => void;
  onUpdateRadioOptions?: (id: string, options: string[]) => void;
  onUpdateCasillaLabel?: (id: string, label: string) => void;
  onUpdateFieldConfig?: (id: string, config: { customName: string; showLabelInDocument: boolean }) => void;
  onUpdateFieldTypeConfig?: (id: string, config: PlacedField['fieldTypeConfig']) => void;
  userData?: ParticipantUserData;
}) {
  const [selected, setSelected] = useState(false);
  // Initialize font/style from fieldTypeConfig if previously saved
  const [fontFamily, setFontFamily] = useState(field.fieldTypeConfig?.fontFamily || 'Arial');
  const [fontSize, setFontSize] = useState(field.fieldTypeConfig?.fontSize || 11);
  const [bold, setBold] = useState(field.fieldTypeConfig?.bold || false);
  const [italic, setItalic] = useState(field.fieldTypeConfig?.italic || false);
  const [underline, setUnderline] = useState(field.fieldTypeConfig?.underline || false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showRadioModal, setShowRadioModal] = useState(false);
  const [showCasillaModal, setShowCasillaModal] = useState(false);
  const [showLabelConfigModal, setShowLabelConfigModal] = useState(false);
  const [showTypeConfigModal, setShowTypeConfigModal] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  // Load Google Fonts once
  useEffect(() => {
    const linkId = 'google-fonts-fields';
    if (document.getElementById(linkId)) return;
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Roboto&family=Open+Sans&family=Lato&family=Montserrat&family=Raleway&family=Nunito&family=Poppins&family=Source+Sans+3&family=Merriweather&family=Playfair+Display&family=Oswald&family=PT+Sans&family=PT+Serif&family=Ubuntu&family=Noto+Sans&family=Libre+Baskerville&family=Crimson+Text&family=EB+Garamond&family=Josefin+Sans&family=Quicksand&family=Mulish&family=Barlow&family=Inter&family=DM+Sans&family=Fira+Sans&family=Cabin&family=Exo+2&family=Titillium+Web&family=Zilla+Slab&family=Spectral&family=Cormorant+Garamond&family=Alegreya&family=Lora&family=Arvo&family=Bitter&family=Karla&family=Rubik&family=Work+Sans&family=Manrope&family=Space+Grotesk&family=Plus+Jakarta+Sans&family=Sora&family=Outfit&family=Figtree&family=Lexend&family=Jost&family=Urbanist&family=Archivo&family=Asap&family=Heebo&family=Hind&family=Varela+Round&family=Comfortaa&family=Pacifico&family=Dancing+Script&family=Caveat&family=Sacramento&family=Great+Vibes&family=Satisfy&family=Kaushan+Script&family=Lobster&family=Righteous&family=Fredoka+One&family=Boogaloo&family=Indie+Flower&family=Patrick+Hand&family=Shadows+Into+Light&family=Amatic+SC&family=Permanent+Marker&family=Rock+Salt&family=Special+Elite&family=Courier+Prime&family=Source+Code+Pro&family=Fira+Code&family=Space+Mono&family=Inconsolata&family=Anonymous+Pro&family=Share+Tech+Mono&display=swap';
    document.head.appendChild(link);
  }, []);

  const isDropdown = field.label === 'Desplegable';
  const isRadio = field.label === 'Botones de opción';
  const isFirma = field.label === 'Firma';
  const isCryptographic = field.placementKind === 'cryptographic' || !!field.cryptographicType;
  const isCasilla = field.label === 'Casilla' || (field.casillaLabel !== undefined);
  const isNombreCompleto = field.label === 'Nombre Completo';
  const isRFC = field.label === 'RFC';
  const isCURP = field.label === 'CURP';
  const isCorreo = field.label === 'Correo Electrónico';
  const isTelefono = field.label === 'Número Telefónico';
  const isDireccion = field.label === 'Dirección';
  const hasTypeConfigOption = hasTypeConfig(field.label);

  const colorHex = field.colorHex || '#2dd4bf';

  // Pre-filled value from user data
  const getPrefilledValue = () => {
    if (!userData) return null;
    if (isNombreCompleto) return userData.nombre_completo;
    if (isRFC) return userData.rfc;
    if (isCURP) return userData.curp;
    if (isCorreo) return userData.email;
    if (isTelefono) return userData.telefono;
    if (isDireccion) return userData.direccion;
    return null;
  };
  const prefilledValue = getPrefilledValue();

  // Deselect when clicking outside
  useEffect(() => {
    if (!selected) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        setSelected(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selected]);

  const getContainer = (el: HTMLElement) => el.closest('[data-doc-sheet]') as HTMLElement | null;

  const handleMoveMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setSelected(true);
    const container = getContainer(e.currentTarget as HTMLElement);
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const elRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ox = e.clientX - elRect.left, oy = e.clientY - elRect.top;
    const onMouseMove = (ev: MouseEvent) => {
      let newX = ((ev.clientX - ox - rect.left) / rect.width) * 100;
      let newY = ((ev.clientY - oy - rect.top) / rect.height) * 100;
      onMove(field.id, Math.max(0, Math.min(100 - field.width, newX)), Math.max(0, Math.min(100 - field.height, newY)));
    };
    const onMouseUp = () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
    window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp);
  };

  type ResizeDir = 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 's' | 'n';
  const handleResizeMouseDown = (e: React.MouseEvent, dir: ResizeDir) => {
    e.preventDefault(); e.stopPropagation();
    const container = getContainer(e.currentTarget as HTMLElement);
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const startW = field.width, startH = field.height, startFX = field.x, startFY = field.y;
    const onMouseMove = (ev: MouseEvent) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      let newW = startW, newH = startH, newX = startFX, newY = startFY;
      if (dir.includes('e')) newW = Math.max(5, startW + dx);
      if (dir.includes('s')) newH = Math.max(3, startH + dy);
      if (dir.includes('w')) { newW = Math.max(5, startW - dx); newX = startFX + dx; }
      if (dir.includes('n')) { newH = Math.max(3, startH - dy); newY = startFY + dy; }
      newX = Math.max(0, Math.min(100 - newW, newX)); newY = Math.max(0, Math.min(100 - newH, newY));
      onResize(field.id, newW, newH, newX, newY);
    };
    const onMouseUp = () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
    window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp);
  };

  const handleStyleClass = `absolute w-2.5 h-2.5 bg-white border-2 rounded-sm z-20 hover:opacity-80`;

  const fontFamilies = [
    'Arial', 'Arial Black', 'Times New Roman', 'Georgia', 'Garamond', 'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'Helvetica', 'Palatino',
    'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Raleway', 'Nunito', 'Poppins', 'Source Sans 3', 'Merriweather', 'Playfair Display', 'Oswald', 'PT Sans', 'PT Serif', 'Ubuntu', 'Noto Sans', 'Libre Baskerville', 'Crimson Text', 'EB Garamond', 'Josefin Sans', 'Quicksand', 'Mulish', 'Barlow', 'Inter', 'DM Sans', 'Fira Sans', 'Cabin', 'Exo 2', 'Titillium Web', 'Zilla Slab', 'Spectral', 'Cormorant Garamond', 'Alegreya', 'Lora', 'Arvo', 'Bitter', 'Karla', 'Rubik', 'Work Sans', 'Manrope', 'Space Grotesk', 'Plus Jakarta Sans', 'Sora', 'Outfit', 'Figtree', 'Lexend', 'Jost', 'Urbanist', 'Archivo', 'Asap', 'Heebo', 'Hind', 'Nanum Gothic', 'Varela Round', 'Comfortaa', 'Pacifico', 'Dancing Script', 'Caveat', 'Sacramento', 'Great Vibes', 'Satisfy', 'Kaushan Script', 'Lobster', 'Righteous', 'Fredoka One', 'Boogaloo', 'Indie Flower', 'Patrick Hand', 'Shadows Into Light', 'Amatic SC', 'Permanent Marker', 'Rock Salt', 'Special Elite', 'Courier Prime', 'Source Code Pro', 'Fira Code', 'Space Mono', 'Inconsolata', 'Anonymous Pro', 'Share Tech Mono',
  ];

  const dropdownOptions = field.dropdownOptions && field.dropdownOptions.length > 0 ? field.dropdownOptions : ['Opción A', 'Opción B'];
  const radioOptions = field.radioOptions && field.radioOptions.length > 0 ? field.radioOptions : ['Opción 1', 'Opción 2'];

  // Display name (custom or default)
  const displayName = field.fieldConfig?.customName || field.label;
  const cryptographicPreview: Record<CryptographicElementType, { eyebrow: string; text: string }> = {
    document_chain: { eyebrow: 'CADENA ORIGINAL DOCUBOX', text: '||DOCUBOX_DOCUMENT|1.0| ... Se genera al completar ... ||' },
    document_seal: { eyebrow: 'SELLO DIGITAL DOCUBOX', text: 'SDL-DBX-... · SHA-256 · RSA-PSS-SHA256 · Se genera al completar' },
    timestamp: { eyebrow: 'ESTAMPA DE TIEMPO', text: 'RFC 3161 · TSA verificada · Fecha UTC al completar' },
    evidence_chain: { eyebrow: 'CADENA DE EVIDENCIA', text: '||DOCUBOX_EVIDENCE|1.0| ... Se genera al completar ... ||' },
  };
  const cryptoPreview = field.cryptographicType ? cryptographicPreview[field.cryptographicType] : null;

  return (
    <>
      <div
        ref={widgetRef}
        style={{ left: `${field.x}%`, top: `${field.y}%`, width: `${field.width}%`, height: `${field.height}%` }}
        className="absolute z-10 group"
        onClick={() => setSelected(true)}
      >
        {/* Custom name label above field */}
        {field.fieldConfig?.showLabelInDocument && (
          <div
            className="absolute bottom-full left-0 mb-0.5 text-[8px] font-semibold px-1 py-0.5 rounded whitespace-nowrap pointer-events-none"
            style={{ color: colorHex, background: `${colorHex}18` }}
          >
            {displayName}
          </div>
        )}

        {/* Toolbar — shown when selected */}
        {selected && (
          <div
            className="absolute bottom-full left-0 mb-1 flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg shadow-md px-1.5 py-1 z-30"
            onMouseDown={(e) => e.stopPropagation()}
            style={{ whiteSpace: 'nowrap' }}
          >
            {/* Font family selector — hidden for Firma */}
            {!isFirma && !isCryptographic && (
              <select
                value={fontFamily}
                onChange={(e) => { setFontFamily(e.target.value); onUpdateFieldTypeConfig?.(field.id, { ...(field.fieldTypeConfig || {}), fontFamily: e.target.value }); }}
                className="text-[10px] border border-gray-200 rounded px-1 py-0.5 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400 cursor-pointer"
                style={{ maxWidth: '80px' }}
              >
                {fontFamilies.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            )}

            {/* Font size — hidden for Firma */}
            {!isFirma && !isCryptographic && (
              <select
                value={fontSize}
                onChange={(e) => { setFontSize(Number(e.target.value)); onUpdateFieldTypeConfig?.(field.id, { ...(field.fieldTypeConfig || {}), fontSize: Number(e.target.value) }); }}
                className="text-[10px] border border-gray-200 rounded px-1 py-0.5 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400 cursor-pointer w-10"
              >
                {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}

            {!isFirma && !isCryptographic && <div className="w-px h-4 bg-gray-200 mx-0.5" />}

            {/* Bold — hidden for Firma */}
            {!isFirma && !isCryptographic && (
              <button type="button" onClick={() => { const v = !bold; setBold(v); onUpdateFieldTypeConfig?.(field.id, { ...(field.fieldTypeConfig || {}), bold: v }); }} className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-colors ${bold ? 'bg-teal-100 text-teal-700' : 'text-gray-600 hover:bg-gray-100'}`} title="Negrita">B</button>
            )}
            {!isFirma && !isCryptographic && (
              <button type="button" onClick={() => { const v = !italic; setItalic(v); onUpdateFieldTypeConfig?.(field.id, { ...(field.fieldTypeConfig || {}), italic: v }); }} className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold italic transition-colors ${italic ? 'bg-teal-100 text-teal-700' : 'text-gray-600 hover:bg-gray-100'}`} title="Cursiva">I</button>
            )}
            {!isFirma && !isCryptographic && (
              <button type="button" onClick={() => { const v = !underline; setUnderline(v); onUpdateFieldTypeConfig?.(field.id, { ...(field.fieldTypeConfig || {}), underline: v }); }} className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold underline transition-colors ${underline ? 'bg-teal-100 text-teal-700' : 'text-gray-600 hover:bg-gray-100'}`} title="Subrayado">U</button>
            )}

            {!isFirma && !isCryptographic && <div className="w-px h-4 bg-gray-200 mx-0.5" />}

            {/* Delete */}
            <button type="button" onClick={() => onRemove(field.id)} className="w-6 h-6 flex items-center justify-center rounded bg-red-500 hover:bg-red-600 text-white transition-colors" title="Eliminar campo">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>

            {!isCryptographic && <div className="w-px h-4 bg-gray-200 mx-0.5" />}

            {/* Tag / Label config icon */}
            {!isCryptographic && (
              <button type="button" onClick={(e) => { e.stopPropagation(); setShowLabelConfigModal(true); }} className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 transition-colors" title="Configuración del campo">
                <Tag size={12} />
              </button>
            )}

            {/* Settings / Type config icon — hidden for Imagen and Casilla */}
            {!isCasilla && field.label !== 'Imagen' && (hasTypeConfigOption || isDropdown || isRadio) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isDropdown) setShowOptionsModal(true);
                  else if (isRadio) setShowRadioModal(true);
                  else if (hasTypeConfigOption) setShowTypeConfigModal(true);
                }}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 transition-colors"
                title={isDropdown ? 'Configurar opciones del desplegable' : isRadio ? 'Configurar opciones de botones' : `Configuración de ${field.label}`}
              >
                <Settings size={12} />
              </button>
            )}

            {/* Settings icon for Casilla — edits the visible label text */}
            {isCasilla && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowCasillaModal(true); }}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 transition-colors"
                title="Editar etiqueta visible de la casilla"
              >
                <Settings size={12} />
              </button>
            )}
          </div>
        )}

        {/* ── FIRMA field ── */}
        {isCryptographic && cryptoPreview ? (
          <div
            onMouseDown={handleMoveMouseDown}
            className="h-full w-full cursor-move select-none overflow-hidden rounded border border-blue-300 bg-white/95 px-2 py-1.5 shadow-sm"
          >
            <div className="flex items-center gap-1 text-[7px] font-bold uppercase text-blue-700">
              <ShieldCheck size={9} className="shrink-0" />
              <span className="truncate">{cryptoPreview.eyebrow}</span>
            </div>
            <p className="mt-1 overflow-hidden font-mono text-[6px] leading-[1.35] text-slate-600">{cryptoPreview.text}</p>
          </div>
        ) : isFirma ? (
          <div
            onMouseDown={handleMoveMouseDown}
            className="w-full h-full flex flex-col items-center justify-center cursor-move select-none overflow-hidden relative"
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: `${colorHex}10` }}
          >
            <PenLine size={14} style={{ color: colorHex }} className="mb-0.5 opacity-70" />
            <span className="text-[9px] font-medium" style={{ color: colorHex }}>Firma</span>
          </div>
        ) : isDropdown ? (
          /* ── DESPLEGABLE field ── */
          <div
            onMouseDown={handleMoveMouseDown}
            className="w-full h-full flex items-center px-2 py-1 cursor-move select-none overflow-hidden relative"
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: 'rgba(255,255,255,0.97)' }}
          >
            <span className="flex-1 truncate" style={{ fontFamily, fontSize: `${Math.max(8, fontSize * 0.6)}px`, fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal', textDecoration: underline ? 'underline' : 'none', color: '#374151' }}>
              {dropdownOptions[0]}
            </span>
            <ChevronDown size={10} className="text-gray-400 shrink-0 ml-1" />
          </div>
        ) : isRadio ? (
          /* ── BOTONES DE OPCIÓN field ── */
          <div
            onMouseDown={handleMoveMouseDown}
            className="w-full h-full flex flex-col justify-center px-2 py-1 cursor-move select-none overflow-hidden relative"
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: 'rgba(255,255,255,0.97)' }}
          >
            {radioOptions.slice(0, 3).map((opt, i) => (
              <div key={i} className="flex items-center gap-1">
                <Circle size={8} className="text-gray-400 shrink-0" />
                <span className="truncate" style={{ fontFamily, fontSize: `${Math.max(7, fontSize * 0.55)}px`, color: '#374151' }}>{opt}</span>
              </div>
            ))}
          </div>
        ) : field.label === 'Casilla' ? (
          /* ── CASILLA field ── */
          <div
            onMouseDown={handleMoveMouseDown}
            className="w-full h-full flex items-center gap-1.5 px-2 py-1 cursor-move select-none overflow-hidden relative"
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: 'rgba(255,255,255,0.97)' }}
          >
            <CheckSquare size={10} className="text-gray-400 shrink-0" />
            <span className="truncate flex-1" style={{ fontFamily, fontSize: `${Math.max(8, fontSize * 0.6)}px`, color: '#374151' }}>
              {field.casillaLabel || 'Etiqueta de casilla'}
            </span>
          </div>
        ) : (
          /* ── DEFAULT field (text, pre-filled data, etc.) ── */
          <div
            onMouseDown={handleMoveMouseDown}
            className="w-full h-full flex items-center px-2 py-1 cursor-move select-none overflow-hidden relative"
            style={{ border: `1.5px dashed ${colorHex}`, borderRadius: '4px', background: 'rgba(255,255,255,0.95)' }}
          >
            <span className="truncate flex-1" style={{ fontFamily, fontSize: `${Math.max(8, fontSize * 0.6)}px`, fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal', textDecoration: underline ? 'underline' : 'none', color: '#9ca3af' }}>
              {displayName}
            </span>
          </div>
        )}

        {/* Resize handles — visible on hover or when selected */}
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'nw')} className={`${handleStyleClass} -top-1.5 -left-1.5 cursor-nw-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'ne')} className={`${handleStyleClass} -top-1.5 -right-1.5 cursor-ne-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'sw')} className={`${handleStyleClass} -bottom-1.5 -left-1.5 cursor-sw-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'se')} className={`${handleStyleClass} -bottom-1.5 -right-1.5 cursor-se-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'n')} className={`${handleStyleClass} -top-1.5 left-1/2 -translate-x-1/2 cursor-n-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 's')} className={`${handleStyleClass} -bottom-1.5 left-1/2 -translate-x-1/2 cursor-s-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'w')} className={`${handleStyleClass} top-1/2 -translate-y-1/2 -left-1.5 cursor-w-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
        <div onMouseDown={(e) => handleResizeMouseDown(e, 'e')} className={`${handleStyleClass} top-1/2 -translate-y-1/2 -right-1.5 cursor-e-resize opacity-0 group-hover:opacity-100`} style={{ borderColor: colorHex }} />
      </div>

      {/* Dropdown Options Modal */}
      {showOptionsModal && (
        <DropdownOptionsModal fieldLabel={field.label} options={field.dropdownOptions ?? []} onSave={(opts) => { onUpdateOptions?.(field.id, opts); }} onClose={() => setShowOptionsModal(false)} />
      )}

      {/* Radio Options Modal */}
      {showRadioModal && (
        <DropdownOptionsModal fieldLabel="Botones de opción" options={field.radioOptions ?? []} onSave={(opts) => { onUpdateRadioOptions?.(field.id, opts); }} onClose={() => setShowRadioModal(false)} />
      )}

      {/* Casilla Label Modal */}
      {showCasillaModal && (
        <CasillaLabelModal currentLabel={field.casillaLabel || ''} onSave={(lbl) => { onUpdateCasillaLabel?.(field.id, lbl); }} onClose={() => setShowCasillaModal(false)} />
      )}

      {/* Field Label Config Modal */}
      {showLabelConfigModal && (
        <FieldLabelConfigModal field={field} onSave={(cfg) => { onUpdateFieldConfig?.(field.id, cfg); }} onClose={() => setShowLabelConfigModal(false)} />
      )}

      {/* Field Type Config Modal */}
      {showTypeConfigModal && (
        <FieldTypeConfigModal field={field} onSave={(cfg) => { onUpdateFieldTypeConfig?.(field.id, cfg); }} onClose={() => setShowTypeConfigModal(false)} />
      )}
    </>
  );
}

const DEFAULT_SECURITY: SecuritySettings = {
  vencimientoEnabled: false,
  fechaVencimiento: '',
  recordatorioFrecuencia: '',
  codigoAccesoEnabled: false,
  codigoAcceso: '',
  proteccionAdicionalEnabled: false,
  impedirImpresion: false,
  evitarCopiaTexto: false,
  impedirModificacion: false,
  impedirExtraccion: false,
  evitarMontaje: false,
  legalHoldEnabled: false,
};

// ── Validation helpers ────────────────────────────────────────────────────────
function validateFechaVencimiento(fecha: string): string | null {
  if (!fecha) return 'La fecha de vencimiento es requerida.';
  const selected = new Date(fecha);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (selected <= today) return 'La fecha debe ser posterior a hoy.';
  return null;
}

function validateCodigoAcceso(codigo: string): string | null {
  if (!codigo) return 'El código de acceso es requerido.';
  if (codigo.length < 4) return 'Mínimo 4 caracteres.';
  if (codigo.length > 32) return 'Máximo 32 caracteres.';
  if (!/[A-Za-z0-9!@#$%^&*]/.test(codigo)) return 'Solo letras, números y caracteres especiales.';
  return null;
}

function getPasswordStrength(code: string): { level: 'weak' | 'medium' | 'strong'; label: string; color: string } {
  if (!code) return { level: 'weak', label: '', color: '' };
  let score = 0;
  if (code.length >= 6) score++;
  if (code.length >= 10) score++;
  if (/[A-Z]/.test(code)) score++;
  if (/[0-9]/.test(code)) score++;
  if (/[!@#$%^&*]/.test(code)) score++;
  if (score <= 2) return { level: 'weak', label: 'Débil', color: 'bg-red-400' };
  if (score <= 3) return { level: 'medium', label: 'Media', color: 'bg-amber-400' };
  return { level: 'strong', label: 'Fuerte', color: 'bg-emerald-500' };
}

function SecurityTab({ documentoId }: { documentoId: string }) {
  const supabase = createClient();
  const [security, setSecurity] = useState<SecuritySettings>(DEFAULT_SECURITY);
  const [showCode, setShowCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Real-time validation state
  const [fechaError, setFechaError] = useState<string | null>(null);
  const [fechaTouched, setFechaTouched] = useState(false);
  const [codigoError, setCodigoError] = useState<string | null>(null);
  const [codigoTouched, setCodigoTouched] = useState(false);
  const [codeSavedOk, setCodeSavedOk] = useState(false);

  useEffect(() => {
    const resolveUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) { setUserId(user.id); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) setUserId(session.user.id);
    };
    resolveUser();
  }, []);

  // Load existing settings — query by documento_id only (unique constraint)
  useEffect(() => {
    if (!documentoId) return;
    const load = async () => {
      const { data } = await supabase
        .from('document_security_settings')
        .select('*')
        .eq('documento_id', documentoId)
        .maybeSingle();
      if (data) {
        setSecurity({
          vencimientoEnabled: data.vencimiento_enabled ?? false,
          fechaVencimiento: data.fecha_vencimiento ?? '',
          recordatorioFrecuencia: data.recordatorio_frecuencia ?? '',
          codigoAccesoEnabled: data.codigo_acceso_enabled ?? false,
          codigoAcceso: data.codigo_acceso ?? '',
          proteccionAdicionalEnabled: data.proteccion_adicional_enabled ?? false,
          impedirImpresion: data.impedir_impresion ?? false,
          evitarCopiaTexto: data.evitar_copia_texto ?? false,
          impedirModificacion: data.impedir_modificacion ?? false,
          impedirExtraccion: data.impedir_extraccion ?? false,
          evitarMontaje: data.evitar_montaje ?? false,
          legalHoldEnabled: data.legal_hold_enabled ?? false,
        });
      }
    };
    load();
  }, [documentoId]);

  const writeAuditLog = useCallback(async (action: string, uid?: string, details?: Record<string, unknown>) => {
    const resolvedUid = uid || userId;
    if (!resolvedUid || !documentoId) return;
    try {
      await supabase.from('security_audit_log').insert({
        user_id: resolvedUid,
        documento_id: documentoId,
        action,
        details: details ?? {},
      });
    } catch {
      // silent — audit log failures should not block UX
    }
  }, [userId, documentoId, supabase]);

  const saveToDb = useCallback(async (s: SecuritySettings, auditAction?: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      // Get current user at save time (don't block on userId state)
      let currentUserId = userId;
      if (!currentUserId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) currentUserId = user.id;
        else {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) currentUserId = session.user.id;
        }
      }

      const payload: Record<string, unknown> = {
        documento_id: documentoId,
        vencimiento_enabled: s.vencimientoEnabled,
        fecha_vencimiento: s.fechaVencimiento || null,
        recordatorio_frecuencia: s.recordatorioFrecuencia || null,
        codigo_acceso_enabled: s.codigoAccesoEnabled,
        codigo_acceso: s.codigoAcceso || null,
        proteccion_adicional_enabled: s.proteccionAdicionalEnabled,
        proteccion_participacion_enabled: s.proteccionParticipacionEnabled ?? false,
        impedir_impresion: s.impedirImpresion,
        evitar_copia_texto: s.evitarCopiaTexto,
        impedir_modificacion: s.impedirModificacion,
        impedir_extraccion: s.impedirExtraccion,
        evitar_montaje: s.evitarMontaje,
        legal_hold_enabled: s.legalHoldEnabled,
      };

      if (currentUserId) {
        payload.owner_id = currentUserId;
      }

      const { error } = await supabase
        .from('document_security_settings')
        .upsert(payload, { onConflict: 'documento_id' });
      if (error) throw error;
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
      if (auditAction && currentUserId) await writeAuditLog(auditAction, currentUserId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al guardar';
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }, [documentoId, userId, supabase, writeAuditLog]);

  const update = (patch: Partial<SecuritySettings>, auditAction?: string) => {
    setSecurity((prev) => {
      const next = { ...prev, ...patch };
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => saveToDb(next, auditAction), 800);
      return next;
    });
  };

  // Real-time fecha validation
  const handleFechaChange = (value: string) => {
    setFechaTouched(true);
    setFechaError(validateFechaVencimiento(value));
    update({ fechaVencimiento: value }, value ? 'Vencimiento configurado' : undefined);
  };

  // Real-time código validation
  const handleCodigoChange = (value: string) => {
    setCodigoTouched(true);
    setCodigoError(validateCodigoAcceso(value));
    setSecurity((prev) => ({ ...prev, codigoAcceso: value }));
  };

  const handleSaveCode = async () => {
    setCodigoTouched(true);
    const err = validateCodigoAcceso(security.codigoAcceso);
    setCodigoError(err);
    if (err) return;
    await saveToDb(security, 'Código de acceso establecido');
    setCodeSavedOk(true);
    setTimeout(() => setCodeSavedOk(false), 2500);
  };

  const passwordStrength = getPasswordStrength(security.codigoAcceso);
  const fechaIsValid = fechaTouched && !fechaError && security.fechaVencimiento;

  return (
    <div className="space-y-4">
      {/* Status indicator */}
      {(saving || savedOk || saveError) && (
        <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${saving ? 'bg-blue-50 text-blue-600' : savedOk ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
          {saving && <><svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Guardando...</>}
          {savedOk && <><CheckCircle2 size={12} />Configuración guardada</>}
          {saveError && <span>Error: {saveError}</span>}
        </div>
      )}

      {/* Vencimiento */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <label className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors">
          <input
            type="checkbox"
            checked={security.vencimientoEnabled}
            onChange={(e) => {
              update({ vencimientoEnabled: e.target.checked }, e.target.checked ? 'Protección habilitada' : undefined);
              if (!e.target.checked) { setFechaTouched(false); setFechaError(null); }
            }}
            className="w-4 h-4 rounded accent-primary cursor-pointer"
          />
          <span className="text-sm font-semibold text-primary flex-1">Establecer vencimiento para este documento</span>
        </label>
        {security.vencimientoEnabled && (
          <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3 bg-white">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Fecha de vencimiento</label>
              <div className="relative">
                <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="date"
                  value={security.fechaVencimiento}
                  onChange={(e) => handleFechaChange(e.target.value)}
                  onBlur={() => { setFechaTouched(true); setFechaError(validateFechaVencimiento(security.fechaVencimiento)); }}
                  className={`w-full pl-9 pr-9 py-2.5 border rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 transition-colors ${
                    fechaTouched && fechaError
                      ? 'border-red-400 focus:ring-red-200 focus:border-red-400'
                      : fechaIsValid
                      ? 'border-emerald-400 focus:ring-emerald-200 focus:border-emerald-400' :'border-gray-200 focus:ring-primary/30 focus:border-primary'
                  }`}
                />
                {fechaIsValid && (
                  <CheckCircle2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
                )}
              </div>
              {fechaTouched && fechaError && (
                <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                  <AlertTriangle size={11} />
                  {fechaError}
                </p>
              )}
              {fechaIsValid && (
                <p className="mt-1.5 text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 size={11} />
                  Fecha válida
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Recordatorios automáticos</label>
              <div className="relative">
                <select
                  value={security.recordatorioFrecuencia}
                  onChange={(e) => update({ recordatorioFrecuencia: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none bg-white"
                >
                  <option value="">Seleccione frecuencia...</option>
                  <option value="diario">Diario</option>
                  <option value="cada_2_dias">Cada 2 días</option>
                  <option value="cada_3_dias">Cada 3 días</option>
                  <option value="semanal">Semanal</option>
                  <option value="quincenal">Quincenal</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Código de acceso */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <label className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors">
          <input
            type="checkbox"
            checked={security.codigoAccesoEnabled}
            onChange={(e) => {
              update({ codigoAccesoEnabled: e.target.checked });
              if (!e.target.checked) { setCodigoTouched(false); setCodigoError(null); setCodeSavedOk(false); }
            }}
            className="w-4 h-4 rounded accent-primary cursor-pointer"
          />
          <span className="text-sm font-semibold text-primary flex-1">Establecer un código de acceso</span>
        </label>
        {security.codigoAccesoEnabled && (
          <div className="border-t border-gray-100 px-4 pb-4 pt-3 bg-white space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showCode ? 'text' : 'password'}
                  value={security.codigoAcceso}
                  onChange={(e) => handleCodigoChange(e.target.value)}
                  onBlur={() => { setCodigoTouched(true); setCodigoError(validateCodigoAcceso(security.codigoAcceso)); }}
                  placeholder="Código de acceso"
                  className={`w-full px-3 py-2.5 pr-10 border rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 transition-colors ${
                    codigoTouched && codigoError
                      ? 'border-red-400 focus:ring-red-200 focus:border-red-400'
                      : codigoTouched && !codigoError && security.codigoAcceso
                      ? 'border-emerald-400 focus:ring-emerald-200 focus:border-emerald-400' :'border-gray-200 focus:ring-primary/30 focus:border-primary'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowCode((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showCode ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleSaveCode}
                disabled={saving || !security.codigoAcceso}
                className="px-4 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Guardar
              </button>
            </div>

            {/* Password strength bar */}
            {security.codigoAcceso && (
              <div className="space-y-1">
                <div className="flex gap-1">
                  {(['weak', 'medium', 'strong'] as const).map((level, i) => (
                    <div
                      key={level}
                      className={`h-1.5 flex-1 rounded-full transition-colors ${
                        (passwordStrength.level === 'weak' && i === 0) ||
                        (passwordStrength.level === 'medium' && i <= 1) ||
                        (passwordStrength.level === 'strong' && i <= 2)
                          ? passwordStrength.color
                          : 'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
                {passwordStrength.label && (
                  <p className={`text-xs font-medium ${
                    passwordStrength.level === 'weak' ? 'text-red-500' :
                    passwordStrength.level === 'medium' ? 'text-amber-500' : 'text-emerald-600'
                  }`}>
                    Seguridad: {passwordStrength.label}
                  </p>
                )}
              </div>
            )}

            {/* Validation messages */}
            {codigoTouched && codigoError && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertTriangle size={11} />
                {codigoError}
              </p>
            )}
            {codeSavedOk && (
              <p className="text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 size={11} />
                Código de acceso guardado correctamente
              </p>
            )}
          </div>
        )}
      </div>

      {/* Protección adicional */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <label className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors">
          <input
            type="checkbox"
            checked={security.proteccionAdicionalEnabled}
            onChange={(e) => update({ proteccionAdicionalEnabled: e.target.checked }, e.target.checked ? 'Protección habilitada' : undefined)}
            className="w-4 h-4 rounded accent-primary cursor-pointer"
          />
          <span className="text-sm font-semibold text-primary flex-1">Protección adicional a documento firmado</span>
        </label>
        {security.proteccionAdicionalEnabled && (
          <div className="border-t border-gray-100 px-4 pb-4 pt-3 bg-white space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex gap-2">
              <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700"><span className="font-semibold">¡Atención!</span> Esta acción es irreversible una vez que se envíe el documento.</p>
            </div>
            {[
              { key: 'impedirImpresion' as const, label: 'Impedir la impresión de documentos.' },
              { key: 'evitarCopiaTexto' as const, label: 'Evite la copia de texto e imágenes.' },
              { key: 'impedirModificacion' as const, label: 'Impedir la modificación.' },
              { key: 'impedirExtraccion' as const, label: 'Impedir la extracción de contenido.' },
              { key: 'evitarMontaje' as const, label: 'Evitar el montaje de documentos.' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={security[key]}
                  onChange={(e) => update({ [key]: e.target.checked }, e.target.checked ? 'Protección habilitada' : undefined)}
                  className="w-4 h-4 rounded accent-primary cursor-pointer"
                />
                <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">{label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Legal Hold */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <label className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors">
          <input
            type="checkbox"
            checked={security.legalHoldEnabled}
            onChange={(e) => update({ legalHoldEnabled: e.target.checked }, e.target.checked ? 'Legal Hold agregado' : undefined)}
            className="w-4 h-4 rounded accent-primary cursor-pointer"
          />
          <span className="text-sm font-semibold text-primary flex-1">Proteger contra eliminación (Legal Hold)</span>
          <Lock size={14} className="text-gray-400 shrink-0" />
        </label>
        {security.legalHoldEnabled && (
          <div className="border-t border-gray-100 px-4 pb-3 pt-2 bg-white">
            <p className="text-xs text-gray-500">El documento no podrá ser eliminado mientras el Legal Hold esté activo. Esta protección aplica a todos los participantes y administradores.</p>
          </div>
        )}
      </div>
    </div>
  );
}
export function StepAjustes({ settings, onChange, participants, file, isCondicional, documentoId, securitySettings, onPlacedFieldsChange, onFixarCamposChange, initialFixarCampos, initialPlacedFields }: { settings: DocumentSettings; onChange: (s: DocumentSettings) => void; participants: Participant[]; file: File | null; isCondicional?: boolean; documentoId?: string; securitySettings?: SecuritySettings; onPlacedFieldsChange?: (fields: PlacedField[]) => void; onFixarCamposChange?: (fixar: boolean, hasFirma: boolean) => void; initialFixarCampos?: boolean; initialPlacedFields?: PlacedField[] }) {
  const { user } = useAuth();
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<'campos' | 'seguridad'>('campos');
  const [fixarCampos, setFixarCampos] = useState(isCondicional ? true : (initialFixarCampos ?? false));
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [placedFields, setPlacedFields] = useState<PlacedField[]>(initialPlacedFields ?? []);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [pdfPageImages, setPdfPageImages] = useState<Record<number, string>>({});
  const [pdfLoading, setPdfLoading] = useState(false);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>('');
  const [participantDropdownOpen, setParticipantDropdownOpen] = useState(false);
  const [camposParticipanteOpen, setCamposParticipanteOpen] = useState(true);
  const [camposGeneralesOpen, setCamposGeneralesOpen] = useState(true);
  const [sellosCadenaOpen, setSellosCadenaOpen] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [displayZoom, setDisplayZoom] = useState(100);
  // Map participantId -> user data fetched from DB
  const [participantUserData, setParticipantUserData] = useState<Record<string, ParticipantUserData>>({});
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const docSheetRef = useRef<HTMLDivElement>(null);
  const cryptoPlacementEnabled = !!securitySettings?.selloDigital && securitySettings.selloUbicacion === 'libre';
  const canPlaceFields = fixarCampos || !!isCondicional || cryptoPlacementEnabled;
  const standardPlacedFields = placedFields.filter((field) => field.placementKind !== 'cryptographic');

  // Notify parent when placedFields changes
  useEffect(() => {
    onPlacedFieldsChange?.(placedFields);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedFields]);

  // Keep displayZoom in sync with zoomLevel
  useEffect(() => {
    setDisplayZoom(zoomLevel);
  }, [zoomLevel]);

  const isPdf = file?.name?.toLowerCase().endsWith('.pdf');
  const displayParticipants = participants.length > 0 ? participants : [{ id: 'default-1', name: 'LUIS ALBERTO HERNÁNDEZ', email: '', role: 'firmante' as const }];

  useEffect(() => {
    if (displayParticipants.length > 0 && !selectedParticipantId) setSelectedParticipantId(displayParticipants[0].id);
  }, [displayParticipants, selectedParticipantId]);

  useEffect(() => {
    if (isCondicional) setFixarCampos(true);
  }, [isCondicional]);

  useEffect(() => {
    if (!cryptoPlacementEnabled) {
      setPlacedFields((current) => current.filter((field) => field.placementKind !== 'cryptographic'));
    }
  }, [cryptoPlacementEnabled]);

  // Notify parent about fixarCampos and whether a Firma field exists for ALL firmante participants
  useEffect(() => {
    const firmanteParticipants = displayParticipants.filter((p) => (p.acto || '').toLowerCase() === 'firmante' || participants.length === 0);
    const hasFirmaForAll = firmanteParticipants.length === 0 || firmanteParticipants.every((p) =>
      placedFields.some((f) => f.label === 'Firma' && f.participantId === p.id)
    );
    const hasFirma = placedFields.some((f) => f.label === 'Firma');
    // If all participants are firmantes, require firma for all; otherwise just require at least one
    const allAreFirmantes = participants.length > 0 && participants.every((p) => (p.acto || '').toLowerCase() === 'firmante');
    onFixarCamposChange?.(fixarCampos || !!isCondicional, allAreFirmantes ? hasFirmaForAll : hasFirma);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixarCampos, placedFields, isCondicional, participants]);

  // Save placed fields to Supabase whenever they change
  const saveFieldsToSupabase = useCallback(async (fields: PlacedField[]) => {
    if (!documentoId) return;
    try {
      const camposSolicitados = fields.map((f) => ({
        id: f.id,
        label: f.label,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        page: f.page || 1,
        participantId: f.participantId || null,
        participantName: f.participantName || null,
        colorHex: f.colorHex || null,
        placementKind: f.placementKind || null,
        cryptographicType: f.cryptographicType || null,
        generatedOnCompletion: f.generatedOnCompletion ?? false,
        dropdownOptions: f.dropdownOptions || null,
        radioOptions: f.radioOptions || null,
        casillaLabel: f.casillaLabel || null,
        fieldConfig: f.fieldConfig || null,
        fieldTypeConfig: f.fieldTypeConfig || null,
      }));
      // Update by documento_id (the string identifier) — only updates if the record already exists
      await supabase
        .from('documentos')
        .update({ campos_solicitados: camposSolicitados })
        .eq('documento_id', documentoId);
    } catch { /* silent */ }
  }, [documentoId, supabase]);

  // Debounced save to Supabase when fields change
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!documentoId) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveFieldsToSupabase(placedFields);
    }, 600);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedFields, documentoId]);

  // Fetch user data for the current user (first participant = "yo")
  useEffect(() => {
    if (!user?.id) return;
    const fetchUserData = async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('full_name, rfc, curp, email, telefono, calle, num_exterior, num_interior, colonia, municipio, estado, codigo_postal')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        // Build address string from components
        const addressParts = [
          data.calle,
          data.num_exterior ? `#${data.num_exterior}` : null,
          data.num_interior ? `Int. ${data.num_interior}` : null,
          data.colonia,
          data.municipio,
          data.estado,
          data.codigo_postal,
        ].filter(Boolean);
        const direccion = addressParts.length > 0 ? addressParts.join(', ') : undefined;

        const userData: ParticipantUserData = {
          nombre_completo: data.full_name,
          rfc: data.rfc,
          curp: data.curp,
          email: data.email,
          telefono: data.telefono,
          direccion,
        };

        // Map user data to the first real participant (creator) if participants are loaded,
        // otherwise fall back to the default placeholder id
        const targetParticipants = participants.length > 0 ? participants : [{ id: 'default-1' }];
        const firstParticipant = targetParticipants[0];
        if (firstParticipant) {
          setParticipantUserData((prev) => ({
            ...prev,
            [firstParticipant.id]: userData,
          }));
        }
      }
    };
    fetchUserData();
  // Re-run when user changes OR when participants list changes (so real IDs are used once loaded)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, participants]);

  const selectedParticipant = displayParticipants.find((p) => p.id === selectedParticipantId) || displayParticipants[0];
  const selectedParticipantIdx = displayParticipants.findIndex((p) => p.id === selectedParticipant?.id);
  const selectedColorHex = PARTICIPANT_COLORS_HEX[selectedParticipantIdx % PARTICIPANT_COLORS_HEX.length];
  const selectedColor = PARTICIPANT_COLORS[selectedParticipantIdx % PARTICIPANT_COLORS.length];

  useEffect(() => {
    if (!file || !isPdf) return;
    const url = URL.createObjectURL(file);
    setPdfObjectUrl(url); setPdfLoading(true); setPdfPageImages({}); setCurrentPage(1);
    const loadPdf = async () => {
      try {
        let pdfjsLib = (window as any).pdfjsLib;
        if (!pdfjsLib) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.onload = () => resolve(); script.onerror = reject;
            document.head.appendChild(script);
          });
          pdfjsLib = (window as any).pdfjsLib;
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        const pdf = await pdfjsLib.getDocument(url).promise;
        setTotalPages(pdf.numPages);
        const maxPages = Math.min(pdf.numPages, 50);
        const images: Record<number, string> = {};
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width; canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          images[i] = canvas.toDataURL('image/jpeg', 0.85);
        }
        setPdfPageImages(images);
      } catch { /* silently fail */ }
      finally { setPdfLoading(false); }
    };
    loadPdf();
    return () => URL.revokeObjectURL(url);
  }, [file, isPdf]);

  const participantFields = [
    { icon: <PenLine size={15} className="text-gray-400" />, label: 'Firma', required: true },
    { icon: <User size={15} className="text-gray-400" />, label: 'Nombre Completo' },
    { icon: <FileText size={15} className="text-gray-400" />, label: 'RFC' },
    { icon: <User size={15} className="text-gray-400" />, label: 'CURP' },
    { icon: <Mail size={15} className="text-gray-400" />, label: 'Correo Electrónico' },
    { icon: <Phone size={15} className="text-gray-400" />, label: 'Número Telefónico' },
    { icon: <MapPin size={15} className="text-gray-400" />, label: 'Dirección' },
  ];

  const generalFields = [
    { icon: <AlignLeft size={15} className="text-gray-400" />, label: 'Texto' },
    { icon: <Calendar size={15} className="text-gray-400" />, label: 'Fecha' },
    { icon: <Clock size={15} className="text-gray-400" />, label: 'Hora' },
    { icon: <Hash size={15} className="text-gray-400" />, label: 'Número' },
    { icon: <CheckSquare size={15} className="text-gray-400" />, label: 'Casilla' },
    { icon: <Image size={15} className="text-gray-400" />, label: 'Imagen' },
    { icon: <DollarSign size={15} className="text-gray-400" />, label: 'Moneda' },
    { icon: <List size={15} className="text-gray-400" />, label: 'Botones de opción' },
    { icon: <ChevronDown size={15} className="text-gray-400" />, label: 'Desplegable' },
  ];

  const cryptographicFields: Array<{ icon: React.ReactNode; label: string; type: CryptographicElementType }> = [
    { icon: <ScrollText size={15} className="text-blue-500" />, label: 'Cadena original', type: 'document_chain' },
    { icon: <Fingerprint size={15} className="text-blue-500" />, label: 'Sello digital', type: 'document_seal' },
    { icon: <Timer size={15} className="text-blue-500" />, label: 'Estampa de tiempo', type: 'timestamp' },
    { icon: <Link2 size={15} className="text-blue-500" />, label: 'Cadena de evidencia', type: 'evidence_chain' },
  ];

  const getCryptographicDimensions = (type: CryptographicElementType) => {
    if (type === 'document_chain' || type === 'evidence_chain') return { width: 72, height: 12 };
    if (type === 'document_seal') return { width: 54, height: 14 };
    return { width: 42, height: 9 };
  };

  const handleClickPlaceCrypto = (label: string, cryptographicType: CryptographicElementType) => {
    if (placedFields.some((field) => field.cryptographicType === cryptographicType)) return;
    const { width, height } = getCryptographicDimensions(cryptographicType);
    setPlacedFields((prev) => [
      ...prev,
      {
        id: `crypto-${cryptographicType}-${Date.now()}`,
        label,
        icon: null,
        x: Math.max(2, 50 - width / 2),
        y: Math.max(2, 50 - height / 2),
        width,
        height,
        page: currentPage,
        color: 'bg-blue-500',
        colorHex: '#1E6BFF',
        placementKind: 'cryptographic',
        cryptographicType,
        generatedOnCompletion: true,
      },
    ]);
  };

  const handleClickPlace = (label: string, required?: boolean) => {
    // Restrict Firma field to one per participant
    if (label === 'Firma') {
      const participantId = selectedParticipant?.id;
      const alreadyHasFirma = placedFields.some((f) => f.label === 'Firma' && f.participantId === participantId);
      if (alreadyHasFirma) return;
    }
    // Place field at center of the document preview on the current page
    const x = 50 - 8; // center minus half width (16/2)
    const y = 50 - 2; // center minus half height (4/2)
    setPlacedFields((prev) => [
      ...prev,
      {
        id: `field-${Date.now()}-${Math.random()}`,
        label,
        icon: null,
        x: Math.max(0, Math.min(84, x)),
        y: Math.max(0, Math.min(96, y)),
        width: 16,
        height: label === 'Botones de opción' ? 7 : 4,
        page: currentPage,
        participantId: selectedParticipant?.id,
        participantName: selectedParticipant?.name,
        color: selectedColor,
        colorHex: selectedColorHex,
      },
    ]);
    // Scroll the drop zone to show the placed field (center of document)
    setTimeout(() => {
      if (dropZoneRef.current) {
        const dropZone = dropZoneRef.current;
        const scrollTop = dropZone.scrollHeight * 0.5 - dropZone.clientHeight / 2;
        dropZone.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
      }
    }, 50);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { label: string; participantId?: string; participantName?: string; colorHex?: string; placementKind?: PlacedField['placementKind']; cryptographicType?: CryptographicElementType };
      if (data.placementKind === 'cryptographic' && data.cryptographicType && placedFields.some((field) => field.cryptographicType === data.cryptographicType)) return;
      // Restrict Firma field to one per participant
      if (data.label === 'Firma') {
        const alreadyHasFirma = placedFields.some((f) => f.label === 'Firma' && f.participantId === data.participantId);
        if (alreadyHasFirma) return;
      }
      const rect = docSheetRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      const dimensions = data.cryptographicType
        ? getCryptographicDimensions(data.cryptographicType)
        : { width: 16, height: data.label.startsWith('Botones') ? 7 : 4 };
      setPlacedFields((prev) => [...prev, {
        id: `field-${Date.now()}-${Math.random()}`,
        label: data.label,
        icon: null,
        x: Math.max(0, Math.min(100 - dimensions.width, x - dimensions.width / 2)),
        y: Math.max(0, Math.min(100 - dimensions.height, y - dimensions.height / 2)),
        width: dimensions.width,
        height: dimensions.height,
        page: currentPage,
        participantId: data.participantId,
        participantName: data.participantName,
        color: selectedColor,
        colorHex: data.colorHex || selectedColorHex,
        placementKind: data.placementKind,
        cryptographicType: data.cryptographicType,
        generatedOnCompletion: data.placementKind === 'cryptographic',
      }]);
    } catch { /* ignore */ }
  };

  return (
    <div className="w-full flex gap-6">
      {/* LEFT PANEL — scrollable independently */}
      <div className="w-[38%] flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-220px)]">
        {/* Field settings */}
        <div className="rounded-lg border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="mb-4">
            <h2 className="text-base font-700 text-slate-950">Configuración de campos</h2>
            <p className="mt-1 text-sm leading-5 text-slate-500">Define si los participantes deben completar información dentro del documento.</p>
          </div>
          <label className={`flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 transition-colors ${isCondicional ? 'cursor-not-allowed opacity-80' : 'cursor-pointer hover:border-slate-300 hover:bg-slate-50'}`}>
            <input type="checkbox" checked={isCondicional ? true : fixarCampos} onChange={(e) => { if (!isCondicional) { if (!e.target.checked && standardPlacedFields.length > 0) { setShowDeleteConfirm(true); } else { setFixarCampos(e.target.checked); } } }} disabled={isCondicional} className="mt-0.5 h-4 w-4 shrink-0 rounded accent-primary cursor-pointer disabled:cursor-not-allowed" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-600 text-slate-800">Asignar campos a participantes</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">Coloca firmas, texto y otros datos en la vista previa.</span>
            </span>
            <Info size={14} className="mt-0.5 shrink-0 text-slate-400" />
          </label>
          {isCondicional ? (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2">
              <Info size={16} className="text-blue-500 shrink-0" />
              <div>
                <p className="text-sm font-600 text-blue-700">Modo condicional</p>
                <p className="mt-0.5 text-xs leading-5 text-blue-600">La asignación de campos es obligatoria para asegurar el funcionamiento correcto del flujo de trabajo.</p>
              </div>
            </div>
          ) : fixarCampos ? (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2">
              <Info size={16} className="text-blue-500 shrink-0" />
              <div>
                <p className="text-sm font-600 text-blue-700">Campos obligatorios</p>
                <p className="mt-0.5 text-xs leading-5 text-blue-600">Los participantes deberán completar todos los campos asignados en el documento.</p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Campos por Participante — only visible when fixarCampos is active */}
        {(fixarCampos || isCondicional) && (
        <div className="rounded-lg border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="mb-4">
            <h2 className="text-base font-700 text-slate-950">Campos por participante</h2>
            <p className="mt-1 text-sm leading-5 text-slate-500">Selecciona una persona y coloca los campos que deberá completar.</p>
          </div>

          {/* Participant selector */}
          <div className="relative mb-4">
            <button type="button" onClick={() => setParticipantDropdownOpen((v) => !v)} className="flex items-center gap-1.5 border rounded-lg px-3 py-2 bg-white hover:bg-gray-50 transition-colors w-full" style={{ borderColor: selectedColorHex }}>
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selectedColorHex }} />
              <span className="text-sm font-medium text-gray-800 flex-1 truncate">
                {selectedParticipant?.name || 'Seleccionar participante'}
                {selectedParticipant?.acto ? ` (${selectedParticipant.acto})` : ''}
                {selectedParticipantIdx === 0 && participants.length > 0 && !selectedParticipant?.acto ? ' (tú)' : ''}
              </span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${participantDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {participantDropdownOpen && (
              <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                {displayParticipants.map((p, idx) => {
                  const colorHex = PARTICIPANT_COLORS_HEX[idx % PARTICIPANT_COLORS_HEX.length];
                  return (
                    <button key={p.id} type="button" onClick={() => {
                      setSelectedParticipantId(p.id);
                      setParticipantDropdownOpen(false);
                      // Collapse both accordions when switching participant
                      setCamposParticipanteOpen(false);
                      setCamposGeneralesOpen(false);
                    }} className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors ${selectedParticipantId === p.id ? 'bg-primary/5' : ''}`}>
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colorHex }} />
                      {selectedParticipantId === p.id && <svg className="w-4 h-4 text-gray-700 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                      {selectedParticipantId !== p.id && <span className="w-4 flex-shrink-0" />}
                      <span className="text-sm text-gray-700">
                        {p.name}
                        {p.acto ? ` (${p.acto})` : (idx === 0 && participants.length > 0 ? ' (tú)' : '')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Campos del Participante accordion */}
          <div className="border border-gray-200 rounded-lg overflow-hidden mb-2">
            <button type="button" onClick={() => setCamposParticipanteOpen((v) => !v)} className="w-full flex items-center gap-1.5 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-2 w-full">
                <span className="flex-1 text-sm font-600 text-gray-800">Campos del participante</span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${camposParticipanteOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {camposParticipanteOpen && (
              <div className="border-t border-gray-200 px-4 pb-4 space-y-2 pt-2">
                {participantFields.map((field) => (
                  <DraggableField key={`${selectedParticipant?.id}-${field.label}`} icon={field.icon} label={field.label} required={field.required} participantId={selectedParticipant?.id} participantName={selectedParticipant?.name} colorHex={selectedColorHex} onClickPlace={() => handleClickPlace(field.label, field.required)} disabled={field.label === 'Firma' && placedFields.some((f) => f.label === 'Firma' && f.participantId === selectedParticipant?.id)} />
                ))}
              </div>
            )}
          </div>

          {/* Campos Generales accordion */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button type="button" onClick={() => setCamposGeneralesOpen((v) => !v)} className="w-full flex items-center gap-1.5 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-2 w-full">
                <span className="flex-1 text-sm font-600 text-gray-800">Campos generales</span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${camposGeneralesOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {camposGeneralesOpen && (
              <div className="border-t border-gray-200 px-4 pb-4 space-y-2 pt-2">
                {generalFields.map((field) => (
                  <DraggableField key={`${selectedParticipant?.id}-general-${field.label}`} icon={field.icon} label={field.label} participantId={selectedParticipant?.id} participantName={selectedParticipant?.name} colorHex={selectedColorHex} onClickPlace={() => handleClickPlace(field.label)} />
                ))}
              </div>
            )}
          </div>

          {/* Placed fields summary */}
          {standardPlacedFields.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900">Campos colocados ({standardPlacedFields.length})</h3>
                <button onClick={() => setPlacedFields((current) => current.filter((field) => field.placementKind === 'cryptographic'))} className="text-xs text-red-500 hover:text-red-700 transition-colors">Limpiar todo</button>
              </div>
              <div className="space-y-1.5">
                {standardPlacedFields.map((field) => (
                  <div key={field.id} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: field.colorHex || '#9ca3af' }} />
                    <span className="flex-1 font-medium">{field.label}</span>
                    <span className="text-gray-400 shrink-0">Pág. {field.page ?? 1}</span>
                    {field.participantName && <span className="text-gray-400 truncate max-w-[60px]">{field.participantName.split(' ')[0]}</span>}
                    <button onClick={() => setPlacedFields((prev) => prev.filter((x) => x.id !== field.id))} className="text-gray-400 hover:text-red-500 transition-colors"><X size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {cryptoPlacementEnabled && (
          <div className="rounded-lg border border-blue-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <ShieldCheck size={18} />
              </div>
              <div>
                <h2 className="text-base font-700 text-slate-950">Sellos y cadena</h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">Coloca la evidencia visible. Los valores criptográficos se generan al completar el documento.</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200">
              <button type="button" onClick={() => setSellosCadenaOpen((value) => !value)} className="flex w-full items-center gap-2 px-4 py-3.5 text-left transition-colors hover:bg-slate-50">
                <span className="flex-1 text-sm font-600 text-slate-800">Elementos disponibles</span>
                <ChevronDown size={16} className={`text-slate-400 transition-transform ${sellosCadenaOpen ? 'rotate-180' : ''}`} />
              </button>
              {sellosCadenaOpen && (
                <div className="space-y-2 border-t border-slate-200 px-4 pb-4 pt-3">
                  {cryptographicFields.map((field) => {
                    const alreadyPlaced = placedFields.some((placed) => placed.cryptographicType === field.type);
                    return (
                      <DraggableField
                        key={field.type}
                        icon={field.icon}
                        label={field.label}
                        colorHex="#1E6BFF"
                        placementKind="cryptographic"
                        cryptographicType={field.type}
                        onClickPlace={() => handleClickPlaceCrypto(field.label, field.type)}
                        disabled={alreadyPlaced}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {placedFields.some((field) => field.placementKind === 'cryptographic') && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Elementos colocados</h3>
                  <span className="text-xs text-slate-400">Máximo uno de cada tipo</span>
                </div>
                <div className="space-y-1.5">
                  {placedFields.filter((field) => field.placementKind === 'cryptographic').map((field) => (
                    <div key={field.id} className="flex items-center gap-2 rounded-lg bg-blue-50/70 px-3 py-2 text-xs text-slate-600">
                      <ShieldCheck size={12} className="shrink-0 text-blue-600" />
                      <span className="flex-1 font-medium">{field.label}</span>
                      <span className="text-slate-400">Pág. {field.page ?? 1}</span>
                      <button type="button" onClick={() => setPlacedFields((prev) => prev.filter((item) => item.id !== field.id))} className="text-slate-400 transition-colors hover:text-red-500" title="Eliminar elemento"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Delete confirmation modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-3">¿Eliminar todos los campos?</h3>
              <p className="text-sm text-gray-600 mb-6">Estás a punto de desactivar la fijación de campos. Esta acción eliminará permanentemente todos los campos que has colocado en el documento. ¿Deseas continuar?</p>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlacedFields((current) => current.filter((field) => field.placementKind === 'cryptographic'));
                    setFixarCampos(false);
                    setShowDeleteConfirm(false);
                  }}
                  className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  Sí, eliminar todo
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT PANEL — document preview, fixed height, no scroll on the sheet itself */}
      <div className="flex-1 flex flex-col min-h-0" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <h2 className="text-base font-700 text-slate-950">Vista previa del documento</h2>
            <div className="flex items-center gap-2">
              {canPlaceFields && <span className="mr-2 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-600 text-primary">Arrastra los elementos al documento</span>}
              <button onClick={() => { const next = Math.max(50, zoomLevel - 25); setZoomLevel(next); setDisplayZoom(next); }} disabled={zoomLevel <= 50} title="Reducir zoom" className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"><ZoomOut size={14} /></button>
              <button onClick={() => { setZoomLevel(100); setDisplayZoom(100); }} title="Restablecer zoom" className="min-w-[48px] h-8 px-2 flex items-center justify-center rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">{displayZoom}%</button>
              <button onClick={() => { const next = Math.min(200, zoomLevel + 25); setZoomLevel(next); setDisplayZoom(next); }} disabled={zoomLevel >= 200} title="Aumentar zoom" className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"><ZoomIn size={14} /></button>
            </div>
          </div>
          {/* Scrollable drop zone — the sheet stays fixed width, tabs scroll */}
          <div ref={dropZoneRef} data-pdf-canvas="true"
            onDragOver={canPlaceFields ? handleDragOver : undefined}
            onDragLeave={canPlaceFields ? handleDragLeave : undefined}
            onDrop={canPlaceFields ? handleDrop : undefined}
            className={`flex-1 relative flex items-start justify-center px-4 py-4 transition-colors overflow-auto ${isDragOver ? 'bg-primary/5' : 'bg-gray-100'}`}
          >
            {isDragOver && (
              <div className="absolute inset-4 border-2 border-dashed border-primary rounded-lg z-20 pointer-events-none flex items-center justify-center">
                <div className="bg-white/90 rounded-xl px-6 py-3 shadow-sm"><p className="text-sm font-semibold text-primary">Suelta el campo aquí</p></div>
              </div>
            )}
            <div ref={docSheetRef} data-doc-sheet="true" className="relative bg-white shadow-lg rounded origin-top shrink-0" style={{ width: `${zoomLevel}%`, maxWidth: `${zoomLevel * 8}px`, aspectRatio: '8.5/11' }}>
              {file && isPdf ? (
                pdfLoading ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 rounded bg-gray-50"><FileText size={40} className="text-primary animate-pulse" /><p className="text-sm text-gray-500">Cargando documento…</p></div>
                ) : pdfPageImages[currentPage] ? (
                  <img src={pdfPageImages[currentPage]} alt={`Página ${currentPage} del documento`} className="w-full h-full object-contain rounded pointer-events-none select-none" draggable={false} />
                ) : (
                  <iframe src={`${pdfObjectUrl}#page=${currentPage}&toolbar=0&navpanes=0&scrollbar=0`} className="w-full h-full" title="Vista previa del documento" />
                )
              ) : file ? (
                <div className="w-full h-full flex items-center justify-center bg-gray-800"><div className="text-gray-400 text-sm">No hay documento cargado</div></div>
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-800"><div className="text-gray-400 text-sm">No hay documento cargado</div></div>
              )}
              {placedFields
                .filter((field) => (field.page ?? 1) === currentPage)
                .map((field) => (
                <PlacedFieldWidget key={field.id} field={field} onRemove={(id) => setPlacedFields((prev) => prev.filter((x) => x.id !== id))} onMove={(id, x, y) => setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, x, y } : f))} onResize={(id, width, height, x, y) => setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, width, height, x, y } : f))} onUpdateOptions={(id, opts) => setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, dropdownOptions: opts } : f))} onUpdateRadioOptions={(id, opts) => setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, radioOptions: opts } : f))} onUpdateCasillaLabel={(id, lbl) => setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, casillaLabel: lbl } : f))} onUpdateFieldConfig={(id, cfg) => setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, fieldConfig: cfg } : f))} onUpdateFieldTypeConfig={(id, cfg) => setPlacedFields((prev) => prev.map((f) => f.id === id ? { ...f, fieldTypeConfig: cfg } : f))} userData={field.participantId ? participantUserData[field.participantId] : undefined} />
              ))}
            </div>
            {canPlaceFields && placedFields.length === 0 && !isDragOver && (
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-xl px-5 py-3 shadow-sm flex items-center gap-2 pointer-events-none">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 9l4 4L19 7"/>
                  <path d="M9 5l3-3 3 3"/>
                  <path d="M15 19l3-3-3-3"/>
                  <path d="M19 9l-3 3-3 3"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <line x1="12" y1="2" x2="12" y2="22"/>
                </svg>
                <p className="text-xs text-gray-500">Arrastra un elemento desde el panel izquierdo</p>
              </div>
            )}
          </div>
          <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-center gap-3 shrink-0">
            <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronDown size={14} className="rotate-90" />
            </button>
            <span className="text-sm font-600 text-slate-600">Página {currentPage} de {totalPages}</span>
            <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronDown size={14} className="-rotate-90" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
