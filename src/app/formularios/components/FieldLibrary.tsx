'use client';

import React, { useState } from 'react';
import { useFormBuilder, FieldType } from '@/contexts/FormBuilderContext';
import {
  Type, AlignLeft, Hash, Mail, Phone, Calendar, Clock,
  CheckSquare, List, Circle, ChevronDown, MapPin,
  FileText, CreditCard, User, Shield,
  PenTool, MousePointer, FileCheck, Pen,
  Image, FileUp, Minus, AlignCenter, ImageIcon, Columns,
  ChevronRight,
} from 'lucide-react';
import Icon from '@/components/ui/AppIcon';


interface FieldDef {
  type: FieldType;
  label: string;
  icon: React.ElementType;
  color: string;
}

const FIELD_SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Básicos',
    fields: [
      { type: 'text', label: 'Texto corto', icon: Type, color: 'text-blue-500' },
      { type: 'textarea', label: 'Texto largo', icon: AlignLeft, color: 'text-blue-500' },
      { type: 'number', label: 'Número', icon: Hash, color: 'text-blue-500' },
      { type: 'email', label: 'Email', icon: Mail, color: 'text-blue-500' },
      { type: 'phone', label: 'Teléfono', icon: Phone, color: 'text-blue-500' },
      { type: 'date', label: 'Fecha', icon: Calendar, color: 'text-blue-500' },
      { type: 'time', label: 'Hora', icon: Clock, color: 'text-blue-500' },
    ],
  },
  {
    title: 'Selección',
    fields: [
      { type: 'checkbox', label: 'Checkbox único', icon: CheckSquare, color: 'text-purple-500' },
      { type: 'checkbox_group', label: 'Grupo de checkboxes', icon: List, color: 'text-purple-500' },
      { type: 'radio', label: 'Radio buttons', icon: Circle, color: 'text-purple-500' },
      { type: 'select', label: 'Desplegable', icon: ChevronDown, color: 'text-purple-500' },
      { type: 'estado_mx', label: 'Estado mexicano', icon: MapPin, color: 'text-purple-500' },
    ],
  },
  {
    title: 'Identidad Mexicana',
    fields: [
      { type: 'rfc', label: 'RFC', icon: FileText, color: 'text-orange-500' },
      { type: 'curp', label: 'CURP', icon: User, color: 'text-orange-500' },
      { type: 'nss', label: 'NSS', icon: CreditCard, color: 'text-orange-500' },
      { type: 'clave_elector', label: 'Clave Elector INE', icon: Shield, color: 'text-orange-500' },
    ],
  },
  {
    title: 'Firma y Consentimiento',
    fields: [
      { type: 'firma_autografa', label: 'Firma Autógrafa', icon: PenTool, color: 'text-indigo-500' },
      { type: 'firma_click', label: 'Click-to-Sign', icon: MousePointer, color: 'text-indigo-500' },
      { type: 'consentimiento', label: 'Consentimiento', icon: FileCheck, color: 'text-indigo-500' },
      { type: 'iniciales', label: 'Iniciales', icon: Pen, color: 'text-indigo-500' },
    ],
  },
  {
    title: 'Archivos',
    fields: [
      { type: 'imagen', label: 'Carga de Imagen', icon: Image, color: 'text-green-500' },
      { type: 'documento', label: 'Carga de Documento', icon: FileUp, color: 'text-green-500' },
    ],
  },
  {
    title: 'Layout',
    fields: [
      { type: 'divider', label: 'Separador', icon: Minus, color: 'text-gray-500' },
      { type: 'texto_bloque', label: 'Bloque de texto', icon: AlignCenter, color: 'text-gray-500' },
      { type: 'imagen_estatica', label: 'Imagen estática', icon: ImageIcon, color: 'text-gray-500' },
      { type: 'columnas', label: 'Columnas', icon: Columns, color: 'text-gray-500' },
    ],
  },
];

export default function FieldLibrary() {
  const { addField } = useFormBuilder();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleSection = (title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <div className="h-full overflow-y-auto bg-background border-r border-border">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Campos</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Haz clic para agregar al formulario</p>
      </div>

      <div className="p-2 space-y-1">
        {FIELD_SECTIONS.map((section) => {
          const isCollapsed = collapsed[section.title];
          return (
            <div key={section.title} className="rounded-lg overflow-hidden">
              <button
                onClick={() => toggleSection(section.title)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted rounded-lg transition-colors"
              >
                <span>{section.title}</span>
                <ChevronRight
                  size={12}
                  className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                />
              </button>

              {!isCollapsed && (
                <div className="mt-1 space-y-0.5 px-1">
                  {section.fields.map((field) => {
                    const Icon = field.icon;
                    return (
                      <button
                        key={field.type}
                        onClick={() => addField(field.type)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-primary/5 hover:text-primary transition-colors group"
                      >
                        <Icon size={14} className={`flex-shrink-0 ${field.color} group-hover:text-primary`} />
                        <span className="text-xs text-foreground group-hover:text-primary">{field.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
