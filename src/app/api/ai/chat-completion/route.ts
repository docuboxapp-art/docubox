import { NextRequest, NextResponse } from 'next/server';
import { buildLuciaAuthorizationContext } from '@/lib/ai/luciaAuthorization';
import {
  AI_BODY_LIMITS,
  AI_PROVIDER,
  aiErrorResponse,
  enforceAiRateLimits,
  LUCIA_MODEL,
  readLimitedJson,
  requireAiUser,
} from '@/lib/ai/security';

type LegacyBody = { workspaceId?: unknown; provider?: unknown; model?: unknown };

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAiUser(request);
    const body = await readLimitedJson<LegacyBody>(request, AI_BODY_LIMITS.chat);
    if (body.provider !== AI_PROVIDER || body.model !== LUCIA_MODEL) {
      return NextResponse.json({ error: 'AI_MODEL_NOT_ALLOWED' }, { status: 400 });
    }
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null;
    const authorization = await buildLuciaAuthorizationContext({
      user,
      workspaceId,
      currentRoute: '/',
    });
    if (authorization.denied_reason) {
      return NextResponse.json({ error: authorization.denied_reason }, { status: 403 });
    }
    await enforceAiRateLimits({
      request,
      route: '/api/ai/chat-completion',
      userId: user.id,
      workspaceId,
    });
    return NextResponse.json(
      { error: 'GENERIC_AI_ENDPOINT_DISABLED', use: '/api/ai/ask' },
      { status: 410 }
    );
  } catch (error) {
    const formatted = aiErrorResponse(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
