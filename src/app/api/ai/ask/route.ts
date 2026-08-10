import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { classifyIntent, getScopeFromRoute, buildRouteContext } from '@/lib/ai/luciaIntentClassifier';
import { verifyWorkspaceMembership, buildUserContext, buildStructuredContext, buildRagContext, saveQueryLog,  } from '@/lib/ai/luciaQueries';
import { completion } from '@rocketnew/llm-sdk';

const publicAttempts = new Map<string, { count: number; expiresAt: number }>();

function allowPublicAiRequest(request: NextRequest, token: string) {
  const now = Date.now();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  const key = `${ip}:${token}`;
  const current = publicAttempts.get(key);
  if (!current || current.expiresAt <= now) {
    publicAttempts.set(key, { count: 1, expiresAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 10;
}

// ── Internal-data intents that require strict evidence check ──────────────
const INTERNAL_DATA_INTENTS = new Set([
  'user_profile',
  'user_profile_sensitive',
  'user_usage',
  'billing_status',
  'user_created_documents',
  'user_assigned_documents',
  'user_participations',
  'document_types_assigned',
  'document_status_search',
  'signature_status',
  'pending_tasks',
  'notifications_search',
  'activity_history',
  'expediente_search',
  'contacts_search',
  'templates_help',
  'forms_help',
  'configuration_security',
  'reports_analysis',
]);

// ── Sensitive intents: respond directly from backend, never send to OpenAI ──
const SENSITIVE_DIRECT_INTENTS = new Set([
  'user_profile_sensitive',
]);

// ── System prompt (strict mode) ───────────────────────────────────────────
const LUCIA_SYSTEM_PROMPT = `Eres LucIA, copiloto inteligente de Docubox.

Docubox es una plataforma de firmado digital con e.firma SAT, firma autógrafa, OTP, validación biométrica, documentos, participantes, expedientes, tareas, formularios, plantillas, reportes, facturación, configuración, perfil, flujos móviles y portal externo por token.

Tu función es ayudar al usuario dentro de la pantalla actual de Docubox.

Reglas obligatorias:
1. Responde únicamente con base en el CONTEXTO AUTORIZADO DE DOCUBOX recibido.
2. Usa route_context para entender la pantalla actual: screen_name, purpose, available_entities, available_fields y available_actions.
3. Usa user_context para perfil, workspace, consumo, participaciones y acciones del usuario.
4. Usa structured_context para documentos, estados, firmas, tareas, historial, notificaciones, facturación, contactos, plantillas y formularios.
5. Usa rag_context para contenido interno de documentos, cláusulas, resúmenes, obligaciones, riesgos, vigencia y penalizaciones.
6. No inventes documentos, fechas, estados, participantes, consumos, CURP, RFC, tareas, roles, cláusulas ni obligaciones.
7. NUNCA digas "no tengo acceso a Docubox", "no tengo acceso directo", "no puedo acceder a tu cuenta", "revisa directamente la plataforma", "no tengo acceso a tu historial", "comparte el documento", "no puedo ver tus datos" ni ninguna variante.
8. Si no hay evidencia en el contexto, responde exactamente: "No encontré información verificable en Docubox para responder eso."
9. Para datos sensibles (CURP, RFC, teléfono, domicilio fiscal), responde solo si están explícitos en user_context.profile.
10. Si el usuario solicita una acción que NO está en route_context.available_actions, responde: "No encontré esa acción disponible en esta sección de Docubox."
11. No inventes acciones ni campos que no estén en route_context.available_actions o route_context.available_fields.
12. Si hay acciones pendientes, preséntalas en orden de urgencia: vencidos primero, luego urgentes, luego por fecha límite.
13. Si hay varios documentos, preséntalos en lista numerada.
14. Si el usuario pide análisis legal, entrega observaciones preliminares y recomienda revisión profesional.
15. Para rutas públicas por token, responde solo sobre el recurso vinculado al token. Nunca consultes todo el workspace.
16. Responde en español profesional, claro y accionable.`;

/** Forbidden phrases that must never appear in the final answer */
const FORBIDDEN_PHRASES = [
  'no tengo acceso directo',
  'no puedo acceder a tu cuenta',
  'revisa directamente la plataforma',
  'no tengo acceso a docubox',
  'no tengo acceso a tu historial',
  'comparte el documento',
  'no tengo acceso al historial',
  'no puedo ver el historial',
  'no puedo ver tus datos',
  'no tengo acceso al sistema',
  'no tengo información sobre',
  'no tengo datos de',
  'consulta directamente',
  'revisa tu cuenta',
];

function sanitizeAnswer(answer: string): string {
  const lower = answer.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase)) {
      return 'No encontré información verificable en Docubox para responder eso.';
    }
  }
  return answer;
}

