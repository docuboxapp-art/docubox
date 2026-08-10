'use client';

import React, { createContext, useCallback, useContext, useReducer } from 'react';
import {
  DEFAULT_SECTION_ID,
  createDefaultFormTemplate,
  createDefaultSection,
  getFieldTypeLabel,
  normalizeFormTemplate,
  type FieldOption,
  type FieldType,
  type FormField,
  type FormSection,
  type FormTemplate,
  type PdfSchema,
  type SignatureType,
  type ConditionalRule,
  type PdfMapping,
} from '@/lib/forms/schema';

export type {
  FieldOption,
  FieldType,
  FormField,
  FormSection,
  FormTemplate,
  PdfSchema,
  SignatureType,
  ConditionalRule,
  PdfMapping,
};

interface FormBuilderState {
  template: FormTemplate;
  selectedFieldId: string | null;
  selectedSectionId: string | null;
  canvasMode: 'list' | 'preview' | 'pdf';
  isDirty: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
}

type FormBuilderAction =
  | { type: 'SET_TEMPLATE'; payload: FormTemplate }
  | { type: 'SET_TEMPLATE_META'; payload: Partial<FormTemplate> }
  | { type: 'SET_SETTINGS'; payload: Partial<FormTemplate['settings']> }
  | { type: 'SET_PDF_SCHEMA'; payload: Partial<PdfSchema> }
  | { type: 'ADD_FIELD'; payload: { field: FormField; afterId?: string } }
  | { type: 'UPDATE_FIELD'; payload: { id: string; updates: Partial<FormField> } }
  | { type: 'DELETE_FIELD'; payload: string }
  | { type: 'DUPLICATE_FIELD'; payload: string }
  | { type: 'REORDER_FIELDS'; payload: FormField[] }
  | { type: 'SELECT_FIELD'; payload: string | null }
  | { type: 'SELECT_SECTION'; payload: string | null }
  | { type: 'SET_CANVAS_MODE'; payload: 'list' | 'preview' | 'pdf' }
  | { type: 'SET_DIRTY'; payload: boolean }
  | { type: 'SET_SAVING'; payload: boolean }
  | { type: 'SET_LAST_SAVED'; payload: Date }
  | { type: 'ADD_SECTION'; payload: FormSection }
  | { type: 'UPDATE_SECTION'; payload: { id: string; updates: Partial<FormSection> } }
  | { type: 'DELETE_SECTION'; payload: string };

const defaultTemplate = createDefaultFormTemplate();

const initialState: FormBuilderState = {
  template: defaultTemplate,
  selectedFieldId: null,
  selectedSectionId: defaultTemplate.sections[0].id,
  canvasMode: 'list',
  isDirty: false,
  isSaving: false,
  lastSaved: null,
};

