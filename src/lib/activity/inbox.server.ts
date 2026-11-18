import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CASE_STATUS_META, type CaseFileStatus } from '@/lib/case-files/schema';
import {
  activityTime,
  formActivityState,
  recipientKey,
  type ActivityAction,
  type ActivityItem,
  type ActivityMode,
  type ActivityState,
} from './model';

type Reader = Pick<SupabaseClient, 'from'>;
type Query = PromiseLike<{ data: unknown; error: unknown }>;
type Actor = { id: string; email: string };
type Form = {
  id: string;
  name: string;
  workspace_id: string;
  created_by: string;
  status: string;
  requires_signature: boolean;
};
type Token = {
  id: string;
  template_id: string;
  recipient_user_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  access_mode: string | null;
  expires_at: string | null;
  used_at: string | null;
  created_at: string;
  launched_by_user_id: string | null;
  launcher_name: string | null;
};
type PublicInvite = {
  form_id: string;
  recipient_email: string;
  recipient_name: string | null;
  invited_at: string;
  invited_by: string;
};
type Schedule = {
  id: string;
  template_id: string;
  recipient_email: string;
  recipient_name: string | null;
  requested_by: string;
  created_at: string;
  scheduled_at: string;
  sent_at: string | null;
  status: string;
  token_id: string | null;
};
type Response = {
  id: string;
  template_id: string;
  token_id: string;
  respondent_email: string | null;
  status: string;
  submitted_at: string | null;
  document_id: string | null;
  folio: string | null;
};
type Case = {
  id: string;
  title: string;
  folio: string;
  workspace_id: string;
  status: CaseFileStatus;
  priority: string;
  progress: number;
  owner_user_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  target_close_at: string | null;
  runtime_assignments: unknown;
};
type Invitation = {
  id: string;
  workspace_id: string;
  case_title: string;
  folio: string;
  case_file_id: string;
  participant_id: string;
  recipient: string;
  recipient_name: string;
  participant_role: string;
  sender_name: string;
  created_by: string;
  created_at: string;
  sent_at: string | null;
  not_before: string;
  expires_at: string;
  revoked_at: string | null;
  generation: number;
  delivery_status: string;
};
type Launch = {
  case_file_id: string;
  access_mode: 'private' | 'public';
  scheduled_at: string | null;
};
const TOKEN_COLUMNS =
  'id,template_id,recipient_user_id,recipient_email,recipient_name,access_mode,expires_at,used_at,created_at,launched_by_user_id,launcher_name';
const INVITATION_COLUMNS =
  'id,workspace_id,case_title,folio,case_file_id,participant_id,recipient,recipient_name,participant_role,sender_name,created_by,created_at,sent_at,not_before,expires_at,revoked_at,generation,delivery_status';
const CASE_COLUMNS =
  'id,title,folio,workspace_id,status,priority,progress,owner_user_id,created_by,created_at,updated_at,target_close_at,runtime_assignments';
const RESPONSE_COLUMNS =
  'id,template_id,token_id,respondent_email,status,submitted_at,document_id,folio';
const unique = <T>(rows: T[], key: (row: T) => string) => [
  ...new Map(rows.map((row) => [key(row), row])).values(),
];

