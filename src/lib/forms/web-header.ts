import type { FormTemplate } from './schema';

export function resolveFormWebHeader(template: FormTemplate, documentTypeName?: string) {
  const { appearance } = template.settings;
  const titleOverride = appearance.headerText === 'Formulario firmable' ? '' : appearance.headerText;
  return {
    title: appearance.showTitle ? titleOverride || template.name : '',
    description: appearance.showDescription ? appearance.headerDescription || template.description : '',
    documentNumber: appearance.showDocumentNumber
      ? template.settings.documentNumber || appearance.headerDocumentNumber : '',
    documentType: appearance.showDocumentType
      ? documentTypeName || template.settings.documentTypeName || appearance.headerDocumentTypeName || ''
      : '',
  };
}
