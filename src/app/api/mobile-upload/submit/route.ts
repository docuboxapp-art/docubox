import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await req.json();
    const { token, fileName, fileType, fileSize, fileData } = body;

    if (!token || !fileName || !fileData) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
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
    const storagePath = `uploads/${token}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('mobile-uploads')
      .upload(storagePath, fileBuffer, {
        contentType: fileType || 'application/octet-stream',
        upsert: true,
      });

    if (uploadError) {
      // Fallback: store base64 directly if storage fails
      const { error: updateError } = await supabase
        .from('mobile_upload_sessions')
        .update({
          status: 'completed',
          file_name: fileName,
          file_type: fileType,
          file_size: fileSize,
          file_data: fileData,
          updated_at: new Date().toISOString(),
        })
        .eq('token', token);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    // Update session with storage path (small payload — realtime works reliably)
    const { error: updateError } = await supabase
      .from('mobile_upload_sessions')
      .update({
        status: 'completed',
        file_name: fileName,
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
