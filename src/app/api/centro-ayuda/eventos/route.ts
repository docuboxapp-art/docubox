import { helpPrivateHeaders, helpRequestFailure, readHelpRequest } from '@/lib/help/request.server';
import { getHelpSupportEmail } from '@/lib/help/support.server';
import { emitHelpUsage } from '@/lib/observability/help-usage';

export async function POST(request: Request) {
  try {
    const body = await readHelpRequest(request);
    if (body.event === 'support_email' && getHelpSupportEmail()) emitHelpUsage('support_email');
    return new Response(null, { status: 204, headers: helpPrivateHeaders });
  } catch (error) {
    return helpRequestFailure(error, 'El evento no está disponible.');
  }
}
