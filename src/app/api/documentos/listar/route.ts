import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient } from '@/lib/supabase/server';
import { isDefinitivelyInvalidAuthToken } from '@/lib/supabase/auth-verification';
import { isTemporaryDatabaseFailure } from '@/lib/supabase/backend-failure';
import { emitObservedEvent } from '@/lib/observability/events';
import { classifyTrashRetention } from '@/lib/documents/trash-retention';
import {
  evaluateDocumentDisposition,
  type DocumentLifecycleRecord,
} from '@/lib/documents/lifecycle-policy';
import { getTrashCountdown } from '@/lib/documents/trash-countdown';
import { verifyDocumentBearer } from '@/lib/documents/bootstrap-auth.server';

const DOC_SELECT =
  'id, nombre, descripcion, estado, etiquetas_ids, file_size, updated_at, ultimo_paso, is_favorite, fecha_vencimiento, scan_status, scan_threat, carpeta_id, created_at, fecha_completado, numero_oficio, folio_interno, ruta_guardado, priority, es_urgente, participantes, tipo_documento_id, tipo_documento:tipo_documento_id(nombre), source_template_id, source_form_response_id, deleted_at, owner_id, tiene_codigo_acceso, legal_hold, legal_hold_status, retention_status, retention_until, lifecycle_status, trashed_at, trashed_by, restore_until';
const WITHOUT_FORM_ORIGIN_SELECT = DOC_SELECT.replace(', source_form_response_id', '');
const LEGACY_DOC_SELECT = WITHOUT_FORM_ORIGIN_SELECT.replace(', source_template_id', '');

type ListedDocumentRow = DocumentLifecycleRecord & {
  id: string;
  [key: string]: unknown;
};

