import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AgentConversation,
  AgentMessage,
  AgentRound,
  ApiMode,
  ApiProfile,
  AppSettings,
  AppMode,
  HistoryAspectFilter,
  HistoryWorkflowFilter,
  TaskParams,
  InputImage,
  MaskDraft,
  SeedreamEditorDraft,
  TaskRecord,
  ResponsesApiResponse,
  ResponsesOutputItem,
} from './types'
import { DEFAULT_PARAMS } from './types'
import { getAllGenerationProjects } from './lib/db'
import { readProjectJournal } from './lib/generationProjects'
import {
  createSettingsForApiProfile,
  DEFAULT_SETTINGS,
  getActiveApiProfile,
  normalizeSettings,
} from './lib/apiProfiles'
import { setExtraAllowedHostsProvider } from './lib/desktopFetch'
import {
  collectApiHostnamesFromSettings,
  extractSecretsFromSettings,
  getCachedSecrets,
  loadPersistedSecrets,
  mergeSecretRecords,
  mergeSecretsIntoSettings,
  persistSecrets,
  rememberSecrets,
  stripSecretsFromSettings,
  type AppSecrets,
} from './lib/secretStore'
import { dismissAllTooltips } from './lib/tooltipDismiss'
import { shouldFollowImageEditorRetry } from './lib/seedreamEditor'

const DEFAULT_SEEDREAM_EDITOR_DRAFT: SeedreamEditorDraft = {
  engine: 'home',
  sourceImageId: null,
  referenceImageIds: [],
  instruction: '',
  annotations: [],
  resolution: '2k',
  latestTaskId: null,
  updatedAt: Date.now(),
}
import { remapImageMentionsForOrder } from './lib/promptImageMentions'
import {
  getAllTasks,
  putTask,
  deleteTask as dbDeleteTask,
  getAllAmazonPlannerSessions,
  getImage,
  getAllImageIds,
  putImage,
  deleteImage,
  storeImage,
  refreshTaskDataEpoch,
  subscribeTaskDataReset,
} from './lib/db'
import {
  collectAgentRoundOutputImageSlots,
  getAgentCurrentReferenceId,
  getAgentGeneratedImageReferenceId,
  replaceAgentPromptImageReferencesForApi,
} from './lib/agentImageReferences'
import { validateMaskMatchesImage } from './lib/canvasImage'
import { orderInputImagesForMask } from './lib/mask'
import { normalizeParamsForSettings } from './lib/paramCompatibility'
import { getTaskHistoryCategory } from './lib/taskHistory'
import { migrateLegacyTaskStreamFields } from './lib/legacyTaskMigration'
import { shouldOpenSupportPromptForTaskCompletion } from './lib/supportPrompt'
import { isAmazonListingMainSlot } from './lib/listingPlanner'
import {
  DEFAULT_SOP_DRAFT,
  DEFAULT_VOC_DRAFT,
  normalizeSopDraft,
  normalizeVocDraft,
  persistableSopDraft,
  type SopWorkspaceDraft,
  type VocWorkspaceDraft,
} from './lib/workspaceDrafts'
import {
  cacheImage,
  ensureImageCached,
  ensureImageThumbnailCached,
  forgetCachedImage,
  getCachedImage,
  scheduleThumbnailBackfill,
  subscribeImageThumbnail,
} from './lib/imageCache'
import {
  getActiveAgentRounds,
  getAgentBranchLeafId,
  getAgentRoundPath,
  getAgentSiblingRounds,
} from './lib/agentConversationGraph'
import { isEmptyAgentConversation, normalizeAgentConversations } from './lib/agentConversationNormalize'
import { isRunningOpenAITask, markInterruptedOpenAIRunningTasks } from './lib/taskBootstrap'
import { getRecoveryTaskIds, prepareStartupTasks, pruneUnreferencedImageIds } from './lib/storeBootstrap'
import { canResumeTaskRecovery, hasActualParams } from './lib/taskRecovery'
import { createTaskRecoveryManager } from './lib/taskRecoveryManager'
import { createTaskSubmissionService, type SubmitTaskWithInputOptions } from './lib/taskSubmissionService'
import { createTaskExecutionService, getTaskApiProfile } from './lib/taskExecutionService'
import { taskExecutionQueue } from './lib/taskExecutionQueue'
import {
  collectStateImageReferences,
  deleteImageIfUnreferenced as deleteImageIfUnreferencedFromService,
  deleteUnreferencedImageCandidates,
} from './lib/imageReferenceCleanup'
import { createTaskDeletionManager } from './lib/taskDeletionManager'
import { submitGalleryTask, type PendingTaskCategory } from './lib/gallerySubmission'
import {
  submitAgentMessage as submitLegacyAgentMessage,
  regenerateAgentAssistantMessage as regenerateLegacyAgentAssistantMessage,
  stopAgentResponse as stopLegacyAgentResponse,
} from './lib/legacyAgentActions'
import {
  executeLegacyAgentRound,
  getLegacyAgentRoundController,
  type LegacyAgentExecutionDependencies,
} from './lib/legacyAgentExecution'

export { ensureImageCached, ensureImageThumbnailCached, getCachedImage, subscribeImageThumbnail }
export { getActiveAgentRounds, getAgentBranchLeafId, getAgentRoundPath, getAgentSiblingRounds }
export { getTaskApiProfile } from './lib/taskExecutionService'

function createImageReferenceState() {
  const state = useStore.getState()
  return {
    tasks: state.tasks,
    inputImages: state.inputImages,
    galleryInputDraft: state.galleryInputDraft,
    seedreamEditorDraft: state.seedreamEditorDraft,
    sopDraft: state.sopDraft,
    agentConversations: state.agentConversations,
    agentInputDrafts: Object.values(state.agentInputDrafts),
  }
}

function getTaskDeletionManager() {
  return createTaskDeletionManager({
    getState: () => {
      const state = useStore.getState()
      return {
        tasks: state.tasks,
        selectedTaskIds: state.selectedTaskIds,
        setTasks: state.setTasks,
        setSelectedTaskIds: state.setSelectedTaskIds,
        showToast: state.showToast,
      }
    },
    cancelTaskWork,
    deleteTask: dbDeleteTask,
    putTask,
    deleteUnreferencedImages: deleteUnreferencedImageIds,
    scrubDeletedTasks: scrubAgentOutputPayloadsForDeletedTasks,
  })
}

const AGENT_INPUT_DRAFT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000
const openAIWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
const AGENT_STOPPED_MESSAGE = '已停止生成。'
const AGENT_CONVERSATION_TITLE_MAX_LENGTH = 28
const ERROR_TOAST_MAX_LENGTH = 80
type ToastType = 'info' | 'success' | 'error'

// Legacy experimental Agent API. Keep it off the main bundle path until an old Agent action explicitly runs.
function loadLegacyAgentApi() {
  return import('./lib/agentApi')
}

type AgentInputDraft = {
  prompt: string
  inputImages: InputImage[]
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  updatedAt?: number
}

function isAmazonTaskWorkflow(
  workflow: NonNullable<TaskRecord['category']>['workflow'],
): workflow is 'amazon-listing' | 'amazon-aplus' {
  return workflow === 'amazon-listing' || workflow === 'amazon-aplus'
}

function isTiktokTaskWorkflow(
  workflow: NonNullable<TaskRecord['category']>['workflow'],
): workflow is 'tiktok-main' | 'tiktok-detail' {
  return workflow === 'tiktok-main' || workflow === 'tiktok-detail'
}

function createNextSubmitTaskCategory(task: TaskRecord): NonNullable<TaskRecord['category']> {
  const historyCategory = getTaskHistoryCategory(task)
  const workflow = task.category?.workflow ?? historyCategory.workflow

  const hasExplicitProductTitle = Boolean(
    task.category && Object.prototype.hasOwnProperty.call(task.category, 'productTitle'),
  )
  const productTitle = hasExplicitProductTitle
    ? (task.category?.productTitle?.trim() ?? '')
    : historyCategory.productTitle
  const styleReferenceImageId = task.category?.styleReferenceImageId?.trim()

  if (isTiktokTaskWorkflow(workflow)) {
    const category: NonNullable<TaskRecord['category']> = {
      ...(task.category?.projectId
        ? {
            projectId: task.category.projectId,
            projectSlotId: task.category.projectSlotId,
            amazonSlot: task.category.amazonSlot,
          }
        : {}),
      workflow,
      platform: 'tiktok',
      tiktokDesignType: workflow === 'tiktok-detail' ? 'detail' : 'main',
    }
    if (hasExplicitProductTitle || productTitle) category.productTitle = productTitle
    if (styleReferenceImageId) category.styleReferenceImageId = styleReferenceImageId
    return category
  }

  if (!isAmazonTaskWorkflow(workflow)) return { workflow: 'gallery' }

  const amazonSlot = task.category?.amazonSlot?.trim() || historyCategory.amazonSlot
  const aPlusType = task.category?.aPlusType ?? historyCategory.aPlusType
  const category: NonNullable<TaskRecord['category']> = { workflow }
  if (task.category?.projectId) {
    category.projectId = task.category.projectId
    category.projectSlotId = task.category.projectSlotId
  }
  if (task.category?.marketplaceId) category.marketplaceId = task.category.marketplaceId

  if (hasExplicitProductTitle || productTitle) category.productTitle = productTitle
  if (amazonSlot) category.amazonSlot = amazonSlot
  if (workflow === 'amazon-aplus' && aPlusType) category.aPlusType = aPlusType
  if (styleReferenceImageId && !(workflow === 'amazon-listing' && isAmazonListingMainSlot(amazonSlot))) {
    category.styleReferenceImageId = styleReferenceImageId
  }

  return category
}

export function getErrorToastMessage(message: string): string {
  const text = message.trim()
  if (!text) return '操作失败'

  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? ''
  const separatorIndex = firstLine.search(/[：:]/)
  if (separatorIndex > 0) {
    const title = firstLine.slice(0, separatorIndex).trim()
    if (isErrorToastTitle(title)) return title
  }

  if (firstLine.length > ERROR_TOAST_MAX_LENGTH) return '操作失败，请查看详情'
  return firstLine || '操作失败'
}

function getToastMessage(message: string, type: ToastType): string {
  return type === 'error' ? getErrorToastMessage(message) : message
}

function isErrorToastTitle(title: string): boolean {
  return /(?:失败|错误|异常|报错|无法|不能|超时|中断|断开|请先|请输入|已达上限|不存在|已丢失)$/.test(title)
}

export type SettingsTab = 'general' | 'agent' | 'api' | 'data' | 'about'

function createOpenAITimeoutError(timeoutSeconds: number) {
  return `请求超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或提高超时时间。`
}

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

function createAgentConversation(now = Date.now()): AgentConversation {
  return {
    id: genId(),
    title: '新对话',
    activeRoundId: null,
    createdAt: now,
    updatedAt: now,
    rounds: [],
    messages: [],
  }
}

function createAgentConversationTitle(prompt: string, fallbackTitle: string) {
  const title = prompt.replace(/\s+/g, ' ').trim()
  if (!title) return fallbackTitle
  const chars = Array.from(title)
  if (chars.length <= AGENT_CONVERSATION_TITLE_MAX_LENGTH) return title
  return `${chars.slice(0, AGENT_CONVERSATION_TITLE_MAX_LENGTH - 3).join('')}...`
}

function getLatestAgentConversation(conversations: AgentConversation[]) {
  return conversations.reduce<AgentConversation | null>((latest, conversation) => {
    if (!latest) return conversation
    if (conversation.updatedAt !== latest.updatedAt)
      return conversation.updatedAt > latest.updatedAt ? conversation : latest
    return conversation.createdAt > latest.createdAt ? conversation : latest
  }, null)
}

let settingsSecretsReady: Promise<void> | undefined
let settingsSecretsHydrated = false
let settingsSecretsDirty = false
let settingsSecretsWriteVersion = 0
const pendingSecretChanges: Array<(secrets: AppSecrets) => AppSecrets> = []
const secretWarningTimes = new Map<'read' | 'write', number>()

function warnSecretsFailure(operation: 'read' | 'write') {
  const now = Date.now()
  const lastWarning = secretWarningTimes.get(operation)
  if (lastWarning !== undefined && now - lastWarning < 30_000) return
  secretWarningTimes.set(operation, now)
  useStore
    .getState()
    .showToast(
      operation === 'read'
        ? '桌面凭据读取失败，原有凭据未被覆盖；修改凭据时将重试，请稍后重试或重启应用。'
        : '桌面凭据保存失败，修改暂存于当前会话；请稍后重试，重启前请确认已保存。',
      'error',
    )
}

