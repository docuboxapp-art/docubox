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
  type FormAppearance,
  type SignatureType,
  type ConditionalRule,
  type PdfMapping,
} from '@/lib/forms/schema';
import type { FormPdfDefaults } from '@/lib/forms/pdf-defaults';
import { reusableFormAppearance } from '@/lib/forms/appearance-defaults';
import { snapshotFormExperience, type FormExperienceDefaults } from '@/lib/forms/experience-defaults';

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
  savedExperience: FormExperienceDefaults;
  savedAppearance: FormAppearance;
  savedPdfSchema: PdfSchema;
  savedPdfSections: ReturnType<typeof snapshotPdfSectionLayout>;
  selectedFieldId: string | null;
  selectedSectionId: string | null;
  canvasMode: 'list' | 'preview' | 'pdf';
  isDirty: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
}

type FormBuilderAction =
  | { type: 'SET_TEMPLATE'; payload: FormTemplate }
  | { type: 'APPLY_PDF_DEFAULTS'; payload: FormPdfDefaults }
  | { type: 'APPLY_APPEARANCE_DEFAULTS'; payload: FormAppearance }
  | { type: 'APPLY_EXPERIENCE_DEFAULTS'; payload: FormExperienceDefaults }
  | { type: 'SAVE_EXPERIENCE_DEFAULTS'; payload: FormExperienceDefaults }
  | { type: 'SAVE_APPEARANCE_DESIGN'; payload: FormAppearance }
  | { type: 'SAVE_PDF_DESIGN'; payload: { pdfSchema: PdfSchema; sections: FormSection[] } }
  | { type: 'SET_TEMPLATE_META'; payload: Partial<FormTemplate> }
  | { type: 'SET_SETTINGS'; payload: Partial<FormTemplate['settings']> }
  | { type: 'SET_PDF_SCHEMA'; payload: Partial<PdfSchema> }
  | { type: 'SET_APPEARANCE'; payload: Partial<FormAppearance> }
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
  | { type: 'ACK_SAVE'; payload: { snapshot: FormTemplate; saved: FormTemplate } }
  | { type: 'ADD_SECTION'; payload: FormSection }
  | { type: 'UPDATE_SECTION'; payload: { id: string; updates: Partial<FormSection> } }
  | { type: 'DELETE_SECTION'; payload: string };

const defaultTemplate = createDefaultFormTemplate();

export function snapshotPdfSectionLayout(sections: FormSection[]) {
  return sections.map(({ id, showInPdf, pageBreakBefore }) => ({ id, showInPdf, pageBreakBefore }));
}

const initialState: FormBuilderState = {
  template: defaultTemplate,
  savedExperience: snapshotFormExperience(defaultTemplate.settings),
  savedAppearance: defaultTemplate.settings.appearance,
  savedPdfSchema: defaultTemplate.settings.pdfSchema,
  savedPdfSections: snapshotPdfSectionLayout(defaultTemplate.sections),
  selectedFieldId: null,
  selectedSectionId: defaultTemplate.sections[0].id,
  canvasMode: 'list',
  isDirty: false,
  isSaving: false,
  lastSaved: null,
};

