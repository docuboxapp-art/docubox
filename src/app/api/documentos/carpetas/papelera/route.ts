import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { evaluateDocumentDisposition } from '@/lib/documents/lifecycle-policy';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };
const RECOVERY_DAYS = 30;
const MAX_FOLDERS = 250;
const MAX_DOCUMENTS = 100;

type FolderRow = {
  id: string;
  parent_id: string | null;
  nombre: string;
  created_at: string | null;
};
type Blocker = {
  document_id: string;
  code: 'LEGAL_HOLD' | 'ACTIVE_WORKFLOW' | 'NO_PERMISSION' | 'ALREADY_TRASHED' | 'OTHER';
};

async function currentUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const auth = await createAnonClient().auth.getUser(authorization.slice(7).trim());
  return auth.error ? null : auth.data.user;
}

async function ownedFolderTree(folderId: string, ownerId: string) {
  const service = createServiceClient();
  const folders = await service
    .from('carpetas')
    .select('id,parent_id,nombre,created_at')
    .eq('owner_id', ownerId)
    .is('deleted_at', null)
    .limit(MAX_FOLDERS);
  if (folders.error) throw folders.error;
  const rows = (folders.data || []) as FolderRow[];
  const root = rows.find((folder) => folder.id === folderId);
  if (!root) return null;

  const byParent = new Map<string | null, FolderRow[]>();
  for (const folder of rows) {
    const siblings = byParent.get(folder.parent_id) || [];
    siblings.push(folder);
    byParent.set(folder.parent_id, siblings);
  }
  const tree: FolderRow[] = [];
  const pending = [root];
  const visited = new Set<string>();
  while (pending.length) {
    const folder = pending.shift();
    if (!folder || visited.has(folder.id)) continue;
    visited.add(folder.id);
    tree.push(folder);
    pending.push(...(byParent.get(folder.id) || []));
  }
  return { service, root, folders: tree };
}

async function evaluateFolderTrash(request: NextRequest, folderId: string) {
  const user = await currentUser(request);
  if (!user) return { error: 'No autenticado.', status: 401 as const };
  const tree = await ownedFolderTree(folderId, user.id);
  if (!tree) return { error: 'Carpeta no encontrada.', status: 404 as const };

  const folderIds = tree.folders.map((folder) => folder.id);
  const candidates = await tree.service
    .from('documentos')
    .select('id')
    .in('carpeta_id', folderIds)
    .limit(MAX_DOCUMENTS + 1);
  if (candidates.error) throw candidates.error;
  if ((candidates.data || []).length > MAX_DOCUMENTS) {
    return {
      error: `La operación admite hasta ${MAX_DOCUMENTS} documentos por carpeta.`,
      status: 409 as const,
    };
  }

  const blockers: Blocker[] = [];
  const eligible: string[] = [];
  for (const candidate of candidates.data || []) {
    try {
      const access = await requireDocumentAccess(request, candidate.id, { ownerOrAdminOnly: true });
      const disposition = evaluateDocumentDisposition(access.document);
      if (disposition.isTrashed) {
        blockers.push({ document_id: candidate.id, code: 'ALREADY_TRASHED' });
      } else if (disposition.legalHoldActive) {
        blockers.push({ document_id: candidate.id, code: 'LEGAL_HOLD' });
      } else if (!disposition.canTrash) {
        blockers.push({
          document_id: candidate.id,
          code: disposition.hasActiveParticipants ? 'ACTIVE_WORKFLOW' : 'OTHER',
        });
      } else {
        eligible.push(candidate.id);
      }
    } catch (error) {
      const access = documentAccessResponse(error);
      if (access.status === 403)
        blockers.push({ document_id: candidate.id, code: 'NO_PERMISSION' });
      else throw error;
    }
  }

  const count = (code: Blocker['code']) =>
    blockers.filter((blocker) => blocker.code === code).length;
  return {
    user,
    tree,
    eligible,
    blockers,
    summary: {
      documents_total: (candidates.data || []).length,
      eligible: eligible.length,
      legal_hold: count('LEGAL_HOLD'),
      active_workflow: count('ACTIVE_WORKFLOW'),
      no_permission: count('NO_PERMISSION'),
      already_trashed: count('ALREADY_TRASHED'),
      other_blocked: count('OTHER'),
      folder_can_move: blockers.length === 0,
    },
  };
}

function responseSummary(
  result: Exclude<Awaited<ReturnType<typeof evaluateFolderTrash>>, { error: string }>
) {
  return {
    folder: {
      id: result.tree.root.id,
      name: result.tree.root.nombre,
      nested_folder_count: result.tree.folders.length - 1,
    },
    summary: result.summary,
  };
}

