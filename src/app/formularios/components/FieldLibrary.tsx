'use client';

import React, { useMemo, useState } from 'react';
import { useFormBuilder, type FieldType } from '@/contexts/FormBuilderContext';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { getFormFieldIcon } from '@/components/forms/field-icons';

interface FieldDefinition {
  type: FieldType;
  label: string;
}

const GROUPS: Array<{ title: string; fields: FieldDefinition[] }> = [
  {
    title: 'Campos básicos',
    fields: [
      { type: 'text', label: 'Texto corto' },
      { type: 'textarea', label: 'Texto largo' },
      { type: 'email', label: 'Correo electrónico' },
      { type: 'phone', label: 'Teléfono' },
      { type: 'number', label: 'Número' },
      { type: 'date', label: 'Fecha' },
      { type: 'currency', label: 'Moneda' },
    ],
  },
  {
    title: 'Selección',
    fields: [
      { type: 'radio', label: 'Opción múltiple' },
      { type: 'checkbox_group', label: 'Casillas' },
      { type: 'select', label: 'Lista desplegable' },
      { type: 'yes_no', label: 'Sí / No' },
    ],
  },
  {
    title: 'Datos documentales',
    fields: [
      { type: 'rfc', label: 'RFC' },
      { type: 'curp', label: 'CURP' },
      { type: 'business_name', label: 'Nombre o denominación social' },
      { type: 'person_first_name', label: 'Nombre' },
      { type: 'person_last_name', label: 'Apellido paterno' },
      { type: 'person_second_last_name', label: 'Apellido materno' },
      { type: 'fiscal_address', label: 'Domicilio' },
      { type: 'imagen', label: 'Carga de imagen' },
    ],
  },
  {
    title: 'Legal y consentimiento',
    fields: [
      { type: 'consentimiento', label: 'Consentimiento' },
      { type: 'declaration', label: 'Declaración bajo protesta' },
      { type: 'signature_block', label: 'Firma' },
    ],
  },
  {
    title: 'Contenido',
    fields: [
      { type: 'texto_bloque', label: 'Texto informativo' },
      { type: 'divider', label: 'Separador' },
      { type: 'iniciales', label: 'Iniciales' },
    ],
  },
];

export default function FieldLibrary() {
  const { addField, state } = useFormBuilder();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const normalizedQuery = query.trim().toLowerCase();

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        fields: group.fields.filter((field) =>
          field.label.toLowerCase().includes(normalizedQuery) &&
          (field.type !== 'signature_block' ||
            (state.template.settings.requiresSignature &&
              !state.template.schema.some((item) => item.type === 'signature_block')))
        ),
      })).filter((group) => group.fields.length > 0),
    [normalizedQuery, state.template.settings.requiresSignature, state.template.schema]
  );

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-border dark:bg-card">
      <div className="border-b border-slate-200 bg-white px-4 py-4 dark:border-border dark:bg-card">
        <p className="text-sm font-medium text-slate-950 dark:text-foreground">Agregar contenido</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">
          Selecciona un campo para insertarlo.
        </p>
        <div className="relative mt-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar campos"
            className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-muted dark:text-foreground"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {groups.map((group) => {
          const isCollapsed = collapsed[group.title] && !normalizedQuery;
          return (
            <section
              key={group.title}
              className="mb-2 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card"
            >
              <button
                type="button"
                onClick={() =>
                  setCollapsed((current) => ({ ...current, [group.title]: !current[group.title] }))
                }
                className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm font-medium text-slate-900 hover:bg-slate-50 dark:text-foreground dark:hover:bg-muted"
              >
                {group.title}
                <ChevronDown
                  size={15}
                  className={`text-slate-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                />
              </button>
              {!isCollapsed && (
                <div className="space-y-1 border-t border-slate-200 px-2 py-2 dark:border-border">
                  {group.fields.map((field) => {
                    const FieldIcon = getFormFieldIcon(field.type);
                    return (
                      <button
                        key={field.type}
                        type="button"
                        onClick={() => addField(field.type)}
                        className="group flex min-h-9 w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50 dark:border-border dark:bg-card dark:hover:bg-muted"
                      >
                        <FieldIcon size={15} className="shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1 !text-xs !font-normal text-slate-700 dark:text-foreground">
                          {field.label}
                        </span>
                        <Plus
                          size={13}
                          className="shrink-0 text-slate-300 group-hover:text-primary"
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
