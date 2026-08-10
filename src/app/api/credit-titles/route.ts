import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  appendTitleEvent,
  assertCreditTitleWorkspaceAccess,
  createTitleIdentity,
  creditTitleErrorResponse,
  CreditTitleError,
  requireCreditTitleUser,
} from '@/lib/credit-titles/server';

export async function GET(request: NextRequest) {
  try {
    const user = await requireCreditTitleUser(request);
    const workspaceId = new URL(request.url).searchParams.get('workspaceId');
    if (!workspaceId) throw new CreditTitleError('Falta el espacio de trabajo.', 400);
    await assertCreditTitleWorkspaceAccess(workspaceId, user.id);
    const { data, error } = await createServiceClient()
      .from('credit_titles')
      .select('*, promissory_notes(*), title_parties(role,display_name,tax_id_masked,email)')
      .eq('workspace_id', workspaceId)
      .eq('title_type', 'promissory_note')
      .order('updated_at', { ascending: false });
    if (error) throw new CreditTitleError(error.message, 500);
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    const value = creditTitleErrorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireCreditTitleUser(request);
    const body = await request.json();
    validateDraft(body);
    await assertCreditTitleWorkspaceAccess(body.workspaceId, user.id);
    const supabase = createServiceClient();
    const identity = createTitleIdentity();
    const amount = Number(body.amount);
    const status = body.sendToSignature ? 'awaiting_signature' : 'draft';
    const { data: title, error: titleError } = await supabase
      .from('credit_titles')
      .insert({
        workspace_id: body.workspaceId,
        title_type: 'promissory_note',
        internal_uuid: identity.internalUuid,
        public_token: identity.publicToken,
        status,
        nominal_amount: amount,
        outstanding_balance: amount,
        currency: body.currency || 'MXN',
        maturity_date: body.maturityDate,
        current_holder_name: body.beneficiaryName.trim(),
        created_by: user.id,
        updated_by: user.id,
      })
      .select('*')
      .single();
    if (titleError || !title)
      throw new CreditTitleError(
        titleError?.message || 'No fue posible crear el registro del titulo.',
        500
      );

    const { error: noteError } = await supabase.from('promissory_notes').insert({
      title_id: title.id,
      workspace_id: body.workspaceId,
      note_kind: body.kind,
      principal_amount: amount,
      amount_in_words: body.amountInWords || null,
      issue_date: body.issueDate,
      issue_place: body.issuePlace.trim(),
      maturity_date: body.maturityDate,
      payment_place: body.paymentPlace.trim(),
      interest_mode: body.interestMode || 'none',
      ordinary_rate: nullableNumber(body.ordinaryRate),
      default_rate: nullableNumber(body.defaultRate),
      installments: buildInstallments(body),
      linked_references: {
        document: body.linkedDocument || null,
        external: body.externalReference || null,
      },
      identity_policy: { level: body.identityLevel || 'standard' },
      signature_policy: {
        method: body.signatureMethod || 'autograph_otp',
        requireOtp: body.requireOtp !== false,
        requireTsa: body.requireTsa !== false,
        requireNom151: body.requireNom151 === true,
      },
      template_key: body.template || null,
    });
    if (noteError) {
      await supabase.from('credit_titles').delete().eq('id', title.id);
      throw new CreditTitleError(noteError.message, 500);
    }

    const parties = [
      {
        workspace_id: body.workspaceId,
        title_id: title.id,
        role: 'subscriber',
        display_name: body.subscriberName.trim(),
        tax_id_masked: maskTaxId(body.subscriberRfc),
        email: normalizeEmail(body.subscriberEmail),
        snapshot: {
          name: body.subscriberName.trim(),
          rfc: body.subscriberRfc?.trim().toUpperCase() || null,
          email: normalizeEmail(body.subscriberEmail),
        },
      },
      {
        workspace_id: body.workspaceId,
        title_id: title.id,
        role: 'beneficiary',
        display_name: body.beneficiaryName.trim(),
        tax_id_masked: maskTaxId(body.beneficiaryRfc),
        email: normalizeEmail(body.beneficiaryEmail),
        snapshot: {
          name: body.beneficiaryName.trim(),
          rfc: body.beneficiaryRfc?.trim().toUpperCase() || null,
          email: normalizeEmail(body.beneficiaryEmail),
        },
      },
      ...(body.guarantorName?.trim()
        ? [
            {
              workspace_id: body.workspaceId,
              title_id: title.id,
              role: 'guarantor',
              display_name: body.guarantorName.trim(),
              tax_id_masked: null,
              email: null,
              snapshot: { name: body.guarantorName.trim() },
            },
          ]
        : []),
    ];
    const { error: partiesError } = await supabase.from('title_parties').insert(parties);
    if (partiesError) throw new CreditTitleError(partiesError.message, 500);

    await appendTitleEvent({
      titleId: title.id,
      workspaceId: body.workspaceId,
      eventType: 'TITLE_CREATED',
      actorUserId: user.id,
      metadata: { status, titleType: 'promissory_note', amount, currency: body.currency || 'MXN' },
      request,
    });
    if (body.sendToSignature)
      await appendTitleEvent({
        titleId: title.id,
        workspaceId: body.workspaceId,
        eventType: 'SIGNATURE_REQUESTED',
        actorUserId: user.id,
        metadata: { signatureMethod: body.signatureMethod, identityLevel: body.identityLevel },
        request,
      });
    return NextResponse.json({ data: title }, { status: 201 });
  } catch (error) {
    const value = creditTitleErrorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}

function validateDraft(body: any) {
  if (
    !body.workspaceId ||
    !body.kind ||
    !body.subscriberName?.trim() ||
    !body.beneficiaryName?.trim()
  )
    throw new CreditTitleError('Completa el tipo y las partes del pagare.', 400);
  if (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0)
    throw new CreditTitleError('El importe debe ser mayor que cero.', 400);
  if (!body.issueDate || !body.maturityDate || body.maturityDate < body.issueDate)
    throw new CreditTitleError(
      'La fecha de vencimiento debe ser igual o posterior a la suscripcion.',
      400
    );
  if (!body.issuePlace?.trim() || !body.paymentPlace?.trim())
    throw new CreditTitleError('Completa los lugares de suscripcion y pago.', 400);
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && value !== '' ? number : null;
}
function normalizeEmail(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}
function maskTaxId(value: unknown) {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return text.length > 4
    ? `${text.slice(0, 3)}${'*'.repeat(Math.max(1, text.length - 6))}${text.slice(-3)}`
    : text || null;
}
function buildInstallments(body: any) {
  const count = Math.max(1, Math.floor(Number(body.installmentCount) || 1));
  if (body.kind !== 'installments' || count === 1) return [];
  const amount = Number(body.amount) / count;
  return Array.from({ length: count }, (_, index) => ({
    sequence: index + 1,
    amount: Number(amount.toFixed(2)),
    status: 'pending',
  }));
}
