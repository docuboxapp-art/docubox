export interface ImportedTemplateField {
  id: string;
  valueKey: string;
  label: string;
  fieldType: string;
  customName: string;
  showLabelInDocument: boolean;
  options: string[];
  pageIndex: number;
  scope: 'general';
  required: boolean;
  assignedParticipantId: null;
}

export interface TemplateDocxImportStats {
  paragraphs: number;
  headings: number;
  lists: number;
  tables: number;
  images: number;
  variables: number;
  pageBreaks: number;
}

export interface TemplateDocxImportResult {
  importId: string;
  workspaceId: string;
  originalFilename: string;
  suggestedName: string;
  contentHtml: string;
  fields: ImportedTemplateField[];
  warnings: string[];
  stats: TemplateDocxImportStats;
  createdAt: string;
  expiresAt: string;
}
