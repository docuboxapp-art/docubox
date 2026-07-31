'use client';

import { useState, useCallback, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { createClient } from '@/lib/supabase/client';

export interface VariableField {
  fieldId: string;
  fieldType: 'text' | 'date' | 'signature' | 'number' | 'checkbox' | 'email' | 'company' | 'rfc' | 'stamp';
  label: string;
  assignedTo: string;
  required: boolean;
}

export interface SignerRole {
  id: string;
  name: string;
}

export interface TemplateProperties {
  name: string;
  description: string;
  category: string;
  language: string;
  requiresEfirma: boolean;
  requiresNom151: boolean;
  signerRoles: SignerRole[];
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export function useTemplateBuilder() {
  const [fields, setFields] = useState<VariableField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [properties, setProperties] = useState<TemplateProperties>({
    name: 'Nueva Plantilla',
    description: '',
    category: 'Contratos',
    language: 'Español',
    requiresEfirma: false,
    requiresNom151: false,
    signerRoles: [],
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const templateIdRef = useRef<string | null>(null);

  const showToast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const syncFieldsFromEditor = useCallback((editor: Editor) => {
    const newFields: VariableField[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'variableField') {
        newFields.push({
          fieldId: node.attrs.fieldId,
          fieldType: node.attrs.fieldType,
          label: node.attrs.label,
          assignedTo: node.attrs.assignedTo,
          required: node.attrs.required,
        });
      }
    });
    setFields(newFields);
  }, []);

  const insertField = useCallback(
    (editor: Editor, fieldType: VariableField['fieldType'], label: string) => {
      const fieldId = crypto.randomUUID();
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'variableField',
          attrs: { fieldId, fieldType, label, assignedTo: '', required: false },
        })
        .run();
    },
    []
  );

  const updateFieldInEditor = useCallback(
    (editor: Editor, fieldId: string, updates: Partial<VariableField>) => {
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'variableField' && node.attrs.fieldId === fieldId) {
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              ...updates,
            })
          );
          return false;
        }
      });
    },
    []
  );

  const addSignerRole = useCallback(() => {
    const id = crypto.randomUUID();
    setProperties((prev) => ({
      ...prev,
      signerRoles: [...prev.signerRoles, { id, name: 'Nuevo Firmante' }],
    }));
  }, []);

  const updateSignerRole = useCallback((id: string, name: string) => {
    setProperties((prev) => ({
      ...prev,
      signerRoles: prev.signerRoles.map((r) => (r.id === id ? { ...r, name } : r)),
    }));
  }, []);

  const removeSignerRole = useCallback((id: string) => {
    setProperties((prev) => ({
      ...prev,
      signerRoles: prev.signerRoles.filter((r) => r.id !== id),
    }));
  }, []);

  const buildTemplateData = useCallback(
    (editor: Editor, status: 'draft' | 'published') => {
      return {
        id: templateIdRef.current || crypto.randomUUID(),
        name: properties.name,
        description: properties.description,
        category: properties.category,
        language: properties.language,
        requires_efirma: properties.requiresEfirma,
        requires_nom151: properties.requiresNom151,
        signer_roles: properties.signerRoles,
        fields,
        content: editor.getJSON(),
        status,
        updated_at: new Date().toISOString(),
      };
    },
    [properties, fields]
  );

  const saveDraft = useCallback(
    async (editor: Editor) => {
      setIsSaving(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No autenticado');

        const { data: workspace } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', user.id)
          .limit(1)
          .single();

        const templateData = buildTemplateData(editor, 'draft');
        const payload = {
          ...templateData,
          created_by: user.id,
          workspace_id: workspace?.workspace_id || null,
        };

        if (templateIdRef.current) {
          await supabase.from('plantillas').update(payload).eq('id', templateIdRef.current);
        } else {
          const { data } = await supabase.from('plantillas').insert(payload).select('id').single();
          if (data) templateIdRef.current = data.id;
        }

        showToast('success', 'Borrador guardado correctamente');
        console.log('onSaveDraft', templateData);
      } catch (err) {
        console.error(err);
        showToast('error', 'Error al guardar el borrador');
      } finally {
        setIsSaving(false);
      }
    },
    [buildTemplateData, showToast]
  );

  const publishTemplate = useCallback(
    async (editor: Editor) => {
      setIsPublishing(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No autenticado');

        const { data: workspace } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', user.id)
          .limit(1)
          .single();

        const templateData = buildTemplateData(editor, 'published');
        const payload = {
          ...templateData,
          created_by: user.id,
          workspace_id: workspace?.workspace_id || null,
        };

        if (templateIdRef.current) {
          await supabase.from('plantillas').update(payload).eq('id', templateIdRef.current);
        } else {
          const { data } = await supabase.from('plantillas').insert(payload).select('id').single();
          if (data) templateIdRef.current = data.id;
        }

        showToast('success', '¡Plantilla publicada exitosamente!');
        console.log('onPublish', templateData);
      } catch (err) {
        console.error(err);
        showToast('error', 'Error al publicar la plantilla');
      } finally {
        setIsPublishing(false);
      }
    },
    [buildTemplateData, showToast]
  );

  return {
    fields,
    setFields,
    selectedFieldId,
    setSelectedFieldId,
    properties,
    setProperties,
    toasts,
    isSaving,
    isPublishing,
    showPreview,
    setShowPreview,
    syncFieldsFromEditor,
    insertField,
    updateFieldInEditor,
    addSignerRole,
    updateSignerRole,
    removeSignerRole,
    saveDraft,
    publishTemplate,
    showToast,
  };
}
