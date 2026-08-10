import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { assertWorkspaceAccess, errorResponse, requireNotificaUser } from '@/lib/notifica/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireNotificaUser(request);
    const { id } = await params;
    const supabase = createServiceClient();
    const { data, error } = await supabase.from('certified_notifications').select('*, notification_recipients(*), notification_delivery_channels(*), notification_evidence_events(*)').eq('id', id).maybeSingle();
    if (error || !data) return NextResponse.json({ error: 'Notificacion no encontrada.' }, { status: 404 });
    await assertWorkspaceAccess(data.workspace_id, user.id);
    data.notification_evidence_events?.sort((a: any, b: any) => a.sequence_no - b.sequence_no);
    return NextResponse.json({ data });
  } catch (error) {
    const value = errorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}
