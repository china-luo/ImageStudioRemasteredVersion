import type { TaskRecord } from '../types'
import { markInterruptedOpenAIRunningTasks } from './taskBootstrap'
import { shouldRecoverCustomTask, shouldRecoverFalTask } from './taskRecovery'

export { markInterruptedOpenAIRunningTasks }

export function getRecoveryTaskIds(tasks: TaskRecord[]): { fal: string[]; custom: string[] } {
  const fal: string[] = []
  const custom: string[] = []
  for (const task of tasks) {
    if (shouldRecoverFalTask(task)) fal.push(task.id)
    if (shouldRecoverCustomTask(task)) custom.push(task.id)
  }
  return { fal, custom }
}

export async function prepareStartupTasks(options: {
  storedTasks: TaskRecord[]
  migrateTask: (task: TaskRecord) => { task: TaskRecord; changed: boolean }
  putTask: (task: TaskRecord) => Promise<unknown>
}): Promise<{ tasks: TaskRecord[]; recoveryTaskIds: { fal: string[]; custom: string[] } }> {
  const migrated = options.storedTasks.map(options.migrateTask)
  await Promise.all(migrated.filter((result) => result.changed).map((result) => options.putTask(result.task)))
  const { tasks, interruptedTasks } = markInterruptedOpenAIRunningTasks(migrated.map((result) => result.task))
  await Promise.all(interruptedTasks.map((task) => options.putTask(task)))
  return { tasks, recoveryTaskIds: getRecoveryTaskIds(tasks) }
}

/** Deletes only unreferenced image records and returns the records retained for thumbnail backfill. */
export async function pruneUnreferencedImageIds(options: {
  imageIds: Iterable<string>
  referencedIds: ReadonlySet<string>
  deleteImage: (imageId: string) => Promise<unknown>
}): Promise<string[]> {
  const retained: string[] = []
  for (const imageId of options.imageIds) {
    if (options.referencedIds.has(imageId)) {
      retained.push(imageId)
    } else {
      await options.deleteImage(imageId)
    }
  }
  return retained
}
