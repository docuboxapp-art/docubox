import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { rfc } = await req.json();

    if (!rfc) {
      return NextResponse.json({ error: 'RFC requerido' }, { status: 400 });
    }

    const user = process.env.NUBARIUM_USER || process.env.NUBARIUM_API_KEY || '';
    const pass = process.env.NUBARIUM_PASS || process.env.NUBARIUM_API_SECRET || '';
    const credentials = Buffer.from(`${user}:${pass}`).toString('base64');

    const response = await fetch('https://sat.nubarium.com/sat/v1/obtener-razonsocial', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify({ rfc }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ valid: false, error: 'RFC no encontrado en el SAT' }, { status: 200 });
    }

    // claveMensaje 0 = found, others = not found or error
    if (data.claveMensaje === 0 && data.estatus === 'OK') {
      return NextResponse.json({
        valid: true,
        nombre: data.nombre || '',
        rfc: data.rfc || rfc,
      });
    } else {
      return NextResponse.json({
        valid: false,
        error: 'RFC no encontrado o inválido en el SAT',
      });
    }
  } catch (err: any) {
    return NextResponse.json({ valid: false, error: 'Error al validar el RFC' }, { status: 500 });
  }
}
