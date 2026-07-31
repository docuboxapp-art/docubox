import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

function createAnonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();

    // Check if request has auth header (user-specific check)
    const authHeader = request.headers.get('Authorization');
    let currentUser: any = null;
    let userDocs: any[] = [];

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const anonClient = createAnonClient();
      const { data: { user } } = await anonClient.auth.getUser(token);
      if (user) {
        currentUser = { id: user.id, email: user.email };
        // Fetch this user's documents directly
        const { data: docs, error: docsErr } = await supabase
          .from('documentos')
          .select('id, nombre, estado, owner_id, workspace_id, created_at, deleted_at')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false });
        userDocs = docs || [];
        if (docsErr) console.error('[diagnostico] docs error:', docsErr.message);
      }
    }

    // All users with subscription status
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, created_at');

    const { data: subscriptions } = await supabase
      .from('subscriptions')
      .select('id, user_id, status, documents_used, documents_limit, current_period_end, plan_id');

    const { data: workspaces } = await supabase
      .from('workspace_members')
      .select('user_id, workspace_id, role, workspaces(id, name, workspace_type)');

    const { data: allDocs } = await supabase
      .from('documentos')
      .select('id, nombre, owner_id, workspace_id, estado, deleted_at')
      .is('deleted_at', null);

    // Build summary per user
    const summary = (users || []).map((u: any) => {
      const userSubs = (subscriptions || []).filter((s: any) => s.user_id === u.id);
      const activeSub = userSubs.find((s: any) => s.status === 'active');
      const userWs = (workspaces || []).filter((w: any) => w.user_id === u.id);
      const userDocCount = (allDocs || []).filter((d: any) => d.owner_id === u.id).length;
      const docsWithoutWorkspace = (allDocs || []).filter((d: any) => d.owner_id === u.id && !d.workspace_id).length;

      return {
        user_id: u.id,
        email: u.email,
        full_name: u.full_name,
        tiene_suscripcion_activa: !!activeSub,
        suscripcion: activeSub ? {
          id: activeSub.id,
          status: activeSub.status,
          documents_used: activeSub.documents_used,
          documents_limit: activeSub.documents_limit,
          current_period_end: activeSub.current_period_end,
        } : null,
        total_suscripciones: userSubs.length,
        workspaces: userWs.map((w: any) => ({
          workspace_id: w.workspace_id,
          role: w.role,
          name: (w.workspaces as any)?.name,
          type: (w.workspaces as any)?.workspace_type,
        })),
        documentos_count: userDocCount,
        documentos_sin_workspace: docsWithoutWorkspace,
      };
    });

    return NextResponse.json({
      resumen: summary,
      totales: {
        usuarios: (users || []).length,
        usuarios_sin_plan: summary.filter((u) => !u.tiene_suscripcion_activa).length,
        total_documentos: (allDocs || []).length,
        documentos_sin_workspace: (allDocs || []).filter((d: any) => !d.workspace_id).length,
      },
      usuario_actual: currentUser ? {
        ...currentUser,
        documentos: userDocs,
        documentos_count: userDocs.length,
      } : null,
    });
  } catch (err: any) {
    console.error('[diagnostico-usuarios] Error:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
