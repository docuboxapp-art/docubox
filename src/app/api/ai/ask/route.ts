import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { completion } from '@rocketnew/llm-sdk';
import type { User } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeCollaborationAccess } from '@/lib/collaboration/domain';
import { buildRouteContext, classifyIntent } from '@/lib/ai/luciaIntentClassifier';
import { LUCIA_CAPABILITY_VERSION, resolveLuciaCapability } from '@/lib/ai/moduleCapabilities';
import { buildLuciaAuthorizationContext } from '@/lib/ai/luciaAuthorization';
import {
  buildRagContext,
  buildStructuredContext,
  buildUserContext,
  getSpecializedContextError,
  saveQueryLog,
} from '@/lib/ai/luciaQueries';
import {
  buildEvidenceSummary,
  checkEvidenceForIntent,
  DOCUMENT_RAG_INTENTS,
  NO_DOCUMENT_CONTENT_RESPONSE,
  NO_EVIDENCE_RESPONSE,
  postValidateAnswerAgainstEvidence,
} from '@/lib/ai/evidence';
import {
  AI_BODY_LIMITS,
  AI_PROVIDER,
  aiErrorResponse,
  enforceAiRateLimits,
  estimateAiCost,
  LUCIA_MODEL,
  LUCIA_PROMPT_VERSION,
  readLimitedJson,
  redactCapabilityFromRoute,
  redactSensitiveText,
  requireAiUser,
} from '@/lib/ai/security';
import { DOCUMENT_INTELLIGENCE_DISABLED_MESSAGE } from '@/lib/ai/documentIntelligenceFeature';

const LUCIA_SYSTEM_PROMPT = `Eres LucIA, asistente de consulta de Docubox.

Reglas de seguridad obligatorias:
1. Responde solo con hechos presentes en evidence_summary y el contexto autorizado.
2. No infieras documentos, personas, fechas, estados ni cantidades.
3. No reveles identificadores internos salvo que sean necesarios para identificar una fuente autorizada.
4. Nunca solicites ni reproduzcas contraseñas, OTP, biometría, certificados, llaves o tokens.
5. No afirmes haber ejecutado acciones: esta operación es exclusivamente de lectura.
6. Si el contexto no respalda una afirmación, responde exactamente: "${NO_EVIDENCE_RESPONSE}"
7. Responde en español claro y conciso.`;

const LUCIA_MODULE_DESIGN_PROMPT = `Eres LucIA, asistente de construcción de producto de Docubox.

El módulo indicado está en desarrollo. Responde únicamente con orientación funcional o técnica basada en su propósito, entidades previstas, fuentes planeadas y restricciones de seguridad incluidas en el contexto autorizado.
No afirmes que existen tablas, registros, permisos, estados o flujos que el contexto marque como planeados. No presentes datos demo como datos reales. No propongas ejecutar acciones ni solicites secretos, PII, tokens, OTP, biometría, certificados o llaves privadas. Distingue con claridad las recomendaciones de lo que ya existe. Responde en español claro y conciso.`;

const DEVELOPMENT_OPERATIONAL_UNAVAILABLE =
  'Este módulo todavía no tiene datos operativos disponibles en este entorno.';

type AskBody = {
  question?: unknown;
  workspaceId?: unknown;
  currentRoute?: unknown;
  documentId?: unknown;
  versionId?: unknown;
  expedienteId?: unknown;
  token?: unknown;
  mode?: unknown;
  sessionId?: unknown;
  provider?: unknown;
  model?: unknown;
  routeParams?: unknown;
  uiState?: unknown;
  suggestedPromptUsed?: unknown;
};

function stringValue(value: unknown, max = 200) {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

function stringRecord(value: unknown, maxEntries = 12) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .slice(0, maxEntries)
      .map(([key, item]) => [key.slice(0, 50), item.slice(0, 160)])
  );
}

function uiStateRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item))
      .slice(0, 16)
  );
}

function contextFailureStatus(errorCode: string) {
  if (
    ['WORKSPACE_ACCESS_DENIED', 'RESOURCE_ACCESS_DENIED', 'ENTITLEMENT_REQUIRED'].includes(
      errorCode
    )
  ) {
    return 403;
  }
  if (['RESOURCE_NOT_FOUND', 'RESOURCE_NOT_FOUND_OR_DENIED'].includes(errorCode)) return 404;
  if (['SCHEMA_UNAVAILABLE', 'SUPABASE_RPC_ERROR'].includes(errorCode)) return 503;
  if (errorCode === 'TOKEN_EXPIRED') return 401;
  return 200;
}

