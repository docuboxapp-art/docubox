import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  assertKioskDocumentScope,
  kioskParticipantMatchesUser,
} from '@/lib/in-person/kiosk-session.server';
import {
  DOCUMENT_VIEWER_SELECT,
  LEGACY_DOCUMENT_VIEWER_SELECT,
  isMissingDocumentCustodyColumns,
} from '@/lib/documents/viewer-select';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ViewerParticipant {
  email?: string;
  id?: string;
  user_id?: string;
  current_access?: boolean;
}

interface ViewerDocumentRow {
  id: string;
  owner_id: string;
  participantes?: ViewerParticipant[] | null;
  workspace_id?: string | null;
  current_custodian_workspace_id?: string | null;
  [key: string]: unknown;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentoId = searchParams.get('id');

    if (!documentoId) {
      return NextResponse.json({ error: 'ID de documento requerido' }, { status: 400 });
    }

    const kioskSession = await assertKioskDocumentScope(request, documentoId);

    // Authenticate via Authorization header (Bearer token sent by client)
    const authHeader = request.headers.get('authorization');
    let user: any = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const {
        data: { user: tokenUser },
        error: tokenError,
      } = await supabaseAdmin.auth.getUser(token);
      if (!tokenError && tokenUser) {
        user = tokenUser;
      }
    }

    // Fallback: try cookie-based session via anon client
    if (!user) {
      const anonClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
      );
      const cookieHeader = request.headers.get('cookie') || '';
      // Parse Supabase auth token from cookies
      const tokenMatch = cookieHeader.match(/sb-[^-]+-auth-token=([^;]+)/);
      if (tokenMatch) {
        try {
          const decoded = decodeURIComponent(tokenMatch[1]);
          const parsed = JSON.parse(decoded);
          const accessToken = parsed?.access_token || parsed?.[0]?.access_token;
          if (accessToken) {
            const {
              data: { user: cookieUser },
            } = await supabaseAdmin.auth.getUser(accessToken);
            if (cookieUser) user = cookieUser;
          }
        } catch (_) {
          // Ignore malformed legacy auth cookies and keep the request unauthenticated.
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    if (kioskSession) {
      const identity = await kioskParticipantMatchesUser(supabaseAdmin, kioskSession, user);
      if (!identity.matches) {
        return NextResponse.json({ error: 'KIOSK_PARTICIPANT_MISMATCH' }, { status: 403 });
      }
    }

    // Fetch document using service role (bypasses RLS)
    const queryDocument = (columns: string) =>
      supabaseAdmin.from('documentos').select(columns).eq('id', documentoId).maybeSingle();
    let documentResult = await queryDocument(DOCUMENT_VIEWER_SELECT);

    if (isMissingDocumentCustodyColumns(documentResult.error)) {
      documentResult = await queryDocument(LEGACY_DOCUMENT_VIEWER_SELECT);
    }

    const doc = documentResult.data as unknown as ViewerDocumentRow | null;
    const { error: docError } = documentResult;

    if (docError) {
      console.error('[api/documentos/obtener] Document query failed:', {
        code: docError.code,
        message: docError.message,
      });
      return NextResponse.json({ error: 'No fue posible cargar el documento' }, { status: 500 });
    }

    if (!doc) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    // Verify access: user must be owner or participant
    const isOwner = doc.owner_id === user.id;
    const participantes = doc.participantes || [];
    const userEmail = user.email?.toLowerCase() || '';
    const participantEntry = participantes.find(
      (p) =>
        (p.email && p.email.toLowerCase() === userEmail) ||
        p.id === user.id ||
        p.user_id === user.id
    );
    const isParticipant = Boolean(participantEntry && participantEntry.current_access !== false);

    const custodyWorkspaceId = doc.current_custodian_workspace_id || doc.workspace_id;
    const { data: custodyMembership, error: custodyMembershipError } = custodyWorkspaceId
      ? await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', custodyWorkspaceId)
          .eq('user_id', user.id)
          .eq('status', 'active')
          .in('role', ['owner', 'admin'])
          .or(`access_expires_at.is.null,access_expires_at.gt.${new Date().toISOString()}`)
          .maybeSingle()
      : { data: null, error: null };
    if (custodyMembershipError) throw custodyMembershipError;

    const { data: explicitPermission, error: permissionError } = await supabaseAdmin
      .from('document_access_permissions')
      .select('id')
      .eq('document_id', doc.id)
      .or(`grantee_user_id.eq.${user.id},grantee_email.eq.${userEmail}`)
      .limit(1)
      .maybeSingle();
    if (permissionError) throw permissionError;

    if (!isOwner && !isParticipant && !explicitPermission && !custodyMembership) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    }

    return NextResponse.json({ data: doc });
  } catch (err: any) {
    console.error('[api/documentos/obtener] Error:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
