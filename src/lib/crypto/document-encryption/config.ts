import { DocumentEncryptionError } from './errors';
import { GoogleCloudDocumentKeyProvider } from './kms/google-kms';
import { DocumentEncryptionService } from './document-encryption.service';

function enabled(name: string) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env[name] || '')
      .trim()
      .toLowerCase()
  );
}

export function documentEncryptionPolicy() {
  const production =
    String(process.env.VERCEL_ENV || '').toLowerCase() === 'production' ||
    String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const required = production || enabled('DOCUMENT_ENCRYPTION_REQUIRED');
  const encryptionEnabled = required || enabled('DOCUMENT_ENCRYPTION_ENABLED');
  const legacyAllowed = enabled('DOCUMENT_LEGACY_DECRYPTION_ALLOWED');
  return { required, enabled: encryptionEnabled, legacyAllowed };
}

export function createDocumentEncryptionService() {
  const policy = documentEncryptionPolicy();
  if (!policy.enabled) {
    throw new DocumentEncryptionError(
      'DOCUMENT_ENCRYPTION_NOT_CONFIGURED',
      'El cifrado documental no esta habilitado.',
      503
    );
  }
  return new DocumentEncryptionService(GoogleCloudDocumentKeyProvider.fromEnvironment());
}

export async function validateDocumentEncryptionConfiguration() {
  const policy = documentEncryptionPolicy();
  if (!policy.enabled) {
    return {
      ready: !policy.required,
      required: policy.required,
      missing: policy.required ? ['DOCUMENT_ENCRYPTION_ENABLED'] : [],
    };
  }
  const provider = GoogleCloudDocumentKeyProvider.fromEnvironment();
  const health = await provider.healthCheck();
  if (policy.required && !health.ready) {
    throw new DocumentEncryptionError(
      'DOCUMENT_ENCRYPTION_NOT_CONFIGURED',
      `El cifrado documental obligatorio no esta listo: ${health.missing.join(', ')}.`,
      503
    );
  }
  return { ...health, required: policy.required };
}
