'use client';

import React from 'react';
import { GitBranch, Plus, Trash2, X } from 'lucide-react';
import { useFormBuilder, type FormField } from '@/contexts/FormBuilderContext';
import { getFieldTypeLabel } from '@/lib/forms/schema';

import {
  Input,
  NumberInput,
  PanelSection,
  ReadOnlyValue,
  Select,
  Toggle,
  inputClass,
} from './PropertyControls';

export default function FieldProperties() {
  const { state, selectedField, updateField, selectField } = useFormBuilder();
  const update = (updates: Partial<FormField>) => {
    if (selectedField) updateField(selectedField.id, updates);
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-[#E2E8F0] bg-white dark:border-border dark:bg-card">
      <div className="border-b border-[#E2E8F0] px-3 pt-3 dark:border-border">
        <div className="flex items-center justify-between px-1 pb-3">
          <div>
            <p className="text-sm font-semibold text-[#0F172A] dark:text-foreground">Propiedades</p>
            <p className="mt-0.5 text-[11px] text-[#64748B] dark:text-muted-foreground">
              {selectedField ? getFieldTypeLabel(selectedField.type) : 'Campo'}
            </p>
          </div>
          {selectedField && (
            <button
              type="button"
              onClick={() => selectField(null)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#64748B] hover:bg-[#F8FAFC]"
              title="Cerrar propiedades del campo"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {selectedField && (
          <div className="space-y-5">
            <PanelSection key={`${selectedField.id}:contenido`} title="Contenido" defaultOpen>
              <ReadOnlyValue label="Tipo de campo" value={getFieldTypeLabel(selectedField.type)} />
              <Input
                label="Etiqueta"
                value={selectedField.label}
                onChange={(value) =>
                  update({
                    label: value,
                    pdf: {
                      ...selectedField.pdf,
                      show: selectedField.pdf?.show ?? true,
                      label: selectedField.pdf?.label || value,
                    },
                  })
                }
              />
              <Input
                label="Descripción"
                value={selectedField.description || ''}
                onChange={(value) => update({ description: value })}
                multiline
              />
              <Input
                label="Placeholder"
                value={selectedField.placeholder || ''}
                onChange={(value) => update({ placeholder: value })}
              />
              <Input
                label="Nombre interno"
                value={selectedField.slug}
                onChange={(value) => update({ slug: value.toLowerCase().replace(/\s+/g, '_') })}
                mono
              />
            </PanelSection>

            <PanelSection key={`${selectedField.id}:comportamiento`} title="Comportamiento">
              {selectedField.type === 'signature_block' ? (
                <p className="text-xs text-[#64748B] dark:text-muted-foreground">
                  La firma es obligatoria en todos los formularios.
                </p>
              ) : (
                <Toggle
                  label="Campo obligatorio"
                  checked={selectedField.required}
                  onChange={(value) => update({ required: value })}
                />
              )}
              <Toggle
                label="Solo lectura"
                checked={selectedField.readOnly}
                onChange={(value) => update({ readOnly: value })}
              />
              <Toggle
                label="Editable antes de firmar"
                checked={selectedField.editableBeforeSign ?? true}
                onChange={(value) => update({ editableBeforeSign: value })}
              />
              <Select
                label="Sección del formulario"
                value={selectedField.sectionId || ''}
                onChange={(value) =>
                  update({
                    sectionId: value,
                    pdf: {
                      ...selectedField.pdf,
                      show: selectedField.pdf?.show ?? true,
                      sectionId: value,
                    },
                  })
                }
                options={state.template.sections.map((section) => ({
                  value: section.id,
                  label: section.title,
                }))}
              />
            </PanelSection>

            {['select', 'radio', 'checkbox_group', 'yes_no'].includes(selectedField.type) && (
              <PanelSection key={`${selectedField.id}:opciones`} title="Opciones">
                <div className="space-y-2">
                  {(selectedField.options || []).map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        value={option.label}
                        onChange={(event) => {
                          const options = [...(selectedField.options || [])];
                          options[index] = {
                            label: event.target.value,
                            value: event.target.value.toLowerCase().replace(/\s+/g, '_'),
                          };
                          update({ options });
                        }}
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          update({
                            options: (selectedField.options || []).filter(
                              (_, itemIndex) => itemIndex !== index
                            ),
                          })
                        }
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-[#94A3B8] hover:bg-red-50 hover:text-red-600"
                        title="Eliminar opción"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      update({
                        options: [
                          ...(selectedField.options || []),
                          {
                            label: `Opción ${(selectedField.options?.length || 0) + 1}`,
                            value: `opcion_${(selectedField.options?.length || 0) + 1}`,
                          },
                        ],
                      })
                    }
                    className="flex h-8 items-center gap-1.5 text-xs font-medium text-[#1E6BFF]"
                  >
                    <Plus size={13} /> Agregar opción
                  </button>
                </div>
              </PanelSection>
            )}

            {selectedField.type !== 'signature_block' && <PanelSection key={`${selectedField.id}:validacion`} title="Validación">
              <div className="grid grid-cols-2 gap-2">
                <NumberInput
                  label="Mínimo"
                  value={selectedField.minLength ?? selectedField.minValue}
                  onChange={(value) =>
                    update(
                      ['number', 'currency'].includes(selectedField.type)
                        ? { minValue: value }
                        : { minLength: value }
                    )
                  }
                />
                <NumberInput
                  label="Máximo"
                  value={selectedField.maxLength ?? selectedField.maxValue}
                  onChange={(value) =>
                    update(
                      ['number', 'currency'].includes(selectedField.type)
                        ? { maxValue: value }
                        : { maxLength: value }
                    )
                  }
                />
              </div>
              <Input
                label="Expresión regular"
                value={selectedField.regex || ''}
                onChange={(value) => update({ regex: value })}
                mono
              />
              {selectedField.regex && (
                <Input
                  label="Mensaje de validación"
                  value={selectedField.regexError || ''}
                  onChange={(value) => update({ regexError: value })}
                />
              )}
            </PanelSection>}

            {selectedField.type !== 'signature_block' && <PanelSection key={`${selectedField.id}:logica`} title="Lógica condicional" icon={GitBranch}>
              <Toggle
                label="Aplicar condición"
                checked={selectedField.conditionalVisible}
                onChange={(value) => update({ conditionalVisible: value })}
              />
              {selectedField.conditionalVisible && (
                <>
                  <Select
                    label="Acción"
                    value={selectedField.conditionalRule?.action || 'show'}
                    onChange={(value) => update({ conditionalRule: {
                      fieldId: selectedField.conditionalRule?.fieldId || '',
                      operator: selectedField.conditionalRule?.operator || 'eq',
                      value: selectedField.conditionalRule?.value || '',
                      action: value as 'show' | 'hide' | 'require',
                    } })}
                    options={[
                      { value: 'show', label: 'Mostrar si se cumple' },
                      { value: 'hide', label: 'Ocultar si se cumple' },
                      { value: 'require', label: 'Hacer obligatorio si se cumple' },
                    ]}
                  />
                  <Select
                    label="Campo de referencia"
                    value={selectedField.conditionalRule?.fieldId || ''}
                    onChange={(value) =>
                      update({
                        conditionalRule: {
                          fieldId: value,
                          operator: selectedField.conditionalRule?.operator || 'eq',
                          value: selectedField.conditionalRule?.value || '',
                          action: selectedField.conditionalRule?.action || 'show',
                        },
                      })
                    }
                    options={state.template.schema
                      .filter((field) => field.id !== selectedField.id && field.type !== 'signature_block')
                      .map((field) => ({ value: field.id, label: field.label }))}
                  />
                  {!selectedField.conditionalRule?.fieldId && (
                    <p className="text-xs text-amber-700">Selecciona un campo de referencia para completar la condición.</p>
                  )}
                  <Select
                    label="Operador"
                    value={selectedField.conditionalRule?.operator || 'eq'}
                    onChange={(value) =>
                      update({
                        conditionalRule: {
                          fieldId: selectedField.conditionalRule?.fieldId || '',
                          operator: value as NonNullable<FormField['conditionalRule']>['operator'],
                          value: selectedField.conditionalRule?.value || '',
                          action: selectedField.conditionalRule?.action || 'show',
                        },
                      })
                    }
                    options={[
                      { value: 'eq', label: 'Es igual a' },
                      { value: 'neq', label: 'Es distinto de' },
                      { value: 'contains', label: 'Contiene' },
                      { value: 'empty', label: 'Está vacío' },
                      { value: 'not_empty', label: 'No está vacío' },
                    ]}
                  />
                  <Input
                    label="Valor esperado"
                    value={selectedField.conditionalRule?.value || ''}
                    onChange={(value) =>
                      update({
                        conditionalRule: {
                          fieldId: selectedField.conditionalRule?.fieldId || '',
                          operator: selectedField.conditionalRule?.operator || 'eq',
                          value,
                          action: selectedField.conditionalRule?.action || 'show',
                        },
                      })
                    }
                  />
                </>
              )}
            </PanelSection>}

            <PanelSection key={`${selectedField.id}:pdf`} title="Representación en PDF">
              <Toggle
                label="Mostrar en PDF espejo"
                checked={selectedField.pdf?.show ?? true}
                onChange={(value) => update({ pdf: { ...selectedField.pdf, show: value } })}
              />
              <Input
                label="Etiqueta en PDF"
                value={selectedField.pdf?.label || selectedField.label}
                onChange={(value) =>
                  update({
                    pdf: {
                      ...selectedField.pdf,
                      show: selectedField.pdf?.show ?? true,
                      label: value,
                    },
                  })
                }
              />
              <Select
                label="Sección destino en PDF"
                value={selectedField.pdf?.sectionId || selectedField.sectionId || ''}
                onChange={(value) =>
                  update({
                    pdf: {
                      ...selectedField.pdf,
                      show: selectedField.pdf?.show ?? true,
                      sectionId: value,
                    },
                  })
                }
                options={state.template.sections.map((section) => ({
                  value: section.id,
                  label: section.title,
                }))}
              />
              <Toggle
                label="Salto de página antes"
                checked={selectedField.pdf?.pageBreakBefore ?? false}
                onChange={(value) =>
                  update({
                    pdf: {
                      ...selectedField.pdf,
                      show: selectedField.pdf?.show ?? true,
                      pageBreakBefore: value,
                    },
                  })
                }
              />
            </PanelSection>
          </div>
        )}

        {!selectedField && (
          <p className="text-sm text-muted-foreground">Ningún campo seleccionado.</p>
        )}
      </div>
    </aside>
  );
}
