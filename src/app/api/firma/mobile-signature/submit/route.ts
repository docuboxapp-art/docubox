import { NextRequest, NextResponse } from 'next/server';
import { captureEncryptionKey, encryptCapture, normalizeImageBase64, validImageBase64 } from '@/lib/identity/capture-crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { hashCapabilityToken } from '@/lib/security/capability-token';

const MAX_STROKES_SIZE = 2_000_000;

function validBrowserGeolocation(geo: unknown) {
  const value = geo as { latitude?: unknown; longitude?: unknown } | null | undefined;
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function validToken(token: string) {
  return /^[a-f0-9]{64}$/i.test(token);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';
    const signatureDataUrl = typeof body.signatureDataUrl === 'string' ? body.signatureDataUrl : '';
    const strokes = Array.isArray(body.strokes) ? body.strokes : null;
    if (!validToken(token) || !/^data:image\/png;base64,/i.test(signatureDataUrl) || !strokes) {
      return NextResponse.json({ error: 'La firma no es válida.' }, { status: 400 });
    }
    if (!validBrowserGeolocation(body.sessionEvidence?.geo)) {
      return NextResponse.json(
        {
          error: 'La geolocalización del navegador es obligatoria para enviar la firma.',
          code: 'GEOLOCATION_REQUIRED',
        },
        { status: 422 }
      );
    }

    const signatureBase64 = normalizeImageBase64(signatureDataUrl);
    const strokesJson = JSON.stringify(strokes);
    if (!validImageBase64(signatureBase64) || strokesJson.length > MAX_STROKES_SIZE) {
      return NextResponse.json({ error: 'La firma excede el tamaño permitido.' }, { status: 413 });
    }

    const service = createServiceClient();
    const { data: session } = await service
      .from('mobile_upload_sessions')
      .select('id,metadata')
      .eq('token_hash', hashCapabilityToken(token))
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    const metadata = session?.metadata as Record<string, unknown> | null;
    if (!session || metadata?.mode !== 'signature_capture') {
      return NextResponse.json({ error: 'Enlace no válido o vencido.' }, { status: 404 });
    }

    const key = captureEncryptionKey();
    if (!key) return NextResponse.json({ error: 'El almacenamiento seguro no está disponible.' }, { status: 503 });

    const capture = {
      signatureDataUrl,
      strokes,
      sessionEvidence: body.sessionEvidence && typeof body.sessionEvidence === 'object' ? body.sessionEvidence : null,
      deviceFingerprint: body.deviceFingerprint && typeof body.deviceFingerprint === 'object' ? body.deviceFingerprint : null,
      capturedAt: new Date().toISOString(),
    };
    const { data: updated } = await service
      .from('mobile_upload_sessions')
      .update({
        status: 'completed',
        file_data: encryptCapture(JSON.stringify(capture), key),
        file_name: 'mobile-signature.enc',
        file_type: 'application/vnd.docubox.encrypted-capture+json',
        metadata: { ...metadata, completed_at: capture.capturedAt },
        updated_at: capture.capturedAt,
      })
      .eq('id', session.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!updated) return NextResponse.json({ error: 'El enlace ya fue utilizado o venció.' }, { status: 409 });

    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('[mobile-signature/submit] Could not store signature', error);
    return NextResponse.json({ error: 'No fue posible enviar la firma.' }, { status: 500 });
  }
}
