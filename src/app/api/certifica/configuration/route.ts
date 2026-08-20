import { authorizeOrganizationRequest } from '@/lib/organization/server';
import { certificaApiFailure } from '@/lib/certifica/server';
import { getCertificationProvider } from '@/lib/certifica/provider';

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'certifications.view');
    const [products, providers] = await Promise.all([
      service.from('certification_products').select('product_key,display_name,description,requires_psc,includes,base_price,currency').eq('active', true).order('base_price'),
      service.from('psc_providers').select('provider_key,display_name,provider_type,environment,enabled,capabilities,health_status,last_health_check_at,metadata').order('environment'),
    ]);
    if (products.error) throw products.error;
    if (providers.error) throw providers.error;
    let runtimeHealth = { healthy: false, detail: 'Proveedor no configurado.' };
    try { runtimeHealth = await getCertificationProvider().healthCheck(); } catch { /* fail closed */ }
    return Response.json({ success: true, products: products.data || [], providers: providers.data || [], runtime: { mode: process.env.CERTIFICA_PSC_MODE || 'sandbox', ...runtimeHealth } });
  } catch (error) {
    return certificaApiFailure(error);
  }
}

