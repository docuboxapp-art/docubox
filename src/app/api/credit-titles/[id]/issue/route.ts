import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  assertCreditTitleWorkspaceAccess,
  creditTitleErrorResponse,
  CreditTitleError,
  requireCreditTitleUser,
} from '@/lib/credit-titles/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCreditTitleUser(request);
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey)
      throw new CreditTitleError('Idempotency-Key es obligatorio para emitir.', 400);
    const { id } = await params;
    const supabase = createServiceClient();
    const { data: title } = await supabase
      .from('credit_titles')
      .select('workspace_id')
      .eq('id', id)
      .maybeSingle();
    if (!title) throw new CreditTitleError('No se encontro el pagare.', 404);
    await assertCreditTitleWorkspaceAccess(title.workspace_id, user.id);
    const { data, error } = await supabase.rpc('issue_promissory_note', {
      p_title_id: id,
      p_idempotency_key: idempotencyKey,
      p_actor_id: user.id,
    });
    if (error)
      throw new CreditTitleError(error.message, error.message.includes('firmado') ? 409 : 500);
    return NextResponse.json({ data });
  } catch (error) {
    const value = creditTitleErrorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}
