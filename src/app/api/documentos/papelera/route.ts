import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { createNotificationServer } from '@/lib/notificationsInApp.server';
import { classifyTrashRetention } from '@/lib/documents/trash-retention';
import { purgeDocumentBundle } from '@/lib/documents/purge-document';
import {
  documentDispositionMessage,
  evaluateDocumentDisposition,
} from '@/lib/documents/lifecycle-policy';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };
const TRASH_RECOVERY_DAYS = 30;

async function authenticatedUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const auth = await createAnonClient().auth.getUser(authorization.slice(7).trim());
  return auth.error ? null : auth.data.user;
}

async function auditLifecycleAction(
  service: ReturnType<typeof createServiceClient>,
  request: NextRequest,
  document: Record<string, unknown>,
  actor: { id: string; email?: string | null },
  action: string,
  details: Record<string, unknown>
) {
  const result = await service.from('document_lifecycle_audit_events').insert({
    workspace_id: document.workspace_id || null,
    document_id: document.id,
    actor_id: actor.id,
    actor_email: actor.email || null,
    action,
    previous_state: {
      estado: document.estado || null,
      lifecycle_status: document.lifecycle_status || null,
    },
    new_state: details,
    result: details.result === 'denied' ? 'denied' : 'success',
    request_id: request.headers.get('x-request-id') || null,
    ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: request.headers.get('user-agent') || null,
    metadata: {
      ...details,
    },
  });
  if (result.error) {
    console.error('[papelera] Lifecycle audit could not be recorded', {
      documentId: document.id,
      action,
      code: result.error.code || 'AUDIT_INSERT_FAILED',
    });
  }
}

function lifecycleConflict(code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status: 409, headers: privateHeaders });
}

