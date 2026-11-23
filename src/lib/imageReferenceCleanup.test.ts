import { describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../types'
import { deleteImageIfUnreferenced, deleteUnreferencedImageCandidates } from './imageReferenceCleanup'

const task = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 'task-1',
  prompt: 'test',
  params: {
    size: '1024x1024',
    quality: 'auto',
    output_format: 'jpeg',
    output_compression: 70,
    moderation: 'auto',
    n: 1,
  },
  inputImageIds: [],
  outputImages: [],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
  ...overrides,
})

const state = (tasks: TaskRecord[] = []) => ({
  tasks,
  inputImages: [],
  galleryInputDraft: null,
  sopDraft: null,
  agentConversations: [],
  agentInputDrafts: [],
})

describe('image reference cleanup', () => {
  it('deletes only candidates that no state or planner session references', async () => {
    const deleteImage = vi.fn(async () => undefined)
    const forgetCachedImage = vi.fn()
    const deleted = await deleteUnreferencedImageCandidates({
      candidates: ['task-image', 'planner-image', 'orphan'],
      state: state([task({ outputImages: ['task-image'] })]),
      getPlannerSessions: async () => [{ referenceImageIds: ['planner-image'], styleImages: [] } as never],
      deleteImage,
      forgetCachedImage,
    })

    expect(deleted).toEqual(['orphan'])
    expect(deleteImage).toHaveBeenCalledWith('orphan')
    expect(forgetCachedImage).toHaveBeenCalledWith('orphan')
  })

  it('does not delete images still referenced by an unsubmitted editor draft', async () => {
    const deleteImage = vi.fn(async () => undefined)
    const deleted = await deleteUnreferencedImageCandidates({
      candidates: ['editor-source', 'editor-reference', 'orphan'],
      state: {
        ...state(),
        seedreamEditorDraft: { sourceImageId: 'editor-source', referenceImageIds: ['editor-reference'] },
      },
      getPlannerSessions: async () => [],
      deleteImage,
      forgetCachedImage: vi.fn(),
    })

    expect(deleted).toEqual(['orphan'])
    expect(deleteImage).toHaveBeenCalledExactlyOnceWith('orphan')
  })

  it('forgets a replaced image even when another state reference retains it', async () => {
    const deleteImage = vi.fn(async () => undefined)
    const forgetCachedImage = vi.fn()
    const deleted = await deleteImageIfUnreferenced({
      imageId: 'retained',
      state: { ...state(), inputImages: [{ id: 'retained', dataUrl: '' }] },
      getPlannerSessions: async () => [],
      deleteImage,
      forgetCachedImage,
    })

    expect(deleted).toBe(false)
    expect(deleteImage).not.toHaveBeenCalled()
    expect(forgetCachedImage).toHaveBeenCalledWith('retained')
  })
})
