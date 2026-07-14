import type { TaskRecord } from '../types'

export const SUPPORT_PROMPT_IMAGE_THRESHOLD = 10

export function isSupportPromptAgentTask(task: TaskRecord) {
  return task.sourceMode === 'agent' || Boolean(task.agentConversationId || task.agentRoundId)
}

export function countSuccessfulOutputImages(tasks: TaskRecord[]) {
  return tasks.reduce(
    (count, task) => count + (
      task.status === 'done' && !isSupportPromptAgentTask(task)
        ? task.outputImages.length
        : 0
    ),
    0,
  )
}

export function shouldOpenSupportPromptForTaskCompletion(
  previousTasks: TaskRecord[],
  nextTasks: TaskRecord[],
  taskId: string,
  threshold = SUPPORT_PROMPT_IMAGE_THRESHOLD,
) {
  const previousTask = previousTasks.find((task) => task.id === taskId)
  const nextTask = nextTasks.find((task) => task.id === taskId)

  if (
    threshold <= 0 ||
    !nextTask ||
    previousTask?.status === 'done' ||
    nextTask.status !== 'done' ||
    nextTask.outputImages.length === 0 ||
    isSupportPromptAgentTask(nextTask)
  ) return false

  const previousCount = countSuccessfulOutputImages(previousTasks)
  const nextCount = countSuccessfulOutputImages(nextTasks)
  return Math.floor(nextCount / threshold) > Math.floor(previousCount / threshold)
}
