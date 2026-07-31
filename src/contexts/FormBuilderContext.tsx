'use client';

import React, { createContext, useContext, useReducer, useCallback, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────
export type FieldType =
  | 'text' | 'textarea' | 'number' | 'email' | 'phone' | 'date' | 'time' |'checkbox' | 'checkbox_group' | 'radio' | 'select' | 'estado_mx'
  | 'rfc'| 'curp' | 'nss' | 'clave_elector' |'firma_autografa'| 'firma_click' | 'consentimiento' | 'iniciales' |'imagen' | 'documento'
  | 'divider' | 'texto_bloque' | 'imagen_estatica' | 'columnas';

export interface ConditionalRule {
  fieldId: string;
  operator: 'eq' | 'neq' | 'contains' | 'empty' | 'not_empty';
  value: string;
}

export interface FieldOption {
  label: string;
  value: string;
}

export interface PdfMapping {
  x: number;
  y: number;
  page: number;
  fontSize: number;
  color: string;
}

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  slug: string;
  placeholder?: string;
  description?: string;
  required: boolean;
  readOnly: boolean;
  conditionalVisible: boolean;
  conditionalRule?: ConditionalRule;
  // Validation
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  regex?: string;
  regexError?: string;
  // Options (for select, radio, checkbox_group)
  options?: FieldOption[];
  // Assignment
  assignedTo?: 'signer1' | 'signer2' | 'all' | 'any';
  // PDF mapping
  pdfMapping?: PdfMapping;
  // Position (visual mode)
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // Section grouping
  sectionId?: string;
}

export interface FormSection {
  id: string;
  title: string;
  collapsed: boolean;
  fieldIds: string[];
}

export interface FormTemplate {
  id?: string;
  name: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  schema: FormField[];
  sections: FormSection[];
  settings: {
    mode: 'scroll' | 'multistep';
    multiStep: boolean;
    language: string;
    expirationHours: number;
    redirectAfterSubmit?: string;
  };
  pdfBasePath?: string;
  workspaceId?: string;
}

interface FormBuilderState {
  template: FormTemplate;
  selectedFieldId: string | null;
  canvasMode: 'list' | 'visual';
  isDirty: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
}

type FormBuilderAction =
  | { type: 'SET_TEMPLATE'; payload: FormTemplate }
  | { type: 'SET_TEMPLATE_META'; payload: Partial<FormTemplate> }
  | { type: 'ADD_FIELD'; payload: { field: FormField; afterId?: string } }
  | { type: 'UPDATE_FIELD'; payload: { id: string; updates: Partial<FormField> } }
  | { type: 'DELETE_FIELD'; payload: string }
  | { type: 'DUPLICATE_FIELD'; payload: string }
  | { type: 'REORDER_FIELDS'; payload: FormField[] }
  | { type: 'SELECT_FIELD'; payload: string | null }
  | { type: 'SET_CANVAS_MODE'; payload: 'list' | 'visual' }
  | { type: 'SET_DIRTY'; payload: boolean }
  | { type: 'SET_SAVING'; payload: boolean }
  | { type: 'SET_LAST_SAVED'; payload: Date }
  | { type: 'ADD_SECTION'; payload: FormSection }
  | { type: 'UPDATE_SECTION'; payload: { id: string; updates: Partial<FormSection> } }
  | { type: 'DELETE_SECTION'; payload: string };

const defaultTemplate: FormTemplate = {
  name: 'Nuevo Formulario',
  description: '',
  status: 'draft',
  schema: [],
  sections: [],
  settings: {
    mode: 'scroll',
    multiStep: false,
    language: 'es',
    expirationHours: 72,
  },
};

const initialState: FormBuilderState = {
  template: defaultTemplate,
  selectedFieldId: null,
  canvasMode: 'list',
  isDirty: false,
  isSaving: false,
  lastSaved: null,
};

