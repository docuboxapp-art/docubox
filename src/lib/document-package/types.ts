export const SUPPLEMENTAL_RESOURCE_TYPES = [
  'informative',
  'read_required',
  'acceptance_required',
  'downloadable',
] as const;

export type SupplementalResourceType = (typeof SUPPLEMENTAL_RESOURCE_TYPES)[number];

export const PARTICIPANT_REQUIREMENT_STATUSES = [
  'pending',
  'provided',
  'accepted',
  'rejected',
  'waived',
] as const;

export type ParticipantRequirementStatus = (typeof PARTICIPANT_REQUIREMENT_STATUSES)[number];

export type ParticipantDeliveryMode = 'remote' | 'in_person';

export type SupplementalDocumentDraft = {
  id: string;
  title: string;
  description: string;
  type: SupplementalResourceType;
  file: File;
};

export type SerializableSupplementalDocument = Omit<SupplementalDocumentDraft, 'file'> & {
  fileName: string;
  fileSize: number;
  mimeType: string;
};

export type ParticipantRequirementDraft = {
  id: string;
  name: string;
  description: string;
  required: boolean;
  allowedMimeTypes: string[];
  maxSizeBytes: number;
};

export type PackageParticipantConfiguration = {
  participantId: string;
  deliveryMode: ParticipantDeliveryMode;
  requirements: ParticipantRequirementDraft[];
  visibleResourceIds: string[];
};

export const DEFAULT_REQUIREMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export const MAX_PACKAGE_FILE_BYTES = 25 * 1024 * 1024;

export function serializeSupplementalDocument(
  resource: SupplementalDocumentDraft
): SerializableSupplementalDocument {
  return {
    id: resource.id,
    title: resource.title.trim(),
    description: resource.description.trim(),
    type: resource.type,
    fileName: resource.file.name,
    fileSize: resource.file.size,
    mimeType: resource.file.type || 'application/octet-stream',
  };
}

export function isSupplementalResourceType(value: unknown): value is SupplementalResourceType {
  return SUPPLEMENTAL_RESOURCE_TYPES.includes(value as SupplementalResourceType);
}
