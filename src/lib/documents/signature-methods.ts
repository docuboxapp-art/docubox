/** Historical participants stored a single method as text; newer invitations store a list. */
export function signatureMethodList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [
    ...new Set(
      values
        .filter((method): method is string => typeof method === 'string')
        .map((method) => method.trim())
        .filter(Boolean)
    ),
  ];
}

export function signatureMethodLabel(method: string): string {
  return (
    (
      {
        click_sign: 'Firma con clic',
        autografa_digital: 'Firma autógrafa digital',
        efirma_sat: 'e.firma SAT',
      } as Record<string, string>
    )[method] || method
  );
}
