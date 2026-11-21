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
  deleteTask: (taskId: string) => Promise<unknown>
  deleteUnreferencedImages: (imageIds: Iterable<string>) => Promise<unknown>
  scrubDeletedTasks: (deletedTasks: TaskRecord[], remainingTasks: TaskRecord[]) => Promise<TaskRecord[]>
}

/**
 * Owns persisted task deletion and the image cleanup candidates it creates. Agent conversation
 * scrubbing stays injectable because it is legacy state behavior, not persistence behavior.
 */
export function createTaskDeletionManager(deps: TaskDeletionManagerDependencies) {
  const removeMany = async (taskIds: string[]): Promise<void> => {
    if (!taskIds.length) return
    const state = deps.getState()
    const toDelete = new Set(taskIds)
    const deletedTasks = state.tasks.filter((task) => toDelete.has(task.id))
    const remaining = await deps.scrubDeletedTasks(
      deletedTasks,
      state.tasks.filter((task) => !toDelete.has(task.id)),
    )
    const deletedImageIds = new Set<string>()
    for (const task of deletedTasks) addTaskImageReferences(deletedImageIds, task)

    state.setTasks(remaining)
    await Promise.all(taskIds.map((taskId) => deps.deleteTask(taskId)))
    await deps.deleteUnreferencedImages(deletedImageIds)

    const nextSelection = state.selectedTaskIds.filter((taskId) => !toDelete.has(taskId))
    if (nextSelection.length !== state.selectedTaskIds.length) state.setSelectedTaskIds(nextSelection)
    state.showToast(`已删除 ${taskIds.length} 条记录`, 'success')
  }

  const removeOne = async (task: TaskRecord): Promise<void> => {
    const state = deps.getState()
    const remaining = await deps.scrubDeletedTasks(
      [task],
      state.tasks.filter((item) => item.id !== task.id),
    )
    const imageIds = new Set<string>()
    addTaskImageReferences(imageIds, task)

    state.setTasks(remaining)
    await deps.deleteTask(task.id)
    await deps.deleteUnreferencedImages(imageIds)
    state.showToast('记录已删除', 'success')
  }

  return { removeMany, removeOne }
}
