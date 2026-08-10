import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { userCanAccessDocument } from '../_shared/document-access.ts';

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sha256Bytes(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Auth
    const authHeader = req.headers.get('Authorization')
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '') || ''
    )
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const { document_id, selfie_b64, ine_front_b64, method } = await req.json()

    if (!await userCanAccessDocument(supabase, user, document_id)) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders })
    }

    // 1. SHA-256 de la selfie
    const selfieBytes = Uint8Array.from(
      atob(selfie_b64.split(',')[1]),
      (c) => c.charCodeAt(0)
    )
    const selfieHash = await sha256Bytes(selfieBytes.buffer)

    // 2. Subir selfie a Storage (bucket 'biometrics')
    const evidenceId = crypto.randomUUID()
    const selfiePath = `${document_id}/${evidenceId}/selfie.jpg`

    await supabase.storage.createBucket('biometrics', { public: false }).catch(() => {})
    await supabase.storage.from('biometrics').upload(selfiePath, selfieBytes, {
      contentType: 'image/jpeg',
    })

    // 3. Comparación facial via Nubarium (si hay INE)
    let faceMatchScore: number | null = null
    let faceMatchVerdict: string | null = null
    let nubariumRequestId: string | null = null

    if (method === 'selfie_ine' && ine_front_b64) {
      try {
        const nubariumUser = Deno.env.get('NUBARIUM_USER') || ''
        const nubariumPass = Deno.env.get('NUBARIUM_PASS') || Deno.env.get('NUBARIUM_PASSWORD') || ''
        const nubariumAuth = btoa(`${nubariumUser}:${nubariumPass}`)

        const resp = await fetch(
          'https://biometrics.nubarium.com/antifraude/reconocimiento_facial',
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${nubariumAuth}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              foto_rostro: selfie_b64.split(',')[1],
              foto_identificacion: ine_front_b64.split(',')[1],
            }),
            signal: AbortSignal.timeout(15000),
          }
        )
        const data = await resp.json()
        faceMatchScore = data.similitud || data.score
        nubariumRequestId = data.id_transaccion || data.request_id

        if (faceMatchScore !== null) {
          if (faceMatchScore >= 80) faceMatchVerdict = 'MATCH_ALTO'
          else if (faceMatchScore >= 65) faceMatchVerdict = 'MATCH_PROBABLE'
          else if (faceMatchScore >= 50) faceMatchVerdict = 'DUDOSO'
          else faceMatchVerdict = 'NO_MATCH'
        }

        // Subir INE a Storage también
        const ineBytes = Uint8Array.from(
          atob(ine_front_b64.split(',')[1]),
          (c) => c.charCodeAt(0)
        )
        await supabase.storage.from('biometrics').upload(
          `${document_id}/${evidenceId}/ine_front.jpg`,
          ineBytes,
          { contentType: 'image/jpeg' }
        )
      } catch {
        faceMatchVerdict = 'NUBARIUM_TIMEOUT'
      }
    }

    // 4. Persistir en DB — SOLO el hash, nunca la imagen
    await supabase.from('signature_evidence').insert({
      id: evidenceId,
      document_id,
      evidence_type: 'biometric_selfie',
      image_sha256: selfieHash,
      face_match_score: faceMatchScore,
      face_match_verdict: faceMatchVerdict,
      nubarium_request_id: nubariumRequestId,
      storage_selfie_path: selfiePath,
      biometric_method: method,
      captured_by: user.id,
      captured_at: new Date().toISOString(),
    })

    return new Response(
      JSON.stringify({
        biometric_evidence_id: evidenceId,
        selfie_sha256: selfieHash,
        face_match_score: faceMatchScore,
        face_match_verdict: faceMatchVerdict,
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
