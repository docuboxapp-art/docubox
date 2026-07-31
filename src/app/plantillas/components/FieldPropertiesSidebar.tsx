'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus, Settings } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InsertedField {
  id: string;
  label: string;
  fieldType: string;
  customName: string;
  showLabelInDocument: boolean;
  options: string[];
  pageIndex: number;
  // Type-specific config
  numberFormat?: string;
  numberDecimals?: string;
  timeFormat?: string;
  dateFormat?: string;
  currencySymbol?: string;
  currencyFormat?: string;
  imageWidth?: string;
  imageHeight?: string;
  checkboxDefault?: string;
}

interface FieldPropertiesSidebarProps {
  field: InsertedField | null;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<InsertedField>) => void;
  allFields?: InsertedField[];
  onSelectField?: (id: string) => void;
}

// ─── Field types that support options ────────────────────────────────────────
const TYPES_WITH_OPTIONS = ['Botones de opción', 'Desplegable', 'radio', 'select', 'dropdown'];

// ─── Type-specific config labels ─────────────────────────────────────────────
const NUMBER_FORMATS = ['Decimal', 'Entero', 'Porcentaje', 'Científico'];
const NUMBER_DECIMALS = ['0 decimales', '1 decimal', '2 decimales', '3 decimales', '4 decimales'];
const TIME_FORMATS = ['HH:mm (24 horas)', 'hh:mm AM/PM (12 horas)', 'HH:mm:ss (con segundos)', 'hh:mm:ss AM/PM'];
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD de MMMM de YYYY', 'MMMM DD, YYYY'];
const CURRENCY_SYMBOLS = ['$ (MXN)', '$ (USD)', '€ (EUR)', '£ (GBP)', '¥ (JPY)', 'Personalizado'];
const CURRENCY_FORMATS = ['$1,234.56', '$1.234,56', '1,234.56 $', '1.234,56 $'];
const IMAGE_SIZES = ['Pequeño (100px)', 'Mediano (200px)', 'Grande (300px)', 'Personalizado'];
const CHECKBOX_DEFAULTS = ['Sin marcar', 'Marcado por defecto'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 appearance-none pr-8"
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FieldPropertiesSidebar({ field, onClose, onUpdate, allFields = [], onSelectField }: FieldPropertiesSidebarProps) {
  const [localName, setLocalName] = useState('');
  const [localShowLabel, setLocalShowLabel] = useState(false);
  const [localOptions, setLocalOptions] = useState<string[]>([]);
  const [newOption, setNewOption] = useState('');

  // Type-specific config state
  const [numberFormat, setNumberFormat] = useState('Decimal');
  const [numberDecimals, setNumberDecimals] = useState('2 decimales');
  const [timeFormat, setTimeFormat] = useState('HH:mm (24 horas)');
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [currencySymbol, setCurrencySymbol] = useState('$ (MXN)');
  const [currencyFormat, setCurrencyFormat] = useState('$1,234.56');
  const [imageWidth, setImageWidth] = useState('Mediano (200px)');
  const [checkboxDefault, setCheckboxDefault] = useState('Sin marcar');

  // Sync local state when field changes
  useEffect(() => {
    if (field) {
      setLocalName(field.customName && field.customName !== '' ? field.customName : field.label);
      setLocalShowLabel(field.showLabelInDocument ?? false);
      setLocalOptions(field.options ?? []);
      // Type-specific
      setNumberFormat(field.numberFormat || 'Decimal');
      setNumberDecimals(field.numberDecimals || '2 decimales');
      setTimeFormat(field.timeFormat || 'HH:mm (24 horas)');
      setDateFormat(field.dateFormat || 'DD/MM/YYYY');
      setCurrencySymbol(field.currencySymbol || '$ (MXN)');
      setCurrencyFormat(field.currencyFormat || '$1,234.56');
      setImageWidth(field.imageWidth || 'Mediano (200px)');
      setCheckboxDefault(field.checkboxDefault || 'Sin marcar');
    }
  }, [field?.id]);

  if (!field) {
    return (
      <aside
        style={{ width: '280px', minWidth: '280px' }}
        className="flex flex-col bg-white border-l border-gray-200 h-full overflow-y-auto"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-sm font-semibold text-gray-900">Campos insertados</h2>
        </div>

        {allFields.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
              <Settings size={20} className="text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-700">Sin campos aún</p>
            <p className="text-xs text-gray-400 mt-1">
              Inserta campos desde el panel izquierdo para verlos aquí.
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-1.5">
            {allFields.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onSelectField?.(f.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-colors text-left group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="text-sm text-gray-800 truncate block">
                      {f.customName && f.customName !== f.label ? f.customName : f.label}
                    </span>
                    <span className="text-xs text-gray-400 truncate block">Tipo: {f.label}</span>
                  </div>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0 group-hover:text-blue-500 whitespace-nowrap">
                  Pág. {f.pageIndex + 1}
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>
    );
  }

  const fieldLabel = field.label;
  const hasOptions = TYPES_WITH_OPTIONS.includes(fieldLabel) || TYPES_WITH_OPTIONS.includes(field.fieldType);
  const isNumero = fieldLabel === 'Número';
  const isHora = fieldLabel === 'Hora';
  const isFecha = fieldLabel === 'Fecha';
  const isMoneda = fieldLabel === 'Moneda';
  const isImagen = fieldLabel === 'Imagen';
  const isCasilla = fieldLabel === 'Casilla';
  const hasTypeConfig = isNumero || isHora || isFecha || isMoneda || isImagen || isCasilla;

  const handleNameChange = (val: string) => {
    setLocalName(val);
    onUpdate(field.id, { customName: val });
  };

  const handleShowLabelChange = (val: boolean) => {
    setLocalShowLabel(val);
    onUpdate(field.id, { showLabelInDocument: val });
  };

  const handleAddOption = () => {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    const updated = [...localOptions, trimmed];
    setLocalOptions(updated);
    setNewOption('');
    onUpdate(field.id, { options: updated });
  };

  const handleRemoveOption = (idx: number) => {
    const updated = localOptions.filter((_, i) => i !== idx);
    setLocalOptions(updated);
    onUpdate(field.id, { options: updated });
  };

  const handleOptionChange = (idx: number, val: string) => {
    const updated = localOptions.map((o, i) => (i === idx ? val : o));
    setLocalOptions(updated);
    onUpdate(field.id, { options: updated });
  };

  // Type-specific config title
  const getConfigTitle = () => {
    if (isNumero) return 'Configuración de Número';
    if (isHora) return 'Configuración de Hora';
    if (isFecha) return 'Configuración de Fecha';
    if (isMoneda) return 'Configuración de Moneda';
    if (isImagen) return 'Configuración de Imagen';
    if (isCasilla) return 'Configuración de Casilla';
    return 'Configuración';
  };

  return (
    <aside
      style={{ width: '280px', minWidth: '280px' }}
      className="flex flex-col bg-white border-l border-gray-200 h-full overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Propiedades del campo</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Personaliza el nombre y la visibilidad de la etiqueta para este campo.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition-colors ml-2 mt-0.5 flex-shrink-0"
        >
          <X size={15} />
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* Field name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Nombre del Campo <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={localName}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder={field.label}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          />
          <p className="mt-1.5 text-xs text-blue-600">
            Este nombre identificará el campo en los reportes y validaciones.
          </p>
        </div>

        {/* Show label toggle */}
        <label className="flex items-start gap-3 border border-gray-200 rounded-lg px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors">
          <input
            type="checkbox"
            checked={localShowLabel}
            onChange={(e) => handleShowLabelChange(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-600 cursor-pointer mt-0.5"
          />
          <div>
            <p className="text-sm font-semibold text-gray-800">Mostrar etiqueta en el documento</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Si activas esta opción, el nombre del campo aparecerá visiblemente encima del elemento en el PDF final.
            </p>
          </div>
        </label>

        {/* Options (for radio / dropdown) */}
        {hasOptions && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-800">
                Editar Opciones para &ldquo;{localName || field.label}&rdquo;
              </h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Define las opciones que el participante podrá seleccionar.
            </p>

            <div className="space-y-2">
              {localOptions.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => handleOptionChange(idx, e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveOption(idx)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}

              {/* Add new option */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddOption(); } }}
                  placeholder="Nueva opción"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <button
                  type="button"
                  onClick={handleAddOption}
                  className="w-9 h-9 flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex-shrink-0"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Type-specific configuration */}
        {hasTypeConfig && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">{getConfigTitle()}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Configura las opciones específicas para este tipo de campo.
              </p>
            </div>
            <div className="p-4 space-y-4">
              {/* Número */}
              {isNumero && (
                <>
                  <SelectField
                    label="Formato de número"
                    value={numberFormat}
                    options={NUMBER_FORMATS}
                    onChange={(v) => { setNumberFormat(v); onUpdate(field.id, { numberFormat: v }); }}
                  />
                  <SelectField
                    label="Decimales"
                    value={numberDecimals}
                    options={NUMBER_DECIMALS}
                    onChange={(v) => { setNumberDecimals(v); onUpdate(field.id, { numberDecimals: v }); }}
                  />
                </>
              )}

              {/* Hora */}
              {isHora && (
                <SelectField
                  label="Formato de hora"
                  value={timeFormat}
                  options={TIME_FORMATS}
                  onChange={(v) => { setTimeFormat(v); onUpdate(field.id, { timeFormat: v }); }}
                />
              )}

              {/* Fecha */}
              {isFecha && (
                <SelectField
                  label="Formato de fecha"
                  value={dateFormat}
                  options={DATE_FORMATS}
                  onChange={(v) => { setDateFormat(v); onUpdate(field.id, { dateFormat: v }); }}
                />
              )}

              {/* Moneda */}
              {isMoneda && (
                <>
                  <SelectField
                    label="Símbolo de moneda"
                    value={currencySymbol}
                    options={CURRENCY_SYMBOLS}
                    onChange={(v) => { setCurrencySymbol(v); onUpdate(field.id, { currencySymbol: v }); }}
                  />
                  <SelectField
                    label="Formato de moneda"
                    value={currencyFormat}
                    options={CURRENCY_FORMATS}
                    onChange={(v) => { setCurrencyFormat(v); onUpdate(field.id, { currencyFormat: v }); }}
                  />
                </>
              )}

              {/* Imagen */}
              {isImagen && (
                <SelectField
                  label="Tamaño de imagen"
                  value={imageWidth}
                  options={IMAGE_SIZES}
                  onChange={(v) => { setImageWidth(v); onUpdate(field.id, { imageWidth: v }); }}
                />
              )}

              {/* Casilla */}
              {isCasilla && (
                <SelectField
                  label="Estado por defecto"
                  value={checkboxDefault}
                  options={CHECKBOX_DEFAULTS}
                  onChange={(v) => { setCheckboxDefault(v); onUpdate(field.id, { checkboxDefault: v }); }}
                />
              )}
            </div>
          </div>
        )}

        {/* Page info */}
        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            Página: <span className="font-medium text-gray-600">{field.pageIndex + 1}</span>
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Tipo: <span className="font-medium text-gray-600">{field.label}</span>
          </p>
        </div>
      </div>
    </aside>
  );
}
