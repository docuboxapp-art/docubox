import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { purgeDocumentBundle } from '@/lib/documents/purge-document';
import { classifyTrashRetention } from '@/lib/documents/trash-retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DOCUMENTS_PER_RUN = 50;
const MAX_FOLDERS_PER_RUN = 50;

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return new NextResponse(null, { status: 404 });

  try {
    const service = createServiceClient();
    const now = new Date().toISOString();
    const documents = await service
      .from('documentos')
      .select(
        'id,nombre,created_at,tipo_documento:tipo_documento_id(nombre),owner_id,workspace_id,estado,participantes,deleted_at,trashed_at,restore_until,legal_hold,legal_hold_status,retention_status,retention_until,storage_path,sealed_pdf_path,file_url'
      )
      .not('deleted_at', 'is', null)
      .not('restore_until', 'is', null)
      .lte('restore_until', now)
      .order('restore_until', { ascending: true })
      .limit(MAX_DOCUMENTS_PER_RUN);
    if (documents.error) throw documents.error;

    const eligibility = classifyTrashRetention(documents.data || []);
    let completed = 0;
    let failed = 0;
    for (const document of documents.data || []) {
      if (!eligibility.get(document.id)?.purgeEligible) continue;
      try {
        await purgeDocumentBundle({
          service,
          document,
          actorId: null,
          reason: 'AUTO_RECOVERY_EXPIRY',
          method: 'AUTO_RECOVERY_PURGE',
          requestId: request.headers.get('x-vercel-id'),
        });
        completed += 1;
      } catch (error) {
        failed += 1;
        console.error('[document-purge] Automatic purge failed', {
          documentId: document.id,
          code: error instanceof Error ? error.name : 'PURGE_FAILED',
        });
      }
    }

    const folderRows = await service
      .from('carpetas')
      .select('id,nombre,owner_id,created_at,trashed_root_folder_id')
      .not('deleted_at', 'is', null)
      .not('restore_until', 'is', null)
      .lte('restore_until', now)
      .order('restore_until', { ascending: true })
      .limit(MAX_FOLDERS_PER_RUN);
    if (folderRows.error) throw folderRows.error;

    let foldersCompleted = 0;
    let foldersDeferred = 0;
    for (const folder of folderRows.data || []) {
      if (folder.id !== folder.trashed_root_folder_id) continue;
      const remaining = await service
        .from('documentos')
        .select('id', { count: 'exact', head: true })
        .eq('trashed_folder_id', folder.id);
      if (remaining.error) throw remaining.error;
      if ((remaining.count || 0) > 0) {
        foldersDeferred += 1;
        continue;
      }
      const tombstone = await service
        .from('folder_deletion_tombstones')
        .insert({
          folder_id: folder.id,
          owner_id: folder.owner_id,
          actor_id: null,
          folder_name: folder.nombre,
          folder_created_at: folder.created_at || null,
          reason: 'AUTO_RECOVERY_EXPIRY',
          status: 'PENDING',
          metadata: { deletion_method: 'AUTO_RECOVERY_PURGE' },
        })
        .select('id')
        .single();
      if (tombstone.error || !tombstone.data) throw tombstone.error;
      const deletion = await service.from('carpetas').delete().eq('id', folder.id);
      if (deletion.error) {
        await service
          .from('folder_deletion_tombstones')
          .update({ status: 'FAILED', failure_code: 'FOLDER_AUTO_PURGE_FAILED' })
          .eq('id', tombstone.data.id);
        foldersDeferred += 1;
        continue;
      }
      await service
        .from('folder_deletion_tombstones')
        .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
        .eq('id', tombstone.data.id);
      foldersCompleted += 1;
    }

    return NextResponse.json(
      {
        completed,
        failed,
        evaluated: (documents.data || []).length,
        folders_completed: foldersCompleted,
        folders_deferred: foldersDeferred,
      },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('[document-purge] Automatic purge could not run', {
      code: error instanceof Error ? error.name : 'PURGE_JOB_FAILED',
    });
    return NextResponse.json(
      { error: 'No fue posible ejecutar la purga programada.' },
      { status: 500 }
    );
  }
}
