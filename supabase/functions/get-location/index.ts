import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { userCanAccessDocument } from '../_shared/document-access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface LocationResult {
  country: string;
  country_code: string;
  state: string;
  city: string;
  formatted: string;
  source: 'cache' | 'opencage' | 'fallback';
}

const FALLBACK_RESULT: Omit<LocationResult, 'source'> = {
  country: 'Desconocido',
  country_code: 'XX',
  state: 'Desconocido',
  city: 'Desconocido',
  formatted: 'Desconocido',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { lat, lon, document_id, signer_id } = body;

    if (lat === undefined || lat === null || lon === undefined || lon === null) {
      return new Response(
        JSON.stringify({ ...FALLBACK_RESULT, source: 'fallback', error: 'lat y lon son requeridos' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);

    if (isNaN(latNum) || isNaN(lonNum)) {
      return new Response(
        JSON.stringify({ ...FALLBACK_RESULT, source: 'fallback', error: 'lat y lon deben ser números válidos' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build cache key: lat and lon rounded to 2 decimal places
    const cacheKey = `${latNum.toFixed(2)},${lonNum.toFixed(2)}`;

    // Initialize Supabase client with service role key
    const supabaseUrl = (globalThis as any).Deno?.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = (globalThis as any).Deno?.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const opencageApiKey = (globalThis as any).Deno?.env.get('OPENCAGE_API_KEY') ?? '';

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authHeader = req.headers.get('Authorization');
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '') || ''
    );
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
    if (document_id && !await userCanAccessDocument(supabase, user, document_id)) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders });
    }

    // ── 1. Check geocode_cache ────────────────────────────────────────────────
    try {
      const { data: cached, error: cacheError } = await supabase
        .from('geocode_cache')
        .select('result')
        .eq('cache_key', cacheKey)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (!cacheError && cached?.result) {
        const cachedResult: LocationResult = { ...(cached.result as any), source: 'cache' };

        // If document_id and signer_id provided, upsert geolocation into document_evidence
        if (document_id && signer_id) {
          await upsertDocumentEvidence(supabase, document_id, signer_id, latNum, lonNum, cachedResult);
        }

        return new Response(
          JSON.stringify(cachedResult),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch {
      // Cache check failed — continue to OpenCage
    }

    // ── 2. Call OpenCage API ─────────────────────────────────────────────────
    if (!opencageApiKey) {
      const fallback: LocationResult = { ...FALLBACK_RESULT, source: 'fallback' };
      return new Response(
        JSON.stringify(fallback),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let locationResult: LocationResult;

    try {
      const opencageUrl = new URL('https://api.opencagedata.com/geocode/v1/json');
      opencageUrl.searchParams.set('q', `${latNum},${lonNum}`);
      opencageUrl.searchParams.set('key', opencageApiKey);
      opencageUrl.searchParams.set('no_annotations', '1');
      opencageUrl.searchParams.set('limit', '1');
      opencageUrl.searchParams.set('language', 'es');

      const opencageRes = await fetch(opencageUrl.toString());

      if (!opencageRes.ok) {
        throw new Error(`OpenCage API error: ${opencageRes.status}`);
      }

      const opencageData = await opencageRes.json();
      const result = opencageData?.results?.[0];

      if (!result) {
        throw new Error('No results from OpenCage');
      }

      const components = result.components ?? {};

      const country = components.country ?? 'Desconocido';
      const country_code = (components.country_code ?? 'XX').toUpperCase();
      const state =
        components.state ??
        components.county ??
        components.region ??
        'Desconocido';
      const city =
        components.city ??
        components.town ??
        components.village ??
        components.municipality ??
        components.suburb ??
        'Desconocido';
      const formatted = result.formatted ?? 'Desconocido';

      locationResult = { country, country_code, state, city, formatted, source: 'opencage' };

      // ── 3. Save to geocode_cache ───────────────────────────────────────────
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const cachePayload = { country, country_code, state, city, formatted };

      await supabase
        .from('geocode_cache')
        .upsert(
          {
            cache_key: cacheKey,
            result: cachePayload,
            expires_at: expiresAt.toISOString(),
          },
          { onConflict: 'cache_key' }
        )
        .catch(() => {}); // non-critical if cache save fails

    } catch {
      // OpenCage failed — return fallback, don't block signing
      locationResult = { ...FALLBACK_RESULT, source: 'fallback' };
    }

    // ── 4. Upsert document_evidence if document_id and signer_id provided ───
    if (document_id && signer_id) {
      await upsertDocumentEvidence(supabase, document_id, signer_id, latNum, lonNum, locationResult);
    }

    return new Response(
      JSON.stringify(locationResult),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    // Top-level error handler — always return 200 so signing is never blocked
    const fallback: LocationResult = { ...FALLBACK_RESULT, source: 'fallback' };
    return new Response(
      JSON.stringify({ ...fallback, _error: String(err) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function upsertDocumentEvidence(
  supabase: ReturnType<typeof createClient>,
  document_id: string,
  signer_id: string,
  lat: number,
  lon: number,
  location: LocationResult
): Promise<void> {
  try {
    const geolocation = {
      lat,
      lon,
      country: location.country,
      country_code: location.country_code,
      state: location.state,
      city: location.city,
      formatted: location.formatted,
      source: location.source,
    };

    await supabase
      .from('document_evidence')
      .upsert(
        {
          document_id,
          signer_id,
          geolocation,
        },
        { onConflict: 'document_id,signer_id' }
      );
  } catch {
    // Non-critical — don't throw
  }
}
