export const FORM_PAGE_SIZES = [
  { value: 'letter', label: 'Carta (21.6 × 27.9 cm)', width: 612, height: 792 },
  { value: 'oficio', label: 'Oficio (21.6 × 33 cm)', width: 612, height: 936 },
  { value: 'legal', label: 'Legal (21.6 × 35.6 cm)', width: 612, height: 1008 },
  { value: 'tabloid', label: 'Tabloide (27.9 × 43.2 cm)', width: 792, height: 1224 },
  { value: 'a5', label: 'A5 (14.8 × 21 cm)', width: 419.53, height: 595.28 },
  { value: 'a4', label: 'A4 (21 × 29.7 cm)', width: 595.28, height: 841.89 },
  { value: 'a3', label: 'A3 (29.7 × 42 cm)', width: 841.89, height: 1190.55 },
] as const;

export type FormPageSize = (typeof FORM_PAGE_SIZES)[number]['value'];

export function normalizeFormPageSize(value: unknown): FormPageSize {
  return FORM_PAGE_SIZES.find((size) => size.value === value)?.value ?? 'letter';
}

export function getFormPageSize(value: unknown) {
  const normalized = normalizeFormPageSize(value);
  return FORM_PAGE_SIZES.find((size) => size.value === normalized)!;
}
