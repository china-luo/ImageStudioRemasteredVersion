import type { TaskRecord } from '../../types'
import { canResumeTaskRecovery, isTaskReconnecting } from '../../lib/taskRecovery'

// 暂停或重连仍属于原任务，不能当作终态失败重新付费提交。
export function isPlannerTaskPending(task: TaskRecord): boolean {
  return (
    task.status === 'running' ||
    isTaskReconnecting(task) ||
    canResumeTaskRecovery(task) ||
    (task.status === 'error' && Boolean(task.recoveryPausedReason))
  )
}

export function isPlannerTaskFailed(task: TaskRecord | undefined): boolean {
  return Boolean(task?.status === 'error' && !isPlannerTaskPending(task))
}
