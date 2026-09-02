import { canApiProfileGenerateImages } from '../../lib/apiProfiles'
import { DEFAULT_AMAZON_PROMPT_DRAFT, type AmazonPromptDraft } from '../../lib/amazonPrompt'
import { summarizeGenerationError } from '../../lib/generationError'
import {
  A_PLUS_CONTENT_TYPES,
  areAPlusModuleSpecsEquivalent,
  getAPlusContentTypeLabel,
  getAPlusModuleSpecs,
  normalizeAPlusModuleSpecs,
  type APlusContentType,
  type AmazonAPlusModuleSpec,
  type AmazonAPlusPlan,
  type AmazonPlannerMode,
  type AmazonStyleDensityMode,
} from '../../lib/listingPlanner'
import type { AmazonPlannerSession } from '../../types'
import type { ApiMode, ApiProfile } from '../../types'

export const STYLE_PREVIEW_WIDTH = 420
export const STYLE_PREVIEW_HEIGHT = 500
export const STYLE_PREVIEW_OFFSET = 16
export const PLANNER_HISTORY_LIMIT = 30

export type APlusModuleSpecsByType = Partial<Record<APlusContentType, AmazonAPlusModuleSpec[]>>
export type ComplianceStatus = 'ready' | 'warning' | 'missing'
export type WorkflowStepStatus = 'done' | 'current' | 'todo'
export type PlannerGuideTarget =
  'planner-api' | 'planner-input' | 'planner-action' | 'style' | 'style-choice' | 'plan-list' | 'action-bar'
export type PlannerGuideState = { target: PlannerGuideTarget; message: string }
export type GuidePanelTone = 'white' | 'muted'
export type PlannerActionProgress = 'filled' | 'submitted'
export type PlannerActionProgressMap = Record<string, PlannerActionProgress>
export type PromptEditorState = { actionKey: string; title: string; value: string }
export type StyleImageState = {
  candidateIndex: number
  status: 'running' | 'done' | 'error' | 'stopped'
  imageId?: string
  dataUrl?: string
  error?: string
}
export type StylePreviewState = {
  dataUrl: string
  label: string
  description: string
  left: number
  top: number
}

export const STYLE_DENSITY_OPTIONS: Array<{ value: AmazonStyleDensityMode; label: string }> = [
  { value: 'rich', label: '信息丰富' },
  { value: 'minimal', label: '简约' },
]

export function getApiModeLabel(apiMode: ApiMode) {
  if (apiMode === 'responses') return 'Responses API'
  if (apiMode === 'chat') return 'Chat Completions'
  return 'Images API'
}

export function getImageProfileApiLabel(profile: ApiProfile) {
  if (profile.apiMode === 'chat' && canApiProfileGenerateImages(profile))
    return 'Chat Completions（OpenRouter 图片模型）'
  return getApiModeLabel(profile.apiMode)
}

