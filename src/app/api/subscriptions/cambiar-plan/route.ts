import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { planSlug, userId } = await req.json();

    if (!planSlug || !userId) {
      return NextResponse.json(
        { success: false, error: 'planSlug y userId son requeridos' },
        { status: 400 }
      );
    }

    const validSlugs = ['basico', 'profesional', 'empresarial', 'free'];
    if (!validSlugs.includes(planSlug)) {
      return NextResponse.json(
        { success: false, error: 'Plan no válido' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin.rpc('update_user_subscription', {
      p_user_id: userId,
      p_new_plan_slug: planSlug,
    });

    if (error) {
      console.error('RPC error:', error.message);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    if (!data?.success) {
      return NextResponse.json(
        { success: false, error: data?.error || 'Error al cambiar el plan' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error interno del servidor';
    console.error('cambiar-plan error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
