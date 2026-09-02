import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { normalizeBaseUrl } from '../lib/api'
import { isApiProxyAvailable, isApiProxyLocked, readClientDevProxyConfig } from '../lib/devProxy'
import { useStore, exportData, importData, clearData, type SettingsTab } from '../store'
import {
  createDefaultOpenAIProfile,
  DEFAULT_CHAT_MODEL,
  DEFAULT_FAL_BASE_URL,
  DEFAULT_FAL_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  findEquivalentApiProfile,
  getApiProviderLabel,
  getActiveApiProfile,
  importCustomProviderSettingsFromJson,
  isAmazonPlannerProfile,
  isOpenAICompatibleProvider,
  mergeImportedSettings,
  normalizeCustomProviderDefinition,
  normalizeSettings,
  OPENAI_PLANNER_MODELS,
  switchApiProfileProvider,
} from '../lib/apiProfiles'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { type ApiProfile, type AppSettings, type CustomProviderDefinition } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { DEFAULT_DROPDOWN_MAX_HEIGHT, getDropdownMaxHeight } from '../lib/dropdown'
import { Checkbox } from './Checkbox'
import ViewportTooltip from './ViewportTooltip'
import { CloseIcon, CopyIcon, DragHandleIcon, LinkIcon } from './icons'
import {
  isPristineNewOpenAIProfile as isPristineNewOpenAIProfileRecord,
  readCopyImportUrlOptions,
  saveCopyImportUrlOptions,
  type CopyImportUrlOptions,
} from '../lib/settingsCopyUrl'
import {
  createDefaultCustomProviderForm,
  customProviderFormToInput,
  customProviderToForm,
  type CustomProviderForm,
} from '../lib/customProviderForm'
import { CUSTOM_PROVIDER_LLM_PROMPT } from '../lib/customProviderLlmPrompt'
import SettingsGeneralTab from './settings/SettingsGeneralTab'
import SettingsAboutTab from './settings/SettingsAboutTab'
import SettingsDataTab from './settings/SettingsDataTab'
import SettingsApiTab from './settings/SettingsApiTab'

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const ADD_CUSTOM_PROVIDER_VALUE = '__add_custom_provider__'
const LEGACY_DEFAULT_CHAT_MODEL = 'deepseek-v4-flash'

function isPristineNewOpenAIProfile(profile: ApiProfile) {
  const defaultProfile = createDefaultOpenAIProfile({ id: profile.id, name: '新配置' })
  return isPristineNewOpenAIProfileRecord(profile, {
    baseUrl: DEFAULT_SETTINGS.baseUrl,
    timeout: DEFAULT_SETTINGS.timeout,
    imagesModel: DEFAULT_IMAGES_MODEL,
    apiProxy: defaultProfile.apiProxy,
  })
}

function getImportedProfileFromMergedSettings(
  nextSettings: AppSettings,
  previousProfileIds: Set<string>,
  importedSettings: { customProviders: CustomProviderDefinition[]; profiles: ApiProfile[] },
) {
  const existingProfile = importedSettings.profiles
    .map((profile) => findEquivalentApiProfile(nextSettings, profile, importedSettings.customProviders))
    .find((profile): profile is ApiProfile => profile != null && previousProfileIds.has(profile.id))
  if (existingProfile) return existingProfile

  return nextSettings.profiles.find((profile) => !previousProfileIds.has(profile.id)) ?? nextSettings.profiles[0]
}

const normalizeDraftSettings = (value: Partial<AppSettings> | unknown) => normalizeSettings(value)

function getAppVersionLabel() {
  const buildVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
  return buildVersion.trim() || import.meta.env.VITE_APP_VERSION?.trim() || 'dev'
}

