import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await req.json();
    const { token, fileName, fileType, fileSize, fileData } = body;

    if (!/^[a-f0-9]{64}$/i.test(String(token || '')) || !fileName || !fileData) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    const allowedTypes = new Set([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    if (!allowedTypes.has(fileType)) {
      return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 415 });
    }
    if (typeof fileData !== 'string' || fileData.length > 35_000_000) {
      return NextResponse.json({ error: 'El archivo excede el limite permitido' }, { status: 413 });
    }

    // Find the session by token
    const { data: session, error: sessionError } = await supabase
      .from('mobile_upload_sessions')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Sesión inválida o expirada' }, { status: 404 });
    }

    // Upload file to Supabase Storage
    const fileBuffer = Buffer.from(fileData, 'base64');
    if (fileBuffer.byteLength === 0 || fileBuffer.byteLength > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'El archivo excede el limite permitido' }, { status: 413 });
    }
    const safeFileName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
    const storagePath = `uploads/${token}/${safeFileName}`;

    const { error: uploadError } = await supabase.storage
      .from('mobile-uploads')
      .upload(storagePath, fileBuffer, {
        contentType: fileType || 'application/octet-stream',
        upsert: true,
      });

    if (uploadError) {
      console.error('[mobile-upload] Storage upload failed:', uploadError.message);
      return NextResponse.json({ error: 'No fue posible almacenar el archivo.' }, { status: 500 });
    }

    // Update session with storage path (small payload — realtime works reliably)
    const { error: updateError } = await supabase
      .from('mobile_upload_sessions')
      .update({
        status: 'completed',
        file_name: safeFileName,
        file_type: fileType,
        file_size: fileSize,
        file_data: storagePath, // store path, not base64
        updated_at: new Date().toISOString(),
      })
      .eq('token', token);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
