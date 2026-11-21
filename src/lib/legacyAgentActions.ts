import type {
  AgentConversation,
  AgentMessage,
  AgentRound,
  AppMode,
  AppSettings,
  ApiProfile,
  InputImage,
  MaskDraft,
  TaskParams,
} from '../types'
import { DEFAULT_PARAMS } from '../types'
import { createSettingsForApiProfile, getActiveApiProfile, normalizeSettings, validateApiProfile } from './apiProfiles'
import { normalizeParamsForSettings } from './paramCompatibility'

type RunningRound = { id: string; status: string }

export interface LegacyAgentSubmitState {
  settings: AppSettings
  prompt: string
  inputImages: InputImage[]
  maskDraft: MaskDraft | null
  params: TaskParams
  agentEditingRoundId: string | null
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
  setAppMode: (mode: AppMode) => void
  setShowSettings: (visible: boolean, tab?: 'general' | 'agent' | 'api' | 'data' | 'about') => void
  setPrompt: (prompt: string) => void
  clearInputImages: () => void
  clearMaskDraft: () => void
  setAgentEditingRoundId: (roundId: string | null) => void
}

export interface LegacyAgentSubmitDependencies {
  getState: () => LegacyAgentSubmitState
  getActiveConversation: () => AgentConversation
  getActiveRounds: (conversation: AgentConversation) => AgentRound[]
  getRoundPath: (conversation: AgentConversation, roundId: string | null) => AgentRound[]
  updateConversation: (conversationId: string, updater: (conversation: AgentConversation) => AgentConversation) => void
  orderInputImagesForMask: (inputImages: InputImage[], targetImageId: string) => InputImage[]
  validateMaskMatchesImage: (maskDataUrl: string, imageDataUrl: string) => Promise<unknown>
  storeImage: (dataUrl: string, kind?: 'input' | 'mask' | 'generated') => Promise<string>
  cacheImage: (id: string, dataUrl: string) => void
  createId: () => string
  uniqueIds: (ids: string[]) => string[]
  createConversationTitle: (prompt: string, currentTitle: string) => string
  generateConversationTitle: (
    conversationId: string,
    prompt: string,
    inputImageIds: string[],
    requestSettings: AppSettings,
    activeProfile: ApiProfile,
    fallbackTitle: string,
  ) => void
  executeAgentRound: (
    conversationId: string,
    roundId: string,
    params: TaskParams,
    settings: AppSettings,
    profile: ApiProfile,
  ) => void
}

