import { NextRequest } from 'next/server';
import { handleTechnicalValidation } from '@/lib/public-verification/technical-handler';

export async function POST(request: NextRequest) {
  return handleTechnicalValidation(request, { engine: 'EVIDENCE_CHAIN', method: 'PACKAGE', gatewayEnv: 'DOCUBOX_EVIDENCE_VALIDATION_GATEWAY_URL', acceptedExtensions: ['zip'] });
}

