import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadFormActivity, readActivityRows } from '@/lib/activity/inbox.server';
import { CASE_STATUS_META, type CaseFileStatus } from '@/lib/case-files/schema';
import { isUuid } from '@/lib/case-files/runtime.server';
import {
  contactEmailPattern,
  normalizeContactEmail,
  type ContactResource,
  type ContactResourceKind,
} from './detail';

type Reader = Pick<SupabaseClient, 'from'>;
type Scope = { workspaceId: string; email: string };
type CaseParticipant = { id: string; case_file_id: string; email: string; role: string };
type RelatedCase = {
  id: string;
  title: string;
  folio: string;
  status: CaseFileStatus;
  progress: number;
  updated_at: string;
};
type Document = { id: string; nombre: string; participantes: unknown };
type CaptureOutcome = {
  id: string;
  created_at: string;
  identity_match: boolean | null;
  nubarium_aprobado: boolean | null;
};
type Verification = CaptureOutcome & { document_id: string; user_id: string };
type Invitation = { id: string; case_file_id: string; recipient: string };
type CaseGrant = { invitation_id: string; liveness_verified_at: string };
type CaseUpload = {
  id: string;
  invitation_id: string;
  requirement_id: string;
  document_id: string;
  file_name: string;
  completed_at: string;
};
type CaseRequirement = { id: string; case_file_id: string; title: string; status: string };
type CaseDocument = {
  requirement_id: string;
  case_file_id: string;
  source_document_id: string | null;
};
type CaseCapture = CaptureOutcome & { invitation_id: string };
type FormCapture = { form_id: string; capture_id: string; user_id: string };

const roleLabels: Record<string, string> = {
  subject: 'Titular',
  representative: 'Representante',
  contact: 'Contacto de seguimiento',
};

const reviewStatuses = new Map<string, Pick<ContactResource, 'status' | 'tone'>>([
  ['in_review', { status: 'En revisión', tone: 'neutral' }],
  ['approved', { status: 'Aprobado', tone: 'success' }],
  ['locked', { status: 'Integrado', tone: 'success' }],
  ['observed', { status: 'Con observaciones', tone: 'warning' }],
  ['rejected', { status: 'Rechazado', tone: 'danger' }],
  ['expired', { status: 'Vencido', tone: 'warning' }],
]);

function captureOutcome(log: CaptureOutcome): Pick<ContactResource, 'status' | 'tone'> {
  return log.identity_match === true && log.nubarium_aprobado === true
    ? { status: 'Aprobada', tone: 'success' }
    : { status: 'Sin aprobación', tone: 'warning' };
}

async function readBatches<T>(
  ids: string[],
  read: (
    ids: string[],
    start: number,
    end: number
  ) => PromiseLike<{ data: unknown; error: unknown }>
) {
  const rows: T[] = [];
  const keys = [...new Set(ids)];
  for (let i = 0; i < keys.length; i += 100) {
    rows.push(
      ...(await readActivityRows<T>((start, end) => read(keys.slice(i, i + 100), start, end)))
    );
  }
  return rows;
}

async function contactCases(db: Reader, { workspaceId, email }: Scope) {
  const pattern = contactEmailPattern(email);
  const participants = await readActivityRows<CaseParticipant>((start, end) =>
    db
      .from('case_file_participants')
      .select('id,case_file_id,email,role')
      .eq('workspace_id', workspaceId)
      .filter('email', pattern === null ? 'eq' : 'ilike', pattern ?? email)
      .order('id')
      .range(start, end)
  );
  const rolesByCase = new Map<string, Set<string>>();
  for (const participant of participants) {
    if (normalizeContactEmail(participant.email) !== email) continue;
    const roles = rolesByCase.get(participant.case_file_id) || new Set<string>();
    roles.add(roleLabels[participant.role] || 'Participante');
    rolesByCase.set(participant.case_file_id, roles);
  }
  const cases = await readBatches<RelatedCase>([...rolesByCase.keys()], (batch, start, end) =>
    db
      .from('case_files')
      .select('id,title,folio,status,progress,updated_at')
      .eq('workspace_id', workspaceId)
      .in('id', batch)
      .order('id')
      .range(start, end)
  );
  return { cases, rolesByCase };
}

