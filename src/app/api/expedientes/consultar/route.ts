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
export const runtime = 'nodejs';
type CaseListRecord = {
  id: string;
  title: string;
  folio: string;
  status: string;
  progress: number;
  template_id: string | null;
  case_type: string;
  subject_name: string;
  owner_user_id: string;
  updated_at: string;
  created_at: string;
  target_close_at: string | null;
};
export async function GET(request: NextRequest) {
  try {
    const actor = await caseIdentity(request),
      service = createServiceClient(),
      p = request.nextUrl.searchParams;
    const workspaceId = p.get('workspaceId');
    const membership = await requireCaseWorkspace(service, workspaceId, actor.id);
    const page = Math.max(1, Math.min(100000, Math.floor(Number(p.get('page')) || 1))),
      size = 20;
    const base =
      'id,title,folio,status,progress,template_id,case_type,subject_name,owner_user_id,updated_at,created_at,target_close_at';
    const scheduled = p.get('envio') === 'scheduled';
    const query = service
      .from('case_files')
      .select(base + (scheduled ? ',case_launches!inner(scheduled_at)' : ''), { count: 'exact' })
      .eq('workspace_id', workspaceId);
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
        query[op]('created_at', `${date}T${op === 'gte' ? '00:00:00' : '23:59:59.999'}Z`);
      }
    }
    const result = await query
      .order(p.get('orden') === 'name' ? 'title' : 'created_at', {
        ascending: ['oldest', 'name'].includes(p.get('orden') || ''),
      })
      .order('id')
      .range((page - 1) * size, page * size - 1);
    if (result.error) throw result.error;
    const records = (result.data || []) as unknown as CaseListRecord[];
    const ids = records.map((r) => r.id);
    const [
      launches,
      participants,
      templates,
      owners,
      invitations,
      total,
      completed,
      observed,
      active,
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
            .from('user_profiles')
            .select('id,full_name')
            .in('id', [...new Set(records.map((r) => r.owner_user_id).filter(Boolean))])
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
    ]);
    for (const r of [
      launches,
      participants,
      templates,
      owners,
      invitations,
      total,
      completed,
      observed,
      active,
    ])
      if (r.error) throw r.error;
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
              ownerName:
                owners.data?.find((o) => o.id === r.owner_user_id)?.full_name || 'Responsable',
              participants: participants.data?.filter((v) => v.case_file_id === r.id) || [],
              launch: launches.data?.find((v) => v.case_file_id === r.id) || null,
            };
          }),
          total: result.count || 0,
          page,
          pageSize: size,
          templates: templates.data || [],
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
