'use client';

import React from 'react';
import { Copy, FileText, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { useFormBuilder, type FormField } from '@/contexts/FormBuilderContext';
import { getFieldTypeLabel } from '@/lib/forms/schema';

interface FieldCardProps {
  field: FormField;
  isSelected: boolean;
  dragHandleProps?: Record<string, unknown>;
}

export default function FieldCard({ field, isSelected, dragHandleProps }: FieldCardProps) {
  const { selectField, deleteField, duplicateField } = useFormBuilder();

  return (
    <article
      onClick={(event) => {
        event.stopPropagation();
        selectField(field.id);
      }}
      className={`group relative flex min-h-[78px] cursor-pointer items-center gap-3 rounded-lg border bg-white px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.02)] transition dark:bg-card ${
        isSelected
          ? 'border-[#1E6BFF] shadow-[0_0_0_2px_rgba(30, 107, 255,0.10)]'
          : 'border-[#E2E8F0] hover:border-[#CBD5E1] hover:shadow-sm dark:border-border'
      }`}
    >
      <button
        type="button"
        {...(dragHandleProps || {})}
        onClick={(event) => event.stopPropagation()}
        className="flex h-8 w-6 flex-shrink-0 cursor-grab items-center justify-center text-[#94A3B8] opacity-50 transition hover:text-[#1E6BFF] group-hover:opacity-100 active:cursor-grabbing"
        title="Reordenar campo"
      >
        <GripVertical size={16} />
      </button>

      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-[#F1F5F9] text-[#475569] dark:bg-muted dark:text-muted-foreground">
        <FileText size={16} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-[#0F172A] dark:text-foreground">{field.label}</p>
          {field.required && <Badge tone="red">Obligatorio</Badge>}
          {field.conditionalVisible && <Badge tone="amber">Condicional</Badge>}
          {field.pdf?.show === false && <Badge tone="gray">No visible en PDF</Badge>}
        </div>
        <p className="mt-1 truncate text-xs text-[#64748B] dark:text-muted-foreground">
          {getFieldTypeLabel(field.type)} · {field.slug}
        </p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <IconButton label="Editar" onClick={() => selectField(field.id)}><Pencil size={14} /></IconButton>
        <IconButton label="Duplicar" onClick={() => duplicateField(field.id)}><Copy size={14} /></IconButton>
        <IconButton label="Eliminar" destructive onClick={() => deleteField(field.id)}><Trash2 size={14} /></IconButton>
      </div>
    </article>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'red' | 'amber' | 'gray' }) {
  const styles = {
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-700',
    gray: 'bg-[#F8FAFC] text-[#64748B]',
  };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles[tone]}`}>{children}</span>;
}

function IconButton({ children, label, destructive, onClick }: {
  children: React.ReactNode;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition ${destructive ? 'text-[#94A3B8] hover:bg-red-50 hover:text-red-600' : 'text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#1E6BFF]'}`}
    >
      {children}
    </button>
  );
}
