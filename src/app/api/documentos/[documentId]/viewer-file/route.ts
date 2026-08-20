import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveLegacyDocumentStoragePath } from '@/lib/documents/internal-source';

const SIGNED_URL_TTL_SECONDS = 5 * 60;

function normalizeEmail(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isParticipant(participants: unknown, userId: string, userEmail: string) {
  if (!Array.isArray(participants)) return false;
  return participants.some((participant) => {
    if (!participant || typeof participant !== 'object') return false;
    const row = participant as Record<string, unknown>;
    return (
      row.id === userId ||
      row.user_id === userId ||
      (userEmail && normalizeEmail(row.email) === userEmail)
    );
  });
}

async function authenticatedUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  const service = createServiceClient();
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    const auth = await service.auth.getUser(token);
    if (!auth.error && auth.data.user) return auth.data.user;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => undefined,
      },
    }
  );
  const auth = await supabase.auth.getUser();
  return auth.error ? null : auth.data.user;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const user = await authenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    const { documentId } = await context.params;
    const service = createServiceClient();
    const documentResult = await service
      .from('documentos')
      .select(
        'id,owner_id,workspace_id,participantes,storage_path,file_url,sealed_pdf_path,file_name,estado'
      )
      .eq('id', documentId)
      .is('deleted_at', null)
      .maybeSingle();

    if (documentResult.error) throw documentResult.error;
    const document = documentResult.data;
    if (!document) {
      return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
    }

    const email = normalizeEmail(user.email);
    const owner = document.owner_id === user.id;
    let participant = isParticipant(document.participantes, user.id, email);
    let workspaceManager = false;

    if (!owner && !participant) {
      const participationById = await service
        .from('participation_responses')
        .select('id')
        .eq('documento_id', document.id)
        .eq('participante_id', user.id)
        .limit(1)
        .maybeSingle();
      if (participationById.error) throw participationById.error;
      participant = Boolean(participationById.data);

      if (!participant && email) {
        const participationByEmail = await service
          .from('participation_responses')
          .select('id')
          .eq('documento_id', document.id)
          .ilike('participante_email', email)
          .limit(1)
          .maybeSingle();
        if (participationByEmail.error) throw participationByEmail.error;
        participant = Boolean(participationByEmail.data);
      }
    }

    if (!owner && !participant && document.workspace_id) {
      const membership = await service
        .from('workspace_members')
        .select('role,status,access_expires_at')
        .eq('workspace_id', document.workspace_id)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (membership.error) throw membership.error;
      const expiresAt = membership.data?.access_expires_at
        ? new Date(membership.data.access_expires_at).getTime()
        : null;
      workspaceManager =
        Boolean(membership.data) &&
        ['owner', 'admin'].includes(String(membership.data?.role)) &&
        (expiresAt === null || expiresAt > Date.now());
    }

    if (!owner && !participant && !workspaceManager) {
      return NextResponse.json({ error: 'No tienes acceso a este documento.' }, { status: 403 });
    }

    const requestedVariant = request.nextUrl.searchParams.get('variant');
    const storagePath =
      requestedVariant === 'certified'
        ? String(document.sealed_pdf_path || '')
        : resolveLegacyDocumentStoragePath(document.storage_path, document.file_url);

    if (!storagePath) {
      return NextResponse.json(
        { error: 'El archivo solicitado no esta disponible.' },
        { status: 404 }
      );
    }

    const signed = await service.storage
      .from('documents')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) {
      throw signed.error || new Error('No se pudo generar el acceso temporal.');
    }

    const range = request.headers.get('range');
    const upstream = await fetch(signed.data.signedUrl, {
      cache: 'no-store',
      headers: range ? { Range: range } : undefined,
    });
    if (!upstream.ok || !upstream.body) {
      throw new Error(`Storage respondio con estado ${upstream.status}.`);
    }

    const response = new NextResponse(upstream.body, { status: upstream.status });
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(header);
      if (value) response.headers.set(header, value);
    }
    response.headers.set('Content-Disposition', 'inline');
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return response;
  } catch (error) {
    console.error('[DOCUBOX][viewer-file] No se pudo abrir el documento:', error);
    return NextResponse.json(
      { error: 'No se pudo abrir el documento.' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          'Referrer-Policy': 'no-referrer',
        },
      }
    );
  }
}
