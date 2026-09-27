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
  nombre?: string;
  rolDocumento?: string;
  acto?: string;
  sub_estado?: string;
}

interface ViewerDocumentRow {
  id: string;
  owner_id: string;
  carpeta_id?: string | null;
  etiquetas_ids?: string[] | null;
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
      .select('id,access_level')
      .eq('document_id', doc.id)
      .or(`grantee_user_id.eq.${user.id},grantee_email.eq.${userEmail}`)
      .limit(1)
      .maybeSingle();
    if (permissionError) throw permissionError;

    if (!isOwner && !isParticipant && !explicitPermission && !custodyMembership) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    }

    if (!isOwner && !isParticipant && !custodyMembership && explicitPermission) {
      if (doc.estado !== 'completado' || !['view', 'download', 'evidence'].includes(explicitPermission.access_level)) {
        return NextResponse.json({ error: 'Este acceso solo aplica a documentos completados.' }, { status: 403 });
      }
      if (searchParams.get('includeDetails') === '1') {
        return NextResponse.json({ data: { version_number: null } });
      }
      const participants = Array.isArray(doc.participantes) ? doc.participantes : [];
      return NextResponse.json({ data: {
        id: doc.id,
        documento_id: doc.documento_id,
        nombre: doc.nombre,
        estado: doc.estado,
        owner_id: doc.owner_id,
        owner_nombre: doc.owner_nombre,
        created_at: doc.created_at,
        fecha_completado: doc.fecha_completado,
        file_type: doc.file_type,
        file_size: doc.file_size,
        sealed_pdf_path: doc.sealed_pdf_path ? 'available' : null,
        participantes: participants.map((participant) => ({
          nombre: participant.nombre,
          rolDocumento: participant.rolDocumento,
          acto: participant.acto,
          sub_estado: participant.sub_estado,
        })),
        additional_access_level: explicitPermission.access_level,
      } }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    if (searchParams.get('includeDetails') === '1') {
      const [versionResult, workspaceResult, tagsResult, folderResult, ownerResult] = await Promise.all([
        supabaseAdmin
          .from('document_versions')
          .select('version_number')
          .eq('document_id', doc.id)
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle(),
        doc.workspace_id
          ? supabaseAdmin
              .from('workspaces')
              .select('name,workspace_type,legal_name')
              .eq('id', doc.workspace_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        Array.isArray(doc.etiquetas_ids) && doc.etiquetas_ids.length > 0
          ? supabaseAdmin
              .from('etiquetas')
              .select('id,nombre,color')
              .in('id', doc.etiquetas_ids)
          : Promise.resolve({ data: [], error: null }),
        doc.carpeta_id
          ? supabaseAdmin
              .from('carpetas')
              .select('nombre')
              .eq('id', doc.carpeta_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabaseAdmin
          .from('user_profiles')
          .select('full_name,nombre,apellido_paterno,apellido_materno')
          .eq('id', doc.owner_id)
          .maybeSingle(),
      ]);

      if (versionResult.error) console.error('[api/documentos/obtener] Version lookup:', versionResult.error);
      if (workspaceResult.error) console.error('[api/documentos/obtener] Workspace lookup:', workspaceResult.error);
      if (tagsResult.error) console.error('[api/documentos/obtener] Tags lookup:', tagsResult.error);
      if (folderResult.error) console.error('[api/documentos/obtener] Folder lookup:', folderResult.error);
      if (ownerResult.error) console.error('[api/documentos/obtener] Owner lookup:', ownerResult.error);

      const owner = ownerResult.data;
      const ownerName = owner?.full_name ||
        [owner?.nombre, owner?.apellido_paterno, owner?.apellido_materno].filter(Boolean).join(' ');

      return NextResponse.json({
        data: {
          version_number: versionResult.data?.version_number ?? null,
          workspace: workspaceResult.data ?? null,
          etiquetas: tagsResult.data ?? [],
          carpeta_nombre: folderResult.data?.nombre ?? null,
          owner_nombre: ownerName || null,
        },
      });
    }

    return NextResponse.json({ data: doc });
  } catch (err: any) {
    console.error('[api/documentos/obtener] Error:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
