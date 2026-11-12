type SignatureField = { type?: string; required?: boolean };

export function requiresFormSignature(
  settings: { requiresSignature?: boolean } | null | undefined,
  _fields: SignatureField[]
): boolean {
  return settings?.requiresSignature !== false;
}
