export const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] as const;
export const DOCUMENT_EXTENSIONS = ['pdf', ...OFFICE_EXTENSIONS] as const;

export type OfficeExtension = (typeof OFFICE_EXTENSIONS)[number];
export type DocumentExtension = (typeof DOCUMENT_EXTENSIONS)[number];
export type ConversionErrorCode =
  | 'CONVERSION_QUOTA_EXHAUSTED'
  | 'CONVERSION_USAGE_LIMITED'
  | 'CONVERSION_RATE_LIMITED'
  | 'CONVERSION_PROVIDER_UNAVAILABLE'
  | 'CONVERSION_FAILED'
  | 'CONVERSION_TIMEOUT';
export type ConversionJobState = 'waiting' | 'processing' | 'finished' | 'failed';

export type ConversionUpload = {
  url: string;
  parameters: Record<string, string>;
};

export type CreatedConversionJob = {
  id: string;
  upload: ConversionUpload;
};

export type ConversionJobStatus = {
  state: ConversionJobState;
  file?: { url: string; filename: string };
  retryAfterMs?: number;
  errorCode?: ConversionErrorCode;
};

export interface DocumentConverter {
  createOfficeToPdfJob(input: {
    filename: string;
    extension: OfficeExtension;
  }): Promise<CreatedConversionJob>;
  getJobStatus(jobId: string): Promise<ConversionJobStatus>;
}

export class DocumentConversionError extends Error {
  constructor(
    readonly code: ConversionErrorCode,
    readonly httpStatus: number,
    readonly retryAfterMs?: number
  ) {
    super(code);
    this.name = 'DocumentConversionError';
  }
}

export function getDocumentExtension(filename: string): DocumentExtension | null {
  const extension = filename.trim().toLowerCase().split('.').pop();
  return DOCUMENT_EXTENSIONS.includes(extension as DocumentExtension)
    ? (extension as DocumentExtension)
    : null;
}

export function isOfficeExtension(extension: string): extension is OfficeExtension {
  return OFFICE_EXTENSIONS.includes(extension as OfficeExtension);
}