const ABOUT_DESCRIPTION =
  '面向 Amazon 与 TikTok Shop 的跨境电商图片工作台，支持商品图生成、Listing 与 A+ 图片策划、竞品图片拆解反推、VOC 评论分析，以及 CSV/XLSX 评论导入后的 AI 报告生成。适合主图、卖点图、详情图、A+ 模块和多平台视觉素材的本地化创作流程。'

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const settingsTabRequest = useStore((s) => s.settingsTabRequest)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const reusedTaskApiProfileId = useStore((s) => s.reusedTaskApiProfileId)
  const setReusedTaskApiProfile = useStore((s) => s.setReusedTaskApiProfile)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const importInputRef = useRef<HTMLInputElement>(null)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const profileMenuTriggerRef = useRef<HTMLButtonElement>(null)

  const profileImportUrlTooltipTimerRef = useRef<number | null>(null)
  const duplicateProfileTooltipTimerRef = useRef<number | null>(null)
  const llmPromptTooltipTimerRef = useRef<number | null>(null)
  const settingsScrollBoundaryRef = useRef<HTMLDivElement>(null)
  const customProviderScrollBoundaryRef = useRef<HTMLDivElement>(null)

  const [draft, setDraft] = useState<AppSettings>(normalizeDraftSettings(settings))
  const [timeoutInput, setTimeoutInput] = useState(String(getActiveApiProfile(settings).timeout))
  const [showApiKey, setShowApiKey] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [profileMenuMaxHeight, setProfileMenuMaxHeight] = useState(DEFAULT_DROPDOWN_MAX_HEIGHT)
  const [showCustomProviderImport, setShowCustomProviderImport] = useState(false)
  const [editingCustomProviderId, setEditingCustomProviderId] = useState<string | null>(null)
  const [customProviderForm, setCustomProviderForm] = useState<CustomProviderForm>(createDefaultCustomProviderForm())
  const [customProviderImportError, setCustomProviderImportError] = useState<string | null>(null)
  const [profileImportUrlTooltipVisible, setProfileImportUrlTooltipVisible] = useState(false)
  const [duplicateProfileTooltipVisible, setDuplicateProfileTooltipVisible] = useState(false)
  const [llmPromptTooltipVisible, setLlmPromptTooltipVisible] = useState(false)
  const [aboutDescriptionExpanded, setAboutDescriptionExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('api')
  const [apiConfigView, setApiConfigView] = useState<'generation' | 'analysis'>('generation')
  const [exportConfig, setExportConfig] = useState(true)
  const [exportTasks, setExportTasks] = useState(true)
  const [importConfig, setImportConfig] = useState(true)
  const [importTasks, setImportTasks] = useState(true)
  const [clearConfig, setClearConfig] = useState(true)
  const [clearTasks, setClearTasks] = useState(true)
  const [isImportingData, setIsImportingData] = useState(false)
  const [isImportingJson, setIsImportingJson] = useState(false)
  const [draggedProfileId, setDraggedProfileId] = useState<string | null>(null)
  const [dragOverProfileId, setDragOverProfileId] = useState<string | null>(null)
  const [dragDropPosition, setDragDropPosition] = useState<'before' | 'after' | null>(null)
  const [profileTouchDragPreview, setProfileTouchDragPreview] = useState<{
    label: string
    providerLabel: string
    x: number
    y: number
    width: number
    height: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const profileTouchDragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null)
  const [copyImportUrlProfile, setCopyImportUrlProfile] = useState<ApiProfile | null>(null)
  const [copyImportUrlOptions, setCopyImportUrlOptions] = useState<CopyImportUrlOptions>(readCopyImportUrlOptions)

  const apiProxyConfig = readClientDevProxyConfig()
  const apiProxyAvailable = isApiProxyAvailable(apiProxyConfig)
  const apiProxyLocked = isApiProxyLocked(apiProxyConfig)
  const apiProxyUsesDynamicTarget = Boolean(apiProxyConfig?.enabled)
  const activeProfile =
    draft.profiles.find((profile) => profile.id === draft.activeProfileId) ??
    draft.profiles[0] ??
    getActiveApiProfile(draft)
  const activeProviderSupportsApiProxy = activeProfile.provider === 'openai' || activeProfile.provider === 'volcengine'
  const apiProxyChecked = activeProviderSupportsApiProxy && (apiProxyLocked || activeProfile.apiProxy)
  const apiProxyEnabled = apiProxyAvailable && activeProviderSupportsApiProxy && apiProxyChecked
  const apiProxyUrlLocked = apiProxyEnabled && !apiProxyUsesDynamicTarget
  const activeProviderIsOpenAICompatible = isOpenAICompatibleProvider(draft, activeProfile.provider)
  const activeProviderUsesApiUrl =
    activeProviderIsOpenAICompatible || activeProfile.provider === 'fal' || activeProfile.provider === 'volcengine'
  const activeCustomProvider = draft.customProviders.find((provider) => provider.id === activeProfile.provider)
  const defaultProviderOrder = ['openai', 'fal', 'volcengine', ...draft.customProviders.map((p) => p.id)]
  const providerOrder = draft.providerOrder || defaultProviderOrder

  const unorderedProviderOptions = [
    { label: 'OpenAI 兼容接口', value: 'openai', draggable: true },
    { label: 'fal.ai', value: 'fal', draggable: true },
    { label: '火山方舟 Seedream', value: 'volcengine', draggable: true },
    ...draft.customProviders.map((provider) => ({
      label: provider.name,
      value: provider.id,
      draggable: true,
      actions: [
        { label: '编辑', onClick: () => openEditCustomProvider(provider) },
        {
          label: '删除',
          variant: 'danger' as const,
          onClick: () => confirmDeleteCustomProvider(provider),
        },
      ],
    })),
  ]

  const providerOptions = [
    { label: '创建自定义服务商', value: ADD_CUSTOM_PROVIDER_VALUE, variant: 'action' as const },
    ...unorderedProviderOptions.sort((a, b) => {
      const aIndex = providerOrder.indexOf(String(a.value))
      const bIndex = providerOrder.indexOf(String(b.value))
      const validA = aIndex !== -1 ? aIndex : defaultProviderOrder.indexOf(String(a.value))
      const validB = bIndex !== -1 ? bIndex : defaultProviderOrder.indexOf(String(b.value))
      return validA - validB
    }),
  ]

  const getDefaultModelForMode = (apiMode: AppSettings['apiMode']) =>
    apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : apiMode === 'chat' ? DEFAULT_CHAT_MODEL : DEFAULT_IMAGES_MODEL
  const isDefaultModelForModeSwitch = (model: string) =>
    model === DEFAULT_IMAGES_MODEL ||
    model === DEFAULT_RESPONSES_MODEL ||
    model === DEFAULT_CHAT_MODEL ||
    model === LEGACY_DEFAULT_CHAT_MODEL
  const getApiModeLabel = (apiMode: AppSettings['apiMode']) =>
    apiMode === 'responses' ? 'Responses API' : apiMode === 'chat' ? 'Chat Completions' : 'Images API'
  const amazonPlannerProfiles = draft.profiles.filter(isAmazonPlannerProfile)
  const amazonPlannerProfile = amazonPlannerProfiles.find((profile) => profile.id === draft.amazonPlannerProfileId)
  const amazonPlannerProfileOptions = amazonPlannerProfiles.length
    ? amazonPlannerProfiles.map((profile) => ({
        label: `${profile.name} · ${profile.model || getDefaultModelForMode(profile.apiMode)} · ${getApiModeLabel(profile.apiMode)}`,
        value: profile.id,
      }))
    : [{ label: '暂无 Chat/Responses 策划配置', value: '' }]
  const amazonPlannerModelOptions = [
    ...(amazonPlannerProfile?.model &&
    !OPENAI_PLANNER_MODELS.includes(amazonPlannerProfile.model as (typeof OPENAI_PLANNER_MODELS)[number])
      ? [{ label: `${amazonPlannerProfile.model}（当前自定义）`, value: amazonPlannerProfile.model }]
      : []),
    ...OPENAI_PLANNER_MODELS.map((model) => ({
      label: model === DEFAULT_RESPONSES_MODEL ? `${model}（默认）` : model,
      value: model,
    })),
  ]
  const sopReverseProfileOptions = amazonPlannerProfiles.length
    ? amazonPlannerProfiles.map((profile) => ({
        label: `${profile.name} · ${profile.model || getDefaultModelForMode(profile.apiMode)} · ${getApiModeLabel(profile.apiMode)}`,
        value: profile.id,
      }))
    : [{ label: '暂无 Chat/Responses 拆图配置', value: '' }]
  const vocProfileOptions = amazonPlannerProfiles.length
    ? amazonPlannerProfiles.map((profile) => ({
        label: `${profile.name} · ${profile.model || getDefaultModelForMode(profile.apiMode)} · ${getApiModeLabel(profile.apiMode)}`,
        value: profile.id,
      }))
    : [{ label: '暂无 Chat/Responses VOC 配置', value: '' }]

  const wasSettingsOpenRef = useRef(false)

  useEffect(() => {
    if (!showSettings) {
      wasSettingsOpenRef.current = false
      return
    }
    if (wasSettingsOpenRef.current) return

    wasSettingsOpenRef.current = true
    const normalizedSettings = normalizeDraftSettings(settings)
    const displaySettings =
      normalizedSettings.reuseTaskApiProfileTemporarily &&
      reusedTaskApiProfileId &&
      normalizedSettings.profiles.some((profile) => profile.id === reusedTaskApiProfileId)
        ? normalizeDraftSettings({ ...normalizedSettings, activeProfileId: reusedTaskApiProfileId })
        : normalizedSettings
    const nextDraft = normalizeDraftSettings({
      ...displaySettings,
      profiles: displaySettings.profiles.map((profile) => ({
        ...profile,
        apiProxy:
          (profile.provider === 'openai' || profile.provider === 'volcengine') && apiProxyAvailable
            ? apiProxyLocked || profile.apiProxy
            : false,
      })),
    })
    setDraft(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
  }, [apiProxyAvailable, apiProxyLocked, showSettings, settings, reusedTaskApiProfileId])

  useEffect(() => {
    setTimeoutInput(String(activeProfile.timeout))
  }, [activeProfile.id, activeProfile.timeout])

  useEffect(() => {
    if (!showSettings || !settingsTabRequest) return
    setActiveTab(settingsTabRequest === 'agent' ? 'api' : settingsTabRequest)
  }, [settingsTabRequest, showSettings])

  const updateProfileMenuMaxHeight = useCallback(() => {
    if (!profileMenuTriggerRef.current) return
    setProfileMenuMaxHeight(getDropdownMaxHeight(profileMenuTriggerRef.current))
  }, [])

  useEffect(() => {
    if (!showProfileMenu) return

    const handlePointerDown = (event: PointerEvent) => {
      if (profileMenuRef.current?.contains(event.target as Node)) return
      setShowProfileMenu(false)
    }

    updateProfileMenuMaxHeight()
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', updateProfileMenuMaxHeight)
    window.addEventListener('scroll', updateProfileMenuMaxHeight, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', updateProfileMenuMaxHeight)
      window.removeEventListener('scroll', updateProfileMenuMaxHeight, true)
    }
  }, [showProfileMenu, updateProfileMenuMaxHeight])

  useEffect(
    () => () => {
      if (profileImportUrlTooltipTimerRef.current != null) window.clearTimeout(profileImportUrlTooltipTimerRef.current)
      if (duplicateProfileTooltipTimerRef.current != null) window.clearTimeout(duplicateProfileTooltipTimerRef.current)
      if (llmPromptTooltipTimerRef.current != null) window.clearTimeout(llmPromptTooltipTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!profileTouchDragPreview) return

    const preventTouchScroll = (event: TouchEvent) => {
      event.preventDefault()
    }
    const listenerOptions = { passive: false, capture: true } as AddEventListenerOptions
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior

    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    window.addEventListener('touchmove', preventTouchScroll, listenerOptions)

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
      window.removeEventListener('touchmove', preventTouchScroll, listenerOptions)
    }
  }, [profileTouchDragPreview])

  const clearProfileImportUrlTooltipTimer = () => {
    if (profileImportUrlTooltipTimerRef.current != null) {
      window.clearTimeout(profileImportUrlTooltipTimerRef.current)
      profileImportUrlTooltipTimerRef.current = null
    }
  }

  const clearDuplicateProfileTooltipTimer = () => {
    if (duplicateProfileTooltipTimerRef.current != null) {
      window.clearTimeout(duplicateProfileTooltipTimerRef.current)
      duplicateProfileTooltipTimerRef.current = null
    }
  }

  const clearLlmPromptTooltipTimer = () => {
    if (llmPromptTooltipTimerRef.current != null) {
      window.clearTimeout(llmPromptTooltipTimerRef.current)
      llmPromptTooltipTimerRef.current = null
    }
  }

  const commitSettings = (nextDraft: AppSettings) => {
    const normalizedProfiles = nextDraft.profiles.map((profile) => {
      const normalizedBaseUrl =
        profile.provider === 'fal'
          ? profile.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_FAL_BASE_URL
          : normalizeBaseUrl(profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl)
      const defaultModel = profile.provider === 'fal' ? DEFAULT_FAL_MODEL : getDefaultModelForMode(profile.apiMode)
      return {
        ...profile,
        name: profile.name.trim() || (profile.id === DEFAULT_OPENAI_PROFILE_ID ? '默认' : '新配置'),
        baseUrl: normalizedBaseUrl,
        model: profile.model.trim() || defaultModel,
        timeout: Number(profile.timeout) || DEFAULT_SETTINGS.timeout,
        apiProxy:
          (profile.provider === 'openai' || profile.provider === 'volcengine') && apiProxyAvailable
            ? apiProxyLocked || profile.apiProxy
            : false,
        codexCli: profile.provider === 'openai' ? profile.codexCli : false,
      }
    })
    const fallbackProfile = createDefaultOpenAIProfile({ id: newId('openai') })
    const nextActiveProfileId = normalizedProfiles.some((profile) => profile.id === nextDraft.activeProfileId)
      ? nextDraft.activeProfileId
      : (normalizedProfiles[0]?.id ?? fallbackProfile.id)
    const nextActiveProfile =
      normalizedProfiles.find((profile) => profile.id === nextActiveProfileId) ??
      normalizedProfiles[0] ??
      fallbackProfile
    const normalizedDraft = normalizeDraftSettings({
      ...nextDraft,
      baseUrl: nextActiveProfile.baseUrl,
      apiKey: nextActiveProfile.apiKey,
      model: nextActiveProfile.model,
      timeout: nextActiveProfile.timeout,
      apiMode: nextActiveProfile.apiMode,
      codexCli: nextActiveProfile.codexCli,
      apiProxy: nextActiveProfile.apiProxy,
      profiles: normalizedProfiles.length ? normalizedProfiles : [fallbackProfile],
      activeProfileId: nextActiveProfileId,
    })
    setDraft(normalizedDraft)
    setSettings(normalizedDraft)
  }

  const updateAmazonPlannerModel = (model: string) => {
    if (!amazonPlannerProfile) return
    const nextDraft = {
      ...draft,
      profiles: draft.profiles.map((profile) =>
        profile.id === amazonPlannerProfile.id ? { ...profile, model } : profile,
      ),
    }
    setDraft(nextDraft)
    commitSettings(nextDraft)
  }

  const updateCopyImportUrlOptions = (patch: Partial<CopyImportUrlOptions>) => {
    setCopyImportUrlOptions((previous) => {
      const next = { ...previous, ...patch, includeApiKey: false }
      saveCopyImportUrlOptions(next)
      return next
    })
  }

  const createProfileImportUrl = (profile: ApiProfile, options: CopyImportUrlOptions) => {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''

    if (profile.provider === 'openai') {
      const baseUrl = profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl
      url.searchParams.set(
        'apiUrl',
        options.useNewApiAddress && !options.includeApiKey ? '{address}' : normalizeBaseUrl(baseUrl),
      )
      if (options.includeApiKey && profile.apiKey.trim()) {
        url.searchParams.set('apiKey', profile.apiKey.trim())
      } else if (!options.includeApiKey && options.useNewApiKey) {
        url.searchParams.set('apiKey', '{key}')
      }
      url.searchParams.set('apiMode', profile.apiMode)
      const model = profile.model.trim() || getDefaultModelForMode(profile.apiMode)
      url.searchParams.set('model', !options.includeApiKey && options.useNewApiModel ? '{model}' : model)
      if (profile.codexCli) url.searchParams.set('codexCli', 'true')

      let result = url.toString()
      if (!options.includeApiKey) {
        if (options.useNewApiAddress) result = result.replace('%7Baddress%7D', '{address}')
        if (options.useNewApiKey) result = result.replace('%7Bkey%7D', '{key}')
        if (options.useNewApiModel) result = result.replace('%7Bmodel%7D', '{model}')
      }
      return result
    }

    const provider = draft.customProviders.find((item) => item.id === profile.provider)
    const importProfile: ApiProfile = {
      ...profile,
      apiKey: options.includeApiKey ? profile.apiKey : '',
    }
    if (!options.includeApiKey) {
      if (options.useNewApiAddress) importProfile.baseUrl = '{address}'
      if (options.useNewApiKey) importProfile.apiKey = '{key}'
      if (options.useNewApiModel) importProfile.model = '{model}'
    }
    url.searchParams.set(
      'settings',
      JSON.stringify({
        customProviders: provider ? [provider] : [],
        profiles: [importProfile],
      }),
    )

    let result = url.toString()
    if (!options.includeApiKey) {
      if (options.useNewApiAddress) result = result.replace(/%7Baddress%7D/g, '{address}')
      if (options.useNewApiKey) result = result.replace(/%7Bkey%7D/g, '{key}')
      if (options.useNewApiModel) result = result.replace(/%7Bmodel%7D/g, '{model}')
    }
    return result
  }

  const copyProfileImportUrl = async (profile: ApiProfile, options: CopyImportUrlOptions) => {
    try {
      await copyTextToClipboard(createProfileImportUrl(profile, options))
      showToast(options.includeApiKey ? '导入 URL 已复制（包含 API Key）' : '导入 URL 已复制', 'success')
      setCopyImportUrlProfile(null)
    } catch (err) {
      showToast(getClipboardFailureMessage('复制导入 URL 失败', err), 'error')
    }
  }

  const confirmCopyProfileImportUrl = (profile: ApiProfile) => {
    setShowProfileMenu(false)
    setProfileImportUrlTooltipVisible(false)
    setCopyImportUrlProfile(profile)
    setCopyImportUrlOptions(readCopyImportUrlOptions())
  }

  const getDraftWithActiveProfilePatch = (patch: Partial<ApiProfile>) => ({
    ...draft,
    profiles: draft.profiles.map((profile) => (profile.id === activeProfile.id ? { ...profile, ...patch } : profile)),
  })

  const updateActiveProfile = (patch: Partial<ApiProfile>, commit = false) => {
    const nextDraft = getDraftWithActiveProfilePatch(patch)
    setDraft(nextDraft)
    if (commit) commitSettings(nextDraft)
  }

  const commitActiveProfilePatch = (patch: Partial<ApiProfile>) => {
    const nextDraft = getDraftWithActiveProfilePatch(patch)
    commitSettings(nextDraft)
  }

  const handleClose = () => {
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' || Number.isNaN(nextTimeout) ? DEFAULT_SETTINGS.timeout : nextTimeout
    const nextDraft = {
      ...draft,
      profiles: activeProviderIsOpenAICompatible
        ? draft.profiles.map((profile) =>
            profile.id === activeProfile.id ? { ...profile, timeout: normalizedTimeout } : profile,
          )
        : draft.profiles,
    }
    commitSettings(nextDraft)
    setShowSettings(false)
  }

  const commitTimeout = useCallback(() => {
    if (!isOpenAICompatibleProvider(draft, activeProfile.provider)) return
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === ''
        ? DEFAULT_SETTINGS.timeout
        : Number.isNaN(nextTimeout)
          ? activeProfile.timeout
          : nextTimeout
    setTimeoutInput(String(normalizedTimeout))
    updateActiveProfile({ timeout: normalizedTimeout }, true)
  }, [draft, activeProfile.id, activeProfile.provider, activeProfile.timeout, timeoutInput])

  const saveApiSettings = () => {
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' || Number.isNaN(nextTimeout)
        ? activeProfile.timeout || DEFAULT_SETTINGS.timeout
        : nextTimeout
    const nextDraft = {
      ...draft,
      profiles: draft.profiles.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, timeout: normalizedTimeout } : profile,
      ),
    }
    setTimeoutInput(String(normalizedTimeout))
    commitSettings(nextDraft)
    showToast('API 配置保存成功', 'success')
  }

  useCloseOnEscape(showSettings, handleClose)
  usePreventBackgroundScroll(
    showSettings,
    showCustomProviderImport ? customProviderScrollBoundaryRef : settingsScrollBoundaryRef,
  )

  if (!showSettings) return null

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setIsImportingData(true)
      try {
        const imported = await importData(file, { importConfig, importTasks })
        if (imported) {
          const nextDraft = normalizeDraftSettings(useStore.getState().settings)
          setDraft(nextDraft)
          setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
          setShowProfileMenu(false)
        }
      } finally {
        setIsImportingData(false)
      }
    }
    e.target.value = ''
  }

  const handleClearAllData = async () => {
    await clearData({ clearConfig, clearTasks })
    const nextDraft = normalizeDraftSettings(useStore.getState().settings)
    setDraft(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
    setShowProfileMenu(false)
  }

  const createNewProfile = () => {
    setReusedTaskApiProfile(null)
    const profile = createDefaultOpenAIProfile({ id: newId('openai'), name: '新配置' })
    const nextDraft = normalizeDraftSettings({
      ...draft,
      profiles: [...draft.profiles, profile],
      activeProfileId: profile.id,
    })
    commitSettings(nextDraft)
    setShowProfileMenu(false)
  }

  const duplicateActiveProfile = () => {
    setReusedTaskApiProfile(null)
    setDuplicateProfileTooltipVisible(false)
    const profile: ApiProfile = {
      ...activeProfile,
      id: newId(activeProfile.provider === 'openai' ? 'openai' : 'profile'),
      name: `${activeProfile.name}（复制）`,
    }
    const nextDraft = normalizeDraftSettings({
      ...draft,
      profiles: [...draft.profiles, profile],
      activeProfileId: profile.id,
    })
    commitSettings(nextDraft)
    setShowProfileMenu(false)
  }

  const switchProfile = (id: string) => {
    setReusedTaskApiProfile(null)
    const nextDraft = normalizeDraftSettings({ ...draft, activeProfileId: id })
    commitSettings(nextDraft)
    setShowProfileMenu(false)
  }

  const handleProfileDragStart = (e: React.DragEvent, id: string) => {
    setDraggedProfileId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const handleProfileDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const targetElement = e.currentTarget as HTMLElement
    const rect = targetElement.getBoundingClientRect()
    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

    if (dragOverProfileId !== targetId || dragDropPosition !== position) {
      setDragOverProfileId(targetId)
      setDragDropPosition(position)
    }

    const scrollContainer = targetElement.closest('.custom-scrollbar')
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect()
      const scrollThreshold = 30

      if (e.clientY < containerRect.top + scrollThreshold) {
        scrollContainer.scrollTop -= 10
      } else if (e.clientY > containerRect.bottom - scrollThreshold) {
        scrollContainer.scrollTop += 10
      }
    }
  }

  const handleProfileDragEnd = () => {
    setDraggedProfileId(null)
    setDragOverProfileId(null)
    setDragDropPosition(null)
    setProfileTouchDragPreview(null)
    profileTouchDragRef.current = null
  }

  const moveProfileToDropTarget = (sourceId: string, targetId: string, position: 'before' | 'after' | null) => {
    if (!sourceId || sourceId === targetId) return

    const sourceIndex = draft.profiles.findIndex((p) => p.id === sourceId)
    const targetIndex = draft.profiles.findIndex((p) => p.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return

    const newProfiles = [...draft.profiles]
    const [removed] = newProfiles.splice(sourceIndex, 1)

    let newTargetIndex = targetIndex
    if (position === 'after') newTargetIndex++
    if (sourceIndex < targetIndex) newTargetIndex--

    newProfiles.splice(newTargetIndex, 0, removed)

    const nextDraft = normalizeDraftSettings({ ...draft, profiles: newProfiles })
    commitSettings(nextDraft)
  }

  const handleProfileDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    moveProfileToDropTarget(e.dataTransfer.getData('text/plain'), targetId, dragDropPosition)
    handleProfileDragEnd()
  }

  const handleProfileTouchStart = (e: React.TouchEvent, profile: ApiProfile) => {
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return
    const touch = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()

    e.preventDefault()
    e.stopPropagation()
    profileTouchDragRef.current = { id: profile.id, startX: touch.clientX, startY: touch.clientY, moved: false }
    setDraggedProfileId(profile.id)
    setProfileTouchDragPreview({
      label: profile.name,
      providerLabel: getApiProviderLabel(draft, profile.provider),
      x: touch.clientX,
      y: touch.clientY,
      width: rect.width,
      height: rect.height,
      offsetX: touch.clientX - rect.left,
      offsetY: touch.clientY - rect.top,
    })
  }

  const handleProfileTouchMove = (e: React.TouchEvent) => {
    const drag = profileTouchDragRef.current
    if (!drag) return
    const touch = e.touches[0]

    if (!drag.moved) {
      if (Math.abs(touch.clientX - drag.startX) > 5 || Math.abs(touch.clientY - drag.startY) > 5) {
        drag.moved = true
      } else {
        return
      }
    }

    e.preventDefault()
    setProfileTouchDragPreview((current) => (current ? { ...current, x: touch.clientX, y: touch.clientY } : current))

    const el = document.elementFromPoint(touch.clientX, touch.clientY)
    const targetElement = el?.closest('[data-profile-id]') as HTMLElement | null
    if (!targetElement) return

    const targetId = targetElement.getAttribute('data-profile-id')
    if (!targetId) return

    const rect = targetElement.getBoundingClientRect()
    const position = touch.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDragOverProfileId(targetId)
    setDragDropPosition(position)

    const scrollContainer = targetElement.closest('.custom-scrollbar') as HTMLElement | null
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect()
      const scrollThreshold = 30
      if (touch.clientY < containerRect.top + scrollThreshold) {
        scrollContainer.scrollTop -= 10
      } else if (touch.clientY > containerRect.bottom - scrollThreshold) {
        scrollContainer.scrollTop += 10
      }
    }
  }

  const handleProfileTouchEnd = (e: React.TouchEvent) => {
    const drag = profileTouchDragRef.current
    if (!drag) return
    if (drag.moved && dragOverProfileId && dragOverProfileId !== drag.id) {
      e.preventDefault()
      moveProfileToDropTarget(drag.id, dragOverProfileId, dragDropPosition)
    }
    handleProfileDragEnd()
  }

  const deleteProfile = (id: string) => {
    if (draft.profiles.length <= 1) return
    if (id === reusedTaskApiProfileId) setReusedTaskApiProfile(null)
    const nextProfiles = draft.profiles.filter((item) => item.id !== id)
    const nextDraft = normalizeDraftSettings({
      ...draft,
      profiles: nextProfiles,
      activeProfileId: draft.activeProfileId === id ? nextProfiles[0].id : draft.activeProfileId,
    })
    commitSettings(nextDraft)
  }

  const handleProviderReorder = (
    sourceValue: string | number,
    targetValue: string | number,
    position: 'before' | 'after' | null,
  ) => {
    const currentOrder = draft.providerOrder || [
      'openai',
      'fal',
      'volcengine',
      ...draft.customProviders.map((p) => p.id),
    ]
    const sourceIndex = currentOrder.indexOf(String(sourceValue))
    const targetIndex = currentOrder.indexOf(String(targetValue))
    if (sourceIndex < 0 || targetIndex < 0) return

    const newOrder = [...currentOrder]
    const [removed] = newOrder.splice(sourceIndex, 1)

    let newTargetIndex = targetIndex
    if (position === 'after') newTargetIndex++
    if (sourceIndex < targetIndex) newTargetIndex--

    newOrder.splice(newTargetIndex, 0, removed)

    const nextDraft = normalizeDraftSettings({ ...draft, providerOrder: newOrder })
    commitSettings(nextDraft)
  }

  const handleProviderTypeChange = (value: string | number) => {
    if (value === ADD_CUSTOM_PROVIDER_VALUE) {
      setEditingCustomProviderId(null)
      setCustomProviderForm(createDefaultCustomProviderForm())
      setShowCustomProviderImport(true)
      setCustomProviderImportError(null)
      return
    }

    const provider = String(value) as ApiProfile['provider']
    const customProvider = draft.customProviders.find((item) => item.id === provider)
    updateActiveProfile(switchApiProfileProvider(activeProfile, provider, customProvider), true)
  }

  const updateCustomProviderForm = (patch: Partial<CustomProviderForm>) => {
    setCustomProviderForm((current) => ({ ...current, ...patch }))
    setCustomProviderImportError(null)
  }

  const buildCustomProviderFromForm = () => {
    const input = customProviderFormToInput(customProviderForm)
    const usedIds = new Set(
      draft.customProviders.filter((item) => item.id !== editingCustomProviderId).map((item) => item.id),
    )
    const provider = normalizeCustomProviderDefinition(
      editingCustomProviderId && input && typeof input === 'object' ? { ...input, id: editingCustomProviderId } : input,
      usedIds,
    )
    if (!provider) throw new Error('自定义服务商配置无效')
    return provider
  }

  function openEditCustomProvider(provider: CustomProviderDefinition) {
    setEditingCustomProviderId(provider.id)
    setCustomProviderForm(customProviderToForm(provider))
    setShowCustomProviderImport(true)
    setCustomProviderImportError(null)
  }

  const saveCustomProvider = () => {
    try {
      const customProvider = buildCustomProviderFromForm()
      if (editingCustomProviderId) {
        const nextDraft = normalizeDraftSettings({
          ...draft,
          customProviders: draft.customProviders.map((provider) =>
            provider.id === editingCustomProviderId ? customProvider : provider,
          ),
        })
        commitSettings(nextDraft)
        setShowCustomProviderImport(false)
        setEditingCustomProviderId(null)
        setCustomProviderImportError(null)
        showToast('服务商配置已更新', 'success')
        return
      }

      const nextProfile = switchApiProfileProvider(activeProfile, customProvider.id, customProvider)
      const nextDraft = normalizeDraftSettings({
        ...draft,
        customProviders: [...draft.customProviders, customProvider],
        profiles: draft.profiles.map((profile) => (profile.id === activeProfile.id ? nextProfile : profile)),
      })
      commitSettings(nextDraft)
      setShowCustomProviderImport(false)
      setEditingCustomProviderId(null)
      setCustomProviderImportError(null)
    } catch (err) {
      setCustomProviderImportError(err instanceof Error ? err.message : String(err))
    }
  }

  function confirmDeleteCustomProvider(provider: CustomProviderDefinition) {
    setConfirmDialog({
      title: '删除服务商',
      message: `确定要删除自定义服务商「${provider.name}」吗？正在使用它的配置会切回 OpenAI 兼容接口。`,
      action: () => deleteCustomProvider(provider),
    })
  }

  function deleteCustomProvider(provider: CustomProviderDefinition) {
    const providerId = provider.id
    const nextDraft = normalizeDraftSettings({
      ...draft,
      customProviders: draft.customProviders.filter((provider) => provider.id !== providerId),
      profiles: draft.profiles.map((profile) =>
        profile.provider === providerId ? switchApiProfileProvider(profile, 'openai') : profile,
      ),
    })
    commitSettings(nextDraft)
    showToast('服务商已删除', 'success')
  }

  const copyCustomProviderLlmPrompt = async () => {
    try {
      await copyTextToClipboard(CUSTOM_PROVIDER_LLM_PROMPT)
      showToast('LLM 生成提示词已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制 LLM 生成提示词失败', err), 'error')
    }
  }

  const handleCustomProviderJsonPaste = async () => {
    setIsImportingJson(true)
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        throw new Error('剪贴板为空')
      }
      const imported = importCustomProviderSettingsFromJson(text, draft.customProviders)
      if (imported.profiles.length > 0) {
        const previousProfileIds = new Set(draft.profiles.map((profile) => profile.id))
        const mergedDraft = mergeImportedSettings(draft, imported)
        const importedProfile = getImportedProfileFromMergedSettings(mergedDraft, previousProfileIds, imported)
        const importedProfileAlreadyExisted = previousProfileIds.has(importedProfile.id)
        const shouldReplaceActiveProfile =
          !editingCustomProviderId && isPristineNewOpenAIProfile(activeProfile) && !importedProfileAlreadyExisted
        const switchedToExistingProfile = !shouldReplaceActiveProfile && importedProfileAlreadyExisted
        const nextDraft = shouldReplaceActiveProfile
          ? normalizeDraftSettings({
              ...mergedDraft,
              profiles: mergedDraft.profiles
                .filter((profile) => profile.id === activeProfile.id || profile.id !== importedProfile.id)
                .map((profile) =>
                  profile.id === activeProfile.id ? { ...importedProfile, id: activeProfile.id } : profile,
                ),
              activeProfileId: activeProfile.id,
            })
          : normalizeDraftSettings({
              ...mergedDraft,
              activeProfileId: importedProfile.id,
            })
        setDraft(nextDraft)
        setSettings(nextDraft)
        setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
        setShowCustomProviderImport(false)
        setEditingCustomProviderId(null)
        setCustomProviderImportError(null)
        showToast(
          shouldReplaceActiveProfile
            ? '已覆盖当前空配置'
            : switchedToExistingProfile
              ? '已存在相同配置，已切换到已有配置'
              : 'JSON 配置已导入并切换',
          'success',
        )
        return
      }

      const provider = imported.customProviders[0]
      setCustomProviderForm(customProviderToForm(provider))
      setCustomProviderImportError(null)
      showToast('JSON 配置已导入', 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setCustomProviderImportError(null)
      if (err instanceof Error && err.name === 'NotAllowedError') {
        showToast('无法读取剪贴板，请允许浏览器访问剪贴板，或直接粘贴到输入框中', 'error')
      } else {
        showToast(msg, 'error')
      }
    } finally {
      setIsImportingJson(false)
    }
  }

  return (
    <div data-no-drag-select className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" onClick={handleClose} />
      <div
        ref={settingsScrollBoundaryRef}
        className="relative z-10 flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 sm:h-[720px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 p-5 border-b border-gray-100 dark:border-white/[0.08]">
          <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 dark:text-gray-500 font-mono select-none">
              v{getAppVersionLabel()}
            </span>
            <button
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          {/* Sidebar */}
          <div className="w-full sm:w-48 shrink-0 flex flex-col border-b sm:border-b-0 sm:border-r border-gray-100 dark:border-white/[0.08] bg-gray-50/50 dark:bg-white/[0.02]">
            <nav className="flex-1 overflow-x-auto sm:overflow-y-auto custom-scrollbar p-3 space-x-1 sm:space-x-0 sm:space-y-1 flex sm:flex-col">
              <button
                onClick={() => setActiveTab('api')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'api' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                  />
                </svg>
                API 配置
              </button>
              <button
                onClick={() => setActiveTab('general')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'general' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
                  />
                </svg>
                习惯配置
              </button>
              <button
                onClick={() => setActiveTab('data')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'data' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                  />
                </svg>
                数据管理
              </button>
              <button
                onClick={() => setActiveTab('about')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'about' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                关于
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-transparent relative overflow-hidden">
            <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-5 sm:p-6">
              {activeTab === 'general' && <SettingsGeneralTab draft={draft} onCommit={commitSettings} />}

              {activeTab === 'api' && (
                <SettingsApiTab
                  {...{
                    draft,
                    activeProfile,
                    activeCustomProvider,
                    apiConfigView,
                    setApiConfigView,
                    showApiKey,
                    setShowApiKey,
                    showProfileMenu,
                    setShowProfileMenu,
                    profileMenuMaxHeight,
                    profileMenuRef,
                    profileMenuTriggerRef,
                    profileImportUrlTooltipVisible,
                    setProfileImportUrlTooltipVisible,
                    duplicateProfileTooltipVisible,
                    setDuplicateProfileTooltipVisible,
                    profileImportUrlTooltipTimerRef,
                    duplicateProfileTooltipTimerRef,
                    draggedProfileId,
                    dragOverProfileId,
                    dragDropPosition,
                    providerOptions,
                    amazonPlannerProfiles,
                    amazonPlannerProfile,
                    amazonPlannerProfileOptions,
                    amazonPlannerModelOptions,
                    sopReverseProfileOptions,
                    vocProfileOptions,
                    activeProviderUsesApiUrl,
                    activeProviderIsOpenAICompatible,
                    activeProviderSupportsApiProxy,
                    apiProxyAvailable,
                    apiProxyLocked,
                    apiProxyChecked,
                    apiProxyEnabled,
                    apiProxyUrlLocked,
                    apiProxyUsesDynamicTarget,
                    timeoutInput,
                    setTimeoutInput,
                    updateProfileMenuMaxHeight,
                    clearProfileImportUrlTooltipTimer,
                    clearDuplicateProfileTooltipTimer,
                    confirmCopyProfileImportUrl,
                    duplicateActiveProfile,
                    createNewProfile,
                    switchProfile,
                    deleteProfile,
                    handleProfileDragStart,
                    handleProfileDragOver,
                    handleProfileDrop,
                    handleProfileDragEnd,
                    handleProfileTouchStart,
                    handleProfileTouchMove,
                    handleProfileTouchEnd,
                    setConfirmDialog,
                    commitSettings,
                    updateAmazonPlannerModel,
                    updateActiveProfile,
                    commitActiveProfilePatch,
                    handleProviderTypeChange,
                    handleProviderReorder,
                    getDefaultModelForMode,
                    isDefaultModelForModeSwitch,
                    commitTimeout,
                    saveApiSettings,
                  }}
                />
              )}
              {activeTab === 'data' && (
                <SettingsDataTab
                  exportConfig={exportConfig}
                  exportTasks={exportTasks}
                  importConfig={importConfig}
                  importTasks={importTasks}
                  clearConfig={clearConfig}
                  clearTasks={clearTasks}
                  isImportingData={isImportingData}
                  importInputRef={importInputRef}
                  onExportConfigChange={setExportConfig}
                  onExportTasksChange={setExportTasks}
                  onImportConfigChange={setImportConfig}
                  onImportTasksChange={setImportTasks}
                  onClearConfigChange={setClearConfig}
                  onClearTasksChange={setClearTasks}
                  onExport={() => void exportData({ exportConfig, exportTasks })}
                  onImport={handleImport}
                  onClear={() =>
                    setConfirmDialog({
                      title: '清空所选数据',
                      message: '确定要清空所选的数据吗？此操作不可恢复。',
                      action: () => void handleClearAllData(),
                    })
                  }
                />
              )}

              {activeTab === 'about' && (
                <SettingsAboutTab
                  description={ABOUT_DESCRIPTION}
                  descriptionExpanded={aboutDescriptionExpanded}
                  onToggleDescription={() => setAboutDescriptionExpanded((expanded) => !expanded)}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {showCustomProviderImport &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
              onClick={() => {
                setShowCustomProviderImport(false)
                setEditingCustomProviderId(null)
              }}
            />
            <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 flex flex-col h-[85vh] sm:h-[680px] max-h-[90vh] overflow-hidden">
              <div className="mb-5 flex items-center justify-between gap-4 shrink-0">
                <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">
                  {editingCustomProviderId ? '编辑自定义服务商' : '创建自定义服务商'}
                </h3>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomProviderImport(false)
                      setEditingCustomProviderId(null)
                    }}
                    className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                    aria-label="关闭"
                  >
                    <CloseIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div ref={customProviderScrollBoundaryRef} className="flex-1 flex flex-col min-h-0 px-1 -mx-1 pb-2">
                <div className="mb-6 shrink-0 rounded-2xl bg-gray-50/80 p-4 border border-gray-200/60 dark:bg-white/[0.02] dark:border-white/[0.05]">
                  <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-gray-200">
                    <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    AI 一键生成与导入
                  </div>
                  <div data-selectable-text className="mb-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    复制提示词发给 LLM，可根据 API 文档自动生成完整的配置（包含服务商、模型、URL 等）。复制 LLM 输出的
                    JSON 后，点击“从剪贴板粘贴并导入”即可一键生效。
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="relative inline-flex">
                      <button
                        type="button"
                        onClick={copyCustomProviderLlmPrompt}
                        aria-label="复制用于生成完整导入 JSON 的 LLM 提示词"
                        onMouseEnter={() => setLlmPromptTooltipVisible(true)}
                        onMouseLeave={() => setLlmPromptTooltipVisible(false)}
                        onFocus={() => setLlmPromptTooltipVisible(true)}
                        onBlur={() => setLlmPromptTooltipVisible(false)}
                        onTouchStart={() => {
                          clearLlmPromptTooltipTimer()
                          llmPromptTooltipTimerRef.current = window.setTimeout(() => {
                            setLlmPromptTooltipVisible(true)
                            llmPromptTooltipTimerRef.current = null
                          }, 450)
                        }}
                        onTouchEnd={clearLlmPromptTooltipTimer}
                        onTouchCancel={clearLlmPromptTooltipTimer}
                        className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm border border-gray-200/80 transition hover:bg-gray-50 hover:text-gray-900 dark:bg-white/[0.05] dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                      >
                        <LinkIcon className="h-3.5 w-3.5" />
                        复制生成提示词
                      </button>
                      <ViewportTooltip visible={llmPromptTooltipVisible} className="w-56 whitespace-normal text-center">
                        生成完整的服务商和配置信息，包含模型和接口地址，导入后只需填入 API Key。
                      </ViewportTooltip>
                    </span>
                    <button
                      type="button"
                      onClick={handleCustomProviderJsonPaste}
                      disabled={isImportingJson}
                      className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm border border-gray-200/80 transition hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white/[0.05] dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                    >
                      {isImportingJson ? (
                        <>
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            ></circle>
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                          </svg>
                          导入中...
                        </>
                      ) : (
                        '从剪贴板粘贴并导入'
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex flex-col min-h-0">
                  <label className="flex-1 flex flex-col min-h-0">
                    <span className="mb-1 shrink-0 block text-xs text-gray-500 dark:text-gray-400">
                      手动编辑 (仅接口映射 Manifest)
                    </span>
                    <textarea
                      value={customProviderForm.json}
                      onChange={(e) => updateCustomProviderForm({ json: e.target.value })}
                      spellCheck={false}
                      className="flex-1 min-h-[150px] w-full resize-none rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 font-mono text-xs leading-relaxed text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50 custom-scrollbar"
                    />
                  </label>
                </div>

                {customProviderImportError && (
                  <div
                    data-selectable-text
                    className="shrink-0 mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-500 dark:bg-red-500/10 dark:text-red-300"
                  >
                    {customProviderImportError}
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomProviderImport(false)
                    setEditingCustomProviderId(null)
                  }}
                  className="rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveCustomProvider}
                  className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
                >
                  {editingCustomProviderId ? '保存修改' : '创建并使用'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {profileTouchDragPreview &&
        createPortal(
          <div
            className="fixed pointer-events-none z-[110] flex items-center justify-between gap-2 rounded-xl bg-white/95 px-3 py-2 text-xs text-gray-700 shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:bg-gray-900/95 dark:text-gray-300 dark:ring-white/10"
            style={{
              left: profileTouchDragPreview.x - profileTouchDragPreview.offsetX,
              top: profileTouchDragPreview.y - profileTouchDragPreview.offsetY,
              width: profileTouchDragPreview.width,
              minHeight: profileTouchDragPreview.height,
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
              <DragHandleIcon className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
              <span className="min-w-0 truncate">{profileTouchDragPreview.label}</span>
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">
                {profileTouchDragPreview.providerLabel}
              </span>
            </div>
          </div>,
          document.body,
        )}
      {copyImportUrlProfile &&
        createPortal(
          <div
            data-no-drag-select
            className="fixed inset-0 z-[110] flex items-center justify-center p-4"
            onClick={() => setCopyImportUrlProfile(null)}
          >
            <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
            <div
              className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] rounded-3xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] max-w-sm w-full p-6 z-10 ring-1 ring-black/5 dark:ring-white/10 animate-confirm-in"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setCopyImportUrlProfile(null)}
                className="absolute right-4 top-4 shrink-0 rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                aria-label="关闭"
              >
                <CloseIcon className="h-5 w-5" />
              </button>

              <h3 className="mb-3 pr-8 flex items-start gap-2.5 text-base font-bold text-gray-800 dark:text-gray-100 leading-snug">
                <CopyIcon className="h-5 w-5 shrink-0 text-blue-500 mt-0.5" />
                <span>复制导入配置「{copyImportUrlProfile.name}」的 URL</span>
              </h3>
              <div className="text-[13px] text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
                是否包含 API Key？如果选择「不包含」，可额外配置是否使用 New API 变量。
              </div>

              {!copyImportUrlOptions.includeApiKey && (
                <div className="mb-6 rounded-2xl bg-gray-50/80 p-4 dark:bg-white/[0.03] ring-1 ring-black/5 dark:ring-white/5">
                  <div className="text-[13px] font-bold text-gray-700 dark:text-gray-300 mb-3.5">New API 变量配置</div>
                  <div className="space-y-3">
                    <Checkbox
                      checked={copyImportUrlOptions.useNewApiAddress}
                      onChange={(checked) => updateCopyImportUrlOptions({ useNewApiAddress: checked })}
                      label={
                        <>
                          使用{' '}
                          <code className="mx-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[0.85em] font-mono text-gray-700 dark:bg-white/[0.08] dark:text-gray-200">
                            {'{address}'}
                          </code>{' '}
                          (不含 /v1)
                        </>
                      }
                    />
                    <Checkbox
                      checked={copyImportUrlOptions.useNewApiKey}
                      onChange={(checked) => updateCopyImportUrlOptions({ useNewApiKey: checked })}
                      label={
                        <>
                          使用{' '}
                          <code className="mx-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[0.85em] font-mono text-gray-700 dark:bg-white/[0.08] dark:text-gray-200">
                            {'{key}'}
                          </code>
                        </>
                      }
                    />
                    <Checkbox
                      checked={copyImportUrlOptions.useNewApiModel}
                      onChange={(checked) => updateCopyImportUrlOptions({ useNewApiModel: checked })}
                      label={
                        <>
                          使用{' '}
                          <code className="mx-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[0.85em] font-mono text-gray-700 dark:bg-white/[0.08] dark:text-gray-200">
                            {'{model}'}
                          </code>
                        </>
                      }
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const options = { ...copyImportUrlOptions, includeApiKey: false }
                    copyProfileImportUrl(copyImportUrlProfile, options)
                  }}
                  className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-white/[0.08] text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition"
                >
                  不包含
                </button>
                <button
                  onClick={() => {
                    const options = { ...copyImportUrlOptions, includeApiKey: true }
                    copyProfileImportUrl(copyImportUrlProfile, options)
                  }}
                  className="flex-1 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition shadow-sm shadow-blue-500/20"
                >
                  包含 API Key
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
