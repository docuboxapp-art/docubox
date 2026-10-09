import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAnonClient } from '@/lib/supabase/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  let authenticated = false;
  if (bearer) {
    const {
      data: { user },
    } = await createAnonClient(bearer).auth.getUser(bearer);
    authenticated = Boolean(user);
  }
  if (!authenticated) {
    const cookieStore = await cookies();
    const client = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {},
        },
      }
    );
    const {
      data: { user },
    } = await client.auth.getUser();
    authenticated = Boolean(user);
  }
  if (!authenticated) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q')?.trim() ?? '';
  const criteria = searchParams.get('criteria') ?? 'correo';

  if (!query || query.length < 2) {
    return NextResponse.json({ users: [] });
  }

  try {
    let dbQuery = supabaseAdmin
      .from('user_profiles')
      .select('id, full_name, email, phone, rfc, curp')
      .eq('is_active', true)
      .limit(10);

    switch (criteria) {
      case 'correo':
        dbQuery = dbQuery.eq('email', query);
        break;
      case 'telefono':
        dbQuery = dbQuery.eq('phone', query);
        break;
      case 'rfc':
        dbQuery = dbQuery.eq('rfc', query);
        break;
      case 'curp':
        dbQuery = dbQuery.eq('curp', query);
        break;
      case 'nombre':
        dbQuery = dbQuery.eq('full_name', query);
        break;
      default:
        dbQuery = dbQuery.eq('email', query);
    }

    const { data, error } = await dbQuery;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ users: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
