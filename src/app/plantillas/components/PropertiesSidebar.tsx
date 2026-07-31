'use client';

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { TemplateProperties, VariableField, SignerRole } from '../hooks/useTemplateBuilder';

const CATEGORIES = ['Contratos', 'Convenios', 'Actas', 'Poderes Notariales', 'Facturas', 'Otro'];
const LANGUAGES = ['Español', 'Inglés'];

const FIELD_ICONS: Record<string, string> = {
  text: '📝', date: '📅', signature: '✍️', number: '🔢',
  checkbox: '☑️', email: '📧', company: '🏢', rfc: '🪪', stamp: '🔏',
};

interface PropertiesSidebarProps {
  properties: TemplateProperties;
  fields: VariableField[];
  selectedFieldId: string | null;
  onPropertiesChange: (props: Partial<TemplateProperties>) => void;
  onAddSignerRole: () => void;
  onUpdateSignerRole: (id: string, name: string) => void;
  onRemoveSignerRole: (id: string) => void;
  onUpdateField: (fieldId: string, updates: Partial<VariableField>) => void;
}

export function PropertiesSidebar({
  properties,
  fields,
  selectedFieldId,
  onPropertiesChange,
  onAddSignerRole,
  onUpdateSignerRole,
  onRemoveSignerRole,
  onUpdateField,
}: PropertiesSidebarProps) {
  const selectedField = fields.find((f) => f.fieldId === selectedFieldId);

  return (
    <aside
      style={{ width: '300px', minWidth: '300px' }}
      className="flex flex-col bg-white border-l border-gray-200 h-full overflow-y-auto"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-800">Propiedades de Plantilla</h2>
      </div>

      <div className="flex-1 px-4 py-4 space-y-5">
        {/* Template name */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre de la plantilla</label>
          <input
            type="text"
            value={properties.name}
            onChange={(e) => onPropertiesChange({ name: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Nombre de la plantilla"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Descripción</label>
          <textarea
            value={properties.description}
            onChange={(e) => onPropertiesChange({ description: e.target.value })}
            rows={3}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="Descripción de la plantilla..."
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Categoría</label>
          <select
            value={properties.category}
            onChange={(e) => onPropertiesChange({ category: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Language */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Idioma</label>
          <select
            value={properties.language}
            onChange={(e) => onPropertiesChange({ language: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        {/* Toggles */}
        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <div className="relative mt-0.5">
              <input
                type="checkbox"
                checked={properties.requiresEfirma}
                onChange={(e) => onPropertiesChange({ requiresEfirma: e.target.checked })}
                className="sr-only"
              />
              <div
                className={`w-9 h-5 rounded-full transition-colors ${properties.requiresEfirma ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${properties.requiresEfirma ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-700">Firma electrónica avanzada</p>
              <p className="text-[10px] text-gray-500">Requiere e.firma SAT</p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <div className="relative mt-0.5">
              <input
                type="checkbox"
                checked={properties.requiresNom151}
                onChange={(e) => onPropertiesChange({ requiresNom151: e.target.checked })}
                className="sr-only"
              />
              <div
                className={`w-9 h-5 rounded-full transition-colors ${properties.requiresNom151 ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${properties.requiresNom151 ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-700">Sellado de tiempo NOM-151</p>
              <p className="text-[10px] text-gray-500">Requiere sellado NOM-151-SCFI-2016</p>
            </div>
          </label>
        </div>

        {/* Signer roles */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-600">Roles de Firmantes</label>
            <button
              type="button"
              onClick={onAddSignerRole}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              <Plus size={12} /> Agregar
            </button>
          </div>
          {properties.signerRoles.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Sin roles configurados</p>
          ) : (
            <div className="space-y-2">
              {properties.signerRoles.map((role: SignerRole) => (
                <div key={role.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={role.name}
                    onChange={(e) => onUpdateSignerRole(role.id, e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Nombre del rol"
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveSignerRole(role.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Selected field properties */}
        {selectedField && (
          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-600 mb-3">
              Campo seleccionado: {FIELD_ICONS[selectedField.fieldType]} {selectedField.label}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Etiqueta del campo</label>
                <input
                  type="text"
                  value={selectedField.label}
                  onChange={(e) => onUpdateField(selectedField.fieldId, { label: e.target.value })}
                  className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Asignar a firmante</label>
                <select
                  value={selectedField.assignedTo}
                  onChange={(e) => onUpdateField(selectedField.fieldId, { assignedTo: e.target.value })}
                  className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                >
                  <option value="">Sin asignar</option>
                  {properties.signerRoles.map((r: SignerRole) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedField.required}
                  onChange={(e) => onUpdateField(selectedField.fieldId, { required: e.target.checked })}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-gray-700">Campo obligatorio</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
