'use client';

import React, { useMemo, useState } from 'react';
import { useFormBuilder, type FieldType } from '@/contexts/FormBuilderContext';
import {
  AlignLeft, BadgeDollarSign, BriefcaseBusiness, Calendar, CheckSquare, ChevronDown,
  ChevronRight, CircleDot, FileCheck2, FileText, FileUp, Fingerprint, Hash, Image,
  Landmark, ListChecks, Mail, MapPinned, Minus, MousePointerClick, PenLine, Phone,
  Scale, Search, ShieldCheck, Type, UserRoundCheck, WalletCards,
} from 'lucide-react';

interface FieldDefinition {
  type: FieldType;
  label: string;
  icon: React.ElementType;
}

const GROUPS: Array<{ title: string; fields: FieldDefinition[] }> = [
  {
    title: 'Campos básicos',
    fields: [
      { type: 'text', label: 'Texto corto', icon: Type },
      { type: 'textarea', label: 'Texto largo', icon: AlignLeft },
      { type: 'email', label: 'Correo electrónico', icon: Mail },
      { type: 'phone', label: 'Teléfono', icon: Phone },
      { type: 'number', label: 'Número', icon: Hash },
      { type: 'date', label: 'Fecha', icon: Calendar },
      { type: 'currency', label: 'Moneda', icon: BadgeDollarSign },
    ],
  },
  {
    title: 'Selección',
    fields: [
      { type: 'radio', label: 'Opción múltiple', icon: CircleDot },
      { type: 'checkbox_group', label: 'Casillas', icon: ListChecks },
      { type: 'select', label: 'Lista desplegable', icon: ChevronDown },
      { type: 'yes_no', label: 'Sí / No', icon: CheckSquare },
    ],
  },
  {
    title: 'Datos documentales',
    fields: [
      { type: 'rfc', label: 'RFC', icon: Landmark },
      { type: 'curp', label: 'CURP', icon: Fingerprint },
      { type: 'business_name', label: 'Razón social', icon: BriefcaseBusiness },
      { type: 'fiscal_address', label: 'Domicilio fiscal', icon: MapPinned },
      { type: 'documento', label: 'Carga de archivo', icon: FileUp },
      { type: 'imagen', label: 'Carga de imagen', icon: Image },
    ],
  },
  {
    title: 'Legal y consentimiento',
    fields: [
      { type: 'consentimiento', label: 'Consentimiento', icon: FileCheck2 },
      { type: 'declaration', label: 'Declaración bajo protesta', icon: Scale },
      { type: 'signature_block', label: 'Bloque de firma', icon: UserRoundCheck },
      { type: 'firma_efirma', label: 'e.firma SAT', icon: ShieldCheck },
      { type: 'firma_autografa', label: 'Firma autógrafa', icon: PenLine },
      { type: 'firma_click', label: 'Click & Sign', icon: MousePointerClick },
    ],
  },
  {
    title: 'Contenido',
    fields: [
      { type: 'texto_bloque', label: 'Texto informativo', icon: FileText },
      { type: 'divider', label: 'Separador', icon: Minus },
      { type: 'iniciales', label: 'Iniciales', icon: WalletCards },
    ],
  },
];

export default function FieldLibrary() {
  const { addField } = useFormBuilder();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const normalizedQuery = query.trim().toLowerCase();

  const groups = useMemo(() => GROUPS.map((group) => ({
    ...group,
    fields: group.fields.filter((field) => field.label.toLowerCase().includes(normalizedQuery)),
  })).filter((group) => group.fields.length > 0), [normalizedQuery]);

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[#E2E8F0] bg-white dark:border-border dark:bg-card">
      <div className="border-b border-[#E2E8F0] px-4 py-4 dark:border-border">
        <p className="text-sm font-semibold text-[#0F172A] dark:text-foreground">Agregar contenido</p>
        <p className="mt-1 text-xs text-[#64748B] dark:text-muted-foreground">Selecciona un campo para insertarlo.</p>
        <div className="relative mt-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar campos"
            className="h-9 w-full rounded-md border border-[#E2E8F0] bg-[#F6F8FB] pl-9 pr-3 text-xs text-[#0F172A] outline-none transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10 dark:border-border dark:bg-muted dark:text-foreground"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {groups.map((group) => {
          const isCollapsed = collapsed[group.title] && !normalizedQuery;
          return (
            <section key={group.title} className="mb-2">
              <button
                type="button"
                onClick={() => setCollapsed((current) => ({ ...current, [group.title]: !current[group.title] }))}
                className="flex h-8 w-full items-center justify-between px-2 text-left text-[11px] font-semibold uppercase text-[#64748B]"
              >
                {group.title}
                <ChevronRight size={13} className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
              </button>
              {!isCollapsed && (
                <div className="grid grid-cols-2 gap-1.5">
                  {group.fields.map((field) => {
                    const FieldIcon = field.icon;
                    return (
                      <button
                        key={field.type}
                        type="button"
                        onClick={() => addField(field.type)}
                        className="group flex min-h-[70px] flex-col items-start justify-between rounded-lg border border-[#E2E8F0] bg-white p-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.02)] transition hover:border-[#2563EB]/40 hover:bg-[#EFF6FF] dark:border-border dark:bg-card dark:hover:bg-muted"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#EFF6FF] text-[#2563EB] transition group-hover:bg-[#2563EB] group-hover:text-white">
                          <FieldIcon size={15} />
                        </span>
                        <span className="mt-2 text-[11px] font-medium leading-4 text-[#334155] dark:text-foreground">{field.label}</span>
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
