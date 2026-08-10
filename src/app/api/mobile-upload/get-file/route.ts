import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const authorization = req.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const { data: { user } } = await createAnonClient().auth.getUser(authorization.slice(7));
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Token requerido' }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from('mobile_upload_sessions')
      .select('*')
      .eq('token', token)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Sesión no encontrada' }, { status: 404 });
    }

    const storagePath = session.file_data as string;

    // Check if file_data is a storage path (not raw base64)
    if (storagePath && storagePath.startsWith('uploads/')) {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('mobile-uploads')
        .download(storagePath);

      if (downloadError || !fileData) {
        return NextResponse.json({ error: 'Error al descargar archivo' }, { status: 500 });
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      return NextResponse.json({
        fileData: base64,
        fileName: session.file_name,
        fileType: session.file_type,
        fileSize: session.file_size,
      });
    }

    // Fallback: file_data is already base64
    return NextResponse.json({
      fileData: storagePath,
      fileName: session.file_name,
      fileType: session.file_type,
      fileSize: session.file_size,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
