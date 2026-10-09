type SignatureField = { type?: string; required?: boolean };

export function requiresFormSignature(
  _settings: { requiresSignature?: boolean } | null | undefined,
  _fields: SignatureField[]
): boolean {
  return true;
}
