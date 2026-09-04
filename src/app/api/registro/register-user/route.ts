import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

import { isValidWorkspaceSlug, normalizeWorkspaceSlug } from '@/lib/workspaces/slug';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      email,
      password,
      phone,
      accountType,
      organizationName,
      workspaceSlug,
      personalidadJuridica,
      identityMethod,
      fullName,
      rfc,
      curp,
      documentType1,
      documentType2,
      // Extended profile fields
      nombre,
      apellidoPaterno,
      apellidoMaterno,
      telefono,
      fechaNacimiento,
      sexo,
      tipoIdentificacion,
      // e.Firma specific fields
      efirmaRfc,
      efirmaSerial,
      efirmaNombre,
      efirmaVigenciaFin,
      // Biometric enrollment session ID — used to link enrollment_results even when inactive
      enrollmentSessionId,
    } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email y contraseña son requeridos' }, { status: 400 });
    }

    const normalizedAccountType = accountType === 'empresarial' ? 'empresarial' : 'personal';
    const normalizedOrganizationName = typeof organizationName === 'string'
      ? organizationName.trim()
      : '';
    const normalizedWorkspaceSlug = normalizeWorkspaceSlug(String(workspaceSlug || ''));

    if (normalizedAccountType === 'empresarial' && normalizedOrganizationName.length < 2) {
      return NextResponse.json({ error: 'El nombre de la organización es requerido' }, { status: 400 });
    }

    if (normalizedAccountType === 'empresarial' && !isValidWorkspaceSlug(normalizedWorkspaceSlug)) {
      return NextResponse.json({ error: 'El identificador del espacio de trabajo no es válido' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    if (normalizedAccountType === 'empresarial' && !serviceRoleKey) {
      return NextResponse.json(
        { error: 'El registro empresarial no está disponible temporalmente' },
        { status: 503 }
      );
    }

    if (normalizedAccountType === 'empresarial' && serviceRoleKey) {
      const availabilityClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: existingWorkspace, error: availabilityError } = await availabilityClient
        .from('workspaces')
        .select('id')
        .eq('workspace_slug', normalizedWorkspaceSlug)
        .limit(1)
        .maybeSingle();
      if (availabilityError) {
        return NextResponse.json({ error: 'No fue posible validar el espacio de trabajo' }, { status: 503 });
      }
      if (existingWorkspace) {
        return NextResponse.json({ error: 'El identificador del espacio de trabajo ya está en uso' }, { status: 409 });
      }
    }

    let userId: string;

    if (serviceRoleKey) {
      // Use admin API when service role key is available
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: {
          full_name: fullName || '',
          phone: phone || '',
          account_type: normalizedAccountType,
          organization_name: normalizedOrganizationName || null,
          personalidad_juridica: personalidadJuridica || null,
          identity_method: identityMethod || null,
          rfc: rfc || null,
          curp: curp || null,
        },
      });

      if (authError) {
        if (authError.message?.includes('already registered') || authError.message?.includes('already exists')) {
          return NextResponse.json({ error: 'Este correo ya está registrado' }, { status: 409 });
        }
        return NextResponse.json({ error: authError.message }, { status: 400 });
      }

      if (!authData.user?.id) {
        return NextResponse.json({ error: 'No se pudo crear el usuario' }, { status: 500 });
      }

      userId = authData.user.id;
    } else {
      // Fallback: use signUp with anon key (works without service role)
      const supabaseAnon = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: signUpData, error: signUpError } = await supabaseAnon.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName || '',
            phone: phone || '',
            account_type: normalizedAccountType,
            organization_name: normalizedOrganizationName || null,
            personalidad_juridica: personalidadJuridica || null,
            identity_method: identityMethod || null,
            rfc: rfc || null,
            curp: curp || null,
          },
        },
      });

      if (signUpError) {
        if (signUpError.message?.includes('already registered') || signUpError.message?.includes('already exists') || signUpError.message?.includes('User already registered')) {
          return NextResponse.json({ error: 'Este correo ya está registrado' }, { status: 409 });
        }
        return NextResponse.json({ error: signUpError.message }, { status: 400 });
      }

      if (!signUpData.user?.id) {
        return NextResponse.json({ error: 'No se pudo crear el usuario' }, { status: 500 });
      }

      userId = signUpData.user.id;
    }

    // Wait a moment for trigger to create user_profiles
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Use service role key for RPC if available, otherwise anon key
    const supabaseForRpc = createClient(
      supabaseUrl,
      serviceRoleKey || anonKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Determine if user registered with biometric method
    const isBiometrico = identityMethod === 'biometrico';

    // ── Link enrollment result to the new user ────────────────────────────────
    // Even when biometric verification is inactive as an option, we store the
    // enrollment result ID and phone number so the history is available when
    // these options are activated in the future.
    let enrollmentResultId: string | null = null;

    if (enrollmentSessionId) {
      try {
        // Find the enrollment result by session_id
        const { data: enrollRow } = await supabaseForRpc
          .from('enrollment_results')
          .select('id, face_match_passed, created_at')
          .eq('session_id', enrollmentSessionId)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (enrollRow) {
          enrollmentResultId = enrollRow.id;

          // Back-fill user_id on the enrollment_result so it's traceable
          await supabaseForRpc
            .from('enrollment_results')
            .update({ user_id: userId })
            .eq('id', enrollRow.id);

          // Also back-fill user_id on the enrollment_token for the same session
          await supabaseForRpc
            .from('enrollment_tokens')
            .update({ user_id: userId })
            .eq('session_id', enrollmentSessionId);
        }
      } catch (enrollErr) {
        // Non-blocking — log but don't fail registration
        console.warn('[registro] Could not link enrollment result:', enrollErr);
      }
    }

    // ── Upsert user_verification_status ──────────────────────────────────────
    // Always store phone_number and biometric enrollment data (even when
    // these verification options are currently inactive/disabled in the UI).
    const verificationPayload: Record<string, unknown> = {
      user_id: userId,
      // Phone number is always stored regardless of verification status
      phone_number: phone || null,
      phone_verified: false, // stays false — phone verification is inactive
      // Biometric: store enrollment link regardless of active/inactive status
      biometric_verified: isBiometrico && !!enrollmentResultId,
      biometric_verified_at: (isBiometrico && enrollmentResultId) ? new Date().toISOString() : null,
      biometric_source: isBiometrico ? 'enrollment' : null,
      enrollment_result_id: enrollmentResultId || null,
    };

    try {
      await supabaseForRpc
        .from('user_verification_status')
        .insert(verificationPayload)
        .select()
        .single();
    } catch {
      // Record may already exist from trigger — update with captured data
      try {
        const updatePayload: Record<string, unknown> = {
          phone_number: phone || null,
        };

        // Only update biometric fields if we have enrollment data
        if (enrollmentResultId) {
          updatePayload.enrollment_result_id = enrollmentResultId;
          updatePayload.biometric_source = 'enrollment';
          if (isBiometrico) {
            updatePayload.biometric_verified = true;
            updatePayload.biometric_verified_at = new Date().toISOString();
          }
        }

        await supabaseForRpc
          .from('user_verification_status')
          .update(updatePayload)
          .eq('user_id', userId);
      } catch (updateErr) {
        console.warn('[registro] Could not update user_verification_status:', updateErr);
      }
    }

    // Call the setup function to create workspace, subscription, and history
    const { data: setupData, error: setupError } = await supabaseForRpc.rpc(
      'setup_free_workspace_and_subscription',
      {
        p_user_id: userId,
        p_full_name: fullName || '',
        p_account_type: normalizedAccountType,
        p_personalidad_juridica: personalidadJuridica || null,
        p_identity_method: identityMethod || null,
        p_rfc: rfc || null,
        p_curp: curp || null,
        p_phone: phone || null,
        p_document_type_1: documentType1 || null,
        p_document_type_2: documentType2 || null,
        // Extended profile fields
        p_nombre: nombre || null,
        p_apellido_paterno: apellidoPaterno || null,
        p_apellido_materno: apellidoMaterno || null,
        p_telefono: telefono || phone || null,
        p_fecha_nacimiento: fechaNacimiento || null,
        p_sexo: sexo || null,
        p_tipo_identificacion: tipoIdentificacion || null,
        // e.Firma fields
        p_efirma_rfc: efirmaRfc || null,
        p_efirma_serial: efirmaSerial || null,
        p_efirma_nombre: efirmaNombre || null,
        p_efirma_vigencia_fin: efirmaVigenciaFin || null,
      }
    );

    if (setupError) {
      console.error('[registro] setup_free_workspace_and_subscription error:', setupError);
      return NextResponse.json({
        success: true,
        userId,
        warning: 'Usuario creado pero hubo un error al configurar el workspace: ' + setupError.message,
      });
    }

    const result = setupData as { success: boolean; workspace_id?: string; subscription_id?: string; error?: string };

    if (!result?.success) {
      console.error('[registro] setup function returned error:', result?.error);
      return NextResponse.json({
        success: true,
        userId,
        warning: 'Usuario creado pero hubo un error al configurar el workspace: ' + (result?.error || 'desconocido'),
      });
    }

    // Send verification email (non-blocking — don't fail registration if email fails)
    if (normalizedAccountType === 'empresarial' && result.workspace_id) {
      const organizationPayload = {
        name: normalizedOrganizationName,
        workspace_slug: normalizedWorkspaceSlug,
        legal_name: efirmaNombre || normalizedOrganizationName,
        trade_name: normalizedOrganizationName,
        rfc: efirmaRfc || rfc || null,
        legal_person_type: personalidadJuridica || null,
        contact_email: email,
        contact_phone: phone || null,
        description: `Espacio de trabajo de ${normalizedOrganizationName}`,
        organization_enabled: true,
        verification_status: efirmaRfc ? 'identity_verified' : 'not_started',
        verification_updated_at: efirmaRfc ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };

      const { error: organizationError } = await supabaseForRpc
        .from('workspaces')
        .update(organizationPayload)
        .eq('id', result.workspace_id)
        .eq('owner_id', userId);

      if (organizationError) {
        console.error('[registro] Could not initialize organization profile:', organizationError);
        if (organizationError.code === '23505') {
          await supabaseForRpc.auth.admin.deleteUser(userId).catch(() => undefined);
          return NextResponse.json(
            { error: 'El identificador del espacio de trabajo ya está en uso' },
            { status: 409 }
          );
        }
      } else {
        const { error: auditError } = await supabaseForRpc
          .from('organization_audit_events')
          .insert({
            workspace_id: result.workspace_id,
            actor_user_id: userId,
            event_type: 'organization.created',
            resource_type: 'workspace',
            resource_id: result.workspace_id,
            summary: 'Organización creada durante el registro empresarial',
            payload: { account_type: normalizedAccountType },
          });

        if (auditError) {
          console.warn('[registro] Could not record organization audit event:', auditError);
        }

      }
    }

    try {
      const siteUrl = req.nextUrl.origin;
      const normalizedEmail = String(email).trim().toLowerCase();
      const registrationSignature = serviceRoleKey
        ? crypto
            .createHmac('sha256', serviceRoleKey)
            .update(`${userId}\n${normalizedEmail}`)
            .digest('hex')
        : null;
      await fetch(`${siteUrl}/api/registro/send-verification-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(registrationSignature
            ? { 'x-docubox-registration-signature': registrationSignature }
            : {}),
        },
        body: JSON.stringify({
          userId,
          email: normalizedEmail,
          fullName: fullName || nombre || '',
        }),
      });
    } catch (emailErr) {
      console.warn('[registro] Could not send verification email:', emailErr);
    }

    return NextResponse.json({
      success: true,
      userId,
      workspaceId: result.workspace_id,
      workspaceSlug: normalizedAccountType === 'empresarial' ? normalizedWorkspaceSlug : null,
      subscriptionId: result.subscription_id,
    });
  } catch (err) {
    console.error('[registro] Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
