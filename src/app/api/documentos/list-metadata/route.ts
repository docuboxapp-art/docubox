import { NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { isDefinitivelyInvalidAuthToken } from '@/lib/supabase/auth-verification';
import { isTemporaryDatabaseFailure } from '@/lib/supabase/backend-failure';
import { emitObservedEvent } from '@/lib/observability/events';
import { verifyDocumentBearer } from '@/lib/documents/bootstrap-auth.server';

export async function GET(request: Request) {
  const startedAt = performance.now();
  const deadline = AbortSignal.timeout(18_000);
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const anonClient = createAnonClient(undefined, deadline);
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

    const dbStartedAt = performance.now();
    const supabase = createServiceClient(deadline);
    const [foldersResult, labelsResult] = await Promise.all([
      supabase
        .from('carpetas')
        .select(
          'id, nombre, parent_id, created_at, updated_at, descripcion, tipo_documento_id, tipo_documento:tipo_documento_id(id, nombre), grupo_tipo_documento_id, grupo_tipo_documento:grupo_tipo_documento_id(id, nombre)'
        )
        .eq('owner_id', user.id)
        .is('deleted_at', null)
        .order('nombre'),
      createAnonClient(token, deadline)
        .from('etiquetas')
        .select('id, nombre, color')
        .order('nombre'),
    ]);
    const dbMs = performance.now() - dbStartedAt;

    const dataError = foldersResult.error || labelsResult.error;
    if (dataError) {
      const temporary =
        isTemporaryDatabaseFailure(foldersResult.error, foldersResult.status) ||
        isTemporaryDatabaseFailure(labelsResult.error, labelsResult.status);
      const status = temporary ? 503 : 500;
      emitObservedEvent({
        service: 'next',
        outcome: 'error',
        route: '/api/documentos/list-metadata',
        status,
        durationMs: performance.now() - startedAt,
        code: dataError.code,
      });
      return NextResponse.json(
        {
          error: 'No fue posible cargar las carpetas y etiquetas.',
          code: temporary ? 'DATA_API_UNAVAILABLE' : 'METADATA_FAILED',
        },
        { status, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const response = NextResponse.json({
      carpetas: foldersResult.data ?? [],
      etiquetas: labelsResult.data ?? [],
    });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set(
      'Server-Timing',
      `bootstrap_db;dur=${dbMs.toFixed(1)}, bootstrap_total;dur=${(performance.now() - startedAt).toFixed(1)}`
    );
    return response;
  } catch (error) {
    const temporary =
      error instanceof Error &&
      (['AbortError', 'TimeoutError', 'AuthRetryableFetchError'].includes(error.name) ||
        error.message.includes('fetch failed'));
    const status = temporary ? 503 : 500;
    emitObservedEvent({
      service: 'next',
      outcome: temporary ? 'unavailable' : 'error',
      route: '/api/documentos/list-metadata',
      status,
      durationMs: performance.now() - startedAt,
      code: error instanceof Error ? error.name : null,
    });
    return NextResponse.json(
      {
        error: 'No fue posible cargar las carpetas y etiquetas.',
        code: temporary ? 'DATA_API_UNAVAILABLE' : 'METADATA_FAILED',
      },
      { status, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