function reducer(state: FormBuilderState, action: FormBuilderAction): FormBuilderState {
  switch (action.type) {
    case 'SET_TEMPLATE': {
      const template = normalizeFormTemplate(action.payload);
      return {
        ...state,
        template,
        selectedFieldId: null,
        selectedSectionId: template.sections[0]?.id || null,
        isDirty: false,
      };
    }

    case 'SET_TEMPLATE_META':
      return { ...state, template: { ...state.template, ...action.payload }, isDirty: true };

    case 'SET_SETTINGS':
      return {
        ...state,
        template: {
          ...state.template,
          settings: { ...state.template.settings, ...action.payload },
        },
        isDirty: true,
      };

    case 'SET_PDF_SCHEMA':
      return {
        ...state,
        template: {
          ...state.template,
          settings: {
            ...state.template.settings,
            pdfSchema: { ...state.template.settings.pdfSchema, ...action.payload },
          },
        },
        isDirty: true,
      };

    case 'ADD_FIELD': {
      const sectionId =
        state.selectedSectionId || state.template.sections.at(-1)?.id || DEFAULT_SECTION_ID;
      const field = {
        ...action.payload.field,
        sectionId,
        pdf: {
          ...action.payload.field.pdf,
          show: action.payload.field.pdf?.show ?? true,
          sectionId,
          label: action.payload.field.pdf?.label || action.payload.field.label,
          order: state.template.schema.length,
        },
      };
      const schema = [...state.template.schema];
      const afterIndex = action.payload.afterId
        ? schema.findIndex((item) => item.id === action.payload.afterId)
        : -1;
      if (afterIndex >= 0) schema.splice(afterIndex + 1, 0, field);
      else schema.push(field);

      const sections = state.template.sections.map((section) =>
        section.id === sectionId
          ? { ...section, fieldIds: [...section.fieldIds, field.id] }
          : section
      );
      return {
        ...state,
        template: { ...state.template, schema, sections },
        selectedFieldId: field.id,
        isDirty: true,
      };
    }

    case 'UPDATE_FIELD': {
      const previous = state.template.schema.find((field) => field.id === action.payload.id);
      const schema = state.template.schema.map((field) =>
        field.id === action.payload.id ? { ...field, ...action.payload.updates } : field
      );
      let sections = state.template.sections;
      const nextSectionId = action.payload.updates.sectionId;
      if (previous && nextSectionId && nextSectionId !== previous.sectionId) {
        sections = sections.map((section) => ({
          ...section,
          fieldIds:
            section.id === nextSectionId
              ? [...section.fieldIds.filter((id) => id !== previous.id), previous.id]
              : section.fieldIds.filter((id) => id !== previous.id),
        }));
      }
      return { ...state, template: { ...state.template, schema, sections }, isDirty: true };
    }

    case 'DELETE_FIELD':
      return {
        ...state,
        template: {
          ...state.template,
          schema: state.template.schema.filter((field) => field.id !== action.payload),
          sections: state.template.sections.map((section) => ({
            ...section,
            fieldIds: section.fieldIds.filter((id) => id !== action.payload),
          })),
        },
        selectedFieldId: state.selectedFieldId === action.payload ? null : state.selectedFieldId,
        isDirty: true,
      };

    case 'DUPLICATE_FIELD': {
      const index = state.template.schema.findIndex((field) => field.id === action.payload);
      if (index < 0) return state;
      const original = state.template.schema[index];
      const copyId = crypto.randomUUID();
      const copy: FormField = {
        ...original,
        id: copyId,
        label: `${original.label} (copia)`,
        slug: `${original.slug}_copia`,
        pdf: { ...original.pdf, show: original.pdf?.show ?? true, order: index + 1 },
      };
      const schema = [...state.template.schema];
      schema.splice(index + 1, 0, copy);
      const sections = state.template.sections.map((section) => {
        if (section.id !== copy.sectionId) return section;
        const fieldIndex = section.fieldIds.indexOf(original.id);
        const fieldIds = [...section.fieldIds];
        fieldIds.splice(fieldIndex + 1, 0, copyId);
        return { ...section, fieldIds };
      });
      return {
        ...state,
        template: { ...state.template, schema, sections },
        selectedFieldId: copyId,
        isDirty: true,
      };
    }

    case 'REORDER_FIELDS':
      return {
        ...state,
        template: {
          ...state.template,
          schema: action.payload.map((field, index) => ({
            ...field,
            pdf: { ...field.pdf, show: field.pdf?.show ?? true, order: index },
          })),
        },
        isDirty: true,
      };

    case 'SELECT_FIELD':
      return {
        ...state,
        selectedFieldId: action.payload,
        selectedSectionId:
          state.template.schema.find((field) => field.id === action.payload)?.sectionId ||
          state.selectedSectionId,
      };

    case 'SELECT_SECTION':
      return { ...state, selectedSectionId: action.payload, selectedFieldId: null };

    case 'SET_CANVAS_MODE':
      return { ...state, canvasMode: action.payload };

    case 'SET_DIRTY':
      return { ...state, isDirty: action.payload };

    case 'SET_SAVING':
      return { ...state, isSaving: action.payload };

    case 'SET_LAST_SAVED':
      return { ...state, lastSaved: action.payload, isDirty: false };

    case 'ADD_SECTION':
      return {
        ...state,
        template: { ...state.template, sections: [...state.template.sections, action.payload] },
        selectedSectionId: action.payload.id,
        selectedFieldId: null,
        isDirty: true,
      };

    case 'UPDATE_SECTION':
      return {
        ...state,
        template: {
          ...state.template,
          sections: state.template.sections.map((section) =>
            section.id === action.payload.id ? { ...section, ...action.payload.updates } : section
          ),
        },
        isDirty: true,
      };

    case 'DELETE_SECTION': {
      if (state.template.sections.length === 1) return state;
      const remaining = state.template.sections.filter((section) => section.id !== action.payload);
      const targetId = remaining[0].id;
      const movedIds = state.template.sections.find((section) => section.id === action.payload)?.fieldIds || [];
      return {
        ...state,
        template: {
          ...state.template,
          schema: state.template.schema.map((field) =>
            field.sectionId === action.payload
              ? { ...field, sectionId: targetId, pdf: { ...field.pdf, show: field.pdf?.show ?? true, sectionId: targetId } }
              : field
          ),
          sections: remaining.map((section, index) => ({
            ...section,
            order: index,
            fieldIds: section.id === targetId ? [...section.fieldIds, ...movedIds] : section.fieldIds,
          })),
        },
        selectedSectionId: targetId,
        selectedFieldId: null,
        isDirty: true,
      };
    }

    default:
      return state;
  }
}

