import { isUrgentDocument } from '@/lib/documents/priority';
import { normalizeContactEmail } from './detail';
import {
  getContactParticipationStatus,
  isPendingContactParticipation,
} from './document-participation';
import { reminderAction, type ReminderParticipant } from './document-reminders';

export type AgendaContact = {
  id: string;
  nombre: string;
  apellido_paterno: string | null;
  apellido_materno: string | null;
  email: string | null;
  telefono: string | null;
  rfc: string | null;
  curp: string | null;
  notas: string | null;
  etiqueta_rol?: string | null;
  tipo_persona?: string | null;
  direccion?: string | null;
  canal_preferido?: string | null;
  tags?: string[] | null;
  created_at: string;
};

type AgendaParticipant = ReminderParticipant & {
  fecha_participacion?: string | null;
  fecha_firma?: string | null;
  fecha_aprobacion?: string | null;
  fecha_rechazo?: string | null;
};

export type AgendaDocument = {
  id: string;
  nombre: string;
  estado: string | null;
  created_at: string;
  deleted_at?: string | null;
  fecha_vencimiento?: string | null;
  tiene_vencimiento?: boolean | null;
  priority?: string | null;
  es_urgente?: boolean | null;
  participantes: (AgendaParticipant | null)[] | null;
};

export type ContactInteraction = { date: string; label: string; documentName: string };
export type ContactDocument = Pick<AgendaDocument, 'id' | 'nombre' | 'estado' | 'created_at'> & {
  pending: boolean;
  action: string | null;
  dueAt: string | null;
  dueSoon: boolean;
  urgent: boolean;
  recentRejection: string | null;
  interaction: ContactInteraction | null;
};
export type ContactSummary = {
  documents: ContactDocument[];
  pending: number;
  completed: number;
  dueSoon: number;
  nextDue: ContactDocument | null;
  lastInteraction: ContactInteraction | null;
  followUp: 'urgent' | 'active' | null;
};

export const EMPTY_CONTACT_SUMMARY: ContactSummary = {
  documents: [],
  pending: 0,
  completed: 0,
  dueSoon: 0,
  nextDue: null,
  lastInteraction: null,
  followUp: null,
};

export const contactAvatarColors = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
];

export function contactInitials(contact: AgendaContact) {
  return (
    [contact.nombre?.[0], contact.apellido_paterno?.[0]].filter(Boolean).join('').toUpperCase() ||
    'C'
  );
}

