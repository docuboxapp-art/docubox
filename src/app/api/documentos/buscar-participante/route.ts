import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { SEARCH_CRITERIA, type SearchCriterion } from '@/lib/profile-privacy/model';
import { ProfilePrivacyError, runProfilePrivacy } from '@/lib/profile-privacy/server';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

const columns = {
  correo: 'email',
  telefono: 'phone',
  nombre: 'full_name',
  rfc: 'rfc',
  curp: 'curp',
} as const;

async function authenticatedUser(req: NextRequest): Promise<User | null> {
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const { data } = await createAnonClient(bearer).auth.getUser(bearer);
    if (data.user) return data.user;
  }
  const store = await cookies();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll() {} } }
  );
  return (await client.auth.getUser()).data.user;
}

export async function GET(req: NextRequest) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const query = req.nextUrl.searchParams.get('q')?.trim() || '';
  const rawCriterion = req.nextUrl.searchParams.get('criteria') || 'correo';
  const criterion = SEARCH_CRITERIA.find((value) => value === rawCriterion) || 'correo';
  try {
    const user = await authenticatedUser(req);
    if (!user || user.is_anonymous || !user.email_confirmed_at)
      return reply({ error: 'Inicia sesión para buscar participantes.' }, 401);
    if (query.length < 2 || query.length > 254) return reply({ users: [] });
    if (
      !(await consumeServerRateLimit({
        scope: 'profile-directory-participants',
        identifiers: [user.id],
        limit: 40,
        windowSeconds: 60,
      }))
    )
      return reply({ error: 'Espera un momento antes de buscar de nuevo.' }, 429);

    const users = await runProfilePrivacy(
      user.id,
      'search',
      { query, criterion, purpose: 'participant' },
      req.signal
    );
    return reply({ users });
  } catch (error) {
    // Keep selecting participants during the rollout to databases that do not have
    // the privacy migration yet. The legacy projection only carries routing data.
    if (
      error instanceof ProfilePrivacyError &&
      ['PGRST202', '42883'].includes(error.code || '') &&
      query.length >= 2 &&
      query.length <= 254
    ) {
      try {
        return reply({ users: await legacyParticipants(criterion, query) });
      } catch {
        return reply({ error: 'No fue posible buscar participantes en este momento.' }, 503);
      }
    }
    return reply({ error: 'No fue posible buscar participantes en este momento.' }, 503);
  }
}

async function legacyParticipants(criterion: SearchCriterion, query: string) {
  const { data, error } = await createServiceClient()
    .from('user_profiles')
    .select('id,full_name,email')
    .eq('is_active', true)
    .eq(columns[criterion], query)
    .limit(10);
  if (error) throw error;
  return data;
}