interface FormBuilderContextValue {
  state: FormBuilderState;
  dispatch: React.Dispatch<FormBuilderAction>;
  addField: (type: FieldType, afterId?: string) => void;
  updateField: (id: string, updates: Partial<FormField>) => void;
  deleteField: (id: string) => void;
  duplicateField: (id: string) => void;
  selectField: (id: string | null) => void;
  addSection: () => void;
  selectedField: FormField | null;
  selectedSection: FormSection | null;
}

const FormBuilderContext = createContext<FormBuilderContextValue | null>(null);

export function useFormBuilder() {
  const context = useContext(FormBuilderContext);
  if (!context) throw new Error('useFormBuilder must be used within FormBuilderProvider');
  return context;
}

function createDefaultField(type: FieldType): FormField {
  const id = crypto.randomUUID();
  const label = getFieldTypeLabel(type);
  const optionTypes: FieldType[] = ['select', 'radio', 'checkbox_group', 'yes_no'];
  const options: FieldOption[] =
    type === 'yes_no'
      ? [{ label: 'Sí', value: 'si' }, { label: 'No', value: 'no' }]
      : [{ label: 'Opción 1', value: 'opcion_1' }, { label: 'Opción 2', value: 'opcion_2' }];
  const signatureTypes: Partial<Record<FieldType, SignatureType[]>> = {
    firma_efirma: ['efirma_sat'],
    firma_autografa: ['autografa_digital'],
    firma_click: ['click_sign'],
    signature_block: ['efirma_sat', 'autografa_digital', 'click_sign'],
  };

  return {
    id,
    type,
    label,
    slug: `${label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_')}_${id.slice(0, 4)}`,
    placeholder: '',
    description: '',
    required: ['consentimiento', 'declaration', 'signature_block'].includes(type),
    readOnly: false,
    editableBeforeSign: true,
    conditionalVisible: false,
    assignedTo: 'any',
    options: optionTypes.includes(type) ? options : undefined,
    pdf: { show: true, label, order: 0 },
    signature: signatureTypes[type]
      ? { signerRole: 'Participante', allowedTypes: signatureTypes[type]!, requireOtp: true, requireEvidence: true }
      : undefined,
    width: 300,
    height: ['firma_autografa', 'signature_block'].includes(type) ? 120 : 40,
  };
}

export function FormBuilderProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const addField = useCallback((type: FieldType, afterId?: string) => {
    dispatch({ type: 'ADD_FIELD', payload: { field: createDefaultField(type), afterId } });
  }, []);
  const updateField = useCallback((id: string, updates: Partial<FormField>) => {
    dispatch({ type: 'UPDATE_FIELD', payload: { id, updates } });
  }, []);
  const deleteField = useCallback((id: string) => dispatch({ type: 'DELETE_FIELD', payload: id }), []);
  const duplicateField = useCallback((id: string) => dispatch({ type: 'DUPLICATE_FIELD', payload: id }), []);
  const selectField = useCallback((id: string | null) => dispatch({ type: 'SELECT_FIELD', payload: id }), []);
  const addSection = useCallback(() => {
    dispatch({ type: 'ADD_SECTION', payload: createDefaultSection(state.template.sections.length, `Sección ${state.template.sections.length + 1}`) });
  }, [state.template.sections.length]);

  const selectedField = state.template.schema.find((field) => field.id === state.selectedFieldId) || null;
  const selectedSection = state.template.sections.find((section) => section.id === state.selectedSectionId) || null;

  return (
    <FormBuilderContext.Provider
      value={{ state, dispatch, addField, updateField, deleteField, duplicateField, selectField, addSection, selectedField, selectedSection }}
    >
      {children}
    </FormBuilderContext.Provider>
  );
}