export function formBuilderReducer(state: FormBuilderState, action: FormBuilderAction): FormBuilderState {
  switch (action.type) {
    case 'SET_TEMPLATE': {
      const template = normalizeFormTemplate(action.payload);
      return {
        ...state,
        template,
        savedExperience: snapshotFormExperience(template.settings),
        savedAppearance: template.settings.appearance,
        savedPdfSchema: template.settings.pdfSchema,
        savedPdfSections: snapshotPdfSectionLayout(template.sections),
        selectedFieldId: null,
        selectedSectionId: template.sections[0]?.id || null,
        isDirty: false,
      };
    }

    case 'APPLY_PDF_DEFAULTS':
      if (state.template.id || state.isDirty) return state;
      return {
        ...state,
        savedPdfSchema: action.payload.pdfSchema,
        savedExperience: {
          ...state.savedExperience,
          configurePdfDetails: action.payload.configurePdfDetails,
        },
        template: {
          ...state.template,
          settings: {
            ...state.template.settings,
            configurePdfDetails: action.payload.configurePdfDetails,
            pdfSchema: { ...action.payload.pdfSchema },
          },
        },
      };

    case 'APPLY_APPEARANCE_DEFAULTS': {
      if (state.template.id || state.isDirty) return state;
      const reusableAppearance = reusableFormAppearance(action.payload);
      return {
        ...state,
        savedAppearance: reusableAppearance,
        template: {
          ...state.template,
          settings: { ...state.template.settings, appearance: reusableAppearance },
        },
      };
    }

    case 'APPLY_EXPERIENCE_DEFAULTS': {
      if (state.template.id || state.isDirty) return state;
      return {
        ...state,
        savedExperience: { ...action.payload },
        template: {
          ...state.template,
          settings: { ...state.template.settings, ...action.payload, requiresSignature: true },
        },
      };
    }

    case 'SAVE_EXPERIENCE_DEFAULTS':
      return {
        ...state,
        savedExperience: { ...action.payload },
      };

    case 'SAVE_APPEARANCE_DESIGN':
      return { ...state, savedAppearance: { ...action.payload } };

    case 'SAVE_PDF_DESIGN':
      return {
        ...state,
        savedPdfSchema: { ...action.payload.pdfSchema },
        savedPdfSections: snapshotPdfSectionLayout(action.payload.sections),
      };

    case 'SET_TEMPLATE_META':
      return { ...state, template: { ...state.template, ...action.payload }, isDirty: true };

    case 'SET_SETTINGS': {
      const settings = { ...state.template.settings, ...action.payload, requiresSignature: true };
      if ('documentNumber' in action.payload || 'documentTypeName' in action.payload) {
        settings.appearance = {
          ...settings.appearance,
          headerDocumentNumber: settings.documentNumber,
          headerDocumentTypeName: settings.documentTypeName,
        };
      }
      return {
        ...state,
        template: {
          ...state.template,
          settings,
        },
        isDirty: true,
      };
    }

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

    case 'SET_APPEARANCE':
      return {
        ...state,
        template: {
          ...state.template,
          settings: {
            ...state.template.settings,
            appearance: { ...state.template.settings.appearance, ...action.payload },
          },
        },
        isDirty: true,
      };

    case 'ADD_FIELD': {
      if (action.payload.field.type === 'signature_block' &&
          (!state.template.settings.requiresSignature || state.template.schema.some((field) => field.type === 'signature_block'))) return state;
      const sectionId =
        state.selectedSectionId || state.template.sections.at(-1)?.id || DEFAULT_SECTION_ID;
      const field = {
        ...action.payload.field,
        required: action.payload.field.type === 'signature_block' ? true : action.payload.field.required,
        conditionalVisible: action.payload.field.type === 'signature_block' ? false : action.payload.field.conditionalVisible,
        conditionalRule: action.payload.field.type === 'signature_block' ? undefined : action.payload.field.conditionalRule,
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
        field.id === action.payload.id
          ? {
              ...field,
              ...action.payload.updates,
              required: field.type === 'signature_block' ? true : (action.payload.updates.required ?? field.required),
              conditionalVisible: field.type === 'signature_block' ? false : (action.payload.updates.conditionalVisible ?? field.conditionalVisible),
              conditionalRule: field.type === 'signature_block' ? undefined : (action.payload.updates.conditionalRule ?? field.conditionalRule),
            }
          : field
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
      if (original.type === 'signature_block') return state;
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
      return {
        ...state,
        lastSaved: action.payload,
        savedExperience: snapshotFormExperience(state.template.settings),
        isDirty: false,
      };

    case 'ACK_SAVE': {
      const { saved, snapshot } = action.payload;
      if (state.template.id && state.template.id !== snapshot.id && state.template.id !== saved.id) return state;
      const unchanged = state.template === snapshot;
      return {
        ...state,
        template: unchanged ? saved : {
          ...state.template, id: saved.id, workspaceId: saved.workspaceId,
          updatedAt: saved.updatedAt, versionNumber: saved.versionNumber,
          revisionNumber: saved.revisionNumber, sourceTemplateId: saved.sourceTemplateId,
          rootTemplateId: saved.rootTemplateId,
          publishedAt: saved.publishedAt, status: saved.status,
        },
        lastSaved: new Date(),
        savedExperience: snapshotFormExperience(saved.settings),
        isDirty: !unchanged,
      };
    }

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
  const [state, dispatch] = useReducer(formBuilderReducer, initialState);

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