async function saveSettingsSecrets(secrets: AppSecrets) {
  const version = ++settingsSecretsWriteVersion
  settingsSecretsDirty = true
  const saved = await persistSecrets(secrets)
  // 旧写入成功不能清除更新快照的待保存状态；失败后保留最新缓存供下次保存重试。
  if (saved && version === settingsSecretsWriteVersion) settingsSecretsDirty = false
  if (!saved) warnSecretsFailure('write')
}

function syncSettingsSecrets(previous: AppSettings, settings: AppSettings, incoming: Partial<AppSettings>) {
  const before = extractSecretsFromSettings(previous)
  const after = extractSecretsFromSettings(settings)
  // 完整设置可能仍含未读取凭据的占位值；只有定向凭据修改才能显式清空未读取的密钥。
  const explicitApiKey = incoming.apiKey !== undefined && incoming.profiles === undefined
  const resetSecrets = JSON.stringify(incoming) === JSON.stringify(DEFAULT_SETTINGS)
  const removedProfileIds = previous.profiles
    .filter((profile) => !settings.profiles.some((item) => item.id === profile.id))
    .map((profile) => profile.id)
  if (
    JSON.stringify(before) === JSON.stringify(after) &&
    !explicitApiKey &&
    !resetSecrets &&
    removedProfileIds.length === 0
  ) {
    // 同值保存也要重试未完成的读取或写入，不能要求用户再次修改密钥。
    if (!settingsSecretsHydrated) {
      if (pendingSecretChanges.length > 0) void initSettingsSecrets()
    } else if (settingsSecretsDirty) {
      void saveSettingsSecrets(getCachedSecrets())
    }
    return
  }

  const applyChange = (secrets: AppSecrets): AppSecrets => {
    if (resetSecrets) return after
    const next = { ...secrets, profiles: { ...secrets.profiles } }
    if (before.apiKey !== after.apiKey || explicitApiKey) next.apiKey = after.apiKey
    for (const id of new Set([...Object.keys(before.profiles), ...Object.keys(after.profiles)])) {
      if (before.profiles[id] === after.profiles[id]) continue
      if (after.profiles[id]) next.profiles[id] = after.profiles[id]
      else delete next.profiles[id]
    }
    if (explicitApiKey && !settingsSecretsHydrated) next.profiles[settings.activeProfileId] = after.apiKey
    for (const id of removedProfileIds) delete next.profiles[id]
    return next
  }
  if (!settingsSecretsHydrated) {
    // Preserve the edit log until the vault really loads, including explicit clears.
    pendingSecretChanges.push(applyChange)
    void initSettingsSecrets()
    return
  }
  // Apply a delta rather than dropping saved keys absent from the settings snapshot.
  void saveSettingsSecrets(applyChange(getCachedSecrets()))
}

function hydrateSettingsWithSecrets(settings: AppSettings) {
  const leftover = extractSecretsFromSettings(settings)
  const secrets = mergeSecretRecords(getCachedSecrets(), leftover)
  rememberSecrets(secrets)
  return mergeSecretsIntoSettings(stripSecretsFromSettings(settings), secrets)
}

async function hydratePersistedSecretsIntoStore() {
  const loaded = await loadPersistedSecrets()
  const current = useStore.getState().settings
  const leftover = extractSecretsFromSettings(current)
  let secrets = mergeSecretRecords(loaded, getCachedSecrets(), leftover)
  for (const applyChange of pendingSecretChanges.splice(0)) secrets = applyChange(secrets)
  rememberSecrets(secrets)
  settingsSecretsHydrated = true
  useStore.setState({ settings: mergeSecretsIntoSettings(stripSecretsFromSettings(current), secrets) })
  if (JSON.stringify(loaded) !== JSON.stringify(secrets)) await saveSettingsSecrets(secrets)
}

export function initSettingsSecrets(): Promise<void> {
  return (settingsSecretsReady ??= hydratePersistedSecretsIntoStore()
    .catch(() => warnSecretsFailure('read'))
    .finally(() => {
      if (!settingsSecretsHydrated) settingsSecretsReady = undefined
    }))
}

const CODEX_CLI_PROMPT_KEY_PREFIX = 'codex-cli-profile-v2:'

function sanitizeDismissedCodexCliPrompts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  // Legacy entries contain the literal API key. Drop them, never carry them into a
  // migration identifier or write them back to localStorage.
  return [
    ...new Set(
      value.filter(
        (key): key is string =>
          typeof key === 'string' && key.startsWith(CODEX_CLI_PROMPT_KEY_PREFIX) && !/[\r\n]/.test(key),
      ),
    ),
  ]
}

export function getPersistedState(state: AppState) {
  const settings = stripSecretsFromSettings(normalizeSettings(state.settings))
  const galleryInputDraft = getPersistableGalleryInputDraft(state)
  return {
    settings,
    params: state.params,
    ...(settings.persistInputOnRestart &&
    (state.appMode === 'gallery' || state.appMode === 'sop' || state.appMode === 'voc' || galleryInputDraft)
      ? {
          prompt: galleryInputDraft?.prompt ?? '',
          inputImages: galleryInputDraft?.inputImages.map((img) => ({ id: img.id, dataUrl: '' })) ?? [],
        }
      : {}),
    dismissedCodexCliPrompts: sanitizeDismissedCodexCliPrompts(state.dismissedCodexCliPrompts),
    appMode: state.appMode,
    galleryInputDraft:
      settings.persistInputOnRestart && galleryInputDraft
        ? {
            ...galleryInputDraft,
            inputImages: galleryInputDraft.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
          }
        : null,
    seedreamEditorDraft: state.seedreamEditorDraft,
    sopDraft: persistableSopDraft(state.sopDraft),
    vocDraft: state.vocDraft,
    agentConversations: state.agentConversations,
    activeAgentConversationId: state.activeAgentConversationId,
    agentInputDrafts: getPersistableAgentInputDrafts(state),
    agentSidebarCollapsed: state.agentSidebarCollapsed,
    agentAssetTab: state.agentAssetTab,
    agentAssetPanelCollapsed: state.agentAssetPanelCollapsed,
  }
}

function normalizePersistedParams(value: unknown): TaskParams {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PARAMS }
  const params = { ...DEFAULT_PARAMS, ...(value as Partial<TaskParams>) }
  const isLegacyPngDefault =
    params.size === 'auto' &&
    params.quality === 'medium' &&
    params.output_format === 'png' &&
    params.output_compression == null &&
    params.moderation === 'auto' &&
    params.n === 1
  return isLegacyPngDefault ? { ...DEFAULT_PARAMS } : params
}

export function mergePersistedState(persistedState: unknown, currentState: AppState): AppState {
  if (!persistedState || typeof persistedState !== 'object') return currentState

  const {
    supportPromptOpen: _legacySupportPromptOpen,
    supportPromptDismissed: _legacySupportPromptDismissed,
    ...persisted
  } = persistedState as Partial<AppState> & { supportPromptDismissed?: unknown }
  void _legacySupportPromptOpen
  void _legacySupportPromptDismissed
  const settings = hydrateSettingsWithSecrets(normalizeSettings(persisted.settings ?? currentState.settings))
  const params = normalizePersistedParams(persisted.params)
  const agentConversations = normalizeAgentConversations(persisted.agentConversations)
  const activeAgentConversationId =
    typeof persisted.activeAgentConversationId === 'string' &&
    agentConversations.some((conversation) => conversation.id === persisted.activeAgentConversationId)
      ? persisted.activeAgentConversationId
      : (agentConversations[0]?.id ?? null)
  const appMode: AppMode = 'gallery'
  const galleryInputDraft = settings.persistInputOnRestart
    ? normalizeAgentInputDraft(
        persisted.galleryInputDraft ?? {
          prompt: persisted.prompt,
          inputImages: persisted.inputImages,
          maskDraft: null,
          maskEditorImageId: null,
        },
      )
    : null
  let agentInputDrafts = cleanStaleAgentInputDrafts(
    normalizeAgentInputDrafts(persisted.agentInputDrafts, agentConversations),
    activeAgentConversationId,
  )
  return {
    ...currentState,
    ...persisted,
    dismissedCodexCliPrompts: sanitizeDismissedCodexCliPrompts(persisted.dismissedCodexCliPrompts),
    settings,
    params,
    appMode,
    galleryInputDraft: galleryInputDraft && !isEmptyAgentInputDraft(galleryInputDraft) ? galleryInputDraft : null,
    seedreamEditorDraft:
      persisted.seedreamEditorDraft && typeof persisted.seedreamEditorDraft === 'object'
        ? { ...DEFAULT_SEEDREAM_EDITOR_DRAFT, ...persisted.seedreamEditorDraft }
        : currentState.seedreamEditorDraft,
    sopDraft: normalizeSopDraft((persisted as Partial<AppState>).sopDraft ?? currentState.sopDraft),
    vocDraft: normalizeVocDraft((persisted as Partial<AppState>).vocDraft ?? currentState.vocDraft),
    agentConversations,
    activeAgentConversationId,
    agentInputDrafts,
    agentSidebarCollapsed: Boolean(persisted.agentSidebarCollapsed),
    agentAssetTab: persisted.agentAssetTab === 'references' ? 'references' : 'outputs',
    agentAssetPanelCollapsed: Boolean(persisted.agentAssetPanelCollapsed),
    supportPromptOpen: false,
    prompt: galleryInputDraft?.prompt ?? '',
    inputImages: galleryInputDraft?.inputImages ?? [],
    maskDraft: galleryInputDraft?.maskDraft ?? null,
    maskEditorImageId: galleryInputDraft?.maskEditorImageId ?? null,
  }
}

// ===== Store 类型 =====

interface AppState {
  // 模式
  appMode: AppMode
  setAppMode: (mode: AppMode) => void

  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  replaceInputImage: (idx: number, img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[], options?: { equivalentImageIds?: Record<string, string> }) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void
  galleryInputDraft: AgentInputDraft | null
  seedreamEditorDraft: SeedreamEditorDraft
  seedreamEditorDraftRevision: number
  setSeedreamEditorDraft: (patch: Partial<SeedreamEditorDraft>) => void
  resetSeedreamEditorDraft: () => void
  sopDraft: SopWorkspaceDraft
  sopDraftRevision: number
  setSopDraft: (patch: Partial<SopWorkspaceDraft>) => void
  resetSopDraft: () => void
  vocDraft: VocWorkspaceDraft
  setVocDraft: (patch: Partial<VocWorkspaceDraft>) => void
  resetVocDraft: () => void

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void
  reusedTaskApiProfileId: string | null
  reusedTaskApiProfileName: string | null
  reusedTaskApiProfileMissing: boolean
  setReusedTaskApiProfile: (profileId: string | null, missing?: boolean, profileName?: string | null) => void

  // Agent
  agentConversations: AgentConversation[]
  activeAgentConversationId: string | null
  agentInputDrafts: Record<string, AgentInputDraft>
  agentSidebarCollapsed: boolean
  agentAssetTab: 'references' | 'outputs'
  agentAssetPanelCollapsed: boolean
  agentMobileHeaderVisible: boolean
  agentEditingRoundId: string | null
  agentEditingConversationId: string | null
  agentGeneratingTitleIds: Record<string, true>
  createAgentConversation: () => string
  setActiveAgentConversationId: (id: string | null) => void
  setActiveAgentRoundId: (conversationId: string, roundId: string | null) => void
  renameAgentConversation: (id: string, title: string) => void
  deleteAgentConversation: (id: string) => void
  setAgentSidebarCollapsed: (collapsed: boolean) => void
  setAgentAssetTab: (tab: 'references' | 'outputs') => void
  setAgentAssetPanelCollapsed: (collapsed: boolean) => void
  setAgentMobileHeaderVisible: (visible: boolean) => void
  setAgentEditingRoundId: (id: string | null) => void
  setAgentEditingConversationId: (id: string | null) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void
  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void
  filterProductTitle: string
  setFilterProductTitle: (productTitle: string) => void
  filterWorkflow: HistoryWorkflowFilter
  setFilterWorkflow: (workflow: HistoryWorkflowFilter) => void
  filterAspect: HistoryAspectFilter
  setFilterAspect: (aspect: HistoryAspectFilter) => void
  pendingTaskCategory: PendingTaskCategory | null
  setPendingTaskCategory: (category: PendingTaskCategory | null) => void

  // 多选
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void

  // UI
  detailTaskId: string | null
  setDetailTaskId: (id: string | null) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  settingsTabRequest: SettingsTab | 'editor-api' | 'sop-api' | null
  setShowSettings: (v: boolean, tab?: SettingsTab | 'editor-api' | 'sop-api') => void
  supportPromptOpen: boolean
  setSupportPromptOpen: (v: boolean) => void
  dismissSupportPrompt: () => void