/**
 * Check if finalContext contains sufficient evidence to answer
 * a question about internal Docubox data.
 */
function checkEvidence(finalContext: Record<string, any>, intent: string): boolean {
  if (!INTERNAL_DATA_INTENTS.has(intent)) return true;

  const { user_context, structured_context, rag_context } = finalContext;

  if (structured_context) {
    if (Array.isArray(structured_context) && structured_context.length > 0) return true;
    if (
      typeof structured_context === 'object' &&
      !Array.isArray(structured_context) &&
      Object.keys(structured_context).length > 0
    ) return true;
  }

  if (Array.isArray(rag_context) && rag_context.length > 0) return true;

  if (user_context && typeof user_context === 'object') {
    const uc = user_context as Record<string, any>;

    if (intent === 'user_profile' && uc.userProfile) return true;
    if (intent === 'user_profile_sensitive' && uc.userProfile) return true;
    if (intent === 'user_usage' && uc.usage) return true;
    if (intent === 'billing_status' && uc.usage) return true;
    if (intent === 'workspace_info' && uc.workspace) return true;
    if (intent === 'configuration_security' && uc.workspace) return true;
    if (intent === 'reports_analysis' && (uc.usage || uc.createdDocuments)) return true;
    if (intent === 'notifications_search') {
      return Array.isArray(uc.notifications) && uc.notifications.length > 0;
    }
    if (intent === 'contacts_search') {
      return Array.isArray(uc.contacts) && uc.contacts.length > 0;
    }
    if (intent === 'templates_help') {
      return Array.isArray(uc.plantillas) && uc.plantillas.length > 0;
    }
    if (intent === 'forms_help') {
      return Array.isArray(uc.formTemplates) && uc.formTemplates.length > 0;
    }
    if (intent === 'user_created_documents') {
      return Array.isArray(uc.createdDocuments) && uc.createdDocuments.length > 0;
    }
    if (intent === 'user_assigned_documents') {
      return Array.isArray(uc.assignedDocuments) && uc.assignedDocuments.length > 0;
    }
    if (intent === 'user_participations') {
      return Array.isArray(uc.participations) && uc.participations.length > 0;
    }
    if (intent === 'document_types_assigned') {
      return (
        (Array.isArray(uc.documentTypesAssigned?.types) && uc.documentTypesAssigned.types.length > 0) ||
        (Array.isArray(uc.documentTypesAssigned?.groups) && uc.documentTypesAssigned.groups.length > 0)
      );
    }
    if (intent === 'pending_tasks') {
      const pa = uc.pendingActions;
      if (!pa) return false;
      return (
        (Array.isArray(pa.pendingSignatures) && pa.pendingSignatures.length > 0) ||
        (Array.isArray(pa.pendingApprovals) && pa.pendingApprovals.length > 0) ||
        (Array.isArray(pa.pendingReview) && pa.pendingReview.length > 0) ||
        (Array.isArray(pa.overdue) && pa.overdue.length > 0) ||
        (Array.isArray(pa.expiringSoon) && pa.expiringSoon.length > 0)
      );
    }
    if (intent === 'activity_history') {
      return Array.isArray(uc.activityHistory) && uc.activityHistory.length > 0;
    }
    if (intent === 'document_status_search' || intent === 'signature_status') {
      return false;
    }

    return Object.values(uc).some(
      v => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
    );
  }

  return false;
}

/**
 * Build a direct backend response for sensitive data (CURP, RFC, phone, fiscal address).
 * Never sends this data to OpenAI.
 */
