import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await req.json();
    const {
      token,
      anversoData,
      reversoData,
      selfieData,
      selfieVideo,
      // OCR extracted data passed from mobile
      curpExtracted,
      nombreExtracted,
      // Fallback: profile CURP already resolved on the mobile client side
      curpProfileFallback,
      // Flag: true when the mobile page used a previously stored identification
      usingStoredId,
    } = body;

    if (!token || !selfieData) {
      return NextResponse.json({ error: 'Datos incompletos. Se requiere al menos la selfie.' }, { status: 400 });
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

    const hasEnrollment = session.metadata?.has_enrollment === true;
    const userId = session.metadata?.user_id || null;
    const documentId = session.metadata?.document_id || null;

    // If user has enrollment OR is using a stored ID, only selfie is required; otherwise require all 3
    if (!hasEnrollment && !usingStoredId && (!anversoData || !reversoData)) {
      return NextResponse.json({ error: 'Datos incompletos. Se requieren anverso, reverso y selfie.' }, { status: 400 });
    }

    // ── Load authenticated user profile for identity comparison ──────────────
    let userProfile: { curp?: string; nombre?: string; email?: string } | null = null;
    if (userId) {
      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('curp, full_name, email')
          .eq('id', userId)
          .maybeSingle();
        if (profile) {
          userProfile = {
            curp: profile.curp || undefined,
            nombre: profile.full_name || undefined,
            email: profile.email || undefined,
          };
        }
      } catch {
        // Non-blocking
      }
    }

    // ── CURP comparison: OCR extracted CURP vs user profile CURP ─────────────
    let curpMatch: boolean | null = null;
    let curpMismatchReason: string | null = null;
    // Use server-side profile CURP first; fall back to the value sent by the mobile client
    const profileCurp =
      userProfile?.curp?.trim().toUpperCase() ||
      (curpProfileFallback ? String(curpProfileFallback).trim().toUpperCase() : null) ||
      null;
    const ocrCurp = curpExtracted?.trim().toUpperCase() || null;

    if (profileCurp && ocrCurp) {
      curpMatch = profileCurp === ocrCurp;
      if (!curpMatch) {
        curpMismatchReason = `La CURP de la identificación (${ocrCurp}) no coincide con la CURP del usuario registrado (${profileCurp}).`;
      }
    } else if (ocrCurp && !profileCurp) {
      // No profile CURP to compare — treat as inconclusive but not a mismatch
      curpMatch = null;
    }

    // ── Nubarium facial recognition validation ────────────────────────────────
    let nubariumResult: Record<string, unknown> | null = null;
    const credencial = anversoData || null;

    const nubariumUser = process.env.NUBARIUM_USER || '';
    const nubariumPass = process.env.NUBARIUM_PASS || '';
    const cleanBase64 = (dataUrl: string): string =>
      dataUrl.startsWith('data:') ? dataUrl.split(',')[1] || dataUrl : dataUrl;

    if (credencial && selfieData && nubariumUser && nubariumPass) {
      // New capture: compare anverso vs selfie directly
      try {
        const credentials = Buffer.from(`${nubariumUser}:${nubariumPass}`).toString('base64');
        const nubariumRes = await fetch('https://biometrics.nubarium.com/antifraude/reconocimiento_facial', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${credentials}`,
          },
          body: JSON.stringify({
            credencial: cleanBase64(credencial),
            captura: cleanBase64(selfieData),
            tipo: 'imagen',
            limiteInferior: '75',
          }),
          signal: AbortSignal.timeout(30000),
        });
        try {
          nubariumResult = await nubariumRes.json();
        } catch {
          nubariumResult = null;
        }
      } catch {
        nubariumResult = null;
      }
    } else if (hasEnrollment && selfieData && userId && nubariumUser && nubariumPass) {
      // User has enrollment — fetch their stored INE front image from enrollment_results
      try {
        const { data: enrollData } = await supabase
          .from('enrollment_results')
          .select('anverso_url, raw_response')
          .eq('user_id', userId)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const storedAnverso = enrollData?.raw_response?.anverso_b64 || null;
        if (storedAnverso) {
          const credentials = Buffer.from(`${nubariumUser}:${nubariumPass}`).toString('base64');
          const nubariumRes = await fetch('https://biometrics.nubarium.com/antifraude/reconocimiento_facial', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${credentials}`,
            },
            body: JSON.stringify({
              credencial: cleanBase64(storedAnverso),
              captura: cleanBase64(selfieData),
              tipo: 'imagen',
              limiteInferior: '75',
            }),
            signal: AbortSignal.timeout(30000),
          });
          try {
            nubariumResult = await nubariumRes.json();
          } catch {
            nubariumResult = null;
          }
        }
      } catch {
        nubariumResult = null;
      }
    } else if (!credencial && selfieData && userId && nubariumUser && nubariumPass) {
      // No anverso provided — try to find stored identification from id_capture_logs
      try {
        const { data: idLog } = await supabase
          .from('id_capture_logs')
          .select('anverso_b64')
          .eq('user_id', userId)
          .not('anverso_b64', 'is', null)
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const storedAnverso = idLog?.anverso_b64 || null;
        if (storedAnverso) {
          const credentials = Buffer.from(`${nubariumUser}:${nubariumPass}`).toString('base64');
          const nubariumRes = await fetch('https://biometrics.nubarium.com/antifraude/reconocimiento_facial', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${credentials}`,
            },
            body: JSON.stringify({
              credencial: cleanBase64(storedAnverso),
              captura: cleanBase64(selfieData),
              tipo: 'imagen',
              limiteInferior: '75',
            }),
            signal: AbortSignal.timeout(30000),
          });
          try {
            nubariumResult = await nubariumRes.json();
          } catch {
            nubariumResult = null;
          }
        }
      } catch {
        nubariumResult = null;
      }
    }

    const nubariumSimilitud: number | null =
      typeof nubariumResult?.similitud === 'number' ? (nubariumResult.similitud as number) : null;
    const nubariumAprobado: boolean | null =
      nubariumSimilitud !== null ? nubariumSimilitud >= 99.50 : null;

    // ── Identity match check against registered user ──────────────────────────
    let identityMatch: boolean | null = null;
    let identityMismatchReason: string | null = null;

    if (nubariumSimilitud !== null) {
      if (nubariumAprobado) {
        identityMatch = true;
      } else {
        identityMatch = false;
        identityMismatchReason =
          nubariumSimilitud < 75
            ? 'El rostro capturado no coincide con la identificación presentada.'
            : `Similitud facial insuficiente (${nubariumSimilitud.toFixed(2)}%). Se requiere al menos 99.50%.`;
      }
    }

    // ── Log the consultation in Supabase (including identification images) ────
    let captureLogId: string | null = null;
    try {
      const ipAddress =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        null;
      const userAgent = req.headers.get('user-agent') || null;

      const { data: logData } = await supabase.from('id_capture_logs').insert({
        session_token: token,
        user_id: userId || null,
        document_id: documentId || null,
        has_enrollment: hasEnrollment,
        nubarium_similitud: nubariumSimilitud,
        nubarium_aprobado: nubariumAprobado,
        identity_match: identityMatch,
        identity_mismatch_reason: identityMismatchReason,
        raw_nubarium_response: nubariumResult,
        captured_at: new Date().toISOString(),
        ip_address: ipAddress,
        user_agent: userAgent,
        // Store full images for posterior consultation
        anverso_b64: anversoData || null,
        reverso_b64: reversoData || null,
        selfie_b64: selfieData || null,
        selfie_video_b64: selfieVideo || null,
        curp_extracted: ocrCurp || null,
        nombre_extracted: nombreExtracted || null,
        curp_match: curpMatch,
        curp_profile: profileCurp || null,
        document_id_ref: documentId || null,
      }).select('id').single();

      if (logData?.id) captureLogId = logData.id;

      // Also log to document_activity_log if documentId is available
      if (documentId) {
        await supabase.from('document_activity_log').insert({
          document_id: documentId,
          user_id: userId || null,
          action: 'id_capture_prueba_vida',
          details: {
            session_token: token,
            capture_log_id: captureLogId,
            nubarium_similitud: nubariumSimilitud,
            nubarium_aprobado: nubariumAprobado,
            identity_match: identityMatch,
            has_enrollment: hasEnrollment,
            user_profile_curp: profileCurp || null,
            ocr_curp: ocrCurp || null,
            curp_match: curpMatch,
            user_profile_nombre: userProfile?.nombre || null,
            anverso_captured: !!anversoData,
            reverso_captured: !!reversoData,
            selfie_captured: !!selfieData,
            ip_address: ipAddress,
            captured_at: new Date().toISOString(),
          },
          created_at: new Date().toISOString(),
        }).catch(() => {}); // Non-blocking
      }
    } catch (logErr) {
      console.error('[submit-id-capture] Error saving log:', logErr);
      // Non-blocking — don't fail the request
    }

    // ── If identity doesn't match, return error without completing session ────
    if (identityMatch === false) {
      // Still update the session so the desktop polling can detect the result
      await supabase
        .from('mobile_upload_sessions')
        .update({
          status: 'identity_failed',
          file_data: selfieData,
          file_name: 'id_capture',
          file_type: 'image/jpeg',
          metadata: {
            ...(session.metadata || {}),
            mode: 'id_capture',
            selfie: selfieData,
            selfie_video: selfieVideo || null,
            captured_at: new Date().toISOString(),
            nubarium_result: nubariumResult,
            nubarium_similitud: nubariumSimilitud,
            nubarium_aprobado: false,
            identity_match: false,
            identity_mismatch_reason: identityMismatchReason,
            curp_match: curpMatch,
            curp_extracted: ocrCurp || null,
            capture_log_id: captureLogId,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('token', token)
        .catch(() => {}); // Non-blocking — don't fail the response

      return NextResponse.json(
        {
          error: 'La persona capturada no coincide con el usuario registrado.',
          identity_mismatch: true,
          nubarium_similitud: nubariumSimilitud,
          nubarium_aprobado: false,
          mismatch_reason: identityMismatchReason,
        },
        { status: 422 }
      );
    }

    // ── Store all captures in the session ─────────────────────────────────────
    const { error: updateError } = await supabase
      .from('mobile_upload_sessions')
      .update({
        status: 'completed',
        file_data: selfieData,
        file_name: 'id_capture',
        file_type: 'image/jpeg',
        metadata: {
          ...(session.metadata || {}),
          mode: 'id_capture',
          anverso: anversoData || null,
          reverso: reversoData || null,
          selfie: selfieData,
          selfie_video: selfieVideo || null,
          captured_at: new Date().toISOString(),
          nubarium_result: nubariumResult,
          nubarium_similitud: nubariumSimilitud,
          nubarium_aprobado: nubariumAprobado,
          identity_match: identityMatch,
          curp_match: curpMatch,
          curp_extracted: ocrCurp || null,
          nombre_extracted: nombreExtracted || null,
          capture_log_id: captureLogId,
          user_profile_compared: userProfile ? {
            curp: profileCurp || null,
            nombre: userProfile.nombre || null,
          } : null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('token', token);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      nubarium_similitud: nubariumSimilitud,
      nubarium_aprobado: nubariumAprobado,
      identity_match: identityMatch,
      curp_match: curpMatch,
      curp_extracted: ocrCurp || null,
      curp_profile: profileCurp || null,
      curp_mismatch_reason: curpMismatchReason || null,
      capture_log_id: captureLogId,
      user_profile_compared: userProfile ? {
        curp: profileCurp || null,
        nombre: userProfile.nombre || null,
      } : null,
    });
  } catch (err: any) {
    console.error('[submit-id-capture] Unexpected error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