  // Toast
  toast: { message: string; type: ToastType } | null
  showToast: (message: string, type?: ToastType) => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    checkbox?: {
      label: string
      defaultChecked?: boolean
      disabled?: boolean
      tone?: 'primary' | 'danger'
    }
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
    buttons?: Array<{
      label: string
      tone?: 'primary' | 'secondary' | 'danger' | 'warning'
      action: (checkboxChecked?: boolean) => void
    }>
    icon?: 'info' | 'copy'
    minConfirmDelayMs?: number
    messageAlign?: 'left' | 'center'
    tone?: 'danger' | 'warning'
    action?: (checkboxChecked?: boolean) => void
    cancelAction?: (checkboxChecked?: boolean) => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void
}

export async function deleteImageIfUnreferenced(imageId: string) {
  try {
    await deleteImageIfUnreferencedFromService({
      imageId,
      state: createImageReferenceState(),
      getPlannerSessions: getAllAmazonPlannerSessions,
      getGenerationProjects: getAllGenerationProjects,
      deleteImage,
      forgetCachedImage,
    })
  } catch {
    // 清理是内存/存储优化，失败不影响替换结果。
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeInputImages(value: unknown): InputImage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((img): InputImage | null => {
      if (!isRecord(img) || typeof img.id !== 'string') return null
      return { id: img.id, dataUrl: typeof img.dataUrl === 'string' ? img.dataUrl : '' }
    })
    .filter((img): img is InputImage => img != null)
}

function normalizeMaskDraft(value: unknown): MaskDraft | null {
  if (!isRecord(value)) return null
  if (typeof value.targetImageId !== 'string' || typeof value.maskDataUrl !== 'string') return null
  return {
    targetImageId: value.targetImageId,
    maskDataUrl: value.maskDataUrl,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  }
}

function normalizeAgentInputDraft(value: unknown, fallbackUpdatedAt = Date.now()): AgentInputDraft {
  const draft = isRecord(value) ? value : {}
  const updatedAt =
    typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) ? draft.updatedAt : fallbackUpdatedAt
  return {
    prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
    inputImages: normalizeInputImages(draft.inputImages),
    maskDraft: normalizeMaskDraft(draft.maskDraft),
    maskEditorImageId: typeof draft.maskEditorImageId === 'string' ? draft.maskEditorImageId : null,
    updatedAt,
  }
}

function normalizeAgentInputDrafts(
  value: unknown,
  conversations: AgentConversation[],
): Record<string, AgentInputDraft> {
  if (!isRecord(value)) return {}
  const conversationIds = new Set(conversations.map((conversation) => conversation.id))
  const drafts: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(value)) {
    if (!conversationIds.has(conversationId)) continue
    const normalized = normalizeAgentInputDraft(draft)
    if (!isEmptyAgentInputDraft(normalized)) drafts[conversationId] = normalized
  }
  return drafts
}

export function cleanStaleAgentInputDrafts(
  drafts: Record<string, AgentInputDraft>,
  activeConversationId: string | null,
  now = Date.now(),
) {
  const cutoff = now - AGENT_INPUT_DRAFT_RETENTION_MS
  const next: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (conversationId === activeConversationId || (draft.updatedAt ?? now) >= cutoff) {
      next[conversationId] = draft
    }
  }
  return next
}

function clearInputDraftState(): Pick<AgentInputDraft, 'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'> {
  return {
    prompt: '',
    inputImages: [],
    maskDraft: null,
    maskEditorImageId: null,
  }
}

function copyAgentInputDraft(draft: AgentInputDraft): AgentInputDraft {
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
    updatedAt: draft.updatedAt ?? Date.now(),
  }
}

function getCurrentAgentInputDraft(
  state: Pick<AppState, 'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'>,
): AgentInputDraft {
  return {
    prompt: state.prompt,
    inputImages: state.inputImages,
    maskDraft: state.maskDraft,
    maskEditorImageId: state.maskEditorImageId,
    updatedAt: Date.now(),
  }
}

function isEmptyAgentInputDraft(draft: AgentInputDraft) {
  return draft.prompt.length === 0 && draft.inputImages.length === 0 && !draft.maskDraft && !draft.maskEditorImageId
}

function setAgentInputDraft(drafts: Record<string, AgentInputDraft>, conversationId: string, draft: AgentInputDraft) {
  const next = { ...drafts }
  if (isEmptyAgentInputDraft(draft)) {
    delete next[conversationId]
  } else {
    next[conversationId] = copyAgentInputDraft(draft)
  }
  return next
}

function saveActiveAgentInputDrafts(
  state: Pick<
    AppState,
    | 'appMode'
    | 'activeAgentConversationId'
    | 'agentInputDrafts'
    | 'prompt'
    | 'inputImages'
    | 'maskDraft'
    | 'maskEditorImageId'
  >,
) {
  if (state.appMode !== 'agent' || !state.activeAgentConversationId) return state.agentInputDrafts
  return setAgentInputDraft(state.agentInputDrafts, state.activeAgentConversationId, getCurrentAgentInputDraft(state))
}

function saveGalleryInputDraft(
  state: Pick<AppState, 'appMode' | 'galleryInputDraft' | 'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'>,
) {
  if (state.appMode !== 'gallery' && state.appMode !== 'sop' && state.appMode !== 'voc') return state.galleryInputDraft
  const draft = getCurrentAgentInputDraft(state)
  return isEmptyAgentInputDraft(draft) ? null : copyAgentInputDraft(draft)
}

function getPersistableGalleryInputDraft(state: AppState) {
  return saveGalleryInputDraft(state)
}

function restoreGalleryInputDraftState(
  draft: AgentInputDraft | null,
): Pick<AgentInputDraft, 'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'> {
  if (!draft) return clearInputDraftState()
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
  }
}

function restoreAgentInputDraftState(
  drafts: Record<string, AgentInputDraft>,
  conversationId: string | null,
): Pick<AgentInputDraft, 'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'> {
  const draft = conversationId ? drafts[conversationId] : null
  return restoreGalleryInputDraftState(draft ?? null)
}

function syncActiveInputDraft<T extends Partial<AgentInputDraft>>(
  state: AppState,
  patch: T,
): T & { agentInputDrafts?: Record<string, AgentInputDraft>; galleryInputDraft?: AgentInputDraft | null } {
  const draft: AgentInputDraft = {
    prompt: patch.prompt ?? state.prompt,
    inputImages: patch.inputImages ?? state.inputImages,
    maskDraft: patch.maskDraft !== undefined ? patch.maskDraft : state.maskDraft,
    maskEditorImageId: patch.maskEditorImageId !== undefined ? patch.maskEditorImageId : state.maskEditorImageId,
  }
  if (state.appMode === 'gallery' || state.appMode === 'sop' || state.appMode === 'voc') {
    return {
      ...patch,
      galleryInputDraft: isEmptyAgentInputDraft(draft) ? null : copyAgentInputDraft(draft),
    }
  }
  if (!state.activeAgentConversationId) return patch
  return {
    ...patch,
    agentInputDrafts: setAgentInputDraft(state.agentInputDrafts, state.activeAgentConversationId, draft),
  }
}