/** Read every page; never silently truncate a person's inbox at the Data API row limit. */
export async function readActivityRows<T>(
  build: (start: number, end: number) => Query
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const result = await build(start, start + 499);
    if (result.error) throw result.error;
    const batch = (result.data || []) as T[];
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
async function byIds<T>(
  db: Reader,
  table: string,
  columns: string,
  field: string,
  ids: string[]
): Promise<T[]> {
  const result: T[] = [];
  const values = [...new Set(ids.filter(Boolean))];
  for (let start = 0; start < values.length; start += 100) {
    const batch = values.slice(start, start + 100);
    result.push(
      ...(await readActivityRows<T>((from, to) => {
        const query = db.from(table).select(columns).in(field, batch).order(field);
        if (
          [
            'form_tokens',
            'form_responses',
            'form_send_schedules',
            'case_participant_invitations',
          ].includes(table) &&
          field !== 'id'
        )
          query.order('id');
        return query.range(from, to);
      }))
    );
  }
  return result;
}
async function activeWorkspaces(db: Reader, actor: Actor, now: number) {
  const memberships = await readActivityRows<{
    workspace_id: string;
    access_expires_at: string | null;
  }>((start, end) =>
    db
      .from('workspace_members')
      .select('workspace_id,access_expires_at')
      .eq('user_id', actor.id)
      .eq('status', 'active')
      .order('workspace_id')
      .range(start, end)
  );
  return memberships
    .filter((member) => !member.access_expires_at || activityTime(member.access_expires_at) > now)
    .map((member) => member.workspace_id);
}
async function names(db: Reader, workspaceIds: string[], userIds: string[]) {
  const [workspaces, profiles] = await Promise.all([
    byIds<{ id: string; name: string }>(db, 'workspaces', 'id,name', 'id', workspaceIds),
    byIds<{ id: string; full_name: string | null }>(
      db,
      'user_profiles',
      'id,full_name',
      'id',
      userIds
    ),
  ]);
  return {
    workspace: (id: string) =>
      workspaces.find((row) => row.id === id)?.name || 'Espacio de trabajo',
    person: (id: string) =>
      profiles.find((row) => row.id === id)?.full_name || 'Nombre no disponible',
  };
}

export async function loadFormActivity(
  db: Reader,
  actor: Actor,
  mode: ActivityMode,
  now = Date.now()
): Promise<ActivityItem[]> {
  const [directTokens, userTokens, publicInvites, ownSchedules, ownTemplates] = await Promise.all([
    readActivityRows<Token>((start, end) => {
      const query = db.from('form_tokens').select(TOKEN_COLUMNS);
      return (
        mode === 'sent'
          ? query.eq('launched_by_user_id', actor.id)
          : query.eq('recipient_email', actor.email).is('recipient_user_id', null)
      )
        .order('created_at', { ascending: false })
        .order('id')
        .range(start, end);
    }),
    mode === 'received'
      ? readActivityRows<Token>((start, end) =>
          db
            .from('form_tokens')
            .select(TOKEN_COLUMNS)
            .eq('recipient_user_id', actor.id)
            .order('created_at', { ascending: false })
            .order('id')
            .range(start, end)
        )
      : [],
    readActivityRows<PublicInvite>((start, end) => {
      const query = db
        .from('form_public_invitees')
        .select('form_id,recipient_email,recipient_name,invited_at,invited_by');
      return (
        mode === 'sent'
          ? query.eq('invited_by', actor.id)
          : query.eq('recipient_email', actor.email)
      )
        .order('invited_at', { ascending: false })
        .order('form_id')
        .order('recipient_email')
        .range(start, end);
    }),
    mode === 'sent'
      ? readActivityRows<Schedule>((start, end) =>
          db
            .from('form_send_schedules')
            .select(
              'id,template_id,recipient_email,recipient_name,requested_by,created_at,scheduled_at,sent_at,status,token_id'
            )
            .eq('requested_by', actor.id)
            .order('created_at', { ascending: false })
            .order('id')
            .range(start, end)
        )
      : [],
    mode === 'sent'
      ? readActivityRows<{ id: string }>((start, end) =>
          db
            .from('form_templates')
            .select('id')
            .eq('created_by', actor.id)
            .order('id')
            .range(start, end)
        )
      : [],
  ]);
  // Older private launches did not record the launcher. Their template creator is the fallback.
  const legacyTokens: Token[] = [];
  for (let offset = 0; offset < ownTemplates.length; offset += 100) {
    legacyTokens.push(
      ...(await readActivityRows<Token>((start, end) =>
        db
          .from('form_tokens')
          .select(TOKEN_COLUMNS)
          .in(
            'template_id',
            ownTemplates.slice(offset, offset + 100).map((row) => row.id)
          )
          .is('launched_by_user_id', null)
          .order('created_at', { ascending: false })
          .order('id')
          .range(start, end)
      ))
    );
  }
  // A public invitation and its claimed token are one request, not two requests.
  const inviteKeys = new Set(
    publicInvites.map((row) => recipientKey(row.form_id, row.recipient_email))
  );
  const publicTokens: Token[] = [];
  const publicFormIds = [...new Set(publicInvites.map((row) => row.form_id))];
  const publicEmails = [...new Set(publicInvites.map((row) => row.recipient_email))];
  for (let formOffset = 0; formOffset < publicFormIds.length; formOffset += 100) {
    for (let emailOffset = 0; emailOffset < publicEmails.length; emailOffset += 100) {
      publicTokens.push(
        ...(await readActivityRows<Token>((start, end) =>
          db
            .from('form_tokens')
            .select(TOKEN_COLUMNS)
            .in('template_id', publicFormIds.slice(formOffset, formOffset + 100))
            .in('recipient_email', publicEmails.slice(emailOffset, emailOffset + 100))
            .eq('access_mode', 'public')
            .order('created_at', { ascending: false })
            .order('id')
            .range(start, end)
        ))
      );
    }
  }
  const candidates = unique(
    [
      ...directTokens,
      ...userTokens,
      ...legacyTokens,
      ...publicTokens.filter(
        (row) =>
          row.access_mode === 'public' &&
          inviteKeys.has(recipientKey(row.template_id, row.recipient_email))
      ),
    ],
    (row) => row.id
  );
  const [bindings, schedules, forms, responses, allowedWorkspaces] = await Promise.all([
    byIds<{ token_id: string }>(
      db,
      'case_portal_form_tokens',
      'token_id',
      'token_id',
      candidates.map((row) => row.id)
    ),
    byIds<Schedule>(
      db,
      'form_send_schedules',
      'id,template_id,recipient_email,recipient_name,requested_by,created_at,scheduled_at,sent_at,status,token_id',
      'token_id',
      candidates.map((row) => row.id)
    ),
    byIds<Form>(
      db,
      'form_templates',
      'id,name,workspace_id,created_by,status,requires_signature',
      'id',
      [
        ...candidates.map((row) => row.template_id),
        ...publicInvites.map((row) => row.form_id),
        ...ownSchedules.map((row) => row.template_id),
      ]
    ),
    byIds<Response>(
      db,
      'form_responses',
      RESPONSE_COLUMNS,
      'token_id',
      candidates.map((row) => row.id)
    ),
    mode === 'sent' ? activeWorkspaces(db, actor, now) : null,
  ]);
  const visibleForms = forms.filter(
    (form) => !allowedWorkspaces || allowedWorkspaces.includes(form.workspace_id)
  );
  const lookup = await names(
    db,
    visibleForms.map((form) => form.workspace_id),
    [
      ...visibleForms.map((form) => form.created_by),
      ...candidates.map((row) => row.launched_by_user_id || ''),
    ]
  );
  const bound = new Set(bindings.map((row) => row.token_id));
  const tokens = candidates.filter(
    (row) =>
      !bound.has(row.id) &&
      !schedules.some((schedule) => schedule.token_id === row.id && schedule.status !== 'sent')
  );
  const items: ActivityItem[] = [];
  function add(
    form: Form,
    id: string,
    token: Token | undefined,
    invitation: PublicInvite | undefined,
    schedule?: Schedule
  ) {
    const response = token
      ? responses
          .filter((row) => row.token_id === token.id)
          .sort((a, b) => activityTime(b.submitted_at) - activityTime(a.submitted_at))[0]
      : undefined;
    const state = formActivityState(
      {
        responseStatus: response?.status,
        submittedAt: response?.submitted_at,
        usedAt: token?.used_at,
        requiresSignature: form.requires_signature,
        expiresAt: token?.expires_at,
        templateStatus: form.status,
        scheduledStatus: schedule?.status,
        scheduledAt: schedule?.scheduled_at,
      },
      now
    );
    const actions: ActivityAction[] = [];
    if (mode === 'sent') {
      actions.push({
        label: 'Ver respuestas',
        href: `/formularios/respuestas?id=${form.id}${response ? `&respuesta=${response.id}` : ''}`,
      });
      actions.push({ label: 'Ver formulario', href: `/formularios/preview?id=${form.id}` });
    } else if (token) {
      const canOpen = ['pending', 'in_progress', 'signature', 'completed'].includes(state.state);
      actions.push({
        label:
          state.state === 'completed'
            ? 'Ver mi respuesta'
            : state.state === 'signature'
              ? 'Continuar firma'
              : 'Responder formulario',
        open: { source: 'form-token', id: token.id },
        ...(!canOpen ? { disabledReason: state.stateLabel } : {}),
      });
    } else
      actions.push({
        label: 'Abrir con código',
        open: { source: 'form-public', id: form.id },
        ...(form.status !== 'published'
          ? { disabledReason: 'El formulario no está publicado.' }
          : {}),
      });
    const isPublic = !!invitation || token?.access_mode === 'public';
    items.push({
      id,
      kind: 'formularios',
      title: form.name,
      reference: response?.folio || '',
      workspace: lookup.workspace(form.workspace_id),
      workspaceId: form.workspace_id,
      person:
        mode === 'sent'
          ? token?.recipient_name ||
            invitation?.recipient_name ||
            schedule?.recipient_name ||
            'Participante'
          : token?.launcher_name ||
            lookup.person(token?.launched_by_user_id || invitation?.invited_by || form.created_by),
      email:
        mode === 'sent'
          ? token?.recipient_email || invitation?.recipient_email || schedule?.recipient_email || ''
          : '',
      role: form.requires_signature ? 'Responder y firmar' : 'Responder formulario',
      ...state,
      sentAt:
        schedule?.sent_at ||
        invitation?.invited_at ||
        token?.created_at ||
        schedule?.created_at ||
        '',
      updatedAt:
        response?.submitted_at ||
        token?.created_at ||
        invitation?.invited_at ||
        schedule?.created_at ||
        '',
      expiresAt: token?.expires_at || null,
      scheduledAt: schedule?.scheduled_at || null,
      access: isPublic ? 'public' : 'private',
      priority: 'normal',
      progress: null,
      detail:
        schedule && state.state === 'scheduled'
          ? 'El envío aún no se ha completado.'
          : state.state === 'signature'
            ? 'Respuesta recibida; falta completar la firma.'
            : response?.status !== 'draft' && response?.submitted_at
              ? 'Respuesta recibida.'
              : isPublic
                ? 'Acceso mediante código de formulario.'
                : 'Invitación privada al formulario.',
      actions,
    });
  }
  for (const token of tokens) {
    const form = visibleForms.find((row) => row.id === token.template_id);
    if (!form) continue;
    const invitation = publicInvites.find(
      (row) =>
        row.form_id === token.template_id &&
        recipientKey(row.form_id, row.recipient_email) ===
          recipientKey(token.template_id, token.recipient_email) &&
        activityTime(token.created_at) >= activityTime(row.invited_at)
    );
    // Repeated claims of the same public invitation share its latest token.
    if (
      invitation &&
      tokens.some(
        (other) =>
          other.id !== token.id &&
          recipientKey(other.template_id, other.recipient_email) ===
            recipientKey(token.template_id, token.recipient_email) &&
          activityTime(other.created_at) > activityTime(token.created_at)
      )
    )
      continue;
    add(
      form,
      invitation ? `public:${form.id}:${invitation.recipient_email}` : `token:${token.id}`,
      token,
      invitation
    );
  }
  for (const invitation of publicInvites) {
    const form = visibleForms.find((row) => row.id === invitation.form_id);
    if (
      form &&
      !tokens.some(
        (token) =>
          token.template_id === invitation.form_id &&
          recipientKey(token.template_id, token.recipient_email) ===
            recipientKey(invitation.form_id, invitation.recipient_email) &&
          activityTime(token.created_at) >= activityTime(invitation.invited_at)
      )
    )
      add(form, `public:${form.id}:${invitation.recipient_email}`, undefined, invitation);
  }
  for (const schedule of ownSchedules.filter((row) => row.status !== 'sent')) {
    const form = visibleForms.find((row) => row.id === schedule.template_id);
    if (form) add(form, `schedule:${schedule.id}`, undefined, undefined, schedule);
  }
  return items;
}

export async function loadCaseActivity(
  db: Reader,
  actor: Actor,
  mode: ActivityMode,
  now = Date.now()
): Promise<ActivityItem[]> {
  const workspaceIds = await activeWorkspaces(db, actor, now);
  const [recipientInvitations, grants, reviewerRows] = await Promise.all([
    mode === 'received'
      ? readActivityRows<Invitation>((start, end) =>
          db
            .from('case_participant_invitations')
            .select(INVITATION_COLUMNS)
            .eq('recipient', actor.email)
            .order('created_at', { ascending: false })
            .order('id')
            .range(start, end)
        )
      : [],
    mode === 'received'
      ? readActivityRows<{ invitation_id: string }>((start, end) =>
          db
            .from('case_invitation_access_grants')
            .select('invitation_id')
            .eq('user_id', actor.id)
            .gt('expires_at', new Date(now).toISOString())
            .order('invitation_id')
            .range(start, end)
        )
      : [],
    mode === 'received' && workspaceIds.length
      ? Promise.all(
          ['case_file_requirements', 'case_file_forms'].map((table) =>
            readActivityRows<{ case_file_id: string; reviewer_user_id: string }>((start, end) =>
              db
                .from(table)
                .select('case_file_id,reviewer_user_id')
                .in('workspace_id', workspaceIds)
                .eq('reviewer_user_id', actor.id)
                .order('id')
                .range(start, end)
            )
          )
        ).then((rows) => rows.flat())
      : [],
  ]);
  const grantInvitations = await byIds<Invitation>(
    db,
    'case_participant_invitations',
    INVITATION_COLUMNS,
    'id',
    grants.map((row) => row.invitation_id)
  );
  const ownInvitations = unique([...recipientInvitations, ...grantInvitations], (row) => row.id);
  const reviewerCaseIds = [...new Set(reviewerRows.map((row) => row.case_file_id))];
  const internalCases = workspaceIds.length
    ? await readActivityRows<Case>((start, end) => {
        const query = db.from('case_files').select(CASE_COLUMNS).in('workspace_id', workspaceIds);
        return (
          mode === 'sent'
            ? query.eq('created_by', actor.id)
            : query.or(
                [
                  `owner_user_id.eq.${actor.id}`,
                  `runtime_assignments->>approver.eq.${actor.id}`,
                  `runtime_assignments->>closer.eq.${actor.id}`,
                  ...(reviewerCaseIds.length ? [`id.in.(${reviewerCaseIds.join(',')})`] : []),
                ].join(',')
              )
        )
          .order('created_at', { ascending: false })
          .order('id')
          .range(start, end);
      })
    : [];
  const externalCases = await byIds<Case>(
    db,
    'case_files',
    CASE_COLUMNS,
    'id',
    ownInvitations
      .filter((row) => !row.revoked_at && activityTime(row.expires_at) > now)
      .map((row) => row.case_file_id)
  );
  // An expired/revoked recipient sees the invitation they received, not current case contents.
  const currentIds = new Set([...internalCases, ...externalCases].map((row) => row.id));
  const snapshots = unique(
    ownInvitations
      .filter((row) => !currentIds.has(row.case_file_id))
      .sort((a, b) => a.generation - b.generation),
    (row) => row.case_file_id
  );
  const snapshotIds = new Set(snapshots.map((row) => row.case_file_id));
  const historicalCases: Case[] = snapshots.map((row) => ({
    id: row.case_file_id,
    title: row.case_title || 'Expediente',
    folio: row.folio || '',
    workspace_id: row.workspace_id,
    status: 'open',
    priority: 'normal',
    progress: 0,
    owner_user_id: '',
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.created_at,
    target_close_at: null,
    runtime_assignments: {},
  }));
  const cases = unique([...internalCases, ...externalCases, ...historicalCases], (row) => row.id);
  const [launches, sentInvitations] = await Promise.all([
    byIds<Launch>(
      db,
      'case_launches',
      'case_file_id,access_mode,scheduled_at',
      'case_file_id',
      cases.filter((row) => !snapshotIds.has(row.id)).map((row) => row.id)
    ),
    mode === 'sent'
      ? byIds<Invitation>(
          db,
          'case_participant_invitations',
          INVITATION_COLUMNS,
          'case_file_id',
          cases.map((row) => row.id)
        )
      : [],
  ]);
  const lookup = await names(
    db,
    cases.map((row) => row.workspace_id),
    cases.map((row) => row.created_by)
  );
  const results: ActivityItem[] = [];
  for (const row of cases) {
    const launch = launches.find((value) => value.case_file_id === row.id);
    if (
      mode === 'sent' &&
      !launch &&
      !sentInvitations.some((value) => value.case_file_id === row.id)
    )
      continue;
    const invitations = (mode === 'sent' ? sentInvitations : ownInvitations).filter(
      (value) => value.case_file_id === row.id
    );
    const latest = [
      ...new Map(
        invitations
          .slice()
          .sort((a, b) => a.generation - b.generation)
          .map((value) => [value.participant_id, value])
      ).values(),
    ];
    const invitation = latest
      .slice()
      .sort((a, b) => activityTime(b.created_at) - activityTime(a.created_at))[0];
    const isInternal = internalCases.some((value) => value.id === row.id);
    const scheduled = !!launch?.scheduled_at && activityTime(launch.scheduled_at) > now;
    let state: ActivityState =
      row.status === 'sealed'
        ? 'completed'
        : row.status === 'cancelled'
          ? 'cancelled'
          : row.status === 'observed'
            ? 'observed'
            : ['ready_to_sign', 'signing'].includes(row.status)
              ? 'signature'
              : 'in_progress';
    let stateLabel = CASE_STATUS_META[row.status]?.label || 'En progreso';
    if (scheduled && !['completed', 'cancelled'].includes(state)) {
      state = 'scheduled';
      stateLabel = 'Envío programado';
    }
    if (!['completed', 'cancelled'].includes(state) && !isInternal && invitation?.revoked_at) {
      state = 'cancelled';
      stateLabel = 'Invitación revocada';
    } else if (
      !['completed', 'cancelled'].includes(state) &&
      !isInternal &&
      invitation &&
      activityTime(invitation.expires_at) <= now
    ) {
      state = 'expired';
      stateLabel = 'Invitación vencida';
    }
    const roles: string[] = [];
    const assignments =
      row.runtime_assignments && typeof row.runtime_assignments === 'object'
        ? (row.runtime_assignments as Record<string, unknown>)
        : {};
    if (mode === 'received') {
      if (isInternal && row.owner_user_id === actor.id) roles.push('Administrador');
      if (isInternal && reviewerCaseIds.includes(row.id)) roles.push('Revisor');
      if (isInternal && assignments.approver === actor.id) roles.push('Aprobador');
      if (isInternal && assignments.closer === actor.id) roles.push('Responsable del cierre');
      if (invitation)
        roles.push(
          (
            {
              subject: 'Titular',
              representative: 'Representante',
              contact: 'Contacto de seguimiento',
            } as Record<string, string>
          )[invitation.participant_role] || 'Participante'
        );
    }
    const actions: ActivityAction[] = [];
    if (isInternal)
      actions.push({
        label: mode === 'received' ? 'Atender expediente' : 'Consultar expediente',
        href: `/expedientes/${row.id}`,
      });
    if (mode === 'received' && invitation)
      actions.push({
        label: 'Abrir mi participación',
        open: { source: 'case-invitation', id: invitation.id },
        ...(invitation.revoked_at ||
        activityTime(invitation.expires_at) <= now ||
        scheduled ||
        row.status === 'cancelled'
          ? {
              disabledReason: invitation.revoked_at
                ? 'Invitación revocada.'
                : scheduled
                  ? 'El envío todavía está programado.'
                  : 'La invitación ya no está disponible.',
            }
          : {}),
      });
    results.push({
      id: `case:${row.id}`,
      kind: 'expedientes',
      title: row.title,
      reference: row.folio,
      workspace: lookup.workspace(row.workspace_id),
      workspaceId: row.workspace_id,
      person:
        mode === 'sent'
          ? latest[0]?.recipient_name || 'Sin destinatario'
          : invitation?.sender_name || lookup.person(row.created_by),
      email: mode === 'sent' && latest.length === 1 ? latest[0].recipient : '',
      role:
        roles.join(' · ') ||
        `${latest.length} ${latest.length === 1 ? 'participante' : 'participantes'}`,
      state,
      stateLabel,
      sentAt: invitation?.sent_at || invitation?.created_at || row.created_at,
      updatedAt: row.updated_at,
      expiresAt:
        mode === 'received' && !isInternal ? invitation?.expires_at || null : row.target_close_at,
      access: launch?.access_mode || 'private',
      scheduledAt: launch?.scheduled_at || null,
      priority: row.priority,
      progress: snapshotIds.has(row.id) ? null : row.progress,
      detail:
        mode === 'sent'
          ? `${latest.length} participantes · ${latest.filter((value) => value.delivery_status === 'sent' && !value.revoked_at).length} invitaciones enviadas`
          : 'Documentos, formularios y verificaciones del expediente.',
      actions,
    });
  }
  return results;
}
