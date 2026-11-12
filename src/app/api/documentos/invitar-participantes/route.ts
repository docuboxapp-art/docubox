import { randomUUID, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import {
  canInviteToDocument,
  resolveParticipantMode,
} from '@/lib/documents/participant-invitations';
import {
  deliverDocumentInvitations,
  stampDeliveredParticipants,
} from '@/lib/orchestration/document-delivery';

type NewParticipant = {
  name?: string;
  email?: string;
  phone?: string;
  acto?: string;
  rolDocumento?: string;
  tipoFirma?: string[];
  tipoNotificacion?: string[];
  mensajePersonalizado?: string;
  deliveryMode?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTS = new Set(['Firmante', 'Aprobador', 'Observador', 'Testigo']);
const SIGNATURE_TYPES = new Set(['autografa', 'efirma', 'click_sign']);
const NOTIFICATION_TYPES = new Set(['correo', 'docubox', 'sms', 'whatsapp']);

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const auth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (entries) => {
            try {
              entries.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
            } catch {
              /* Response may already be streaming. */
            }
          },
        },
      }
    );
    const {
      data: { user },
      error: authError,
    } = await auth.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

    const body = await request.json().catch(() => null);
    const documentId = typeof body?.documentId === 'string' ? body.documentId : '';
    const incoming: NewParticipant[] = Array.isArray(body?.participants) ? body.participants : [];
    if (!/^[0-9a-f-]{36}$/i.test(documentId) || incoming.length < 1 || incoming.length > 20) {
      return NextResponse.json(
        { error: 'Selecciona entre 1 y 20 participantes.' },
        { status: 400 }
      );
    }

    const service = createServiceClient();
    const { data: doc, error: documentError } = await service
      .from('documentos')
      .select(
        'id,owner_id,workspace_id,nombre,descripcion,estado,participant_mode,participation_order,grupos_firma,participantes'
      )
      .eq('id', documentId)
      .is('deleted_at', null)
      .maybeSingle();
    if (documentError || !doc)
      return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
    if (doc.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Sólo el propietario puede invitar participantes.' },
        { status: 403 }
      );
    }

    const current = Array.isArray(doc.participantes) ? doc.participantes : [];
    const mode = resolveParticipantMode(doc.participant_mode, current, doc.owner_id, user.email);
    if (!canInviteToDocument(doc.estado, mode)) {
      return NextResponse.json(
        { error: 'Este documento no permite agregar participantes en su estado o modo actual.' },
        { status: 409 }
      );
    }
    if (!doc.workspace_id) {
      return NextResponse.json(
        { error: 'No se pudo identificar el espacio de trabajo del documento.' },
        { status: 409 }
      );
    }
    const currentEmails = new Set(
      current.map((participant: Record<string, unknown>) =>
        String(participant.email || '')
          .trim()
          .toLowerCase()
      )
    );
    const newEmails = new Set<string>();
    const normalized = [];
    for (const raw of incoming) {
      const name = String(raw?.name || '').trim();
      const email = String(raw?.email || '')
        .trim()
        .toLowerCase();
      const acto = String(raw?.acto || '');
      const rolDocumento = String(raw?.rolDocumento || '').trim();
      const tipoFirma = Array.isArray(raw?.tipoFirma)
        ? raw.tipoFirma.filter((item): item is string => typeof item === 'string')
        : [];
      const tipoNotificacion = Array.isArray(raw?.tipoNotificacion)
        ? raw.tipoNotificacion.filter((item): item is string => typeof item === 'string')
        : [];
      if (
        !name ||
        name.length > 160 ||
        !EMAIL.test(email) ||
        !ACTS.has(acto) ||
        !rolDocumento ||
        (acto === 'Firmante' && tipoFirma.length === 0) ||
        tipoFirma.some((item) => !SIGNATURE_TYPES.has(item)) ||
        tipoNotificacion.some((item) => !NOTIFICATION_TYPES.has(item)) ||
        (raw.deliveryMode !== 'in_person' &&
          !tipoNotificacion.some((item) => item === 'correo' || item === 'docubox'))
      ) {
        return NextResponse.json(
          {
            error:
              'Completa nombre, correo, acto, rol, firma y un canal de notificación disponible (correo o Docubox).',
          },
          { status: 400 }
        );
      }
      if (currentEmails.has(email) || newEmails.has(email) || email === user.email?.toLowerCase()) {
        return NextResponse.json(
          { error: 'Uno de los participantes ya forma parte del documento.' },
          { status: 409 }
        );
      }
      newEmails.add(email);
      normalized.push({
        name,
        email,
        acto,
        rolDocumento,
        tipoFirma,
        tipoNotificacion,
        phone: String(raw.phone || '').trim(),
        mensajePersonalizado: String(raw.mensajePersonalizado || '')
          .trim()
          .slice(0, 2000),
        deliveryMode: raw.deliveryMode === 'in_person' ? 'in_person' : 'remote',
      });
    }

    const sequential = doc.participation_order === 'secuencial';
    const mixed = doc.participation_order === 'mixto';
    const visible = !sequential && !mixed;
    const now = new Date().toISOString();
    const participants = [];
    for (const item of normalized) {
      const { data: profile } = await service
        .from('user_profiles')
        .select('id')
        .ilike('email', item.email)
        .maybeSingle();
      if (
        item.deliveryMode !== 'in_person' &&
        !item.tipoNotificacion.includes('correo') &&
        !profile?.id
      ) {
        return NextResponse.json(
          {
            error:
              'La notificación en Docubox requiere un usuario registrado; selecciona también correo electrónico.',
          },
          { status: 400 }
        );
      }
      const token = randomUUID();
      participants.push({
        id: randomUUID(),
        name: item.name,
        nombre: item.name,
        email: item.email,
        phone: item.phone || null,
        telefono: item.phone || null,
        user_id: profile?.id || null,
        role: item.acto.toLowerCase(),
        acto: item.acto,
        rol: item.rolDocumento,
        rolDocumento: item.rolDocumento,
        tipoFirma: item.tipoFirma,
        tipoNotificacion: item.tipoNotificacion,
        mensajePersonalizado: item.mensajePersonalizado,
        delivery_mode: item.deliveryMode,
        isCurrentUser: false,
        sub_estado: 'en_revision',
        participation_status: 'PENDING',
        current_access: true,
        historical_participation: false,
        participant_relationship_status: 'ACTIVE',
        visible,
        notificado: false,
        portal_token: token,
        portal_token_hash: createHash('sha256').update(token).digest('hex'),
        portal_token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        invited_at: now,
      });
    }

    // The existing JSONB value is a compare-and-swap guard against concurrent edits.
    // Mixed workflows append a final group so queued participants are reached.
    const groups = Array.isArray(doc.grupos_firma) ? doc.grupos_firma : [];
    const updatedGroups = mixed
      ? [
          ...groups,
          {
            id: randomUUID(),
            tipo: 'paralelo',
            participantIds: participants.map((item) => item.id),
            completionPolicy: 'ALL',
          },
        ]
      : groups;
    const update = await service
      .from('documentos')
      .update({
        participantes: [...current, ...participants],
        participant_mode: mode,
        ...(mixed ? { grupos_firma: updatedGroups } : {}),
      })
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .eq('estado', 'en_proceso')
      .eq('participantes', current)
      .select('id')
      .maybeSingle();
    if (update.error)
      return NextResponse.json(
        { error: 'No se pudieron guardar las invitaciones.' },
        { status: 500 }
      );
    if (!update.data)
      return NextResponse.json(
        { error: 'El documento cambió. Actualiza la página e inténtalo de nuevo.' },
        { status: 409 }
      );

    const audit = await service.from('document_activity_log').insert(
      participants.map((participant) => ({
        documento_id: documentId,
        actor_id: user.id,
        actor_nombre: user.user_metadata?.full_name || null,
        actor_email: user.email || null,
        action: 'PARTICIPANT_INVITED',
        category: 'participantes',
        details: {
          description: `Se invitó a ${participant.name}`,
          participant_id: participant.id,
          participant_name: participant.name,
          participant_email: participant.email,
          queued: !visible,
        },
      }))
    );
    if (audit.error) console.error('[invitar-participantes] Audit failed:', audit.error.code);

    let delivery = { sent: [] as Array<{ email: string }>, failed: [] as Array<{ email: string }> };
    if (visible) {
      try {
        delivery = await deliverDocumentInvitations(service, {
          documentId,
          workspaceId: doc.workspace_id,
          ownerId: user.id,
          documentName: doc.nombre || 'Documento',
          documentDescription: doc.descripcion,
          participants,
        });
        if (delivery.sent.length) {
          const refreshed = await service
            .from('documentos')
            .select('participantes')
            .eq('id', documentId)
            .single();
          const latest = Array.isArray(refreshed.data?.participantes)
            ? refreshed.data.participantes
            : [];
          const stamped = stampDeliveredParticipants(
            latest,
            delivery.sent.map((item) => item.email),
            now
          );
          await service
            .from('documentos')
            .update({ participantes: stamped })
            .eq('id', documentId)
            .eq('participantes', latest);
        }
      } catch (error) {
        console.error(
          '[invitar-participantes] Delivery failed:',
          error instanceof Error ? error.name : 'unknown'
        );
      }
    }
    return NextResponse.json({
      success: true,
      invited: participants.length,
      queued: !visible,
      delivered: delivery.sent.length,
      deliveryFailed: delivery.failed.length,
    });
  } catch (error) {
    console.error(
      '[invitar-participantes] Unexpected failure:',
      error instanceof Error ? error.name : 'unknown'
    );
    return NextResponse.json({ error: 'No fue posible invitar participantes.' }, { status: 500 });
  }
}
