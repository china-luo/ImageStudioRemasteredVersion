import type { TaskRecord } from '../types'
import { matchesTaskHistoryFilters, type TaskHistoryFilters } from './taskHistory'

export function getFilteredTasks(tasks: TaskRecord[], filters: TaskHistoryFilters): TaskRecord[] {
  return [...tasks].sort((a, b) => b.createdAt - a.createdAt).filter((task) => matchesTaskHistoryFilters(task, filters))
}

export function getSelectionToggleTaskIds(selectedTaskIds: string[], filteredTasks: TaskRecord[]): string[] | null {
  return selectedTaskIds.length === filteredTasks.length && filteredTasks.length > 0
    ? null
    : filteredTasks.map((task) => task.id)
}

export function getSelectedOutputImageIds(tasks: TaskRecord[], selectedTaskIds: string[]): string[] {
  const selectedIds = new Set(selectedTaskIds)
  return tasks.flatMap((task) => (selectedIds.has(task.id) ? (task.outputImages ?? []) : []))
}
