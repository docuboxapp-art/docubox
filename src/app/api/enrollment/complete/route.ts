import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      token,
      nombre,
      apellidoPaterno,
      apellidoMaterno,
      curp,
      rfc,
      fechaNacimiento,
      sexo,
      tipoIdentificacion,
      rawData,
      selfieVideo,
      anversoCapture,
    } = body;

    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    // Use service client to bypass RLS in API routes
    const supabase = createServiceClient();

    // Verify token exists and is not expired
    const { data: tokenData, error: fetchError } = await supabase
      .from('enrollment_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (fetchError || !tokenData) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }

    if (new Date(tokenData.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Token expired', expired: true }, { status: 410 });
    }

    if (tokenData.status === 'completed') {
      return NextResponse.json({ error: 'Token already used' }, { status: 409 });
    }

    // Update token with enrollment data and mark completed
    const { error: updateError } = await supabase
      .from('enrollment_tokens')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        nombre,
        apellido_paterno: apellidoPaterno,
        apellido_materno: apellidoMaterno,
        curp,
        rfc,
        fecha_nacimiento: fechaNacimiento,
        sexo,
        tipo_identificacion: tipoIdentificacion,
        raw_data: rawData || null,
      })
      .eq('token', token);

    if (updateError) {
      console.error('[complete] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to complete enrollment' }, { status: 500 });
    }

    // Create enrollment_results entry (triggers Realtime INSERT event to webapp)
    const { data: resultData, error: resultError } = await supabase
      .from('enrollment_results')
      .insert({
        enrollment_token_id: tokenData.id,
        user_id: tokenData.user_id || null,
        token,
        session_id: tokenData.session_id,
        nombre,
        apellido_paterno: apellidoPaterno,
        apellido_materno: apellidoMaterno,
        curp,
        rfc,
        fecha_nacimiento: fechaNacimiento,
        sexo,
        tipo_identificacion: tipoIdentificacion,
        face_encoding_encrypted: tokenData.face_encoding_encrypted || null,
        encryption_iv: tokenData.encryption_iv || null,
        face_match_score: tokenData.face_match_score || null,
        face_match_passed: tokenData.face_match_score ? tokenData.face_match_score >= 80 : false,
        document_metadata: tokenData.document_metadata || null,
        status: 'completed',
        notified_at: new Date().toISOString(),
        raw_response: {
          selfie_video_b64: selfieVideo || null,
          anverso_b64: anversoCapture || null,
        },
      })
      .select('id')
      .single();

    if (resultError) {
      console.error('[complete] enrollment_results insert error:', resultError);
      // Non-fatal: token is already marked completed, just log the error
    }

    // ── Update biometric_verified in user_verification_status ──────────────
    const userId = tokenData.user_id || resultData?.id ? tokenData.user_id : null;
    if (userId && resultData?.id) {
      const faceMatchPassed =
        tokenData.face_match_score != null ? tokenData.face_match_score >= 80 : false;

      if (faceMatchPassed) {
        const { error: verifyError } = await supabase
          .from('user_verification_status')
          .update({
            biometric_verified: true,
            enrollment_result_id: resultData.id,
          })
          .eq('user_id', userId);

        if (verifyError) {
          console.error('[complete] Failed to update biometric_verified:', verifyError);
        }
      }
    }

    return NextResponse.json({
      success: true,
      enrollmentResultId: resultData?.id || null,
    });
  } catch (err) {
    console.error('[complete] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
