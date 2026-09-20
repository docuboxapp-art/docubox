import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildLuciaAuthorizationContext } from '@/lib/ai/luciaAuthorization';
import { aiErrorResponse, enforceAiRateLimits, requireAiUser } from '@/lib/ai/security';
import { createServiceClient } from '@/lib/supabase/server';
import { isPhaseEFeatureEnabled, PHASE_E_FEATURES } from '@/lib/phase-e/feature-flags';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    workspaceId: z.string().uuid(),
    factType: z.enum(['field', 'obligation', 'risk', 'classification']),
    factId: z.string().uuid(),
    reviewStatus: z.enum(['reviewed', 'confirmed', 'rejected', 'corrected']),
    reviewedValue: z.unknown().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

function failure(cause: unknown) {
  const formatted = aiErrorResponse(cause);
  return NextResponse.json(formatted.body, { status: formatted.status });
}

export async function POST(
  request: NextRequest,
  route: { params: Promise<{ documentId: string }> }
) {
  try {
    const { user } = await requireAiUser(request);
    const { documentId } = await route.params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_REVIEW' }, { status: 400 });
    const { workspaceId, factId, factType, reviewStatus, reviewedValue, note } = parsed.data;
    const authorization = await buildLuciaAuthorizationContext({
      user,
      workspaceId,
      documentId,
      currentRoute: `/visor-documento/${documentId}`,
    });
    if (authorization.denied_reason) {
      return NextResponse.json({ error: authorization.denied_reason }, { status: 403 });
    }
    await enforceAiRateLimits({
      request,
      route: '/api/ai/document-intelligence/review',
      userId: user.id,
      workspaceId,
      limit: 30,
      windowSeconds: 60,
    });
    const service = createServiceClient();
    if (!(await isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.contractualIntelligence))) {
      return NextResponse.json({ error: 'CONTRACTUAL_INTELLIGENCE_DISABLED' }, { status: 503 });
    }
    const table =
      factType === 'obligation'
        ? 'ai_document_obligations'
        : factType === 'classification'
          ? 'ai_document_classifications'
          : 'ai_document_extracted_fields';
    const fact = await service
      .from(table)
      .select('*')
      .eq('id', factId)
      .eq('workspace_id', workspaceId)
      .eq('document_id', documentId)
      .maybeSingle();
    if (fact.error) throw fact.error;
    if (!fact.data) return NextResponse.json({ error: 'FACT_NOT_FOUND' }, { status: 404 });
    if (reviewStatus === 'corrected' && reviewedValue === undefined) {
      return NextResponse.json({ error: 'CORRECTED_VALUE_REQUIRED' }, { status: 400 });
    }
    const inserted = await service
      .from('ai_document_fact_reviews')
      .insert({
        workspace_id: workspaceId,
        document_id: documentId,
        document_version_id: fact.data.document_version_id || null,
        analysis_run_id: fact.data.analysis_run_id || null,
        fact_type: factType,
        fact_id: factId,
        review_status: reviewStatus,
        extracted_value: fact.data,
        reviewed_value: reviewedValue === undefined ? null : reviewedValue,
        review_note: note || null,
        reviewed_by: user.id,
      })
      .select(
        'id,fact_type,fact_id,review_status,reviewed_value,review_note,reviewed_by,reviewed_at'
      )
      .single();
    if (inserted.error) throw inserted.error;
    await service.from('audit_trail').insert({
      documento_id: documentId,
      actor_id: user.id,
      action: `lucia_contractual_${reviewStatus}`,
      category: 'inteligencia_documental',
      details: { fact_type: factType, fact_id: factId, review_id: inserted.data.id },
    });
    return NextResponse.json({ success: true, data: inserted.data });
  } catch (cause) {
    return failure(cause);
  }
}
