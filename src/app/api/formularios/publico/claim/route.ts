import { NextRequest } from 'next/server';
import { claimPublicForm } from '@/lib/forms/claim-public-form';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return claimPublicForm(request);
}
