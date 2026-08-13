import type { TaskRecord } from '../types'

export interface LegacyTaskMigrationResult {
  task: TaskRecord
  removedImageIds: string[]
  changed: boolean
}

export function migrateLegacyTaskStreamFields(task: TaskRecord): LegacyTaskMigrationResult {
  const record = task as TaskRecord & { streamPartialImageIds?: unknown }
  if (!Object.prototype.hasOwnProperty.call(record, 'streamPartialImageIds')) {
    return { task, removedImageIds: [], changed: false }
  }

  const removedImageIds = Array.isArray(record.streamPartialImageIds)
    ? record.streamPartialImageIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
    : []
  const { streamPartialImageIds: _removed, ...migrated } = record
  return { task: migrated as TaskRecord, removedImageIds, changed: true }
}
