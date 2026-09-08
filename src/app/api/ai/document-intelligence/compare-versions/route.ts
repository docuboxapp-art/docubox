import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildLuciaAuthorizationContext } from '@/lib/ai/luciaAuthorization';
import { DocumentIntelligenceError, compareDocumentVersions } from '@/lib/ai/documentIntelligence';
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
    versionA: z.string().uuid(),
    versionB: z.string().uuid(),
  })
  .strict()
  .refine((value) => value.versionA !== value.versionB, { message: 'VERSIONS_MUST_DIFFER' });

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
      return NextResponse.json({ error: 'INVALID_VERSION_COMPARISON_REQUEST' }, { status: 400 });
    }
    const { workspaceId, documentId, versionA, versionB } = parsed.data;
    const authorization = await buildLuciaAuthorizationContext({
      user,
      workspaceId,
      documentId,
      currentRoute: `/documentos/${documentId}/versiones`,
    });
    if (authorization.denied_reason) {
      return NextResponse.json({ error: authorization.denied_reason }, { status: 403 });
    }
    await enforceAiRateLimits({
      request,
      route: '/api/ai/document-intelligence/compare-versions',
      userId: user.id,
      workspaceId,
      limit: 4,
      windowSeconds: 60,
    });
    const result = await compareDocumentVersions(
      documentId,
      versionA,
      versionB,
      workspaceId,
      user.id,
      { authorization }
    );
    return NextResponse.json({ success: true, documentId, versionA, versionB, result });
  } catch (error) {
    return errorResponse(error);
  }
}