function contextFailureAnswer(errorCode: string) {
  if (errorCode === 'DOCUMENT_INTELLIGENCE_DISABLED') {
    return DOCUMENT_INTELLIGENCE_DISABLED_MESSAGE;
  }
  if (['WORKSPACE_ACCESS_DENIED', 'RESOURCE_ACCESS_DENIED'].includes(errorCode)) {
    return 'No tienes permiso para consultar esa información en este espacio de trabajo.';
  }
  if (errorCode === 'ENTITLEMENT_REQUIRED') {
    return 'Este módulo no está habilitado para el espacio de trabajo actual.';
  }
  if (['RESOURCE_NOT_FOUND', 'RESOURCE_NOT_FOUND_OR_DENIED'].includes(errorCode)) {
    return 'No encontré un recurso autorizado que coincida con la consulta.';
  }
  if (errorCode === 'RESOURCE_NOT_INDEXED') return NO_DOCUMENT_CONTENT_RESPONSE;
  if (errorCode === 'TOKEN_EXPIRED') return 'La sesión expiró. Inicia sesión nuevamente.';
  if (['SCHEMA_UNAVAILABLE', 'SUPABASE_RPC_ERROR'].includes(errorCode)) {
    return 'No pude consultar el contexto autorizado en este momento.';
  }
  return NO_EVIDENCE_RESPONSE;
}

function isDevelopmentSchemaUnavailable(context: unknown, errorCode: string) {
  if (errorCode !== 'SCHEMA_UNAVAILABLE' || !context || typeof context !== 'object') return false;
  const typed = context as Record<string, unknown>;
  return (
    typed.module_status === 'in_development' && typed.data_availability === 'schema_unavailable'
  );
}

