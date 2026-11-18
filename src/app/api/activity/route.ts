import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { activityFailure, activityHeaders, activityIdentity } from '@/lib/activity/access.server';
import { loadCaseActivity, loadFormActivity } from '@/lib/activity/inbox.server';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const actor = await activityIdentity(request);
    const mode = request.nextUrl.searchParams.get('mode');
    const kind = request.nextUrl.searchParams.get('kind');
    if (
      !['sent', 'received'].includes(mode || '') ||
      !['formularios', 'expedientes'].includes(kind || '')
    )
      return NextResponse.json(
        { error: 'Selecciona una bandeja y un tipo válidos.' },
        { status: 422, headers: activityHeaders }
      );
    const data = await (kind === 'formularios' ? loadFormActivity : loadCaseActivity)(
      createServiceClient(),
      actor,
      mode as 'sent' | 'received'
    );
    return NextResponse.json({ data: { items: data } }, { headers: activityHeaders });
  } catch (cause) {
    const failure = activityFailure(cause);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status, headers: activityHeaders }
    );
  }
}
