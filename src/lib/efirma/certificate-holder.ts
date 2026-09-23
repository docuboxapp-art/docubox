const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;
const CURP_PATTERN = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]{2}$/i;
const COUNTRY_PATTERN = /^(?:MX|MEX|MEXICO|MÉXICO)$/i;

function cleanDistinguishedNameValue(value: string) {
  return value
    .replace(/^\s*(?:CN|NAME|GIVENNAME|SURNAME|SN|2\.5\.4\.\d+)\s*=\s*/i, '')
    .replace(/\\,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHolderNameCandidate(value: string) {
  if (value.length < 5 || value.includes('@')) return false;
  if (RFC_PATTERN.test(value) || CURP_PATTERN.test(value) || COUNTRY_PATTERN.test(value)) {
    return false;
  }

  const words = value.match(/[A-ZÁÉÍÓÚÜÑ]{2,}/gi) || [];
  return words.length >= 2;
}

/**
 * Returns only the human-readable holder name from a SAT certificate subject.
 * Legacy records may contain the complete flattened DN instead of the common name.
 */
export function normalizeEfirmaHolderName(
  subjectOrName: string | null | undefined,
  fallback = ''
) {
  const raw = String(subjectOrName || '').trim();
  const commonName = raw.match(/(?:^|[,/])\s*CN\s*=\s*([^,/]+)/i)?.[1];
  const values = commonName ? [commonName] : raw.split(/[,\n]+/);
  const seen = new Set<string>();

  for (const value of values) {
    const candidate = cleanDistinguishedNameValue(value);
    const identity = candidate.toLocaleUpperCase('es-MX');
    if (!candidate || seen.has(identity)) continue;
    seen.add(identity);
    if (isHolderNameCandidate(candidate)) return candidate;
  }

  return cleanDistinguishedNameValue(fallback);
}
