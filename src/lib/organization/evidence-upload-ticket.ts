import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
export const ORGANIZATION_EVIDENCE_MAX_BYTES = 15 * 1024 * 1024;
export const evidenceUploadSchema = z
  .object({
    workspace_id: z.string().uuid(),
    person_id: z.string().uuid(),
    evidence_type: z.string().trim().min(2).max(80),
    display_name: z.string().trim().min(2).max(180),
    valid_from: z.string().date().nullable().default(null),
    valid_until: z.string().date().nullable().default(null),
    file_name: z.string().trim().min(1).max(255),
    mime_type: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    size_bytes: z.number().int().min(1).max(ORGANIZATION_EVIDENCE_MAX_BYTES),
    sha256_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .refine(
    (value) => !value.valid_from || !value.valid_until || value.valid_from <= value.valid_until,
    'Revisa la vigencia del documento.'
  );
const ticketSchema = z.object({
  version: z.literal(1),
  actor_id: z.string().uuid(),
  evidence_id: z.string().uuid(),
  expires_at: z.number().int(),
  storage_path: z.string().max(500),
  values: evidenceUploadSchema,
});
function signature(value: string) {
  const key = process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY;
  if (!key || key.length < 32) throw new Error('organization_upload_key_unavailable');
  return createHmac('sha256', key)
    .update('organization-evidence-upload:v1:' + value)
    .digest();
}
export function createEvidenceUploadTicket(value: z.infer<typeof ticketSchema>) {
  const encoded = Buffer.from(JSON.stringify(ticketSchema.parse(value))).toString('base64url');
  return encoded + '.' + signature(encoded).toString('base64url');
}
export function verifyEvidenceUploadTicket(value: string, now = Date.now()) {
  const [encoded, mac, extra] = value.split('.');
  if (!encoded || !mac || extra) throw new Error('organization_upload_ticket_invalid');
  const actual = Buffer.from(mac, 'base64url'),
    expected = signature(encoded);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error('organization_upload_ticket_invalid');
  const ticket = ticketSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  if (ticket.expires_at <= now || ticket.expires_at > now + 16 * 60000)
    throw new Error('organization_upload_ticket_expired');
  return ticket;
}
export function evidenceContentMatches(bytes: Uint8Array, mime: string) {
  if (mime === 'application/pdf')
    return Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-';
  if (mime === 'image/png')
    return Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}
