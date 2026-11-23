import type { TaskRecord } from '../types'
import { addTaskImageReferences } from './taskImageReferences'

export interface TaskDeletionState {
  tasks: TaskRecord[]
  selectedTaskIds: string[]
  setTasks: (tasks: TaskRecord[]) => void
  setSelectedTaskIds: (taskIds: string[]) => void
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
}

export interface TaskDeletionManagerDependencies {
  getState: () => TaskDeletionState
  cancelTaskWork?: (taskId: string) => void
  deleteTask: (taskId: string) => Promise<unknown>
  putTask: (task: TaskRecord) => Promise<unknown>
  deleteUnreferencedImages: (imageIds: Iterable<string>) => Promise<unknown>
  scrubDeletedTasks: (deletedTasks: TaskRecord[], remainingTasks: TaskRecord[]) => TaskRecord[]
}

/**
 * Owns persisted task deletion and the image cleanup candidates it creates. Agent conversation
 * scrubbing stays injectable because it is legacy state behavior, not persistence behavior.
 */
export function createTaskDeletionManager(deps: TaskDeletionManagerDependencies) {
  const remove = async (taskIds: string[], message: string) => {
    const state = deps.getState()
    const toDelete = new Set(taskIds)
    const deletedTasks = state.tasks.filter((task) => toDelete.has(task.id))
    const remaining = state.tasks.filter((task) => !toDelete.has(task.id))
    const scrubbed = deps.scrubDeletedTasks(deletedTasks, remaining)
    const originalById = new Map(remaining.map((task) => [task.id, task]))
    const deletedImageIds = new Set<string>()
    for (const task of deletedTasks) addTaskImageReferences(deletedImageIds, task)

    // 整体更新在等待磁盘前完成，避免用旧列表覆盖并发提交或完成的任务。
    state.setTasks(scrubbed)
    // Stop local polling before awaiting disk deletion. This does not cancel upstream billing.
    for (const taskId of toDelete) deps.cancelTaskWork?.(taskId)
    const nextSelection = state.selectedTaskIds.filter((taskId) => !toDelete.has(taskId))
    if (nextSelection.length !== state.selectedTaskIds.length) state.setSelectedTaskIds(nextSelection)
    await Promise.all([
      ...Array.from(toDelete, (taskId) => deps.deleteTask(taskId)),
      ...scrubbed.filter((task) => task !== originalById.get(task.id)).map(deps.putTask),
    ])
    await deps.deleteUnreferencedImages(deletedImageIds)
    state.showToast(message, 'success')
  }

  return {
    async removeMany(taskIds: string[]) {
      if (taskIds.length) await remove(taskIds, `已删除 ${new Set(taskIds).size} 条记录`)
    },
    async removeOne(task: TaskRecord) {
      await remove([task.id], '记录已删除')
    },
  }
}
