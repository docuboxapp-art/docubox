import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, idReverso, enrollmentToken } = body;

    if (!id) {
      return NextResponse.json({ error: 'La imagen del anverso es requerida' }, { status: 400 });
    }

    const nubariumUser = process.env.NUBARIUM_USER || '';
    const nubariumPass = process.env.NUBARIUM_PASS || '';
    const credentials = Buffer.from(`${nubariumUser}:${nubariumPass}`).toString('base64');

    // Strip data URL prefix if present — Nubarium expects raw base64
    const cleanBase64 = (dataUrl: string): string => {
      if (dataUrl.startsWith('data:')) {
        return dataUrl.split(',')[1] || dataUrl;
      }
      return dataUrl;
    };

    const payload: Record<string, string> = {
      id: cleanBase64(id),
    };
    if (idReverso) {
      payload.idReverso = cleanBase64(idReverso);
    }

    const nubariumRes = await fetch('https://ocr.nubarium.com/ocr/v1/obtener_datos_id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await nubariumRes.json();

    // ── Determine vigencia validity ──────────────────────────────────────────
    // "vigencia" field contains the expiry year (e.g. "2021", "2025", "2030")
    const currentYear = new Date().getFullYear();
    const vigenciaYear = data.vigencia ? parseInt(data.vigencia, 10) : null;
    const vigente = vigenciaYear !== null ? vigenciaYear >= currentYear : null;

    // ── Save log to Supabase ─────────────────────────────────────────────────
    try {
      const supabase = createClient();
      await supabase.from('nubarium_ocr_logs').insert({
        enrollment_token: enrollmentToken || null,
        tipo: data.tipo || null,
        sub_tipo: data.subTipo || null,
        folio: data.folio || null,
        clave_elector: data.claveElector || null,
        curp: data.curp || null,
        primer_apellido: data.primerApellido || null,
        segundo_apellido: data.segundoApellido || null,
        nombres: data.nombres || null,
        edad: data.edad || null,
        sexo: data.sexo || null,
        vigencia: data.vigencia || null,
        emision: data.emision || null,
        estado: data.estado || null,
        municipio: data.municipio || null,
        localidad: data.localidad || null,
        seccion: data.seccion || null,
        calle: data.calle || null,
        colonia: data.colonia || null,
        ciudad: data.ciudad || null,
        codigo_validacion: data.codigoValidacion || null,
        codigo_barras: data.codigoBarras || null,
        ocr: data.ocr || null,
        registro: data.registro || null,
        vigente,
        raw_response: data,
      });
    } catch (dbError) {
      console.error('[nubarium/ocr-id] Error saving log to DB:', dbError);
    }

    return NextResponse.json({
      ...data,
      vigente,
      vigenciaYear,
    });
  } catch (error) {
    console.error('[nubarium/ocr-id] Error:', error);
    return NextResponse.json({ error: 'Error al procesar la identificación' }, { status: 500 });
  }
}
