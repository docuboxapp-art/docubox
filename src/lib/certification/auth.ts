import { NextRequest } from 'next/server';
import { createAnonClient } from '@/lib/supabase/server';
import { CertificationError } from './types';

export async function requireApiUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new CertificationError('AUTH_REQUIRED', 'Debes iniciar sesion.', 401);
  }
  const token = authorization.slice(7).trim();
  const { data: { user }, error } = await createAnonClient().auth.getUser(token);
  if (error || !user) throw new CertificationError('AUTH_INVALID', 'La sesion no es valida.', 401);
  return user;
}

