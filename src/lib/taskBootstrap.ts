import type { TaskRecord } from '../types'

export const OPENAI_INTERRUPTED_ERROR = '请求中断'

export function isOpenAITask(task: Pick<TaskRecord, 'apiProvider'>): boolean {
  return (task.apiProvider ?? 'openai') !== 'fal'
}

export function isRunningOpenAITask(task: Pick<TaskRecord, 'apiProvider' | 'status'>): boolean {
  return task.status === 'running' && isOpenAITask(task)
}

export function markInterruptedOpenAIRunningTasks(tasks: TaskRecord[], now = Date.now()) {
  const interruptedTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    if (!isRunningOpenAITask(task) || task.customTaskId) return task

    const updated: TaskRecord = {
      ...task,
      status: 'error',
      error: OPENAI_INTERRUPTED_ERROR,
      falRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    }
    interruptedTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, interruptedTasks }
}