function getPersistableAgentInputDrafts(state: AppState) {
  const drafts = saveActiveAgentInputDrafts(state)
  const conversationIds = new Set(state.agentConversations.map((conversation) => conversation.id))
  const persistable: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (!conversationIds.has(conversationId) || isEmptyAgentInputDraft(draft)) continue
    persistable[conversationId] = {
      ...copyAgentInputDraft(draft),
      inputImages: draft.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
    }
  }
  return persistable
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Mode
      appMode: 'gallery',
      setAppMode: (mode) => {
        const state = get()
        const agentInputDrafts = saveActiveAgentInputDrafts(state)
        const galleryInputDraft = saveGalleryInputDraft(state)
        const nextMode: AppMode = mode === 'sop' || mode === 'voc' ? mode : 'gallery'
        set((state) => ({
          appMode: nextMode,
          agentInputDrafts,
          galleryInputDraft,
          agentMobileHeaderVisible: true,
          selectedTaskIds: [],
          agentEditingRoundId: null,
          ...(state.appMode === 'agent' ? restoreGalleryInputDraftState(galleryInputDraft) : {}),
        }))
      },

      // Settings
      settings: { ...DEFAULT_SETTINGS },
      setSettings: (s) =>
        set((st) => {
          const previous = normalizeSettings(st.settings)
          const incoming = s as Partial<AppSettings>
          const hasLegacyOverrides =
            incoming.baseUrl !== undefined ||
            incoming.apiKey !== undefined ||
            incoming.model !== undefined ||
            incoming.timeout !== undefined ||
            incoming.apiMode !== undefined ||
            incoming.codexCli !== undefined ||
            incoming.apiProxy !== undefined
          const merged = normalizeSettings({ ...previous, ...incoming })
          if (hasLegacyOverrides && incoming.profiles === undefined) {
            merged.profiles = merged.profiles.map((profile) =>
              profile.id === merged.activeProfileId
                ? {
                    ...profile,
                    baseUrl: incoming.baseUrl ?? profile.baseUrl,
                    apiKey: incoming.apiKey ?? profile.apiKey,
                    model: incoming.model ?? profile.model,
                    timeout: incoming.timeout ?? profile.timeout,
                    apiMode:
                      incoming.apiMode === 'images' || incoming.apiMode === 'responses' || incoming.apiMode === 'chat'
                        ? incoming.apiMode
                        : profile.apiMode,
                    codexCli: incoming.codexCli ?? profile.codexCli,
                    apiProxy: incoming.apiProxy ?? profile.apiProxy,
                  }
                : profile,
            )
          }
          const settings = normalizeSettings(merged)
          syncSettingsSecrets(previous, settings, incoming)
          const shouldClearReusedProfile =
            st.reusedTaskApiProfileId && settings.activeProfileId === st.reusedTaskApiProfileId
          return {
            settings,
            ...(shouldClearReusedProfile
              ? { reusedTaskApiProfileId: null, reusedTaskApiProfileName: null, reusedTaskApiProfileMissing: false }
              : {}),
          }
        }),
      dismissedCodexCliPrompts: [],
      dismissCodexCliPrompt: (key) =>
        set((st) => ({
          dismissedCodexCliPrompts: sanitizeDismissedCodexCliPrompts([...st.dismissedCodexCliPrompts, key]),
        })),

      // Input
      prompt: '',
      setPrompt: (prompt) => set((s) => syncActiveInputDraft(s, { prompt })),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          return syncActiveInputDraft(s, { inputImages: [...s.inputImages, img] })
        }),
      replaceInputImage: (idx, img) => {
        let removedImageId: string | null = null
        set((s) => {
          if (idx < 0 || idx >= s.inputImages.length) return s
          const previous = s.inputImages[idx]
          if (!previous || previous.id === img.id) return s
          if (s.inputImages.some((item, itemIdx) => itemIdx !== idx && item.id === img.id)) return s
          removedImageId = previous.id
          const inputImages = s.inputImages.map((item, itemIdx) => (itemIdx === idx ? img : item))
          const shouldClearMask = previous.id === s.maskDraft?.targetImageId
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, { [previous.id]: img.id }),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        })
        if (removedImageId) void deleteImageIfUnreferenced(removedImageId)
      },
      removeInputImage: (idx) =>
        set((s) => {
          const removed = s.inputImages[idx]
          const inputImages = s.inputImages.filter((_, i) => i !== idx)
          const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        }),
      clearInputImages: () =>
        set((s) => {
          for (const img of s.inputImages) forgetCachedImage(img.id)
          return syncActiveInputDraft(s, {
            inputImages: [],
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, []),
            maskDraft: null,
            maskEditorImageId: null,
          })
        }),
      setInputImages: (imgs, options) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(imgs, s.maskDraft?.targetImageId)
          const shouldClearMask =
            Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, options?.equivalentImageIds),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        }),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          const images = [...s.inputImages]
          if (fromIdx < 0 || fromIdx >= images.length) return s
          const maskTargetImageId = s.maskDraft?.targetImageId
          if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId) return s
          const minTargetIdx = maskTargetImageId && images.some((img) => img.id === maskTargetImageId) ? 1 : 0
          const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx))
          const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
          if (insertIdx === fromIdx) return s
          const [moved] = images.splice(fromIdx, 1)
          images.splice(insertIdx, 0, moved)
          return syncActiveInputDraft(s, {
            inputImages: images,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, images),
          })
        }),
      maskDraft: null,
      setMaskDraft: (maskDraft) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(s.inputImages, maskDraft?.targetImageId)
          return syncActiveInputDraft(s, {
            maskDraft,
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
          })
        }),
      clearMaskDraft: () => set((s) => syncActiveInputDraft(s, { maskDraft: null })),
      maskEditorImageId: null,
      setMaskEditorImageId: (maskEditorImageId) => {
        if (maskEditorImageId) dismissAllTooltips()
        set((s) => syncActiveInputDraft(s, { maskEditorImageId }))
      },
      galleryInputDraft: null,
      seedreamEditorDraft: { ...DEFAULT_SEEDREAM_EDITOR_DRAFT },
      seedreamEditorDraftRevision: 0,
      setSeedreamEditorDraft: (patch) =>
        set((state) => ({ seedreamEditorDraft: { ...state.seedreamEditorDraft, ...patch, updatedAt: Date.now() } })),
      resetSeedreamEditorDraft: () =>
        set((state) => ({
          seedreamEditorDraft: { ...DEFAULT_SEEDREAM_EDITOR_DRAFT, updatedAt: Date.now() },
          seedreamEditorDraftRevision: state.seedreamEditorDraftRevision + 1,
        })),
      sopDraft: { ...DEFAULT_SOP_DRAFT, form: { ...DEFAULT_SOP_DRAFT.form } },
      sopDraftRevision: 0,
      setSopDraft: (patch) =>
        set((state) => ({
          sopDraft: {
            ...state.sopDraft,
            ...patch,
            form: patch.form ? { ...patch.form } : state.sopDraft.form,
            referenceImages: patch.referenceImages
              ? patch.referenceImages.map((image) => ({ ...image }))
              : state.sopDraft.referenceImages,
            updatedAt: Date.now(),
          },
        })),
      resetSopDraft: () =>
        set((state) => ({
          sopDraft: { ...DEFAULT_SOP_DRAFT, form: { ...DEFAULT_SOP_DRAFT.form }, updatedAt: Date.now() },
          sopDraftRevision: state.sopDraftRevision + 1,
        })),
      vocDraft: { ...DEFAULT_VOC_DRAFT },
      setVocDraft: (patch) => set((state) => ({ vocDraft: { ...state.vocDraft, ...patch, updatedAt: Date.now() } })),
      resetVocDraft: () => set({ vocDraft: { ...DEFAULT_VOC_DRAFT, updatedAt: Date.now() } }),

      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      setReusedTaskApiProfile: (profileId, missing = false, profileName = null) =>
        set({
          reusedTaskApiProfileId: profileId,
          reusedTaskApiProfileName: profileName,
          reusedTaskApiProfileMissing: missing,
        }),

      // Agent
      agentConversations: [],
      activeAgentConversationId: null,
      agentInputDrafts: {},
      agentSidebarCollapsed: true,
      agentAssetTab: 'outputs',
      agentAssetPanelCollapsed: false,
      agentMobileHeaderVisible: false,
      agentEditingRoundId: null,
      agentEditingConversationId: null,
      agentGeneratingTitleIds: {},
      createAgentConversation: () => {
        const now = Date.now()
        const latestConversation = getLatestAgentConversation(get().agentConversations)
        if (latestConversation && isEmptyAgentConversation(latestConversation)) {
          set((state) => {
            const agentInputDrafts = saveActiveAgentInputDrafts(state)
            return {
              agentConversations: state.agentConversations.map((conversation) =>
                conversation.id === latestConversation.id
                  ? { ...conversation, createdAt: now, updatedAt: now }
                  : conversation,
              ),
              activeAgentConversationId: latestConversation.id,
              agentInputDrafts,
              agentSidebarCollapsed: true,
              agentEditingRoundId: null,
              ...restoreAgentInputDraftState(agentInputDrafts, latestConversation.id),
            }
          })
          return latestConversation.id
        }

        const conversation = createAgentConversation(now)
        set((state) => {
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          return {
            agentConversations: [...state.agentConversations, conversation],
            activeAgentConversationId: conversation.id,
            agentInputDrafts,
            agentSidebarCollapsed: true,
            agentEditingRoundId: null,
            ...restoreAgentInputDraftState(agentInputDrafts, conversation.id),
          }
        })
        return conversation.id
      },
      setActiveAgentConversationId: (id) =>
        set((state) => {
          if (state.activeAgentConversationId === id) {
            return {
              activeAgentConversationId: id,
              agentSidebarCollapsed: true,
              agentAssetPanelCollapsed: true,
              agentEditingRoundId: null,
            }
          }
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          return {
            activeAgentConversationId: id,
            agentInputDrafts,
            agentSidebarCollapsed: true,
            agentAssetPanelCollapsed: true,
            agentEditingRoundId: null,
            ...restoreAgentInputDraftState(agentInputDrafts, id),
          }
        }),
      setActiveAgentRoundId: (conversationId, roundId) =>
        set((state) => ({
          agentConversations: state.agentConversations.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, activeRoundId: roundId, updatedAt: Date.now() }
              : conversation,
          ),
        })),
      renameAgentConversation: (id, title) =>
        set((state) => ({
          agentConversations: state.agentConversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c,
          ),
        })),
      deleteAgentConversation: (id) =>
        set((state) => {
          const agentInputDrafts = { ...state.agentInputDrafts }
          delete agentInputDrafts[id]
          const activeDeleted = state.activeAgentConversationId === id
          return {
            agentConversations: state.agentConversations.filter((c) => c.id !== id),
            activeAgentConversationId: activeDeleted ? null : state.activeAgentConversationId,
            agentInputDrafts,
            ...(activeDeleted ? clearInputDraftState() : {}),
          }
        }),
      setAgentSidebarCollapsed: (agentSidebarCollapsed) => set({ agentSidebarCollapsed }),
      setAgentAssetTab: (agentAssetTab) => set({ agentAssetTab }),
      setAgentAssetPanelCollapsed: (agentAssetPanelCollapsed) => set({ agentAssetPanelCollapsed }),
      setAgentMobileHeaderVisible: (agentMobileHeaderVisible) => set({ agentMobileHeaderVisible }),
      setAgentEditingRoundId: (agentEditingRoundId) => set({ agentEditingRoundId }),
      setAgentEditingConversationId: (agentEditingConversationId) => set({ agentEditingConversationId }),

      // Tasks
      tasks: [],
      setTasks: (tasks) => set({ tasks }),
      // Search & Filter
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      filterStatus: 'all',
      setFilterStatus: (filterStatus) => set({ filterStatus }),
      filterFavorite: false,
      setFilterFavorite: (filterFavorite) => set({ filterFavorite }),
      filterProductTitle: '',
      setFilterProductTitle: (filterProductTitle) => set({ filterProductTitle }),
      filterWorkflow: 'all',
      setFilterWorkflow: (filterWorkflow) => set({ filterWorkflow }),
      filterAspect: 'all',
      setFilterAspect: (filterAspect) => set({ filterAspect }),
      pendingTaskCategory: null,
      setPendingTaskCategory: (pendingTaskCategory) => set({ pendingTaskCategory }),

      // Selection
      selectedTaskIds: [],
      setSelectedTaskIds: (updater) =>
        set((s) => ({
          selectedTaskIds: typeof updater === 'function' ? updater(s.selectedTaskIds) : updater,
        })),
      toggleTaskSelection: (id, force) =>
        set((s) => {
          const isSelected = s.selectedTaskIds.includes(id)
          const shouldSelect = force !== undefined ? force : !isSelected
          if (shouldSelect === isSelected) return s
          return {
            selectedTaskIds: shouldSelect ? [...s.selectedTaskIds, id] : s.selectedTaskIds.filter((x) => x !== id),
          }
        }),
      clearSelection: () => set({ selectedTaskIds: [] }),

      // UI
      detailTaskId: null,
      setDetailTaskId: (detailTaskId) => {
        if (detailTaskId) dismissAllTooltips()
        set({ detailTaskId })
      },
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) => {
        if (lightboxImageId) dismissAllTooltips()
        set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) })
      },
      showSettings: false,
      settingsTabRequest: null,
      setShowSettings: (showSettings, settingsTabRequest) => {
        if (showSettings) dismissAllTooltips()
        set({
          showSettings,
          ...(settingsTabRequest ? { settingsTabRequest } : {}),
          ...(!showSettings ? { settingsTabRequest: null } : {}),
        })
      },
      supportPromptOpen: false,
      setSupportPromptOpen: (supportPromptOpen) => set({ supportPromptOpen }),
      dismissSupportPrompt: () => set({ supportPromptOpen: false }),

      // Toast
      toast: null,
      showToast: (message, type = 'info') => {
        const toastMessage = getToastMessage(message, type)
        const toast = { message: toastMessage, type }
        set({ toast })
        setTimeout(() => {
          set((s) => (s.toast === toast ? { toast: null } : s))
        }, 3000)
      },

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => {
        if (confirmDialog) dismissAllTooltips()
        set({ confirmDialog })
      },
    }),
    {
      name: 'amazon-image-studio',
      partialize: getPersistedState,
      merge: mergePersistedState,
      onRehydrateStorage: () => {
        return () => {
          queueMicrotask(() => {
            void initSettingsSecrets()
          })
        }
      },
    },
  ),
)

setExtraAllowedHostsProvider(() => collectApiHostnamesFromSettings(useStore.getState().settings))

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

function getTaskSubmissionService(generation = taskWorkGeneration) {
  return createTaskSubmissionService({
    isCurrent: () => generation === taskWorkGeneration,
    getState: () => {
      const state = useStore.getState()
      return {
        settings: state.settings,
        tasks: state.tasks,
        setTasks: state.setTasks,
        setParams: state.setParams,
        setPrompt: state.setPrompt,
        clearInputImages: state.clearInputImages,
        setReusedTaskApiProfile: (profileId) => state.setReusedTaskApiProfile(profileId),
        setPendingTaskCategory: (category) => state.setPendingTaskCategory(category),
        showToast: state.showToast,
      }
    },
    createId: genId,
    ensureImageCached: async (imageId) => (await ensureImageCached(imageId)) ?? null,
    getImage,
    putImage: async (image) => putImage(image),
    storeInputImage: async (dataUrl) => storeImage(dataUrl),
    cacheImage,
    putTask,
    executeTask: (taskId) => taskExecutionQueue.enqueue(taskId, () => executeTask(taskId)),
  })
}

export function getCodexCliPromptKey(settings: AppSettings): string {
  const profile = getActiveApiProfile(settings)
  return `${CODEX_CLI_PROMPT_KEY_PREFIX}${encodeURIComponent(profile.id)}`
}

export { markInterruptedOpenAIRunningTasks } from './lib/taskBootstrap'

function clearOpenAIWatchdogTimer(taskId: string) {
  const timer = openAIWatchdogTimers.get(taskId)
  if (timer) clearTimeout(timer)
  openAIWatchdogTimers.delete(taskId)
}

function failOpenAITaskIfStillRunning(taskId: string, error: string, now = Date.now()) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return false

  updateTaskInStore(taskId, {
    status: 'error',
    error,
    falRecoverable: false,
    finishedAt: now,
    elapsed: Math.max(0, now - task.createdAt),
  })
  return true
}

function scheduleOpenAIWatchdog(taskId: string, timeoutSeconds: number) {
  clearOpenAIWatchdogTimer(taskId)
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return

  const timeoutMs = Math.max(0, timeoutSeconds * 1000)
  const timer = setTimeout(() => {
    openAIWatchdogTimers.delete(taskId)
    const failed = failOpenAITaskIfStillRunning(taskId, createOpenAITimeoutError(timeoutSeconds))
    if (failed) useStore.getState().showToast('OpenAI 任务请求超时', 'error')
  }, timeoutMs)
  openAIWatchdogTimers.set(taskId, timer)
}

export function showCodexCliPrompt(force = false, reason = '接口返回的提示词已被改写') {
  const state = useStore.getState()
  const settings = state.settings
  const promptKey = getCodexCliPromptKey(settings)
  if (!force && (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))) return

  state.setConfirmDialog({
    title: '检测到 Codex CLI API',
    message: `${reason}，当前 API 来源很可能是 Codex CLI。\n\n是否开启 Codex CLI 兼容模式？开启后会禁用在此处无效的质量参数，并在 Images API 多图生成时使用并发请求，解决该 API 数量参数无效的问题。同时，提示词文本开头会加入简短的不改写要求，避免模型重写提示词，偏离原意。`,
    confirmText: '开启',
    action: () => {
      const state = useStore.getState()
      state.dismissCodexCliPrompt(promptKey)
      state.setSettings({ codexCli: true })
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  })
}

function getFalRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile?.provider === 'fal') return taskProfile
  return null
}

function getCustomRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const provider = task.apiProvider
  if (!provider || provider === 'openai' || provider === 'fal') return null
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile?.provider === provider) return taskProfile
  return null
}

