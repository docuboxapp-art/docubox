import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, phone } = body;

    const supabase = createServiceClient();

    const result: { emailExists: boolean; phoneExists: boolean } = {
      emailExists: false,
      phoneExists: false,
    };

    if (email) {
      const { data: emailData } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      result.emailExists = !!emailData;
    }

    if (phone) {
      const { data: phoneData } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();
      result.phoneExists = !!phoneData;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error checking duplicates:', error);
    return NextResponse.json({ emailExists: false, phoneExists: false });
  }
}
