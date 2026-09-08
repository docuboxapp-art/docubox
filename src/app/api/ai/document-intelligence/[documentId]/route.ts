import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildLuciaAuthorizationContext } from '@/lib/ai/luciaAuthorization';
import {
  DocumentIntelligenceError,
  getDocumentIntelligenceSummary,
} from '@/lib/ai/documentIntelligence';
import { aiErrorResponse, enforceAiRateLimits, requireAiUser } from '@/lib/ai/security';
import {
  DOCUMENT_INTELLIGENCE_DISABLED_MESSAGE,
  isDocumentIntelligenceEnabled,
} from '@/lib/ai/documentIntelligenceFeature';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof DocumentIntelligenceError) {
    return NextResponse.json({ error: error.code }, { status: error.status });
  }
  const formatted = aiErrorResponse(error);
  return NextResponse.json(formatted.body, { status: formatted.status });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
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
    const { documentId } = await context.params;
    const workspaceId = request.nextUrl.searchParams.get('workspaceId') || '';
    if (
      !z.string().uuid().safeParse(documentId).success ||
      !z.string().uuid().safeParse(workspaceId).success
    ) {
      return NextResponse.json({ error: 'DOCUMENT_AND_WORKSPACE_REQUIRED' }, { status: 400 });
    }
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
      route: '/api/ai/document-intelligence/read',
      userId: user.id,
      workspaceId,
      limit: 30,
      windowSeconds: 60,
    });
    const result = await getDocumentIntelligenceSummary(documentId, workspaceId, user.id, {
      authorization,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
