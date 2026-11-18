import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  caseIdentity,
  isUuid,
  runtimeFailure,
  runtimeHeaders,
  CaseRuntimeError,
} from '@/lib/case-files/runtime.server';
import { requireCaseWorkspace } from '@/lib/case-files/consultation.server';
import { CASE_STATUS_META } from '@/lib/case-files/schema';
import { parseCaseFilters } from '@/lib/case-files/consultation-filters';
import { caseFolderKey, readCaseFolders } from '@/lib/case-files/folders';
import { casePeopleNames, caseResponsibleIds } from '@/lib/case-files/list-people';
export const runtime = 'nodejs';
type CaseListRecord = {
  id: string;
  title: string;
  folio: string;
  status: string;
  progress: number;
  template_id: string | null;
  case_type: string;
  case_subtype: string | null;
  subject_name: string;
  owner_user_id: string;
  created_by: string | null;
  runtime_assignments: unknown;
  updated_at: string;
  created_at: string;
  target_close_at: string | null;
  closed_at: string | null;
  tags: string[];
  priority: string;
};
export async function GET(request: NextRequest) {
  try {
    const actor = await caseIdentity(request),
      service = createServiceClient(),
      p = request.nextUrl.searchParams;
    const workspaceId = p.get('workspaceId');
    const membership = await requireCaseWorkspace(service, workspaceId, actor.id);
    let filters: ReturnType<typeof parseCaseFilters>;
    try {
      filters = parseCaseFilters(p);
    } catch (cause) {
      throw new CaseRuntimeError(
        'CASE_INPUT_INVALID',
        cause instanceof Error ? cause.message : 'Filtros inválidos.',
        422
      );
    }
    const favorites = await service
      .from('user_favorites')
      .select('item_id')
      .eq('user_id', actor.id)
      .eq('storage_key', `expedientes:${workspaceId}`);
    if (favorites.error) throw favorites.error;
    const favoriteIds = (favorites.data || []).map((row) => row.item_id as string).filter(isUuid);
    const page = Math.max(1, Math.min(100000, Math.floor(Number(p.get('page')) || 1))),
      size = 20;
    const base =
      'id,title,folio,status,progress,template_id,case_type,case_subtype,subject_name,owner_user_id,created_by,runtime_assignments,updated_at,created_at,target_close_at,closed_at,tags,priority';
    const scheduled = p.get('envio') === 'scheduled';
    const countOnly = p.get('conteo') === '1';
    const query = service
      .from('case_files')
      .select(
        base +
          (scheduled || filters.access ? ',case_launches!inner(scheduled_at,access_mode)' : ''),
        { count: 'exact', head: countOnly }
      )
      .eq('workspace_id', workspaceId);
    const folderId = p.get('carpeta');
    if (folderId) {
      if (!isUuid(folderId))
        throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Carpeta inválida.', 422);
      const prefs = await service
        .from('user_view_preferences')
        .select('custom_filters')
        .eq('user_id', actor.id)
        .eq('view_key', caseFolderKey(String(workspaceId)))
        .maybeSingle();
      if (prefs.error) throw prefs.error;
      const folder = readCaseFolders(prefs.data?.custom_filters).find((f) => f.id === folderId);
      if (!folder)
        throw new CaseRuntimeError('CASE_INPUT_INVALID', 'La carpeta ya no está disponible.', 422);
      query.in(
        'id',
        folder.caseIds.length ? folder.caseIds : ['00000000-0000-0000-0000-000000000000']
      );
    }
    if (filters.category) query.eq('case_type', filters.category);
    if (filters.subtype) query.eq('case_subtype', filters.subtype);
    if (filters.responsible === 'me' || filters.scope === 'mine') {
      const assignments = await Promise.all(
        ['case_file_requirements', 'case_file_forms'].map((table) =>
          service
            .from(table)
            .select('case_file_id')
            .eq('workspace_id', workspaceId)
            .eq('reviewer_user_id', actor.id)
        )
      );
      for (const assignment of assignments) if (assignment.error) throw assignment.error;
      const assignedIds = [
        ...new Set(
          assignments.flatMap((result) => (result.data || []).map((row) => row.case_file_id))
        ),
      ];
      query.or(
        [
          `owner_user_id.eq.${actor.id}`,
          `runtime_assignments->>approver.eq.${actor.id}`,
          `runtime_assignments->>closer.eq.${actor.id}`,
          ...(assignedIds.length ? [`id.in.(${assignedIds.join(',')})`] : []),
        ].join(',')
      );
    }
    if (filters.scope === 'favorites')
      query.in('id', favoriteIds.length ? favoriteIds : ['00000000-0000-0000-0000-000000000000']);
    if (['active', 'due'].includes(filters.scope)) query.not('status', 'in', '(sealed,cancelled)');
    if (filters.scope === 'due')
      query
        .gte('target_close_at', new Date().toISOString())
        .lte('target_close_at', new Date(Date.now() + 72 * 3600000).toISOString());
    if (filters.priority) query.eq('priority', filters.priority);
    if (filters.access) query.eq('case_launches.access_mode', filters.access);
    if (filters.tag) query.contains('tags', [filters.tag]);
    if (scheduled)
      query
        .gt('case_launches.scheduled_at', new Date().toISOString())
        .not('status', 'in', '(sealed,cancelled)');
    const template = p.get('tipo');
    if (template) {
      if (!isUuid(template))
        throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Tipo inválido.', 422);
      query.eq('template_id', template);
    }
    const state = p.get('estado');
    if (state && state !== 'all') {
      if (!Object.hasOwn(CASE_STATUS_META, state))
        throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Estado inválido.', 422);
      query.eq('status', state);
    }
    const q = (p.get('q') || '')
      .trim()
      .slice(0, 120)
      .replace(/[%_,().\\]/g, ' ');
    if (q) query.or(`title.ilike.%${q}%,folio.ilike.%${q}%,subject_name.ilike.%${q}%`);
    for (const [field, op] of [
      ['desde', 'gte'],
      ['hasta', 'lte'],
    ] as const) {
      const date = p.get(field);
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
          throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Fecha inválida.', 422);
        query[op](filters.dateField, `${date}T${op === 'gte' ? '00:00:00' : '23:59:59.999'}Z`);
      }
    }
    const result = await query
      .order(p.get('orden') === 'name' ? 'title' : filters.dateField, {
        ascending: ['oldest', 'name'].includes(p.get('orden') || ''),
      })
      .order('id')
      .range((page - 1) * size, page * size - 1);
    if (result.error) throw result.error;
    if (countOnly)
      return NextResponse.json({ data: { total: result.count || 0 } }, { headers: runtimeHeaders });
    const records = (result.data || []) as unknown as CaseListRecord[];
    const ids = records.map((r) => r.id);
    const [
      launches,
      participants,
      templates,
      requirementReviewers,
      formReviewers,
      invitations,
      total,
      completed,
      observed,
      active,
      tagRows,
    ] = await Promise.all([
      ids.length
        ? service
            .from('case_launches')
            .select(
              'case_file_id,access_mode,signature_type,scheduled_at,expiration_hours,require_liveness,timezone'
            )
            .in('case_file_id', ids)
        : { data: [], error: null },
      ids.length
        ? service
            .from('case_file_participants')
            .select('case_file_id,id,name,email,role')
            .in('case_file_id', ids)
            .eq('workspace_id', workspaceId)
        : { data: [], error: null },
      service
        .from('case_file_templates')
        .select('id,name,status')
        .eq('workspace_id', workspaceId)
        .order('name'),
      ids.length
        ? service
            .from('case_file_requirements')
            .select('case_file_id,reviewer_user_id')
            .in('case_file_id', ids)
            .eq('workspace_id', workspaceId)
        : { data: [], error: null },
      ids.length
        ? service
            .from('case_file_forms')
            .select('case_file_id,reviewer_user_id')
            .in('case_file_id', ids)
            .eq('workspace_id', workspaceId)
        : { data: [], error: null },
      ids.length
        ? service
            .from('case_participant_invitations')
            .select('id,case_file_id,participant_id,generation,delivery_status,revoked_at')
            .in('case_file_id', ids)
            .order('generation', { ascending: false })
        : { data: [], error: null },
      service
        .from('case_files')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
      service
        .from('case_files')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'sealed'),
      service
        .from('case_files')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'observed'),
      service
        .from('case_files')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .not('status', 'in', '(sealed,cancelled)'),
      service
        .from('case_files')
        .select('tags,case_type,case_subtype')
        .eq('workspace_id', workspaceId),
    ]);
    for (const r of [
      launches,
      participants,
      templates,
      requirementReviewers,
      formReviewers,
      invitations,
      total,
      completed,
      observed,
      active,
      tagRows,
    ])
      if (r.error) throw r.error;
    const reviewerRows = [...(requirementReviewers.data || []), ...(formReviewers.data || [])];
    const reviewersFor = (id: string) =>
      reviewerRows
        .filter((row) => row.case_file_id === id)
        .map((row) => row.reviewer_user_id as string | null);
    const profileIds = [
      ...new Set(
        records.flatMap((row) => [
          ...caseResponsibleIds(row, reviewersFor(row.id)),
          ...(row.created_by ? [row.created_by] : []),
        ])
      ),
    ];
    const profiles = profileIds.length
      ? await service.from('user_profiles').select('id,full_name').in('id', profileIds)
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const latest = [
      ...new Map(
        (invitations.data || [])
          .slice()
          .reverse()
          .map((i) => [i.participant_id, i])
      ).values(),
    ];
    const codeIds = latest.map((i) => i.id),
      codes = codeIds.length
        ? await service
            .from('case_invitation_codes')
            .select('invitation_id,sent_at')
            .in('invitation_id', codeIds)
        : { data: [], error: null };
    if (codes.error) throw codes.error;
    return NextResponse.json(
      {
        data: {
          items: records.map((r) => {
            const launch = launches.data?.find((v) => v.case_file_id === r.id) || null;
            const people = latest.filter((i) => i.case_file_id === r.id);
            return {
              ...r,
              favorite: favoriteIds.includes(r.id),
              isScheduled:
                !!launch?.scheduled_at &&
                Date.parse(launch.scheduled_at) > Date.now() &&
                !['sealed', 'cancelled'].includes(r.status),
              canManage:
                r.owner_user_id === actor.id || ['owner', 'admin'].includes(membership.role),
              delivery: {
                total: people.length,
                sent: people.filter(
                  (i) =>
                    !i.revoked_at &&
                    i.delivery_status === 'sent' &&
                    (!codes.data?.some((k) => k.invitation_id === i.id) ||
                      codes.data?.some((k) => k.invitation_id === i.id && k.sent_at))
                ).length,
              },
              templateName:
                templates.data?.find((t) => t.id === r.template_id)?.name || r.case_type,
              ...casePeopleNames(r, reviewersFor(r.id), profiles.data || []),
              participants: participants.data?.filter((v) => v.case_file_id === r.id) || [],
              launch: launches.data?.find((v) => v.case_file_id === r.id) || null,
            };
          }),
          total: result.count || 0,
          page,
          pageSize: size,
          templates: templates.data || [],
          tags: [
            ...new Set((tagRows.data || []).flatMap((r) => (r.tags || []) as string[])),
          ].sort(),
          classifications: (tagRows.data || []).map((r) => ({
            category: r.case_type,
            subtype: r.case_subtype,
          })),
          stats: {
            total: total.count || 0,
            completed: completed.count || 0,
            observed: observed.count || 0,
            active: active.count || 0,
          },
        },
      },
      { headers: runtimeHeaders }
    );
  } catch (cause) {
    const f = runtimeFailure(cause);
    return NextResponse.json(f.body, { status: f.status, headers: runtimeHeaders });
  }
}