function reducer(state: FormBuilderState, action: FormBuilderAction): FormBuilderState {
  switch (action.type) {
    case 'SET_TEMPLATE':
      return { ...state, template: action.payload, isDirty: false };

    case 'SET_TEMPLATE_META':
      return {
        ...state,
        template: { ...state.template, ...action.payload },
        isDirty: true,
      };

    case 'ADD_FIELD': {
      const { field, afterId } = action.payload;
      let schema = [...state.template.schema];
      if (afterId) {
        const idx = schema.findIndex((f) => f.id === afterId);
        schema.splice(idx + 1, 0, field);
      } else {
        schema.push(field);
      }
      return {
        ...state,
        template: { ...state.template, schema },
        selectedFieldId: field.id,
        isDirty: true,
      };
    }

    case 'UPDATE_FIELD': {
      const schema = state.template.schema.map((f) =>
        f.id === action.payload.id ? { ...f, ...action.payload.updates } : f
      );
      return { ...state, template: { ...state.template, schema }, isDirty: true };
    }

    case 'DELETE_FIELD': {
      const schema = state.template.schema.filter((f) => f.id !== action.payload);
      return {
        ...state,
        template: { ...state.template, schema },
        selectedFieldId: state.selectedFieldId === action.payload ? null : state.selectedFieldId,
        isDirty: true,
      };
    }

    case 'DUPLICATE_FIELD': {
      const idx = state.template.schema.findIndex((f) => f.id === action.payload);
      if (idx === -1) return state;
      const original = state.template.schema[idx];
      const copy: FormField = {
        ...original,
        id: crypto.randomUUID(),
        label: `${original.label} (copia)`,
        slug: `${original.slug}_copia`,
      };
      const schema = [...state.template.schema];
      schema.splice(idx + 1, 0, copy);
      return {
        ...state,
        template: { ...state.template, schema },
        selectedFieldId: copy.id,
        isDirty: true,
      };
    }

    case 'REORDER_FIELDS':
      return {
        ...state,
        template: { ...state.template, schema: action.payload },
        isDirty: true,
      };

    case 'SELECT_FIELD':
      return { ...state, selectedFieldId: action.payload };

    case 'SET_CANVAS_MODE':
      return { ...state, canvasMode: action.payload };

    case 'SET_DIRTY':
      return { ...state, isDirty: action.payload };

    case 'SET_SAVING':
      return { ...state, isSaving: action.payload };

    case 'SET_LAST_SAVED':
      return { ...state, lastSaved: action.payload, isDirty: false };

    case 'ADD_SECTION': {
      return {
        ...state,
        template: { ...state.template, sections: [...state.template.sections, action.payload] },
        isDirty: true,
      };
    }

    case 'UPDATE_SECTION': {
      const sections = state.template.sections.map((s) =>
        s.id === action.payload.id ? { ...s, ...action.payload.updates } : s
      );
      return { ...state, template: { ...state.template, sections }, isDirty: true };
    }

    case 'DELETE_SECTION': {
      const sections = state.template.sections.filter((s) => s.id !== action.payload);
      return { ...state, template: { ...state.template, sections }, isDirty: true };
    }

    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────
interface FormBuilderContextValue {
  state: FormBuilderState;
  dispatch: React.Dispatch<FormBuilderAction>;
  addField: (type: FieldType, afterId?: string) => void;
  updateField: (id: string, updates: Partial<FormField>) => void;
  deleteField: (id: string) => void;
  duplicateField: (id: string) => void;
  selectField: (id: string | null) => void;
  selectedField: FormField | null;
}

const FormBuilderContext = createContext<FormBuilderContextValue | null>(null);

export function useFormBuilder() {
  const ctx = useContext(FormBuilderContext);
  if (!ctx) throw new Error('useFormBuilder must be used within FormBuilderProvider');
  return ctx;
}

function createDefaultField(type: FieldType): FormField {
  const id = crypto.randomUUID();
  const labelMap: Partial<Record<FieldType, string>> = {
    text: 'Texto corto', textarea: 'Texto largo', number: 'Número',
    email: 'Correo electrónico', phone: 'Teléfono', date: 'Fecha', time: 'Hora',
    checkbox: 'Casilla de verificación', checkbox_group: 'Grupo de casillas',
    radio: 'Botones de opción', select: 'Desplegable', estado_mx: 'Estado (México)',
    rfc: 'RFC', curp: 'CURP', nss: 'NSS', clave_elector: 'Clave de Elector',
    firma_autografa: 'Firma Autógrafa', firma_click: 'Firma Click-to-Sign',
    consentimiento: 'Consentimiento', iniciales: 'Iniciales',
    imagen: 'Carga de Imagen', documento: 'Carga de Documento',
    divider: 'Separador', texto_bloque: 'Bloque de Texto',
    imagen_estatica: 'Imagen Estática', columnas: 'Columnas',
  };
  const label = labelMap[type] || 'Campo';
  const slug = label.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + id.slice(0, 4);

  const defaultOptions: FieldOption[] = [
    { label: 'Opción 1', value: 'opcion_1' },
    { label: 'Opción 2', value: 'opcion_2' },
  ];

  return {
    id,
    type,
    label,
    slug,
    placeholder: '',
    description: '',
    required: false,
    readOnly: false,
    conditionalVisible: false,
    assignedTo: 'any',
    options: ['select', 'radio', 'checkbox_group'].includes(type) ? defaultOptions : undefined,
    width: 300,
    height: type === 'firma_autografa' ? 120 : 40,
  };
}

export function FormBuilderProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const addField = useCallback((type: FieldType, afterId?: string) => {
    const field = createDefaultField(type);
    dispatch({ type: 'ADD_FIELD', payload: { field, afterId } });
  }, []);

  const updateField = useCallback((id: string, updates: Partial<FormField>) => {
    dispatch({ type: 'UPDATE_FIELD', payload: { id, updates } });
  }, []);

  const deleteField = useCallback((id: string) => {
    dispatch({ type: 'DELETE_FIELD', payload: id });
  }, []);

  const duplicateField = useCallback((id: string) => {
    dispatch({ type: 'DUPLICATE_FIELD', payload: id });
  }, []);

  const selectField = useCallback((id: string | null) => {
    dispatch({ type: 'SELECT_FIELD', payload: id });
  }, []);

  const selectedField = state.template.schema.find((f) => f.id === state.selectedFieldId) ?? null;

  return (
    <FormBuilderContext.Provider
      value={{ state, dispatch, addField, updateField, deleteField, duplicateField, selectField, selectedField }}
    >
      {children}
    </FormBuilderContext.Provider>
  );
}
