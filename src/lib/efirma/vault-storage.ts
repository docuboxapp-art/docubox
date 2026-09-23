'use client';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { EncryptedEfirmaKeyMaterial, StoredEfirmaKey } from './client-vault';

export async function loadStoredEfirmaKey(
  supabase: SupabaseClient,
  userId: string
): Promise<StoredEfirmaKey | null> {
  const { data, error } = await supabase
    .from('encrypted_efirma_keys')
    .select(
      'user_id,certificate_der_base64,certificate_fingerprint_sha256,certificate_serial,certificate_rfc,certificate_subject,certificate_not_after,encrypted_key_ciphertext,encrypted_key_iv,encrypted_key_salt,wrap_algorithm,kdf_algorithm,kdf_iterations,format_version,consented_at,last_used_at,created_at,updated_at'
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as StoredEfirmaKey | null) || null;
}

export async function saveStoredEfirmaKey(
  supabase: SupabaseClient,
  userId: string,
  material: EncryptedEfirmaKeyMaterial,
  certificate: {
    serial?: string | null;
    rfc?: string | null;
    subject?: string | null;
    notAfter?: string | null;
  }
) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('encrypted_efirma_keys').upsert(
    {
      user_id: userId,
      ...material,
      certificate_serial: certificate.serial || null,
      certificate_rfc: certificate.rfc || null,
      certificate_subject: certificate.subject || null,
      certificate_not_after: certificate.notAfter || null,
      consented_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
}

export async function markStoredEfirmaKeyUsed(supabase: SupabaseClient, userId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('encrypted_efirma_keys')
    .update({ last_used_at: now, updated_at: now })
    .eq('user_id', userId);
  if (error) throw error;
}

export async function deleteStoredEfirmaKey(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase.from('encrypted_efirma_keys').delete().eq('user_id', userId);
  if (error) throw error;
}
