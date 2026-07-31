import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';

const NUBARIUM_ENDPOINT = 'https://api.nubarium.com/sat/v1/validar-serial';

// Always returns HTTP 200 — errors are communicated via the JSON body
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, _es_valido: false, error: 'Cuerpo de la solicitud inválido (se esperaba JSON)', _estado_normalizado: 'Error' },
        { status: 200 }
      );
    }

    const rfc = ((body.rfc as string | undefined | null) || '').trim();
    const curp = ((body.curp as string | undefined | null) || '').trim();
    const serial = ((body.serial as string | undefined | null) || '').trim();

    // Accept rfc OR curp — at least one is required
    const identifier = rfc || curp;

    if (!identifier) {
      return NextResponse.json(
        { success: false, _es_valido: false, error: 'El RFC o CURP del certificado es requerido. Verifica que el archivo .cer sea válido y contenga el RFC o CURP.', _estado_normalizado: 'Error' },
        { status: 200 }
      );
    }

    if (!serial) {
      return NextResponse.json(
        { success: false, _es_valido: false, error: 'El número de serie del certificado es requerido. Verifica que el archivo .cer sea válido.', _estado_normalizado: 'Error' },
        { status: 200 }
      );
    }

    const nubariumUser = process.env.NUBARIUM_USER || process.env.NUBARIUM_API_KEY || '';
    const nubariumPass = process.env.NUBARIUM_PASS || process.env.NUBARIUM_API_SECRET || '';

    if (!nubariumUser || !nubariumPass) {
      console.error('[nubarium/validar-serial] Missing credentials');
      return NextResponse.json(
        { success: false, _es_valido: false, error: 'Credenciales de Nubarium no configuradas', _estado_normalizado: 'Error' },
        { status: 200 }
      );
    }

    const credentials = Buffer.from(`${nubariumUser}:${nubariumPass}`).toString('base64');

    // Build request body: prefer rfc, fall back to curp
    const requestBody: Record<string, string> = { serial };
    if (rfc) {
      requestBody.rfc = rfc;
    } else {
      requestBody.curp = curp;
    }

    console.log('[nubarium/validar-serial] Calling Nubarium with identifier:', rfc ? `RFC=${rfc}` : `CURP=${curp}`, '| serial:', serial);

    let httpStatus = 0;
    let rawText = '';
    let data: Record<string, unknown> = {};
    let fetchError: string | null = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(NUBARIUM_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${credentials}`,
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      httpStatus = response.status;
      rawText = await response.text();

      console.log('[nubarium/validar-serial] HTTP status:', httpStatus);
      console.log('[nubarium/validar-serial] Raw response:', rawText);
    } catch (err) {
      fetchError = String(err);
      console.error('[nubarium/validar-serial] Fetch error:', fetchError);
    }

    // Network / timeout error
    if (fetchError || httpStatus === 0) {
      return NextResponse.json(
        {
          success: false,
          _es_valido: false,
          _estado_normalizado: 'Error de conexión',
          _http_status: 0,
          _clave_mensaje_detectada: null,
          error: 'No se pudo conectar con el servicio de validación del SAT. Intenta nuevamente.',
          fetch_error: fetchError,
          estado: 'Error de conexión',
          clave_mensaje: null,
          codigo_validacion: null,
        },
        { status: 200 }
      );
    }

    // Auth failure
    if (httpStatus === 401 || httpStatus === 403) {
      console.error('[nubarium/validar-serial] Authentication failed, status:', httpStatus);
      return NextResponse.json(
        {
          success: false,
          _es_valido: false,
          _estado_normalizado: 'Error de autenticación',
          _http_status: httpStatus,
          _clave_mensaje_detectada: null,
          error: 'Error de autenticación con el servicio de validación.',
          estado: 'Error de autenticación',
          clave_mensaje: null,
          codigo_validacion: null,
        },
        { status: 200 }
      );
    }

    // Parse JSON
    try {
      data = JSON.parse(rawText);
    } catch {
      console.warn('[nubarium/validar-serial] Response is not JSON:', rawText);
      data = { raw_text: rawText };
    }

    // ── Validity: estado="Activo" OR clave_mensaje=0 (per API docs) ──────────
    const estadoRaw = (data.estado as string) || '';
    const claveMensaje = typeof data.clave_mensaje === 'number' ? data.clave_mensaje : null;

    const estadoActivo =
      estadoRaw.toLowerCase() === 'activo' ||
      estadoRaw.toLowerCase() === 'vigente';

    const claveOk = claveMensaje === 0;

    const estadoInactivo =
      estadoRaw.toLowerCase() === 'revocado' ||
      estadoRaw.toLowerCase() === 'suspendido' ||
      estadoRaw.toLowerCase() === 'cancelado' ||
      estadoRaw.toLowerCase() === 'no vigente' ||
      estadoRaw.toLowerCase() === 'expirado';

    const isValid = estadoActivo || (claveOk && !estadoInactivo);

    const estadoNormalizado = estadoRaw || (isValid ? 'Activo' : 'No vigente');

    console.log('[nubarium/validar-serial] estado:', estadoRaw, '| clave_mensaje:', claveMensaje, '| isValid:', isValid);

    // Save to Supabase (non-blocking)
    try {
      const supabase = await createServerClient();
      await supabase.from('serial_validations').insert({
        rfc: rfc || null,
        serial: serial,
        estado: estadoNormalizado,
        tipo: (data.tipo as string) || null,
        fecha_inicio: (data.fecha_inicio as string) || null,
        fecha_fin: (data.fecha_fin as string) || null,
        clave_mensaje: claveMensaje,
        codigo_validacion: (data.codigo_validacion as string) || null,
        raw_response: data,
      });
    } catch (dbError) {
      console.error('[nubarium/validar-serial] DB save error:', dbError);
    }

    return NextResponse.json({
      ...data,
      success: true,
      _estado_normalizado: estadoNormalizado,
      _es_valido: isValid,
      _http_status: httpStatus,
      _clave_mensaje_detectada: claveMensaje,
      estado: estadoNormalizado,
      clave_mensaje: claveMensaje,
      codigo_validacion: (data.codigo_validacion as string) || null,
    });
  } catch (error) {
    console.error('[nubarium/validar-serial] Unexpected error:', error);
    return NextResponse.json(
      {
        success: false,
        _es_valido: false,
        _estado_normalizado: 'Error interno',
        _http_status: 0,
        _clave_mensaje_detectada: null,
        error: 'Error interno al validar el número de serie',
        estado: 'Error interno',
        clave_mensaje: null,
        codigo_validacion: null,
      },
      { status: 200 }
    );
  }
}