async function contactCaseInvitations(
  db: Reader,
  cases: RelatedCase[],
  { workspaceId, email }: Scope
) {
  const pattern = contactEmailPattern(email);
  const invitations = await readBatches<Invitation>(
    cases.map((row) => row.id),
    (batch, start, end) =>
      db
        .from('case_participant_invitations')
        .select('id,case_file_id,recipient')
        .eq('workspace_id', workspaceId)
        .in('case_file_id', batch)
        .filter('recipient', pattern === null ? 'eq' : 'ilike', pattern ?? email)
        .order('id')
        .range(start, end)
  );
  const casesById = new Map(cases.map((row) => [row.id, row]));
  const caseByInvite = new Map<string, RelatedCase>();
  for (const invitation of invitations) {
    const related = casesById.get(invitation.case_file_id);
    if (related && normalizeContactEmail(invitation.recipient) === email)
      caseByInvite.set(invitation.id, related);
  }
  return caseByInvite;
}

async function caseVerifications(db: Reader, caseByInvite: Map<string, RelatedCase>) {
  const grants = await readBatches<CaseGrant>([...caseByInvite.keys()], (batch, start, end) =>
    db
      .from('case_invitation_access_grants')
      .select('invitation_id,liveness_verified_at')
      .in('invitation_id', batch)
      .not('liveness_verified_at', 'is', null)
      .order('invitation_id')
      .order('user_id')
      .range(start, end)
  );
  return grants.flatMap((grant): ContactResource[] => {
    const row = caseByInvite.get(grant.invitation_id);
    return row
      ? [
          {
            id: `case:${grant.invitation_id}:${grant.liveness_verified_at}`,
            title: row.title,
            reference: row.folio,
            context: 'Prueba de vida · Expediente',
            status: 'Aprobada',
            tone: 'success',
            date: grant.liveness_verified_at,
            action: { href: `/expedientes/${row.id}`, label: 'Consultar expediente' },
          },
        ]
      : [];
  });
}

async function documentVerifications(
  db: Reader,
  service: Reader,
  actorId: string,
  scope: Scope,
  onlyIdentification = false
) {
  const documents = await readActivityRows<Document>((start, end) =>
    db
      .from('documentos')
      .select('id,nombre,participantes')
      .eq('owner_id', actorId)
      .eq('workspace_id', scope.workspaceId)
      .not('participantes', 'is', null)
      .neq('estado', 'borrador')
      .order('id')
      .range(start, end)
  );
  const relatedDocs = new Map<string, { title: string; userIds: Set<string> }>();
  for (const row of documents) {
    if (!Array.isArray(row.participantes)) continue;
    const matched = row.participantes.filter(
      (item) => item && normalizeContactEmail(item.email) === scope.email
    );
    if (!matched.length) continue;
    relatedDocs.set(row.id, {
      title: row.nombre || 'Documento',
      userIds: new Set(matched.map((item) => item.user_id).filter(isUuid)),
    });
  }

  // Older invitations may record the verified user only in the signed participation.
  const unbound = [...relatedDocs].filter(([, item]) => !item.userIds.size).map(([id]) => id);
  const pattern = contactEmailPattern(scope.email);
  const responses = await readBatches<{
    documento_id: string;
    participante_id: string | null;
    participante_email: string;
  }>(unbound, (batch, start, end) =>
    db
      .from('participation_responses')
      .select('documento_id,participante_id,participante_email')
      .in('documento_id', batch)
      .filter('participante_email', pattern === null ? 'eq' : 'ilike', pattern ?? scope.email)
      .order('id')
      .range(start, end)
  );
  for (const response of responses) {
    if (
      isUuid(response.participante_id) &&
      normalizeContactEmail(response.participante_email) === scope.email
    )
      relatedDocs.get(response.documento_id)?.userIds.add(response.participante_id);
  }
  const bound = [...relatedDocs].filter(([, item]) => item.userIds.size > 0).map(([id]) => id);
  const logs = await readBatches<Verification>(bound, (batch, start, end) => {
    const query = service
      .from('id_capture_logs')
      .select('id,document_id,user_id,created_at,identity_match,nubarium_aprobado')
      .in('document_id', batch);
    if (onlyIdentification) query.not('anverso_b64', 'is', null);
    return query.order('id').range(start, end);
  });
  return logs.flatMap((log): ContactResource[] => {
    const document = relatedDocs.get(log.document_id);
    if (!document?.userIds.has(log.user_id)) return [];
    return [
      {
        id: `document:${log.id}`,
        title: onlyIdentification ? 'Identificación oficial' : document.title,
        context: onlyIdentification ? document.title : 'Validación durante la firma · Documento',
        ...(onlyIdentification && {
          origin: 'identidad',
          description: 'Validación durante la firma',
        }),
        ...captureOutcome(log),
        date: log.created_at,
        action: { href: `/visor-documento/${log.document_id}`, label: 'Abrir documento' },
      },
    ];
  });
}

