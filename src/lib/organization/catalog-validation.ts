import { z } from 'zod';
import { organizationCatalogs } from './catalog';

export function parseOrganizationCatalogValues(
  resource: string,
  input: Record<string, unknown>,
  creating = false
) {
  const config = organizationCatalogs[resource];
  if (!config) throw new Error('invalid_catalog');
  const shape: Record<string, z.ZodType> = {};
  for (const field of config.fields) {
    let schema: z.ZodType;
    if (field.type === 'checkbox') schema = z.boolean();
    else if (field.type === 'number')
      schema = z
        .number()
        .finite()
        .min(field.min ?? 0)
        .max(field.max ?? 999999999999)
        .refine(
          (value) =>
            !['required_representatives', 'alert_threshold_percent'].includes(field.key) ||
            Number.isInteger(value),
          'Escribe un número entero.'
        )
        .nullable();
    else if (field.type === 'relation') schema = z.string().uuid().nullable();
    else if (field.type === 'date')
      schema = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine(
          (value) =>
            !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
        )
        .nullable();
    else if (field.type === 'list')
      schema = z
        .array(z.string().trim().min(1).max(500))
        .max(100)
        .refine(
          (values) => !field.choices || values.every((value) => field.choices!.includes(value))
        )
        .refine((values) => !field.required || values.length > 0);
    else if (field.type === 'select')
      schema = z.string().refine((value) => Boolean(field.choices?.includes(value)));
    else if (field.type === 'email') schema = z.string().trim().email().max(254).nullable();
    else
      schema = z
        .string()
        .trim()
        .min(field.required ? 1 : 0)
        .max(field.max ?? (field.type === 'textarea' ? 5000 : 500))
        .nullable();
    if (field.required)
      schema = schema.refine(
        (value) => value !== null && value !== undefined,
        'Este campo es requerido.'
      );
    shape[field.key] = creating && field.required ? schema : schema.optional();
  }
  const values = z.object(shape).strict().parse(input);
  if (
    typeof values.valid_from === 'string' &&
    typeof values.valid_until === 'string' &&
    values.valid_from > values.valid_until
  )
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['valid_until'],
        message: 'La vigencia final debe ser posterior a la inicial.',
      },
    ]);
  if (resource === 'centers') {
    if (typeof values.code === 'string')
      values.code = z
        .string()
        .regex(/^[A-Z0-9._-]{2,30}$/)
        .parse(values.code.toUpperCase());
  }
  if (['centers', 'authorities'].includes(resource)) {
    if (typeof values.currency === 'string')
      values.currency = z
        .string()
        .regex(/^[A-Z]{3}$/)
        .parse(values.currency.toUpperCase());
  }
  if (resource === 'alerts' && Array.isArray(values.recipients))
    values.recipients = z.array(z.string().email()).max(50).parse(values.recipients);
  if (resource === 'policies' && Array.isArray(values.allowed_signature_types))
    values.allowed_signature_types = z
      .array(
        z.enum([
          'autografa',
          'click_sign',
          'otp',
          'biometrica',
          'efirma_sat',
          'csd',
          'fiel',
          'esignature',
          'webauthn',
          'totp',
          'otp_email',
          'efirma',
          'firma_simple',
          'firma_avanzada',
        ])
      )
      .min(1)
      .parse(values.allowed_signature_types);
  return values as Record<string, unknown>;
}
