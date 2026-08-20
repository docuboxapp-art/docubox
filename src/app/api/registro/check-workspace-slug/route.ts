import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidWorkspaceSlug, normalizeWorkspaceSlug } from '@/lib/workspaces/slug';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceSlug = normalizeWorkspaceSlug(String(body.workspaceSlug || ''));

    if (!isValidWorkspaceSlug(workspaceSlug)) {
      return NextResponse.json({ available: false, workspaceSlug, reason: 'invalid' });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { available: false, workspaceSlug, reason: 'unavailable' },
        { status: 503 }
      );
    }

    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await service
      .from('workspaces')
      .select('id')
      .eq('workspace_slug', workspaceSlug)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[registro] workspace slug availability error:', error);
      return NextResponse.json(
        { available: false, workspaceSlug, reason: 'unavailable' },
        { status: 503 }
      );
    }

    return NextResponse.json({ available: !data, workspaceSlug });
  } catch (error) {
    console.error('[registro] invalid workspace slug request:', error);
    return NextResponse.json({ available: false, reason: 'invalid' }, { status: 400 });
  }
}