function getTaskApiProfileName(task: TaskRecord) {
  return task.apiProfileName || task.apiModel || '未知配置'
}

function isFalConnectionRecoverableError(err: unknown) {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

function isApiRequestNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const message = err.message.toLowerCase()
    return /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(message)
  }
  return false
}

function getApiModeApiName(apiMode: ApiMode) {
  if (apiMode === 'responses') return 'Responses API'
  if (apiMode === 'chat') return 'Chat Completions API'
  return 'Image API'
}

function getApiRequestNetworkErrorHint(
  err: unknown,
  createdAt: number,
  usesApiProxy: boolean,
  profile?: Pick<ApiProfile, 'provider' | 'apiMode'> | null,
): string | null {
  if (!isApiRequestNetworkError(err)) return null

  const elapsedSeconds = Math.max(0, (Date.now() - createdAt) / 1000)

  if (elapsedSeconds <= 15) {
    if (usesApiProxy) {
      return '提示：请求立即失败，请检查 API 代理服务是否正常运行。'
    }
    const unsupportedApiHint =
      profile?.provider === 'openai' ? `\n· API 不支持 ${getApiModeApiName(profile.apiMode)}` : ''
    return `提示：请求立即失败，可能原因：\n· API 服务器不可达或地址有误，请检查 API URL 是否正确、服务是否正常运行${unsupportedApiHint}\n· 接口不支持浏览器跨域请求，可使用 Docker 部署版或本地运行版并配置 API 代理解决`
  }

  if (elapsedSeconds >= 55 && elapsedSeconds <= 75) {
    return '提示：请求等待约 60 秒后被断开，这通常是 Nginx 等反向代理的默认超时，而非接口本身报错。可调大代理的超时时间（如 proxy_read_timeout），或降低图片尺寸/质量后重试。'
  }

  if (elapsedSeconds >= 110 && elapsedSeconds <= 140) {
    return '提示：请求等待约 120 秒后被断开，这通常是 Cloudflare 等 CDN/网关的超时限制，而非接口本身报错。如果使用 Cloudflare，可考虑升级套餐或使用不经过 CDN 的直连地址。'
  }

  return '提示：请求等待较长时间后被断开，通常是反向代理或网关的超时限制，而非接口本身报错。可检查代理超时设置，或降低图片尺寸/质量后重试。'
}

function getRawErrorPayload(err: unknown): Pick<Partial<TaskRecord>, 'rawImageUrls' | 'rawResponsePayload'> {
  if (!(err instanceof Error)) return {}

  const rawImageUrls = 'rawImageUrls' in err ? (err as { rawImageUrls?: unknown }).rawImageUrls : undefined
  const rawResponsePayload =
    'rawResponsePayload' in err ? (err as { rawResponsePayload?: unknown }).rawResponsePayload : undefined
  return {
    rawImageUrls:
      Array.isArray(rawImageUrls) && rawImageUrls.length
        ? rawImageUrls.filter((url): url is string => typeof url === 'string')
        : undefined,
    rawResponsePayload: typeof rawResponsePayload === 'string' ? rawResponsePayload : undefined,
  }
}

let taskRecoveryManager: ReturnType<typeof createTaskRecoveryManager> | null = null

function getTaskRecoveryManager() {
  if (taskRecoveryManager) return taskRecoveryManager
  taskRecoveryManager = createTaskRecoveryManager({
    getState: () => useStore.getState(),
    updateTask: updateTaskInStore,
    getFalProfile: getFalRecoveryProfile,
    getCustomProfile: getCustomRecoveryProfile,
    isFalConnectionRecoverableError,
    getRawErrorPayload,
    readImageSizeParamsList,
    resolveImageSizeParamsList,
    storeGeneratedImage: async (dataUrl) => storeImage(dataUrl, 'generated'),
    cacheImage,
  })
  useStore.subscribe((state, previous) => {
    if (state.settings !== previous.settings) taskRecoveryManager?.resumeBlocked()
  })
  return taskRecoveryManager
}

async function readImageSizeParam(dataUrl: string): Promise<Partial<TaskParams> | undefined> {
  if (typeof Image === 'undefined') return undefined

  return new Promise((resolve) => {
    let settled = false
    const image = new Image()
    const finish = (params: Partial<TaskParams> | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(params)
    }
    const timer = setTimeout(() => finish(undefined), 2000)
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
      } else {
        finish(undefined)
      }
    }
    image.onerror = () => finish(undefined)
    image.src = dataUrl
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
    }
  })
}

async function readImageSizeParamsList(images: string[]): Promise<Array<Partial<TaskParams> | undefined>> {
  return Promise.all(images.map((image) => readImageSizeParam(image)))
}

async function resolveImageSizeParamsList(
  images: string[],
  preferred?: Array<Partial<TaskParams> | undefined>,
): Promise<Array<Partial<TaskParams> | undefined>> {
  if (preferred?.length === images.length && preferred.every(hasActualParams)) return preferred
  const fallback = await readImageSizeParamsList(images)
  return images.map((_, index) => (hasActualParams(preferred?.[index]) ? preferred?.[index] : fallback[index]))
}

/** 初始化：从 IndexedDB 加载任务，按需恢复输入图片，并在后台清理孤立图片 */
type TaskWorkspace = 'generation' | 'editor'
let storeInitialization: Promise<void> | undefined
let startupMaintenance: Promise<void> | undefined
let startupRecovery: { generation: number; taskIds: Set<string> } | undefined
const startedRecoveryWorkspaces = new Set<TaskWorkspace>()
let taskWorkGeneration = 0
let subscribedToTaskDataReset = false

export function initStore({ deferTaskRecovery = false } = {}): Promise<void> {
  // 严格模式或重复挂载共享同一次启动，避免两轮图片清理与恢复交错。
  return (storeInitialization ??= restoreStoreAtStartup(deferTaskRecovery).catch((error) => {
    storeInitialization = undefined
    throw error
  }))
}

function belongsToTaskWorkspace(task: TaskRecord, workspace: TaskWorkspace) {
  const isEditorTask = task.category?.workflow === 'seedream-edit' || Boolean(task.imageEditContext)
  return isEditorTask === (workspace === 'editor')
}

export async function resumeWorkspaceStartupTasks(workspace: TaskWorkspace, isActive: () => boolean) {
  const recovery = startupRecovery
  await startupMaintenance
  if (
    !isActive() ||
    !recovery ||
    recovery.generation !== taskWorkGeneration ||
    startedRecoveryWorkspaces.has(workspace)
  )
    return
  startedRecoveryWorkspaces.add(workspace)
  // 只续查启动时读到的任务，不能为本次会话中新提交的任务再开一条轮询。
  scheduleTaskRecordRecovery(
    useStore
      .getState()
      .tasks.filter(
        (task) =>
          recovery.taskIds.has(task.id) &&
          belongsToTaskWorkspace(task, workspace) &&
          !taskExecutionService?.isExecuting(task.id),
      ),
  )
}

async function restoreStoreAtStartup(deferTaskRecovery: boolean) {
  if (typeof indexedDB !== 'undefined') {
    if (!subscribedToTaskDataReset) {
      subscribeTaskDataReset(async () => (await import('./lib/dataBackup')).applyExternalTaskDataReset())
      subscribedToTaskDataReset = true
    }
    await refreshTaskDataEpoch()
  }
  const workGeneration = taskWorkGeneration
  const isCurrent = () => workGeneration === taskWorkGeneration
  const storedTasks = await getAllTasks()
  if (!isCurrent()) return
  const { tasks, recoveryTaskIds } = await prepareStartupTasks({
    storedTasks,
    migrateTask: migrateLegacyTaskStreamFields,
    putTask: async (task) => {
      if (isCurrent()) await putTask(task)
    },
  })
  if (!isCurrent()) return
  useStore.getState().setTasks(tasks)

  const state = useStore.getState()
  const persistedInputImages = state.inputImages
  const galleryInputDraft = state.galleryInputDraft
  const agentInputDrafts = state.agentInputDrafts
  const restoredInputImages: InputImage[] = []
  for (const img of persistedInputImages) {
    if (img.dataUrl) {
      restoredInputImages.push(img)
      cacheImage(img.id, img.dataUrl)
      continue
    }
    const storedImage = await getImage(img.id)
    if (!isCurrent()) return
    if (storedImage?.dataUrl) {
      restoredInputImages.push({ ...img, dataUrl: storedImage.dataUrl })
      cacheImage(img.id, storedImage.dataUrl)
    }
  }
  if (
    restoredInputImages.length !== persistedInputImages.length ||
    restoredInputImages.some((img, index) => img.dataUrl !== persistedInputImages[index]?.dataUrl)
  ) {
    useStore.getState().setInputImages(restoredInputImages)
  }

  if (galleryInputDraft) {
    const restoredGalleryImages: InputImage[] = []
    for (const img of galleryInputDraft.inputImages) {
      if (img.dataUrl) {
        restoredGalleryImages.push(img)
        cacheImage(img.id, img.dataUrl)
        continue
      }
      const storedImage = await getImage(img.id)
      if (!isCurrent()) return
      if (storedImage?.dataUrl) {
        restoredGalleryImages.push({ ...img, dataUrl: storedImage.dataUrl })
        cacheImage(img.id, storedImage.dataUrl)
      }
    }
    const shouldClearMask =
      Boolean(galleryInputDraft.maskDraft) &&
      !restoredGalleryImages.some((img) => img.id === galleryInputDraft.maskDraft?.targetImageId)
    const restoredGalleryDraft: AgentInputDraft = {
      ...galleryInputDraft,
      inputImages: restoredGalleryImages,
      prompt: remapImageMentionsForOrder(
        galleryInputDraft.prompt,
        galleryInputDraft.inputImages,
        restoredGalleryImages,
      ),
      ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
    }
    const galleryDraftsChanged =
      restoredGalleryImages.length !== galleryInputDraft.inputImages.length ||
      restoredGalleryImages.some((img, index) => img.dataUrl !== galleryInputDraft.inputImages[index]?.dataUrl) ||
      shouldClearMask
    if (galleryDraftsChanged) {
      const latestState = useStore.getState()
      const nextGalleryInputDraft = isEmptyAgentInputDraft(restoredGalleryDraft) ? null : restoredGalleryDraft
      useStore.setState({
        galleryInputDraft: nextGalleryInputDraft,
        ...(latestState.appMode === 'gallery' ? restoreGalleryInputDraftState(nextGalleryInputDraft) : {}),
      })
    }
  }

  const restoredAgentInputDrafts: Record<string, AgentInputDraft> = {}
  let agentDraftsChanged = false
  for (const [conversationId, draft] of Object.entries(agentInputDrafts)) {
    const restoredDraftImages: InputImage[] = []
    for (const img of draft.inputImages) {
      if (img.dataUrl) {
        restoredDraftImages.push(img)
        cacheImage(img.id, img.dataUrl)
        continue
      }
      const storedImage = await getImage(img.id)
      if (!isCurrent()) return
      if (storedImage?.dataUrl) {
        restoredDraftImages.push({ ...img, dataUrl: storedImage.dataUrl })
        cacheImage(img.id, storedImage.dataUrl)
      }
    }

    const shouldClearMask =
      Boolean(draft.maskDraft) && !restoredDraftImages.some((img) => img.id === draft.maskDraft?.targetImageId)
    const restoredDraft: AgentInputDraft = {
      ...draft,
      inputImages: restoredDraftImages,
      prompt: remapImageMentionsForOrder(draft.prompt, draft.inputImages, restoredDraftImages),
      ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
    }
    if (!isEmptyAgentInputDraft(restoredDraft)) restoredAgentInputDrafts[conversationId] = restoredDraft
    if (
      restoredDraftImages.length !== draft.inputImages.length ||
      restoredDraftImages.some((img, index) => img.dataUrl !== draft.inputImages[index]?.dataUrl) ||
      shouldClearMask
    ) {
      agentDraftsChanged = true
    }
  }
  if (agentDraftsChanged) {
    const latestState = useStore.getState()
    useStore.setState({
      agentInputDrafts: restoredAgentInputDrafts,
      ...(latestState.appMode === 'agent'
        ? restoreAgentInputDraftState(restoredAgentInputDrafts, latestState.activeAgentConversationId)
        : {}),
    })
  }

  const restoredSopImages = new Map<string, string | undefined>()
  for (const image of useStore.getState().sopDraft.referenceImages) {
    if (image.dataUrl) continue
    const storedImage = await getImage(image.id)
    if (!isCurrent()) return
    restoredSopImages.set(image.id, storedImage?.dataUrl)
    if (storedImage?.dataUrl) cacheImage(image.id, storedImage.dataUrl)
  }
  if (restoredSopImages.size) {
    useStore.setState(({ sopDraft }) => ({
      sopDraft: {
        ...sopDraft,
        // 只补全当前仍存在的引用，不覆盖用户在读取期间进行的上传、移除或重置。
        referenceImages: sopDraft.referenceImages.flatMap((image) => {
          if (image.dataUrl || !restoredSopImages.has(image.id)) return [image]
          const dataUrl = restoredSopImages.get(image.id)
          return dataUrl ? [{ ...image, dataUrl }] : []
        }),
      },
    }))
  }

  if (deferTaskRecovery) {
    startupRecovery = {
      generation: workGeneration,
      taskIds: new Set([...recoveryTaskIds.fal, ...recoveryTaskIds.custom]),
    }
  }
  // 先确定清理候选，再读取最新引用；本次任务恢复等清理结束后启动，避免删到刚写入、尚未关联的结果。
  startupMaintenance = (async () => {
    const imageIds = await getAllImageIds()
    const [storedTasks, plannerSessions, generationProjects] = await Promise.all([
      getAllTasks(),
      getAllAmazonPlannerSessions(),
      getAllGenerationProjects(),
    ])
    if (!isCurrent()) return
    const journal = readProjectJournal()
    const referenceState = createImageReferenceState()
    const referencedIds = collectStateImageReferences(
      { ...referenceState, tasks: [...referenceState.tasks, ...storedTasks] },
      plannerSessions,
      journal ? [...generationProjects, journal] : generationProjects,
    )
    const referencedImageIds = await pruneUnreferencedImageIds({
      imageIds,
      referencedIds,
      deleteImage: async (id) => {
        if (isCurrent()) await deleteImage(id)
      },
    })
    if (isCurrent()) scheduleThumbnailBackfill(referencedImageIds)
  })()
    .catch((error) => console.warn('后台图片清理失败:', error))
    .finally(() => {
      if (deferTaskRecovery || workGeneration !== taskWorkGeneration) return
      const recoveryManager = getTaskRecoveryManager()
      for (const taskId of recoveryTaskIds.fal) recoveryManager.scheduleFal(taskId, 0)
      for (const taskId of recoveryTaskIds.custom) recoveryManager.scheduleCustom(taskId, 0)
    })
}

