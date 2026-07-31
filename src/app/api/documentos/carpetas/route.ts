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
      const { data: { user } } = await anonClient.auth.getUser(token);
      userId = user?.id ?? null;
      userEmail = user?.email ?? null;
    }

    if (!userId) {
      return NextResponse.json({ data: [] });
    }

    const { data, error } = await supabase
      .from('carpetas')
      .select('id, nombre, parent_id, created_at, descripcion, tipo_documento_id, tipo_documento:tipo_documento_id(id, nombre), grupo_tipo_documento_id, grupo_tipo_documento:grupo_tipo_documento_id(id, nombre)')
      .eq('owner_id', userId)
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
      const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
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
      return NextResponse.json({ error: 'El nombre de la carpeta es obligatorio.' }, { status: 400 });
    }

    const insertData: any = {
      owner_id: userId,
      nombre: nombre.trim(),
      parent_id: parent_id || null,
    };

    if (descripcion !== undefined) insertData.descripcion = descripcion?.trim() || null;
    if (tipo_documento_id !== undefined) insertData.tipo_documento_id = tipo_documento_id || null;
    if (grupo_tipo_documento_id !== undefined) insertData.grupo_tipo_documento_id = grupo_tipo_documento_id || null;

    const { data, error } = await supabase
      .from('carpetas')
      .insert(insertData)
      .select('id, nombre, parent_id, created_at, descripcion, tipo_documento_id, tipo_documento:tipo_documento_id(id, nombre), grupo_tipo_documento_id, grupo_tipo_documento:grupo_tipo_documento_id(id, nombre)')
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
