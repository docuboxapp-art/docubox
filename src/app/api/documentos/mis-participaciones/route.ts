import { NextRequest, NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';

// Terminal sub_estados stored in documentos.participantes JSONB
const TERMINAL_SUB_ESTADOS = ['firmo', 'firmado', 'aprobo', 'aprobado', 'rechazo', 'rechazado', 'cancelo', 'cancelado'];
// Capitalized versions used in some legacy entries
const TERMINAL_STATUSES_CAPITALIZED = ['Firmado', 'Rechazado', 'Aprobado', 'Cancelado'];

function isTerminalSubEstado(sub: string): boolean {
  const lower = (sub ?? '').toLowerCase();
  return TERMINAL_SUB_ESTADOS.includes(lower) || TERMINAL_STATUSES_CAPITALIZED.includes(sub ?? '');
}

function mapSubEstadoToDisplay(sub: string): string {
  switch ((sub ?? '').toLowerCase()) {
    case 'firmo': case 'firmado': return 'Firmado';
    case 'aprobo': case 'aprobado': return 'Aprobado';
    case 'rechazo': case 'rechazado': return 'Rechazado';
    case 'cancelo': case 'cancelado': return 'Cancelado';
    case 'en_revision': return 'En revisión';
    case 'sin_revisar': return 'Sin revisión';
    default: return sub ?? 'En revisión';
  }
}

export async function GET(request: NextRequest) {
  try {
    // Step 1: Validate the user session — try Bearer token first, then cookies
    let user: any = null;

    // Try Bearer token from Authorization header
    const headersList = await headers();
    const authHeader = headersList.get('authorization') || headersList.get('Authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (bearerToken) {
      const serviceClient = createServiceClient();
      const { data: { user: tokenUser }, error: tokenError } = await serviceClient.auth.getUser(bearerToken);
      if (!tokenError && tokenUser) {
        user = tokenUser;
      }
    }

    // Fallback: cookie-based auth
    if (!user) {
      const cookieStore = await cookies();
      const anonClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() { return cookieStore.getAll(); },
            setAll(cookiesToSet) {
              try {
                cookiesToSet.forEach(({ name, value, options }) =>
                  cookieStore.set(name, value, options)
                );
              } catch {}
            },
          },
        }
      );
      const { data: { user: cookieUser }, error: authError } = await anonClient.auth.getUser();
      if (authError || !cookieUser) {
        return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
      }
      user = cookieUser;
    }

    // Step 2: Use service client for the DB query (bypasses RLS, we filter manually)
    const supabase = createServiceClient();

    const userEmail = user.email?.toLowerCase() ?? '';
    const userId = user.id;

    // Fetch all non-deleted documents using service role (bypasses RLS)
    const { data: docs, error } = await supabase
      .from('documentos')
      .select(`
        id,
        documento_id,
        owner_id,
        nombre,
        descripcion,
        estado,
        es_urgente,
        fecha_vencimiento,
        tiene_vencimiento,
        created_at,
        updated_at,
        fecha_completado,
        cancelado_at,
        cancelacion_motivo,
        cancelacion_descripcion,
        en_espera_motivo,
        en_espera_descripcion,
        participantes,
        campos_solicitados,
        tipo_documento_id,
        tipo_documento:tipo_documento_id ( nombre )
      `)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[mis-participaciones] DB error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch owner profiles separately to avoid join issues
    const ownerIds = [...new Set((docs ?? []).map((d: any) => d.owner_id).filter(Boolean))];
    let ownerMap: Record<string, { full_name: string; email: string }> = {};
    if (ownerIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, full_name, email')
        .in('id', ownerIds);
      if (profiles) {
        profiles.forEach((p: any) => {
          ownerMap[p.id] = { full_name: p.full_name ?? '', email: p.email ?? '' };
        });
      }
    }

    // Include docs where user appears in participantes array (by email OR user_id)
    // NOTE: p.id is the participant's internal UUID (not the Supabase user ID), so we do NOT check p.id === userId
    // ── VISIBILITY FILTER: For sequential/mixed orders, only show if participant is marked visible ──
    const myDocs = (docs ?? []).filter((doc: any) => {
      const parts: any[] = doc.participantes ?? [];
      const myEntry = parts.find((p: any) =>
        (p.email ?? '').toLowerCase() === userEmail ||
        p.user_id === userId
      );
      if (!myEntry) return false;

      // If participation_order is sequential or mixed, respect the visible flag
      const order = (doc as any).participation_order ?? 'paralelo';
      if (order === 'secuencial' || order === 'mixto') {
        // If visible is explicitly false, don't show yet
        if (myEntry.visible === false) return false;
        // If visible is undefined (legacy docs), show it (backward compat)
        if (myEntry.visible === undefined || myEntry.visible === null) return true;
      }
      return true;
    });

    // Map to the shape expected by the frontend
    const participaciones = myDocs.map((doc: any) => {
      const parts: any[] = doc.participantes ?? [];

      // Find my participant entry: match by email first, then by user_id
      const myEntry = parts.find((p: any) =>
        (p.email ?? '').toLowerCase() === userEmail
      ) ?? parts.find((p: any) =>
        p.user_id === userId
      );

      const totalSigs = parts.length;
      const doneSigs = parts.filter((p: any) => isTerminalSubEstado(p.sub_estado ?? p.status ?? '')).length;

      // Map estado to frontend status
      let status: string;
      switch (doc.estado) {
        case 'en_proceso': status = 'en-progreso'; break;
        case 'en_espera': status = 'en-espera'; break;
        case 'completado': status = 'completado'; break;
        case 'vencido': status = 'vencido'; break;
        case 'cancelado': status = 'cancelado'; break;
        case 'rechazado': status = 'rechazado'; break;
        case 'pendiente': status = 'pendiente'; break;
        case 'borrador': status = 'pendiente'; break;
        default: status = 'en-progreso';
      }

      // Determine my participation status from sub_estado
      const mySubEstado = myEntry?.sub_estado ?? myEntry?.status ?? 'sin_revisar';
      const myParticipationStatus = mapSubEstadoToDisplay(mySubEstado);

      const myRol = myEntry?.rol ?? myEntry?.role ?? myEntry?.rolDocumento ?? undefined;
      const myActo = myEntry?.acto ?? myEntry?.action ?? undefined;
      const myTipoFirma: string[] = myEntry?.tipoFirma ?? myEntry?.tipo_firma ?? [];
      const myParticipantId = myEntry?.id ?? null;

      // Filter campos_solicitados to only those assigned to this participant
      const allCampos: any[] = doc.campos_solicitados ?? [];
      const myCampos = allCampos.filter((c: any) =>
        !c.participantId ||
        c.participantId === myParticipantId ||
        c.participantId === userId
      );

      const ownerProfile = ownerMap[doc.owner_id] ?? null;

      return {
        id: doc.documento_id ?? doc.id,
        supabaseId: doc.id,
        documentName: doc.nombre ?? 'Sin nombre',
        documentType: (doc.tipo_documento as any)?.nombre ?? 'Documento',
        description: doc.descripcion ?? undefined,
        senderName: ownerProfile?.full_name || 'Remitente',
        senderEmail: ownerProfile?.email || '',
        status,
        priority: doc.es_urgente ? 'Urgente' : 'Normal',
        receivedAt: doc.created_at,
        expiresAt: doc.fecha_vencimiento ?? null,
        tieneVencimiento: !!(doc.fecha_vencimiento || doc.tiene_vencimiento),
        expiredAt: doc.estado === 'vencido' ? (doc.fecha_vencimiento ?? doc.created_at) : undefined,
        completedAt: doc.fecha_completado ?? undefined,
        canceladoAt: doc.cancelado_at ?? undefined,
        cancelacionMotivo: doc.cancelacion_motivo ?? undefined,
        cancelacionDescripcion: doc.cancelacion_descripcion ?? undefined,
        enEsperaMotivo: doc.en_espera_motivo ?? undefined,
        enEsperaDescripcion: doc.en_espera_descripcion ?? undefined,
        participants: totalSigs,
        participantList: parts.map((p: any) => {
          const pSubEstado = p.sub_estado ?? p.status ?? 'sin_revisar';
          return {
            name: p.nombre ?? p.name ?? p.email ?? 'Participante',
            email: p.email ?? '',
            phone: p.telefono ?? p.phone ?? undefined,
            notificationMethod: p.notificationMethod ?? p.notification_method ?? 'email',
            status: mapSubEstadoToDisplay(pSubEstado),
            subEstado: pSubEstado,
            rol: p.rol ?? p.role ?? undefined,
            acto: p.acto ?? p.action ?? undefined,
          };
        }),
        signaturesTotal: totalSigs,
        signaturesDone: doneSigs,
        mySignatureStatus: myParticipationStatus,
        myRol,
        myActo,
        myTipoFirma,
        myParticipantId,
        camposSolicitados: myCampos,
      };
    });

    return NextResponse.json({ participaciones });
  } catch (err: any) {
    console.error('[mis-participaciones] Unexpected error:', err?.message ?? err);
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: 500 });
  }
}
