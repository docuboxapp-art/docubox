import { isFinishedTask, type TaskStatus } from './view-state';

export type TaskOwnerScope = 'all' | 'assigned' | 'created';
export type TaskAttentionScope = 'all' | 'overdue' | 'today' | 'priority';
export type TaskOriginScope = 'all' | 'manual' | 'sistema';

type FilterableTask = {
  assignedTo: string | null;
  createdBy: string | null;
  origin: 'manual' | 'sistema';
  status: TaskStatus;
  dueDate: string;
  isOverdue: boolean;
  isCritical: boolean;
  priority: 'critica' | 'alta' | 'media' | 'baja';
};

type QuickTaskFilters = {
  owner: TaskOwnerScope;
  attention: TaskAttentionScope;
  origin: TaskOriginScope;
  userId: string | null;
  now: number;
};

export function matchesQuickTaskFilters(task: FilterableTask, filters: QuickTaskFilters): boolean {
  if (filters.owner === 'assigned' && (!filters.userId || task.assignedTo !== filters.userId)) return false;
  if (filters.owner === 'created' && (!filters.userId || task.createdBy !== filters.userId)) return false;
  if (filters.origin !== 'all' && task.origin !== filters.origin) return false;
  if (filters.attention === 'all') return true;
  if (isFinishedTask(task.status)) return false;
  if (filters.attention === 'overdue') return task.isOverdue || task.status === 'vencida';
  if (filters.attention === 'priority') return task.isCritical || task.priority === 'critica' || task.priority === 'alta';

  if (!task.dueDate || task.isOverdue) return false;
  const due = new Date(task.dueDate);
  const today = new Date(filters.now);
  return !Number.isNaN(due.getTime())
    && due.getFullYear() === today.getFullYear()
    && due.getMonth() === today.getMonth()
    && due.getDate() === today.getDate();
}