function buildSensitiveDirectResponse(userContext: Record<string, any>, question: string): string {
  const profile = userContext.userProfile ?? {};
  const q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (q.includes('curp')) {
    return profile.curp
      ? `Tu CURP registrada en Docubox es: **${profile.curp}**.`
      : 'No encontré una CURP registrada en tu perfil de Docubox.';
  }
  if (q.includes('rfc')) {
    return profile.rfc
      ? `Tu RFC registrado en Docubox es: **${profile.rfc}**.`
      : 'No encontré un RFC registrado en tu perfil de Docubox.';
  }
  if (q.includes('telefono') || q.includes('teléfono') || q.includes('numero de telefono') || q.includes('número de teléfono')) {
    return profile.telefono
      ? `Tu teléfono registrado en Docubox es: **${profile.telefono}**.`
      : 'No encontré un teléfono registrado en tu perfil de Docubox.';
  }
  if (q.includes('domicilio') || q.includes('direccion') || q.includes('dirección') || q.includes('fiscal') || q.includes('codigo postal') || q.includes('código postal')) {
    const domicilio = [
      profile.calle ? `${profile.calle} ${profile.num_exterior ?? ''}${profile.num_interior ? ' Int. ' + profile.num_interior : ''}`.trim() : null,
      profile.colonia,
      profile.municipio,
      profile.estado,
      profile.codigo_postal ? `C.P. ${profile.codigo_postal}` : null,
    ].filter(Boolean).join(', ');
    return domicilio
      ? `Tu domicilio fiscal registrado en Docubox es: **${domicilio}**.`
      : 'No encontré un domicilio fiscal registrado en tu perfil de Docubox.';
  }
  if (q.includes('regimen') || q.includes('régimen')) {
    return profile.regimen_fiscal
      ? `Tu régimen fiscal registrado en Docubox es: **${profile.regimen_fiscal}**.`
      : 'No encontré un régimen fiscal registrado en tu perfil de Docubox.';
  }

  // Generic sensitive profile response
  const name = profile.full_name || [profile.nombre, profile.apellido_paterno].filter(Boolean).join(' ') || profile.email || 'N/D';
  const parts = [
    `**Nombre:** ${name}`,
    profile.email ? `**Email:** ${profile.email}` : null,
    profile.rfc ? `**RFC:** ${profile.rfc}` : '**RFC:** No registrado',
    profile.curp ? `**CURP:** ${profile.curp}` : '**CURP:** No registrada',
    profile.telefono ? `**Teléfono:** ${profile.telefono}` : '**Teléfono:** No registrado',
  ].filter(Boolean);
  return `Tus datos personales registrados en Docubox:\n\n${parts.join('\n')}`;
}

function extractSources(finalContext: Record<string, any>, intent: string): Array<Record<string, any>> {
  const sources: Array<Record<string, any>> = [];
  const uc = finalContext.user_context as Record<string, any> | undefined;
  const sc = finalContext.structured_context;

  if (Array.isArray(sc)) {
    for (const item of sc.slice(0, 10)) {
      if (item && typeof item === 'object') {
        sources.push({
          tabla: 'structured_context',
          documento: item.titulo ?? item.title ?? item.nombre ?? null,
          estado: item.estado ?? item.status ?? null,
          fecha: item.created_at ?? item.fecha ?? item.createdAt ?? null,
          usuario: item.actor_nombre ?? item.owner?.nombre_completo ?? item.owner?.nombre ?? null,
        });
      }
    }
  }

  if (uc) {
    if (intent === 'user_created_documents' && Array.isArray(uc.createdDocuments)) {
      for (const doc of uc.createdDocuments.slice(0, 5)) {
        sources.push({
          tabla: 'documentos',
          documento: doc.titulo ?? doc.title ?? doc.nombre ?? null,
          estado: doc.estado ?? doc.status ?? null,
          fecha: doc.created_at ?? doc.createdAt ?? null,
          usuario: null,
        });
      }
    }
    if (intent === 'user_assigned_documents' && Array.isArray(uc.assignedDocuments)) {
      for (const doc of uc.assignedDocuments.slice(0, 5)) {
        sources.push({
          tabla: 'documentos + participaciones',
          documento: doc.titulo ?? doc.title ?? doc.nombre ?? null,
          estado: doc.estado ?? doc.status ?? null,
          fecha: doc.created_at ?? doc.createdAt ?? null,
          usuario: doc.participationRole ?? null,
        });
      }
    }
    if (intent === 'activity_history' && Array.isArray(uc.activityHistory)) {
      for (const act of uc.activityHistory.slice(0, 5)) {
        sources.push({
          tabla: 'document_activity_log',
          documento: act.documento?.nombre ?? null,
          estado: act.action ?? null,
          fecha: act.created_at ?? null,
          usuario: act.actor_nombre ?? act.actor_email ?? null,
        });
      }
    }
  }

  if (Array.isArray(finalContext.rag_context)) {
    for (const chunk of finalContext.rag_context.slice(0, 3)) {
      if (chunk && typeof chunk === 'object') {
        sources.push({
          tabla: 'ai_document_chunks',
          documento: chunk.document_title ?? chunk.documentTitle ?? null,
          estado: null,
          fecha: chunk.created_at ?? null,
          usuario: null,
        });
      }
    }
  }

  return sources;
}

