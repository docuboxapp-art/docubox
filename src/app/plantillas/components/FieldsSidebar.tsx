'use client';

import React, { useState } from 'react';
import { Editor } from '@tiptap/react';
import { VariableField } from '../hooks/useTemplateBuilder';
import { InsertedField } from './FieldPropertiesSidebar';
import { ChevronUp, ChevronDown, GripVertical, Calendar, Clock, Hash, CheckSquare, Image, DollarSign, List, ChevronDown as ChevronDownIcon } from 'lucide-react';

// ─── General fields ───────────────────────────────────────────────────────────
interface GeneralFieldDef {
  type: VariableField['fieldType'];
  label: string;
  icon: React.ReactNode;
}

const GENERAL_FIELDS: GeneralFieldDef[] = [
  { type: 'text',      label: 'Texto',             icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="15" y1="18" y2="18"/></svg> },
  { type: 'date',      label: 'Fecha',             icon: <Calendar size={13} className="text-gray-400" /> },
  { type: 'text',      label: 'Hora',              icon: <Clock size={13} className="text-gray-400" /> },
  { type: 'number',    label: 'Número',            icon: <Hash size={13} className="text-gray-400" /> },
  { type: 'checkbox',  label: 'Casilla',           icon: <CheckSquare size={13} className="text-gray-400" /> },
  { type: 'text',      label: 'Imagen',            icon: <Image size={13} className="text-gray-400" /> },
  { type: 'text',      label: 'Moneda',            icon: <DollarSign size={13} className="text-gray-400" /> },
  { type: 'text',      label: 'Botones de opción', icon: <List size={13} className="text-gray-400" /> },
  { type: 'text',      label: 'Desplegable',       icon: <ChevronDownIcon size={13} className="text-gray-400" /> },
];

interface FieldsSidebarProps {
  editor: Editor | null;
  fields: InsertedField[];
  selectedFieldId: string | null;
  onInsertField: (editor: Editor, type: VariableField['fieldType'], label: string) => void;
  onSelectField: (fieldId: string | null) => void;
  onUpdateField: (editor: Editor, fieldId: string, updates: Partial<VariableField>) => void;
}

function SectionHeader({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors"
    >
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</span>
      {open ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
    </button>
  );
}

function FieldRow({ label, icon, onInsert }: { label: string; icon: React.ReactNode; onInsert: () => void }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2.5 mx-2 mb-1 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 group cursor-pointer transition-all bg-white"
      onMouseDown={(e) => {
        // Prevent the editor from losing focus so the cursor position is preserved
        e.preventDefault();
        onInsert();
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex-shrink-0 text-gray-400">{icon}</span>
        <span className="text-sm text-gray-700 truncate">{label}</span>
      </div>
      <GripVertical size={13} className="text-gray-300 group-hover:text-gray-400 flex-shrink-0" />
    </div>
  );
}

export function FieldsSidebar({
  editor,
  fields,
  selectedFieldId,
  onInsertField,
  onSelectField,
  onUpdateField,
}: FieldsSidebarProps) {
  const [generalOpen, setGeneralOpen] = useState(true);

  const handleInsert = (type: VariableField['fieldType'], label: string) => {
    onInsertField(editor as any, type, label);
  };

  return (
    <aside
      style={{ width: '240px', minWidth: '240px' }}
      className="flex flex-col bg-gray-50 border-r border-gray-200 h-full overflow-y-auto"
    >
      {/* Campos Generales */}
      <div className="pt-3">
        <SectionHeader
          title="Campos Generales"
          open={generalOpen}
          onToggle={() => setGeneralOpen((v) => !v)}
        />
        {generalOpen && (
          <div className="pt-1 pb-2">
            {GENERAL_FIELDS.map((f) => (
              <FieldRow
                key={f.label}
                label={f.label}
                icon={f.icon}
                onInsert={() => handleInsert(f.type, f.label)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
