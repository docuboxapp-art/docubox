/* global Deno:readonly */
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { createCaseVerificationHandler } from './handler.ts';

Deno.serve(
  createCaseVerificationHandler((token) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
  )
);
