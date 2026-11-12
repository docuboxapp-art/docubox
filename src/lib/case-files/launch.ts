import type { CaseReviewPolicy } from './review-policy';

export type LaunchMember = { id: string; name: string; role: string; email?: string };
export type LaunchPerson = {
  id: string;
  name: string;
  email: string;
  userId?: string;
  details?: Record<string, string>;
};
export type LaunchParticipant = LaunchPerson & { role: 'representative' | 'contact' };
export type LaunchOptions = {
  actorId: string;
  workspaceId: string;
  templateId: string;
  title: string;
  description: string;
  category: string;
  sectionCount: number;
  verificationCount: number;
  separationOfDuties: boolean;
  members: LaunchMember[];
  items: {
    id: string;
    title: string;
    kind: string;
    requiresReview: boolean;
    reviewerRole: string;
  }[];
  policy: CaseReviewPolicy;
  signatureOptions?: string[];
};
export type LaunchResponsibility = {
  key: string;
  label: string;
  detail: string;
  role: string | null;
};
export const participantRoleLabels = {
  representative: 'Representante',
  contact: 'Contacto de seguimiento',
};
export const launchEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function launchResponsibilities(data: LaunchOptions): LaunchResponsibility[] {
  return [
    ...data.items
      .filter((item) => item.requiresReview)
      .map((item) => ({
        key: item.id,
        label: item.title,
        detail: 'Revisión de información',
        role: item.reviewerRole,
      })),
    ...(data.policy.approval.enabled
      ? [
          {
            key: 'approver',
            label: 'Aprobación final',
            detail: 'Autoriza la integración del expediente',
            role: data.policy.approval.role,
          },
        ]
      : []),
    ...(data.policy.completion.mode === 'manual'
      ? [
          {
            key: 'closer',
            label: 'Cierre del expediente',
            detail: 'Confirma el cierre cuando se cumplan las condiciones',
            role: data.policy.completion.role,
          },
        ]
      : []),
  ];
}

export function eligibleLaunchMembers(
  data: LaunchOptions,
  responsibility: LaunchResponsibility,
  assignments: Record<string, string>
): LaunchMember[] {
  const reviewers = data.items
    .filter((item) => item.requiresReview)
    .map((item) => assignments[item.id]);
  return data.members.filter((member) => {
    if (responsibility.role === 'owner' && member.id !== data.actorId) return false;
    if (responsibility.role === 'admin' && !['owner', 'admin'].includes(member.role)) return false;
    if (!['owner', 'admin', 'member'].includes(responsibility.role || '')) return false;
    if (
      responsibility.key === 'approver' &&
      data.separationOfDuties &&
      (member.id === data.actorId || reviewers.includes(member.id))
    )
      return false;
    return true;
  });
}

/** Secondary people are recorded as contacts; they never become evidence subjects or workspace members. */
export function normalizeLaunchParticipants(
  raw: unknown,
  subject: { name: string; email: string; userId?: string | null }
): LaunchParticipant[] {
  if (!Array.isArray(raw) || raw.length > 20)
    throw new Error('Puedes añadir hasta 20 participantes adicionales.');
  const emails = new Set(subject.email ? [subject.email.trim().toLowerCase()] : []);
  const users = new Set(subject.userId ? [subject.userId.toLowerCase()] : []);
  return raw.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Revisa los datos de los participantes.');
    const person = value as Record<string, unknown>;
    const name = typeof person.name === 'string' ? person.name.trim() : '';
    const email = typeof person.email === 'string' ? person.email.trim().toLowerCase() : '';
    const userId =
      typeof person.userId === 'string' && person.userId ? person.userId.toLowerCase() : undefined;
    if (
      !name ||
      name.length > 240 ||
      email.length > 254 ||
      (!userId && !launchEmailPattern.test(email)) ||
      (email && !launchEmailPattern.test(email)) ||
      (userId && !uuidPattern.test(userId))
    )
      throw new Error(
        'Cada participante necesita un nombre y un correo válido o una cuenta del espacio.'
      );
    if (!['representative', 'contact'].includes(String(person.role)))
      throw new Error('Selecciona el rol de cada participante.');
    if ((email && emails.has(email)) || (userId && users.has(userId)))
      throw new Error('Una persona ya está incluida. Revisa los participantes duplicados.');
    if (email) emails.add(email);
    if (userId) users.add(userId);
    return {
      id: userId || email,
      name,
      email,
      ...(userId ? { userId } : {}),
      role: person.role as LaunchParticipant['role'],
    };
  });
}

export function validateLaunchStep(
  step: number,
  data: LaunchOptions,
  title: string,
  subject: LaunchPerson | null,
  participants: LaunchParticipant[],
  assignments: Record<string, string>
): string {
  if (!title.trim() || title.trim().length > 240)
    return 'Escribe un nombre de expediente de hasta 240 caracteres.';
  if (
    !subject?.name.trim() ||
    subject.name.length > 240 ||
    (!subject.userId && !launchEmailPattern.test(subject.email)) ||
    (subject.email && !launchEmailPattern.test(subject.email))
  )
    return 'Selecciona al titular del expediente con un correo válido o una cuenta del espacio.';
  try {
    normalizeLaunchParticipants(participants, subject);
  } catch (cause) {
    return (cause as Error).message;
  }
  if (step > 1) {
    for (const responsibility of launchResponsibilities(data)) {
      if (
        !eligibleLaunchMembers(data, responsibility, assignments).some(
          (member) => member.id === assignments[responsibility.key]
        )
      )
        return `Selecciona un responsable autorizado para «${responsibility.label}».`;
    }
  }
  return '';
}
