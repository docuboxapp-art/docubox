'use client';

import React from 'react';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';

const FIELD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  signature: { bg: '#EBF5FF', text: '#1A56DB', border: '#1A56DB' },
  date:      { bg: '#ECFDF5', text: '#057A55', border: '#057A55' },
  rfc:       { bg: '#FFFBEB', text: '#C27803', border: '#C27803' },
  email:     { bg: '#F5F3FF', text: '#7E3AF2', border: '#7E3AF2' },
  number:    { bg: '#EFF6FF', text: '#1C64F2', border: '#1C64F2' },
  checkbox:  { bg: '#F9FAFB', text: '#6B7280', border: '#6B7280' },
  company:   { bg: '#FDF2F8', text: '#E74694', border: '#E74694' },
  stamp:     { bg: '#F3F4F6', text: '#111827', border: '#111827' },
  text:      { bg: '#F0FDF4', text: '#16A34A', border: '#16A34A' },
};

const FIELD_ICONS: Record<string, string> = {
  text:      '📝',
  date:      '📅',
  signature: '✍️',
  number:    '🔢',
  checkbox:  '☑️',
  email:     '📧',
  company:   '🏢',
  rfc:       '🪪',
  stamp:     '🔏',
};

export function VariableFieldView({ node, deleteNode, selected, editor }: ReactNodeViewProps) {
  const { fieldType, label } = node.attrs;
  const colors = FIELD_COLORS[fieldType] || FIELD_COLORS.text;
  const icon = FIELD_ICONS[fieldType] || '📝';

  return (
    <NodeViewWrapper
      as="span"
      style={{ display: 'inline-flex', userSelect: 'none' }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '9999px',
          fontSize: '12px',
          fontWeight: 500,
          backgroundColor: colors.bg,
          color: colors.text,
          border: `1.5px solid ${colors.border}`,
          cursor: 'default',
          outline: selected ? `2px solid ${colors.border}` : 'none',
          outlineOffset: '1px',
          whiteSpace: 'nowrap',
          verticalAlign: 'middle',
          lineHeight: '1.4',
        }}
      >
        <span style={{ fontSize: '11px' }}>{icon}</span>
        <span>{label}</span>
        {editor.isEditable && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              deleteNode();
            }}
            style={{
              marginLeft: '2px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: colors.text,
              padding: '0',
              lineHeight: '1',
              fontSize: '11px',
              opacity: 0.7,
              display: 'inline-flex',
              alignItems: 'center',
            }}
            title="Eliminar campo"
          >
            ✕
          </button>
        )}
      </span>
    </NodeViewWrapper>
  );
}
