import { z } from 'zod';

const unitIds = z
  .array(z.string().uuid())
  .max(200)
  .transform((ids) => [...new Set(ids)]);
export const organizationRoleScopeSchema = z.discriminatedUnion('scope_type', [
  z.object({
    scope_type: z.enum(['organization', 'team', 'own', 'assigned']),
    scope_config: z.object({}).strict().default({}),
  }),
  z.object({
    scope_type: z.literal('units'),
    scope_config: z
      .object({
        unit_ids: unitIds.refine((ids) => ids.length > 0, 'Selecciona al menos una unidad.'),
      })
      .strict(),
  }),
  z.object({
    scope_type: z.literal('custom'),
    scope_config: z
      .object({
        unit_ids: unitIds.default([]),
        include_own: z.boolean().default(false),
        include_assigned: z.boolean().default(false),
      })
      .strict()
      .refine(
        (config) => config.include_own || config.include_assigned || config.unit_ids.length > 0,
        'Selecciona al menos un criterio de alcance.'
      ),
  }),
]);
export type OrganizationRoleScope = z.infer<typeof organizationRoleScopeSchema>;

// Workspace administration remains an organization-wide capability. Resource
// permissions are checked again against the concrete row in SQL and the APIs.
export function isResourceScopedPermission(permission: string) {
  return (
    /^(tasks|reviews|versions|collaboration_spaces|requests|rooms|automations)\./.test(
      permission
    ) || permission === 'collaboration.view_dashboard'
  );
}

export const organizationScopeLabels: Record<string, string> = {
  organization: 'Toda la organización',
  units: 'Unidades seleccionadas',
  team: 'Solo equipo',
  own: 'Elementos propios',
  assigned: 'Elementos asignados',
  custom: 'Personalizado',
};