function postValidateAnswer(answer: string, finalContext: Record<string, any>): string {
  const uc = finalContext.user_context as Record<string, any> | undefined;
  const sc = finalContext.structured_context;

  const docCountMatch = answer.match(/encontré\s+(\d+)\s+registros?\s+verificados?/i);
  if (docCountMatch) {
    const claimedCount = parseInt(docCountMatch[1], 10);
    let actualCount = 0;
    if (Array.isArray(sc)) actualCount = sc.length;
    else if (uc) {
      const intent = finalContext.intent as string;
      if (intent === 'user_created_documents') actualCount = (uc.createdDocuments ?? []).length;
      else if (intent === 'user_assigned_documents') actualCount = (uc.assignedDocuments ?? []).length;
    }
    if (claimedCount > actualCount + 2 && actualCount === 0) {
      return 'No encontré información verificable en Docubox para responder eso.';
    }
  }
  return answer;
}

function isContextEmpty(finalContext: Record<string, any>): boolean {
  const { user_context, structured_context, rag_context } = finalContext;

  const ucEmpty =
    !user_context ||
    Object.keys(user_context).length === 0 ||
    Object.values(user_context).every(
      v => v === null || v === undefined || (Array.isArray(v) && v.length === 0)
    );

  const scEmpty =
    !structured_context ||
    (Array.isArray(structured_context) && structured_context.length === 0) ||
    (typeof structured_context === 'object' &&
      !Array.isArray(structured_context) &&
      Object.keys(structured_context).length === 0);

  const rcEmpty = !rag_context || (Array.isArray(rag_context) && rag_context.length === 0);

  return ucEmpty && scEmpty && rcEmpty;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // ── 1. Parse body ──────────────────────────────────────────
    const body = await request.json();
    const {
      question,
      workspaceId,
      currentRoute,
      documentId,
      expedienteId,
      token: publicToken,
      scope: clientScope,
      uiState,
      sessionId,
      mode: requestMode,
    } = body;

    if (!question) {
      return NextResponse.json(
        { error: 'Falta campo requerido: question' },
        { status: 400 }
      );
    }

    // ── 2. Detect if this is a public-token request ────────────
    const isPublicTokenRequest = requestMode === 'public-token' || (!workspaceId && !!publicToken);

    if (isPublicTokenRequest) {
      // ── PUBLIC TOKEN PATH: validate token, limit to token resource ──
      if (!publicToken) {
        return NextResponse.json({ error: 'Token requerido para rutas públicas' }, { status: 400 });
      }

      if (!allowPublicAiRequest(request, publicToken)) {
        return NextResponse.json({ error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' }, { status: 429 });
      }

      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceRoleKey) {
        return NextResponse.json({ error: 'El servicio no esta configurado.' }, { status: 503 });
      }

      const supabaseService = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey
      );

      // Resolve token to a resource (document, form, enrollment, etc.)
      let tokenContext: Record<string, any> = {};
      let tokenDocumentId: string | null = null;

      // Try enrollment tokens
      const { data: enrollToken } = await supabaseService
        .from('enrollment_tokens')
        .select('id, document_id, participant_id, status, expires_at')
        .eq('token', publicToken)
        .maybeSingle();

      if (enrollToken) {
        tokenContext = {
          type: 'enrollment',
          status: enrollToken.status,
          document_id: enrollToken.document_id,
          participant_id: enrollToken.participant_id,
          expires_at: enrollToken.expires_at,
        };
        tokenDocumentId = enrollToken.document_id;
      }

      // Try form tokens (mobile_upload_sessions)
      if (!tokenDocumentId) {
        const { data: uploadSession } = await supabaseService
          .from('mobile_upload_sessions')
          .select('id, status, expires_at, metadata')
          .eq('token', publicToken)
          .maybeSingle();

        if (uploadSession && new Date(uploadSession.expires_at).getTime() > Date.now()) {
          const uploadDocumentId = uploadSession.metadata?.document_id || null;
          tokenContext = {
            type: 'mobile_upload',
            status: uploadSession.status,
            document_id: uploadDocumentId,
            expires_at: uploadSession.expires_at,
          };
          tokenDocumentId = uploadDocumentId;
        }
      }

      // Try document participants (portal-participante tokens)
      if (!tokenDocumentId) {
        const { data: participant } = await supabaseService
          .from('document_participants')
          .select('id, document_id, nombre, email, rol, estado, token_acceso')
          .eq('token_acceso', publicToken)
          .maybeSingle();

        if (participant) {
          tokenContext = {
            type: 'participant_portal',
            participant_id: participant.id,
            document_id: participant.document_id,
            nombre: participant.nombre,
            email: participant.email,
            rol: participant.rol,
            estado: participant.estado,
          };
          tokenDocumentId = participant.document_id;
        }
      }

      // Fetch document info if we have a document_id
      let tokenDocumentInfo: Record<string, any> | null = null;
      if (tokenDocumentId) {
        const { data: doc } = await supabaseService
          .from('documentos')
          .select('id, titulo, estado, tipo_documento, fecha_limite, created_at')
          .eq('id', tokenDocumentId)
          .maybeSingle();
        tokenDocumentInfo = doc;
      }

      const scope = clientScope || getScopeFromRoute(currentRoute ?? '/');
      const routeContext = buildRouteContext(currentRoute ?? '/', scope, tokenDocumentId ?? undefined, publicToken);

      const finalContext = {
        route_context: routeContext,
        token_context: tokenContext,
        document_info: tokenDocumentInfo,
        user_context: null,
        structured_context: null,
        rag_context: [],
        intent: 'external_participant_help',
        permissions_summary: {
          mode: 'public-token',
          token: publicToken,
          scope,
          currentRoute: currentRoute ?? null,
          documentId: tokenDocumentId,
        },
      };

      console.log('LucIA [public-token] currentRoute', currentRoute);
      console.log('LucIA [public-token] scope', scope);
      console.log('LucIA [public-token] tokenContext', tokenContext);

      const hasTokenEvidence = !!tokenContext.type || !!tokenDocumentInfo;

      if (!hasTokenEvidence) {
        return NextResponse.json({
          answer: 'No encontré información verificable para responder eso con el acceso actual.',
          intent: 'external_participant_help',
          mode: 'public-token',
          sources: [],
          confidence: 'none',
        });
      }

      const publicMessages = [
        { role: 'system' as const, content: LUCIA_SYSTEM_PROMPT },
        {
          role: 'user' as const,
          content: `CONTEXTO AUTORIZADO DE DOCUBOX (ACCESO POR TOKEN PÚBLICO):\n${JSON.stringify(finalContext, null, 2)}\n\nPREGUNTA DEL USUARIO:\n${question}`,
        },
      ];

      const aiResponse = await completion({
        model: 'gpt-4o-mini',
        messages: publicMessages,
        stream: false,
        api_key: process.env.OPENAI_API_KEY!,
        max_tokens: 800,
      });

      const rawAnswer = (aiResponse as any)?.choices?.[0]?.message?.content || 'No se pudo generar una respuesta.';
      let responseText = sanitizeAnswer(rawAnswer);

      return NextResponse.json({
        answer: responseText,
        intent: 'external_participant_help',
        mode: 'public-token',
        sources: [],
        confidence: 'verified',
        contextSummary: { hasTokenContext: true, documentId: tokenDocumentId },
      });
    }

    // ── AUTHENTICATED PATH ─────────────────────────────────────
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: question, workspaceId' },
        { status: 400 }
      );
    }

    // ── 2. Validate auth via Supabase (userId from session, NOT from frontend) ──
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const bearerToken = authHeader.replace('Bearer ', '');
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser(bearerToken);
    if (authError || !user) {
      return NextResponse.json({ error: 'Token inválido o sesión expirada' }, { status: 401 });
    }

    const userId = user.id;

    // ── 3. Validate workspace membership ──────────────────────
    const isMember = await verifyWorkspaceMembership(workspaceId, userId);
    if (!isMember) {
      return NextResponse.json({ error: 'No tienes acceso a este workspace' }, { status: 403 });
    }

    // ── 4. Derive scope and route_context (structured object) ─
    const scope = clientScope || getScopeFromRoute(currentRoute ?? '');
    const routeContext = buildRouteContext(currentRoute ?? '/', scope, documentId, publicToken);

    // ── 5. Classify intent (route-aware) ──────────────────────
    const intentResult = classifyIntent(question, currentRoute ?? '');
    const { intent, mode, extractedStatus, extractedUserName } = intentResult;

    // ── Debug logs ────────────────────────────────────────────
    console.log('LucIA currentRoute', currentRoute);
    console.log('LucIA scope', scope);
    console.log('LucIA intent', intent);
    console.log('LucIA route_context', routeContext);
    console.log('LucIA uiState', uiState);

    // ── 6. Build all three context layers ─────────────────────
    const [userContext, structuredContext, ragContext] = await Promise.all([
      buildUserContext(userId, workspaceId).catch(err => {
        console.error('[LucIA] buildUserContext error:', err);
        return {};
      }),
      buildStructuredContext(question, intent, userId, workspaceId, {
        documentId,
        expedienteId,
        extractedStatus,
        extractedUserName,
        mode,
      }).catch(err => {
        console.error('[LucIA] buildStructuredContext error:', err);
        return null;
      }),
      buildRagContext(question, workspaceId, documentId).catch(err => {
        console.error('[LucIA] buildRagContext error:', err);
        return [];
      }),
    ]);

    console.log('LucIA user_context keys', Object.keys(userContext));
    console.log('LucIA structured_context', structuredContext);
    console.log('LucIA rag_context chunks', Array.isArray(ragContext) ? ragContext.length : 0);

    // ── 7. Assemble finalContext ───────────────────────────────
    const finalContext = {
      route_context: routeContext,
      user_context: userContext,
      structured_context: structuredContext,
      rag_context: ragContext,
      intent,
      permissions_summary: {
        userId,
        workspaceId,
        scope,
        currentRoute: currentRoute ?? null,
        documentId: documentId || null,
        expedienteId: expedienteId || null,
        intent,
        mode,
        uiState: uiState || null,
      },
    };

    // ── 8. Check evidence ──────────────────────────────────────
    const isDocumentViewerRagAction =
      scope === 'document_viewer' &&
      (intent === 'document_summary' || intent === 'legal_analysis' || intent === 'compliance_analysis' || intent === 'document_content_search');

    const hasEvidence = isDocumentViewerRagAction
      ? (Array.isArray(ragContext) && ragContext.length > 0) || !!documentId
      : checkEvidence(finalContext, intent);
    console.log('LucIA finalContext intent', intent);
    console.log('LucIA hasEvidence', hasEvidence);

    // ── 9. SENSITIVE DATA: respond directly from backend, never send to OpenAI ──
    if (SENSITIVE_DIRECT_INTENTS.has(intent)) {
      if (!userContext || !(userContext as any).userProfile) {
        return NextResponse.json({
          answer: 'No encontré información verificable en Docubox para responder eso.',
          intent,
          mode,
          sources: [],
          confidence: 'none',
          contextSummary: { structuredRecords: 0, ragChunks: 0, hasUserContext: false },
        });
      }
      const directAnswer = buildSensitiveDirectResponse(userContext as Record<string, any>, question);
      await saveQueryLog({
        workspaceId,
        userId,
        sessionId,
        question,
        intent,
        scope,
        documentId,
        contextUsed: { mode: 'direct_backend', hasEvidence: true, sensitiveData: true },
        responseText: directAnswer,
        durationMs: Date.now() - startTime,
      }).catch(err => console.error('[LucIA] Log save error:', err));

      return NextResponse.json({
        answer: directAnswer,
        intent,
        mode: 'structured',
        sources: [],
        confidence: 'verified',
        contextSummary: { structuredRecords: 0, ragChunks: 0, hasUserContext: true },
      });
    }

    // ── 10. Block OpenAI if no evidence for internal intents ──
    if (!hasEvidence) {
      return NextResponse.json({
        answer: 'No encontré información verificable en Docubox para responder eso.',
        intent,
        mode,
        sources: [],
        confidence: 'none',
        contextSummary: { structuredRecords: 0, ragChunks: 0, hasUserContext: false },
      });
    }

    // ── 11. Validate context is not completely empty ───────────
    if (isContextEmpty(finalContext) && !isDocumentViewerRagAction) {
      return NextResponse.json({
        answer: 'No encontré información disponible con tus permisos actuales.',
        intent,
        mode,
        sources: [],
        confidence: 'none',
        contextSummary: { structuredRecords: 0, ragChunks: 0, hasUserContext: false },
      });
    }

    // ── 12. Call OpenAI with full context ──────────────────────
    const messages = [
      { role: 'system' as const, content: LUCIA_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: `CONTEXTO AUTORIZADO DE DOCUBOX:\n${JSON.stringify(finalContext, null, 2)}\n\nPREGUNTA DEL USUARIO:\n${question}`,
      },
    ];

    const aiResponse = await completion({
      model: 'gpt-4o-mini',
      messages,
      stream: false,
      api_key: process.env.OPENAI_API_KEY!,
      max_tokens: 1500,
    });

    const rawAnswer =
      (aiResponse as any)?.choices?.[0]?.message?.content || 'No se pudo generar una respuesta.';

    let responseText = sanitizeAnswer(rawAnswer);
    responseText = postValidateAnswer(responseText, finalContext);

    const sources = extractSources(finalContext, intent);
    const tokensUsed = (aiResponse as any)?.usage?.total_tokens;
    const durationMs = Date.now() - startTime;

    // ── 13. Save query log ─────────────────────────────────────
    await saveQueryLog({
      workspaceId,
      userId,
      sessionId,
      question,
      intent,
      scope,
      documentId,
      contextUsed: {
        hasUserContext: Object.keys(userContext).length > 0,
        structuredRecords: Array.isArray(structuredContext)
          ? structuredContext.length
          : structuredContext ? 1 : 0,
        ragChunksCount: Array.isArray(ragContext) ? ragContext.length : 0,
        mode,
        hasEvidence,
        currentRoute: currentRoute ?? null,
        routeContext: {
          screen_name: routeContext.screen_name,
          available_actions: routeContext.available_actions,
        },
      },
      responseText,
      tokensUsed,
      durationMs,
    }).catch(err => console.error('[LucIA] Log save error:', err));

    return NextResponse.json({
      answer: responseText,
      intent,
      mode,
      sources,
      confidence: hasEvidence ? 'verified' : 'none',
      contextSummary: {
        structuredRecords: Array.isArray(structuredContext)
          ? structuredContext.length
          : structuredContext ? 1 : 0,
        ragChunks: Array.isArray(ragContext) ? ragContext.length : 0,
        hasUserContext: Object.keys(userContext).length > 0,
        ragActive: Array.isArray(ragContext) && ragContext.length > 0,
        screen: routeContext.screen_name,
      },
    });
  } catch (err) {
    console.error('[LucIA] /api/ai/ask error:', err);
    return NextResponse.json(
      {
        error: 'Error interno del servidor',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
