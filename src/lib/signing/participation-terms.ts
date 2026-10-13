export type ParticipationRole = 'firmante' | 'aprobador' | 'testigo' | 'observador';

export const DEFAULT_PARTICIPATION_INTRO =
  'Al aceptar y participar en este documento, usted declara y acepta lo siguiente:';

export const DEFAULT_PARTICIPATION_CLAUSES = [
  'Que ha revisado el contenido completo del documento y comprende su alcance y obligaciones.',
  'Que la firma electrónica o aprobación que otorgue tiene plena validez legal conforme a la legislación aplicable.',
  'Que los datos proporcionados son verídicos y corresponden a su identidad.',
  'Que autoriza el tratamiento de sus datos personales para los fines del presente documento.',
  'Que la fecha y hora de su participación quedarán registradas de forma inmutable en el sistema.',
] as const;

export const DEFAULT_PARTICIPATION_FOOTER =
  'Este proceso está respaldado por la plataforma DocuBox y cumple con los estándares de firma electrónica avanzada.';

export function defaultParticipationClauses(role: ParticipationRole): string[] {
  const clauses: string[] = [...DEFAULT_PARTICIPATION_CLAUSES];
  if (role === 'firmante')
    clauses.push('Que su firma autógrafa digital es un acto voluntario y tiene el mismo valor que una firma manuscrita.');
  if (role === 'testigo')
    clauses.push('Que su participación registra un testimonio electrónico del acto, sin atribuir efectos notariales.');
  if (role === 'aprobador')
    clauses.push('Que su visto bueno constituye una aprobación formal del contenido del documento.');
  return clauses;
}

export function participationTermsText(customText: string | null | undefined, role: ParticipationRole): string {
  if (customText?.trim()) return customText.trim();
  const clauses = defaultParticipationClauses(role)
    .map((clause, index) => `${index + 1}. ${clause}`)
    .join('\n');
  return `${DEFAULT_PARTICIPATION_INTRO}\n\n${clauses}\n\n${DEFAULT_PARTICIPATION_FOOTER}`;
}
