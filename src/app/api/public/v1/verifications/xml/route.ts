import { NextRequest } from 'next/server';
import { handleTechnicalValidation } from '@/lib/public-verification/technical-handler';

export async function POST(request: NextRequest) {
  return handleTechnicalValidation(request, { engine: 'XML_XMLDSIG', method: 'XML', gatewayEnv: 'DOCUBOX_XML_VALIDATION_GATEWAY_URL', acceptedExtensions: ['xml'] });
}

