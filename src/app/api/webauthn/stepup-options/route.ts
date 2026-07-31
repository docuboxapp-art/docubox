import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return NextResponse.json({ error: 'Supabase URL no configurada.' }, { status: 500 });

    const res = await fetch(`${supabaseUrl}/functions/v1/webauthn-stepup-options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
