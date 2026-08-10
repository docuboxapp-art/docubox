import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  assertCreditTitleWorkspaceAccess,
  creditTitleErrorResponse,
  CreditTitleError,
  requireCreditTitleUser,
} from '@/lib/credit-titles/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCreditTitleUser(request);
    const { id } = await params;
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('credit_titles')
      .select('*, promissory_notes(*), title_parties(*), title_events(*)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new CreditTitleError(error.message, 500);
    if (!data) throw new CreditTitleError('No se encontro el pagare.', 404);
    await assertCreditTitleWorkspaceAccess(data.workspace_id, user.id);
    data.title_events = (data.title_events || []).sort(
      (a: any, b: any) => a.sequence_no - b.sequence_no
    );
    return NextResponse.json({ data });
  } catch (error) {
    const value = creditTitleErrorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}
