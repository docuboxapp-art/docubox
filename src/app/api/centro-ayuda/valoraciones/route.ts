import { saveHelpVote, validateHelpVote } from '@/lib/help/feedback.server';
import { helpPrivateHeaders, helpRequestFailure, readHelpRequest } from '@/lib/help/request.server';
import { emitHelpUsage } from '@/lib/observability/help-usage';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const vote = validateHelpVote(await readHelpRequest(request));
    const saved = await saveHelpVote(request, vote);
    if (!saved) {
      return Response.json(
        { message: 'Espera unos minutos para volver a enviar tu valoración.' },
        { status: 429, headers: helpPrivateHeaders }
      );
    }
    emitHelpUsage('feedback');
    return Response.json({ saved: true }, { headers: helpPrivateHeaders });
  } catch (error) {
    return helpRequestFailure(error, 'No se pudo guardar la valoración. Intenta de nuevo.');
  }
}
