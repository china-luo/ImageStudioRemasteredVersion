import { describe, expect, it, vi } from 'vitest'
import { stopAgentResponse, submitAgentMessage } from './legacyAgentActions'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { DEFAULT_PARAMS } from '../types'
import { regenerateAgentAssistantMessage } from './legacyAgentActions'

describe('legacy agent actions', () => {
  it('falls back to gallery when submitting from a non-Responses profile', async () => {
    const setAppMode = vi.fn()
    const conversation = {
      id: 'conversation-1',
      title: '新对话',
      activeRoundId: null,
      createdAt: 1,
      updatedAt: 1,
      rounds: [],
      messages: [],
    }
    await submitAgentMessage({
      getState: () => ({
        settings: DEFAULT_SETTINGS,
        prompt: 'hello',
        inputImages: [],
        maskDraft: null,
        params: DEFAULT_PARAMS,
        agentEditingRoundId: null,
        showToast: vi.fn(),
        setAppMode,
        setShowSettings: vi.fn(),
        setPrompt: vi.fn(),
        clearInputImages: vi.fn(),
        clearMaskDraft: vi.fn(),
        setAgentEditingRoundId: vi.fn(),
      }),
      getActiveConversation: () => conversation,
      getActiveRounds: (current) => current.rounds,
      getRoundPath: () => [],
      updateConversation: vi.fn(),
      orderInputImagesForMask: (images) => images,
      validateMaskMatchesImage: vi.fn(),
      storeImage: vi.fn(async () => 'image-1'),
      cacheImage: vi.fn(),
      createId: () => 'id',
      uniqueIds: (ids) => ids,
      createConversationTitle: (prompt) => prompt,
      generateConversationTitle: vi.fn(),
      executeAgentRound: vi.fn(),
    })
    expect(setAppMode).toHaveBeenCalledWith('agent')
  })

  it('aborts the active round and reports the stopped state', () => {
    const controller = new AbortController()
    const markRoundStopped = vi.fn(() => true)
    const showToast = vi.fn()
    stopAgentResponse(
      {
        getConversation: () => ({ rounds: [{ id: 'round-1', status: 'running' }] }) as never,
        getActiveRounds: () => [{ id: 'round-1', status: 'running' }],
        getController: () => controller,
        markRoundStopped,
        showToast,
      },
      'conversation-1',
    )

    expect(controller.signal.aborted).toBe(true)
    expect(markRoundStopped).toHaveBeenCalledWith('conversation-1', 'round-1')
    expect(showToast).toHaveBeenCalledWith('已停止生成', 'info')
  })

  it('does nothing when there is no running round', () => {
    const showToast = vi.fn()
    stopAgentResponse(
      {
        getConversation: () => ({ rounds: [] }) as never,
        getActiveRounds: () => [],
        getController: () => undefined,
        markRoundStopped: vi.fn(),
        showToast,
      },
      'conversation-1',
    )
    expect(showToast).not.toHaveBeenCalled()
  })

  it('falls back to gallery when the active profile cannot run Agent Responses', async () => {
    const setAppMode = vi.fn()
    await regenerateAgentAssistantMessage(
      {
        getState: () => ({
          settings: DEFAULT_SETTINGS,
          params: DEFAULT_PARAMS,
          agentConversations: [],
          showToast: vi.fn(),
          setAppMode,
          setShowSettings: vi.fn(),
          setAgentEditingRoundId: vi.fn(),
        }),
        updateConversation: vi.fn(),
        createId: () => 'id',
        executeAgentRound: vi.fn(),
      },
      'conversation-1',
      'round-1',
    )
    expect(setAppMode).toHaveBeenCalledWith('gallery')
  })
})