function sensitiveResponse(userContext: Record<string, any>) {
  const profile = userContext.profile || {};
  switch (profile.requested_field) {
    case 'curp':
      return profile.curp
        ? `Tu CURP registrada en Docubox es: **${profile.curp}**.`
        : 'No encontré una CURP registrada en tu perfil de Docubox.';
    case 'rfc':
      return profile.rfc
        ? `Tu RFC registrado en Docubox es: **${profile.rfc}**.`
        : 'No encontré un RFC registrado en tu perfil de Docubox.';
    case 'telefono':
      return profile.telefono
        ? `Tu teléfono registrado en Docubox es: **${profile.telefono}**.`
        : 'No encontré un teléfono registrado en tu perfil de Docubox.';
    case 'domicilio': {
      const address = [
        [profile.calle, profile.num_exterior, profile.num_interior].filter(Boolean).join(' '),
        profile.colonia,
        profile.municipio,
        profile.estado,
        profile.codigo_postal ? `C.P. ${profile.codigo_postal}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return address
        ? `Tu domicilio registrado en Docubox es: **${address}**.`
        : 'No encontré un domicilio registrado en tu perfil de Docubox.';
    }
    default:
      return NO_EVIDENCE_RESPONSE;
  }
}

async function verifyCollaborationEntitlement(workspaceId: string, accessToken: string) {
  const { createClient } = await import('@supabase/supabase-js');
  const scoped = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );
  const result = await scoped.rpc('get_my_collaboration_access', { ws_id: workspaceId });
  if (result.error) return false;
  const access = normalizeCollaborationAccess(result.data);
  const entitlement = access.entitlements.collaboration_ai_assistant;
  return (
    access.accessible &&
    Boolean(entitlement && ['trialing', 'active', 'past_due'].includes(entitlement.status || ''))
  );
}

async function recordCollaborationUsage(workspaceId: string, userId: string, sessionId?: string) {
  await createServiceClient()
    .from('collaboration_usage_events')
    .insert({
      workspace_id: workspaceId,
      entitlement_key: 'collaboration_ai_assistant',
      meter_key: 'ai_requests',
      quantity: 1,
      idempotency_key: `lucia:${sessionId || 'sessionless'}:${randomUUID()}`,
      resource_type: 'lucia_query',
      metadata: { actor_user_id: userId },
    });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await readLimitedJson<AskBody>(request, AI_BODY_LIMITS.ask);
    const publicToken = stringValue(body.token, 2_048);
    const publicFlow = body.mode === 'public-token';

    let user: Pick<User, 'id' | 'email'> | null = null;
    let accessToken: string | undefined;
    if (!publicFlow) {
      const authenticated = await requireAiUser(request);
      user = authenticated.user;
      accessToken = authenticated.accessToken;
    } else if (!publicToken) {
      return NextResponse.json({ error: 'PUBLIC_TOKEN_REQUIRED' }, { status: 400 });
    }

    if (
      (body.provider && body.provider !== AI_PROVIDER) ||
      (body.model && body.model !== LUCIA_MODEL)
    ) {
      return NextResponse.json({ error: 'AI_MODEL_NOT_ALLOWED' }, { status: 400 });
    }

    const question = stringValue(body.question, 4_000)?.trim();
    const workspaceId = stringValue(body.workspaceId);
    const currentRoute = stringValue(body.currentRoute, 500) || '/';
    const documentId = stringValue(body.documentId);
    const versionId = stringValue(body.versionId);
    const expedienteId = stringValue(body.expedienteId);
    const sessionId = stringValue(body.sessionId);
    if (!question) return NextResponse.json({ error: 'QUESTION_REQUIRED' }, { status: 400 });

    const capability = resolveLuciaCapability(currentRoute);
    if (capability.accessMode === 'redirect_alias') {
      return NextResponse.json(
        { error: 'CANONICAL_ROUTE_REQUIRED', canonicalRoute: capability.canonicalRoute },
        { status: 409 }
      );
    }
    if (capability.luciaMode === 'disabled') {
      return NextResponse.json({ error: 'LUCIA_DISABLED_FOR_ROUTE' }, { status: 403 });
    }
    if (capability.luciaMode === 'deterministic_only') {
      return NextResponse.json({
        answer:
          'Esta pantalla usa una verificación determinista. Consulta el resultado y la evidencia visibles; LucIA no envía estos datos a un modelo generativo.',
        intent: 'deterministic_verification_help',
        mode: 'deterministic',
        sources: [],
        confidence: 'deterministic',
        telemetry: {
          inputTokens: 0,
          outputTokens: 0,
          model: null,
          latencyMs: Date.now() - startedAt,
        },
      });
    }
    if (capability.accessMode === 'public_token' && !publicFlow) {
      return NextResponse.json({ error: 'PUBLIC_TOKEN_MODE_REQUIRED' }, { status: 400 });
    }
    if (capability.accessMode === 'authenticated' && publicFlow) {
      return NextResponse.json({ error: 'AUTHENTICATED_MODE_REQUIRED' }, { status: 400 });
    }

    const scope = capability.scope;
    const authorization = await buildLuciaAuthorizationContext({
      user,
      workspaceId,
      documentId,
      token: publicFlow ? publicToken : null,
      currentRoute,
      scope,
    });
    if (authorization.denied_reason) {
      return NextResponse.json({ error: authorization.denied_reason }, { status: 403 });
    }
    const safeCurrentRoute = redactCapabilityFromRoute(currentRoute);
    const routeContext = buildRouteContext(
      safeCurrentRoute,
      scope,
      documentId,
      undefined,
      stringRecord(body.routeParams),
      uiStateRecord(body.uiState)
    );

    await enforceAiRateLimits({
      request,
      route: '/api/ai/ask',
      userId: authorization.user_id,
      workspaceId: authorization.workspace_id,
      tokenGrantId: authorization.token_grant_id,
      limit: publicFlow ? 10 : 30,
    });

    if (!publicFlow && !authorization.workspace_id) {
      return NextResponse.json({ error: 'WORKSPACE_REQUIRED' }, { status: 400 });
    }

    const isCollaborationRoute = safeCurrentRoute.startsWith('/colabora');
    if (isCollaborationRoute && accessToken && authorization.workspace_id) {
      const entitled = await verifyCollaborationEntitlement(
        authorization.workspace_id,
        accessToken
      );
      if (!entitled)
        return NextResponse.json({ error: 'COLLABORATION_AI_NOT_INCLUDED' }, { status: 402 });
    }

    const { intent, mode, extractedStatus, extractedUserName } = classifyIntent(
      question,
      routeContext
    );
    const effectiveWorkspaceId = authorization.workspace_id || '';

    const [userContext, structuredContext, ragContext] = await Promise.all([
      !publicFlow && user
        ? buildUserContext(user.id, effectiveWorkspaceId, intent, authorization, question)
        : Promise.resolve({}),
      effectiveWorkspaceId || publicFlow
        ? buildStructuredContext(
            question,
            intent,
            user?.id || '',
            effectiveWorkspaceId,
            authorization,
            {
              documentId,
              versionId,
              expedienteId,
              extractedStatus,
              extractedUserName,
              mode,
              accessToken,
              routeContext,
            }
          )
        : Promise.resolve(null),
      effectiveWorkspaceId && DOCUMENT_RAG_INTENTS.has(intent)
        ? buildRagContext(question, effectiveWorkspaceId, authorization, {
            documentId,
            versionId,
            accessToken,
            intent,
            routeContext,
          })
        : Promise.resolve([]),
    ]);

    const safeAuthorization =
      intent === 'general_help'
        ? { is_public_token_flow: authorization.is_public_token_flow }
        : {
            role: authorization.role,
            permissions: authorization.permissions,
            allowed_resource_ids: authorization.allowed_resource_ids,
            token_grant_id: authorization.token_grant_id,
            is_public_token_flow: authorization.is_public_token_flow,
          };
    const finalContext: Record<string, any> = {
      route_context: routeContext,
      authorization: safeAuthorization,
      user_context: intent === 'general_help' ? {} : userContext,
      structured_context: intent === 'general_help' ? null : structuredContext,
      rag_context: intent === 'general_help' ? [] : ragContext,
      intent,
    };
    const evidenceSummary = buildEvidenceSummary(finalContext);
    finalContext.evidence_summary = evidenceSummary;
    const hasEvidence = checkEvidenceForIntent(intent, finalContext);
    const telemetryContext = {
      moduleKey: routeContext.moduleKey,
      intent,
      route: safeCurrentRoute,
      resource_id:
        (structuredContext as any)?.resource_id ||
        Object.values(routeContext.currentResourceIds)[0] ||
        null,
      context_rpc: (structuredContext as any)?._context_meta?.rpc || null,
      context_latency_ms: (structuredContext as any)?._context_meta?.latency_ms || null,
      row_count: (structuredContext as any)?.row_count ?? null,
      context_error_code: getSpecializedContextError(structuredContext),
      canonicalRoute: routeContext.canonicalRoute,
      luciaMode: routeContext.luciaMode,
      capabilityVersion: LUCIA_CAPABILITY_VERSION,
      suggestedPromptUsed: body.suggestedPromptUsed === true,
      context_size: JSON.stringify(finalContext).length,
    };

    if (intent === 'user_profile_sensitive') {
      const answer = hasEvidence ? sensitiveResponse(userContext) : NO_EVIDENCE_RESPONSE;
      await saveQueryLog({
        workspaceId: authorization.workspace_id,
        userId: authorization.user_id,
        sessionId,
        question,
        intent,
        scope,
        route: safeCurrentRoute,
        documentIds: [],
        contextUsed: {
          ...telemetryContext,
          mode: 'direct_backend',
          sensitive_value_sent_to_model: false,
          evidence_status: hasEvidence ? 'verified' : 'missing',
        },
        responseText: answer,
        durationMs: Date.now() - startedAt,
        hasEvidence,
      });
      return NextResponse.json({
        answer,
        intent,
        mode: 'structured',
        sources: [],
        confidence: hasEvidence ? 'verified' : 'none',
        telemetry: {
          documentIds: [],
          chunkIds: [],
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: null,
          latencyMs: Date.now() - startedAt,
          errorCode: hasEvidence ? null : 'NO_EVIDENCE',
        },
      });
    }

    if (!hasEvidence) {
      const contextErrorCode = getSpecializedContextError(structuredContext);
      const evidenceErrorCode =
        contextErrorCode || (DOCUMENT_RAG_INTENTS.has(intent) ? 'RESOURCE_NOT_INDEXED' : 'NO_DATA');
      const developmentUnavailable = isDevelopmentSchemaUnavailable(
        structuredContext,
        evidenceErrorCode
      );
      const answer = developmentUnavailable
        ? DEVELOPMENT_OPERATIONAL_UNAVAILABLE
        : contextFailureAnswer(evidenceErrorCode);
      await saveQueryLog({
        workspaceId: authorization.workspace_id,
        userId: authorization.user_id,
        sessionId,
        question,
        intent,
        scope,
        route: safeCurrentRoute,
        documentIds: [],
        contextUsed: {
          ...telemetryContext,
          model_called: false,
          model_used: null,
          evidence_status:
            developmentUnavailable ||
            evidenceErrorCode === 'NO_DATA' ||
            evidenceErrorCode === 'RESOURCE_NOT_INDEXED'
              ? 'missing'
              : 'error',
        },
        responseText: answer,
        durationMs: Date.now() - startedAt,
        errorCode: evidenceErrorCode,
        hasEvidence: false,
      });
      return NextResponse.json(
        {
          answer,
          error:
            evidenceErrorCode === 'NO_DATA' || developmentUnavailable
              ? undefined
              : evidenceErrorCode,
          intent,
          mode,
          sources: [],
          confidence: 'none',
          telemetry: {
            documentIds: [],
            chunkIds: [],
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: null,
            latencyMs: Date.now() - startedAt,
            errorCode: evidenceErrorCode,
          },
        },
        { status: developmentUnavailable ? 200 : contextFailureStatus(evidenceErrorCode) }
      );
    }

    let aiResponse: Awaited<ReturnType<typeof completion>>;
    try {
      aiResponse = await completion({
        model: LUCIA_MODEL,
        messages: [
          {
            role: 'system' as const,
            content:
              intent === 'module_design_help' ? LUCIA_MODULE_DESIGN_PROMPT : LUCIA_SYSTEM_PROMPT,
          },
          {
            role: 'user' as const,
            content: `CONTEXTO AUTORIZADO:\n${JSON.stringify(finalContext)}\n\nCONSULTA:\n${redactSensitiveText(question, 4_000)}`,
          },
        ],
        stream: false,
        api_key: process.env.OPENAI_API_KEY!,
        max_tokens: 1_200,
      });
    } catch {
      await saveQueryLog({
        workspaceId: authorization.workspace_id,
        userId: authorization.user_id,
        sessionId,
        question,
        intent,
        scope,
        route: safeCurrentRoute,
        documentIds: evidenceSummary.document_ids,
        chunkIds: evidenceSummary.chunk_ids,
        sourceIds: evidenceSummary.source_ids,
        tokenGrantId: authorization.token_grant_id,
        contextUsed: {
          ...telemetryContext,
          prompt_version: LUCIA_PROMPT_VERSION,
          model_called: true,
          model_used: LUCIA_MODEL,
          evidence_status: intent === 'module_design_help' ? 'design_context' : 'verified',
        },
        responseText: 'AI_PROVIDER_ERROR',
        durationMs: Date.now() - startedAt,
        errorCode: 'AI_PROVIDER_ERROR',
        hasEvidence: true,
      });
      return NextResponse.json(
        { error: 'AI_PROVIDER_ERROR', answer: 'No pude generar la respuesta en este momento.' },
        { status: 502 }
      );
    }
    const rawAnswer = (aiResponse as any)?.choices?.[0]?.message?.content || NO_EVIDENCE_RESPONSE;
    const answer =
      intent === 'module_design_help'
        ? redactSensitiveText(rawAnswer, 12_000)
        : postValidateAnswerAgainstEvidence(rawAnswer, evidenceSummary);
    const inputTokens = (aiResponse as any)?.usage?.prompt_tokens;
    const outputTokens = (aiResponse as any)?.usage?.completion_tokens;
    const estimatedCostUsd = estimateAiCost(inputTokens, outputTokens);
    const usedDocumentIds = authorization.allowed_document_ids.filter((id) =>
      evidenceSummary.source_ids.includes(id)
    );
    evidenceSummary.document_ids = [
      ...new Set([...evidenceSummary.document_ids, ...usedDocumentIds]),
    ];

    await saveQueryLog({
      workspaceId: authorization.workspace_id,
      userId: authorization.user_id,
      sessionId,
      question,
      intent,
      scope,
      route: safeCurrentRoute,
      documentIds: evidenceSummary.document_ids,
      chunkIds: evidenceSummary.chunk_ids,
      sourceIds: evidenceSummary.source_ids,
      tokenGrantId: authorization.token_grant_id,
      contextUsed: {
        ...telemetryContext,
        prompt_version: LUCIA_PROMPT_VERSION,
        model_called: true,
        model_used: LUCIA_MODEL,
        evidence_status: intent === 'module_design_help' ? 'design_context' : 'verified',
      },
      responseText: answer,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startedAt,
      hasEvidence: true,
    });

    if (isCollaborationRoute && authorization.user_id && authorization.workspace_id) {
      await recordCollaborationUsage(authorization.workspace_id, authorization.user_id, sessionId);
    }

    return NextResponse.json({
      answer,
      intent,
      mode,
      sources: evidenceSummary.source_ids.map((id) => ({ id })),
      evidence: evidenceSummary.claims,
      confidence:
        answer === NO_EVIDENCE_RESPONSE
          ? 'none'
          : intent === 'module_design_help'
            ? 'contextual'
            : 'verified',
      contextSummary: {
        authorizedDocuments: authorization.allowed_document_ids.length,
        ragChunks: evidenceSummary.chunk_ids.length,
        hasEvidence: true,
      },
      telemetry: {
        documentIds: evidenceSummary.document_ids,
        chunkIds: evidenceSummary.chunk_ids,
        inputTokens: inputTokens || 0,
        outputTokens: outputTokens || 0,
        estimatedCostUsd,
        latencyMs: Date.now() - startedAt,
        errorCode: answer === NO_EVIDENCE_RESPONSE ? 'POST_VALIDATION_FAILED' : null,
      },
    });
  } catch (error) {
    const formatted = aiErrorResponse(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
