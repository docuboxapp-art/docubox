import { createDefaultFormTemplate, type FormTemplate } from './schema';

export function createFormDesignPreviewTemplate(): FormTemplate {
  const template = createDefaultFormTemplate();
  const sectionId = template.sections[0].id;
  template.name = 'Ejemplo de formulario';
  template.description = 'Así se presentará el formulario al participante.';
  template.schema = [
    { id: 'sample-name', type: 'text', label: 'Nombre completo', slug: 'nombre_completo', placeholder: 'Escribe tu nombre', required: true, readOnly: false, conditionalVisible: false, sectionId },
    { id: 'sample-email', type: 'email', label: 'Correo electrónico', slug: 'correo_electronico', placeholder: 'correo@ejemplo.com', required: false, readOnly: false, conditionalVisible: false, sectionId },
    { id: 'sample-notes', type: 'textarea', label: 'Comentarios', slug: 'comentarios', placeholder: 'Escribe tus comentarios', required: false, readOnly: false, conditionalVisible: false, sectionId },
  ];
  template.sections[0].fieldIds = template.schema.map((field) => field.id);
  return template;
}
