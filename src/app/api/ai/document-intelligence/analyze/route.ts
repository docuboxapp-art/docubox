import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildLuciaAuthorizationContext } from '@/lib/ai/luciaAuthorization';
import {
  DOCUMENT_INTELLIGENCE_ANALYSIS_TYPES,
  DocumentIntelligenceError,
  buildDocumentIntelligenceProfile,
  checkDocumentCompleteness,
  classifyDocument,
  detectDocumentObligations,
  extractStructuredFields,
} from '@/lib/ai/documentIntelligence';
import {
  AI_BODY_LIMITS,
  aiErrorResponse,
  enforceAiRateLimits,
  readLimitedJson,
  requireAiUser,
} from '@/lib/ai/security';
import {
  DOCUMENT_INTELLIGENCE_DISABLED_MESSAGE,
  isDocumentIntelligenceEnabled,
} from '@/lib/ai/documentIntelligenceFeature';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    workspaceId: z.string().uuid(),
    documentId: z.string().uuid(),
    analysisTypes: z.array(z.enum(DOCUMENT_INTELLIGENCE_ANALYSIS_TYPES)).min(1).max(6),
  })
  .strict();

function errorResponse(error: unknown) {
  if (error instanceof DocumentIntelligenceError) {
    return NextResponse.json({ error: error.code }, { status: error.status });
  }
  const formatted = aiErrorResponse(error);
  return NextResponse.json(formatted.body, { status: formatted.status });
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAiUser(request);
    if (!isDocumentIntelligenceEnabled()) {
      return NextResponse.json(
        {
          error: 'DOCUMENT_INTELLIGENCE_DISABLED',
          message: DOCUMENT_INTELLIGENCE_DISABLED_MESSAGE,
        },
        { status: 503 }
      );
    }
    const parsed = bodySchema.safeParse(
      await readLimitedJson<unknown>(request, AI_BODY_LIMITS.ask)
    );
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_DOCUMENT_INTELLIGENCE_REQUEST' }, { status: 400 });
    }
    const { workspaceId, documentId } = parsed.data;
    const analysisTypes = [...new Set(parsed.data.analysisTypes)];
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
      route: '/api/ai/document-intelligence/analyze',
      userId: user.id,
      workspaceId,
      limit: 6,
      windowSeconds: 60,
    });

    const context = { authorization };
    const results: Record<string, unknown> = {};
    let generatedProfile: Awaited<ReturnType<typeof buildDocumentIntelligenceProfile>> | null =
      null;
    if (
      analysisTypes.includes('classification') ||
      analysisTypes.includes('metadata_suggestions')
    ) {
      const classification = await classifyDocument(documentId, workspaceId, user.id, context);
      if (analysisTypes.includes('classification')) results.classification = classification;
      if (analysisTypes.includes('metadata_suggestions')) {
        generatedProfile = await buildDocumentIntelligenceProfile(
          documentId,
          workspaceId,
          user.id,
          context
        );
        results.metadata_suggestions = {
          title: generatedProfile.title_suggestion,
          document_type: classification.detected_document_type,
          category: classification.detected_document_category,
          folder: classification.suggested_folder,
          tags: classification.suggested_tags,
          sensitivity: classification.sensitivity,
          retention_category: classification.retention_category,
          applied: false,
        };
      }
    }
    if (analysisTypes.includes('fields')) {
      results.fields = await extractStructuredFields(documentId, workspaceId, user.id, context);
    }
    if (analysisTypes.includes('obligations')) {
      results.obligations = await detectDocumentObligations(
        documentId,
        workspaceId,
        user.id,
        context
      );
    }
    if (analysisTypes.includes('completeness')) {
      results.completeness = await checkDocumentCompleteness(
        documentId,
        workspaceId,
        user.id,
        context
      );
    }
    if (analysisTypes.includes('profile')) {
      results.profile =
        generatedProfile ||
        (await buildDocumentIntelligenceProfile(documentId, workspaceId, user.id, context));
    }

    return NextResponse.json({
      success: true,
      documentId,
      analysisTypes,
      results,
      writesAppliedToDocument: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
