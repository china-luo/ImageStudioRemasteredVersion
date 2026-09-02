import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import {
  collectReferencedImageIds,
  collectReferencedImageIdsFromState,
  collectTaskImageIds,
  collectUnreferencedImageIds,
} from './taskImageReferences'

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
  inputImageIds: ['input-1'],
  outputImages: ['output-1'],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
  ...overrides,
})

describe('task image references', () => {
  it('collects task input, mask, and output images', () => {
    expect(collectTaskImageIds(task({ maskImageId: 'mask-1' }))).toEqual(['input-1', 'mask-1', 'output-1'])
  })

  it('combines task, draft, agent, and planner references', () => {
    const referenced = collectReferencedImageIds({
      tasks: [task()],
      inputImages: [{ id: 'current-1', dataUrl: '' }],
      galleryInputDraft: { inputImages: [{ id: 'draft-1', dataUrl: '' }] },
      sopDraftImageIds: ['sop-1'],
      agentConversations: [
        {
          id: 'conversation-1',
          title: 'test',
          createdAt: 1,
          updatedAt: 1,
          activeRoundId: null,
          rounds: [
            {
              id: 'round-1',
              index: 0,
              parentRoundId: null,
              userMessageId: 'message-1',
              prompt: 'test',
              inputImageIds: ['agent-1'],
              outputTaskIds: [],
              createdAt: 1,
              status: 'done',
              error: null,
              finishedAt: 2,
            },
          ],
          messages: [
            {
              id: 'message-1',
              role: 'user',
              content: 'test',
              roundId: 'round-1',
              inputImageIds: [],
              maskTargetImageId: null,
              maskImageId: 'agent-mask-1',
              createdAt: 1,
            },
          ],
        },
      ],
      plannerSessions: [{ referenceImageIds: ['planner-1'], styleImages: [{ imageId: 'style-1' }] } as never],
      collectPlannerSessionImageIds: (session) => [
        ...(session.referenceImageIds ?? []),
        ...(session.styleImages ?? []).map((item) => item.imageId ?? ''),
      ],
    })

    expect(Array.from(referenced).sort()).toEqual([
      'agent-1',
      'agent-mask-1',
      'current-1',
      'draft-1',
      'input-1',
      'output-1',
      'planner-1',
      'sop-1',
      'style-1',
    ])
  })

  it('returns only candidates that are not referenced', () => {
    expect(collectUnreferencedImageIds(['a', 'b', 'b', ''], new Set(['b']))).toEqual(['a'])
  })

  it('requires the complete persisted state needed by startup garbage collection', () => {
    const referenced = collectReferencedImageIdsFromState({
      tasks: [task()],
      inputImages: [],
      galleryInputDraft: null,
      sopDraftImageIds: [],
      agentConversations: [],
      agentInputDrafts: [],
    })

    expect(Array.from(referenced)).toEqual(['input-1', 'output-1'])
  })
})
