import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const results = {
    documentos_procesados: 0,
    documentos_actualizados: 0,
    documentos_sin_resolucion: 0,
    detalle: [] as Array<{
      id: string;
      documento_id: string;
      problema: string;
      accion: string;
      nuevo_owner_id?: string;
      nuevo_workspace_id?: string;
    }>,
    errores: [] as string[],
  };

  // ── 1. Documentos con owner_id NULL ──────────────────────────────────────────
  const { data: sinOwner, error: e1 } = await supabase
    .from('documentos')
    .select('id, documento_id, nombre, owner_id, workspace_id, created_at')
    .is('owner_id', null);

  if (e1) {
    results.errores.push(`Error consultando documentos sin owner_id: ${e1.message}`);
  }

  if (sinOwner && sinOwner.length > 0) {
    for (const doc of sinOwner) {
      results.documentos_procesados++;

      // Sin owner_id no podemos determinar a quién pertenece — registrar sin resolución
      results.documentos_sin_resolucion++;
      results.detalle.push({
        id: doc.id,
        documento_id: doc.documento_id ?? doc.id,
        problema: 'owner_id es NULL',
        accion: 'Sin resolución automática — no hay propietario identificable',
      });
    }
  }

  // ── 2. Documentos con workspace_id NULL (pero con owner_id válido) ────────────
  const { data: sinWorkspace, error: e2 } = await supabase
    .from('documentos')
    .select('id, documento_id, nombre, owner_id, workspace_id, created_at')
    .is('workspace_id', null)
    .not('owner_id', 'is', null);

  if (e2) {
    results.errores.push(`Error consultando documentos sin workspace_id: ${e2.message}`);
  }

  if (sinWorkspace && sinWorkspace.length > 0) {
    for (const doc of sinWorkspace) {
      results.documentos_procesados++;

      // Buscar el workspace personal del owner
      const { data: workspace, error: wErr } = await supabase
        .from('workspaces')
        .select('id')
        .eq('owner_id', doc.owner_id)
        .eq('workspace_type', 'personal')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (wErr || !workspace) {
        // No tiene workspace personal — crear uno
        const newWorkspaceId = crypto.randomUUID();

        // Obtener datos del usuario
        const { data: userProfile } = await supabase
          .from('user_profiles')
          .select('full_name, email')
          .eq('id', doc.owner_id)
          .single();

        const workspaceName = userProfile
          ? `${userProfile.full_name || userProfile.email?.split('@')[0] || 'Usuario'} Workspace`
          : 'Workspace Personal';

        const { error: createWsErr } = await supabase.from('workspaces').insert({
          id: newWorkspaceId,
          name: workspaceName,
          workspace_type: 'personal',
          owner_id: doc.owner_id,
          description: 'Espacio de trabajo personal',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        if (createWsErr) {
          results.errores.push(
            `Error creando workspace para owner ${doc.owner_id}: ${createWsErr.message}`
          );
          results.documentos_sin_resolucion++;
          results.detalle.push({
            id: doc.id,
            documento_id: doc.documento_id ?? doc.id,
            problema: 'workspace_id es NULL y no se pudo crear workspace personal',
            accion: `Error: ${createWsErr.message}`,
          });
          continue;
        }

        // Agregar owner como miembro del workspace
        await supabase.from('workspace_members').insert({
          id: crypto.randomUUID(),
          workspace_id: newWorkspaceId,
          user_id: doc.owner_id,
          role: 'owner',
          joined_at: new Date().toISOString(),
        });

        // Asignar el nuevo workspace al documento
        const { error: updateErr } = await supabase
          .from('documentos')
          .update({ workspace_id: newWorkspaceId })
          .eq('id', doc.id);

        if (updateErr) {
          results.errores.push(
            `Error actualizando documento ${doc.documento_id}: ${updateErr.message}`
          );
          results.documentos_sin_resolucion++;
          results.detalle.push({
            id: doc.id,
            documento_id: doc.documento_id ?? doc.id,
            problema: 'workspace_id es NULL',
            accion: `Error al actualizar: ${updateErr.message}`,
          });
        } else {
          results.documentos_actualizados++;
          results.detalle.push({
            id: doc.id,
            documento_id: doc.documento_id ?? doc.id,
            problema: 'workspace_id era NULL',
            accion: 'Workspace personal creado y asignado',
            nuevo_owner_id: doc.owner_id,
            nuevo_workspace_id: newWorkspaceId,
          });
        }
      } else {
        // Workspace personal encontrado — asignar al documento
        const { error: updateErr } = await supabase
          .from('documentos')
          .update({ workspace_id: workspace.id })
          .eq('id', doc.id);

        if (updateErr) {
          results.errores.push(
            `Error actualizando documento ${doc.documento_id}: ${updateErr.message}`
          );
          results.documentos_sin_resolucion++;
          results.detalle.push({
            id: doc.id,
            documento_id: doc.documento_id ?? doc.id,
            problema: 'workspace_id era NULL',
            accion: `Error al actualizar: ${updateErr.message}`,
          });
        } else {
          results.documentos_actualizados++;
          results.detalle.push({
            id: doc.id,
            documento_id: doc.documento_id ?? doc.id,
            problema: 'workspace_id era NULL',
            accion: 'Reasignado al workspace personal del creador',
            nuevo_owner_id: doc.owner_id,
            nuevo_workspace_id: workspace.id,
          });
        }
      }
    }
  }

  return NextResponse.json({
    mensaje:
      results.documentos_procesados === 0
        ? 'No se encontraron documentos con owner_id o workspace_id nulos. Todo está limpio.'
        : `Limpieza completada: ${results.documentos_actualizados} documentos actualizados, ${results.documentos_sin_resolucion} sin resolución automática.`,
    resumen: {
      documentos_procesados: results.documentos_procesados,
      documentos_actualizados: results.documentos_actualizados,
      documentos_sin_resolucion: results.documentos_sin_resolucion,
    },
    detalle: results.detalle,
    errores: results.errores,
  });
}

// GET — diagnóstico previo sin modificar datos
export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: sinOwner } = await supabase
    .from('documentos')
    .select('id, documento_id, nombre, estado, created_at, workspace_id, owner_id')
    .is('owner_id', null);

  const { data: sinWorkspace } = await supabase
    .from('documentos')
    .select('id, documento_id, nombre, estado, created_at, workspace_id, owner_id')
    .is('workspace_id', null)
    .not('owner_id', 'is', null);

  const { data: sinAmbos } = await supabase
    .from('documentos')
    .select('id, documento_id, nombre, estado, created_at, workspace_id, owner_id')
    .is('owner_id', null)
    .is('workspace_id', null);

  return NextResponse.json({
    instrucciones:
      'Envía una petición POST a esta misma URL para ejecutar la limpieza automática.',
    resumen: {
      sin_owner_id: sinOwner?.length ?? 0,
      sin_workspace_id_con_owner: sinWorkspace?.length ?? 0,
      sin_ambos: sinAmbos?.length ?? 0,
      total_afectados: (sinOwner?.length ?? 0) + (sinWorkspace?.length ?? 0),
    },
    documentos_sin_owner_id: sinOwner ?? [],
    documentos_sin_workspace_id: sinWorkspace ?? [],
    documentos_sin_ambos: sinAmbos ?? [],
  });
}
