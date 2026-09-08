'use client';

import React, { useState } from 'react';
import { Editor } from '@tiptap/react';
import { VariableField } from '../hooks/useTemplateBuilder';
import { InsertedField } from './FieldPropertiesSidebar';
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronDown as ChevronDownIcon,
  ChevronUp,
  Clock,
  DollarSign,
  FileText,
  GripVertical,
  Hash,
  Image,
  List,
  Mail,
  MapPin,
  PenLine,
  Phone,
  UserRound,
} from 'lucide-react';

interface FieldDefinition {
  type: VariableField['fieldType'];
  label: string;
  icon: React.ReactNode;
  required?: boolean;
}

const GENERAL_FIELDS: FieldDefinition[] = [
  {
    type: 'text',
    label: 'Texto',
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-gray-400"
      >
        <line x1="3" x2="21" y1="6" y2="6" />
        <line x1="3" x2="21" y1="12" y2="12" />
        <line x1="3" x2="15" y1="18" y2="18" />
      </svg>
    ),
  },
  { type: 'date', label: 'Fecha', icon: <Calendar size={15} className="text-gray-400" /> },
  { type: 'text', label: 'Hora', icon: <Clock size={15} className="text-gray-400" /> },
  { type: 'number', label: 'Número', icon: <Hash size={15} className="text-gray-400" /> },
  { type: 'checkbox', label: 'Casilla', icon: <CheckSquare size={15} className="text-gray-400" /> },
  { type: 'text', label: 'Imagen', icon: <Image size={15} className="text-gray-400" /> },
  { type: 'text', label: 'Moneda', icon: <DollarSign size={15} className="text-gray-400" /> },
  { type: 'text', label: 'Botones de opción', icon: <List size={15} className="text-gray-400" /> },
  {
    type: 'text',
    label: 'Desplegable',
    icon: <ChevronDownIcon size={15} className="text-gray-400" />,
  },
];

const PARTICIPANT_FIELDS: FieldDefinition[] = [
  {
    type: 'signature',
    label: 'Firma',
    icon: <PenLine size={15} className="text-slate-400" />,
    required: true,
  },
  {
    type: 'text',
    label: 'Nombre completo',
    icon: <UserRound size={15} className="text-slate-400" />,
  },
  { type: 'rfc', label: 'RFC', icon: <FileText size={15} className="text-slate-400" /> },
  { type: 'text', label: 'CURP', icon: <UserRound size={15} className="text-slate-400" /> },
  {
    type: 'email',
    label: 'Correo electrónico',
    icon: <Mail size={15} className="text-slate-400" />,
  },
  {
    type: 'text',
    label: 'Número telefónico',
    icon: <Phone size={15} className="text-slate-400" />,
  },
  { type: 'text', label: 'Dirección', icon: <MapPin size={15} className="text-slate-400" /> },
];

interface FieldsSidebarProps {
  editor: Editor | null;
  fields: InsertedField[];
  selectedFieldId: string | null;
  onInsertField: (
    editor: Editor,
    type: VariableField['fieldType'],
    label: string,
    options?: { participantField?: boolean; required?: boolean }
  ) => void;
  onSelectField: (fieldId: string | null) => void;
  onUpdateField: (editor: Editor, fieldId: string, updates: Partial<VariableField>) => void;
}

function SectionHeader({
  title,
  open,
  onToggle,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-slate-50"
    >
      <span className="text-sm font-medium text-slate-800">{title}</span>
      {open ? (
        <ChevronUp size={15} className="text-slate-400" />
      ) : (
        <ChevronDown size={15} className="text-slate-400" />
      )}
    </button>
  );
}

function FieldRow({
  label,
  icon,
  required = false,
  onInsert,
}: {
  label: string;
  icon: React.ReactNode;
  required?: boolean;
  onInsert: () => void;
}) {
  return (
    <div
      className="group mx-4 mb-2 flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition-all hover:border-slate-300 hover:bg-slate-50"
      onMouseDown={(event) => {
        event.preventDefault();
        onInsert();
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 text-slate-400">{icon}</span>
        <span className="truncate text-sm text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </span>
      </div>
      <GripVertical size={15} className="shrink-0 text-slate-300 group-hover:text-slate-400" />
    </div>
  );
}

export function FieldsSidebar({ editor, onInsertField }: FieldsSidebarProps) {
  const [participantOpen, setParticipantOpen] = useState(true);
  const [generalOpen, setGeneralOpen] = useState(false);

  const handleInsert = (
    type: VariableField['fieldType'],
    label: string,
    options?: { participantField?: boolean; required?: boolean }
  ) => {
    onInsertField(editor as Editor, type, label, options);
  };

  return (
    <aside
      style={{ width: 'clamp(360px, 30vw, 500px)', minWidth: '360px' }}
      className="flex h-full flex-col overflow-y-auto border-r border-slate-200 bg-slate-50 p-2"
    >
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <SectionHeader
          title="Campos del participante"
          open={participantOpen}
          onToggle={() => setParticipantOpen((value) => !value)}
        />
        {participantOpen && (
          <div className="border-t border-slate-200 py-2">
            {PARTICIPANT_FIELDS.map((field) => (
              <FieldRow
                key={field.label}
                label={field.label}
                icon={field.icon}
                required={field.required}
                onInsert={() =>
                  handleInsert(field.type, field.label, {
                    participantField: true,
                    required: field.required,
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <SectionHeader
          title="Campos generales"
          open={generalOpen}
          onToggle={() => setGeneralOpen((value) => !value)}
        />
        {generalOpen && (
          <div className="border-t border-slate-200 py-2">
            {GENERAL_FIELDS.map((field) => (
              <FieldRow
                key={field.label}
                label={field.label}
                icon={field.icon}
                onInsert={() => handleInsert(field.type, field.label)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