/** 提交新任务 */
export async function submitTask(
  options: { allowFullMask?: boolean; useCurrentApiProfileWhenReusedMissing?: boolean } = {},
): Promise<boolean> {
  const state = useStore.getState()
  const generation = taskWorkGeneration
  return submitGalleryTask(
    {
      isCurrent: () => generation === taskWorkGeneration,
      getState: () => ({
        settings: state.settings,
        prompt: state.prompt,
        inputImages: state.inputImages,
        maskDraft: state.maskDraft,
        params: state.params,
        reusedTaskApiProfileId: state.reusedTaskApiProfileId,
        reusedTaskApiProfileName: state.reusedTaskApiProfileName,
        reusedTaskApiProfileMissing: state.reusedTaskApiProfileMissing,
        pendingTaskCategory: state.pendingTaskCategory,
      }),
      setReusedTaskApiProfile: (id) => useStore.getState().setReusedTaskApiProfile(id),
      setShowSettings: (show, tab) => useStore.getState().setShowSettings(show, tab),
      setConfirmDialog: (dialog) => useStore.getState().setConfirmDialog(dialog),
      clearMaskDraft: () => useStore.getState().clearMaskDraft(),
      showToast: (message, type) => useStore.getState().showToast(message, type),
      ensureImageCached: async (id) => (await ensureImageCached(id)) ?? null,
      storeImage: async (dataUrl, source) => storeImage(dataUrl, source),
      cacheImage,
      submitPrepared: (prepared) => getTaskSubmissionService(generation).submitPrepared(prepared),
    },
    options,
  )
}
function getActiveAgentConversation(): AgentConversation {
  const state = useStore.getState()
  const existing = state.agentConversations.find((conversation) => conversation.id === state.activeAgentConversationId)
  if (existing) return existing

  const id = state.createAgentConversation()
  return useStore.getState().agentConversations.find((conversation) => conversation.id === id)!
}

function updateAgentConversation(
  conversationId: string,
  updater: (conversation: AgentConversation) => AgentConversation,
) {
  useStore.setState((state) => ({
    agentConversations: state.agentConversations.map((conversation) =>
      conversation.id === conversationId ? updater(conversation) : conversation,
    ),
  }))
}

function appendAgentStoppedMessage(content: string) {
  const trimmed = content.trimEnd()
  if (!trimmed) return AGENT_STOPPED_MESSAGE
  if (trimmed.endsWith(AGENT_STOPPED_MESSAGE)) return trimmed
  return `${trimmed}\n\n${AGENT_STOPPED_MESSAGE}`
}

function markAgentRoundTasksStopped(conversationId: string, roundId: string, now = Date.now()) {
  const runningTasks = useStore
    .getState()
    .tasks.filter(
      (task) =>
        task.status === 'running' && task.agentConversationId === conversationId && task.agentRoundId === roundId,
    )

  for (const task of runningTasks) {
    updateTaskInStore(task.id, {
      status: 'error',
      error: AGENT_STOPPED_MESSAGE,
      falRecoverable: false,
      customRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    })
  }
  return runningTasks.length > 0
}

function markAgentRoundStopped(conversationId: string, roundId: string) {
  const now = Date.now()
  const stoppedTasks = markAgentRoundTasksStopped(conversationId, roundId, now)
  let stoppedRound = false
  updateAgentConversation(conversationId, (current) => {
    const round = current.rounds.find((item) => item.id === roundId)
    if (!round || round.status !== 'running') return current

    stoppedRound = true
    const existingAssistantMessage = current.messages.find(
      (message) => message.roundId === roundId && message.role === 'assistant',
    )
    const assistantMessageId = existingAssistantMessage?.id ?? genId()
    return {
      ...current,
      updatedAt: now,
      rounds: current.rounds.map((item) =>
        item.id === roundId
          ? {
              ...item,
              ...(assistantMessageId ? { assistantMessageId } : {}),
              status: 'error',
              error: AGENT_STOPPED_MESSAGE,
              finishedAt: now,
            }
          : item,
      ),
      messages: existingAssistantMessage
        ? current.messages.map((message) =>
            message.id === existingAssistantMessage.id
              ? { ...message, content: appendAgentStoppedMessage(message.content) }
              : message,
          )
        : [
            ...current.messages,
            {
              id: assistantMessageId,
              role: 'assistant',
              content: AGENT_STOPPED_MESSAGE,
              roundId,
              createdAt: now,
            },
          ],
    }
  })
  return stoppedRound || stoppedTasks
}

function appendAgentAssistantMessageContent(conversationId: string, messageId: string, delta: string) {
  if (!delta) return
  updateAgentConversation(conversationId, (current) => ({
    ...current,
    updatedAt: Date.now(),
    messages: current.messages.map((message) =>
      message.id === messageId ? { ...message, content: `${message.content}${delta}` } : message,
    ),
  }))
}

async function generateAgentConversationTitle(
  conversationId: string,
  prompt: string,
  inputImageIds: string[],
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
  fallbackTitle: string,
) {
  useStore.setState((state) => {
    const next = { ...state.agentGeneratingTitleIds, [conversationId]: true as const }
    return { agentGeneratingTitleIds: next }
  })
  try {
    const imageDataUrls = await readAgentImageDataUrls(inputImageIds)
    const { callAgentConversationTitleApi } = await loadLegacyAgentApi()
    const title = await callAgentConversationTitleApi({
      settings: requestSettings,
      profile: activeProfile,
      prompt,
      imageDataUrls,
    })
    if (!title || title === fallbackTitle) return

    updateAgentConversation(conversationId, (current) => {
      const firstRound = current.rounds[0]
      if (!firstRound || firstRound.prompt !== prompt || current.title !== fallbackTitle) return current
      return { ...current, title, updatedAt: Date.now() }
    })
  } catch {
    // Title generation is best-effort; keep the local fallback title on failure.
  } finally {
    useStore.setState((state) => {
      const next = { ...state.agentGeneratingTitleIds }
      delete next[conversationId]
      return { agentGeneratingTitleIds: next }
    })
  }
}

export function stopAgentResponse(conversationId = useStore.getState().activeAgentConversationId) {
  stopLegacyAgentResponse(
    {
      getConversation: (id) => useStore.getState().agentConversations.find((item) => item.id === id),
      getActiveRounds: (conversation) => getActiveAgentRounds(conversation),
      getController: (conversationId, roundId) => getLegacyAgentRoundController(conversationId, roundId),
      markRoundStopped: markAgentRoundStopped,
      showToast: useStore.getState().showToast,
    },
    conversationId,
  )
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)))
}

export async function deleteUnreferencedImageIds(imageIds: Iterable<string>) {
  await deleteUnreferencedImageCandidates({
    candidates: imageIds,
    state: createImageReferenceState(),
    getPlannerSessions: getAllAmazonPlannerSessions,
    getGenerationProjects: getAllGenerationProjects,
    deleteImage,
    forgetCachedImage,
  })
}

async function readAgentImageDataUrls(ids: string[]) {
  const dataUrls: string[] = []
  for (const id of ids) {
    const dataUrl = await ensureImageCached(id)
    if (dataUrl) dataUrls.push(dataUrl)
  }
  return dataUrls
}

async function createAgentUserInputItem(
  conversation: AgentConversation,
  round: AgentRound,
  message: AgentMessage,
  tasks: TaskRecord[],
) {
  const imageDataUrls = await readAgentImageDataUrls(round.inputImageIds)
  const rounds = getAgentRoundPath(conversation, round.id)
  const text = replaceAgentPromptImageReferencesForApi(message.content, round, rounds, tasks)
  const referenceText =
    round.inputImageIds.length > 0
      ? `\n\n<available_refs>${round.inputImageIds.map((_, index) => `\n  <ref id="${getAgentCurrentReferenceId(round, index)}" />`).join('')}\n</available_refs>`
      : ''
  return {
    role: 'user',
    content: [
      { type: 'input_text', text: `${text}${referenceText}` },
      ...imageDataUrls.map((dataUrl) => ({ type: 'input_image', image_url: dataUrl })),
    ],
  }
}

function createAgentGeneratedReferenceLabelsItem(round: AgentRound, tasks: TaskRecord[]) {
  const refs = createAgentGeneratedReferenceEntries(round, tasks)
  if (refs.length <= 0) return null
  return createAgentAssistantFallbackItem(`<available_refs>${refs.join('')}\n</available_refs>`)
}

function escapeXmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncateAgentReferencePrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized
}

function createAgentGeneratedReferenceEntries(round: AgentRound, tasks: TaskRecord[]) {
  const entries: string[] = []
  let imageIndex = 0
  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    if (!task) {
      entries.push(`\n  <removed_ref id="${getAgentGeneratedImageReferenceId(round, imageIndex)}" />`)
      imageIndex += 1
      continue
    }
    const prompt = truncateAgentReferencePrompt(task.prompt || '')
    const promptAttribute = prompt ? ` prompt="${escapeXmlAttribute(prompt)}"` : ''
    for (let imageIndexInTask = 0; imageIndexInTask < task.outputImages.length; imageIndexInTask += 1) {
      entries.push(`\n  <ref id="${getAgentGeneratedImageReferenceId(round, imageIndex)}"${promptAttribute} />`)
      imageIndex += 1
    }
  }
  return entries
}

function createAgentAssistantFallbackItem(text: string) {
  return {
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  }
}

function parseResponseOutputFromPayload(rawResponsePayload?: string): ResponsesOutputItem[] | null {
  if (!rawResponsePayload) return null
  try {
    const payload = JSON.parse(rawResponsePayload) as { output?: unknown }
    return Array.isArray(payload.output) ? (payload.output as ResponsesOutputItem[]) : null
  } catch {
    return null
  }
}

function sanitizeResponseOutputItemForInput(item: ResponsesOutputItem): unknown | null {
  if (item.type === 'web_search_call') return null

  if (item.type === 'image_generation_call') {
    if (typeof item.result !== 'string' || !item.result.trim()) return null
    return {
      ...(typeof item.id === 'string' && item.id ? { id: item.id } : {}),
      type: 'image_generation_call',
      result: item.result,
    }
  }

  if (item.type === 'message') {
    const content = (item.content ?? [])
      .map((part) => {
        if (typeof part.text !== 'string') return null
        if (part.type === 'output_text' || part.type === 'text') {
          return { type: 'output_text', text: part.text }
        }
        return null
      })
      .filter((part): part is { type: 'output_text'; text: string } => Boolean(part))

    return content.length > 0 ? { role: 'assistant', content } : null
  }

  return item
}

