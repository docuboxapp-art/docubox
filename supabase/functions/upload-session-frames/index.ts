import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sha256Hex(data: string): Promise<string> {
  const buf = new TextEncoder().encode(data)
  const digest = await crypto.subtle.digest('SHA-256', buf)
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
      (typeof (globalThis as any).Deno !== 'undefined' ? (globalThis as any).Deno.env.get('SUPABASE_URL') : (typeof process !== 'undefined' ? process.env.SUPABASE_URL : undefined)) as string,
      (typeof (globalThis as any).Deno !== 'undefined' ? (globalThis as any).Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') : (typeof process !== 'undefined' ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined)) as string
    )

    // Auth
    const authHeader = req.headers.get('Authorization')
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '') || ''
    )
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const { manifest, images } = await req.json()

    // 1. Verificar SHA-256 de cada frame
    for (const img of images) {
      const frameBytes = Uint8Array.from(
        atob(img.image_b64.split(',')[1]),
        (c) => c.charCodeAt(0)
      )
      const hashBuffer = await crypto.subtle.digest('SHA-256', frameBytes)
      const computed = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const expected = manifest.frames.find((f: any) => f.frame_id === img.frame_id)?.sha256

      if (computed !== expected) {
        return new Response(
          JSON.stringify({ error: `SHA-256 inválido en frame ${img.frame_id}` }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // 2. Verificar chain_hash
    const computedChain = await sha256Hex(manifest.frames.map((f: any) => f.sha256).join('|'))
    if (computedChain !== manifest.chain_hash) {
      return new Response(
        JSON.stringify({ error: 'chain_hash inválido' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Subir cada frame a Supabase Storage (bucket 'session-captures')
    const sessionId = crypto.randomUUID()
    const storedPaths: string[] = []

    await supabase.storage.createBucket('session-captures', { public: false }).catch(() => {})

    for (const img of images) {
      const frameBytes = Uint8Array.from(
        atob(img.image_b64.split(',')[1]),
        (c) => c.charCodeAt(0)
      )
      const path = `${manifest.document_id}/${sessionId}/${img.frame_id}.jpg`

      await supabase.storage.from('session-captures').upload(path, frameBytes, {
        contentType: 'image/jpeg',
      })
      storedPaths.push(path)
    }

    // 4. Guardar manifiesto en signature_evidence (solo hashes y paths)
    await supabase.from('signature_evidence').insert({
      id: sessionId,
      document_id: manifest.document_id,
      evidence_type: 'session_capture',
      combined_sha256: manifest.chain_hash,
      total_frames: manifest.total_frames,
      storage_frames_paths: storedPaths,
      frame_events: manifest.frames.map((f: any) => ({
        frame_id: f.frame_id,
        event: f.event,
        timestamp: f.timestamp,
        sha256: f.sha256,
        size_bytes: f.size_bytes,
      })),
      captured_by: user.id,
      captured_at: new Date().toISOString(),
    })

    return new Response(
      JSON.stringify({
        session_capture_id: sessionId,
        frames_stored: storedPaths.length,
        chain_hash: manifest.chain_hash,
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
