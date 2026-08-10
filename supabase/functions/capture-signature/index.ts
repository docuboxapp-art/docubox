import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { userCanAccessDocument } from '../_shared/document-access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      (globalThis as any).Deno?.env.get('SUPABASE_URL') ?? '',
      (globalThis as any).Deno?.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Verificar autenticación
    const authHeader = req.headers.get('Authorization')
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '') || ''
    )
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const body = await req.json()
    const {
      document_id, image_b64, strokes,
      image_sha256, strokes_sha256, combined_sha256,
      human_score, anomaly_flags, avg_pressure,
      total_strokes, total_duration_ms,
      device_fingerprint, session_evidence
    } = body

    if (!await userCanAccessDocument(supabase, user, document_id)) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders })
    }

    // 2. Verificar SHA-256 de la imagen recibida
    const imageBytes = Uint8Array.from(
      atob(image_b64.split(',')[1]),
      (c) => c.charCodeAt(0)
    )
    const hashBuffer = await crypto.subtle.digest('SHA-256', imageBytes)
    const computedHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    if (computedHash !== image_sha256) {
      return new Response(
        JSON.stringify({ error: 'SHA-256 de imagen no coincide' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Obtener IP real del firmante
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'

    // 4. Subir imagen a Supabase Storage (bucket privado 'signatures')
    const storagePath = `${document_id}/autograph_${Date.now()}.png`
    const { error: uploadError } = await supabase.storage
      .from('signatures')
      .upload(storagePath, imageBytes, {
        contentType: 'image/png',
        upsert: false,
      })

    if (uploadError) {
      // Try to create bucket if not exists
      await supabase.storage.createBucket('signatures', { public: false })
      const { error: retryError } = await supabase.storage
        .from('signatures')
        .upload(storagePath, imageBytes, { contentType: 'image/png', upsert: false })
      if (retryError) {
        return new Response(
          JSON.stringify({ error: 'Error subiendo imagen: ' + retryError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // 5. Subir vector de trazos a Storage (bucket privado 'evidence')
    const strokesJson = JSON.stringify(strokes)
    const strokesBytes = new TextEncoder().encode(strokesJson)
    const strokesPath = `${document_id}/strokes_${Date.now()}.json`

    await supabase.storage.createBucket('evidence', { public: false }).catch(() => {})
    await supabase.storage
      .from('evidence')
      .upload(strokesPath, strokesBytes, { contentType: 'application/json' })

    // 6. Persistir evidencia en signature_evidence (SOLO hashes, nunca imágenes)
    const evidenceId = crypto.randomUUID()
    const { error: dbError } = await supabase.from('signature_evidence').insert({
      id: evidenceId,
      document_id,
      evidence_type: 'autograph_signature',
      image_sha256,
      strokes_sha256,
      combined_sha256,
      human_score,
      anomaly_flags,
      avg_pressure,
      total_strokes,
      total_duration_ms,
      storage_image_path: storagePath,
      storage_strokes_path: strokesPath,
      ip_address: ip,
      user_agent: session_evidence?.user_agent,
      timezone: session_evidence?.timezone,
      geo_latitude: session_evidence?.geo?.latitude,
      geo_longitude: session_evidence?.geo?.longitude,
      geo_accuracy_m: session_evidence?.geo?.accuracy_meters,
      fingerprint_id: device_fingerprint?.fingerprint_id,
      captured_by: user.id,
      captured_at: new Date().toISOString(),
    })

    if (dbError) {
      return new Response(
        JSON.stringify({ error: dbError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 7. Update firma_autografa_last_used in user_profiles
    await supabase
      .from('user_profiles')
      .update({ firma_autografa_last_used: new Date().toISOString() })
      .eq('id', user.id)

    return new Response(
      JSON.stringify({
        evidence_id: evidenceId,
        image_sha256,
        strokes_sha256,
        combined_sha256,
        ip_address: ip,
        captured_at: new Date().toISOString(),
        status: 'captured',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
