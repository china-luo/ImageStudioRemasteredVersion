import { describe, expect, it } from 'vitest'
import {
  isEmptyAgentConversation,
  mergeImportedAgentConversations,
  normalizeAgentConversations,
} from './agentConversationNormalize'

describe('agentConversationNormalize', () => {
  it('normalizes persisted conversations and marks empty ones', () => {
    const conversations = normalizeAgentConversations([
      { id: 'c1', title: '', rounds: [], messages: [], createdAt: 1, updatedAt: 1 },
    ])
    expect(conversations[0].title).toBe('新对话')
    expect(isEmptyAgentConversation(conversations[0])).toBe(true)
  })

  it('merges imported conversations by id', () => {
    const current = normalizeAgentConversations([
      { id: 'c1', title: 'old', rounds: [], messages: [], createdAt: 1, updatedAt: 1 },
    ])
    const imported = normalizeAgentConversations([
      { id: 'c1', title: 'new', rounds: [], messages: [], createdAt: 1, updatedAt: 2 },
    ])
    expect(mergeImportedAgentConversations(current, imported)[0].title).toBe('new')
  })
})
