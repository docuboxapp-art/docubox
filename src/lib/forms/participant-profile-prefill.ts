import type { FormField } from './schema';

export interface ParticipantFormProfile {
  full_name?: string | null;
  nombre?: string | null;
  apellido_paterno?: string | null;
  apellido_materno?: string | null;
  personalidad_juridica?: string | null;
  rfc?: string | null;
  curp?: string | null;
  calle?: string | null;
  num_exterior?: string | null;
  num_interior?: string | null;
  colonia?: string | null;
  municipio?: string | null;
  localidad?: string | null;
  estado?: string | null;
}

const profileText = (value?: string | null) => value?.trim() || '';

/** Only documentary fields tied to the authenticated participant receive profile values. */
export function participantProfileValues(
  fields: FormField[],
  profile: ParticipantFormProfile | null | undefined
): Record<string, unknown> {
  profile = profile || {};

  const fullName = [profile.nombre, profile.apellido_paterno, profile.apellido_materno]
    .map(profileText).filter(Boolean).join(' ') || profileText(profile.full_name);
  const address = {
    street: profileText(profile.calle),
    exteriorNumber: profileText(profile.num_exterior),
    interiorNumber: profileText(profile.num_interior),
    neighborhood: profileText(profile.colonia),
    city: profileText(profile.municipio) || profileText(profile.localidad),
    state: profileText(profile.estado),
  };
  const personalValues: Partial<Record<FormField['type'], unknown>> = {
    rfc: profileText(profile.rfc),
    curp: profileText(profile.curp),
    business_name: profile.personalidad_juridica === 'moral' ? '' : fullName,
    person_first_name: profileText(profile.nombre),
    person_last_name: profileText(profile.apellido_paterno),
    person_second_last_name: profileText(profile.apellido_materno),
    fiscal_address: address,
  };

  return Object.fromEntries(fields
    .filter((field) => Object.prototype.hasOwnProperty.call(personalValues, field.type))
    .map((field) => [field.id, personalValues[field.type]]));
}

export function initialParticipantFormValues(
  fields: FormField[],
  profile: ParticipantFormProfile | null | undefined,
  savedValues: Record<string, unknown> = {}
): Record<string, unknown> {
  const defaults = Object.fromEntries(fields
    .filter((field) => field.defaultValue !== undefined)
    .map((field) => [field.id, field.defaultValue]));
  return { ...defaults, ...participantProfileValues(fields, profile), ...savedValues };
}
