'use client';

import React, { useState } from 'react';
import { useFormBuilder, FormField } from '@/contexts/FormBuilderContext';
import { Plus, Trash2, X } from 'lucide-react';

const ESTADOS_MX = [
  'Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas',
  'Chihuahua','Ciudad de México','Coahuila','Colima','Durango','Estado de México',
  'Guanajuato','Guerrero','Hidalgo','Jalisco','Michoacán','Morelos','Nayarit',
  'Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí',
  'Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas',
];

function InputRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-1">
      <span className="text-xs text-foreground">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </button>
    </label>
  );
}

export default function FieldProperties() {
  const { selectedField, updateField, selectField } = useFormBuilder();

  if (!selectedField) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-background border-l border-border">
        <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
          <span className="text-2xl">👆</span>
        </div>
        <p className="text-sm font-medium text-foreground">Selecciona un campo</p>
        <p className="text-xs text-muted-foreground mt-1">
          Haz clic en cualquier campo del canvas para editar sus propiedades.
        </p>
      </div>
    );
  }

  const field = selectedField;
  const update = (updates: Partial<FormField>) => updateField(field.id, updates);

  const hasOptions = ['select', 'radio', 'checkbox_group'].includes(field.type);
  const hasValidation = ['text', 'textarea', 'number', 'email', 'phone', 'rfc', 'curp', 'nss', 'clave_elector'].includes(field.type);
  const hasPdfMapping = true;

  return (
    <div className="h-full overflow-y-auto bg-background border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-background z-10">
        <h2 className="text-sm font-semibold text-foreground">Propiedades</h2>
        <button
          onClick={() => selectField(null)}
          className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* General */}
        <Section title="General">
          <InputRow label="Etiqueta (visible)">
            <input
              type="text"
              value={field.label}
              onChange={(e) => update({ label: e.target.value })}
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </InputRow>

          <InputRow label="Nombre interno (slug)">
            <input
              type="text"
              value={field.slug}
              onChange={(e) => update({ slug: e.target.value.replace(/\s/g, '_').toLowerCase() })}
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
            />
          </InputRow>

          <InputRow label="Placeholder / Texto de ayuda">
            <input
              type="text"
              value={field.placeholder || ''}
              onChange={(e) => update({ placeholder: e.target.value })}
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </InputRow>

          <InputRow label="Descripción debajo del campo">
            <textarea
              value={field.description || ''}
              onChange={(e) => update({ description: e.target.value })}
              rows={2}
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </InputRow>

          <Toggle checked={field.required} onChange={(v) => update({ required: v })} label="Obligatorio" />
          <Toggle checked={field.readOnly} onChange={(v) => update({ readOnly: v })} label="Solo lectura" />
          <Toggle
            checked={field.conditionalVisible}
            onChange={(v) => update({ conditionalVisible: v })}
            label="Visible condicionalmente"
          />
        </Section>

        {/* Conditional Logic */}
        {field.conditionalVisible && (
          <Section title="Lógica Condicional">
            <InputRow label="Campo">
              <input
                type="text"
                value={field.conditionalRule?.fieldId || ''}
                onChange={(e) =>
                  update({ conditionalRule: { ...field.conditionalRule, fieldId: e.target.value, operator: field.conditionalRule?.operator || 'eq', value: field.conditionalRule?.value || '' } })
                }
                placeholder="ID del campo"
                className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </InputRow>
            <InputRow label="Operador">
              <select
                value={field.conditionalRule?.operator || 'eq'}
                onChange={(e) =>
                  update({ conditionalRule: { ...field.conditionalRule, fieldId: field.conditionalRule?.fieldId || '', operator: e.target.value as 'eq' | 'neq' | 'contains' | 'empty' | 'not_empty', value: field.conditionalRule?.value || '' } })
                }
                className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="eq">Igual a</option>
                <option value="neq">Distinto de</option>
                <option value="contains">Contiene</option>
                <option value="empty">Está vacío</option>
                <option value="not_empty">No está vacío</option>
              </select>
            </InputRow>
            <InputRow label="Valor">
              <input
                type="text"
                value={field.conditionalRule?.value || ''}
                onChange={(e) =>
                  update({ conditionalRule: { ...field.conditionalRule, fieldId: field.conditionalRule?.fieldId || '', operator: field.conditionalRule?.operator || 'eq', value: e.target.value } })
                }
                className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </InputRow>
          </Section>
        )}

        {/* Options */}
        {hasOptions && (
          <Section title="Opciones">
            <div className="space-y-2">
              {(field.options || []).map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={opt.label}
                    onChange={(e) => {
                      const opts = [...(field.options || [])];
                      opts[idx] = { ...opts[idx], label: e.target.value, value: e.target.value.toLowerCase().replace(/\s/g, '_') };
                      update({ options: opts });
                    }}
                    className="flex-1 text-sm px-2 py-1 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button
                    onClick={() => {
                      const opts = (field.options || []).filter((_, i) => i !== idx);
                      update({ options: opts });
                    }}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  const opts = [...(field.options || []), { label: `Opción ${(field.options?.length || 0) + 1}`, value: `opcion_${(field.options?.length || 0) + 1}` }];
                  update({ options: opts });
                }}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Plus size={12} /> Agregar opción
              </button>
            </div>
          </Section>
        )}

        {/* Validation */}
        {hasValidation && (
          <Section title="Validación">
            {['text', 'textarea'].includes(field.type) && (
              <>
                <InputRow label="Longitud mínima">
                  <input
                    type="number"
                    value={field.minLength || ''}
                    onChange={(e) => update({ minLength: parseInt(e.target.value) || undefined })}
                    className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </InputRow>
                <InputRow label="Longitud máxima">
                  <input
                    type="number"
                    value={field.maxLength || ''}
                    onChange={(e) => update({ maxLength: parseInt(e.target.value) || undefined })}
                    className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </InputRow>
              </>
            )}
            {field.type === 'number' && (
              <>
                <InputRow label="Valor mínimo">
                  <input
                    type="number"
                    value={field.minValue ?? ''}
                    onChange={(e) => update({ minValue: parseFloat(e.target.value) || undefined })}
                    className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </InputRow>
                <InputRow label="Valor máximo">
                  <input
                    type="number"
                    value={field.maxValue ?? ''}
                    onChange={(e) => update({ maxValue: parseFloat(e.target.value) || undefined })}
                    className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </InputRow>
              </>
            )}
            <InputRow label="Regex personalizado">
              <input
                type="text"
                value={field.regex || ''}
                onChange={(e) => update({ regex: e.target.value })}
                placeholder="^[A-Z]+$"
                className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
              />
            </InputRow>
            {field.regex && (
              <InputRow label="Mensaje de error personalizado">
                <input
                  type="text"
                  value={field.regexError || ''}
                  onChange={(e) => update({ regexError: e.target.value })}
                  className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </InputRow>
            )}
          </Section>
        )}

        {/* Assignment */}
        <Section title="Asignación">
          <InputRow label="¿Quién llena este campo?">
            <select
              value={field.assignedTo || 'any'}
              onChange={(e) => update({ assignedTo: e.target.value as FormField['assignedTo'] })}
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="any">Cualquiera</option>
              <option value="signer1">Firmante 1</option>
              <option value="signer2">Firmante 2</option>
              <option value="all">Todos</option>
            </select>
          </InputRow>
        </Section>

        {/* PDF Mapping */}
        <Section title="Mapeo al PDF">
          <div className="grid grid-cols-2 gap-2">
            <InputRow label="X">
              <input
                type="number"
                value={field.pdfMapping?.x ?? ''}
                onChange={(e) => update({ pdfMapping: { ...field.pdfMapping, x: parseFloat(e.target.value) || 0, y: field.pdfMapping?.y || 0, page: field.pdfMapping?.page || 1, fontSize: field.pdfMapping?.fontSize || 12, color: field.pdfMapping?.color || '#000000' } })}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </InputRow>
            <InputRow label="Y">
              <input
                type="number"
                value={field.pdfMapping?.y ?? ''}
                onChange={(e) => update({ pdfMapping: { ...field.pdfMapping, x: field.pdfMapping?.x || 0, y: parseFloat(e.target.value) || 0, page: field.pdfMapping?.page || 1, fontSize: field.pdfMapping?.fontSize || 12, color: field.pdfMapping?.color || '#000000' } })}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </InputRow>
            <InputRow label="Página">
              <input
                type="number"
                min={1}
                value={field.pdfMapping?.page ?? 1}
                onChange={(e) => update({ pdfMapping: { ...field.pdfMapping, x: field.pdfMapping?.x || 0, y: field.pdfMapping?.y || 0, page: parseInt(e.target.value) || 1, fontSize: field.pdfMapping?.fontSize || 12, color: field.pdfMapping?.color || '#000000' } })}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </InputRow>
            <InputRow label="Tamaño fuente">
              <input
                type="number"
                value={field.pdfMapping?.fontSize ?? 12}
                onChange={(e) => update({ pdfMapping: { ...field.pdfMapping, x: field.pdfMapping?.x || 0, y: field.pdfMapping?.y || 0, page: field.pdfMapping?.page || 1, fontSize: parseInt(e.target.value) || 12, color: field.pdfMapping?.color || '#000000' } })}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </InputRow>
          </div>
          <InputRow label="Color del texto">
            <input
              type="color"
              value={field.pdfMapping?.color || '#000000'}
              onChange={(e) => update({ pdfMapping: { ...field.pdfMapping, x: field.pdfMapping?.x || 0, y: field.pdfMapping?.y || 0, page: field.pdfMapping?.page || 1, fontSize: field.pdfMapping?.fontSize || 12, color: e.target.value } })}
              className="w-full h-8 rounded-lg border border-border cursor-pointer"
            />
          </InputRow>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 pb-1 border-b border-border">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
