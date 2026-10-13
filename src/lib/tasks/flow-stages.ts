export type FlowAction = 'notify_assignee' | 'raise_priority' | 'create_followup';
export type FlowField =
  'status' | 'priority' | 'risk' | 'source_type' | 'overdue' | 'inactive_days';
export type FlowStage = {
  field: FlowField;
  operator: 'eq' | 'ne' | 'gte';
  value: string;
  onTrue: FlowAction[];
  onFalse: FlowAction[];
  nextTrue: number | null;
  nextFalse: number | null;
};

export function newFlowStage(): FlowStage {
  return {
    field: 'status',
    operator: 'eq',
    value: 'pendiente',
    onTrue: ['notify_assignee'],
    onFalse: [],
    nextTrue: null,
    nextFalse: null,
  };
}

/** Stage numbers are one-based and may only point forward, so every flow ends. */
export function flowStagesError(stages: FlowStage[], targetKind: string): string | null {
  if (stages.length > 5) return 'El flujo admite hasta cinco decisiones.';
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index];
    if (!stage || !stage.value.trim()) return `Completa la condición de la etapa ${index + 1}.`;
    if (targetKind !== 'task' && !['status', 'source_type', 'overdue'].includes(stage.field))
      return `La condición de la etapa ${index + 1} no corresponde a este recurso.`;
    if (
      ['priority', 'risk', 'status', 'source_type', 'overdue'].includes(stage.field) &&
      !['eq', 'ne'].includes(stage.operator)
    )
      return `El comparador de la etapa ${index + 1} no es válido.`;
    if (
      stage.field === 'inactive_days' &&
      (stage.operator !== 'gte' ||
        !/^\d+$/.test(stage.value) ||
        Number(stage.value) < 1 ||
        Number(stage.value) > 90)
    )
      return `Indica entre 1 y 90 días en la etapa ${index + 1}.`;
    for (const branch of [stage.onTrue, stage.onFalse]) {
      if (
        branch.length > 3 ||
        new Set(branch).size !== branch.length ||
        branch.some(
          (action) => !['notify_assignee', 'raise_priority', 'create_followup'].includes(action)
        )
      )
        return `Revisa las acciones de la etapa ${index + 1}.`;
      if (targetKind !== 'task' && branch.includes('raise_priority'))
        return 'La prioridad solo se puede elevar en tareas existentes.';
    }
    for (const next of [stage.nextTrue, stage.nextFalse]) {
      if (next !== null && (!Number.isInteger(next) || next <= index + 1 || next > stages.length))
        return `La etapa ${index + 1} solo puede continuar hacia una etapa posterior.`;
    }
  }
  return null;
}
