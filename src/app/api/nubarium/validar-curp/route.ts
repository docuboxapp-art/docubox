import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { curp, enrollmentToken } = body;

    if (!curp) {
      return NextResponse.json({ error: 'CURP es requerida' }, { status: 400 });
    }

    const nubariumUser = process.env.NUBARIUM_USER || '';
    const nubariumPass = process.env.NUBARIUM_PASS || '';
    const credentials = Buffer.from(`${nubariumUser}:${nubariumPass}`).toString('base64');

    const response = await fetch('https://curp.nubarium.com/renapo/v3/valida_curp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify({ curp }),
    });

    const data = await response.json();

    // Save to Supabase
    try {
      const supabase = createClient();
      await supabase.from('curp_validations').insert({
        enrollment_token: enrollmentToken || null,
        curp: data.curp || curp,
        nombre: data.nombre,
        apellido_paterno: data.apellidoPaterno,
        apellido_materno: data.apellidoMaterno,
        sexo: data.sexo,
        fecha_nacimiento: data.fechaNacimiento,
        pais_nacimiento: data.paisNacimiento,
        estado_nacimiento: data.estadoNacimiento,
        estatus_curp: data.estatusCurp,
        doc_probatorio: data.docProbatorio,
        codigo_validacion: data.codigoValidacion,
        codigo_mensaje: data.codigoMensaje,
        raw_response: data,
      });
    } catch (dbError) {
      console.error('Error saving CURP validation to DB:', dbError);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error validating CURP:', error);
    return NextResponse.json({ error: 'Error al validar la CURP' }, { status: 500 });
  }
}
