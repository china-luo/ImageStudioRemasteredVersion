import { describe, expect, it, vi } from 'vitest'
import { getRecoveryTaskIds, prepareStartupTasks, pruneUnreferencedImageIds } from './storeBootstrap'

describe('store bootstrap helpers', () => {
  it('returns only tasks requiring provider recovery', () => {
    const result = getRecoveryTaskIds([
      { id: 'fal-running', apiProvider: 'fal', falRequestId: 'r', falEndpoint: 'e', status: 'running' } as never,
      { id: 'fal-error', apiProvider: 'fal', falRequestId: 'r', falEndpoint: 'e', status: 'error' } as never,
      {
        id: 'fal-recoverable',
        apiProvider: 'fal',
        falRequestId: 'r',
        falEndpoint: 'e',
        status: 'error',
        falRecoverable: true,
      } as never,
      { id: 'custom-running', customTaskId: 'c', status: 'running' } as never,
    ])

    expect(result).toEqual({ fal: ['fal-running', 'fal-recoverable'], custom: ['custom-running'] })
  })

  it('persists migrations and interrupted tasks before returning recovery candidates', async () => {
    const putTask = vi.fn(async () => undefined)
    const result = await prepareStartupTasks({
      storedTasks: [
        { id: 'changed', status: 'done' } as never,
        { id: 'openai-running', apiProvider: 'openai', status: 'running', createdAt: 10 } as never,
        { id: 'fal-running', apiProvider: 'fal', falRequestId: 'r', falEndpoint: 'e', status: 'running' } as never,
      ],
      migrateTask: (task) => ({ task, changed: task.id === 'changed' }),
      putTask,
    })

    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'changed' }))
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai-running', status: 'error' }))
    expect(result.recoveryTaskIds).toEqual({ fal: ['fal-running'], custom: [] })
  })

  it('retains referenced image ids and removes only orphans', async () => {
    const deleteImage = vi.fn(async () => undefined)
    const retained = await pruneUnreferencedImageIds({
      imageIds: ['keep-a', 'orphan', 'keep-b'],
      referencedIds: new Set(['keep-a', 'keep-b']),
      deleteImage,
    })

    expect(retained).toEqual(['keep-a', 'keep-b'])
    expect(deleteImage).toHaveBeenCalledOnce()
    expect(deleteImage).toHaveBeenCalledWith('orphan')
  })
})
