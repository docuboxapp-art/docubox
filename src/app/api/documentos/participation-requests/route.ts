import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Terminal sub_estados stored in documentos.participantes JSONB
const TERMINAL_SUB_ESTADOS = ['firmo', 'firmado', 'aprobo', 'aprobado', 'rechazo', 'rechazado', 'cancelo', 'cancelado'];
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

export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    // Fetch documents owned by the user that have been sent (have participants)
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
        tipo_documento_id,
        etiquetas_ids,
        tipo_documento:tipo_documento_id ( nombre )
      `)
      .eq('owner_id', user.id)
      .neq('estado', 'borrador')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Collect all unique etiqueta IDs across all documents
    const allEtiquetaIds: string[] = [];
    (docs ?? []).forEach((doc: any) => {
      if (Array.isArray(doc.etiquetas_ids)) {
        doc.etiquetas_ids.forEach((id: string) => {
          if (id && !allEtiquetaIds.includes(id)) allEtiquetaIds.push(id);
        });
      }
    });

    // Fetch etiquetas if there are any IDs
    let etiquetasMap: Record<string, { nombre: string; color?: string }> = {};
    if (allEtiquetaIds.length > 0) {
      const { data: etiquetasData } = await supabase
        .from('etiquetas')
        .select('id, nombre, color')
        .in('id', allEtiquetaIds);
      (etiquetasData ?? []).forEach((e: any) => {
        etiquetasMap[e.id] = { nombre: e.nombre, color: e.color };
      });
    }

    // Map to the shape expected by the frontend
    const solicitudes = (docs ?? []).map((doc: any) => {
      const parts: any[] = doc.participantes ?? [];
      const totalSigs = parts.length;
      // Count participants who have participated using sub_estado
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
        case 'pendiente': status = 'en-progreso'; break;
        default: status = 'en-progreso';
      }

      // Primary recipient = first participant
      const firstPart = parts[0] ?? {};

      // Resolve etiquetas for this document
      const etiquetas: { nombre: string; color?: string }[] = [];
      if (Array.isArray(doc.etiquetas_ids)) {
        doc.etiquetas_ids.forEach((id: string) => {
          if (etiquetasMap[id]) etiquetas.push(etiquetasMap[id]);
        });
      }

      return {
        id: doc.documento_id ?? doc.id,
        supabaseId: doc.id,
        recipientName: firstPart.nombre ?? firstPart.name ?? firstPart.email ?? 'Destinatario',
        recipientEmail: firstPart.email ?? '',
        recipientRfc: firstPart.rfc ?? '',
        documentName: doc.nombre,
        documentType: doc.tipo_documento?.nombre ?? 'Documento',
        description: doc.descripcion ?? undefined,
        status,
        priority: doc.es_urgente ? 'Urgente' : 'Normal',
        sentAt: doc.created_at,
        expiresAt: doc.fecha_vencimiento ?? null,
        tieneVencimiento: !!doc.fecha_vencimiento,
        expiredAt: doc.estado === 'vencido' ? (doc.fecha_vencimiento ?? doc.created_at) : undefined,
        completedAt: doc.fecha_completado ?? undefined,
        canceladoAt: doc.cancelado_at ?? undefined,
        cancelacionMotivo: doc.cancelacion_motivo ?? undefined,
        cancelacionDescripcion: doc.cancelacion_descripcion ?? undefined,
        enEsperaMotivo: doc.en_espera_motivo ?? undefined,
        enEsperaDescripcion: doc.en_espera_descripcion ?? undefined,
        participants: totalSigs,
        etiquetas,
        participantList: parts.map((p: any) => {
          const pSubEstado = p.sub_estado ?? p.status ?? 'en_revision';
          return {
            name: p.nombre ?? p.name ?? p.email ?? 'Participante',
            email: p.email ?? '',
            phone: p.telefono ?? p.phone ?? undefined,
            notificationMethod: p.notificationMethod ?? p.notification_method ?? 'email',
            status: mapSubEstadoToDisplay(pSubEstado),
            subEstado: pSubEstado,
            rol: p.rol ?? p.role ?? undefined,
            acto: p.acto ?? p.action ?? undefined,
            rejectionMotivo: p.rejectionMotivo ?? undefined,
            rejectionDescripcion: p.rejectionDescripcion ?? undefined,
          };
        }),
        signaturesTotal: totalSigs,
        signaturesDone: doneSigs,
      };
    });

    return NextResponse.json({ solicitudes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: 500 });
  }
}