function filterAgentRoundResponseOutputForInput(round: AgentRound, tasks: TaskRecord[], output: ResponsesOutputItem[]) {
  const roundTaskIds = new Set(round.outputTaskIds)
  const roundTaskSlots = round.outputTaskIds.map((taskId) => tasks.find((task) => task.id === taskId) ?? null)
  let anonymousImageIndex = 0

  return output.filter((item) => {
    if (item.type !== 'image_generation_call') return true

    if (typeof item.id === 'string' && item.id) {
      return tasks.some(
        (task) => roundTaskIds.has(task.id) && task.agentRoundId === round.id && task.agentToolCallId === item.id,
      )
    }

    const task = roundTaskSlots[anonymousImageIndex]
    anonymousImageIndex += 1
    return Boolean(task)
  })
}

function scrubResponseOutputForDeletedAgentTasks(
  round: AgentRound,
  output: ResponsesOutputItem[],
  deletedTasks: TaskRecord[],
) {
  const deletedTaskIds = new Set(deletedTasks.map((task) => task.id))
  const deletedToolCallIds = new Set(
    deletedTasks
      .filter((task) => task.agentRoundId === round.id && task.agentToolCallId)
      .map((task) => task.agentToolCallId!),
  )
  if (deletedTaskIds.size === 0) return output

  let anonymousImageIndex = 0
  return output.filter((item) => {
    if (item.type !== 'image_generation_call') return true

    if (typeof item.id === 'string' && item.id) {
      return !deletedToolCallIds.has(item.id)
    }

    const taskId = round.outputTaskIds[anonymousImageIndex]
    anonymousImageIndex += 1
    return !deletedTaskIds.has(taskId)
  })
}

function scrubAgentConversationsForDeletedTasks(conversations: AgentConversation[], deletedTasks: TaskRecord[]) {
  if (deletedTasks.length === 0) return conversations

  return conversations.map((conversation) => ({
    ...conversation,
    rounds: conversation.rounds.map((round) => {
      const roundDeletedTasks = deletedTasks.filter((task) => round.outputTaskIds.includes(task.id))
      if (roundDeletedTasks.length === 0 || !round.responseOutput?.length) return round
      return {
        ...round,
        responseOutput: scrubResponseOutputForDeletedAgentTasks(round, round.responseOutput, roundDeletedTasks),
      }
    }),
  }))
}

function scrubTaskRawResponsePayloadForDeletedTasks(
  task: TaskRecord,
  conversations: AgentConversation[],
  deletedTasks: TaskRecord[],
) {
  if (!task.rawResponsePayload || !task.agentRoundId) return task

  const round = conversations
    .flatMap((conversation) => conversation.rounds)
    .find((item) => item.id === task.agentRoundId)
  if (!round) return task

  const roundDeletedTasks = deletedTasks.filter((item) => round.outputTaskIds.includes(item.id))
  if (roundDeletedTasks.length === 0) return task

  try {
    const payload = JSON.parse(task.rawResponsePayload) as ResponsesApiResponse
    if (!Array.isArray(payload.output)) return task
    const output = scrubResponseOutputForDeletedAgentTasks(round, payload.output, roundDeletedTasks)
    if (output.length === payload.output.length) return task
    return { ...task, rawResponsePayload: JSON.stringify({ ...payload, output }, null, 2) }
  } catch {
    return task
  }
}

function scrubAgentOutputPayloadsForDeletedTasks(deletedTasks: TaskRecord[], remainingTasks: TaskRecord[]) {
  if (deletedTasks.length === 0) return remainingTasks

  const conversations = scrubAgentConversationsForDeletedTasks(useStore.getState().agentConversations, deletedTasks)
  const scrubbedTasks = remainingTasks.map((task) =>
    scrubTaskRawResponsePayloadForDeletedTasks(task, conversations, deletedTasks),
  )
  useStore.setState({ agentConversations: conversations })
  return scrubbedTasks
}

function sanitizeResponseOutputForInput(
  output: ResponsesOutputItem[],
  options: { allowPendingFunctionCalls?: boolean } = {},
) {
  const items = output.map(sanitizeResponseOutputItemForInput).filter((item): item is unknown => item != null)
  if (options.allowPendingFunctionCalls) return items

  const functionCallIds = new Set<string>()
  const functionOutputCallIds = new Set<string>()
  for (const item of items) {
    if (!isRecord(item)) continue
    const callId = typeof item.call_id === 'string' ? item.call_id : ''
    if (!callId) continue
    if (item.type === 'function_call') functionCallIds.add(callId)
    if (item.type === 'function_call_output') functionOutputCallIds.add(callId)
  }

  return items.filter((item) => {
    if (!isRecord(item)) return true
    const callId = typeof item.call_id === 'string' ? item.call_id : ''
    if (item.type === 'function_call') return callId && functionOutputCallIds.has(callId)
    if (item.type === 'function_call_output') return callId && functionCallIds.has(callId)
    return true
  })
}

function mergeResponseOutputItems(previous: ResponsesOutputItem[], next: ResponsesOutputItem[]) {
  const merged = [...previous]
  for (const item of next) {
    const index = item.id ? merged.findIndex((existing) => existing.id === item.id) : -1
    if (index >= 0) merged[index] = item
    else merged.push(item)
  }
  return merged
}

function countResponseToolCalls(output: ResponsesOutputItem[]) {
  return output.filter((item) => item.type === 'image_generation_call').length
}

function createAgentContinuationInputItem(newImageRefs: string[], toolCallsUsed: number, maxToolCalls: number) {
  const lines = ['[System] The app has saved your generated outputs and is continuing the same Agent turn.']
  if (newImageRefs.length > 0) {
    lines.push(
      `The following image ref ids are now available for you to reference in subsequent image_generation prompts: ${newImageRefs.join(', ')}`,
    )
  }
  lines.push(
    'Continue generating. Do NOT repeat what you already said in earlier responses.',
    'If you still need another round after this (e.g. more dependent images), call continue_generation.',
    `Tool-call budget: ${toolCallsUsed}/${maxToolCalls} used.`,
  )
  return {
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: lines.join('\n'),
      },
    ],
  }
}

function buildAgentContinuationInput(
  baseInput: unknown[],
  round: AgentRound,
  tasks: TaskRecord[],
  currentRoundOutput: ResponsesOutputItem[],
  toolCallsUsed: number,
  maxToolCalls: number,
) {
  const input = [
    ...baseInput,
    ...sanitizeResponseOutputForInput(currentRoundOutput, { allowPendingFunctionCalls: true }),
  ]
  const labelsItem = createAgentGeneratedReferenceLabelsItem(round, tasks)
  if (labelsItem) input.push(labelsItem)
  const newImageRefs = collectAgentRoundOutputImageSlots(round, tasks)
    .map((imageId, index) => (imageId ? `<ref id="${getAgentGeneratedImageReferenceId(round, index)}" />` : null))
    .filter((ref): ref is string => Boolean(ref))
  input.push(createAgentContinuationInputItem(newImageRefs, toolCallsUsed, maxToolCalls))
  return input
}

function getAgentRoundResponseOutput(round: AgentRound, tasks: TaskRecord[]): ResponsesOutputItem[] | null {
  if (round.responseOutput?.length) return round.responseOutput

  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    const output = parseResponseOutputFromPayload(task?.rawResponsePayload)
    if (output?.length) return output
  }

  return null
}

async function buildAgentApiInput(
  conversation: AgentConversation,
  currentRound: AgentRound,
  tasks: TaskRecord[],
): Promise<unknown[]> {
  const input: unknown[] = []
  const rounds = getAgentRoundPath(conversation, currentRound.id)

  for (const round of rounds) {
    const userMessage = conversation.messages.find((message) => message.id === round.userMessageId)
    if (!userMessage) continue

    input.push(await createAgentUserInputItem(conversation, round, userMessage, tasks))
    if (round.id === currentRound.id) continue

    const output = getAgentRoundResponseOutput(round, tasks)
    if (output?.length) {
      const sanitizedOutput = sanitizeResponseOutputForInput(
        filterAgentRoundResponseOutputForInput(round, tasks, output),
      )
      if (sanitizedOutput.length > 0) input.push(...sanitizedOutput)
      const labelsItem = createAgentGeneratedReferenceLabelsItem(round, tasks)
      if (labelsItem) input.push(labelsItem)
      continue
    }

    const assistantMessage = round.assistantMessageId
      ? conversation.messages.find((message) => message.id === round.assistantMessageId)
      : null
    input.push(createAgentAssistantFallbackItem(assistantMessage?.content || '[No text response]'))
    const labelsItem = createAgentGeneratedReferenceLabelsItem(round, tasks)
    if (labelsItem) input.push(labelsItem)
  }

  return input
}

export async function submitAgentMessage() {
  const state = useStore.getState()
  await submitLegacyAgentMessage({
    getState: () => ({
      settings: state.settings,
      prompt: state.prompt,
      inputImages: state.inputImages,
      maskDraft: state.maskDraft,
      params: state.params,
      agentEditingRoundId: state.agentEditingRoundId,
      showToast: state.showToast,
      setAppMode: state.setAppMode,
      setShowSettings: state.setShowSettings,
      setPrompt: state.setPrompt,
      clearInputImages: state.clearInputImages,
      clearMaskDraft: state.clearMaskDraft,
      setAgentEditingRoundId: state.setAgentEditingRoundId,
    }),
    getActiveConversation: getActiveAgentConversation,
    getActiveRounds: getActiveAgentRounds,
    getRoundPath: getAgentRoundPath,
    updateConversation: updateAgentConversation,
    orderInputImagesForMask,
    validateMaskMatchesImage,
    storeImage: (dataUrl, kind) => storeImage(dataUrl, kind === 'input' ? 'upload' : kind),
    cacheImage,
    createId: genId,
    uniqueIds,
    createConversationTitle: createAgentConversationTitle,
    generateConversationTitle: (
      conversationId,
      prompt,
      inputImageIds,
      requestSettings,
      activeProfile,
      fallbackTitle,
    ) => {
      void generateAgentConversationTitle(
        conversationId,
        prompt,
        inputImageIds,
        requestSettings,
        activeProfile,
        fallbackTitle,
      )
    },
    executeAgentRound: (conversationId, roundId, params, requestSettings, activeProfile) => {
      void executeAgentRound(conversationId, roundId, params, requestSettings, activeProfile)
    },
  })
}

export async function regenerateAgentAssistantMessage(conversationId: string, roundId: string) {
  await regenerateLegacyAgentAssistantMessage(
    {
      getState: () => {
        const state = useStore.getState()
        return {
          settings: state.settings,
          params: state.params,
          agentConversations: state.agentConversations,
          showToast: state.showToast,
          setAppMode: state.setAppMode,
          setShowSettings: state.setShowSettings,
          setAgentEditingRoundId: state.setAgentEditingRoundId,
        }
      },
      updateConversation: updateAgentConversation,
      createId: genId,
      executeAgentRound: (id, round, params, settings, profile) => {
        void executeAgentRound(id, round, params, settings, profile)
      },
    },
    conversationId,
    roundId,
  )
}
function executeAgentRound(
  conversationId: string,
  roundId: string,
  params: TaskParams,
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
): void {
  const dependencies: LegacyAgentExecutionDependencies = {
    getState: () => {
      const state = useStore.getState()
      return {
        tasks: state.tasks,
        agentConversations: state.agentConversations,
        setTasks: state.setTasks,
        showToast: state.showToast,
      }
    },
    loadAgentApi: loadLegacyAgentApi,
    ensureImageCached: async (imageId) => ensureImageCached(imageId),
    buildApiInput: buildAgentApiInput,
    updateConversation: updateAgentConversation,
    createId: genId,
    putTask,
    storeImage: (dataUrl, source) => storeImage(dataUrl, source),
    cacheImage,
    updateTask: updateTaskInStore,
    appendAssistantMessageContent: appendAgentAssistantMessageContent,
    mergeResponseOutputItems,
    countResponseToolCalls,
    buildContinuationInput: buildAgentContinuationInput,
    markRoundStopped: markAgentRoundStopped,
    getNetworkErrorHint: getApiRequestNetworkErrorHint,
  }
  void executeLegacyAgentRound(dependencies, conversationId, roundId, params, requestSettings, activeProfile)
}

let taskExecutionService: ReturnType<typeof createTaskExecutionService> | null = null

