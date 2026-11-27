import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DocumentAccessError, requireDocumentIdentity } from '@/lib/security/document-access';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
const invitationCode = z.string().trim().min(6).max(128);

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Origen no autorizado.' }, { status: 403 });
  }
  try {
    const body = await request.json().catch(() => null);
    const code = invitationCode.safeParse(body?.code);
    if (!code.success) {
      return NextResponse.json({ error: 'Escribe el código de invitación.' }, { status: 422 });
    }
    const { user } = await requireDocumentIdentity(request);
    if (user.is_anonymous || !user.email_confirmed_at) {
      return NextResponse.json({ error: 'Confirma tu correo para unirte.' }, { status: 403 });
    }
    if (!(await consumeServerRateLimit({
      scope: 'workspace-invite-code',
      identifiers: [user.id],
      limit: 5,
      windowSeconds: 300,
    }))) {
      return NextResponse.json({ error: 'Espera unos minutos antes de volver a intentarlo.' }, { status: 429 });
    }
    const { data, error } = await createServiceClient().rpc('join_docubox_workspace', {
      p_user: user.id,
      p_code: code.data,
    });
    if (error?.message === 'workspace_code_invalid') {
      return NextResponse.json({ error: 'El código de invitación no es válido.' }, { status: 404 });
    }
    if (error?.message === 'workspace_membership_exists') {
      return NextResponse.json({ error: 'Ya existe una membresía para este espacio.' }, { status: 409 });
    }
    if (error || typeof data !== 'string') throw error ?? new Error('workspace_name_missing');
    return NextResponse.json({ name: data });
  } catch (error) {
    if (error instanceof DocumentAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'No fue posible unirse al espacio. Inténtalo de nuevo.' }, { status: 503 });
  }
}
