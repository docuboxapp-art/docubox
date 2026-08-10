import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { appendTitleEvent } from '@/lib/credit-titles/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('credit_titles')
    .select(
      'id,workspace_id,folio,internal_uuid,status,nominal_amount,outstanding_balance,currency,issued_at,maturity_date,canonical_hash,document_hash,public_token,promissory_notes(note_kind),title_parties(role,display_name,tax_id_masked),title_registry(registry_hash,registered_at,timestamp_status,nom151_status)'
    )
    .eq('public_token', token)
    .maybeSingle();
  if (error)
    return NextResponse.json({ error: 'No fue posible consultar el registro.' }, { status: 500 });
  if (!data)
    return NextResponse.json(
      { error: 'No existe un pagare asociado a este acceso.' },
      { status: 404 }
    );
  const isVerifiable = [
    'issued',
    'active',
    'partially_paid',
    'overdue',
    'paid',
    'cancelled',
  ].includes(data.status);
  if (!isVerifiable)
    return NextResponse.json({ error: 'El pagare aun no ha sido emitido.' }, { status: 409 });
  await appendTitleEvent({
    titleId: data.id,
    workspaceId: data.workspace_id,
    eventType: 'VERIFICATION_PERFORMED',
    actorType: 'public',
    metadata: { source: 'public_portal' },
    request,
  });
  return NextResponse.json({ data: sanitize(data) });
}

function sanitize(data: any) {
  const parties = (data.title_parties || []).map((party: any) => ({
    role: party.role,
    displayName: maskName(party.display_name),
    taxId: party.tax_id_masked || null,
  }));
  const registry = Array.isArray(data.title_registry)
    ? data.title_registry[0]
    : data.title_registry;
  return {
    folio: data.folio,
    uuid: data.internal_uuid,
    status: data.status,
    amount: data.nominal_amount,
    balance: data.outstanding_balance,
    currency: data.currency,
    issuedAt: data.issued_at,
    maturityDate: data.maturity_date,
    canonicalHash: data.canonical_hash,
    documentHash: data.document_hash,
    integrity: Boolean(data.canonical_hash && registry?.registry_hash),
    parties,
    timestampStatus: registry?.timestamp_status || 'not_configured',
    nom151Status: registry?.nom151_status || 'not_configured',
    registeredAt: registry?.registered_at || data.issued_at,
  };
}
function maskName(value: string) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 2
        ? `${part[0] || ''}*`
        : `${part[0]}${'*'.repeat(Math.min(5, part.length - 1))}`
    )
    .join(' ');
}