function getTaskExecutionService() {
  if (taskExecutionService) return taskExecutionService
  taskExecutionService = createTaskExecutionService({
    getState: () => useStore.getState(),
    updateTask: updateTaskInStore,
    ensureImageCached,
    storeGeneratedImage: async (dataUrl) => storeImage(dataUrl, 'generated'),
    cacheImage,
    forgetCachedImage,
    scheduleWatchdog: scheduleOpenAIWatchdog,
    clearWatchdog: clearOpenAIWatchdogTimer,
    releaseSubmissionSlot: (taskId) => taskExecutionQueue.release(taskId),
    scheduleFalRecovery: (taskId) => getTaskRecoveryManager().scheduleFal(taskId),
    scheduleCustomRecovery: (taskId) => getTaskRecoveryManager().scheduleCustom(taskId),
    resolveImageSizeParamsList,
    readImageSizeParamsList,
    isRecoverableConnectionError: isFalConnectionRecoverableError,
    getNetworkErrorHint: getApiRequestNetworkErrorHint,
    getRawErrorPayload,
    showCodexCliPrompt,
  })
  return taskExecutionService
}

function cancelTaskWork(taskId: string) {
  taskExecutionService?.cancel(taskId)
  taskRecoveryManager?.cancel(taskId)
  clearOpenAIWatchdogTimer(taskId)
  taskExecutionQueue.cancel(taskId)
}

/** Synchronously retires all local work; remote IDs remain available for later recovery. */
export function cancelAllTaskWork() {
  taskWorkGeneration++
  taskExecutionQueue.cancelAll()
  taskExecutionService?.cancelAll()
  taskRecoveryManager?.cancelAll()
  for (const taskId of openAIWatchdogTimers.keys()) clearOpenAIWatchdogTimer(taskId)
  return taskWorkGeneration
}

/** 仅查询已有远端 ID，不重新提交生图。 */
export function scheduleTaskRecordRecovery(tasks: TaskRecord[]) {
  const { fal, custom } = getRecoveryTaskIds(tasks)
  if (!fal.length && !custom.length) return
  const recovery = getTaskRecoveryManager()
  for (const id of fal) recovery.scheduleFal(id, 0)
  for (const id of custom) recovery.scheduleCustom(id, 0)
}

/** 清空已回滚，但先前取消的本地工作不会随事务恢复。 */
export async function restoreInterruptedTaskWork(previousTasks: TaskRecord[], generation: number) {
  const isCurrent = () => generation === taskWorkGeneration
  // 如果其他标签已成功清空，fence 会先清理旧视图并使此代次失效。
  if (typeof indexedDB !== 'undefined') await refreshTaskDataEpoch()
  if (!isCurrent()) return
  const previousIds = new Set(previousTasks.map(({ id }) => id))
  let storedTasks: TaskRecord[]
  try {
    storedTasks = await getAllTasks()
  } catch (error) {
    if (isCurrent() && !(error instanceof Error && error.name === 'AbortError')) {
      useStore.getState().setTasks(markInterruptedOpenAIRunningTasks(previousTasks).tasks)
    }
    throw error
  }
  if (!isCurrent()) return
  const { tasks, interruptedTasks } = markInterruptedOpenAIRunningTasks(
    storedTasks.filter(({ id }) => previousIds.has(id)),
  )
  useStore.getState().setTasks(tasks)
  const writes = await Promise.allSettled(interruptedTasks.map(putTask))
  if (!isCurrent()) return
  scheduleTaskRecordRecovery(tasks)
  const failure = writes.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
}

/** Query the original remote task again; unlike retryTask, this never submits a new generation. */
export function resumeTaskRecovery(taskId: string) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !canResumeTaskRecovery(task)) return
  cancelTaskWork(taskId)
  updateTaskInStore(taskId, { recoveryPausedReason: undefined, error: null })
  const recovery = getTaskRecoveryManager()
  if (task.apiProvider === 'fal') recovery.scheduleFal(taskId, 0)
  else recovery.scheduleCustom(taskId, 0)
}

function executeTask(taskId: string) {
  return getTaskExecutionService().execute(taskId)
}

export function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>) {
  const { tasks, setTasks } = useStore.getState()
  if (!tasks.some((task) => task.id === taskId)) return
  const updated = tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
  const shouldOpenSupportPrompt = shouldOpenSupportPromptForTaskCompletion(tasks, updated, taskId)
  setTasks(updated)
  if (shouldOpenSupportPrompt) {
    const state = useStore.getState()
    if (!state.supportPromptOpen) {
      useStore.setState({ supportPromptOpen: true })
    }
  }
  const task = updated.find((t) => t.id === taskId)
  if (task) {
    void putTask(task).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') return
      console.error('保存任务失败:', error)
      useStore.getState().showToast('任务更新未能保存到本地，请检查存储空间或稍后重试', 'error')
    })
  }
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord) {
  const draft = useStore.getState().seedreamEditorDraft
  const result = await getTaskSubmissionService().retry(task)
  if (result.status === 'submitted') {
    const state = useStore.getState()
    if (state.seedreamEditorDraft === draft && shouldFollowImageEditorRetry(task, draft)) {
      state.setSeedreamEditorDraft({ latestTaskId: result.taskId })
    }
  } else if (result.status === 'original-profile-error') {
    useStore.getState().showToast(result.message, 'error')
  } else if (result.status === 'unsupported-profile') {
    const { setConfirmDialog } = useStore.getState()
    const { profile } = result
    setConfirmDialog({
      title: '当前配置不能生图',
      message: `当前配置「${profile.name}」使用 ${getApiModeApiName(profile.apiMode)}，普通生图只支持 Images API，OpenRouter 图片模型可使用 Chat Completions。重试图片前，请切换到生图配置。`,
      confirmText: '去切换配置',
      cancelText: '取消',
      action: () => {
        useStore.getState().setShowSettings(true, 'api')
      },
    })
  }
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  const {
    settings,
    setPrompt,
    setParams,
    setInputImages,
    setMaskDraft,
    clearMaskDraft,
    showToast,
    setConfirmDialog,
    setReusedTaskApiProfile,
    setPendingTaskCategory,
  } = useStore.getState()
  const normalizedSettings = normalizeSettings(settings)
  const currentProfile = getActiveApiProfile(settings)
  const matchedProfile = normalizedSettings.reuseTaskApiProfileTemporarily
    ? getTaskApiProfile(normalizedSettings, task)
    : null
  const shouldTemporarilyReuseProfile = Boolean(matchedProfile && matchedProfile.id !== currentProfile.id)
  const missingReusedProfile = normalizedSettings.reuseTaskApiProfileTemporarily && !matchedProfile
  const taskProfileName = matchedProfile?.name ?? getTaskApiProfileName(task)
  const paramsSettings =
    shouldTemporarilyReuseProfile && matchedProfile
      ? createSettingsForApiProfile(normalizedSettings, matchedProfile)
      : normalizedSettings

  // Resolve all inputs before replacing the current draft. Partial restoration would
  // silently change ordinal image references in the original prompt.
  const imgs: InputImage[] = []
  const styleImageId = task.category?.styleReferenceImageId?.trim()
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (!dataUrl) {
      showToast('原任务有参考图缺失，无法按原顺序复用；请先恢复缺失图片。', 'error')
      return
    }
    // Keep an existing non-final style image in place so its prompt index remains valid.
    if (imgId !== styleImageId || task.inputImageIds.at(-1) !== styleImageId) imgs.push({ id: imgId, dataUrl })
  }
  const maskTargetImageId = task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null)
  const maskDataUrl = task.maskImageId ? await ensureImageCached(task.maskImageId) : null
  if (task.maskImageId && (!maskDataUrl || !imgs.some(({ id }) => id === maskTargetImageId))) {
    showToast('原任务的遮罩或目标图片缺失，无法复用编辑配置。', 'error')
    return
  }

  setParams(normalizeParamsForSettings(task.params, paramsSettings, { hasInputImages: task.inputImageIds.length > 0 }))
  setReusedTaskApiProfile(
    shouldTemporarilyReuseProfile && matchedProfile ? matchedProfile.id : null,
    missingReusedProfile,
    taskProfileName,
  )
  clearMaskDraft()
  setInputImages(imgs)
  setPrompt(task.prompt)
  setPendingTaskCategory({
    mode: 'next-submit',
    category: createNextSubmitTaskCategory(task),
  })
  if (maskDataUrl && maskTargetImageId) {
    setMaskDraft({ targetImageId: maskTargetImageId, maskDataUrl, updatedAt: Date.now() })
  }
  if (missingReusedProfile) {
    setConfirmDialog({
      title: '找不到 API 配置',
      message: `找不到复用任务所使用的 API 配置「${taskProfileName}」，要使用当前的 API 配置「${currentProfile.name}」提交任务吗？`,
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
      action: () => {
        void submitTask({ useCurrentApiProfileWhenReusedMissing: true })
      },
    })
    return
  }

  showToast(
    shouldTemporarilyReuseProfile && matchedProfile
      ? `已临时复用该任务的 API 配置「${matchedProfile.name}」`
      : '已复用配置到输入框',
    'success',
  )
}

/** 编辑输出：清空当前输入，只保留待编辑的输出图 */
export async function editOutputs(task: TaskRecord, selectedOutputImageId?: string) {
  const { showToast, setPendingTaskCategory, setConfirmDialog } = useStore.getState()
  const outputImageId =
    selectedOutputImageId && task.outputImages?.includes(selectedOutputImageId)
      ? selectedOutputImageId
      : task.outputImages?.[0]
  if (!outputImageId) return

  const dataUrl = await ensureImageCached(outputImageId)
  if (dataUrl) {
    const prepareOutput = (mode: 'whole' | 'mask') => {
      useStore.setState((state) =>
        syncActiveInputDraft(state, {
          prompt: '',
          inputImages: [{ id: outputImageId, dataUrl }],
          maskDraft: null,
          maskEditorImageId: mode === 'mask' ? outputImageId : null,
        }),
      )
      setPendingTaskCategory({
        mode: 'next-submit',
        category: createNextSubmitTaskCategory(task),
      })
      showToast(mode === 'mask' ? '已打开输出图遮罩编辑' : '已准备编辑输出图', 'success')
    }

    setConfirmDialog({
      title: '编辑输出图',
      message:
        '请选择这次要执行的操作。整图编辑会把这张图放回输入栏继续生成；添加遮罩会先打开遮罩编辑器，用于局部修改。',
      buttons: [
        {
          label: '整图编辑',
          tone: 'secondary',
          action: () => prepareOutput('whole'),
        },
        {
          label: '添加遮罩',
          tone: 'primary',
          action: () => prepareOutput('mask'),
        },
      ],
    })
    return
  }
  if (!dataUrl) {
    showToast('无法读取输出图，请稍后重试', 'error')
    return
  }
}

/** 删除多条任务 */
export async function removeMultipleTasks(taskIds: string[]) {
  await getTaskDeletionManager().removeMany(taskIds)
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  await getTaskDeletionManager().removeOne(task)
}

export type { ClearOptions, ExportOptions, ImportOptions } from './lib/dataBackup'

export async function clearData(options?: import('./lib/dataBackup').ClearOptions) {
  // A reset must operate on hydrated credentials, not placeholder empty keys.
  // Otherwise the pending vault read could restore secrets after the clear.
  if (options?.clearConfig ?? true) await initSettingsSecrets()
  return (await import('./lib/dataBackup')).clearData(options)
}

export async function exportData(options?: import('./lib/dataBackup').ExportOptions) {
  return (await import('./lib/dataBackup')).exportData(options)
}

export async function importData(file: File, options?: import('./lib/dataBackup').ImportOptions) {
  return (await import('./lib/dataBackup')).importData(file, options)
}

/** 添加图片到输入（文件上传） */
export async function addImageFromFile(file: File): Promise<void> {
  const image = await createInputImageFromFile(file)
  if (!image) return
  useStore.getState().addInputImage(image)
}

export async function createInputImageFromFile(file: File, isCurrent = () => true): Promise<InputImage | null> {
  if (!file.type.startsWith('image/')) return null
  const dataUrl = await fileToDataUrl(file)
  if (!isCurrent()) return null
  const id = await storeImage(dataUrl, 'upload')
  if (!isCurrent()) return null
  cacheImage(id, dataUrl)
  return { id, dataUrl }
}

export async function createInputImageFromDataUrl(dataUrl: string): Promise<InputImage> {
  const id = await storeImage(dataUrl, 'upload')
  cacheImage(id, dataUrl)
  return { id, dataUrl }
}

export async function submitTaskWithInput(options: SubmitTaskWithInputOptions): Promise<string | null> {
  return getTaskSubmissionService().submitWithInput(options)
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')
  const dataUrl = await blobToDataUrl(blob)
  const id = await storeImage(dataUrl, 'upload')
  cacheImage(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
