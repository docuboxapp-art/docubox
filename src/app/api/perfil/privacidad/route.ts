import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  PROFILE_FIELDS,
  PROFILE_SCOPES,
  PROFILE_SECTIONS,
  PROFILE_VISIBILITY_MODES,
  SEARCH_CRITERIA,
} from '@/lib/profile-privacy/model';
import { ProfilePrivacyError, runProfilePrivacy } from '@/lib/profile-privacy/server';
import { DocumentAccessError, requireDocumentIdentity } from '@/lib/security/document-access';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';

export const runtime = 'nodejs';
const uuid = z.uuid();
const peer = { peerId: uuid.optional(), contactId: uuid.optional(), documentId: uuid.optional() };
const fieldKeys = z.enum(PROFILE_FIELDS.map(({ key }) => key));
const legacyScopes = ['nadie', 'workspaces', 'contactos', 'cualquiera'] as const;
const contactPreferences = {
  allowContacts: z.boolean(),
  allowMessages: z.boolean(),
  allowNotes: z.boolean(),
};
const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings') }),
  z.object({
    action: z.literal('save'),
    scope: z.enum(legacyScopes),
    fields: z.partialRecord(fieldKeys, z.enum([...legacyScopes, 'heredar'])),
    ...contactPreferences,
  }),
  z.object({ action: z.literal('settings_v2') }),
  z.object({
    action: z.literal('save_v2'),
    mode: z.enum(PROFILE_VISIBILITY_MODES),
    scope: z.enum(PROFILE_SCOPES),
    sections: z
      .array(z.enum(PROFILE_SECTIONS.map(({ key }) => key)))
      .max(PROFILE_SECTIONS.length)
      .optional(),
    fields: z.partialRecord(fieldKeys, z.enum(PROFILE_SCOPES)),
    ...contactPreferences,
  }),
  z.object({
    action: z.literal('search'),
    criterion: z.enum(SEARCH_CRITERIA),
    query: z.string().trim().min(2).max(254),
  }),
  z.object({ action: z.literal('cards'), ids: z.array(uuid).max(75) }),
  z.object({ action: z.literal('profile'), peerId: uuid.optional(), contactId: uuid.optional() }),
  z.object({
    action: z.literal('request'),
    peerId: uuid,
    emailHint: z.string().trim().min(1).max(254).optional(),
  }),
  z
    .object({
      action: z.literal('add_contact'),
      peerId: uuid.optional(),
      email: z.email().max(254).optional(),
    })
    .refine(({ peerId, email }) => Boolean(peerId || email)),
  z.object({
    action: z.literal('register'),
    name: z.string().trim().min(1).max(200),
    email: z.email().max(254).nullable(),
    phone: z.string().max(40).optional(),
  }),
  z.object({ action: z.literal('requests') }),
  z.object({ action: z.literal('requests_v2') }),
  z.object({
    action: z.literal('decide'),
    requestId: uuid,
    decision: z.enum(['approve', 'decline', 'revoke']),
  }),
  z.object({ action: z.literal('visits') }),
  z.object({ action: z.literal('blocks') }),
  z.object({
    action: z.literal('block'),
    peerId: uuid.optional(),
    email: z.email().max(254).optional(),
  }),
  z.object({ action: z.literal('unblock'), peerId: uuid }),
  z.object({ action: z.literal('conversation'), ...peer }),
  z.object({ action: z.literal('inbox') }),
  z.object({
    action: z.literal('send'),
    ...peer,
    messageId: uuid,
    kind: z.enum(['message', 'note']),
    content: z.string().trim().min(1).max(2000),
  }),
]);

const limited = new Set(['search', 'request', 'add_contact', 'register', 'block', 'send']);

export async function POST(request: NextRequest) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin)
      return reply({ error: 'Origen no autorizado.' }, 403);
    const body = action.safeParse(await request.json().catch(() => null));
    if (!body.success)
      return reply({ error: 'Revisa los datos ingresados e inténtalo de nuevo.' }, 422);
    const { user } = await requireDocumentIdentity(request);
    if (user.is_anonymous || !user.email_confirmed_at)
      return reply({ error: 'Confirma tu correo para continuar.' }, 403);
    const { action: operation, ...payload } = body.data;
    if (
      limited.has(operation) &&
      !(await consumeServerRateLimit({
        scope: `profile-privacy-${operation}`,
        identifiers: [user.id],
        limit: 30,
        windowSeconds: 60,
      }))
    )
      return reply({ error: 'Espera un momento antes de volver a intentarlo.' }, 429);
    const data = await runProfilePrivacy(
      user.id,
      operation,
      { ...payload, purpose: 'contact' },
      request.signal
    );
    return reply({ data });
  } catch (error) {
    if (error instanceof ProfilePrivacyError || error instanceof DocumentAccessError) {
      const needsSetup =
        error instanceof ProfilePrivacyError && ['PGRST202', '42883'].includes(error.code || '');
      return reply(
        { error: error.message, ...(needsSetup ? { code: 'PRIVACY_SETUP' } : {}) },
        error.status
      );
    }
    return reply({ error: 'No fue posible completar la operación. Intenta más tarde.' }, 503);
  }
}