export function createPlannerSessionId() {
  return `amazon-planner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeHistoryTitle(value: string) {
  const chars = Array.from(value.replace(/\s+/g, ' ').trim())
  if (chars.length <= 40) return chars.join('')
  return `${chars.slice(0, 37).join('')}...`
}

export function getPlannerSessionTitle(draft: AmazonPromptDraft, listingText: string) {
  return normalizeHistoryTitle(draft.productTitle) || normalizeHistoryTitle(listingText) || '未命名策划'
}

export function getSessionAPlusModuleSpecsByType(session: AmazonPlannerSession): APlusModuleSpecsByType {
  const sessionSpecs = session.aPlusModuleSpecs ?? {}
  return A_PLUS_CONTENT_TYPES.reduce<APlusModuleSpecsByType>((result, type) => {
    const specs = sessionSpecs[type]
    if (Array.isArray(specs) && specs.length) {
      const normalized = normalizeAPlusModuleSpecs(type, specs as Array<Partial<AmazonAPlusModuleSpec>>)
      if (!areAPlusModuleSpecsEquivalent(normalized, getAPlusModuleSpecs(type))) result[type] = normalized
    }
    return result
  }, {})
}

export function getAPlusModuleSpecsForSession(
  specsByType: APlusModuleSpecsByType,
): AmazonPlannerSession['aPlusModuleSpecs'] {
  const entries = A_PLUS_CONTENT_TYPES.flatMap((type) => {
    const specs = specsByType[type]
    return specs?.length && !areAPlusModuleSpecsEquivalent(specs, getAPlusModuleSpecs(type))
      ? [[type, specs] as const]
      : []
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function formatPlannerSessionTime(value: number) {
  if (!Number.isFinite(value)) return ''
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function toSessionDraft(draft: AmazonPromptDraft): AmazonPlannerSession['draft'] {
  return {
    kind: draft.kind,
    productTitle: draft.productTitle,
    category: draft.category,
    brand: draft.brand,
    color: draft.color,
    material: draft.material,
    audience: draft.audience,
    sellingPoints: draft.sellingPoints,
    packageIncludes: draft.packageIncludes,
    scene: draft.scene,
    forbidden: draft.forbidden,
  }
}

export function fromSessionDraft(draft: AmazonPlannerSession['draft']): AmazonPromptDraft {
  return {
    ...DEFAULT_AMAZON_PROMPT_DRAFT,
    ...draft,
    kind: (draft.kind as AmazonPromptDraft['kind']) || DEFAULT_AMAZON_PROMPT_DRAFT.kind,
  }
}

export interface PlannerSessionSnapshotInput {
  currentPlannerSessionId: string | null
  existingSession?: AmazonPlannerSession | null
  draft: AmazonPromptDraft
  listingText: string
  plannerPlatform: AmazonPlannerSession['platform']
  marketplaceId: AmazonPlannerSession['marketplaceId']
  tiktokDesignType: AmazonPlannerSession['tiktokDesignType']
  plannerMode: AmazonPlannerSession['mode']
  aPlusType: AmazonPlannerSession['aPlusType']
  aPlusModuleSpecsByType: APlusModuleSpecsByType
  resolution: AmazonPlannerSession['resolution']
  referenceImageIds: string[]
  seriesStyleGuides: AmazonPlannerSession['seriesStyleGuides']
  styleCandidates: AmazonPlannerSession['styleCandidates']
  styleImages: StyleImageState[]
  selectedStyleIndex: number | null
  styleDensityMode: AmazonStyleDensityMode
  imagePlans: AmazonPlannerSession['imagePlans']
  aPlusPlans: AmazonPlannerSession['aPlusPlans']
  selectedPlanIndex: number | null
  selectedAPlusPlanIndex: number | null
}

export function createPlannerSessionSnapshot(
  input: PlannerSessionSnapshotInput,
  overrides: Partial<AmazonPlannerSession> = {},
  now = Date.now(),
): AmazonPlannerSession {
  const existing = !overrides.id && input.currentPlannerSessionId ? (input.existingSession ?? null) : null
  const snapshotDraft = overrides.draft ? fromSessionDraft(overrides.draft) : input.draft
  const snapshotListingText = overrides.listingText ?? input.listingText
  return {
    id: overrides.id ?? input.currentPlannerSessionId ?? createPlannerSessionId(),
    title: overrides.title ?? getPlannerSessionTitle(snapshotDraft, snapshotListingText),
    platform: overrides.platform ?? input.plannerPlatform,
    marketplaceId: overrides.marketplaceId ?? input.marketplaceId,
    tiktokDesignType: overrides.tiktokDesignType ?? input.tiktokDesignType,
    mode: overrides.mode ?? input.plannerMode,
    aPlusType: overrides.aPlusType ?? input.aPlusType,
    aPlusModuleSpecs: Object.prototype.hasOwnProperty.call(overrides, 'aPlusModuleSpecs')
      ? overrides.aPlusModuleSpecs
      : getAPlusModuleSpecsForSession(input.aPlusModuleSpecsByType),
    resolution: overrides.resolution ?? input.resolution,
    listingText: snapshotListingText,
    referenceImageIds: overrides.referenceImageIds ?? input.referenceImageIds,
    draft: overrides.draft ?? toSessionDraft(input.draft),
    seriesStyleGuides: overrides.seriesStyleGuides ?? input.seriesStyleGuides,
    styleCandidates: overrides.styleCandidates ?? input.styleCandidates,
    styleImages: overrides.styleImages ?? getSessionStyleImages(input.styleImages),
    selectedStyleIndex: overrides.selectedStyleIndex ?? input.selectedStyleIndex,
    styleDensityMode: overrides.styleDensityMode ?? input.styleDensityMode,
    imagePlans: overrides.imagePlans ?? input.imagePlans,
    aPlusPlans: overrides.aPlusPlans ?? input.aPlusPlans,
    selectedPlanIndex: overrides.selectedPlanIndex ?? input.selectedPlanIndex,
    selectedAPlusPlanIndex: overrides.selectedAPlusPlanIndex ?? input.selectedAPlusPlanIndex,
    createdAt: overrides.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now,
  }
}

export function getSessionStyleImages(styleImages: StyleImageState[]): AmazonPlannerSession['styleImages'] {
  return styleImages
    .filter(
      (image): image is StyleImageState & { imageId: string } => image.status === 'done' && Boolean(image.imageId),
    )
    .map((image) => ({ candidateIndex: image.candidateIndex, imageId: image.imageId }))
}

export function sortPlannerSessions(sessions: AmazonPlannerSession[]) {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, PLANNER_HISTORY_LIMIT)
}

export function getActionStepClass(status: WorkflowStepStatus) {
  if (status === 'done')
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200'
  if (status === 'current')
    return 'border-blue-200 bg-blue-50 text-blue-800 ring-1 ring-blue-500/10 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200'
  return 'border-gray-200 bg-white text-gray-500 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-400'
}

export function getGuidePanelClass(isActive: boolean, tone: GuidePanelTone = 'white') {
  if (isActive)
    return 'border-blue-300 bg-blue-50/60 ring-2 ring-blue-500/15 dark:border-blue-400/60 dark:bg-blue-500/10'
  if (tone === 'muted') return 'border-gray-200 bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950'
  return 'border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950'
}

export function getGuideFocusClass(isActive: boolean) {
  return isActive ? 'ring-2 ring-blue-500/20 dark:ring-blue-400/20' : ''
}

export function getPlannerActionKey(
  mode: AmazonPlannerMode,
  planIndex: number | null,
  slot: string | undefined | null,
) {
  if (planIndex == null || !slot) return ''
  return `${mode}:${planIndex}:${slot}`
}

export function getPlannerFailureDetail(err: unknown): string {
  const rawMessage = err instanceof Error ? err.message : String(err)
  const message = rawMessage.trim() || '未知错误'
  const lower = message.toLowerCase()
  const hints: string[] = []

  if (/401|invalid api key|incorrect api key|unauthorized|forbidden|权限|认证|鉴权/.test(lower)) {
    hints.push('请检查 AI 策划配置里的 API Key 是否正确，并确认该 Key 有所选聊天/策划接口权限。')
  }
  if (/404|not found|responses|endpoint|route|路径|不存在/.test(lower)) {
    hints.push(
      '请确认 AI 策划配置的 API URL 支持当前接口：DeepSeek 请使用 Chat Completions（/chat/completions），不要使用只开放 /v1/images 的图片中转。',
    )
  }
  if (/model|does not exist|unsupported|not supported|模型/.test(lower)) {
    hints.push('请确认 AI 策划配置使用的是文本/多模态模型，而不是 gpt-image-2。')
  }
  if (/json_schema|schema|structured|text\.format|response_format|strict/.test(lower)) {
    hints.push('该接口可能不支持当前 JSON 输出参数；Chat Completions 需要支持 response_format=json_object。')
  }
  if (/\b524\b|gateway.*timeout|网关.*超时/.test(lower)) {
    hints.push('上游网关等待策划模型返回时超时；应用会在 Responses API 超时时自动改用 Chat Completions 重试一次。')
  }
  if (/failed to fetch|network|cors|load failed|连接|网络|跨域/.test(lower)) {
    hints.push('浏览器未能连接到策划接口；请检查网络、跨域设置，或开启应用里的 API 代理。')
  }

  return [message, ...hints].join('\n\n')
}

export function getStyleGenerationFailureDetail(err: unknown): string {
  return summarizeGenerationError(err)
}

export function updateDraft<K extends keyof AmazonPromptDraft>(
  draft: AmazonPromptDraft,
  key: K,
  value: AmazonPromptDraft[K],
) {
  return { ...draft, [key]: value }
}

export function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  )
}

export function getStyleImagePlaceholder(status: StyleImageState['status'] | undefined) {
  if (status === 'running') return '生成中...'
  if (status === 'error') return '生成失败'
  if (status === 'stopped') return '已停止'
  return '待生成'
}

export function upsertStyleImageState(styleImages: StyleImageState[], nextImage: StyleImageState) {
  let replaced = false
  const next = styleImages.map((image) => {
    if (image.candidateIndex !== nextImage.candidateIndex) return image
    replaced = true
    return nextImage
  })
  return replaced ? next : [...next, nextImage].sort((a, b) => a.candidateIndex - b.candidateIndex)
}

export function getStylePreviewPosition(clientX: number, clientY: number) {
  if (typeof window === 'undefined') {
    return { left: clientX + STYLE_PREVIEW_OFFSET, top: clientY + STYLE_PREVIEW_OFFSET }
  }
  const viewportPadding = 12
  const rightLeft = clientX + STYLE_PREVIEW_OFFSET
  const left =
    rightLeft + STYLE_PREVIEW_WIDTH <= window.innerWidth - viewportPadding
      ? rightLeft
      : Math.max(viewportPadding, clientX - STYLE_PREVIEW_WIDTH - STYLE_PREVIEW_OFFSET)
  const maxTop = Math.max(viewportPadding, window.innerHeight - STYLE_PREVIEW_HEIGHT - viewportPadding)
  const top = Math.min(Math.max(viewportPadding, clientY - 160), maxTop)
  return { left, top }
}

export function getPlanSummary(planMarkdown: string) {
  const lines = planMarkdown
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^#+\s*/, '')
        .replace(/^\s*[-*]\s*/, '')
        .trim(),
    )
    .filter(Boolean)
  return lines[0] ?? ''
}

export function getAmazonAPlusComplianceChecks(
  draft: AmazonPromptDraft,
  plan: AmazonAPlusPlan | null,
  aPlusType: APlusContentType,
  referenceImageCount: number,
  hasStyleReference: boolean,
): Array<{ label: string; status: ComplianceStatus; detail: string }> {
  return [
    {
      label: '商品名称',
      status: draft.productTitle.trim() ? 'ready' : 'missing',
      detail: draft.productTitle.trim() ? '已填写' : '需要填写准确商品名',
    },
    {
      label: 'A+ 类型',
      status: 'ready',
      detail: `${getAPlusContentTypeLabel(aPlusType)} 编排`,
    },
    {
      label: 'A+ 尺寸',
      status: plan ? 'ready' : 'warning',
      detail: plan ? `${plan.generationSize} 生成，上传建议 ${plan.uploadSize}` : '请选择一个 A+ 模块',
    },
    {
      label: '参考图',
      status: referenceImageCount > 0 ? 'ready' : 'warning',
      detail: referenceImageCount > 0 ? `${referenceImageCount} 张参考图` : '建议上传产品实拍参考图',
    },
    {
      label: '风格板',
      status: hasStyleReference ? 'ready' : 'warning',
      detail: hasStyleReference ? '已选择隐藏风格参考' : '提交前必须选择风格板',
    },
  ]
}

export function getAmazonListingPlannerChecks(
  draft: AmazonPromptDraft,
  size: string,
  referenceImageCount: number,
  hasStyleReference: boolean,
  styleReferenceAppliesToPlan: boolean,
): Array<{ label: string; status: ComplianceStatus; detail: string }> {
  return [
    {
      label: '商品名称',
      status: draft.productTitle.trim() ? 'ready' : 'missing',
      detail: draft.productTitle.trim() ? '已填写' : '等待 AI 从 Listing 解析',
    },
    {
      label: '图片规格',
      status: /^(2048|4096)x(2048|4096)$/.test(size) ? 'ready' : 'warning',
      detail: /4096x4096/.test(size) ? '4K 方图' : /2048x2048/.test(size) ? '2K 方图' : size || '未选择 2K/4K',
    },
    {
      label: '参考图',
      status: referenceImageCount > 0 ? 'ready' : 'warning',
      detail: referenceImageCount > 0 ? `${referenceImageCount} 张产品参考图` : '建议上传产品实拍参考图',
    },
    {
      label: '风格板',
      status: !styleReferenceAppliesToPlan || hasStyleReference ? 'ready' : 'warning',
      detail: !styleReferenceAppliesToPlan
        ? 'MAIN 主图不使用隐藏风格参考'
        : hasStyleReference
          ? '已选择隐藏风格参考'
          : '附图提交前必须选择风格板',
    },
  ]
}