export async function submitAgentMessage(dependencies: LegacyAgentSubmitDependencies): Promise<void> {
  const state = dependencies.getState()
  const normalizedSettings = normalizeSettings(state.settings)
  const activeProfile = getActiveApiProfile(normalizedSettings)

  if (activeProfile.provider !== 'openai' || activeProfile.apiMode !== 'responses') {
    state.setAppMode('agent')
    return
  }

  const profileError = validateApiProfile(activeProfile)
  if (profileError) {
    state.showToast(`请先完善请求 API 配置：${profileError}`, 'error')
    state.setShowSettings(true)
    return
  }

  const trimmedPrompt = state.prompt.trim()
  if (!trimmedPrompt) {
    state.showToast('请输入消息', 'error')
    return
  }

  const conversation = dependencies.getActiveConversation()
  if (conversation.rounds.some((round) => round.status === 'running')) {
    state.showToast('请等待生成完成，或先停止生成', 'info')
    return
  }

  let orderedInputImages = state.inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (state.maskDraft) {
    try {
      orderedInputImages = dependencies.orderInputImagesForMask(state.inputImages, state.maskDraft.targetImageId)
      await dependencies.validateMaskMatchesImage(state.maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      maskImageId = await dependencies.storeImage(state.maskDraft.maskDataUrl, 'mask')
      dependencies.cacheImage(maskImageId, state.maskDraft.maskDataUrl)
      maskTargetImageId = state.maskDraft.targetImageId
    } catch (err) {
      if (!state.inputImages.some((image) => image.id === state.maskDraft?.targetImageId)) state.clearMaskDraft()
      state.showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  const inputImageIds = dependencies.uniqueIds(orderedInputImages.map((image) => image.id))
  for (const image of orderedInputImages) await dependencies.storeImage(image.dataUrl, 'input')

  const requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  const normalizedParams = {
    ...normalizeParamsForSettings(state.params, requestSettings, { hasInputImages: inputImageIds.length > 0 }),
    n: DEFAULT_PARAMS.n,
  }
  const now = Date.now()
  const editingRoundId = state.agentEditingRoundId
  const editingRound = editingRoundId ? (conversation.rounds.find((item) => item.id === editingRoundId) ?? null) : null
  const editingAssistantMessage = editingRound?.assistantMessageId
    ? (conversation.messages.find((message) => message.id === editingRound.assistantMessageId) ?? null)
    : (conversation.messages.find((message) => message.roundId === editingRound?.id && message.role === 'assistant') ??
      null)
  const hasAssistantMessage = Boolean(editingAssistantMessage)
  const hasErrorAssistantMessage = Boolean(
    editingRound?.status === 'error' && editingAssistantMessage?.content.startsWith('请求失败：'),
  )
  const hasChildren = editingRound
    ? conversation.rounds.some((round) => (round.parentRoundId ?? null) === editingRound.id)
    : false
  const shouldAppendToEditingRound = Boolean(
    editingRound && !hasChildren && (!hasAssistantMessage || hasErrorAssistantMessage),
  )
  const roundId = shouldAppendToEditingRound && editingRound ? editingRound.id : dependencies.createId()
  const userMessageId =
    shouldAppendToEditingRound && editingRound ? editingRound.userMessageId : dependencies.createId()
  const activeRounds = dependencies.getActiveRounds(conversation)
  const activeLeafId = activeRounds[activeRounds.length - 1]?.id ?? null
  const parentRoundId = editingRound ? (editingRound.parentRoundId ?? null) : activeLeafId
  const parentPath = parentRoundId ? dependencies.getRoundPath(conversation, parentRoundId) : []
  const round: AgentRound = {
    id: roundId,
    index: shouldAppendToEditingRound && editingRound ? editingRound.index : parentPath.length + 1,
    parentRoundId,
    ...(hasErrorAssistantMessage && editingAssistantMessage ? { assistantMessageId: editingAssistantMessage.id } : {}),
    userMessageId,
    prompt: trimmedPrompt,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
  }
  const userMessage: AgentMessage = {
    id: userMessageId,
    role: 'user',
    content: trimmedPrompt,
    roundId,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    createdAt: now,
  }

  let fallbackTitle: string | null = null
  dependencies.updateConversation(conversation.id, (current) => {
    const nextTitle =
      current.rounds.length === 0 ? dependencies.createConversationTitle(trimmedPrompt, current.title) : current.title
    if (current.rounds.length === 0) fallbackTitle = nextTitle
    const messages = shouldAppendToEditingRound
      ? current.messages.some((message) => message.id === userMessageId)
        ? current.messages.map((message) => {
            if (message.id === userMessageId) return userMessage
            if (hasErrorAssistantMessage && message.id === editingAssistantMessage?.id)
              return { ...message, content: '', outputTaskIds: [] }
            return message
          })
        : [...current.messages, userMessage]
      : [...current.messages, userMessage]
    return {
      ...current,
      title: nextTitle,
      activeRoundId: roundId,
      updatedAt: now,
      rounds: shouldAppendToEditingRound
        ? current.rounds.map((item) => (item.id === roundId ? round : item))
        : [...current.rounds, round],
      messages,
    }
  })

  state.setPrompt('')
  state.clearInputImages()
  state.clearMaskDraft()
  state.setAgentEditingRoundId(null)

  if (fallbackTitle) {
    dependencies.generateConversationTitle(
      conversation.id,
      trimmedPrompt,
      inputImageIds,
      requestSettings,
      activeProfile,
      fallbackTitle,
    )
  }
  dependencies.executeAgentRound(conversation.id, roundId, normalizedParams, requestSettings, activeProfile)
}

export interface LegacyAgentStopDependencies {
  getConversation: (conversationId: string) => AgentConversation | undefined
  getActiveRounds: (conversation: AgentConversation) => RunningRound[]
  getController: (conversationId: string, roundId: string) => AbortController | undefined
  markRoundStopped: (conversationId: string, roundId: string) => boolean
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
}

export function stopAgentResponse(
  dependencies: LegacyAgentStopDependencies,
  conversationId: string | null = null,
): void {
  if (!conversationId) return
  const conversation = dependencies.getConversation(conversationId)
  if (!conversation) return
  const activeRunningRound = [...dependencies.getActiveRounds(conversation)]
    .reverse()
    .find((round) => round.status === 'running')
  const runningRound = activeRunningRound ?? conversation.rounds.find((round) => round.status === 'running')
  if (!runningRound) return

  const controller = dependencies.getController(conversationId, runningRound.id)
  if (controller) {
    controller.abort()
    if (dependencies.markRoundStopped(conversationId, runningRound.id)) {
      dependencies.showToast('已停止生成', 'info')
    }
    return
  }

  dependencies.markRoundStopped(conversationId, runningRound.id)
  dependencies.showToast('已停止生成', 'info')
}

export interface LegacyAgentRegenerateState {
  settings: AppSettings
  params: TaskParams
  agentConversations: AgentConversation[]
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
  setAppMode: (mode: 'gallery' | 'sop' | 'voc') => void
  setShowSettings: (visible: boolean, tab?: 'general' | 'agent' | 'api' | 'data' | 'about') => void
  setAgentEditingRoundId: (roundId: string | null) => void
}

export interface LegacyAgentRegenerateDependencies {
  getState: () => LegacyAgentRegenerateState
  updateConversation: (conversationId: string, updater: (conversation: AgentConversation) => AgentConversation) => void
  createId: () => string
  executeAgentRound: (
    conversationId: string,
    roundId: string,
    params: TaskParams,
    settings: AppSettings,
    profile: ApiProfile,
  ) => void
}

export async function regenerateAgentAssistantMessage(
  dependencies: LegacyAgentRegenerateDependencies,
  conversationId: string,
  roundId: string,
): Promise<void> {
  const state = dependencies.getState()
  const normalizedSettings = normalizeSettings(state.settings)
  const activeProfile = getActiveApiProfile(normalizedSettings)
  if (activeProfile.provider !== 'openai' || activeProfile.apiMode !== 'responses') {
    state.setAppMode('gallery')
    return
  }
  const profileError = validateApiProfile(activeProfile)
  if (profileError) {
    state.showToast(`请先完善请求 API 配置：${profileError}`, 'error')
    state.setShowSettings(true)
    return
  }

  const conversation = state.agentConversations.find((item) => item.id === conversationId)
  const sourceRound = conversation?.rounds.find((item) => item.id === roundId) ?? null
  const sourceUserMessage = sourceRound
    ? (conversation?.messages.find((message) => message.id === sourceRound.userMessageId) ?? null)
    : null
  if (!conversation || !sourceRound || !sourceUserMessage) {
    state.showToast('找不到要重新生成的 Agent 消息', 'error')
    return
  }
  if (conversation.rounds.some((round) => round.status === 'running')) {
    state.showToast('请等待生成完成，或先停止生成', 'info')
    return
  }

  const inputImageIds = Array.from(new Set(sourceRound.inputImageIds.filter(Boolean)))
  const requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  const normalizedParams = {
    ...normalizeParamsForSettings(state.params, requestSettings, { hasInputImages: inputImageIds.length > 0 }),
    n: DEFAULT_PARAMS.n,
  }
  const now = Date.now()
  if (sourceRound.status === 'error') {
    const assistantMessageId =
      sourceRound.assistantMessageId ??
      conversation.messages.find((message) => message.roundId === sourceRound.id && message.role === 'assistant')?.id
    dependencies.updateConversation(conversationId, (current) => ({
      ...current,
      activeRoundId: sourceRound.id,
      updatedAt: now,
      rounds: current.rounds.map((round) =>
        round.id === sourceRound.id
          ? {
              ...round,
              outputTaskIds: [],
              responseId: undefined,
              responseOutput: undefined,
              status: 'running',
              error: null,
              finishedAt: null,
            }
          : round,
      ),
      messages: assistantMessageId
        ? current.messages.map((message) =>
            message.id === assistantMessageId ? { ...message, content: '', outputTaskIds: [] } : message,
          )
        : current.messages,
    }))
    state.setAgentEditingRoundId(null)
    dependencies.executeAgentRound(conversationId, sourceRound.id, normalizedParams, requestSettings, activeProfile)
    return
  }

  const newRoundId = dependencies.createId()
  const newUserMessageId = dependencies.createId()
  const maskTargetImageId = sourceRound.maskTargetImageId ?? sourceUserMessage.maskTargetImageId ?? null
  const maskImageId = sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null
  const newRound: AgentRound = {
    id: newRoundId,
    index: sourceRound.index,
    parentRoundId: sourceRound.parentRoundId ?? null,
    userMessageId: newUserMessageId,
    prompt: sourceRound.prompt || sourceUserMessage.content.trim(),
    inputImageIds: inputImageIds,
    maskTargetImageId,
    maskImageId,
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
  }
  const newUserMessage: AgentMessage = {
    id: newUserMessageId,
    role: 'user',
    content: sourceUserMessage.content,
    roundId: newRoundId,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    createdAt: now,
  }
  dependencies.updateConversation(conversationId, (current) => ({
    ...current,
    activeRoundId: newRoundId,
    updatedAt: now,
    rounds: [...current.rounds, newRound],
    messages: [...current.messages, newUserMessage],
  }))
  state.setAgentEditingRoundId(null)
  dependencies.executeAgentRound(conversationId, newRoundId, normalizedParams, requestSettings, activeProfile)
}
