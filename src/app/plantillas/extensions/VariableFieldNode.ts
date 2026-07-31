'use client';

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { VariableFieldView } from './VariableFieldView';

export interface VariableFieldAttrs {
  fieldId: string;
  fieldType: 'text' | 'date' | 'signature' | 'number' | 'checkbox' | 'email' | 'company' | 'rfc' | 'stamp';
  label: string;
  assignedTo: string;
  required: boolean;
}

export const VariableFieldNode = Node.create({
  name: 'variableField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      fieldId: { default: '' },
      fieldType: { default: 'text' },
      label: { default: 'Campo' },
      assignedTo: { default: '' },
      required: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-variable-field]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-variable-field': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VariableFieldView);
  },
});
