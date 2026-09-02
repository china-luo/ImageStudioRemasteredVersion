import { describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../types'
import { createTaskDeletionManager } from './taskDeletionManager'

const task = (id: string, imageId: string): TaskRecord => ({
  id,
  prompt: 'test',
  params: {
    size: '1024x1024',
    quality: 'auto',
    output_format: 'jpeg',
    output_compression: 70,
    moderation: 'auto',
    n: 1,
  },
  inputImageIds: [imageId],
  outputImages: [],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
})

describe('task deletion manager', () => {
  it('deletes task records, cleans their image candidates, and updates the selection', async () => {
    const first = task('first', 'first-image')
    const second = task('second', 'second-image')
    const state = {
      tasks: [first, second],
      selectedTaskIds: ['first', 'other'],
      setTasks: vi.fn(),
      setSelectedTaskIds: vi.fn(),
      showToast: vi.fn(),
    }
    const deleteTask = vi.fn(async () => undefined)
    const deleteUnreferencedImages = vi.fn(async () => undefined)
    const scrubDeletedTasks = vi.fn(async (_deleted: TaskRecord[], remaining: TaskRecord[]) => remaining)
    const manager = createTaskDeletionManager({
      getState: () => state,
      deleteTask,
      deleteUnreferencedImages,
      scrubDeletedTasks,
    })

    await manager.removeMany(['first'])

    expect(state.setTasks).toHaveBeenCalledWith([second])
    expect(deleteTask).toHaveBeenCalledWith('first')
    expect(deleteUnreferencedImages).toHaveBeenCalledWith(new Set(['first-image']))
    expect(state.setSelectedTaskIds).toHaveBeenCalledWith(['other'])
    expect(state.showToast).toHaveBeenCalledWith('已删除 1 条记录', 'success')
  })

  it('removes one task while keeping conversation cleanup injectable', async () => {
    const current = task('current', 'current-image')
    const remaining = task('remaining', 'remaining-image')
    const state = {
      tasks: [current, remaining],
      selectedTaskIds: [],
      setTasks: vi.fn(),
      setSelectedTaskIds: vi.fn(),
      showToast: vi.fn(),
    }
    const scrubDeletedTasks = vi.fn(async () => [remaining])
    const manager = createTaskDeletionManager({
      getState: () => state,
      deleteTask: async () => undefined,
      deleteUnreferencedImages: async () => undefined,
      scrubDeletedTasks,
    })

    await manager.removeOne(current)

    expect(scrubDeletedTasks).toHaveBeenCalledWith([current], [remaining])
    expect(state.setTasks).toHaveBeenCalledWith([remaining])
    expect(state.showToast).toHaveBeenCalledWith('记录已删除', 'success')
  })
})
