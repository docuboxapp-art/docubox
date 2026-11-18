import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  activityFailure,
  activityHeaders,
  activityIdentity,
  resolveActivityAccess,
} from '@/lib/activity/access.server';
import type { ActivitySource } from '@/lib/activity/model';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const actor = await activityIdentity(request);
    if (request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin)
      return NextResponse.json(
        { error: 'Origen no permitido.' },
        { status: 403, headers: activityHeaders }
      );
    const raw = await request.text();
    if (raw.length > 1000)
      return NextResponse.json(
        { error: 'Solicitud inválida.' },
        { status: 422, headers: activityHeaders }
      );
    const body = JSON.parse(raw);
    if (
      !body ||
      !['form-token', 'form-public', 'case-invitation'].includes(body.source) ||
      typeof body.id !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id)
    )
      return NextResponse.json(
        { error: 'Participación inválida.' },
        { status: 422, headers: activityHeaders }
      );
    const url = await resolveActivityAccess(
      createServiceClient(),
      actor,
      body.source as ActivitySource,
      body.id,
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
    return NextResponse.json({ data: { url } }, { headers: activityHeaders });
  } catch (cause) {
    const failure =
      cause instanceof SyntaxError
        ? { error: 'Solicitud inválida.', status: 422 }
        : activityFailure(cause);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status, headers: activityHeaders }
    );
  }
}
