import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Check if user has TOTP enabled — used by login flow
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ totpEnabled: false });
    }

    const { data } = await supabaseAdmin
      .from('user_totp_settings')
      .select('is_enabled')
      .eq('user_id', userId)
      .eq('is_enabled', true)
      .maybeSingle();

    return NextResponse.json({ totpEnabled: !!data });
  } catch {
    return NextResponse.json({ totpEnabled: false });
  }
}
