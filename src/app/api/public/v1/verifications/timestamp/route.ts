import { NextRequest } from 'next/server';
import { handleTechnicalValidation } from '@/lib/public-verification/technical-handler';

export async function POST(request: NextRequest) {
  return handleTechnicalValidation(request, { engine: 'RFC3161', method: 'TIMESTAMP', gatewayEnv: 'DOCUBOX_TSA_VALIDATION_GATEWAY_URL', acceptedExtensions: ['tst', 'tsr', 'p7s', 'p7m', 'der', 'bin'] });
}

