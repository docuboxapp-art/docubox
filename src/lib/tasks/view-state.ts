import { isScheduledForLater } from './schedule';

export type TaskStatus =
  | 'nueva' | 'programada' | 'pendiente' | 'en_proceso' | 'bloqueada'
  | 'en_revision' | 'vencida' | 'escalada' | 'completada' | 'cancelada' | 'rechazada';

export type TaskStatusScope = TaskStatus | 'active' | 'all';

type TaskState = {
  status: TaskStatus;
  scheduledFor?: string | null;
  isOverdue?: boolean;
  isBlocked?: boolean;
};

export function isFinishedTask(status: TaskStatus): boolean {
  return status === 'completada' || status === 'cancelada' || status === 'rechazada';
}

export function taskStatusAtTime(task: TaskState, now: number): TaskStatus {
  if (['nueva', 'pendiente', 'programada'].includes(task.status)
    && isScheduledForLater(task.scheduledFor, now)) return 'programada';
  if (task.status === 'programada') return 'pendiente';
  return task.status;
}

export function visibleTaskStatus(task: TaskState): TaskStatus {
  if (isFinishedTask(task.status)) return task.status;
  if (task.isBlocked || task.status === 'bloqueada') return 'bloqueada';
  if (task.isOverdue || task.status === 'vencida') return 'vencida';
  return task.status;
}

export function matchesTaskStatus(task: TaskState, scope: TaskStatusScope): boolean {
  if (scope === 'all') return true;
  if (scope === 'active') return !isFinishedTask(task.status);
  if (scope === 'vencida') return !isFinishedTask(task.status) && Boolean(task.isOverdue || task.status === 'vencida');
  if (scope === 'bloqueada') return !isFinishedTask(task.status) && Boolean(task.isBlocked || task.status === 'bloqueada');
  return visibleTaskStatus(task) === scope;
}