export function formatContactName(value: string | null | undefined) {
  return (value || '')
    .toLocaleLowerCase('es-MX')
    .replace(
      /(^|[\s'-])([a-záéíóúüñ])/g,
      (_, separator: string, letter: string) => separator + letter.toLocaleUpperCase('es-MX')
    );
}

export function contactName(contact: AgendaContact) {
  return formatContactName(
    [contact.nombre, contact.apellido_paterno, contact.apellido_materno].filter(Boolean).join(' ')
  );
}

export function contactTags(contact: AgendaContact) {
  return [
    ...new Set([
      ...(contact.etiqueta_rol ? [`Tipo: ${contact.etiqueta_rol}`] : []),
      ...(contact.tags || []).map((tag) => {
        if (/^(Tipo|Relación|Área):\s*/i.test(tag)) return tag;
        if (/^(cliente|proveedor|colaborador|notar[ií]a)$/i.test(tag)) return `Tipo: ${tag}`;
        if (/^(recurrente|prospecto|estrat[eé]gico)$/i.test(tag)) return `Relación: ${tag}`;
        if (/^(comercial|legal|fiscal|operaciones)$/i.test(tag)) return `Área: ${tag}`;
        return tag;
      }),
    ]),
  ];
}

export function formatContactDate(value: string, withTime = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('es-MX', {
        dateStyle: 'medium',
        ...(withTime && { timeStyle: 'short' }),
      });
}

const activeStates = new Set(['en_proceso', 'en_progreso', 'en_espera']);
const recentDays = 7 * 24 * 60 * 60 * 1000;

function summarizeDocument(
  document: AgendaDocument,
  participants: AgendaParticipant[],
  now: number
): ContactDocument {
  const documentName = document.nombre || 'Sin título';
  const active = activeStates.has(document.estado?.trim().toLowerCase() || '');
  const deadline = document.tiene_vencimiento !== false ? document.fecha_vencimiento : null;
  let pending = false;
  let action: string | null = null;
  let urgent = false;
  let dueSoon = false;
  let recentRejection: string | null = null;
  let interaction: ContactInteraction | null = null;

  function considerInteraction(label: string, date?: string | null) {
    if (
      date &&
      Date.parse(date) <= now &&
      (!interaction || Date.parse(date) > Date.parse(interaction.date))
    ) {
      interaction = { date, label, documentName };
    }
  }

  for (const participant of participants) {
    const status = getContactParticipationStatus(participant, document, now);
    const pendingAction = reminderAction(participant);
    if (active && pendingAction && isPendingContactParticipation(status)) {
      pending = true;
      action ||= status === 'en_espera' ? 'En espera' : pendingAction;
      if (status !== 'en_espera') {
        action = pendingAction;
        const deadlineTime = Date.parse(deadline || '');
        dueSoon ||= deadlineTime > now && deadlineTime <= now + 72 * 60 * 60 * 1000;
        urgent ||=
          status === 'urgente_atencion' ||
          isUrgentDocument(document.priority, document.es_urgente === true);
      }
    }

    if (status === 'rechazo') {
      const date = participant.fecha_rechazo || participant.fecha_participacion;
      const time = Date.parse(date || '');
      if (
        date &&
        time <= now &&
        time >= now - recentDays &&
        (!recentRejection || time > Date.parse(recentRejection))
      )
        recentRejection = date;
      considerInteraction('Documento rechazado', date);
    } else if (status === 'firmo') {
      considerInteraction(
        'Documento firmado',
        participant.fecha_firma || participant.fecha_participacion
      );
    } else if (status === 'aprobo') {
      considerInteraction(
        'Documento aprobado',
        participant.fecha_aprobacion || participant.fecha_participacion || participant.fecha_firma
      );
    } else if (status === 'completado') {
      considerInteraction('Participación completada', participant.fecha_participacion);
    }
    considerInteraction('Recordatorio enviado', participant.fecha_recordatorio);
  }

  return {
    id: document.id,
    nombre: documentName,
    estado: document.estado,
    created_at: document.created_at,
    pending,
    action,
    dueAt: pending && deadline && Date.parse(deadline) > now ? deadline : null,
    dueSoon,
    urgent,
    recentRejection,
    interaction,
  };
}

export function summarizeContactDocuments(documents: AgendaDocument[], now: number) {
  const byEmail = new Map<string, ContactSummary>();
  for (const document of documents) {
    const state = document.estado?.trim().toLowerCase();
    if (document.deleted_at || state === 'borrador' || !Array.isArray(document.participantes))
      continue;
    const participantsByEmail = new Map<string, AgendaParticipant[]>();
    for (const participant of document.participantes) {
      const email = normalizeContactEmail(participant?.email);
      if (!participant || !email) continue;
      const matches = participantsByEmail.get(email) || [];
      matches.push(participant);
      participantsByEmail.set(email, matches);
    }
    for (const [email, matches] of participantsByEmail) {
      const item = summarizeDocument(document, matches, now);
      const summary = byEmail.get(email) || { ...EMPTY_CONTACT_SUMMARY, documents: [] };
      summary.documents.push(item);
      if (item.pending) summary.pending++;
      if (state === 'completado') summary.completed++;
      if (item.dueSoon) summary.dueSoon++;
      if (
        item.dueAt &&
        (!summary.nextDue?.dueAt || Date.parse(item.dueAt) < Date.parse(summary.nextDue.dueAt))
      )
        summary.nextDue = item;
      if (
        item.interaction &&
        (!summary.lastInteraction ||
          Date.parse(item.interaction.date) > Date.parse(summary.lastInteraction.date))
      )
        summary.lastInteraction = item.interaction;
      if (item.urgent || item.dueSoon) summary.followUp = 'urgent';
      else if (!summary.followUp && (item.pending || item.recentRejection))
        summary.followUp = 'active';
      byEmail.set(email, summary);
    }
  }
  return byEmail;
}
