import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  caseIdentity,
  caseSnapshot,
  CaseRuntimeError,
  isUuid,
  rows,
  runtimeFailure,
  runtimeHeaders,
} from '@/lib/case-files/runtime.server';
import {
  parseStoredCaseTemplate,
  type StoredCaseTemplate,
} from '@/lib/case-files/template-builder';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const actor = await caseIdentity(request),
      service = createServiceClient();
    const templateId = request.nextUrl.searchParams.get('templateId');
    const caseId = request.nextUrl.searchParams.get('caseId');
    let workspaceId: string, draft, subjectUser: unknown, subjectEmail: string | undefined;
    if (isUuid(caseId)) {
      const snapshot = await caseSnapshot(service, caseId, actor.id);
      workspaceId = String(snapshot.case.workspace_id);
      draft = parseStoredCaseTemplate({
        ...snapshot.template,
        status: 'active',
      } as StoredCaseTemplate);
      subjectUser = rows(snapshot.participants).find(
        (value) => value.id === snapshot.case.runtime_subject_id
      )?.user_id;
      const subject = await service
        .from('case_file_participants')
        .select('email,user_id')
        .eq('id', snapshot.case.runtime_subject_id)
        .eq('case_file_id', caseId)
        .single();
      if (subject.error) throw subject.error;
      subjectEmail = subject.data.email || undefined;
      if (!subjectEmail && subject.data.user_id) {
        const user = await service.auth.admin.getUserById(subject.data.user_id);
        if (user.error) throw user.error;
        subjectEmail = user.data.user?.email;
      }
    } else {
      if (!isUuid(templateId))
        throw new CaseRuntimeError(
          'CASE_TEMPLATE_INVALID',
          'Selecciona un tipo de expediente.',
          422
        );
      const template = await service
        .from('case_file_templates')
        .select('*')
        .eq('id', templateId)
        .eq('status', 'active')
        .maybeSingle();
      if (template.error) throw template.error;
      if (!template.data)
        throw new CaseRuntimeError('CASE_TEMPLATE_INVALID', 'El tipo no está disponible.', 404);
      workspaceId = template.data.workspace_id;
      const version = await service
        .from('case_file_template_versions')
        .select('snapshot')
        .eq('template_id', templateId)
        .eq('version', template.data.publication_version)
        .maybeSingle();
      if (version.error) throw version.error;
      if (!version.data)
        throw new CaseRuntimeError(
          'CASE_POLICY_REQUIRED',
          'Publica el tipo de expediente antes de lanzarlo.',
          422
        );
      draft = parseStoredCaseTemplate({
        ...version.data.snapshot,
        status: 'active',
      } as StoredCaseTemplate);
    }
    const membership = await service
      .from('workspace_members')
      .select('user_id,role,status,access_expires_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active');
    if (membership.error) throw membership.error;
    const members = (membership.data || []).filter(
      (value) => !value.access_expires_at || Date.parse(value.access_expires_at) > Date.now()
    );
    const self = members.find((value) => value.user_id === actor.id);
    if (!self) throw new CaseRuntimeError('CASE_ACCESS_DENIED', 'No tienes acceso activo.', 403);
    const profile = await service
      .from('user_profiles')
      .select('id,full_name,email')
      .in(
        'id',
        members.map((member) => member.user_id)
      );
    if (profile.error) throw profile.error;
    const workspace = await service
      .from('workspaces')
      .select('organization_settings')
      .eq('id', workspaceId)
      .single();
    if (workspace.error) throw workspace.error;
    const documentsQuery = service
      .from('documentos')
      .select('id,nombre,estado,source_template_id')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .not('estado', 'in', '(cancelado,rechazado,vencido)')
      .order('updated_at', { ascending: false })
      .limit(100);
    if (!['owner', 'admin'].includes(self.role)) documentsQuery.eq('owner_id', actor.id);
    const documents = caseId ? await documentsQuery : { data: [], error: null };
    if (documents.error) throw documents.error;
    const formIds = draft.sections
      .flatMap((section) => section.items)
      .filter((item) => item.kind === 'form' && item.sourceId)
      .map((item) => item.sourceId!);
    const responseQuery = service
      .from('form_responses')
      .select('id,template_id,folio,submitted_at')
      .eq('workspace_id', workspaceId)
      .in('template_id', formIds)
      .not('submitted_at', 'is', null)
      .not('pdf_output_hash', 'is', null)
      .limit(100);
    const responses =
      formIds.length && (subjectEmail || subjectUser)
        ? await (subjectEmail
            ? responseQuery.eq('respondent_email', subjectEmail.toLowerCase())
            : responseQuery.eq('respondent_user_id', subjectUser))
        : { data: [], error: null };
    if (responses.error) throw responses.error;
    const signatureSources = formIds.length
      ? await service
          .from('form_templates')
          .select('id,allowed_signature_types,requires_signature')
          .in('id', formIds)
          .eq('workspace_id', workspaceId)
      : { data: [], error: null };
    if (signatureSources.error) throw signatureSources.error;
    const documentTemplateIds = draft.sections
      .flatMap((s) => s.items)
      .filter((i) => i.kind === 'document_template' && i.sourceId)
      .map((i) => i.sourceId!);
    const documentMethods = documentTemplateIds.length
      ? await service
          .from('plantillas')
          .select('requires_efirma')
          .in('id', documentTemplateIds)
          .eq('workspace_id', workspaceId)
      : { data: [], error: null };
    if (documentMethods.error) throw documentMethods.error;
    const signatureOptions = ['click_sign', 'autografa_digital', 'efirma_sat'].filter(
      (method) =>
        (!documentMethods.data?.some((d) => d.requires_efirma) || method === 'efirma_sat') &&
        (signatureSources.data || [])
          .filter(
            (f) =>
              f.requires_signature ||
              draft.sections.some((section) =>
                section.items.some(
                  (item) => item.kind === 'form' && item.sourceId === f.id && item.requiresSignature
                )
              )
          )
          .every((f) => f.allowed_signature_types?.includes(method))
    );
    const verifications = subjectUser
      ? await service
          .from('enrollment_results')
          .select('id,created_at')
          .eq('user_id', subjectUser)
          .eq('status', 'completed')
          .limit(20)
      : { data: [], error: null };
    if (verifications.error) throw verifications.error;
    return NextResponse.json(
      {
        data: {
          actorId: actor.id,
          workspaceId,
          templateId,
          title: draft.name,
          description: draft.description,
          category: draft.caseType,
          sectionCount: draft.sections.length,
          verificationCount: draft.verifications.length,
          separationOfDuties:
            workspace.data.organization_settings?.case_review?.separationOfDuties === true,
          items: draft.sections
            .flatMap((section) => section.items)
            .map((item) => ({
              id: item.id,
              title: item.title,
              kind: item.kind,
              requiresReview: item.requiresReview,
              reviewerRole: item.reviewerRole,
            })),
          policy: draft.reviewPolicy,
          signatureOptions,
          members: members.map((member) => ({
            id: member.user_id,
            role: member.role,
            email: profile.data?.find((value) => value.id === member.user_id)?.email || '',
            name:
              profile.data?.find((value) => value.id === member.user_id)?.full_name ||
              (member.user_id === actor.id ? 'Mi cuenta' : 'Miembro del espacio'),
          })),
          documents: documents.data,
          responses: responses.data,
          verifications: verifications.data,
        },
      },
      { headers: runtimeHeaders }
    );
  } catch (error) {
    const failure = runtimeFailure(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: runtimeHeaders });
  }
}