export async function POST(request: NextRequest) {
  let payload: { document_id?: string } | null = null;
  try {
    payload = (await request.json().catch(() => null)) as { document_id?: string } | null;
    if (!payload?.document_id) {
      return NextResponse.json(
        { error: 'Solicitud de papelera inválida.', code: 'TRASH_REQUEST_INVALID' },
        { status: 400, headers: privateHeaders }
      );
    }

    const access = await requireDocumentAccess(request, payload.document_id);
    const document = access.document as Record<string, unknown>;
    const disposition = evaluateDocumentDisposition(document);

    if (disposition.legalHoldActive) {
      await auditLifecycleAction(
        access.service,
        request,
        document,
        access.user,
        'LEGAL_HOLD_TRASH_ATTEMPT',
        {
          result: 'denied',
        }
      );
      void createNotificationServer({
        userId: access.user.id,
        type: 'alert',
        eventType: 'document.purge.blocked',
        title: 'No se puede mover el documento a Papelera',
        description: `"${String(document.nombre || 'Sin nombre')}" tiene Legal Hold activo.`,
        priority: 'alta',
        workspaceId: typeof document.workspace_id === 'string' ? document.workspace_id : null,
        actorUserId: access.user.id,
        entityType: 'document',
        entityId: String(document.id),
        actionUrl: `/visor-documento/${String(document.id)}`,
        actionLabel: 'Ver documento',
        metadata: { documentoId: document.id, reason: 'LEGAL_HOLD' },
        deduplicationKey: `document.purge.blocked.trash:${String(document.id)}:${new Date().toISOString().slice(0, 10)}`,
      }).catch((error) => {
        console.error('[papelera] Blocked-trash notification could not be created', error);
      });
      return lifecycleConflict('LEGAL_HOLD_ACTIVE', documentDispositionMessage('LEGAL_HOLD'));
    }

    if (access.role === 'AUTHORIZED') {
      const restoreUntil = new Date(
        Date.now() + TRASH_RECOVERY_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const personalTrash = await access.service.from('document_user_visibility').upsert(
        {
          document_id: document.id,
          user_id: access.user.id,
          workspace_id: document.workspace_id || null,
          trashed_at: new Date().toISOString(),
          hidden_at: null,
          restore_until: restoreUntil,
          restored_at: null,
        },
        { onConflict: 'document_id,user_id' }
      );
      if (personalTrash.error) throw personalTrash.error;
      await auditLifecycleAction(
        access.service,
        request,
        document,
        access.user,
        'DOCUMENT_PERSONAL_TRASHED',
        {
          scope: 'participant_self',
          restore_until: restoreUntil,
        }
      );
      return NextResponse.json(
        { ok: true, scope: 'personal', restore_until: restoreUntil },
        { headers: privateHeaders }
      );
    }

    if (!disposition.canTrash) {
      const code = disposition.canCancel
        ? 'DOCUMENT_CANCEL_REQUIRED'
        : 'DOCUMENT_TRASH_NOT_ALLOWED';
      return lifecycleConflict(code, documentDispositionMessage(disposition.blockingCode));
    }

    const now = new Date();
    const restoreUntil = new Date(
      now.getTime() + TRASH_RECOVERY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const update = await access.service
      .from('documentos')
      .update({
        deleted_at: now.toISOString(),
        trashed_at: now.toISOString(),
        trashed_by: access.user.id,
        restore_until: restoreUntil,
        lifecycle_status: 'TRASHED',
      })
      .eq('id', document.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (update.error) throw update.error;
    if (!update.data)
      return lifecycleConflict('DOCUMENT_ALREADY_TRASHED', 'El documento ya está en Papelera.');

    await auditLifecycleAction(access.service, request, document, access.user, 'DOCUMENT_TRASHED', {
      previous_state: String(document.estado || 'unknown'),
      lifecycle_status: 'TRASHED',
      restore_until: restoreUntil,
    });
    return NextResponse.json(
      { ok: true, scope: 'global', restore_until: restoreUntil },
      { headers: privateHeaders }
    );
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) {
      return NextResponse.json(access.body, { status: access.status, headers: privateHeaders });
    }
    console.error('[papelera] Trash operation failed', {
      documentId: payload?.document_id || null,
      code:
        error instanceof Error && 'code' in error ? String(error.code) : 'TRASH_OPERATION_FAILED',
    });
    return NextResponse.json(
      { error: 'No fue posible mover el documento a Papelera.', code: 'TRASH_OPERATION_FAILED' },
      { status: 500, headers: privateHeaders }
    );
  }
}

export async function PATCH(request: NextRequest) {
  let payload: { document_id?: string } | null = null;
  try {
    payload = (await request.json().catch(() => null)) as { document_id?: string } | null;
    if (!payload?.document_id) {
      return NextResponse.json(
        { error: 'Solicitud de restauración inválida.', code: 'RESTORE_REQUEST_INVALID' },
        { status: 400, headers: privateHeaders }
      );
    }
    const access = await requireDocumentAccess(request, payload.document_id);
    const document = access.document as Record<string, unknown>;

    if (access.role === 'AUTHORIZED') {
      const restore = await access.service
        .from('document_user_visibility')
        .delete()
        .eq('document_id', document.id)
        .eq('user_id', access.user.id);
      if (restore.error) throw restore.error;
      await auditLifecycleAction(
        access.service,
        request,
        document,
        access.user,
        'DOCUMENT_PERSONAL_RESTORED',
        {
          scope: 'participant_self',
        }
      );
      return NextResponse.json({ ok: true, scope: 'personal' }, { headers: privateHeaders });
    }

    const restore = await access.service
      .from('documentos')
      .update({
        deleted_at: null,
        trashed_at: null,
        trashed_by: null,
        restore_until: null,
        lifecycle_status: 'ACTIVE',
      })
      .eq('id', document.id)
      .not('deleted_at', 'is', null)
      .select('id')
      .maybeSingle();
    if (restore.error) throw restore.error;
    if (!restore.data)
      return lifecycleConflict('DOCUMENT_NOT_TRASHED', 'El documento no está en Papelera.');
    await auditLifecycleAction(
      access.service,
      request,
      document,
      access.user,
      'DOCUMENT_RESTORED',
      {
        lifecycle_status: 'ACTIVE',
      }
    );
    return NextResponse.json({ ok: true, scope: 'global' }, { headers: privateHeaders });
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) {
      return NextResponse.json(access.body, { status: access.status, headers: privateHeaders });
    }
    console.error('[papelera] Restore operation failed', {
      documentId: payload?.document_id || null,
      code:
        error instanceof Error && 'code' in error ? String(error.code) : 'RESTORE_OPERATION_FAILED',
    });
    return NextResponse.json(
      { error: 'No fue posible restaurar el documento.', code: 'RESTORE_OPERATION_FAILED' },
      { status: 500, headers: privateHeaders }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await authenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { error: 'No autenticado.' },
        { status: 401, headers: privateHeaders }
      );
    }

    const payload = (await request.json().catch(() => null)) as {
      document_id?: string;
      document_ids?: string[];
      empty_all?: boolean;
      direct_delete?: boolean;
      confirmation?: string;
    } | null;
    const documentIds = Array.from(
      new Set(
        (payload?.document_ids || []).filter(
          (id): id is string => typeof id === 'string' && id.length > 0
        )
      )
    );
    if (
      !payload ||
      (!payload.document_id && documentIds.length === 0 && payload.empty_all !== true)
    ) {
      return NextResponse.json(
        { error: 'Solicitud de papelera inválida.', code: 'TRASH_REQUEST_INVALID' },
        { status: 400, headers: privateHeaders }
      );
    }
    if (payload.confirmation !== 'ELIMINAR') {
      return NextResponse.json(
        {
          error: 'Confirma la eliminación escribiendo ELIMINAR.',
          code: 'PURGE_CONFIRMATION_REQUIRED',
        },
        { status: 400, headers: privateHeaders }
      );
    }

    const service = createServiceClient();
    const select =
      'id,nombre,created_at,tipo_documento:tipo_documento_id(nombre),owner_id,workspace_id,estado,participantes,deleted_at,trashed_at,restore_until,legal_hold,legal_hold_status,retention_status,retention_until,storage_path,sealed_pdf_path,file_url';
    let documents: Record<string, unknown>[] = [];

    if (payload.document_id) {
      const access = await requireDocumentAccess(request, payload.document_id, {
        ownerOrAdminOnly: true,
      });
      const document = access.document as Record<string, unknown>;
      const disposition = evaluateDocumentDisposition(document);
      if (payload.direct_delete !== true && !disposition.isTrashed) {
        return lifecycleConflict(
          'DOCUMENT_NOT_TRASHED',
          documentDispositionMessage('DOCUMENT_NOT_TRASHED')
        );
      }
      if (payload.direct_delete === true && !disposition.isTrashed) {
        if (!disposition.canDirectPurge) {
          return lifecycleConflict(
            disposition.blockingCode === 'ACTIVE_PARTICIPANTS'
              ? 'DOCUMENT_CANCEL_REQUIRED'
              : 'DOCUMENT_DIRECT_PURGE_NOT_ALLOWED',
            documentDispositionMessage(disposition.blockingCode) ||
              'Este documento no puede eliminarse directamente.'
          );
        }
        const now = new Date().toISOString();
        const staged = await access.service
          .from('documentos')
          .update({
            deleted_at: now,
            trashed_at: now,
            trashed_by: access.user.id,
            restore_until: now,
            lifecycle_status: 'TRASHED',
          })
          .eq('id', document.id)
          .is('deleted_at', null)
          .select(select)
          .maybeSingle();
        if (staged.error) throw staged.error;
        if (!staged.data)
          return lifecycleConflict(
            'DOCUMENT_DIRECT_PURGE_NOT_ALLOWED',
            'El documento cambió antes de poder eliminarse.'
          );
        documents = [staged.data as Record<string, unknown>];
      } else {
        documents = [document];
      }
    } else if (documentIds.length > 0) {
      if (documentIds.length > 100) {
        return NextResponse.json(
          { error: 'Selecciona un máximo de 100 documentos por operación.' },
          { status: 400, headers: privateHeaders }
        );
      }
      const accesses = await Promise.all(
        documentIds.map((documentId) =>
          requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true })
        )
      );
      documents = accesses.map((access) => access.document as Record<string, unknown>);
    } else {
      const rows = await service
        .from('documentos')
        .select(select)
        .eq('owner_id', user.id)
        .not('deleted_at', 'is', null);
      if (rows.error) throw rows.error;
      documents = (rows.data || []) as Record<string, unknown>[];
    }

    const retention = classifyTrashRetention(
      documents.map((document) => ({
        id: String(document.id),
        legal_hold: Boolean(document.legal_hold),
        legal_hold_status: document.legal_hold_status as string | null | undefined,
        retention_status: document.retention_status as string | null | undefined,
        retention_until: document.retention_until as string | null | undefined,
        deleted_at: document.deleted_at as string | null | undefined,
        trashed_at: document.trashed_at as string | null | undefined,
        restore_until: document.restore_until as string | null | undefined,
        estado: document.estado as string | null | undefined,
        participantes: document.participantes,
      }))
    );
    const protectedDocuments = documents
      .filter((document) => !retention.get(String(document.id))?.purgeEligible)
      .map((document) => ({
        id: document.id,
        reason: retention.get(String(document.id))?.reason,
        blockers: retention.get(String(document.id))?.blockers || [],
      }));

    if (payload.document_id && protectedDocuments.length > 0) {
      const retained = protectedDocuments[0];
      const protectedDocument = documents.find(
        (document) => String(document.id) === String(retained.id)
      );
      void createNotificationServer({
        userId: user.id,
        type: 'alert',
        eventType: 'document.purge.blocked',
        title: 'No se puede eliminar permanentemente',
        description: documentDispositionMessage(
          retained.reason as 'LEGAL_HOLD' | 'RETENTION_ACTIVE' | 'RECOVERY_PERIOD'
        ),
        priority: 'alta',
        workspaceId:
          typeof protectedDocument?.workspace_id === 'string'
            ? protectedDocument.workspace_id
            : null,
        actorUserId: user.id,
        entityType: 'document',
        entityId: String(retained.id),
        actionUrl: `/visor-documento/${String(retained.id)}`,
        actionLabel: 'Ver documento',
        metadata: {
          documentoId: retained.id,
          reason: retained.reason,
          blockers: retained.blockers,
        },
        deduplicationKey: `document.purge.blocked:${String(retained.id)}:${String(retained.reason)}:${new Date().toISOString().slice(0, 10)}`,
      }).catch((error) => {
        console.error('[papelera] Blocked-purge notification could not be created', error);
      });
      return NextResponse.json(
        {
          error: documentDispositionMessage(
            retained.reason as 'LEGAL_HOLD' | 'RETENTION_ACTIVE' | 'RECOVERY_PERIOD'
          ),
          code:
            retained.reason === 'LEGAL_HOLD' ? 'LEGAL_HOLD_ACTIVE' : 'DOCUMENT_RETENTION_REQUIRED',
          protected: protectedDocuments,
        },
        { status: 409, headers: privateHeaders }
      );
    }

    const deleted: string[] = [];
    const failed: Array<{ id: unknown; code: string }> = [];
    for (const document of documents) {
      if (!retention.get(String(document.id))?.purgeEligible) continue;
      try {
        await auditLifecycleAction(service, request, document, user, 'DOCUMENT_PURGE_REQUESTED', {
          lifecycle_status: 'PURGE_PENDING',
        });
        const result = await purgeDocumentBundle({
          service,
          document,
          actorId: user.id,
          reason: 'USER_REQUEST',
          method: payload.direct_delete === true ? 'DIRECT_DELETE' : 'TRASH_PURGE',
          requestId: request.headers.get('x-request-id'),
        });
        deleted.push(String(document.id));
        await auditLifecycleAction(service, request, document, user, 'DOCUMENT_PURGED', {
          lifecycle_status: 'PURGED',
          tombstone_id: result.tombstoneId,
          storage_object_count: result.storageObjectCount,
        });
      } catch (error) {
        console.error('[papelera] Coordinated purge failed', {
          documentId: document.id,
          code: error instanceof Error ? error.name : 'PURGE_FAILED',
        });
        failed.push({ id: document.id, code: 'PURGE_FAILED' });
      }
    }

    return NextResponse.json(
      {
        deleted_ids: deleted,
        deleted_count: deleted.length,
        protected: protectedDocuments,
        protected_count: protectedDocuments.length,
        failed,
      },
      { headers: privateHeaders }
    );
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) {
      return NextResponse.json(access.body, { status: access.status, headers: privateHeaders });
    }
    console.error('[papelera] Permanent deletion failed', {
      code: error instanceof Error ? error.name : 'TRASH_DELETE_FAILED',
    });
    return NextResponse.json(
      { error: 'No fue posible procesar la papelera.', code: 'TRASH_DELETE_FAILED' },
      { status: 500, headers: privateHeaders }
    );
  }
}
