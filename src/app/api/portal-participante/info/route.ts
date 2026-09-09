import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { hashSecret } from '@/lib/ai/security';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function resolveDocumentName(document: { nombre?: unknown; file_name?: unknown }) {
  const candidates = [document.nombre, document.file_name]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value && value.toLowerCase() !== 'el documento');

  return candidates[0] || 'Documento sin nombre';
}

type PortalDocument = {
  id?: unknown;
  nombre?: unknown;
  file_name?: unknown;
  estado?: unknown;
  owner_id?: unknown;
  fecha_vencimiento?: unknown;
  participantes?: unknown;
};

function firstText(...values: unknown[]) {
  return (
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find(Boolean) || null
  );
}

function isAvailableInvitation(document: { estado?: unknown }, participant: Record<string, unknown>) {
  return !(
    document.estado === 'cancelado' ||
    participant.portal_token_invalidated_at ||
    (participant.portal_token_expires_at &&
      new Date(String(participant.portal_token_expires_at)).getTime() <= Date.now()) ||
    participant.current_access === false
  );
}

async function resolveParticipantIdentity(participant: Record<string, unknown>) {
  const userId = typeof participant.user_id === 'string' ? participant.user_id.trim() : '';
  const email = String(participant.email || participant.correo || '')
    .trim()
    .toLowerCase();
  const invitationName = firstText(participant.nombre, participant.name, participant.full_name);

  if (userId) {
    const { data } = await supabaseAdmin
      .from('user_profiles')
      .select('id, full_name')
      .eq('id', userId)
      .maybeSingle();
    if (data?.id) {
      return {
        isRegistered: true,
        participantName: firstText(data.full_name, invitationName),
      };
    }
  }

  if (!email) return { isRegistered: false, participantName: invitationName };
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('id, full_name')
    .eq('email', email)
    .maybeSingle();
  return {
    isRegistered: Boolean(data?.id),
    participantName: firstText(data?.full_name, invitationName),
  };
}

async function resolveInvitationInfo(
  document: PortalDocument,
  participant: Record<string, unknown>,
  canonicalToken?: string
) {
  const ownerId = typeof document.owner_id === 'string' ? document.owner_id : '';
  const [participantIdentity, ownerResult] = await Promise.all([
    resolveParticipantIdentity(participant),
    ownerId
      ? supabaseAdmin
          .from('user_profiles')
          .select('full_name')
          .eq('id', ownerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const expiresAt = firstText(document.fecha_vencimiento);
  const expirationIsValid = expiresAt && Number.isFinite(new Date(expiresAt).getTime());

  return {
    documentName: resolveDocumentName(document),
    acto: participant.acto || 'firmar',
    participantName: participantIdentity.participantName,
    isRegistered: participantIdentity.isRegistered,
    inviterName: firstText(ownerResult.data?.full_name) || 'Docubox',
    expiresAt: expirationIsValid ? expiresAt : null,
    ...(canonicalToken ? { canonicalToken } : {}),
  };
}

async function upgradeLegacyDocumentLink(token: string) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(token)) return null;

  const { data: document, error } = await supabaseAdmin
    .from('documentos')
    .select('id, nombre, file_name, estado, owner_id, fecha_vencimiento, participantes')
    .eq('id', token)
    .maybeSingle();
  if (error || !document || !Array.isArray(document.participantes)) return null;

  // Legacy URLs were document UUIDs. They can only be migrated when they identify
  // one active participant; multi-participant links never receive ambiguous access.
  if (document.participantes.length !== 1) return null;
  const participant = document.participantes[0] as Record<string, unknown>;
  if (!isAvailableInvitation(document, participant)) return null;

  const currentToken =
    typeof participant.portal_token === 'string' ? participant.portal_token.trim() : '';
  const currentExpiry =
    typeof participant.portal_token_expires_at === 'string'
      ? new Date(participant.portal_token_expires_at).getTime()
      : NaN;
  const portalToken = currentToken && currentExpiry > Date.now() ? currentToken : randomUUID();
  const portalTokenHash = hashSecret(portalToken);

  if (
    participant.portal_token !== portalToken ||
    participant.portal_token_hash !== portalTokenHash ||
    !Number.isFinite(currentExpiry) ||
    currentExpiry <= Date.now()
  ) {
    const participants = [
      {
        ...participant,
        portal_token: portalToken,
        portal_token_hash: portalTokenHash,
        portal_token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    const { error: updateError } = await supabaseAdmin
      .from('documentos')
      .update({ participantes: participants })
      .eq('id', document.id);
    if (updateError) throw updateError;
  }

  return resolveInvitationInfo(document, participant, portalToken);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Token requerido' }, { status: 400 });
  }

  try {
    const tokenHash = hashSecret(token);
    const { data: matchingDocs, error: scanError } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, file_name, estado, owner_id, fecha_vencimiento, participantes')
      .contains('participantes', JSON.stringify([{ portal_token_hash: tokenHash }]))
      .limit(2);

    if (!scanError && matchingDocs) {
      for (const doc of matchingDocs) {
        const parts = doc.participantes as any[];
        if (!Array.isArray(parts)) continue;
        const match = parts.find((p: any) => p.portal_token_hash === tokenHash);
        if (match) {
          if (!isAvailableInvitation(doc, match)) {
            return NextResponse.json(
              { error: 'Este enlace ya no está disponible.' },
              { status: 410 }
            );
          }
          return NextResponse.json(
            await resolveInvitationInfo(doc, match),
            { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
          );
        }
      }
    }

    const legacyInvitation = await upgradeLegacyDocumentLink(token);
    if (legacyInvitation) {
      return NextResponse.json(legacyInvitation, {
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      });
    }

    return NextResponse.json({ error: 'Token inválido o vencido' }, { status: 404 });
  } catch (err: any) {
    console.error('[portal-participante/info] Error:', err?.message);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
