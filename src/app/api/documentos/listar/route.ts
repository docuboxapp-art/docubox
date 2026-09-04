import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, createAnonClient } from '@/lib/supabase/server';
import { classifyTrashRetention } from '@/lib/documents/trash-retention';
import { evaluateDocumentDisposition } from '@/lib/documents/lifecycle-policy';
import { getTrashCountdown } from '@/lib/documents/trash-countdown';

const DOC_SELECT =
  'id, nombre, descripcion, estado, etiquetas_ids, file_size, updated_at, ultimo_paso, is_favorite, fecha_vencimiento, file_url, scan_status, scan_threat, carpeta_id, created_at, fecha_completado, numero_oficio, folio_interno, ruta_guardado, priority, es_urgente, participantes, tipo_documento_id, tipo_documento:tipo_documento_id(nombre), deleted_at, owner_id, legal_hold, legal_hold_status, retention_status, retention_until, lifecycle_status, trashed_at, trashed_by, restore_until';

export async function GET(request: NextRequest) {
  try {
    // Authenticate user via Bearer token using anon client (proper JWT validation)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // Use anon client to validate the JWT properly
    const anonClient = createAnonClient();
    const {
      data: { user },
      error: authError,
    } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      console.error('[listar-documentos] Auth error:', authError?.message);
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
    }

    // Use service role client for the actual query (bypasses RLS, filters by owner_id)
    const supabase = createServiceClient();

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get('tipo') || 'todos';

    let query = supabase.from('documentos').select(DOC_SELECT).eq('owner_id', user.id);

    if (tipo === 'papelera') {
      query = query.not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
    } else if (tipo === 'favoritos') {
      query = query
        .eq('is_favorite', true)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });
    } else if (tipo === 'por_vencer') {
      const now = new Date();
      const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);
      query = query
        .is('deleted_at', null)
        .not('fecha_vencimiento', 'is', null)
        .lte('fecha_vencimiento', in72h.toISOString())
        .gte('fecha_vencimiento', now.toISOString())
        .order('fecha_vencimiento', { ascending: true });
    } else {
      query = query.is('deleted_at', null).order('updated_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      console.error(
        '[listar-documentos] Query error:',
        error.message,
        '| code:',
        error.code,
        '| details:',
        error.details
      );
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let responseData = (data || []).map((document) => {
      const disposition = evaluateDocumentDisposition(document);
      const countdown = getTrashCountdown(document.restore_until);
      return {
        ...document,
        can_trash: disposition.canTrash,
        can_cancel: disposition.canCancel,
        can_restore: disposition.canRestore,
        can_direct_purge_draft: disposition.canDirectPurgeDraft,
        can_direct_purge: disposition.canDirectPurge,
        legal_hold_active: disposition.legalHoldActive,
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

    console.info(`[listar-documentos] user=${user.id} tipo=${tipo} count=${responseData.length}`);
    return NextResponse.json({ data: responseData });
  } catch (err: unknown) {
    console.error('[listar-documentos] Unexpected error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}
