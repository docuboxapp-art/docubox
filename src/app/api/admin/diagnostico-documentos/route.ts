import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isInternalAdminRequest } from '@/lib/security/internal-admin';

export async function GET(request: NextRequest) {
  if (!isInternalAdminRequest(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Documentos sin owner_id
  const { data: sinOwner, error: e1 } = await supabase
    .from('documentos')
    .select('id, documento_id, nombre, estado, created_at, workspace_id, owner_id')
    .is('owner_id', null);

  // Documentos sin workspace_id
  const { data: sinWorkspace, error: e2 } = await supabase
    .from('documentos')
    .select('id, documento_id, nombre, estado, created_at, workspace_id, owner_id')
    .is('workspace_id', null);

  // Documentos sin owner_id Y sin workspace_id
  const { data: sinAmbos, error: e3 } = await supabase
    .from('documentos')
    .select('id, documento_id, nombre, estado, created_at, workspace_id, owner_id')
    .is('owner_id', null)
    .is('workspace_id', null);

  // Total de documentos
  const { count: total, error: e4 } = await supabase
    .from('documentos')
    .select('*', { count: 'exact', head: true });

  return NextResponse.json({
    resumen: {
      total_documentos: total ?? 0,
      sin_owner_id: sinOwner?.length ?? 0,
      sin_workspace_id: sinWorkspace?.length ?? 0,
      sin_ambos: sinAmbos?.length ?? 0,
    },
    documentos_sin_owner_id: sinOwner ?? [],
    documentos_sin_workspace_id: sinWorkspace ?? [],
    documentos_sin_ambos: sinAmbos ?? [],
    errores: {
      e1: e1?.message ?? null,
      e2: e2?.message ?? null,
      e3: e3?.message ?? null,
      e4: e4?.message ?? null,
    },
  });
}
