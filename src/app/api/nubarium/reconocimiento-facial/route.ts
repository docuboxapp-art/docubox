import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    let body: { credencial?: string; captura?: string; enrollmentToken?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Payload inválido o demasiado grande.' }, { status: 400 });
    }

    const { credencial, captura, enrollmentToken } = body;

    if (!credencial || !captura) {
      return NextResponse.json({ error: 'Se requieren las imágenes de credencial y selfie' }, { status: 400 });
    }

    const nubariumUser = process.env.NUBARIUM_USER || '';
    const nubariumPass = process.env.NUBARIUM_PASS || '';

    if (!nubariumUser || !nubariumPass) {
      console.error('[reconocimiento-facial] Missing Nubarium credentials');
      return NextResponse.json({ error: 'Configuración de servicio biométrico incompleta' }, { status: 500 });
    }

    const credentials = Buffer.from(`${nubariumUser}:${nubariumPass}`).toString('base64');

    // Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
    const cleanBase64 = (dataUrl: string): string => {
      if (dataUrl.startsWith('data:')) {
        return dataUrl.split(',')[1] || dataUrl;
      }
      return dataUrl;
    };

    const cleanCredencial = cleanBase64(credencial);
    const cleanCaptura = cleanBase64(captura);

    console.log(`[reconocimiento-facial] Sending request to Nubarium, tipo=imagen, credencial_len=${cleanCredencial.length}, captura_len=${cleanCaptura.length}`);

    const payload = {
      credencial: cleanCredencial,
      captura: cleanCaptura,
      tipo: 'imagen',
      limiteInferior: '75',
    };

    let data: Record<string, unknown> = {};
    try {
      const nubariumRes = await fetch('https://biometrics.nubarium.com/antifraude/reconocimiento_facial', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      // Always try to parse JSON — Nubarium returns JSON even on error status codes
      try {
        data = await nubariumRes.json();
      } catch {
        if (!nubariumRes.ok) {
          console.error(`[reconocimiento-facial] Nubarium HTTP error ${nubariumRes.status} (no JSON body)`);
          return NextResponse.json(
            { error: `Error del servicio biométrico (${nubariumRes.status}). Intente nuevamente.`, networkError: true },
            { status: 502 }
          );
        }
      }

      console.log('[reconocimiento-facial] Nubarium response:', JSON.stringify({
        estatus: data.estatus,
        mensaje: data.mensaje,
        similitud: data.similitud,
        status: nubariumRes.status,
      }));

    } catch (fetchErr) {
      console.error('[reconocimiento-facial] Fetch error:', fetchErr);
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      const isTimeout = errMsg.includes('TimeoutError') || errMsg.includes('AbortError') || errMsg.includes('timeout');
      return NextResponse.json(
        {
          error: isTimeout
            ? 'Tiempo de espera agotado al validar la identidad facial. Intente nuevamente.'
            : 'Error de conexión al validar la identidad facial. Intente nuevamente.',
          networkError: true,
        },
        { status: 502 }
      );
    }

    const similitud: number = typeof data.similitud === 'number' ? data.similitud : 0;
    const aprobado = similitud >= 99.50;
    const estatus = (data.estatus as string) || '';
    const mensaje = (data.mensaje as string) || '';

    // Determine if this is a similarity rejection vs a real error
    const isSimilarityRejection = estatus === 'ERROR' && (
      mensaje.toLowerCase().includes('similitud') ||
      mensaje.toLowerCase().includes('rostro') ||
      typeof data.similitud === 'number'
    );

    // Save log to Supabase using server client
    try {
      const supabase = await createClient();
      await supabase.from('face_comparison_logs').insert({
        enrollment_token: enrollmentToken || null,
        estatus: estatus || null,
        mensaje: mensaje || null,
        similitud,
        aprobado,
        codigo_validacion: data.codigoValidacion || null,
        raw_response: data,
      });
    } catch (dbError) {
      console.error('[reconocimiento-facial] Error saving log to DB:', dbError);
    }

    return NextResponse.json({
      ...data,
      similitud,
      aprobado,
      tipo_usado: 'imagen',
      isSimilarityRejection,
      networkError: false,
    });
  } catch (error) {
    console.error('[reconocimiento-facial] Unexpected error:', error);
    return NextResponse.json({ error: 'Error interno al comparar rostros. Intente nuevamente.', networkError: true }, { status: 500 });
  }
}