async function caseContributions(
  db: Reader,
  service: Reader,
  workspaceId: string,
  caseByInvite: Map<string, RelatedCase>
): Promise<ContactResource[]> {
  const uploads = await readBatches<CaseUpload>([...caseByInvite.keys()], (batch, start, end) =>
    service
      .from('case_portal_uploads')
      .select('id,invitation_id,requirement_id,document_id,file_name,completed_at')
      .in('invitation_id', batch)
      .eq('status', 'completed')
      .not('completed_at', 'is', null)
      .order('id')
      .range(start, end)
  );
  const requirementIds = uploads.map((upload) => upload.requirement_id);
  const [requirements, documents] = await Promise.all([
    readBatches<CaseRequirement>(requirementIds, (batch, start, end) =>
      db
        .from('case_file_requirements')
        .select('id,case_file_id,title,status')
        .eq('workspace_id', workspaceId)
        .in('id', batch)
        .order('id')
        .range(start, end)
    ),
    readBatches<CaseDocument>(requirementIds, (batch, start, end) =>
      db
        .from('case_file_documents')
        .select('requirement_id,case_file_id,source_document_id')
        .eq('workspace_id', workspaceId)
        .in('requirement_id', batch)
        .order('id')
        .range(start, end)
    ),
  ]);
  const requirementById = new Map(requirements.map((row) => [row.id, row]));
  const documentByRequirement = new Map(documents.map((row) => [row.requirement_id, row]));
  return uploads.flatMap((upload): ContactResource[] => {
    const related = caseByInvite.get(upload.invitation_id);
    const requirement = requirementById.get(upload.requirement_id);
    if (!related || !requirement || requirement.case_file_id !== related.id) return [];
    const currentDocument = documentByRequirement.get(requirement.id);
    let outcome: Pick<ContactResource, 'status' | 'tone'> = { status: 'Recibido', tone: 'neutral' };
    if (currentDocument?.case_file_id === related.id && currentDocument.source_document_id) {
      outcome =
        currentDocument.source_document_id === upload.document_id
          ? (reviewStatuses.get(requirement.status) ?? outcome)
          : { status: 'Versión anterior', tone: 'neutral' };
    }
    return [
      {
        id: `upload:${upload.id}`,
        title: upload.file_name || 'Documento entregado',
        reference: related.folio,
        context: related.title,
        description: requirement.title,
        origin: 'expediente',
        ...outcome,
        date: upload.completed_at,
        action: {
          href: `/expedientes/${related.id}?tab=documentos`,
          label: 'Ver entregas del expediente',
        },
      },
    ];
  });
}

async function caseIdentityDocuments(service: Reader, caseByInvite: Map<string, RelatedCase>) {
  // The verification service writes the invitation ID when it stores the capture.
  const logs = await readBatches<CaseCapture>([...caseByInvite.keys()], (batch, start, end) =>
    service
      .from('id_capture_logs')
      .select(
        'id,created_at,identity_match,nubarium_aprobado,invitation_id:raw_nubarium_response->>case_invitation_id'
      )
      .eq('raw_nubarium_response->>mode', 'case_portal_liveness')
      .in('raw_nubarium_response->>case_invitation_id', batch)
      .not('anverso_b64', 'is', null)
      .order('id')
      .range(start, end)
  );
  return logs.flatMap((log): ContactResource[] => {
    const related = caseByInvite.get(log.invitation_id);
    if (!related) return [];
    return [
      {
        id: `case-identification:${log.id}`,
        title: 'Identificación oficial',
        context: related.title,
        reference: related.folio,
        description: 'Prueba de vida del expediente',
        origin: 'identidad',
        date: log.created_at,
        ...captureOutcome(log),
        action: {
          href: `/expedientes/${related.id}?tab=identidad`,
          label: 'Consultar identidad del expediente',
        },
      },
    ];
  });
}

