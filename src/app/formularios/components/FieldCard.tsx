'use client';

import React from 'react';
import { useFormBuilder, FormField, FieldType } from '@/contexts/FormBuilderContext';
import { Type, AlignLeft, Hash, Mail, Phone, Calendar, Clock, CheckSquare, List, Circle, ChevronDown, MapPin, FileText, CreditCard, User, Shield, PenTool, MousePointer, FileCheck, Pen, Image, FileUp, Minus, AlignCenter, ImageIcon, Columns, Edit2, Copy, Trash2, GripVertical,  } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';


const FIELD_ICON_MAP: Partial<Record<FieldType, React.ElementType>> = {
  text: Type, textarea: AlignLeft, number: Hash, email: Mail, phone: Phone,
  date: Calendar, time: Clock, checkbox: CheckSquare, checkbox_group: List,
  radio: Circle, select: ChevronDown, estado_mx: MapPin,
  rfc: FileText, curp: User, nss: CreditCard, clave_elector: Shield,
  firma_autografa: PenTool, firma_click: MousePointer,
  consentimiento: FileCheck, iniciales: Pen,
  imagen: Image, documento: FileUp,
  divider: Minus, texto_bloque: AlignCenter,
  imagen_estatica: ImageIcon, columnas: Columns,
};

const FIELD_COLOR_MAP: Partial<Record<FieldType, string>> = {
  text: 'bg-blue-50 border-blue-200', textarea: 'bg-blue-50 border-blue-200',
  number: 'bg-blue-50 border-blue-200', email: 'bg-blue-50 border-blue-200',
  phone: 'bg-blue-50 border-blue-200', date: 'bg-blue-50 border-blue-200',
  time: 'bg-blue-50 border-blue-200',
  checkbox: 'bg-purple-50 border-purple-200', checkbox_group: 'bg-purple-50 border-purple-200',
  radio: 'bg-purple-50 border-purple-200', select: 'bg-purple-50 border-purple-200',
  estado_mx: 'bg-purple-50 border-purple-200',
  rfc: 'bg-orange-50 border-orange-200', curp: 'bg-orange-50 border-orange-200',
  nss: 'bg-orange-50 border-orange-200', clave_elector: 'bg-orange-50 border-orange-200',
  firma_autografa: 'bg-indigo-50 border-indigo-200', firma_click: 'bg-indigo-50 border-indigo-200',
  consentimiento: 'bg-indigo-50 border-indigo-200', iniciales: 'bg-indigo-50 border-indigo-200',
  imagen: 'bg-green-50 border-green-200', documento: 'bg-green-50 border-green-200',
  divider: 'bg-gray-50 border-gray-200', texto_bloque: 'bg-gray-50 border-gray-200',
  imagen_estatica: 'bg-gray-50 border-gray-200', columnas: 'bg-gray-50 border-gray-200',
};

interface FieldCardProps {
  field: FormField;
  isSelected: boolean;
  dragHandleProps?: Record<string, unknown>;
}

export default function FieldCard({ field, isSelected, dragHandleProps }: FieldCardProps) {
  const { selectField, deleteField, duplicateField } = useFormBuilder();
  const Icon = FIELD_ICON_MAP[field.type] || Type;
  const colorClass = FIELD_COLOR_MAP[field.type] || 'bg-gray-50 border-gray-200';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectField(field.id);
  };

  return (
    <div
      onClick={handleClick}
      className={`group relative flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all duration-150 ${colorClass} ${
        isSelected ? 'ring-2 ring-primary ring-offset-1 shadow-md' : 'hover:shadow-sm'
      }`}
    >
      {/* Drag handle */}
      <div
        {...(dragHandleProps || {})}
        className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={16} />
      </div>

      {/* Icon */}
      <div className="flex-shrink-0">
        <Icon size={16} className="text-muted-foreground" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{field.label}</span>
          {field.required && (
            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
              Obligatorio
            </span>
          )}
          {!field.required && (
            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
              Opcional
            </span>
          )}
          {field.conditionalVisible && (
            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-600">
              Condicional
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {field.slug} · {field.type}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); selectField(field.id); }}
          className="p-1.5 rounded-lg hover:bg-white/80 text-muted-foreground hover:text-primary transition-colors"
          title="Editar propiedades"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); duplicateField(field.id); }}
          className="p-1.5 rounded-lg hover:bg-white/80 text-muted-foreground hover:text-primary transition-colors"
          title="Duplicar"
        >
          <Copy size={13} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); deleteField(field.id); }}
          className="p-1.5 rounded-lg hover:bg-white/80 text-muted-foreground hover:text-destructive transition-colors"
          title="Eliminar"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
