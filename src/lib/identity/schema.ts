export type IdentityPolicyStatus = 'draft' | 'active' | 'archived';
export type AssuranceLevel = 'basic' | 'standard' | 'enhanced' | 'custom';
export type LivenessMode = 'passive' | 'active' | 'hybrid' | 'assisted';

export interface IdentityDocumentRequirement {
  id: string;
  name: string;
  subject: 'individual' | 'company' | 'representative' | 'beneficial_owner';
  requirement: 'required' | 'optional' | 'conditional';
  sides: 1 | 2;
  ocr: boolean;
  authenticity: boolean;
  expirationCheck: boolean;
}

export interface IdentityPolicyConfig {
  name: string;
  description: string;
  type: 'signature' | 'kyc' | 'kyb' | 'enrollment' | 'revalidation';
  assuranceLevel: AssuranceLevel;
  appliesTo: string[];
  participantTypes: string[];
  verificationMoment: 'before_access' | 'before_review' | 'before_signing';
  validityMode: 'event' | 'document' | 'case_file' | 'days';
  validityDays: number;
  manualReview: 'never' | 'exception' | 'always';
  blockOnFailure: boolean;
  reuseMode: 'never' | 'valid' | 'liveness' | 'step_up' | 'risk' | 'approval';
  maxEnrollmentAgeDays: number;
  requireValidDocument: boolean;
  requireSameTenant: boolean;
  requireNoAlerts: boolean;
  requireSufficientLevel: boolean;
  captureModes: string[];
  livenessMode: LivenessMode;
  livenessChecks: string[];
  comparisonChecks: string[];
  injectionDetection: boolean;
  deviceIntelligence: boolean;
  otp: boolean;
  passkey: boolean;
  videoConsent: boolean;
  videoConsentMode: 'silent' | 'read_phrase' | 'random_phrase' | 'questions';
  videoConsentText: string;
  documents: IdentityDocumentRequirement[];
  privacyConsent: boolean;
  biometricConsent: boolean;
  retentionDays: number;
  autoApproveScore: number;
  manualReviewScore: number;
  allowRetry: boolean;
  maxAttempts: number;
  alternativeMethod: boolean;
  generatePdfReport: boolean;
  generateEvidencePackage: boolean;
  timestampEvidence: boolean;
}

export interface IdentityPolicyRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: IdentityPolicyStatus;
  policyType: IdentityPolicyConfig['type'];
  assuranceLevel: AssuranceLevel;
  version: number;
  config: IdentityPolicyConfig;
  updatedAt: string;
}

const doc = (
  name: string,
  subject: IdentityDocumentRequirement['subject'] = 'individual',
  requirement: IdentityDocumentRequirement['requirement'] = 'required',
): IdentityDocumentRequirement => ({
  id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${subject}`,
  name,
  subject,
  requirement,
  sides: name.includes('Credencial') ? 2 : 1,
  ocr: true,
  authenticity: true,
  expirationCheck: true,
});

export const BASE_IDENTITY_POLICY: IdentityPolicyConfig = {
  name: '',
  description: '',
  type: 'signature',
  assuranceLevel: 'standard',
  appliesTo: ['Documentos'],
  participantTypes: ['Firmante'],
  verificationMoment: 'before_signing',
  validityMode: 'event',
  validityDays: 90,
  manualReview: 'exception',
  blockOnFailure: true,
  reuseMode: 'risk',
  maxEnrollmentAgeDays: 180,
  requireValidDocument: true,
  requireSameTenant: true,
  requireNoAlerts: true,
  requireSufficientLevel: true,
  captureModes: ['Selfie fotografica', 'Captura automatica'],
  livenessMode: 'hybrid',
  livenessChecks: ['Rostro completo', 'Nitidez e iluminacion', 'Una sola persona'],
  comparisonChecks: ['Documento vs. selfie', 'Enrolamiento vs. selfie'],
  injectionDetection: true,
  deviceIntelligence: true,
  otp: true,
  passkey: false,
  videoConsent: false,
  videoConsentMode: 'read_phrase',
  videoConsentText: 'Yo, [nombre], confirmo que revise el documento con folio [folio] y manifiesto mi voluntad de firmarlo electronicamente.',
  documents: [doc('Credencial para votar')],
  privacyConsent: true,
  biometricConsent: true,
  retentionDays: 365,
  autoApproveScore: 90,
  manualReviewScore: 80,
  allowRetry: true,
  maxAttempts: 3,
  alternativeMethod: true,
  generatePdfReport: true,
  generateEvidencePackage: true,
  timestampEvidence: true,
};

export const IDENTITY_POLICY_PRESETS: Array<{
  id: string;
  name: string;
  description: string;
  config: IdentityPolicyConfig;
}> = [
  {
    id: 'basic',
    name: 'Identidad basica',
    description: 'OTP, documento oficial, OCR, selfie y prueba de vida pasiva.',
    config: {
      ...BASE_IDENTITY_POLICY,
      name: 'Identidad basica',
      assuranceLevel: 'basic',
      livenessMode: 'passive',
      injectionDetection: false,
      deviceIntelligence: false,
      comparisonChecks: ['Documento vs. selfie'],
      generateEvidencePackage: false,
    },
  },
  {
    id: 'standard',
    name: 'Firmante estandar',
    description: 'Verificacion documental, prueba hibrida por riesgo y reporte PDF.',
    config: { ...BASE_IDENTITY_POLICY, name: 'Firmante estandar' },
  },
  {
    id: 'enhanced',
    name: 'Identidad reforzada',
    description: 'Prueba hibrida, deteccion de inyeccion, videoconsentimiento y evidencia tecnica.',
    config: {
      ...BASE_IDENTITY_POLICY,
      name: 'Identidad reforzada',
      type: 'kyc',
      assuranceLevel: 'enhanced',
      videoConsent: true,
      passkey: true,
      documents: [doc('Credencial para votar'), doc('Comprobante de domicilio', 'individual', 'conditional')],
    },
  },
  {
    id: 'kyb',
    name: 'KYB reforzado',
    description: 'Empresa, representante legal, facultades y beneficiarios controladores.',
    config: {
      ...BASE_IDENTITY_POLICY,
      name: 'KYB reforzado',
      type: 'kyb',
      assuranceLevel: 'enhanced',
      participantTypes: ['Representante legal', 'Beneficiario controlador'],
      videoConsent: true,
      documents: [
        doc('Acta constitutiva', 'company'),
        doc('Constancia de situacion fiscal', 'company'),
        doc('Poder notarial', 'representative'),
        doc('Identificacion oficial', 'representative'),
        doc('Declaracion de beneficiarios controladores', 'beneficial_owner'),
      ],
    },
  },
];

export function clonePolicyConfig(config: IdentityPolicyConfig): IdentityPolicyConfig {
  return JSON.parse(JSON.stringify(config));
}

export function policyFriction(config: IdentityPolicyConfig): 'Baja' | 'Media' | 'Alta' {
  const score = (config.videoConsent ? 2 : 0) + (config.livenessMode === 'active' ? 2 : config.livenessMode === 'hybrid' ? 1 : 0) + (config.documents.length > 2 ? 2 : 0) + (config.passkey ? 1 : 0);
  return score >= 5 ? 'Alta' : score >= 2 ? 'Media' : 'Baja';
}

export function policyControlCount(config: IdentityPolicyConfig): number {
  return config.captureModes.length + config.livenessChecks.length + config.comparisonChecks.length + Number(config.otp) + Number(config.passkey) + Number(config.injectionDetection) + Number(config.deviceIntelligence) + Number(config.videoConsent);
}