async function formIdentityDocuments(
  service: Reader,
  email: string,
  records: Awaited<ReturnType<typeof loadFormActivity>>
) {
  const forms = new Map(
    records.flatMap((row) =>
      row.access === 'public' && isUuid(row.templateId) ? [[row.templateId, row] as const] : []
    )
  );
  const sessions = await readBatches<FormCapture>([...forms.keys()], (batch, start, end) =>
    service
      .from('mobile_upload_sessions')
      .select('user_id,form_id:metadata->>form_id,capture_id:metadata->>capture_log_id')
      .eq('metadata->>mode', 'public_form_liveness')
      .eq('metadata->>recipient_email', email)
      .in('metadata->>form_id', batch)
      .in('status', ['completed', 'identity_failed'])
      .not('metadata->>capture_log_id', 'is', null)
      .order('id')
      .range(start, end)
  );
  const uploads = await readBatches<CaptureOutcome & { user_id: string }>(
    sessions.map((row) => row.capture_id).filter(isUuid),
    (batch, start, end) =>
      service
        .from('id_capture_logs')
        .select('id,user_id,created_at,identity_match,nubarium_aprobado')
        .in('id', batch)
        .not('anverso_b64', 'is', null)
        .order('id')
        .range(start, end)
  );
  const byId = new Map(uploads.map((row) => [row.id, row]));
  const results = sessions.flatMap((session): ContactResource[] => {
    const form = forms.get(session.form_id);
    const upload = byId.get(session.capture_id);
    if (!form || !upload || upload.user_id !== session.user_id) return [];
    const href = form.actions[0]?.href;
    return [
      {
        id: `form-identification:${upload.id}`,
        title: 'Identificación oficial',
        context: form.title,
        reference: form.reference,
        description: 'Prueba de vida del formulario',
        origin: 'identidad',
        date: upload.created_at,
        ...captureOutcome(upload),
        ...(href && { action: { href, label: 'Ver respuestas del formulario' } }),
      },
    ];
  });
  return [...new Map(results.map((row) => [row.id, row])).values()];
}

// The caller verifies ownership of the agenda contact and active workspace membership.
export async function loadContactResources(
  db: Reader,
  service: Reader,
  actor: { id: string; email: string },
  scope: Scope,
  kind: ContactResourceKind
): Promise<ContactResource[]> {
  if (!scope.email) return [];
  if (kind === 'expedientes') {
    const { cases, rolesByCase } = await contactCases(db, scope);
    return cases.map((row) => ({
      id: row.id,
      title: row.title,
      reference: row.folio,
      context: [...(rolesByCase.get(row.id) || [])].join(' · '),
      status: CASE_STATUS_META[row.status]?.label || 'En seguimiento',
      tone: row.status === 'sealed' ? 'success' : row.status === 'observed' ? 'warning' : 'neutral',
      date: row.updated_at,
      progress: row.progress,
      action: { href: `/expedientes/${row.id}`, label: 'Consultar expediente' },
    }));
  }
  const forms = loadFormActivity(service, actor, 'sent', Date.now(), scope);
  if (kind === 'formularios')
    return (await forms).map((row) => {
      const href = row.actions[0]?.href;
      return {
        id: row.id,
        title: row.title,
        reference: row.reference,
        context: row.role,
        status: row.stateLabel,
        tone:
          row.state === 'completed'
            ? 'success'
            : row.state === 'failed'
              ? 'danger'
              : row.state === 'signature'
                ? 'warning'
                : 'neutral',
        date: row.updatedAt,
        ...(href && { action: { href, label: 'Ver respuestas' } }),
      };
    });
  const caseInvitations = contactCases(db, scope).then(({ cases }) =>
    contactCaseInvitations(service, cases, scope)
  );
  if (kind === 'aportada') {
    const contributions = await Promise.all([
      caseInvitations.then((rows) => caseContributions(db, service, scope.workspaceId, rows)),
      caseInvitations.then((rows) => caseIdentityDocuments(service, rows)),
      documentVerifications(db, service, actor.id, scope, true),
      forms.then((rows) => formIdentityDocuments(service, scope.email, rows)),
    ]);
    return contributions.flat();
  }
  const [formRecords, documentRecords, caseRecords] = await Promise.all([
    forms,
    documentVerifications(db, service, actor.id, scope),
    caseInvitations.then((rows) => caseVerifications(service, rows)),
  ]);
  const formVerifications = formRecords.flatMap((row): ContactResource[] => {
    if (!row.identityVerifiedAt) return [];
    return [
      {
        id: `form:${row.id}`,
        title: row.title,
        reference: row.reference,
        context: 'Prueba de vida · Formulario',
        status: 'Aprobada',
        tone: 'success',
        date: row.identityVerifiedAt,
        ...(row.actions[0]?.href && {
          action: { href: row.actions[0].href, label: 'Ver respuestas' },
        }),
      },
    ];
  });
  return [
    ...new Map(
      [...documentRecords, ...formVerifications, ...caseRecords].map((row) => [row.id, row])
    ).values(),
  ];
}
