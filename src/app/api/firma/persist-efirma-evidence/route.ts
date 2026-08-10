import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json({
    error: 'El registro legado de e.firma fue retirado. Usa el flujo criptografico verificado.',
    code: 'LEGACY_EFIRMA_EVIDENCE_RETIRED',
  }, { status: 410 });
}
