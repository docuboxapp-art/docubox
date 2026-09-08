import { NextRequest, NextResponse } from 'next/server';
import { transcription } from '@rocketnew/llm-sdk';
import { buildLuciaAuthorizationContext } from '@/lib/ai/luciaAuthorization';
import { saveQueryLog } from '@/lib/ai/luciaQueries';
import {
  AI_BODY_LIMITS,
  AI_PROVIDER,
  aiErrorResponse,
  enforceAiRateLimits,
  rejectOversizedRequest,
  requireAiUser,
  TRANSCRIPTION_MODEL,
} from '@/lib/ai/security';

const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav']);

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const { user } = await requireAiUser(request);
    if (rejectOversizedRequest(request, AI_BODY_LIMITS.audio + 128 * 1024)) {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    const formData = await request.formData();
    const provider = String(formData.get('provider') || '');
    const model = String(formData.get('model') || '');
    const workspaceId = String(formData.get('workspaceId') || '');
    const file = formData.get('file');
    if (provider !== AI_PROVIDER || model !== TRANSCRIPTION_MODEL) {
      return NextResponse.json({ error: 'AI_MODEL_NOT_ALLOWED' }, { status: 400 });
    }
    if (!(file instanceof File) || !workspaceId) {
      return NextResponse.json({ error: 'INVALID_TRANSCRIPTION_REQUEST' }, { status: 400 });
    }
    if (file.size > AI_BODY_LIMITS.audio || !AUDIO_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'INVALID_AUDIO_FILE' }, { status: 413 });
    }

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
      route: '/api/ai/speech-to-text',
      userId: user.id,
      workspaceId,
      limit: 12,
    });

    const result = await transcription({
      model: TRANSCRIPTION_MODEL,
      file,
      language: 'es',
      api_key: process.env.OPENAI_API_KEY!,
    });
    await saveQueryLog({
      workspaceId,
      userId: user.id,
      question: '[audio transcription request]',
      intent: 'speech_to_text',
      scope: 'workspace',
      route: '/api/ai/speech-to-text',
      contextUsed: { mime_type: file.type, size_bytes: file.size },
      responseText: '[transcription omitted from audit log]',
      durationMs: Date.now() - startedAt,
      hasEvidence: true,
    });
    return NextResponse.json(result);
  } catch (error) {
    const formatted = aiErrorResponse(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