function isTemplateOriginColumnMissing(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
    /source_template_id/i.test(error.message || '') &&
    (error.code === 'PGRST204' || /schema cache|does not exist|column/i.test(error.message || ''))
  );
}

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const deadline = AbortSignal.timeout(20_000);
    // Authenticate user via Bearer token using anon client (proper JWT validation)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // Use anon client to validate the JWT properly
    const anonClient = createAnonClient(token, deadline);
    const {
      data: { user },
      error: authError,
    } = await verifyDocumentBearer(token, () => anonClient.auth.getUser(token));
    if (authError || !user) {
      const invalid = !authError || isDefinitivelyInvalidAuthToken(authError);
      return NextResponse.json(
        {
          error: invalid ? 'Token inválido o expirado' : 'Verificación temporalmente no disponible',
        },
        { status: invalid ? 401 : 503, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const dataStartedAt = performance.now();
    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get('tipo') || 'todos';

    const buildQuery = (columns: string) => {
      let query = anonClient.from('documentos').select(columns).eq('owner_id', user.id);

      if (tipo === 'papelera') {
        return query.not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
      }
      if (tipo === 'favoritos') {
        return query
          .eq('is_favorite', true)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false });
      }
      if (tipo === 'por_vencer') {
        const now = new Date();
        const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);
        return query
          .is('deleted_at', null)
          .not('fecha_vencimiento', 'is', null)
          .lte('fecha_vencimiento', in72h.toISOString())
          .gte('fecha_vencimiento', now.toISOString())
          .order('fecha_vencimiento', { ascending: true });
      }
      return query.is('deleted_at', null).order('updated_at', { ascending: false });
    };

    let result = await buildQuery(DOC_SELECT);
    if (result.error && /source_form_response_id/i.test(result.error.message || ''))
      result = await buildQuery(WITHOUT_FORM_ORIGIN_SELECT);
    if (isTemplateOriginColumnMissing(result.error)) result = await buildQuery(LEGACY_DOC_SELECT);
    const data = result.data as ListedDocumentRow[] | null;
    const error = result.error;

    if (error) {
      const temporary = isTemporaryDatabaseFailure(error, result.status);
      const status = temporary ? 503 : 500;
      emitObservedEvent({
        service: 'next',
        outcome: 'error',
        route: '/api/documentos/listar',
        status,
        code: error.code,
      });
      return NextResponse.json(
        {
          error: 'No fue posible cargar los documentos.',
          code: temporary ? 'DATA_API_UNAVAILABLE' : 'DOCUMENT_LIST_FAILED',
        },
        { status, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const documentIds = (data || []).map((document) => document.id);
    const formResponseIds = [
      ...new Set(
        (data || [])
          .map((document) => document.source_form_response_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ];
    const [holdHistory, formSources] = await Promise.all([
      documentIds.length
        ? anonClient
            .from('document_legal_holds')
            .select('document_id,status')
            .in('document_id', documentIds)
        : Promise.resolve({ data: [], error: null }),
      formResponseIds.length
        ? anonClient
            .from('form_responses')
            .select('id,form_templates(description,settings)')
            .in('id', formResponseIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (holdHistory.error) throw holdHistory.error;
    if (formSources.error) {
      emitObservedEvent({
        service: 'next',
        outcome: 'error',
        route: '/api/documentos/listar',
        code: formSources.error.code,
      });
    }
    const transformationStartedAt = performance.now();
    const formDescriptions = new Map<string, string | null>();
    for (const source of formSources.data || []) {
      const template = source.form_templates as {
        description?: string | null;
        settings?: { appearance?: { headerDescription?: string | null } } | null;
      } | null;
      formDescriptions.set(
        source.id,
        template?.description?.trim() ||
          template?.settings?.appearance?.headerDescription?.trim() ||
          null
      );
    }
    const holdSummary = new Map<string, { history: boolean; active: number }>();
    for (const hold of holdHistory.data || []) {
      const current = holdSummary.get(hold.document_id) || { history: false, active: 0 };
      current.history = true;
      if (hold.status === 'ACTIVE') current.active += 1;
      holdSummary.set(hold.document_id, current);
    }

    let responseData = (data || []).map((document) => {
      const disposition = evaluateDocumentDisposition(document);
      const countdown = getTrashCountdown(document.restore_until);
      const legalHold = holdSummary.get(document.id);
      const formResponseId = document.source_form_response_id;
      const description = formResponseId
        ? formDescriptions.has(String(formResponseId))
          ? formDescriptions.get(String(formResponseId))
          : document.descripcion === 'Respuesta de formulario'
            ? null
            : document.descripcion
        : document.descripcion;
      return {
        ...document,
        descripcion: description,
        can_trash: disposition.canTrash,
        can_cancel: disposition.canCancel,
        can_restore: disposition.canRestore,
        can_direct_purge_draft: disposition.canDirectPurgeDraft,
        can_direct_purge: disposition.canDirectPurge,
        legal_hold_active: (legalHold?.active || 0) > 0 || disposition.legalHoldActive,
        legal_hold_history: legalHold?.history === true,
        legal_hold_active_count: legalHold?.active || (disposition.legalHoldActive ? 1 : 0),
        lifecycle_blocking_code: disposition.blockingCode,
        restore_countdown: countdown,
        purge_state:
          countdown.state === 'DUE_FOR_EVALUATION' && !disposition.legalHoldActive
            ? 'FINAL_DELETE_CHECK'
            : null,
      };
    });
    if (tipo === 'papelera') {
      const retention = classifyTrashRetention(
        responseData.map((document) => ({
          id: document.id,
          legal_hold: Boolean((document as { legal_hold?: unknown }).legal_hold),
          legal_hold_status: (document as { legal_hold_status?: string | null }).legal_hold_status,
          retention_status: (document as { retention_status?: string | null }).retention_status,
          retention_until: (document as { retention_until?: string | null }).retention_until,
          deleted_at: (document as { deleted_at?: string | null }).deleted_at,
          trashed_at: (document as { trashed_at?: string | null }).trashed_at,
          restore_until: (document as { restore_until?: string | null }).restore_until,
          estado: (document as { estado?: string | null }).estado,
          participantes: (document as { participantes?: unknown }).participantes,
        }))
      );
      responseData = responseData.map((document) => ({
        ...document,
        purge_eligible: retention.get(document.id)?.purgeEligible === true,
        retention_reason: retention.get(document.id)?.reason || 'NONE',
        retention_blockers: retention.get(document.id)?.blockers || [],
      }));
    }

    const response = NextResponse.json({ data: responseData });
    const finishedAt = performance.now();
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set(
      'X-Docubox-Owner-Timing',
      [
        `owner_auth;dur=${(dataStartedAt - startedAt).toFixed(1)}`,
        `owner_data;dur=${(transformationStartedAt - dataStartedAt).toFixed(1)}`,
        `owner_format;dur=${(finishedAt - transformationStartedAt).toFixed(1)}`,
      ].join(', ')
    );
    if (finishedAt - startedAt > 1_000) {
      emitObservedEvent({
        service: 'next',
        outcome: 'slow',
        route: '/api/documentos/listar',
        status: 200,
        durationMs: finishedAt - startedAt,
      });
    }
    return response;
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : null;
    const temporary =
      isTemporaryDatabaseFailure({ code }) ||
      (err instanceof Error && ['AbortError', 'TimeoutError'].includes(err.name));
    const status = temporary ? 503 : 500;
    emitObservedEvent({
      service: 'next',
      outcome: 'error',
      route: '/api/documentos/listar',
      status,
      code: code || (err instanceof Error ? err.name : null),
    });
    return NextResponse.json(
      {
        error: 'No fue posible cargar los documentos.',
        code: temporary ? 'DATA_API_UNAVAILABLE' : 'DOCUMENT_LIST_FAILED',
      },
      { status, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
