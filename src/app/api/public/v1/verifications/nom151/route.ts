import { NextRequest } from 'next/server';
import { handleTechnicalValidation } from '@/lib/public-verification/technical-handler';

export async function POST(request: NextRequest) {
  return handleTechnicalValidation(request, { engine: 'NOM151', method: 'NOM151', gatewayEnv: 'DOCUBOX_NOM151_VALIDATION_GATEWAY_URL', acceptedExtensions: ['xml', 'tst', 'tsr', 'p7s', 'p7m', 'der', 'bin'] });
}