export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user)
    return NextResponse.json(
      { error: 'No autenticado.' },
      { status: 401, headers: privateHeaders }
    );
  const service = createServiceClient();
  const folders = await service
    .from('carpetas')
    .select('id,nombre,created_at,deleted_at,trashed_at,restore_until,trashed_root_folder_id')
    .eq('owner_id', user.id)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(MAX_FOLDERS);
  if (folders.error) {
    console.error('[folder-trash] Could not list folders', { code: folders.error.code });
    return NextResponse.json(
      { error: 'No fue posible cargar las carpetas en Papelera.' },
      { status: 500, headers: privateHeaders }
    );
  }
  const roots = (folders.data || []).filter(
    (folder) => folder.id === folder.trashed_root_folder_id
  );
  return NextResponse.json({ data: roots }, { headers: privateHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      folder_id?: string;
      execute?: boolean;
    } | null;
    if (!body?.folder_id)
      return NextResponse.json(
        { error: 'La carpeta es obligatoria.' },
        { status: 400, headers: privateHeaders }
      );
    const evaluation = await evaluateFolderTrash(request, body.folder_id);
    if ('error' in evaluation)
      return NextResponse.json(
        { error: evaluation.error },
        { status: evaluation.status, headers: privateHeaders }
      );
    if (!body.execute)
      return NextResponse.json(responseSummary(evaluation), { headers: privateHeaders });

    const now = new Date();
    const trashedAt = now.toISOString();
    const restoreUntil = new Date(
      now.getTime() + RECOVERY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const movedDocumentIds: string[] = [];
    for (const documentId of evaluation.eligible) {
      const moved = await evaluation.tree.service
        .from('documentos')
        .update({
          deleted_at: trashedAt,
          trashed_at: trashedAt,
          trashed_by: evaluation.user.id,
          restore_until: restoreUntil,
          lifecycle_status: 'TRASHED',
          trashed_folder_id: evaluation.tree.root.id,
        })
        .eq('id', documentId)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle();
      if (moved.error) throw moved.error;
      if (moved.data) movedDocumentIds.push(documentId);
    }

    const fullyMoved =
      movedDocumentIds.length === evaluation.summary.documents_total &&
      evaluation.blockers.length === 0;
    if (fullyMoved) {
      const folders = await evaluation.tree.service
        .from('carpetas')
        .update({
          deleted_at: trashedAt,
          trashed_at: trashedAt,
          trashed_by: evaluation.user.id,
          restore_until: restoreUntil,
          trashed_root_folder_id: evaluation.tree.root.id,
        })
        .in(
          'id',
          evaluation.tree.folders.map((folder) => folder.id)
        )
        .is('deleted_at', null);
      if (folders.error) throw folders.error;
    }

    return NextResponse.json(
      {
        ...responseSummary(evaluation),
        moved_document_count: movedDocumentIds.length,
        blocked_document_count: evaluation.summary.documents_total - movedDocumentIds.length,
        folder_moved: fullyMoved,
        restore_until: fullyMoved ? restoreUntil : null,
      },
      { headers: privateHeaders }
    );
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500)
      return NextResponse.json(access.body, { status: access.status, headers: privateHeaders });
    console.error('[folder-trash] Could not move folder to trash', {
      code: error instanceof Error ? error.name : 'FOLDER_TRASH_FAILED',
    });
    return NextResponse.json(
      { error: 'No fue posible mover la carpeta a Papelera.' },
      { status: 500, headers: privateHeaders }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { folder_id?: string } | null;
    if (!body?.folder_id)
      return NextResponse.json(
        { error: 'La carpeta es obligatoria.' },
        { status: 400, headers: privateHeaders }
      );
    const user = await currentUser(request);
    if (!user)
      return NextResponse.json(
        { error: 'No autenticado.' },
        { status: 401, headers: privateHeaders }
      );
    const service = createServiceClient();
    const root = await service
      .from('carpetas')
      .select('id')
      .eq('id', body.folder_id)
      .eq('owner_id', user.id)
      .eq('trashed_root_folder_id', body.folder_id)
      .not('deleted_at', 'is', null)
      .maybeSingle();
    if (root.error) throw root.error;
    if (!root.data)
      return NextResponse.json(
        { error: 'Carpeta no disponible para restauración.' },
        { status: 404, headers: privateHeaders }
      );

    const [folders, documents] = await Promise.all([
      service
        .from('carpetas')
        .update({
          deleted_at: null,
          trashed_at: null,
          trashed_by: null,
          restore_until: null,
          trashed_root_folder_id: null,
        })
        .eq('trashed_root_folder_id', body.folder_id),
      service
        .from('documentos')
        .update({
          deleted_at: null,
          trashed_at: null,
          trashed_by: null,
          restore_until: null,
          lifecycle_status: 'ACTIVE',
          trashed_folder_id: null,
        })
        .eq('trashed_folder_id', body.folder_id),
    ]);
    if (folders.error) throw folders.error;
    if (documents.error) throw documents.error;
    return NextResponse.json({ ok: true }, { headers: privateHeaders });
  } catch (error) {
    console.error('[folder-trash] Could not restore folder', {
      code: error instanceof Error ? error.name : 'FOLDER_RESTORE_FAILED',
    });
    return NextResponse.json(
      { error: 'No fue posible restaurar la carpeta.' },
      { status: 500, headers: privateHeaders }
    );
  }
}
