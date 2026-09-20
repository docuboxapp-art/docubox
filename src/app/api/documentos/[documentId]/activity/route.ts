import type { NextRequest } from 'next/server';
import { requireDocumentContentAccess } from '@/lib/security/document-content-access';
import { documentAccessResponse } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ActivityEvent = {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
  actor_name: string;
  actor_email: string;
  category?: string;
  source: 'audit_trail' | 'security_log' | 'synthesized';
  participant_name?: string;
  participant_email?: string;
  doc_state_after?: string;
  participation_state?: string;
};

function record(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function validDate(value: unknown) {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { document, service } = await requireDocumentContentAccess(request, documentId);

    const [securityResult, auditResult, activityResult, ownerResult] = await Promise.all([
      service
        .from('security_audit_log')
        .select('id,action,details,created_at,user_id')
        .eq('documento_id', documentId)
        .order('created_at', { ascending: true }),
      service
        .from('document_audit_trail')
        .select(
          'id,action_code,action_description_es,action_category,action_result,actor_name,actor_email,actor_role,document_status_at_action,ip_address,action_at'
        )
        .eq('document_id', documentId)
        .order('action_at', { ascending: true }),
      service
        .from('document_activity_log')
        .select('id,action,category,details,created_at,actor_id,actor_nombre,actor_email')
        .eq('documento_id', documentId)
        .order('created_at', { ascending: true }),
      document.owner_id
        ? service
            .from('user_profiles')
            .select('full_name,nombre,apellido_paterno')
            .eq('id', document.owner_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const events: ActivityEvent[] = [];

    for (const row of securityResult.data || []) {
      const createdAt = validDate(row.created_at);
      if (!createdAt) continue;
      const details = record(row.details);
      events.push({
        id: `sec_${row.id}`,
        action: text(row.action),
        details,
        created_at: createdAt,
        actor_name: text(details.actor_name) || 'Sistema',
        actor_email: text(details.actor_email),
        category: text(details.category) || undefined,
        source: 'security_log',
      });
    }

    for (const row of auditResult.data || []) {
      const createdAt = validDate(row.action_at);
      if (!createdAt) continue;
      events.push({
        id: `adt_${row.id}`,
        action: text(row.action_code),
        details: {
          description: row.action_description_es,
          result: row.action_result,
          ip_address: row.ip_address,
          actor_role: row.actor_role,
          doc_status: row.document_status_at_action,
        },
        created_at: createdAt,
        actor_name: text(row.actor_name) || 'Sistema',
        actor_email: text(row.actor_email),
        category: text(row.action_category) || undefined,
        source: 'audit_trail',
        doc_state_after: text(row.document_status_at_action) || undefined,
      });
    }

    for (const row of activityResult.data || []) {
      const createdAt = validDate(row.created_at);
      if (!createdAt) continue;
      events.push({
        id: `alog_${row.id}`,
        action: text(row.action),
        details: record(row.details),
        created_at: createdAt,
        actor_name: text(row.actor_nombre) || 'Usuario',
        actor_email: text(row.actor_email),
        category: text(row.category) || undefined,
        source: 'security_log',
      });
    }

    const createdAt = validDate(document.created_at);
    const ownerProfile = ownerResult.data;
    const ownerName =
      ownerProfile?.full_name ||
      [ownerProfile?.nombre, ownerProfile?.apellido_paterno].filter(Boolean).join(' ') ||
      text(document.owner_nombre) ||
      'Propietario';
    if (createdAt && !events.some((event) => event.action === 'documento_creado')) {
      events.push({
        id: `synth_created_${documentId}`,
        action: 'documento_creado',
        details: { nombre: document.nombre },
        created_at: createdAt,
        actor_name: ownerName,
        actor_email: '',
        category: 'ciclo_de_vida',
        source: 'synthesized',
      });
    }

    const completedAt = validDate(document.fecha_completado);
    if (
      completedAt &&
      document.estado === 'completado' &&
      !events.some((event) => event.action === 'documento_completado')
    ) {
      events.push({
        id: `synth_completed_${documentId}`,
        action: 'documento_completado',
        details: { fecha: completedAt },
        created_at: completedAt,
        actor_name: 'Sistema',
        actor_email: '',
        category: 'ciclo_de_vida',
        source: 'synthesized',
      });
    }

    const participants = Array.isArray(document.participantes) ? document.participantes : [];
    participants.forEach((rawParticipant: unknown, index: number) => {
      if (!createdAt) return;
      const participant = record(rawParticipant);
      const name = text(participant.nombre || participant.name) || `Participante ${index + 1}`;
      const email = text(participant.email);
      events.push({
        id: `synth_part_assigned_${index}_${documentId}`,
        action: 'participante_asignado',
        details: {
          participant_email: email,
          metodo_firma: participant.metodo_firma,
        },
        created_at: createdAt,
        actor_name: 'Sistema',
        actor_email: '',
        category: 'participantes',
        source: 'synthesized',
        participant_name: name,
        participant_email: email,
      });

      const state = text(participant.sub_estado || participant.estado).toLowerCase();
      const participationDate = validDate(
        participant.fecha_firma || participant.fecha_participacion || document.updated_at
      );
      if (state === 'firmo' && participationDate) {
        events.push({
          id: `synth_firmo_${index}_${documentId}`,
          action: 'firma_completada',
          details: { participant_email: email, firma_tipo: participant.metodo_firma },
          created_at: participationDate,
          actor_name: name,
          actor_email: email,
          category: 'firma',
          source: 'synthesized',
          participant_name: name,
          participant_email: email,
          participation_state: state,
        });
      } else if (state === 'en_revision' && participationDate) {
        events.push({
          id: `synth_en_revision_${index}_${documentId}`,
          action: 'cambio_estado_participacion',
          details: { participant_email: email, estado_nuevo: 'En revisión' },
          created_at: participationDate,
          actor_name: name,
          actor_email: email,
          category: 'participantes',
          source: 'synthesized',
          participant_name: name,
          participant_email: email,
          participation_state: state,
        });
      }
    });

    const seen = new Set<string>();
    const unique = events.filter((event) => {
      const key = `${event.action}_${event.actor_email}_${event.created_at.slice(0, 16)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));

    return Response.json(
      { events: unique },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
    );
  } catch (error) {
    const accessError = documentAccessResponse(error);
    if (accessError.status !== 500) {
      return Response.json(accessError.body, { status: accessError.status });
    }
    console.error('[document-activity] No fue posible cargar la actividad:', error);
    return Response.json({ error: 'No fue posible cargar la actividad.' }, { status: 500 });
  }
}
