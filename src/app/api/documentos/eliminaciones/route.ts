import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };

const tombstoneSelect =
  'id,document_id,workspace_id,reason,status,requested_at,storage_removed_at,completed_at,metadata';
const folderTombstoneSelect =
  'id,folder_id,owner_id,folder_name,folder_created_at,reason,status,requested_at,completed_at,metadata';

function metadataTimestamp(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function publicTombstone(row: Record<string, unknown>) {
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};
  const documentName =
    typeof metadata.document_name === 'string' ? metadata.document_name.trim().slice(0, 255) : null;
  const documentType =
    typeof metadata.document_type === 'string' ? metadata.document_type.trim().slice(0, 120) : null;
  const deletionMethod =
    metadata.deletion_method === 'DIRECT_DELETE' ||
    metadata.deletion_method === 'TRASH_PURGE' ||
    metadata.deletion_method === 'AUTO_RECOVERY_PURGE'
      ? metadata.deletion_method
      : null;

  return {
    resource_type: 'DOCUMENT' as const,
    id: row.id,
    document_id: row.document_id,
    workspace_id: row.workspace_id,
    reason: row.reason,
    status: row.status,
    requested_at: row.requested_at,
    storage_removed_at: row.storage_removed_at,
    completed_at: row.completed_at,
    document_name: documentName || null,
    document_type: documentType || null,
    document_created_at: metadataTimestamp(metadata, 'document_created_at'),
    document_trashed_at: metadataTimestamp(metadata, 'document_trashed_at'),
    deletion_method: deletionMethod,
  };
}

function publicFolderTombstone(row: Record<string, unknown>) {
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};

  return {
    resource_type: 'FOLDER' as const,
    id: row.id,
    document_id: row.folder_id,
    workspace_id: null,
    reason: row.reason,
    status: row.status,
    requested_at: row.requested_at,
    storage_removed_at: null,
    completed_at: row.completed_at,
    document_name: typeof row.folder_name === 'string' ? row.folder_name.slice(0, 255) : null,
    document_type: 'Carpeta',
    document_created_at:
      typeof row.folder_created_at === 'string' && !Number.isNaN(Date.parse(row.folder_created_at))
        ? row.folder_created_at
        : null,
    document_trashed_at: null,
    deletion_method:
      metadata.deletion_method === 'DIRECT_DELETE' ||
      metadata.deletion_method === 'AUTO_RECOVERY_PURGE'
        ? metadata.deletion_method
        : null,
  };
}

export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'No autenticado.' },
      { status: 401, headers: privateHeaders }
    );
  }

  const token = authorization.slice(7).trim();
  const auth = await createAnonClient().auth.getUser(token);
  if (auth.error || !auth.data.user) {
    return NextResponse.json(
      { error: 'Sesión no válida.' },
      { status: 401, headers: privateHeaders }
    );
  }

  try {
    const service = createServiceClient();
    const user = auth.data.user;
    const scope = request.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'recent';
    const recentSince = new Date();
    recentSince.setDate(recentSince.getDate() - 30);
    const applyWindow = <T extends { gte: (column: string, value: string) => T }>(query: T) =>
      scope === 'recent' ? query.gte('requested_at', recentSince.toISOString()) : query;
    const [personal, folderPersonal, memberships] = await Promise.all([
      applyWindow(
        service
          .from('document_deletion_tombstones')
          .select(tombstoneSelect)
          .eq('owner_id', user.id)
          .eq('status', 'COMPLETED')
          .order('requested_at', { ascending: false })
          .limit(500)
      ),
      applyWindow(
        service
          .from('folder_deletion_tombstones')
          .select(folderTombstoneSelect)
          .eq('owner_id', user.id)
          .eq('status', 'COMPLETED')
          .order('requested_at', { ascending: false })
          .limit(500)
      ),
      service
        .from('workspace_members')
        .select('workspace_id,role,status')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .in('role', ['owner', 'admin']),
    ]);
    if (personal.error) throw personal.error;
    if (folderPersonal.error) throw folderPersonal.error;
    if (memberships.error) throw memberships.error;

    const workspaceIds = (memberships.data || [])
      .map((membership) => membership.workspace_id)
      .filter(Boolean);
    const workspace = workspaceIds.length
      ? await applyWindow(
          service
            .from('document_deletion_tombstones')
            .select(tombstoneSelect)
            .in('workspace_id', workspaceIds)
            .eq('status', 'COMPLETED')
            .order('requested_at', { ascending: false })
            .limit(500)
        )
      : { data: [], error: null };
    if (workspace.error) throw workspace.error;

    const records = new Map<string, Record<string, unknown>>();
    for (const row of [...(personal.data || []), ...(workspace.data || [])]) {
      const record = publicTombstone(row as Record<string, unknown>);
      records.set(`document:${String(row.id)}`, record);
    }
    for (const row of folderPersonal.data || []) {
      const record = publicFolderTombstone(row as Record<string, unknown>);
      records.set(`folder:${String(row.id)}`, record);
    }
    return NextResponse.json(
      (() => {
        const data = [...records.values()]
          .sort((left, right) =>
            String(right.requested_at).localeCompare(String(left.requested_at))
          )
          .slice(0, 500);
        return {
          data,
          scope,
          window_days: scope === 'recent' ? 30 : null,
          total: data.length,
        };
      })(),
      { headers: privateHeaders }
    );
  } catch (error) {
    console.error('[eliminaciones] Could not load deletion history', {
      code: error instanceof Error ? error.name : 'DELETION_HISTORY_FAILED',
    });
    return NextResponse.json(
      { error: 'No fue posible cargar el historial de eliminaciones.' },
      { status: 500, headers: privateHeaders }
    );
  }
}
