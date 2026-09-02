import { describe, expect, it } from 'vitest'
import type { AgentConversation, AgentRound } from '../types'
import { getActiveAgentRounds, getAgentRoundPath } from './agentConversationGraph'

function round(id: string, parentRoundId: string | null = null): AgentRound {
  return {
    id,
    index: 1,
    parentRoundId,
    userMessageId: `user-${id}`,
    prompt: id,
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputTaskIds: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 1,
  }
}

describe('agentConversationGraph', () => {
  it('walks the active branch without touching the Zustand store', () => {
    const conversation: AgentConversation = {
      id: 'c1',
      title: 't',
      createdAt: 1,
      updatedAt: 1,
      activeRoundId: 'r2',
      rounds: [round('r1'), round('r2', 'r1'), round('r3', 'r1')],
      messages: [],
    }

    expect(getAgentRoundPath(conversation, 'r2').map((item) => item.id)).toEqual(['r1', 'r2'])
    expect(getActiveAgentRounds(conversation).map((item) => item.id)).toEqual(['r1', 'r2'])
  })
})
