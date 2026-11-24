import { searchHelp } from '@/lib/help/catalog.server';
import { readHelpFilters, type HelpSearchParams } from '@/lib/help/model';
import { cleanHelpQuery } from '@/lib/help/query';
import { helpPrivateHeaders, helpRequestFailure, readHelpRequest } from '@/lib/help/request.server';

export async function POST(request: Request) {
  try {
    const body = await readHelpRequest(request);
    const query = cleanHelpQuery(body.q);
    const filters = readHelpFilters(body as HelpSearchParams);
    const results = query.length < 2 ? [] : searchHelp(query, filters, 5);
    return Response.json({ results }, { headers: helpPrivateHeaders });
  } catch (error) {
    return helpRequestFailure(error, 'No se pudieron cargar las sugerencias.');
  }
}
