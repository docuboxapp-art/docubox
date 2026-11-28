import type { SupabaseClient } from '@supabase/supabase-js';
import { SIGNING_METHOD_LABELS, type SigningMethod } from '@/lib/signatures/signing-options';

const EVIDENCE_METHODS = new Map<string, SigningMethod>([
  ['autograph_signature', 'autografa'],
  ['click_sign', 'clicksign'],
  ['efirma_sat', 'efirma'],
]);

export type PublicSignatureStamp = {
  signerInitials: string | null;
  method: string;
  signedAt: string;
  fingerprintPrefix: string | null;
};

function toInitials(name: string | null) {
  const words = name?.normalize('NFC').trim();
  if (!words || !/^[\p{L}\p{M}\p{Zs}'’.-]+$/u.test(words)) return null;

  const initials = (words.match(/\p{L}[\p{L}\p{M}]*/gu) ?? [])
    .slice(0, 4)
    .map((word) => `${word[0].toLocaleUpperCase('es-MX')}.`);
  return initials.join(' ') || null;
}

export async function findPublicSignatureStamp(
  supabase: SupabaseClient,
  evidenceId: string
): Promise<PublicSignatureStamp | null> {
  const { data: evidence, error: evidenceError } = await supabase
    .from('signature_evidence')
    .select(
      'document_id,evidence_type,signed_at,participant_name,efirma_nombre,signature_hash,digital_seal_sha256'
    )
    .eq('id', evidenceId)
    .eq('evidence_role', 'FINAL_SIGNATURE')
    .eq('is_voided', false)
    .maybeSingle();
  if (evidenceError) throw evidenceError;
  if (!evidence?.document_id) return null;
  const method = EVIDENCE_METHODS.get(evidence.evidence_type);
  if (!method) return null;

  const [participation, document] = await Promise.all([
    supabase
      .from('participation_responses')
      .select('participante_nombre,firma_completada_at,signature_hash')
      .eq('documento_id', evidence.document_id)
      .eq('signature_evidence_id', evidenceId)
      .eq('firma_completada', true)
      .eq('signature_method', method)
      .not('operational_committed_at', 'is', null)
      .maybeSingle(),
    supabase
      .from('documentos')
      .select('id')
      .eq('id', evidence.document_id)
      .is('deleted_at', null)
      .is('trashed_at', null)
      .maybeSingle(),
  ]);
  if (participation.error) throw participation.error;
  if (document.error) throw document.error;
  if (!participation.data || !document.data) return null;

  const signedAt = evidence.signed_at || participation.data.firma_completada_at;
  const recordedAt = signedAt && Date.parse(signedAt);
  if (typeof recordedAt !== 'number' || !Number.isFinite(recordedAt)) return null;

  const hash = [
    evidence.signature_hash,
    evidence.digital_seal_sha256,
    participation.data.signature_hash,
  ].find((value) => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value));

  return {
    signerInitials:
      (method === 'efirma' ? toInitials(evidence.efirma_nombre) : null) ||
      toInitials(evidence.participant_name) ||
      toInitials(participation.data.participante_nombre),
    method: SIGNING_METHOD_LABELS[method],
    signedAt: new Date(recordedAt).toISOString(),
    fingerprintPrefix: hash?.slice(0, 16).toUpperCase() ?? null,
  };
}
