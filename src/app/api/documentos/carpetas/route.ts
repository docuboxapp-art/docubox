import { NextResponse } from 'next/server';
import { createServiceClient, createAnonClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = createServiceClient();

    const authHeader = request.headers.get('Authorization');
    let userId: string | null = null;
    let userEmail: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const anonClient = createAnonClient();
      const {
        data: { user },
      } = await anonClient.auth.getUser(token);
      userId = user?.id ?? null;
      userEmail = user?.email ?? null;
    }

    if (!userId) {
      return NextResponse.json({ data: [] });
    }

    const { data, error } = await supabase
      .from('carpetas')
      .select(
        'id, nombre, parent_id, created_at, descripcion, tipo_documento_id, tipo_documento:tipo_documento_id(id, nombre), grupo_tipo_documento_id, grupo_tipo_documento:grupo_tipo_documento_id(id, nombre)'
      )
      .eq('owner_id', userId)
      .is('deleted_at', null)
      .order('nombre');

    if (error) {
      console.error('Error fetching carpetas:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err: any) {
    console.error('Unexpected error fetching carpetas:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServiceClient();

    const authHeader = request.headers.get('Authorization');
    let userId: string | null = null;
    let userEmail: string | null = null;
    let userFullName: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const anonClient = createAnonClient();
      const {
        data: { user },
        error: authError,
      } = await anonClient.auth.getUser(token);
      if (authError) {
        console.error('Auth error:', authError);
        return NextResponse.json({ error: 'Token inválido o expirado.' }, { status: 401 });
      }
      userId = user?.id ?? null;
      userEmail = user?.email ?? null;
      userFullName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? '';
    }

    if (!userId) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    if (userEmail) {
      const { error: upsertError } = await supabase
        .from('user_profiles')
        .upsert(
          { id: userId, email: userEmail, full_name: userFullName || '' },
          { onConflict: 'id', ignoreDuplicates: true }
        );
      if (upsertError) {
        console.error('Error upserting user_profiles:', upsertError);
      }
    }

    const body = await request.json();
    const { nombre, parent_id, descripcion, tipo_documento_id, grupo_tipo_documento_id } = body;

    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return NextResponse.json(
        { error: 'El nombre de la carpeta es obligatorio.' },
        { status: 400 }
      );
    }

    const insertData: any = {
      owner_id: userId,
      nombre: nombre.trim(),
      parent_id: parent_id || null,
    };

    if (descripcion !== undefined) insertData.descripcion = descripcion?.trim() || null;
    if (tipo_documento_id !== undefined) insertData.tipo_documento_id = tipo_documento_id || null;
    if (grupo_tipo_documento_id !== undefined)
      insertData.grupo_tipo_documento_id = grupo_tipo_documento_id || null;

    const { data, error } = await supabase
      .from('carpetas')
      .insert(insertData)
      .select(
        'id, nombre, parent_id, created_at, descripcion, tipo_documento_id, tipo_documento:tipo_documento_id(id, nombre), grupo_tipo_documento_id, grupo_tipo_documento:grupo_tipo_documento_id(id, nombre)'
      )
      .single();

    if (error) {
      console.error('Error creating carpeta:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('Unexpected error creating carpeta:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    const folderId = new URL(request.url).searchParams.get('id');
    if (!folderId) {
      return NextResponse.json({ error: 'La carpeta es obligatoria.' }, { status: 400 });
    }

    const anonClient = createAnonClient();
    const {
      data: { user },
      error: authError,
    } = await anonClient.auth.getUser(authHeader.slice(7));
    if (authError || !user) {
      return NextResponse.json({ error: 'Token inválido o expirado.' }, { status: 401 });
    }

    const supabase = createServiceClient();
    const { data: folder, error: folderError } = await supabase
      .from('carpetas')
      .select('id, nombre, created_at')
      .eq('id', folderId)
      .eq('owner_id', user.id)
      .maybeSingle();

    if (folderError) {
      console.error('Error verifying carpeta for deletion:', folderError);
      return NextResponse.json({ error: 'No fue posible verificar la carpeta.' }, { status: 500 });
    }
    if (!folder) {
      return NextResponse.json({ error: 'Carpeta no encontrada.' }, { status: 404 });
    }

    const [
      { count: documentCount, error: documentCountError },
      { count: childFolderCount, error: childCountError },
    ] = await Promise.all([
      supabase
        .from('documentos')
        .select('id', { count: 'exact', head: true })
        .eq('carpeta_id', folderId),
      supabase
        .from('carpetas')
        .select('id', { count: 'exact', head: true })
        .eq('parent_id', folderId)
        .eq('owner_id', user.id),
    ]);

    if (documentCountError || childCountError) {
      console.error('Error checking carpeta contents before deletion:', {
        documentCountError,
        childCountError,
      });
      return NextResponse.json(
        { error: 'No fue posible verificar el contenido de la carpeta.' },
        { status: 500 }
      );
    }

    if ((documentCount ?? 0) > 0 || (childFolderCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'Solo puedes eliminar carpetas vacías. Mueve o elimina primero sus documentos y subcarpetas.',
          documents: documentCount ?? 0,
          subfolders: childFolderCount ?? 0,
        },
        { status: 409 }
      );
    }

    const { data: tombstone, error: tombstoneError } = await supabase
      .from('folder_deletion_tombstones')
      .insert({
        folder_id: folder.id,
        owner_id: user.id,
        actor_id: user.id,
        folder_name: folder.nombre,
        folder_created_at: folder.created_at || null,
        reason: 'USER_REQUEST',
        status: 'PENDING',
        metadata: { deletion_method: 'DIRECT_DELETE' },
      })
      .select('id')
      .single();

    if (tombstoneError || !tombstone) {
      console.error('Error recording folder deletion request:', tombstoneError);
      return NextResponse.json(
        { error: 'No fue posible registrar la eliminación permanente de la carpeta.' },
        { status: 500 }
      );
    }

    const { error: deleteError } = await supabase
      .from('carpetas')
      .delete()
      .eq('id', folderId)
      .eq('owner_id', user.id);

    if (deleteError) {
      console.error('Error deleting empty carpeta:', deleteError);
      await supabase
        .from('folder_deletion_tombstones')
        .update({ status: 'FAILED', failure_code: 'FOLDER_DELETE_FAILED' })
        .eq('id', tombstone.id);
      return NextResponse.json({ error: 'No fue posible eliminar la carpeta.' }, { status: 500 });
    }

    const { error: completionError } = await supabase
      .from('folder_deletion_tombstones')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
      .eq('id', tombstone.id);
    if (completionError) {
      console.error('Error completing folder deletion tombstone:', completionError);
      return NextResponse.json(
        { error: 'La carpeta fue eliminada, pero no se pudo finalizar su registro de auditoría.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: { id: folder.id, nombre: folder.nombre, tombstone_id: tombstone.id },
    });
  } catch (err: any) {
    console.error('Unexpected error deleting carpeta:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
