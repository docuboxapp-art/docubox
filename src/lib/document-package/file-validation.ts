import { createHash } from 'node:crypto';
import { MAX_PACKAGE_FILE_BYTES } from './types';

const MIME_SIGNATURES: Array<{ mime: string; matches: (bytes: Buffer) => boolean }> = [
  {
    mime: 'application/pdf',
    matches: (bytes) => bytes.subarray(0, 5).toString('ascii') === '%PDF-',
  },
  {
    mime: 'image/png',
    matches: (bytes) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  },
  {
    mime: 'image/jpeg',
    matches: (bytes) =>
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
];

export class PackageFileValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export function safePackageFileName(name: string) {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.')
      .slice(-120) || 'archivo'
  );
}

export async function validatePackageFile(
  file: File,
  allowedMimeTypes: readonly string[],
  maxSizeBytes = MAX_PACKAGE_FILE_BYTES
) {
  if (file.size <= 0 || file.size > maxSizeBytes) {
    throw new PackageFileValidationError(
      'PACKAGE_FILE_SIZE_INVALID',
      `El archivo debe pesar menos de ${Math.floor(maxSizeBytes / 1024 / 1024)} MB.`,
      413
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const detectedMime = MIME_SIGNATURES.find((signature) => signature.matches(bytes))?.mime || null;
  if (!detectedMime || !allowedMimeTypes.includes(detectedMime)) {
    bytes.fill(0);
    throw new PackageFileValidationError(
      'PACKAGE_FILE_TYPE_INVALID',
      'El contenido del archivo no coincide con un formato permitido.',
      415
    );
  }
  if (file.type && file.type !== 'application/octet-stream' && file.type !== detectedMime) {
    bytes.fill(0);
    throw new PackageFileValidationError(
      'PACKAGE_FILE_MIME_MISMATCH',
      'El tipo declarado del archivo no coincide con su contenido.',
      415
    );
  }
  return {
    bytes,
    detectedMime,
    safeName: safePackageFileName(file.name),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
