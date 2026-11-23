import {
  type DragEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  addImageFromFile,
  ensureImageCached,
  ensureImageThumbnailCached,
  submitTask,
  subscribeImageThumbnail,
  useStore,
} from '../store'
import {
  DEFAULT_RESPONSES_MODEL,
  OPENAI_PLANNER_MODELS,
  canApiProfileGenerateImages,
  createSettingsForApiProfile,
  getAmazonPlannerProfile,
  getImageGenerationProfile,
  normalizeSettings,
  validateApiProfile,
} from '../lib/apiProfiles'
import { type AmazonPromptDraft } from '../lib/amazonPrompt'
import {
  buildAmazonAPlusPlanPrompt,
  buildAmazonPlanPrompt,
  buildTiktokPlanPrompt,
  areAPlusModuleSpecsEquivalent,
  formatAPlusModuleText,
  getAPlusContentTypeLabel,
  A_PLUS_CONTENT_TYPES,
  getAPlusModuleDisplayName,
  getAPlusModuleEnglishName,
  getAPlusModuleGenerationSize,
  getAPlusModuleSpecs,
  getAPlusModuleUploadSize,
  insertAPlusModuleSpecAfter,
  isCommerceMainSlot,
  isAmazonListingMainSlot,
  isAPlusTextModule,
  MAX_A_PLUS_MODULE_COUNT,
  MIN_A_PLUS_MODULE_COUNT,
  normalizeAPlusModuleSpecs,
  removeAPlusModuleSpecAt,
  withAPlusGenerationSizes,
  type APlusContentType,
  type AmazonAPlusModuleSpec,
  type AmazonAPlusPlan,
  type AmazonImagePlan,
  type AmazonPlannerMode,
  type AmazonStyleCandidate,
  type AmazonStyleDensityMode,
  type CommercePlannerPlatform,
  type TiktokDesignType,
} from '../lib/listingPlanner'
import type { PlannerApiResult } from '../lib/listingPlannerApi'
import { DEFAULT_AMAZON_MARKETPLACE_ID, type AmazonMarketplaceId } from '../lib/amazonMarketplaces'
import { getAllAmazonPlannerSessions } from '../lib/db'
import { isPlannerTaskFailed, isPlannerTaskPending } from './planner/plannerTaskSafety'
import { normalizeParamsForSettings } from '../lib/paramCompatibility'
import { resolvePlannerStyleReference } from '../lib/plannerActionPolicy'
import { DEFAULT_PARAMS } from '../types'
import type { AmazonPlannerSession, GenerationProject, TaskRecord, TaskWorkflow } from '../types'
import {
  PROJECT_DATA_IMPORTED_EVENT,
  PROJECT_DATA_RESET_EVENT,
  projectSlotId,
  projectTasks,
} from '../lib/generationProjects'
import ProjectResults, { type ProjectFinalChange } from './planner/ProjectResults'
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  EyeIcon,
  PhotoIcon,
  PlusIcon,
  RefreshIcon,
  SparklesIcon,
  TrashIcon,
  UploadCloudIcon,
} from './icons'
import MarkdownRenderer from './MarkdownRenderer'
import PlannerHistoryDrawer from './planner/PlannerHistoryDrawer'
import PlannerHeader from './planner/PlannerHeader'
import PlannerInputPanel from './planner/PlannerInputPanel'
import PlannerProductSummary from './planner/PlannerProductSummary'
import PlannerReferenceImageGrid from './planner/PlannerReferenceImageGrid'
import {
  createAmazonPlannerPlan,
  generatePlannerStyleImages,
  retryPlannerStyleImage,
  useAmazonPlannerController,
} from './planner/useAmazonPlannerController'
import {
  STYLE_DENSITY_OPTIONS,
  createPlannerSessionId,
  fromSessionDraft,
  getAPlusModuleSpecsForSession,
  getActionStepClass,
  getAmazonAPlusComplianceChecks,
  getAmazonListingPlannerChecks,
  getApiModeLabel,
  getGuideFocusClass,
  getGuidePanelClass,
  getImageProfileApiLabel,
  getPlanSummary,
  getPlannerActionKey,
  getPlannerFailureDetail,
  getSessionAPlusModuleSpecsByType,
  getSessionStyleImages,
  getStyleGenerationFailureDetail,
  getStyleImagePlaceholder,
  getStylePreviewPosition,
  isAbortError,
  toSessionDraft,
  upsertStyleImageState,
  type APlusModuleSpecsByType,
  type PlannerActionProgress,
  type PlannerActionProgressMap,
  type PlannerGuideState,
  type PromptEditorState,
  type StyleImageState,
  type StylePreviewState,
  type WorkflowStepStatus,
} from './planner/plannerHelpers'

import { savePlannerWorkspaceDraft, type PlannerWorkspaceDraft } from './planner/plannerWorkspaceDraft'
import {
  createPlannerSessionRestorer,
  mergePlannerSessionHistory,
  type RestoredPlannerSession,
} from './planner/plannerSessionRestore'

const FIELD_CLASS = 'ui-input'
const LABEL_CLASS = 'ui-label'
const PLAN_LIST_CLASS =
  'grid max-h-[420px] gap-2.5 overflow-y-auto overscroll-contain pr-1 custom-scrollbar sm:max-h-[480px]'
const GUIDE_HINT_CLASS = 'ui-callout ui-callout-accent mb-3 text-xs font-medium'
const API_MAX_IMAGES = 16

type PlannerStage = 'details' | 'style' | 'production' | 'results'
const PLANNER_STAGE_ORDER: readonly PlannerStage[] = ['details', 'style', 'production', 'results']

function SlotMiniThumb({ imageId, label }: { imageId: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let canceled = false
    const unsubscribe = subscribeImageThumbnail(imageId, (thumbnail) => {
      if (!canceled) setSrc(thumbnail.dataUrl)
    })
    void ensureImageThumbnailCached(imageId)
      .then((value) => {
        if (!canceled && value) setSrc(value.dataUrl)
      })
      .catch(() => {
        if (!canceled) setSrc(null)
      })
    return () => {
      canceled = true
      unsubscribe()
    }
  }, [imageId])

  if (!src) return null
  return (
    <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-inset)]">
      <img src={src} alt={label} loading="lazy" className="h-full w-full object-cover" />
    </span>
  )
}

export default function AmazonPlanner({
  resultsPanel,
  generationPanel,
  project,
  onWorkspaceChange,
  onBusyChange,
  onFinalChange,
}: {
  resultsPanel: ReactNode
  generationPanel: ReactNode
  project: GenerationProject
  onWorkspaceChange: (workspace: PlannerWorkspaceDraft, referenceImageIds: string[]) => void
  onBusyChange: (busy: boolean) => void
  onFinalChange: ProjectFinalChange
}) {
  const [stage, setStage] = useState<PlannerStage>('details')
  const [isDraggingRefImages, setIsDraggingRefImages] = useState(false)
  const tasks = useStore((s) => s.tasks)
  const params = useStore((s) => s.params)
  const inputImages = useStore((s) => s.inputImages)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setPrompt = useStore((s) => s.setPrompt)
  const setParams = useStore((s) => s.setParams)
  const setPendingTaskCategory = useStore((s) => s.setPendingTaskCategory)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const setInputImages = useStore((s) => s.setInputImages)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const showToast = useStore((s) => s.showToast)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const plannerAbortControllerRef = useRef<AbortController | null>(null)
  const styleAbortControllerRef = useRef<AbortController | null>(null)
  const submissionInFlightRef = useRef(false)
  const contextVersionRef = useRef(0)
  const invalidatePlannerRequests = () => {
    contextVersionRef.current += 1
    plannerAbortControllerRef.current?.abort()
    plannerAbortControllerRef.current = null
    styleAbortControllerRef.current?.abort()
    styleAbortControllerRef.current = null
    setIsPlanning(false)
    setPlanningStage('idle')
    setIsGeneratingStyleImages(false)
    setIsPreparingReferencePayload(false)
    setReferencePayloadNotice('')
  }
  const historyRestoreRef = useRef<ReturnType<typeof createPlannerSessionRestorer> | null>(null)
  useEffect(
    () => () => {
      historyRestoreRef.current?.dispose()
      historyRestoreRef.current = null
    },
    [project.id],
  )
  const styleSectionRef = useRef<HTMLDivElement | null>(null)
  const [workspaceDraft] = useState(() => project.workspace)
  const workspaceSaveErrorRef = useRef(false)
  const [draft, setDraft] = useState<AmazonPromptDraft>(workspaceDraft.draft)
  const [resolution, setResolution] = useState<'2k' | '4k'>(workspaceDraft.resolution)
  const [plannerPlatform, setPlannerPlatform] = useState<CommercePlannerPlatform>(workspaceDraft.plannerPlatform)
  const [marketplaceId, setMarketplaceId] = useState<AmazonMarketplaceId>(workspaceDraft.marketplaceId)
  const [plannerMode, setPlannerMode] = useState<AmazonPlannerMode>(workspaceDraft.plannerMode)
  const [tiktokDesignType, setTiktokDesignType] = useState<TiktokDesignType>(workspaceDraft.tiktokDesignType)
  const [aPlusType, setAPlusType] = useState<APlusContentType>(workspaceDraft.aPlusType)
  const [aPlusModuleSpecsByType, setAPlusModuleSpecsByType] = useState<APlusModuleSpecsByType>(
    workspaceDraft.aPlusModuleSpecsByType,
  )
  const [listingText, setListingText] = useState(workspaceDraft.listingText)
  const [imagePlans, setImagePlans] = useState<AmazonImagePlan[]>(workspaceDraft.imagePlans)
  const [aPlusPlans, setAPlusPlans] = useState<AmazonAPlusPlan[]>(workspaceDraft.aPlusPlans)
  const [seriesStyleGuides, setSeriesStyleGuides] = useState<{
    listing: string
    aplus: string
    tiktokMain: string
    tiktokDetail: string
  }>(workspaceDraft.seriesStyleGuides)
  const [styleCandidates, setStyleCandidates] = useState<AmazonStyleCandidate[]>(workspaceDraft.styleCandidates)
  const [styleImages, setStyleImages] = useState<StyleImageState[]>(workspaceDraft.styleImages)
  const styleImagesRef = useRef<StyleImageState[]>([])
  const [selectedStyleIndex, setSelectedStyleIndex] = useState<number | null>(workspaceDraft.selectedStyleIndex)
  const [styleDensityMode, setStyleDensityMode] = useState<AmazonStyleDensityMode>(workspaceDraft.styleDensityMode)
  const [stylePreview, setStylePreview] = useState<StylePreviewState | null>(null)
  const [isGeneratingStyleImages, setIsGeneratingStyleImages] = useState(false)
  const [styleError, setStyleError] = useState(workspaceDraft.styleError)
  const [selectedPlanIndex, setSelectedPlanIndex] = useState<number | null>(workspaceDraft.selectedPlanIndex)
  const [selectedAPlusPlanIndex, setSelectedAPlusPlanIndex] = useState<number | null>(
    workspaceDraft.selectedAPlusPlanIndex,
  )
  const [plannerSessions, setPlannerSessions] = useState<AmazonPlannerSession[]>([])
  const [currentPlannerSessionId, setCurrentPlannerSessionId] = useState<string | null>(
    workspaceDraft.currentPlannerSessionId,
  )
  const [showPlannerHistory, setShowPlannerHistory] = useState(false)
  const [isPlanning, setIsPlanning] = useState(false)
  const [planningStage, setPlanningStage] = useState<'idle' | 'preparing' | 'requesting' | 'parsing'>('idle')
  const [plannerError, setPlannerError] = useState(workspaceDraft.plannerError)
  const [isPreparingReferencePayload, setIsPreparingReferencePayload] = useState(false)
  const [referencePayloadNotice, setReferencePayloadNotice] = useState('')
  const [actionProgress, setActionProgress] = useState<PlannerActionProgressMap>(workspaceDraft.actionProgress)
  const [batchSelectedIndexes, setBatchSelectedIndexes] = useState<number[]>(workspaceDraft.batchSelectedIndexes)
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingProjectImages, setIsLoadingProjectImages] = useState(false)
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>(workspaceDraft.promptOverrides)
  const [promptEditor, setPromptEditor] = useState<PromptEditorState | null>(workspaceDraft.promptEditor)
  useEffect(() => {
    onBusyChange(
      isPlanning ||
        isGeneratingStyleImages ||
        isBatchSubmitting ||
        isSubmitting ||
        isPreparingReferencePayload ||
        isLoadingProjectImages,
    )
  }, [
    isPlanning,
    isGeneratingStyleImages,
    isBatchSubmitting,
    isSubmitting,
    isPreparingReferencePayload,
    isLoadingProjectImages,
    onBusyChange,
  ])
  useEffect(() => {
    try {
      const nextWorkspace = {
        draft,
        resolution,
        plannerPlatform,
        marketplaceId,
        plannerMode,
        tiktokDesignType,
        aPlusType,
        aPlusModuleSpecsByType,
        listingText,
        imagePlans,
        aPlusPlans,
        seriesStyleGuides,
        styleCandidates,
        styleImages,
        selectedStyleIndex,
        styleDensityMode,
        styleError,
        selectedPlanIndex,
        selectedAPlusPlanIndex,
        currentPlannerSessionId,
        plannerError,
        actionProgress,
        batchSelectedIndexes,
        promptOverrides,
        promptEditor,
      }
      onWorkspaceChange(
        nextWorkspace,
        inputImages.map((image) => image.id),
      )
      savePlannerWorkspaceDraft(nextWorkspace)
      workspaceSaveErrorRef.current = false
    } catch {
      if (!workspaceSaveErrorRef.current) {
        showToast('当前策划自动保存失败，请检查浏览器存储空间。', 'error')
        workspaceSaveErrorRef.current = true
      }
    }
  }, [
    draft,
    resolution,
    plannerPlatform,
    marketplaceId,
    plannerMode,
    tiktokDesignType,
    aPlusType,
    aPlusModuleSpecsByType,
    listingText,
    imagePlans,
    aPlusPlans,
    seriesStyleGuides,
    styleCandidates,
    styleImages,
    selectedStyleIndex,
    styleDensityMode,
    styleError,
    selectedPlanIndex,
    selectedAPlusPlanIndex,
    currentPlannerSessionId,
    plannerError,
    actionProgress,
    batchSelectedIndexes,
    promptOverrides,
    promptEditor,
    inputImages,
    onWorkspaceChange,
    showToast,
  ])

  useEffect(() => {
    let cancelled = false
    const images = workspaceDraft.styleImages.filter((image) => image.status === 'done' && image.imageId)
    void Promise.all(
      images.map(async (image) => ({
        imageId: image.imageId,
        dataUrl: await ensureImageCached(image.imageId!).catch(() => null),
      })),
    ).then((restored) => {
      if (cancelled || !restored.length) return
      const byId = new Map(restored.map((image) => [image.imageId, image.dataUrl]))
      setStyleImages((current) =>
        current.map((image) => {
          if (image.status !== 'done' || image.dataUrl || !byId.has(image.imageId)) return image
          const dataUrl = byId.get(image.imageId)
          return dataUrl
            ? { ...image, dataUrl }
            : { ...image, status: 'error', error: '风格板图片不存在，请重新生成。' }
        }),
      )
    })
    return () => {
      cancelled = true
    }
  }, [workspaceDraft])

  const isPlannerRequestBusy = isPlanning
  const activeWorkflow: TaskWorkflow =
    plannerPlatform === 'tiktok'
      ? tiktokDesignType === 'detail'
        ? 'tiktok-detail'
        : 'tiktok-main'
      : plannerMode === 'aplus'
        ? 'amazon-aplus'
        : 'amazon-listing'
  const getProjectSlotId = (slot: string) =>
    projectSlotId(
      { plannerPlatform, marketplaceId, plannerMode, tiktokDesignType, aPlusType, currentPlannerSessionId },
      slot,
    )
  const getPlanTask = (slot: string) => projectTasks(tasks, project.id, getProjectSlotId(slot)).at(-1)
  const resolutionTier = resolution === '4k' ? '4K' : '2K'
  const aPlusSpecs = useMemo(
    () => normalizeAPlusModuleSpecs(aPlusType, aPlusModuleSpecsByType[aPlusType]),
    [aPlusModuleSpecsByType, aPlusType],
  )
  const aPlusSpecsAreDefault = areAPlusModuleSpecsEquivalent(aPlusSpecs, getAPlusModuleSpecs(aPlusType))
  const aPlusPlansWithSizes = useMemo(
    () => withAPlusGenerationSizes(aPlusPlans, resolutionTier),
    [aPlusPlans, resolutionTier],
  )
  const selectedPlan = selectedPlanIndex == null ? null : (imagePlans[selectedPlanIndex] ?? null)
  const selectedAPlusPlan =
    selectedAPlusPlanIndex == null ? null : (aPlusPlansWithSizes[selectedAPlusPlanIndex] ?? null)
  const selectedAPlusText = selectedAPlusPlan ? formatAPlusModuleText(selectedAPlusPlan) : ''
  const activeSeriesStyleGuide =
    plannerPlatform === 'tiktok'
      ? tiktokDesignType === 'detail'
        ? seriesStyleGuides.tiktokDetail
        : seriesStyleGuides.tiktokMain
      : plannerMode === 'aplus'
        ? seriesStyleGuides.aplus
        : seriesStyleGuides.listing
  const activeStyleCandidates = styleCandidates
  const selectedStyleImage =
    selectedStyleIndex == null
      ? null
      : (styleImages.find((image) => image.candidateIndex === selectedStyleIndex && image.status === 'done') ?? null)
  const selectedStyleCandidate = selectedStyleIndex == null ? null : (activeStyleCandidates[selectedStyleIndex] ?? null)
  const styleLightboxImageIds = useMemo(
    () => styleImages.flatMap((image) => (image.status === 'done' && image.imageId ? [image.imageId] : [])),
    [styleImages],
  )
  const isMainListingPlan = plannerMode === 'listing' && isCommerceMainSlot(plannerPlatform, selectedPlan?.slot)
  const styleReferenceAppliesToPlan = plannerPlatform === 'tiktok' ? true : !isMainListingPlan
  const hasStyleReference = Boolean(selectedStyleImage?.imageId)
  const plannerStyleReference = resolvePlannerStyleReference({
    requiredForSubmit: styleReferenceAppliesToPlan,
    hasStyleReference,
    uploadedReferenceCount: inputImages.length,
    maxUploadedReferences: API_MAX_IMAGES,
  })
  const usesStyleReferenceForActivePlan = plannerStyleReference.attach
  const uploadedReferenceLimitExceeded = plannerStyleReference.issue === 'uploaded-limit'
  const activePrompt =
    plannerMode === 'aplus'
      ? selectedAPlusPlan
        ? buildAmazonAPlusPlanPrompt({
            ...selectedAPlusPlan,
            seriesStyleGuide: activeSeriesStyleGuide,
            styleReferenceAttached: usesStyleReferenceForActivePlan,
            styleDensityMode,
            marketplaceId,
          })
        : ''
      : selectedPlan
        ? (plannerPlatform === 'tiktok' ? buildTiktokPlanPrompt : buildAmazonPlanPrompt)({
            ...selectedPlan,
            seriesStyleGuide: isMainListingPlan ? null : activeSeriesStyleGuide,
            styleReferenceAttached: usesStyleReferenceForActivePlan,
            styleDensityMode,
            marketplaceId,
          })
        : ''
  const activeVisiblePrompt =
    plannerMode === 'aplus'
      ? selectedAPlusPlan
        ? buildAmazonAPlusPlanPrompt({
            ...selectedAPlusPlan,
            seriesStyleGuide: activeSeriesStyleGuide,
            styleReferenceAttached: false,
            styleDensityMode,
            marketplaceId,
          })
        : ''
      : selectedPlan
        ? (plannerPlatform === 'tiktok' ? buildTiktokPlanPrompt : buildAmazonPlanPrompt)({
            ...selectedPlan,
            seriesStyleGuide: isMainListingPlan ? null : activeSeriesStyleGuide,
            styleReferenceAttached: false,
            styleDensityMode,
            marketplaceId,
          })
        : ''
  const plannerProfile = getAmazonPlannerProfile(settings)
  const plannerProfileValidation = plannerProfile
    ? validateApiProfile(plannerProfile)
    : '未选择支持 Chat Completions 或 Responses API 的 AI 策划配置'
  const plannerApiLabel = plannerProfile ? getApiModeLabel(plannerProfile.apiMode) : 'Responses API'
  const plannerModelOptions = [
    ...(plannerProfile?.availableModels ?? []).map((model) => ({ label: model, value: model })),
    ...(plannerProfile?.model &&
    ![...(plannerProfile?.availableModels ?? []), ...OPENAI_PLANNER_MODELS].includes(plannerProfile.model)
      ? [{ label: `${plannerProfile.model}（当前自定义）`, value: plannerProfile.model }]
      : []),
    ...OPENAI_PLANNER_MODELS.filter((model) => !(plannerProfile?.availableModels ?? []).includes(model)).map(
      (model) => ({
        label: model === DEFAULT_RESPONSES_MODEL ? `${model}（默认）` : model,
        value: model,
      }),
    ),
  ]
  const imageGenerationProfile = getImageGenerationProfile(settings)
  const imageGenerationProfileValidation = imageGenerationProfile
    ? validateApiProfile(imageGenerationProfile)
    : '未找到支持 Images API 或 OpenRouter 图片模型的生图配置'
  const listingTargetSize = resolution === '4k' ? '4096x4096' : '2048x2048'
  const targetSize =
    plannerPlatform === 'tiktok'
      ? tiktokDesignType === 'detail'
        ? resolution === '4k'
          ? '2880x3840'
          : '1536x2048'
        : listingTargetSize
      : plannerMode === 'aplus' && selectedAPlusPlan
        ? selectedAPlusPlan.generationSize
        : listingTargetSize
  const generationParamLabel = `${DEFAULT_PARAMS.output_format.toUpperCase()} / ${DEFAULT_PARAMS.quality} / 压缩率${DEFAULT_PARAMS.output_compression}`
  const visiblePlanCount = plannerMode === 'aplus' ? aPlusPlansWithSizes.length : imagePlans.length
  const visiblePlanIndex = plannerMode === 'aplus' ? selectedAPlusPlanIndex : selectedPlanIndex
  const actionSlot = plannerMode === 'aplus' ? selectedAPlusPlan?.slot : selectedPlan?.slot
  const actionLabel = plannerMode === 'aplus' ? selectedAPlusPlan?.label : selectedPlan?.label
  const showStickyActions = plannerMode === 'aplus' ? aPlusPlansWithSizes.length > 0 : imagePlans.length > 0
  const actionDisabled = plannerMode === 'aplus' ? !selectedAPlusPlan : !activePrompt.trim()
  const currentSlotRunning = Boolean(
    actionSlot && projectTasks(tasks, project.id, getProjectSlotId(actionSlot)).some(isPlannerTaskPending),
  )
  const submitDisabled =
    actionDisabled || isSubmitting || isBatchSubmitting || isLoadingProjectImages || currentSlotRunning
  const hasPendingSlotTask = (slot: string) =>
    projectTasks(useStore.getState().tasks, project.id, getProjectSlotId(slot)).some(isPlannerTaskPending)
  const hasPlanOptions = visiblePlanCount > 0
  const hasSelectedPlan = plannerMode === 'aplus' ? Boolean(selectedAPlusPlan) : Boolean(selectedPlan)
  const canGoPrev = visiblePlanCount > 0 && visiblePlanIndex != null && visiblePlanIndex > 0
  const canGoNext = visiblePlanCount > 0 && visiblePlanIndex != null && visiblePlanIndex < visiblePlanCount - 1
  const actionPositionLabel =
    visiblePlanCount > 0 && visiblePlanIndex != null
      ? `${visiblePlanIndex + 1}/${visiblePlanCount}`
      : plannerMode === 'aplus'
        ? `${aPlusSpecs.length} 个待策划模块`
        : '未选择'
  const currentActionKey = getPlannerActionKey(plannerMode, visiblePlanIndex, actionSlot)
  const currentActionProgress = currentActionKey ? (actionProgress[currentActionKey] ?? null) : null
  const currentActionFilled = currentActionProgress === 'filled' || currentActionProgress === 'submitted'
  const currentActionSubmitted = currentActionProgress === 'submitted'
  const actionKindLabel = plannerMode === 'aplus' ? '模块' : isMainListingPlan ? '主图' : '图片'
  const actionGuidance = !hasSelectedPlan
    ? plannerMode === 'aplus'
      ? '先选择一个 A+ 模块'
      : '先选择一个图片位'
    : currentActionSubmitted
      ? `已提交 ${actionSlot ?? '当前'} ${actionKindLabel}，${canGoNext ? '点击下一张继续' : '已是最后一张'}`
      : plannerStyleReference.issue === 'missing'
        ? `当前 ${actionSlot ?? ''} ${actionKindLabel}提交前必须先选择风格板`
        : plannerStyleReference.issue === 'uploaded-limit'
          ? `上传参考图超过 ${API_MAX_IMAGES} 张上限，请先删除多余参考图`
          : currentActionFilled
            ? '已准备好隐藏生图提示词，下一步提交生成'
            : `先准备当前 ${actionSlot ?? '当前'} ${actionKindLabel}生图提示词`
  const mainStyleGuidance = isMainListingPlan
    ? hasStyleReference
      ? 'MAIN 主图不附加风格板；附图和 A+ 会使用已选风格。'
      : 'MAIN 主图不附加风格板；附图和 A+ 可先生成并选择风格板。'
    : ''
  const actionProgressSteps = [
    {
      label: '1 准备',
      detail: currentActionFilled ? '已准备' : '待准备',
      status: currentActionFilled ? 'done' : 'current',
    },
    {
      label: '2 提交生成',
      detail: currentActionSubmitted
        ? '已提交'
        : plannerStyleReference.issue === 'missing'
          ? '需风格板'
          : plannerStyleReference.issue === 'uploaded-limit'
            ? '参考图超限'
            : currentActionFilled
              ? '下一步'
              : '待提交',
      status: currentActionSubmitted ? 'done' : currentActionFilled ? 'current' : 'todo',
    },
    {
      label: '3 下一张',
      detail: currentActionSubmitted ? (canGoNext ? '继续下一张' : '最后一张') : '提交后继续',
      status: currentActionSubmitted ? (canGoNext ? 'current' : 'done') : 'todo',
    },
  ] satisfies Array<{ label: string; detail: string; status: WorkflowStepStatus }>
  const hasListingText = Boolean(listingText.trim())
  const hasUsablePlannerProfile = Boolean(plannerProfile && !plannerProfileValidation)
  const hasGeneratedStyleImages = styleImages.some((image) => image.status === 'done')
  const hasRunningStyleImages = styleImages.some((image) => image.status === 'running')
  const seriesStyleReferenceNeeded =
    plannerPlatform === 'tiktok'
      ? hasPlanOptions
      : plannerMode === 'aplus'
        ? hasPlanOptions
        : imagePlans.some((plan) => !isAmazonListingMainSlot(plan.slot))
  const guideState: PlannerGuideState = !hasUsablePlannerProfile
    ? {
        target: 'planner-api',
        message: plannerProfileValidation
          ? `下一步：先配置 AI 策划 API（${plannerProfileValidation}）`
          : '下一步：先配置 AI 策划 API',
      }
    : !hasListingText
      ? {
          target: 'planner-input',
          message: plannerMode === 'aplus' ? '下一步：粘贴标题、五点描述或品牌说明' : '下一步：粘贴标题和五点描述',
        }
      : !hasPlanOptions
        ? {
            target: 'planner-action',
            message: plannerMode === 'aplus' ? '下一步：点击 AI策划A+ 生成模块方案' : '下一步：点击 AI策划生成逐张方案',
          }
        : !hasSelectedPlan
          ? {
              target: 'plan-list',
              message: plannerMode === 'aplus' ? '下一步：选择要生成的 A+ 模块' : '下一步：选择要生成的图片位',
            }
          : seriesStyleReferenceNeeded && !hasStyleReference
            ? {
                target: hasGeneratedStyleImages ? 'style-choice' : 'style',
                message: hasGeneratedStyleImages
                  ? '下一步：选择一张风格板后再提交当前图片'
                  : hasRunningStyleImages
                    ? '风格板正在生成，完成后选择一张再提交'
                    : '下一步：生成并选择一张风格板，统一附图视觉',
              }
            : {
                target: 'action-bar',
                message: currentActionSubmitted
                  ? canGoNext
                    ? '下一步：点击下一张继续处理'
                    : '当前图片已提交，已是最后一张'
                  : currentActionFilled
                    ? '下一步：提交生成当前图片'
                    : `下一步：准备当前 ${actionSlot ?? '当前'} ${actionKindLabel}生图提示词`,
              }
  const plannerGuideActive =
    guideState.target === 'planner-api' ||
    guideState.target === 'planner-input' ||
    guideState.target === 'planner-action'
  const styleGuideActive = guideState.target === 'style' || guideState.target === 'style-choice'
  const planListGuideActive = guideState.target === 'plan-list'
  const actionBarGuideActive = guideState.target === 'action-bar'
  const checks =
    plannerMode === 'aplus'
      ? getAmazonAPlusComplianceChecks(
          draft,
          selectedAPlusPlan,
          aPlusType,
          inputImages.length,
          usesStyleReferenceForActivePlan,
        )
      : getAmazonListingPlannerChecks(
          draft,
          targetSize,
          inputImages.length,
          usesStyleReferenceForActivePlan,
          styleReferenceAppliesToPlan,
        )
  const atImageLimit = inputImages.length >= API_MAX_IMAGES

  const { savePlannerSession, updateCurrentPlannerSession, deletePlannerSessionHistory } = useAmazonPlannerController(
    {
      currentPlannerSessionId,
      plannerSessions,
      draft,
      listingText,
      plannerPlatform,
      marketplaceId,
      tiktokDesignType,
      plannerMode,
      aPlusType,
      aPlusModuleSpecsByType,
      resolution,
      referenceImageIds: inputImages.map((image) => image.id),
      seriesStyleGuides,
      styleCandidates,
      styleImages,
      selectedStyleIndex,
      styleDensityMode,
      imagePlans,
      aPlusPlans: aPlusPlansWithSizes,
      selectedPlanIndex,
      selectedAPlusPlanIndex,
    },
    setPlannerSessions,
    showToast,
  )

  useEffect(() => {
    let cancelled = false
    let requestId = 0
    const refreshHistory = () => {
      const id = ++requestId
      void getAllAmazonPlannerSessions()
        .then((sessions) => {
          if (!cancelled && id === requestId) {
            setPlannerSessions((current) => mergePlannerSessionHistory(current, sessions))
          }
        })
        .catch((err) => {
          if (!cancelled && id === requestId)
            showToast(`策划历史加载失败：${err instanceof Error ? err.message : String(err)}`, 'error')
        })
    }
    refreshHistory()
    window.addEventListener(PROJECT_DATA_IMPORTED_EVENT, refreshHistory)
    return () => {
      cancelled = true
      window.removeEventListener(PROJECT_DATA_IMPORTED_EVENT, refreshHistory)
    }
  }, [showToast])

  useEffect(() => {
    const stopPendingPlannerWork = () => {
      contextVersionRef.current += 1
      historyRestoreRef.current?.dispose()
      historyRestoreRef.current = null
      plannerAbortControllerRef.current?.abort()
      plannerAbortControllerRef.current = null
      styleAbortControllerRef.current?.abort()
      styleAbortControllerRef.current = null
    }
    window.addEventListener(PROJECT_DATA_RESET_EVENT, stopPendingPlannerWork)
    return () => {
      window.removeEventListener(PROJECT_DATA_RESET_EVENT, stopPendingPlannerWork)
      stopPendingPlannerWork()
    }
  }, [])

  useEffect(() => {
    setReferencePayloadNotice('')
  }, [inputImages])

  useEffect(() => {
    styleImagesRef.current = styleImages
  }, [styleImages])

  const clearStyleBoardImages = (persist = false) => {
    styleImagesRef.current = []
    setStyleImages([])
    setSelectedStyleIndex(null)
    setStylePreview(null)
    setStyleError('')
    if (persist) {
      updateCurrentPlannerSession({
        styleImages: [],
        selectedStyleIndex: null,
      })
    }
  }

  const markActionProgress = (key: string, progress: PlannerActionProgress) => {
    if (!key) return
    setActionProgress((current) => ({
      ...current,
      [key]: progress,
    }))
  }

  const getCurrentEditedPrompt = () => (currentActionKey ? (promptOverrides[currentActionKey]?.trim() ?? '') : '')

  const getCurrentSubmitPrompt = () => getCurrentEditedPrompt() || activePrompt.trim()

  const openPromptEditor = () => {
    if (!activePrompt.trim()) {
      showToast(plannerMode === 'aplus' ? '请先 AI 策划并选择一个 A+ 模块' : '请先 AI 策划并选择一个图片位', 'error')
      return
    }
    setPromptEditor({
      actionKey: currentActionKey,
      title: `${plannerMode === 'aplus' ? 'A+ 模块' : '图片位'}提示词${actionSlot ? ` · ${actionSlot}` : ''}`,
      value: currentActionKey ? (promptOverrides[currentActionKey] ?? activePrompt) : activePrompt,
    })
  }

  const savePromptEditor = () => {
    if (!promptEditor) return
    const value = promptEditor.value.trim()
    if (!value) {
      showToast('提示词不能为空', 'error')
      return
    }
    setPromptOverrides((current) => ({
      ...current,
      [promptEditor.actionKey]: value,
    }))
    setPromptEditor(null)
    showToast('当前图片位提示词已保存', 'success')
  }

  const applyPrompt = (options: { requireStyle?: boolean } = {}) => {
    if (submissionInFlightRef.current || isLoadingProjectImages) return false
    if (plannerMode === 'aplus' && !selectedAPlusPlan) {
      showToast('请先 AI 策划并选择一个 A+ 模块', 'error')
      return false
    }
    if (!activePrompt.trim()) {
      showToast(plannerMode === 'aplus' ? '请先 AI 策划并选择一个 A+ 模块' : '请先 AI 策划并选择一个图片位', 'error')
      return false
    }
    if (options.requireStyle && plannerStyleReference.issue === 'missing') {
      showToast('当前图片必须先生成并选择一张风格板，选择后才能提交生成。', 'error')
      styleSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return false
    }
    if (options.requireStyle && plannerStyleReference.issue === 'uploaded-limit') {
      showToast(`上传参考图不能超过 ${API_MAX_IMAGES} 张，请删除多余参考图后再提交。`, 'error')
      styleSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return false
    }
    const hiddenSubmitPrompt = getCurrentSubmitPrompt()
    setPrompt('')
    setPendingTaskCategory({
      mode: 'prompt-match',
      prompt: '',
      apiPrompt: hiddenSubmitPrompt,
      category: {
        projectId: project.id,
        projectSlotId: getProjectSlotId((plannerMode === 'aplus' ? selectedAPlusPlan?.slot : selectedPlan?.slot) ?? ''),
        productTitle: draft.productTitle.trim(),
        workflow:
          plannerPlatform === 'tiktok'
            ? `tiktok-${tiktokDesignType}`
            : plannerMode === 'aplus'
              ? 'amazon-aplus'
              : 'amazon-listing',
        amazonSlot: plannerMode === 'aplus' ? selectedAPlusPlan?.slot : selectedPlan?.slot,
        ...(plannerPlatform === 'amazon' ? { marketplaceId } : {}),
        ...(plannerPlatform === 'tiktok' ? { platform: 'tiktok', tiktokDesignType } : {}),
        ...(plannerMode === 'aplus' ? { aPlusType } : {}),
        ...(usesStyleReferenceForActivePlan && selectedStyleImage?.imageId
          ? { styleReferenceImageId: selectedStyleImage.imageId }
          : {}),
      },
    })
    setParams({
      size: targetSize,
      quality: DEFAULT_PARAMS.quality,
      output_format: DEFAULT_PARAMS.output_format,
      output_compression: DEFAULT_PARAMS.output_compression,
      n: 1,
    })
    markActionProgress(currentActionKey, 'filled')
    showToast(
      plannerPlatform === 'tiktok'
        ? '已准备 TikTok 商品图隐藏提示词'
        : plannerMode === 'aplus'
          ? '已准备 A+ 图片隐藏提示词'
          : '已准备亚马逊图片隐藏提示词',
      'success',
    )
    return true
  }

  const applyAndSubmit = async () => {
    if (submissionInFlightRef.current || submitDisabled || !actionSlot || hasPendingSlotTask(actionSlot)) return
    if (!applyPrompt({ requireStyle: true })) return
    submissionInFlightRef.current = true
    const contextVersion = contextVersionRef.current
    const submittedActionKey = currentActionKey
    setIsSubmitting(true)
    try {
      if ((await submitTask()) && contextVersionRef.current === contextVersion) {
        markActionProgress(submittedActionKey, 'submitted')
      }
    } catch (error) {
      if (contextVersionRef.current === contextVersion) showToast(String(error), 'error')
    } finally {
      submissionInFlightRef.current = false
      setIsSubmitting(false)
    }
  }

  const toggleBatchPlan = (index: number) => {
    setBatchSelectedIndexes((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort((a, b) => a - b),
    )
  }

  const selectAllBatchPlans = () => {
    const count = plannerMode === 'aplus' ? aPlusPlansWithSizes.length : imagePlans.length
    setBatchSelectedIndexes((current) => (current.length === count ? [] : Array.from({ length: count }, (_, i) => i)))
  }

  const selectFailedBatchPlans = () => {
    const plans = plannerMode === 'aplus' ? aPlusPlansWithSizes : imagePlans
    setBatchSelectedIndexes(
      plans.flatMap((plan, index) =>
        !hasPendingSlotTask(plan.slot) && isPlannerTaskFailed(getPlanTask(plan.slot)) ? [index] : [],
      ),
    )
  }

  const submitBatchPlans = async () => {
    if (submissionInFlightRef.current || isLoadingProjectImages) return
    // 空选择代表不提交，只有用户点击全选才会覆盖全部图片位。
    const indexes = [...new Set(batchSelectedIndexes)]
    if (!indexes.length) {
      showToast('请先选择要批量生成的图片位', 'error')
      return
    }
    if (inputImages.length > API_MAX_IMAGES) {
      showToast(`上传参考图不能超过 ${API_MAX_IMAGES} 张`, 'error')
      return
    }

    const originalInputImages = [...useStore.getState().inputImages]
    submissionInFlightRef.current = true
    const contextVersion = contextVersionRef.current
    setIsBatchSubmitting(true)
    let submitted = 0
    try {
      for (const index of indexes) {
        if (contextVersionRef.current !== contextVersion) break
        const plan = plannerMode === 'aplus' ? aPlusPlansWithSizes[index] : imagePlans[index]
        if (!plan || hasPendingSlotTask(plan.slot)) continue
        const isMain = plannerMode === 'listing' && isCommerceMainSlot(plannerPlatform, plan.slot)
        const needsStyle = plannerPlatform === 'tiktok' || plannerMode === 'aplus' || !isMain
        if (needsStyle && !selectedStyleImage?.imageId) {
          showToast(`「${plan.slot}」需要先选择风格板`, 'error')
          continue
        }
        const actionKey = getPlannerActionKey(plannerMode, index, plan.slot)
        const prompt =
          promptOverrides[actionKey]?.trim() ||
          (plannerMode === 'aplus'
            ? buildAmazonAPlusPlanPrompt({
                ...plan,
                seriesStyleGuide: activeSeriesStyleGuide,
                styleReferenceAttached: needsStyle,
                styleDensityMode,
                marketplaceId,
              })
            : (plannerPlatform === 'tiktok' ? buildTiktokPlanPrompt : buildAmazonPlanPrompt)({
                ...plan,
                seriesStyleGuide: isMain ? null : activeSeriesStyleGuide,
                styleReferenceAttached: needsStyle,
                styleDensityMode,
                marketplaceId,
              }))
        const category: NonNullable<TaskRecord['category']> = {
          projectId: project.id,
          projectSlotId: getProjectSlotId(plan.slot),
          productTitle: draft.productTitle.trim(),
          workflow: activeWorkflow,
          amazonSlot: plan.slot,
          ...(plannerPlatform === 'amazon' ? { marketplaceId } : {}),
          ...(plannerPlatform === 'tiktok' ? { platform: 'tiktok' as const, tiktokDesignType } : {}),
          ...(plannerMode === 'aplus' ? { aPlusType } : {}),
          ...(needsStyle && selectedStyleImage?.imageId ? { styleReferenceImageId: selectedStyleImage.imageId } : {}),
        }
        const state = useStore.getState()
        useStore.setState({
          prompt: '',
          inputImages: originalInputImages,
          params: {
            ...state.params,
            size: plannerMode === 'aplus' ? (plan as AmazonAPlusPlan).generationSize : targetSize,
            n: 1,
          },
          pendingTaskCategory: { mode: 'prompt-match', prompt: '', apiPrompt: prompt, category },
        })
        if ((await submitTask()) && contextVersionRef.current === contextVersion) {
          markActionProgress(actionKey, 'submitted')
          submitted += 1
        }
      }
      if (contextVersionRef.current === contextVersion) {
        showToast(`已提交 ${submitted} 个图片任务`, submitted ? 'success' : 'error')
        setBatchSelectedIndexes([])
      }
    } catch (error) {
      if (contextVersionRef.current === contextVersion) showToast(`批量提交失败：${String(error)}`, 'error')
    } finally {
      if (contextVersionRef.current === contextVersion) useStore.setState({ inputImages: originalInputImages })
      submissionInFlightRef.current = false
      setIsBatchSubmitting(false)
    }
  }

  const copyPrompt = async () => {
    if (plannerMode === 'aplus' && !selectedAPlusPlan) {
      showToast('请先 AI 策划并选择一个 A+ 模块', 'error')
      return
    }
    if (!activePrompt.trim()) {
      showToast(plannerMode === 'aplus' ? '请先 AI 策划并选择一个 A+ 模块' : '请先 AI 策划并选择一个图片位', 'error')
      return
    }

    try {
      await navigator.clipboard.writeText(getCurrentEditedPrompt() || activeVisiblePrompt.trim() || activePrompt)
      showToast('提示词已复制', 'success')
    } catch {
      showToast('复制失败，请手动选择提示词', 'error')
    }
  }

  const copyAPlusText = async () => {
    if (!selectedAPlusText.trim()) {
      showToast('当前 A+ 模块没有可复制文案', 'error')
      return
    }

    try {
      await navigator.clipboard.writeText(selectedAPlusText)
      showToast('A+ 文案已复制', 'success')
    } catch {
      showToast('复制失败，请手动选择文案', 'error')
    }
  }

  const getReadyStyleImageSettings = () => {
    const normalizedSettings = normalizeSettings(settings)
    const imageProfile = getImageGenerationProfile(settings)
    if (!imageProfile) {
      setConfirmDialog({
        title: '缺少生图配置',
        message:
          '没有找到支持 Images API 或 OpenRouter 图片模型的生图配置。\n\n请在设置 -> API 中新增或完善一个生图配置，保存后这里会自动使用，不需要手动切换当前配置。',
        confirmText: '去配置',
        cancelText: '取消',
        action: () => {
          setShowSettings(true, 'api')
        },
      })
      return null
    }
    const imageProfileValidation = validateApiProfile(imageProfile)
    if (imageProfileValidation) {
      setConfirmDialog({
        title: '生图配置不完整',
        message: `已找到生图配置「${imageProfile.name}」，但还缺少：${imageProfileValidation}。\n\n完善并保存后，风格板会自动使用该配置生成。`,
        confirmText: '去完善配置',
        cancelText: '取消',
        action: () => {
          setShowSettings(true, 'api')
        },
      })
      return null
    }
    if (!canApiProfileGenerateImages(imageProfile)) {
      const apiModeLabel = imageProfile.apiMode === 'responses' ? 'Responses API' : 'Chat Completions'
      setConfirmDialog({
        title: '当前配置不能生图',
        message: `当前配置「${imageProfile.name}」使用 ${apiModeLabel}，普通生图只支持 Images API，OpenRouter 图片模型可使用 Chat Completions。生成风格板前，请切换到生图配置。`,
        confirmText: '去切换配置',
        cancelText: '取消',
        action: () => {
          setShowSettings(true, 'api')
        },
      })
      return null
    }

    return createSettingsForApiProfile(normalizedSettings, imageProfile)
  }

  const runGenerateStyleImages = async () => {
    if (styleAbortControllerRef.current) {
      showToast('风格板正在生成中', 'info')
      return
    }
    if (!activeStyleCandidates.length) {
      showToast('请先完成 AI 策划，再生成风格板', 'error')
      return
    }

    const imageSettings = getReadyStyleImageSettings()
    if (!imageSettings) return

    const controller = new AbortController()
    styleAbortControllerRef.current = controller
    setIsGeneratingStyleImages(true)
    setStyleError('')
    setSelectedStyleIndex(null)
    setStylePreview(null)
    const initialStyleImages: StyleImageState[] = activeStyleCandidates.map((_, index) => ({
      candidateIndex: index,
      status: 'running',
    }))
    styleImagesRef.current = initialStyleImages
    setStyleImages(initialStyleImages)

    const styleParams = normalizeParamsForSettings(
      {
        size: '1024x1024',
        quality: DEFAULT_PARAMS.quality,
        output_format: DEFAULT_PARAMS.output_format,
        output_compression: DEFAULT_PARAMS.output_compression,
        moderation: params.moderation,
        n: 1,
      },
      imageSettings,
      { hasInputImages: inputImages.length > 0 },
    )

    try {
      setIsPreparingReferencePayload(inputImages.length > 0)
      setReferencePayloadNotice('')
      const workflow = await generatePlannerStyleImages({
        settings: imageSettings,
        candidates: activeStyleCandidates,
        seriesStyleGuide: activeSeriesStyleGuide,
        params: styleParams,
        referenceImageDataUrls: inputImages.map((image) => image.dataUrl),
        signal: controller.signal,
      })
      if (styleAbortControllerRef.current !== controller) return
      setReferencePayloadNotice(workflow.referencePayloadNotice)
      const nextStyleImages = workflow.styleImages
      styleImagesRef.current = nextStyleImages
      setStyleImages(nextStyleImages)

      const failed = nextStyleImages.filter((image) => image.status === 'error')
      updateCurrentPlannerSession({
        styleImages: getSessionStyleImages(nextStyleImages),
        selectedStyleIndex: null,
      })
      if (failed.length === activeStyleCandidates.length) {
        const message = failed[0]?.error || '风格板生成失败'
        setStyleError(message)
        showToast('风格板生成失败，请查看详情', 'error')
        return
      }
      if (failed.length > 0) {
        setStyleError(`${failed.length} 张风格板生成失败，可先选择已成功的风格板。`)
        showToast('部分风格板生成失败', 'error')
        return
      }
      showToast('风格板已生成，请选择一个视觉风格', 'success')
    } catch (err) {
      if (styleAbortControllerRef.current !== controller || isAbortError(err) || controller.signal.aborted) return
      const message = getStyleGenerationFailureDetail(err)
      const failedStyleImages: StyleImageState[] = activeStyleCandidates.map((_, index) => ({
        candidateIndex: index,
        status: 'error',
        error: message,
      }))
      styleImagesRef.current = failedStyleImages
      setStyleImages(failedStyleImages)
      updateCurrentPlannerSession({
        styleImages: getSessionStyleImages(failedStyleImages),
        selectedStyleIndex: null,
      })
      setStyleError(message)
      showToast('风格板生成失败，请查看详情', 'error')
    } finally {
      if (styleAbortControllerRef.current === controller) {
        setIsPreparingReferencePayload(false)
        styleAbortControllerRef.current = null
        setIsGeneratingStyleImages(false)
      }
    }
  }

  const retryStyleCandidateImage = async (candidateIndex: number) => {
    if (styleAbortControllerRef.current) {
      showToast('风格板正在生成中', 'info')
      return
    }
    const candidate = activeStyleCandidates[candidateIndex]
    if (!candidate) {
      showToast('风格候选不存在，请重新 AI 策划', 'error')
      return
    }

    const imageSettings = getReadyStyleImageSettings()
    if (!imageSettings) return

    const controller = new AbortController()
    styleAbortControllerRef.current = controller
    setIsGeneratingStyleImages(true)
    setStyleError('')
    setStylePreview(null)
    setStyleImages((current) => {
      const next = upsertStyleImageState(current, { candidateIndex, status: 'running' })
      styleImagesRef.current = next
      return next
    })

    const styleParams = normalizeParamsForSettings(
      {
        size: '1024x1024',
        quality: DEFAULT_PARAMS.quality,
        output_format: DEFAULT_PARAMS.output_format,
        output_compression: DEFAULT_PARAMS.output_compression,
        moderation: params.moderation,
        n: 1,
      },
      imageSettings,
      { hasInputImages: inputImages.length > 0 },
    )

    try {
      setIsPreparingReferencePayload(inputImages.length > 0)
      setReferencePayloadNotice('')
      const workflow = await retryPlannerStyleImage({
        settings: imageSettings,
        candidate,
        candidateIndex,
        seriesStyleGuide: activeSeriesStyleGuide,
        params: styleParams,
        referenceImageDataUrls: inputImages.map((image) => image.dataUrl),
        signal: controller.signal,
      })
      if (styleAbortControllerRef.current !== controller) return
      setReferencePayloadNotice(workflow.referencePayloadNotice)
      const nextStyleImages = upsertStyleImageState(styleImagesRef.current, workflow.styleImage)
      styleImagesRef.current = nextStyleImages
      setStyleImages(nextStyleImages)
      const failed = nextStyleImages.filter((image) => image.status === 'error')
      setStyleError(failed.length > 0 ? `${failed.length} 张风格板生成失败，可先选择已成功的风格板。` : '')
      updateCurrentPlannerSession({
        styleImages: getSessionStyleImages(nextStyleImages),
        selectedStyleIndex,
      })
      showToast('风格板重试成功，已更新原位置', 'success')
    } catch (err) {
      if (styleAbortControllerRef.current !== controller || isAbortError(err) || controller.signal.aborted) return
      const message = getStyleGenerationFailureDetail(err)
      const nextStyleImages = upsertStyleImageState(styleImagesRef.current, {
        candidateIndex,
        status: 'error',
        error: message,
      })
      styleImagesRef.current = nextStyleImages
      setStyleImages(nextStyleImages)
      const failed = nextStyleImages.filter((image) => image.status === 'error')
      setStyleError(failed.length > 0 ? message : '')
      updateCurrentPlannerSession({
        styleImages: getSessionStyleImages(nextStyleImages),
        selectedStyleIndex,
      })
      showToast('风格板重试失败，请查看详情', 'error')
    } finally {
      if (styleAbortControllerRef.current === controller) {
        setIsPreparingReferencePayload(false)
        styleAbortControllerRef.current = null
        setIsGeneratingStyleImages(false)
      }
    }
  }

  const confirmGenerateStyleImages = () => {
    if (styleAbortControllerRef.current) {
      showToast('风格板正在生成中', 'info')
      return
    }
    if (!activeStyleCandidates.length) {
      showToast('请先完成 AI 策划，再生成风格板', 'error')
      return
    }

    const imageProfile = getImageGenerationProfile(settings)
    if (!imageProfile) {
      setConfirmDialog({
        title: '缺少生图配置',
        message:
          '没有找到支持 Images API 或 OpenRouter 图片模型的生图配置。\n\n请在设置 -> API 中新增或完善一个生图配置，保存后这里会自动使用，不需要手动切换当前配置。',
        confirmText: '去配置',
        cancelText: '取消',
        action: () => {
          setShowSettings(true, 'api')
        },
      })
      return
    }

    const validation = validateApiProfile(imageProfile)
    if (validation) {
      setConfirmDialog({
        title: '生图配置不完整',
        message: `已找到生图配置「${imageProfile.name}」，但还缺少：${validation}。\n\n完善并保存后，风格板会自动使用该配置生成。`,
        confirmText: '去完善配置',
        cancelText: '取消',
        action: () => {
          setShowSettings(true, 'api')
        },
      })
      return
    }

    setConfirmDialog({
      title: '确认生成风格板',
      icon: 'info',
      message: [
        `即将生成 ${activeStyleCandidates.length} 张低清风格参考板，用于统一后续商品图视觉。`,
        '候选来源：AI 策划返回的风格候选',
        `生图配置：${imageProfile.name}`,
        `模型：${imageProfile.model}`,
        `接口：${getImageProfileApiLabel(imageProfile)}`,
        `参考图：${inputImages.length} 张`,
        `尺寸：1024x1024；参数：${generationParamLabel}`,
        '确认后会调用外部 API，可能消耗额度并等待一段时间。',
      ].join('\n'),
      confirmText: '开始生成',
      cancelText: '取消',
      action: () => {
        void runGenerateStyleImages()
      },
    })
  }

  const stopGeneratingStyleImages = () => {
    const controller = styleAbortControllerRef.current
    if (!controller) return
    controller.abort(new DOMException('风格板生成已停止', 'AbortError'))
    styleAbortControllerRef.current = null
    setIsGeneratingStyleImages(false)
    setStylePreview(null)
    setStyleError('')
    setStyleImages((current) => {
      const next: StyleImageState[] = current.map((image): StyleImageState =>
        image.status === 'running' ? { ...image, status: 'stopped', error: '已停止' } : image,
      )
      styleImagesRef.current = next
      return next
    })
    showToast('风格板生成已停止', 'info')
  }

  const applyPlannerResult = (result: PlannerApiResult, sourceLabel: string) => {
    invalidatePlannerRequests()
    setBatchSelectedIndexes([])
    const firstPlan = result.plans[0]
    const nextDraft = {
      ...draft,
      ...result.parsed.inferred,
      productTitle: result.parsed.title || draft.productTitle,
      sellingPoints: result.parsed.bullets.length ? result.parsed.bullets.join('\n') : draft.sellingPoints,
      ...(firstPlan?.kind ? { kind: firstPlan.kind } : {}),
    }
    const seriesStyleGuideKey =
      plannerPlatform === 'tiktok'
        ? tiktokDesignType === 'detail'
          ? 'tiktokDetail'
          : 'tiktokMain'
        : result.mode === 'aplus'
          ? 'aplus'
          : 'listing'
    const nextSeriesStyleGuides = {
      ...seriesStyleGuides,
      [seriesStyleGuideKey]: result.seriesStyleGuide,
    }
    const nextImagePlans = result.mode === 'listing' ? result.plans : []
    const nextAPlusPlans = result.mode === 'aplus' ? withAPlusGenerationSizes(result.aPlusPlans, resolutionTier) : []
    const nextSelectedPlanIndex = result.mode === 'listing' && result.plans.length ? 0 : null
    const nextSelectedAPlusPlanIndex = result.mode === 'aplus' && result.aPlusPlans.length ? 0 : null

    setDraft(nextDraft)
    if (result.mode === 'aplus') {
      setAPlusPlans(nextAPlusPlans)
      setImagePlans([])
      setSelectedAPlusPlanIndex(nextSelectedAPlusPlanIndex)
      setSelectedPlanIndex(null)
    } else {
      setImagePlans(nextImagePlans)
      setAPlusPlans([])
      setSelectedPlanIndex(nextSelectedPlanIndex)
      setSelectedAPlusPlanIndex(null)
    }
    setSeriesStyleGuides(nextSeriesStyleGuides)
    setStyleCandidates(result.styleCandidates)
    setPromptOverrides({})
    setPromptEditor(null)
    clearStyleBoardImages(false)
    setPlannerError('')
    setActionProgress({})
    const nextSessionId = createPlannerSessionId()
    setCurrentPlannerSessionId(nextSessionId)
    void savePlannerSession({
      id: nextSessionId,
      platform: plannerPlatform,
      marketplaceId,
      tiktokDesignType,
      mode: result.mode,
      draft: toSessionDraft(nextDraft),
      seriesStyleGuides: nextSeriesStyleGuides,
      styleCandidates: result.styleCandidates,
      styleImages: [],
      selectedStyleIndex: null,
      styleDensityMode,
      imagePlans: nextImagePlans,
      aPlusPlans: nextAPlusPlans,
      selectedPlanIndex: nextSelectedPlanIndex,
      selectedAPlusPlanIndex: nextSelectedAPlusPlanIndex,
    }).catch((err) => {
      showToast(`策划历史保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    })
    showToast(
      `${sourceLabel}已生成 ${result.mode === 'aplus' ? result.aPlusPlans.length : result.plans.length} 张图片策划`,
      'success',
    )
  }

  const runCreateAiPlan = async () => {
    if (plannerAbortControllerRef.current) {
      showToast('AI 策划正在进行中', 'info')
      return
    }
    if (!listingText.trim()) {
      showToast('请先粘贴标题和五点描述', 'error')
      return
    }

    if (!plannerProfile) {
      setPlannerError(
        '未选择支持 Chat Completions 或 Responses API 的 AI 策划配置。\n\n请在设置 -> API 中创建或选择一个 Chat Completions 配置，例如 DeepSeek 文本模型；生图配置继续使用 Images API，不要把 gpt-image-2 用作策划模型。',
      )
      showToast('AI 策划配置缺失', 'error')
      return
    }
    if (plannerProfileValidation) {
      setPlannerError(`AI 策划配置「${plannerProfile.name}」不完整：${plannerProfileValidation}`)
      showToast('AI 策划配置不完整', 'error')
      return
    }

    const controller = new AbortController()
    plannerAbortControllerRef.current = controller
    setIsPlanning(true)
    setPlanningStage(inputImages.length > 0 ? 'preparing' : 'requesting')
    setPlannerError('')
    try {
      setIsPreparingReferencePayload(inputImages.length > 0)
      setReferencePayloadNotice('')
      const workflow = await createAmazonPlannerPlan({
        listingText,
        baseDraft: draft,
        profile: plannerProfile,
        referenceImageDataUrls: inputImages.map((image) => image.dataUrl),
        mode: plannerPlatform === 'tiktok' ? 'listing' : plannerMode,
        platform: plannerPlatform,
        marketplaceId,
        tiktokDesignType,
        aPlusType,
        aPlusModuleSpecs: aPlusSpecs,
        aPlusGenerationTier: resolutionTier,
        signal: controller.signal,
        onStage: (stage) => {
          if (plannerAbortControllerRef.current !== controller) return
          setPlanningStage(stage)
          if (stage !== 'preparing') setIsPreparingReferencePayload(false)
        },
      })
      if (controller.signal.aborted) return
      setReferencePayloadNotice(workflow.referencePayloadNotice)
      applyPlannerResult(workflow.result, plannerMode === 'aplus' ? 'A+ AI 策划' : 'AI 策划')
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return
      setPlannerError(getPlannerFailureDetail(err))
      showToast('AI 策划失败，请查看详情', 'error')
    } finally {
      if (plannerAbortControllerRef.current === controller) {
        setIsPreparingReferencePayload(false)
        plannerAbortControllerRef.current = null
        setIsPlanning(false)
        setPlanningStage('idle')
      }
    }
  }

  const confirmCreateAiPlan = () => {
    if (plannerAbortControllerRef.current) {
      showToast('AI 策划正在进行中', 'info')
      return
    }
    if (!listingText.trim()) {
      showToast('请先粘贴标题和五点描述', 'error')
      return
    }

    if (!plannerProfile) {
      setConfirmDialog({
        title: '缺少 AI 策划配置',
        message:
          '未选择支持 Chat Completions 或 Responses API 的 AI 策划配置。\n\n请在设置 -> API 中选择或新增策划配置；生图配置会保持独立，不需要手动切换。',
        confirmText: '去配置',
        cancelText: '取消',
        action: () => {
          setShowSettings(true, 'api')
        },
      })
      return
    }

    if (plannerProfileValidation) {
      setConfirmDialog({
        title: 'AI 策划配置不完整',
        message: `AI 策划配置「${plannerProfile.name}」还缺少：${plannerProfileValidation}。`,
        confirmText: '去完善配置',
        cancelText: '取消',
        action: () => {
          setShowSettings(true, 'api')
        },
      })
      return
    }

    const platformLabel =
      plannerPlatform === 'tiktok'
        ? tiktokDesignType === 'detail'
          ? 'TikTok 商品详情图'
          : 'TikTok 商品主图'
        : plannerMode === 'aplus'
          ? '亚马逊 A+ 图片'
          : '亚马逊商品图片'
    const productTitle =
      draft.productTitle.trim() || listingText.trim().split(/\r?\n/).find(Boolean)?.slice(0, 80) || '未填写'

    setConfirmDialog({
      title: '确认开始 AI 策划',
      icon: 'info',
      message: [
        `策划板块：${platformLabel}`,
        `商品：${productTitle}`,
        `策划配置：${plannerProfile.name}`,
        `模型：${plannerProfile.model}`,
        `接口：${plannerApiLabel}`,
        `参考图：${inputImages.length} 张`,
        `输入内容：约 ${Array.from(listingText.trim()).length} 字符`,
        '确认后会调用外部 API 生成逐张图片方案，过程可能需要等待一段时间。',
      ].join('\n'),
      confirmText: '开始策划',
      cancelText: '取消',
      action: () => {
        void runCreateAiPlan()
      },
    })
  }

  const stopAiPlan = () => {
    const controller = plannerAbortControllerRef.current
    if (!controller) return
    controller.abort()
    plannerAbortControllerRef.current = null
    setIsPlanning(false)
    setPlanningStage('idle')
    showToast('AI 策划已停止', 'info')
  }

  const selectStyleCandidate = (index: number) => {
    const imageState = styleImages.find(
      (image) => image.candidateIndex === index && image.status === 'done' && image.imageId,
    )
    if (!imageState) return
    setSelectedStyleIndex(index)
    updateCurrentPlannerSession({
      selectedStyleIndex: index,
      styleImages: getSessionStyleImages(styleImages),
    })
  }

  const changeStyleDensityMode = (mode: AmazonStyleDensityMode) => {
    setStyleDensityMode(mode)
    updateCurrentPlannerSession({ styleDensityMode: mode })
  }

  const openStylePreview = (imageId: string) => {
    setLightboxImageId(imageId, styleLightboxImageIds.length ? styleLightboxImageIds : [imageId])
  }

  const changePlannerModel = (model: string) => {
    if (!plannerProfile || plannerProfile.model === model) return
    setSettings({
      profiles: settings.profiles.map((profile) =>
        profile.id === plannerProfile.id ? { ...profile, model } : profile,
      ),
    })
    showToast(`AI 策划模型已切换为 ${model}`, 'success')
  }

  const updateStylePreview = (
    candidate: AmazonStyleCandidate,
    imageState: StyleImageState | undefined,
    event: ReactMouseEvent<HTMLElement>,
  ) => {
    if (imageState?.status !== 'done' || !imageState.dataUrl) return
    setStylePreview({
      dataUrl: imageState.dataUrl,
      label: candidate.label,
      description: candidate.description,
      ...getStylePreviewPosition(event.clientX, event.clientY),
    })
  }

  const openStyleFailureDetail = (
    candidate: AmazonStyleCandidate,
    candidateIndex: number,
    imageState?: StyleImageState,
  ) => {
    const message =
      imageState?.error?.trim() || (imageState?.status === 'stopped' ? '风格板生成已停止' : '风格板生成失败')
    setConfirmDialog({
      title: `${candidate.label} 生成失败`,
      message,
      confirmText: '重试此风格板',
      cancelText: '关闭',
      action: () => {
        void retryStyleCandidateImage(candidateIndex)
      },
    })
  }

  const selectPlan = (index: number) => {
    const plan = imagePlans[index]
    setSelectedPlanIndex(plan ? index : null)
    if (plan) {
      setDraft((current) => (plan.kind ? { ...current, kind: plan.kind } : current))
    }
    updateCurrentPlannerSession({
      selectedPlanIndex: plan ? index : null,
      draft: toSessionDraft(plan?.kind ? { ...draft, kind: plan.kind } : draft),
    })
  }

  const selectAPlusPlan = (index: number) => {
    const plan = aPlusPlansWithSizes[index]
    setSelectedAPlusPlanIndex(plan ? index : null)
    updateCurrentPlannerSession({
      selectedAPlusPlanIndex: plan ? index : null,
    })
  }

  const selectVisiblePlan = (index: number) => {
    if (plannerMode === 'aplus') selectAPlusPlan(index)
    else selectPlan(index)
  }

  const stepVisiblePlan = (direction: -1 | 1) => {
    if (visiblePlanCount === 0 || visiblePlanIndex == null) return
    const nextIndex = Math.min(visiblePlanCount - 1, Math.max(0, visiblePlanIndex + direction))
    if (nextIndex !== visiblePlanIndex) selectVisiblePlan(nextIndex)
  }

  const resetPlannerOutputs = () => {
    invalidatePlannerRequests()
    setBatchSelectedIndexes([])
    historyRestoreRef.current?.cancel()
    setImagePlans([])
    setAPlusPlans([])
    setStyleCandidates([])
    styleImagesRef.current = []
    setStyleImages([])
    setSelectedStyleIndex(null)
    setStylePreview(null)
    setStyleError('')
    setSelectedPlanIndex(null)
    setSelectedAPlusPlanIndex(null)
    setPlannerError('')
    setActionProgress({})
    setPromptOverrides({})
    setPromptEditor(null)
    setCurrentPlannerSessionId(null)
  }

  const changePlannerPlatform = (platform: CommercePlannerPlatform) => {
    if (platform === plannerPlatform) return
    setPlannerPlatform(platform)
    setPlannerMode('listing')
    resetPlannerOutputs()
  }

  const changeMarketplace = (nextMarketplaceId: AmazonMarketplaceId) => {
    if (nextMarketplaceId === marketplaceId) return
    setMarketplaceId(nextMarketplaceId)
    resetPlannerOutputs()
  }

  const changeTiktokDesignType = (designType: TiktokDesignType) => {
    if (designType === tiktokDesignType) return
    setTiktokDesignType(designType)
    setPlannerMode('listing')
    resetPlannerOutputs()
  }

  const changePlannerMode = (mode: AmazonPlannerMode) => {
    if (mode === plannerMode) return
    setPlannerMode(mode)
    resetPlannerOutputs()
  }

  const changeAPlusType = (nextType: APlusContentType) => {
    setAPlusType(nextType)
    if (nextType !== aPlusType) {
      invalidatePlannerRequests()
      historyRestoreRef.current?.cancel()
      setBatchSelectedIndexes([])
      setAPlusPlans([])
      setSelectedAPlusPlanIndex(null)
      setSeriesStyleGuides((current) => ({ ...current, aplus: '' }))
      setStyleCandidates([])
      styleImagesRef.current = []
      setStyleImages([])
      setSelectedStyleIndex(null)
      setStylePreview(null)
      setStyleError('')
      setActionProgress({})
      setPromptOverrides({})
      setPromptEditor(null)
    }
  }

  const saveAPlusModuleSpecsByType = (next: APlusModuleSpecsByType) => {
    updateCurrentPlannerSession({ aPlusModuleSpecs: getAPlusModuleSpecsForSession(next) })
  }

  const updateCurrentAPlusModuleSpecs = (nextSpecs: AmazonAPlusModuleSpec[]) => {
    const normalized = normalizeAPlusModuleSpecs(aPlusType, nextSpecs)
    const next = { ...aPlusModuleSpecsByType }
    if (areAPlusModuleSpecsEquivalent(normalized, getAPlusModuleSpecs(aPlusType))) delete next[aPlusType]
    else next[aPlusType] = normalized
    setAPlusModuleSpecsByType(next)
    saveAPlusModuleSpecsByType(next)
  }

  const addAPlusModuleAfter = (index: number) => {
    if (isPlanning || aPlusPlans.length > 0 || aPlusSpecs.length >= MAX_A_PLUS_MODULE_COUNT) return
    updateCurrentAPlusModuleSpecs(insertAPlusModuleSpecAfter(aPlusType, aPlusSpecs, index))
  }

  const removeAPlusModuleAt = (index: number) => {
    if (isPlanning || aPlusPlans.length > 0 || aPlusSpecs.length <= MIN_A_PLUS_MODULE_COUNT) return
    updateCurrentAPlusModuleSpecs(removeAPlusModuleSpecAt(aPlusType, aPlusSpecs, index))
  }

  const restoreDefaultAPlusModules = () => {
    if (isPlanning || aPlusPlans.length > 0 || aPlusSpecsAreDefault) return
    const next = { ...aPlusModuleSpecsByType }
    delete next[aPlusType]
    setAPlusModuleSpecsByType(next)
    saveAPlusModuleSpecsByType(next)
  }

  const clearListingPlan = () => {
    setListingText('')
    setSeriesStyleGuides({ listing: '', aplus: '', tiktokMain: '', tiktokDetail: '' })
    setStyleDensityMode('rich')
    resetPlannerOutputs()
  }

  const loadPlannerSession = ({
    session,
    references: restoredReferences,
    styleImages: restoredStyleImages,
  }: RestoredPlannerSession) => {
    invalidatePlannerRequests()
    setBatchSelectedIndexes([])
    const selectedStyleRestored =
      session.selectedStyleIndex != null &&
      restoredStyleImages.some((image) => image.candidateIndex === session.selectedStyleIndex)

    setPlannerPlatform(session.platform ?? 'amazon')
    setMarketplaceId(session.marketplaceId ?? DEFAULT_AMAZON_MARKETPLACE_ID)
    setTiktokDesignType(session.tiktokDesignType ?? 'main')
    setPlannerMode(session.mode)
    setAPlusType(session.aPlusType)
    setAPlusModuleSpecsByType(getSessionAPlusModuleSpecsByType(session))
    setResolution(session.resolution)
    setListingText(session.listingText)
    setInputImages(restoredReferences)
    setDraft(fromSessionDraft(session.draft))
    setSeriesStyleGuides({
      listing: session.seriesStyleGuides.listing ?? '',
      aplus: session.seriesStyleGuides.aplus ?? '',
      tiktokMain: session.seriesStyleGuides.tiktokMain ?? '',
      tiktokDetail: session.seriesStyleGuides.tiktokDetail ?? '',
    })
    setStyleCandidates(session.styleCandidates)
    styleImagesRef.current = restoredStyleImages
    setStyleImages(restoredStyleImages)
    setSelectedStyleIndex(selectedStyleRestored ? session.selectedStyleIndex : null)
    setStyleDensityMode(session.styleDensityMode ?? 'rich')
    setStylePreview(null)
    setImagePlans(session.imagePlans as AmazonImagePlan[])
    setAPlusPlans(session.aPlusPlans as AmazonAPlusPlan[])
    setSelectedPlanIndex(
      session.selectedPlanIndex != null && session.imagePlans[session.selectedPlanIndex]
        ? session.selectedPlanIndex
        : null,
    )
    setSelectedAPlusPlanIndex(
      session.selectedAPlusPlanIndex != null && session.aPlusPlans[session.selectedAPlusPlanIndex]
        ? session.selectedAPlusPlanIndex
        : null,
    )
    setPlannerError('')
    setStyleError(
      session.selectedStyleIndex != null && !selectedStyleRestored
        ? '历史中的风格板图片不存在，请重新生成并选择风格板。策划文本已恢复。'
        : '',
    )
    setCurrentPlannerSessionId(session.id)
    setShowPlannerHistory(false)
    setActionProgress({})
    setPromptOverrides({})
    setPromptEditor(null)
    showToast('策划历史已恢复', 'success')
  }

  const restorePlannerSession = (session: AmazonPlannerSession) => {
    invalidatePlannerRequests()
    setBatchSelectedIndexes([])
    historyRestoreRef.current ??= createPlannerSessionRestorer({
      ensureImageCached,
      commit: loadPlannerSession,
      setLoading: setIsLoadingProjectImages,
      onError: (error) => showToast(`策划历史恢复失败：${String(error)}`, 'error'),
    })
    return historyRestoreRef.current.restore(session)
  }

  const closePlannerHistory = () => {
    historyRestoreRef.current?.cancel()
    setShowPlannerHistory(false)
  }

  const removePlannerSession = async (sessionId: string) => {
    try {
      await deletePlannerSessionHistory(sessionId)
      // 历史记录与项目图片位身份分离：保留方案 ID，已有版本仍属于原图片位。
      showToast('策划历史已删除', 'success')
    } catch (err) {
      showToast(`策划历史删除失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const copyPlannerError = async () => {
    try {
      await navigator.clipboard.writeText(plannerError)
      showToast('错误详情已复制', 'success')
    } catch {
      showToast('复制错误详情失败', 'error')
    }
  }

  const handleFiles = async (files: FileList | File[]) => {
    if (isPlannerRequestBusy) {
      showToast('AI 请求处理中，请先停止或等待完成', 'info')
      return
    }
    const accepted = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (accepted.length === 0) {
      showToast('请选择图片文件', 'error')
      return
    }

    const currentCount = useStore.getState().inputImages.length
    if (currentCount >= API_MAX_IMAGES) {
      showToast(`参考图数量已达上限（${API_MAX_IMAGES} 张），无法继续添加`, 'error')
      return
    }

    const remaining = API_MAX_IMAGES - currentCount
    const toAdd = accepted.slice(0, remaining)
    const discarded = accepted.length - toAdd.length
    setIsLoadingProjectImages(true)
    try {
      for (const file of toAdd) {
        await addImageFromFile(file)
      }

      const added = useStore.getState().inputImages.length - currentCount
      updateCurrentPlannerSession({
        referenceImageIds: useStore.getState().inputImages.map((image) => image.id),
      })
      if (discarded > 0) {
        showToast(
          added > 0
            ? `已上传 ${added} 张参考图，已达上限 ${API_MAX_IMAGES} 张，${discarded} 张被丢弃`
            : `已达上限 ${API_MAX_IMAGES} 张，${discarded} 张图片被丢弃`,
          added > 0 ? 'success' : 'error',
        )
        return
      }

      showToast(added > 0 ? `已上传 ${added} 张参考图` : '参考图已存在', added > 0 ? 'success' : 'info')
    } catch (err) {
      showToast(`参考图上传失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setIsLoadingProjectImages(false)
    }
  }

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleFiles(event.target.files || [])
    event.target.value = ''
  }

  const handleRefDragOver = (event: DragEvent<HTMLElement>) => {
    if (isPlannerRequestBusy || atImageLimit) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!isDraggingRefImages) setIsDraggingRefImages(true)
  }

  const handleRefDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsDraggingRefImages(false)
  }

  const handleRefDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDraggingRefImages(false)
    if (isPlannerRequestBusy || atImageLimit) return
    if (event.dataTransfer.files?.length) {
      void handleFiles(event.dataTransfer.files)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || promptEditor) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      const index = Number(event.key) - 1
      if (index >= 0 && index < PLANNER_STAGE_ORDER.length) {
        event.preventDefault()
        setStage(PLANNER_STAGE_ORDER[index])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [promptEditor])

  const finalsCount = Object.keys(project.finals).length

  return (
    <section className="planner-workspace">
      <div data-no-drag-select className="border-b border-[var(--line)] px-4 py-3 sm:px-5 sm:py-3.5">
        <PlannerHeader
          platform={plannerPlatform}
          mode={plannerMode}
          tiktokDesignType={tiktokDesignType}
          resolution={resolution}
          historyOpen={showPlannerHistory}
          historyCount={plannerSessions.length}
          disabled={isPlannerRequestBusy}
          onPlatformChange={changePlannerPlatform}
          onModeChange={changePlannerMode}
          onTiktokDesignTypeChange={changeTiktokDesignType}
          onResolutionChange={setResolution}
          onToggleHistory={() => (showPlannerHistory ? closePlannerHistory() : setShowPlannerHistory(true))}
        />
        {showPlannerHistory && (
          <PlannerHistoryDrawer
            sessions={plannerSessions}
            currentSessionId={currentPlannerSessionId}
            onClose={closePlannerHistory}
            onRestore={restorePlannerSession}
            onRemove={removePlannerSession}
            onError={(message) => showToast(message, 'error')}
          />
        )}
      </div>
      <nav data-no-drag-select aria-label="制作阶段" className="planner-stages">
        {(
          [
            ['details', '商品资料', '标题、站点与参考图', Boolean(listingText.trim()) && hasPlanOptions],
            ['style', '策划与风格', '查看候选并选择风格', Boolean(selectedStyleCandidate)],
            ['production', '图片制作', '逐张检查与提交生成', projectTasks(tasks, project.id).some((task) => task.status === 'done')],
            ['results', '筛选与导出', '版本定稿与项目导出', finalsCount > 0],
          ] as const
        ).map(([value, label, description, completed], index) => (
          <button
            type="button"
            key={value}
            aria-current={stage === value ? 'step' : undefined}
            title={`${label}（Alt+${index + 1}）`}
            onClick={() => setStage(value)}
            className="planner-stage"
          >
            <span
              className={`planner-stage-number ${
                completed && stage !== value
                  ? '!border-emerald-500/40 !bg-emerald-500/15 !text-emerald-600 dark:!text-emerald-400'
                  : ''
              }`}
            >
              {completed && stage !== value ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{label}</span>
              <span className="planner-stage-description truncate">{description}</span>
            </span>
          </button>
        ))}
      </nav>
      <div data-no-drag-select className="planner-stage-status" role="status">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${
              isPlanning || isGeneratingStyleImages
                ? 'animate-pulse bg-[var(--accent)]'
                : hasPlanOptions
                  ? 'bg-emerald-500'
                  : 'bg-[var(--text-3)]'
            }`}
          />
          {isPlanning
            ? 'AI 策划进行中，可切换阶段查看已有内容'
            : isGeneratingStyleImages
              ? '风格板生成中，可继续查看图片方案'
              : hasPlanOptions
                ? '已有 ' + visiblePlanCount + ' 个方案 · ' + (selectedStyleCandidate ? '已选择风格' : '风格待选择')
                : '从商品资料开始，粘贴标题与五点描述后生成策划。'}
        </span>
        {hasPlanOptions && stage === 'details' && (
          <button type="button" onClick={() => setStage('style')}>
            查看策划与风格 →
          </button>
        )}
      </div>
      <div data-no-drag-select hidden={stage !== 'details'} className="planner-details">
        <div className="min-w-0 space-y-4">
          <div className={`rounded-2xl border p-4 sm:p-5 transition ${getGuidePanelClass(plannerGuideActive)}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[15px] font-bold text-[var(--text-1)]">
                  {plannerMode === 'aplus' ? 'A+ 图片策划' : 'Listing 智能策划'}
                </div>
                <div className="mt-1 text-xs leading-relaxed text-[var(--text-2)]">
                  {plannerMode === 'aplus'
                    ? '粘贴标题、五点描述或品牌说明，生成普通A+ / 标准A+ / 高级A+ / 手机A+模块编排和英文提示词。'
                    : '粘贴标题、五点描述或产品说明，生成 Main + PT01-PT06 的逐张方案和英文提示词。'}
                </div>
              </div>
            </div>
            <PlannerInputPanel
              plannerMode={plannerMode}
              plannerPlatform={plannerPlatform}
              tiktokDesignType={tiktokDesignType}
              plannerGuideActive={plannerGuideActive}
              guideMessage={guideState.message}
              guideHintClass={GUIDE_HINT_CLASS}
              getGuideFocusClass={(target) => getGuideFocusClass(guideState.target === target)}
              marketplaceId={marketplaceId}
              onMarketplaceChange={changeMarketplace}
              aPlusType={aPlusType}
              aPlusContentTypes={A_PLUS_CONTENT_TYPES}
              getAPlusContentTypeLabel={getAPlusContentTypeLabel}
              onAPlusTypeChange={changeAPlusType}
              listingText={listingText}
              onListingTextChange={setListingText}
              plannerProfile={plannerProfile ?? null}
              plannerProfileValidation={plannerProfileValidation ?? ''}
              plannerModelOptions={plannerModelOptions}
              onPlannerModelChange={changePlannerModel}
              isPlanning={isPlanning}
              planningStage={planningStage}
              onConfirmCreatePlan={confirmCreateAiPlan}
              onStopPlan={stopAiPlan}
              hasListingContent={Boolean(listingText.trim() || imagePlans.length > 0 || aPlusPlans.length > 0)}
              onClearListingPlan={clearListingPlan}
              onOpenSettings={() => setShowSettings(true, 'api')}
              plannerError={plannerError}
              onCopyPlannerError={copyPlannerError}
              fieldClass={FIELD_CLASS}
              labelClass={LABEL_CLASS}
            />
          </div>
          {plannerMode === 'aplus' && aPlusPlansWithSizes.length === 0 && (
            <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3.5">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-1)]">A+ 模块编排</div>
                  <div className="mt-0.5 text-xs text-[var(--text-2)]">
                    当前选择 {getAPlusContentTypeLabel(aPlusType)}，可先调整模块数量，再点击 AI策划A+。
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={restoreDefaultAPlusModules}
                    disabled={isPlanning || aPlusSpecsAreDefault}
                    title="恢复当前 A+ 类型默认模块"
                    className="ui-btn ui-btn-sm h-8"
                  >
                    <RefreshIcon className="h-3.5 w-3.5" />
                    恢复默认
                  </button>
                  <span className="ui-badge ui-badge-neutral">{aPlusSpecs.length} 张</span>
                </div>
              </div>
              <div className={PLAN_LIST_CLASS}>
                {aPlusSpecs.map((spec, index) => (
                  <div
                    key={spec.slot}
                    className="rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-solid)] px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-[var(--surface-inset)] px-2 py-0.5 text-[11px] font-bold text-[var(--text-2)]">
                            {spec.slot}
                          </span>
                          <span className="text-sm font-semibold text-[var(--text-1)]">
                            {getAPlusModuleDisplayName(spec)}
                          </span>
                          <span className="text-xs text-[var(--text-3)]">{getAPlusModuleEnglishName(spec)}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--text-3)]">
                          上传 {getAPlusModuleUploadSize(spec)} · 生成{' '}
                          {getAPlusModuleGenerationSize(spec, resolutionTier)}
                          {isAPlusTextModule(spec) ? ' · 含标题/正文' : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => addAPlusModuleAfter(index)}
                          disabled={isPlanning || aPlusSpecs.length >= MAX_A_PLUS_MODULE_COUNT}
                          aria-label={`在 ${spec.slot} 后添加同尺寸 A+ 模块`}
                          title={
                            aPlusSpecs.length >= MAX_A_PLUS_MODULE_COUNT
                              ? `最多 ${MAX_A_PLUS_MODULE_COUNT} 张`
                              : '添加同尺寸模块'
                          }
                          className="ui-btn ui-btn-soft h-8 w-8 px-0"
                        >
                          <PlusIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAPlusModuleAt(index)}
                          disabled={isPlanning || aPlusSpecs.length <= MIN_A_PLUS_MODULE_COUNT}
                          aria-label={`删除 ${spec.slot} A+ 模块`}
                          title={
                            aPlusSpecs.length <= MIN_A_PLUS_MODULE_COUNT
                              ? `至少保留 ${MIN_A_PLUS_MODULE_COUNT} 张`
                              : '删除模块'
                          }
                          className="ui-btn ui-btn-danger-soft h-8 w-8 px-0"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div
            onDragOver={handleRefDragOver}
            onDragLeave={handleRefDragLeave}
            onDrop={handleRefDrop}
            className={`rounded-2xl border p-4 sm:p-5 transition ${
              isDraggingRefImages
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-2 ring-[var(--accent-ring)]'
                : 'border-[var(--line)] bg-[var(--surface-panel-strong)]'
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[15px] font-bold text-[var(--text-1)]">参考图</div>
                <div className="mt-0.5 text-xs text-[var(--text-2)]">
                  {inputImages.length > 0
                    ? `${inputImages.length}/${API_MAX_IMAGES} 张产品参考图${usesStyleReferenceForActivePlan ? '；正式生成时另附 1 张隐藏风格板（不计入上述数量）' : '，将随生成请求一起发送'}`
                    : usesStyleReferenceForActivePlan
                      ? `未上传产品参考图；正式生成时会附 1 张隐藏风格板`
                      : '建议上传产品实拍、包装或结构参考图'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => !atImageLimit && !isPlannerRequestBusy && fileInputRef.current?.click()}
                  disabled={atImageLimit || isPlannerRequestBusy}
                  className="ui-btn ui-btn-soft h-9"
                >
                  <PlusIcon className="h-4 w-4" />
                  上传参考图
                </button>
                <button
                  type="button"
                  onClick={() => !atImageLimit && !isPlannerRequestBusy && cameraInputRef.current?.click()}
                  disabled={atImageLimit || isPlannerRequestBusy}
                  className="ui-btn h-9 sm:hidden"
                >
                  <PhotoIcon className="h-4 w-4" />
                  拍照
                </button>
                {inputImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      clearInputImages()
                      updateCurrentPlannerSession({ referenceImageIds: [] })
                    }}
                    disabled={isPlannerRequestBusy}
                    className="ui-btn ui-btn-danger-soft h-9"
                  >
                    <TrashIcon className="h-4 w-4" />
                    清空
                  </button>
                )}
              </div>
            </div>

            {(isPreparingReferencePayload || referencePayloadNotice) && (
              <div
                className={`ui-callout mt-3 py-2 text-xs ${isPreparingReferencePayload ? 'ui-callout-accent' : 'ui-callout-success'}`}
              >
                {isPreparingReferencePayload ? '正在压缩参考图...' : referencePayloadNotice}
              </div>
            )}

            {inputImages.length > 0 ? (
              <PlannerReferenceImageGrid
                images={inputImages}
                disabled={isPlannerRequestBusy}
                onRemove={(index) => {
                  const nextReferenceImageIds = inputImages
                    .filter((_, imageIndex) => imageIndex !== index)
                    .map((item) => item.id)
                  removeInputImage(index)
                  updateCurrentPlannerSession({ referenceImageIds: nextReferenceImageIds })
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => !isPlannerRequestBusy && fileInputRef.current?.click()}
                disabled={isPlannerRequestBusy}
                data-dragging={isDraggingRefImages ? 'true' : undefined}
                className="ui-dropzone mt-3.5 min-h-[132px] w-full disabled:cursor-not-allowed disabled:opacity-55"
              >
                <span className="ui-dropzone-icon" aria-hidden="true">
                  <UploadCloudIcon className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold text-[var(--text-1)]">
                  {isDraggingRefImages ? '松开鼠标以上传参考图' : '上传产品参考图'}
                </span>
                <span className="text-xs text-[var(--text-3)]">支持拖拽图片到此处、多选或粘贴上传（最多 16 张）</span>
              </button>
            )}

            {atImageLimit && (
              <div className="ui-callout ui-callout-warning mt-3 py-2 text-xs">
                参考图数量已达上限（{API_MAX_IMAGES} 张），请删除不需要的图片后再上传。
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              disabled={isPlannerRequestBusy}
              className="hidden"
              onChange={handleFileUpload}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              disabled={isPlannerRequestBusy}
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
          <details className="planner-disclosure mt-4">
            <summary>
              AI 商品信息摘要 <span>查看模型识别的商品信息</span>
            </summary>
            <PlannerProductSummary draft={draft} />
          </details>
        </div>
      </div>
      <div data-no-drag-select hidden={stage !== 'style'} className="planner-style-section">
        {hasPlanOptions && (
          <div
            ref={styleSectionRef}
            className={`mb-4 rounded-2xl border p-4 transition ${getGuidePanelClass(styleGuideActive, 'muted')}`}
          >
            {styleGuideActive && <div className={GUIDE_HINT_CLASS}>{guideState.message}</div>}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-bold text-[var(--text-1)]">视觉风格选择</div>
                <div className="mt-0.5 text-xs text-[var(--text-2)]">
                  {imageGenerationProfile
                    ? `生成低清风格参考板时，将自动使用生图配置「${imageGenerationProfile.name}」${imageGenerationProfileValidation ? `（${imageGenerationProfileValidation}）` : ''}。`
                    : imageGenerationProfileValidation}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="ui-segmented h-9 p-0.5 text-xs font-semibold">
                  {STYLE_DENSITY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={styleDensityMode === option.value}
                      onClick={() => changeStyleDensityMode(option.value)}
                      className="ui-segment min-h-0 px-3 text-xs"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={confirmGenerateStyleImages}
                  disabled={isGeneratingStyleImages || activeStyleCandidates.length === 0}
                  className={`ui-btn ui-btn-primary h-9 text-sm ${guideState.target === 'style' ? 'ring-2 ring-[var(--accent-ring)] ring-offset-2' : ''}`}
                >
                  <SparklesIcon className="h-4 w-4" />
                  {isGeneratingStyleImages ? '生成中...' : '生成风格板'}
                </button>
                {isGeneratingStyleImages && (
                  <button type="button" onClick={stopGeneratingStyleImages} className="ui-btn ui-btn-danger h-9 text-sm">
                    <CloseIcon className="h-4 w-4" />
                    停止
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] p-3">
              <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-[var(--text-1)]">AI 策划风格候选</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-3)]">
                      使用 AI 策划返回的风格候选动态生成风格板。
                    </div>
                  </div>
                  <span className={`ui-badge ${styleCandidates.length ? 'ui-badge-accent' : 'ui-badge-danger'}`}>
                    {styleCandidates.length ? `${styleCandidates.length} 个候选` : '暂无候选'}
                  </span>
                </div>
                {!styleCandidates.length && (
                  <div className="mt-2 rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--surface-inset)] px-3 py-4 text-center text-xs leading-relaxed text-[var(--text-3)]">
                    当前策划结果没有风格候选。请重新执行 AI 策划后再生成风格板。
                  </div>
                )}
              </div>
            </div>
            {styleError && (
              <div className="ui-callout ui-callout-danger mt-3 py-2 text-xs leading-relaxed">
                {styleError}
              </div>
            )}
            {activeStyleCandidates.length > 0 && (
              <div
                className={`mt-3 grid gap-3 rounded-xl transition sm:grid-cols-3 ${getGuideFocusClass(guideState.target === 'style-choice')}`}
              >
                {activeStyleCandidates.map((candidate, index) => {
                  const imageState = styleImages.find((image) => image.candidateIndex === index)
                  const isSelected = selectedStyleIndex === index && imageState?.status === 'done'
                  const previewImageId = imageState?.status === 'done' ? imageState.imageId : undefined
                  const canSelect = Boolean(previewImageId)
                  const canPreview = Boolean(previewImageId && imageState?.dataUrl)
                  const canRetryStyleImage = imageState?.status === 'error' || imageState?.status === 'stopped'
                  const canOpenFailureDetail = canRetryStyleImage
                  return (
                    <div
                      key={`${candidate.label}-${index}`}
                      onMouseEnter={(event) => updateStylePreview(candidate, imageState, event)}
                      onMouseMove={(event) => updateStylePreview(candidate, imageState, event)}
                      onMouseLeave={() => setStylePreview(null)}
                      className={`relative min-w-0 overflow-hidden rounded-xl border text-left transition ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-2 ring-[var(--accent-ring)]'
                          : canSelect
                            ? 'border-[var(--line)] bg-[var(--surface-solid)] hover:border-[var(--line-strong)]'
                            : 'border-[var(--line)] bg-[var(--surface-solid)] opacity-80'
                      }`}
                    >
                      {canPreview && previewImageId && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openStylePreview(previewImageId)
                          }}
                          title="查看风格板大图"
                          aria-label={`查看 ${candidate.label} 风格板大图`}
                          className="absolute right-2 top-2 z-10 inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-panel-strong)] px-2 text-[11px] font-semibold text-[var(--text-1)] shadow-sm backdrop-blur-md transition hover:bg-[var(--surface-solid)]"
                        >
                          <EyeIcon className="h-3.5 w-3.5" />
                          查看
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (canSelect) {
                            selectStyleCandidate(index)
                            return
                          }
                          if (canOpenFailureDetail) openStyleFailureDetail(candidate, index, imageState)
                        }}
                        disabled={!canSelect && !canOpenFailureDetail}
                        className="block h-full w-full text-left disabled:cursor-not-allowed"
                      >
                        <div className="aspect-square bg-[var(--surface-inset)]">
                          {imageState?.status === 'done' && imageState.dataUrl ? (
                            <img
                              src={imageState.dataUrl}
                              alt={candidate.label}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-[var(--text-3)]">
                              <span>{getStyleImagePlaceholder(imageState?.status)}</span>
                              {canOpenFailureDetail && (
                                <span className="ui-badge ui-badge-danger">点击查看 / 重试</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-xs font-semibold text-[var(--text-1)]">
                              {candidate.label}
                            </span>
                            {isSelected && (
                              <span className="shrink-0 rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                                已选
                              </span>
                            )}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-2)]">
                            {candidate.description}
                          </div>
                        </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            {stylePreview && (
              <div
                className="pointer-events-none fixed z-50 hidden w-[420px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[var(--surface-solid)] shadow-2xl sm:block"
                style={{ left: stylePreview.left, top: stylePreview.top }}
              >
                <img
                  src={stylePreview.dataUrl}
                  alt=""
                  className="aspect-square w-full bg-[var(--surface-inset)] object-contain"
                />
                <div className="border-t border-[var(--line)] p-3">
                  <div className="truncate text-sm font-semibold text-[var(--text-1)]">
                    {stylePreview.label}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-2)]">
                    {stylePreview.description}
                  </div>
                </div>
              </div>
            )}
            {selectedStyleCandidate && selectedStyleImage?.imageId && (
              <div className="ui-callout ui-callout-accent mt-3 py-2 text-xs leading-relaxed">
                {isMainListingPlan
                  ? `已选择「${selectedStyleCandidate.label}」，但当前 MAIN 主图不会附加这张风格板；切换到附图或 A+ 时才会作为隐藏参考。`
                  : `已选择「${selectedStyleCandidate.label}」。正式生成时会隐藏附加这张风格参考板作为最后一张参考图，用于统一字体感觉、色板、光影、材质和标注样式，不复制其中占位文字、固定版式或产品摆放；风格板不占上传参考图数量。`}
              </div>
            )}
            {uploadedReferenceLimitExceeded && (
              <div className="ui-callout ui-callout-warning mt-3 py-2 text-xs">
                上传参考图不能超过 {API_MAX_IMAGES} 张；风格板单独使用，不计入这个数量。
              </div>
            )}
          </div>
        )}
        {!hasPlanOptions && (
          <div className="planner-empty">
            <h3>先生成图片策划</h3>
            <p>有了商品方案后，这里会显示风格候选和风格板。</p>
            <button type="button" onClick={() => setStage('details')}>
              填写商品资料
            </button>
          </div>
        )}
        {hasPlanOptions && (
          <div className="planner-stage-footer">
            <span>选定风格后，可逐张查看方案并生成图片。MAIN 主图保留原有白底规则。</span>
            <button type="button" onClick={() => setStage('production')}>
              进入图片制作 →
            </button>
          </div>
        )}
      </div>
      <div
        hidden={stage !== 'production' && stage !== 'results'}
        className={'planner-production ' + (stage === 'results' ? 'planner-results-layout' : '')}
      >
        <aside
          data-no-drag-select
          hidden={stage !== 'production'}
          aria-label="图片位列表"
          className="planner-slot-list"
        >
          {plannerMode === 'listing' && imagePlans.length > 0 && (
            <div className={`mb-4 rounded-xl border p-3.5 transition ${getGuidePanelClass(planListGuideActive)}`}>
              {planListGuideActive && <div className={GUIDE_HINT_CLASS}>{guideState.message}</div>}
              <div className="mb-3 flex flex-col gap-2.5">
                <div>
                  <div className="text-sm font-bold text-[var(--text-1)]">逐张策划</div>
                  <div className="mt-0.5 text-xs text-[var(--text-2)]">
                    选择图片位后，生成按钮会切换到对应提示词。
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={selectAllBatchPlans}
                    className="ui-btn ui-btn-sm h-7 px-2 text-xs"
                  >
                    {batchSelectedIndexes.length === imagePlans.length ? '清空' : '全选'}
                  </button>
                  <button
                    type="button"
                    onClick={selectFailedBatchPlans}
                    className="ui-btn ui-btn-danger-soft ui-btn-sm h-7 px-2 text-xs"
                  >
                    选失败
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitBatchPlans()}
                    disabled={
                      isBatchSubmitting || isSubmitting || isLoadingProjectImages || batchSelectedIndexes.length === 0
                    }
                    className="ui-btn ui-btn-primary ui-btn-sm h-7 px-2.5 text-xs"
                  >
                    {isBatchSubmitting
                      ? '批量提交中…'
                      : `批量生成${batchSelectedIndexes.length ? ` ${batchSelectedIndexes.length}` : ''}`}
                  </button>
                </div>
              </div>
              <div className={PLAN_LIST_CLASS}>
                {imagePlans.map((plan, index) => {
                  const isSelected = selectedPlanIndex === index
                  const planActionProgress = actionProgress[getPlannerActionKey('listing', index, plan.slot)]
                  const planTask = getPlanTask(plan.slot)
                  const thumbImageId = planTask?.status === 'done' ? planTask.outputImages[0] : undefined
                  return (
                    <div key={`${plan.slot}-${index}`} className="relative">
                      <input
                        type="checkbox"
                        checked={batchSelectedIndexes.includes(index)}
                        onChange={() => toggleBatchPlan(index)}
                        aria-label={`选择 ${plan.slot} 批量生成`}
                        className="absolute left-3 top-3.5 z-10 h-4 w-4 accent-[var(--accent)]"
                      />
                      <button
                        type="button"
                        onClick={() => selectPlan(index)}
                        className={`w-full rounded-xl border p-3 pl-9 text-left transition ${
                          isSelected
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent-ring)]'
                            : 'border-[var(--line)] bg-[var(--surface-solid)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-inset)]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                                  isSelected
                                    ? 'bg-[var(--cta-bg)] text-[var(--cta-fg)]'
                                    : 'bg-[var(--surface-inset)] text-[var(--text-2)]'
                                }`}
                              >
                                {plan.slot}
                              </span>
                              <span className="truncate text-sm font-semibold text-[var(--text-1)]">{plan.label}</span>
                              {isSelected && (
                                <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  当前
                                </span>
                              )}
                              {planTask && isPlannerTaskPending(planTask) && (
                                <span className="ui-badge ui-badge-accent px-1.5 py-0.5 text-[10px]">生成中</span>
                              )}
                              {planTask?.status === 'done' && (
                                <span className="ui-badge ui-badge-success px-1.5 py-0.5 text-[10px]">已完成</span>
                              )}
                              {isPlannerTaskFailed(planTask) && (
                                <span className="ui-badge ui-badge-danger px-1.5 py-0.5 text-[10px]">失败，可重试</span>
                              )}
                              {!planTask && planActionProgress && (
                                <span className="ui-badge ui-badge-success px-1.5 py-0.5 text-[10px]">
                                  {planActionProgress === 'submitted' ? '已提交' : '已准备'}
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--text-2)]">
                              {getPlanSummary(plan.planMarkdown)}
                            </div>
                          </div>
                          {thumbImageId && <SlotMiniThumb imageId={thumbImageId} label={plan.slot} />}
                        </div>
                        <div className="mt-2 line-clamp-2 rounded-lg bg-[var(--surface-inset)] px-2 py-1 text-[11px] leading-relaxed text-[var(--text-3)]">
                          Negative：{plan.negativePrompt || '未提供'}
                        </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {plannerMode === 'aplus' && aPlusPlansWithSizes.length > 0 && (
            <div className={`mb-4 rounded-xl border p-3.5 transition ${getGuidePanelClass(planListGuideActive)}`}>
              {planListGuideActive && <div className={GUIDE_HINT_CLASS}>{guideState.message}</div>}
              <div className="mb-3 flex flex-col gap-2.5">
                <div>
                  <div className="text-sm font-bold text-[var(--text-1)]">A+ 模块编排</div>
                  <div className="mt-0.5 text-xs text-[var(--text-2)]">
                    选择模块后，生成按钮会切换到对应 A+ 提示词与尺寸。
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={selectAllBatchPlans}
                    className="ui-btn ui-btn-sm h-7 px-2 text-xs"
                  >
                    {batchSelectedIndexes.length === aPlusPlansWithSizes.length ? '清空' : '全选'}
                  </button>
                  <button
                    type="button"
                    onClick={selectFailedBatchPlans}
                    className="ui-btn ui-btn-danger-soft ui-btn-sm h-7 px-2 text-xs"
                  >
                    选失败
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitBatchPlans()}
                    disabled={
                      isBatchSubmitting || isSubmitting || isLoadingProjectImages || batchSelectedIndexes.length === 0
                    }
                    className="ui-btn ui-btn-primary ui-btn-sm h-7 px-2.5 text-xs"
                  >
                    {isBatchSubmitting
                      ? '批量提交中…'
                      : `批量生成${batchSelectedIndexes.length ? ` ${batchSelectedIndexes.length}` : ''}`}
                  </button>
                </div>
              </div>
              <div className={PLAN_LIST_CLASS}>
                {aPlusPlansWithSizes.map((plan, index) => {
                  const isSelected = selectedAPlusPlanIndex === index
                  const externalText = formatAPlusModuleText(plan)
                  const planActionProgress = actionProgress[getPlannerActionKey('aplus', index, plan.slot)]
                  const planTask = getPlanTask(plan.slot)
                  const thumbImageId = planTask?.status === 'done' ? planTask.outputImages[0] : undefined
                  return (
                    <div key={`${plan.slot}-${index}`} className="relative">
                      <input
                        type="checkbox"
                        checked={batchSelectedIndexes.includes(index)}
                        onChange={() => toggleBatchPlan(index)}
                        aria-label={`选择 ${plan.slot} 批量生成`}
                        className="absolute left-3 top-3.5 z-10 h-4 w-4 accent-[var(--accent)]"
                      />
                      <button
                        type="button"
                        onClick={() => selectAPlusPlan(index)}
                        className={`w-full rounded-xl border p-3 pl-9 text-left transition ${
                          isSelected
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent-ring)]'
                            : 'border-[var(--line)] bg-[var(--surface-solid)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-inset)]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                                  isSelected
                                    ? 'bg-[var(--cta-bg)] text-[var(--cta-fg)]'
                                    : 'bg-[var(--surface-inset)] text-[var(--text-2)]'
                                }`}
                              >
                                {plan.slot}
                              </span>
                              <span className="truncate text-sm font-semibold text-[var(--text-1)]">
                                {getAPlusModuleDisplayName(plan)}
                              </span>
                              <span className="text-xs text-[var(--text-3)]">{getAPlusModuleEnglishName(plan)}</span>
                              {isSelected && (
                                <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  当前
                                </span>
                              )}
                              {planTask && isPlannerTaskPending(planTask) && (
                                <span className="ui-badge ui-badge-accent px-1.5 py-0.5 text-[10px]">生成中</span>
                              )}
                              {planTask?.status === 'done' && (
                                <span className="ui-badge ui-badge-success px-1.5 py-0.5 text-[10px]">已完成</span>
                              )}
                              {isPlannerTaskFailed(planTask) && (
                                <span className="ui-badge ui-badge-danger px-1.5 py-0.5 text-[10px]">失败，可重试</span>
                              )}
                              {!planTask && planActionProgress && (
                                <span className="ui-badge ui-badge-success px-1.5 py-0.5 text-[10px]">
                                  {planActionProgress === 'submitted' ? '已提交' : '已准备'}
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-[var(--text-3)]">
                              <span className="rounded-md bg-[var(--surface-inset)] px-2 py-0.5">
                                上传 {plan.uploadSize}
                              </span>
                              <span className="rounded-md bg-[var(--surface-inset)] px-2 py-0.5">
                                生成 {plan.generationSize}
                              </span>
                            </div>
                          </div>
                          {thumbImageId && <SlotMiniThumb imageId={thumbImageId} label={plan.slot} />}
                        </div>
                        <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-2)]">
                          {getPlanSummary(plan.planMarkdown)}
                        </div>
                        {(isAPlusTextModule(plan) || externalText) && externalText && (
                          <div className="mt-2 rounded-lg bg-[var(--surface-inset)] px-2 py-1 text-xs leading-relaxed text-[var(--text-1)]">
                            {plan.textTitle && <div className="font-semibold">{plan.textTitle}</div>}
                            {plan.textBody && (
                              <div className="mt-0.5 line-clamp-2 text-[var(--text-2)]">{plan.textBody}</div>
                            )}
                          </div>
                        )}
                        <div className="mt-2 line-clamp-2 rounded-lg bg-[var(--surface-inset)] px-2 py-1 text-[11px] leading-relaxed text-[var(--text-3)]">
                          Negative：{plan.negativePrompt || '未提供'}
                        </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {!hasPlanOptions && (
            <div className="planner-empty">
              <h3>还没有图片方案</h3>
              <p>先填写商品资料并生成策划。</p>
              <button type="button" onClick={() => setStage('details')}>
                返回商品资料
              </button>
            </div>
          )}
        </aside>
        <section
          data-no-drag-select
          hidden={stage !== 'production'}
          aria-label="当前方案内容"
          className="planner-plan-content"
        >
          <div className="planner-panel-heading">
            <div>
              <p>当前图片方案</p>
              <h3>{actionSlot ? actionSlot + ' · ' + actionLabel : '选择一个图片位'}</h3>
            </div>
            <span>{actionPositionLabel}</span>
          </div>
          {hasSelectedPlan ? (
            <>
              <MarkdownRenderer
                key={currentActionKey}
                content={(plannerMode === 'aplus' ? selectedAPlusPlan?.planMarkdown : selectedPlan?.planMarkdown) ?? ''}
                className="planner-plan-markdown"
              />
              {plannerMode === 'aplus' && selectedAPlusPlan && (
                <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-2)]">
                      A+ 文案 · {selectedAPlusPlan.slot}
                    </span>
                    <button
                      type="button"
                      onClick={copyAPlusText}
                      disabled={!selectedAPlusText.trim()}
                      className="ui-btn ui-btn-sm h-8"
                    >
                      <CopyIcon className="h-3.5 w-3.5" />
                      复制文案
                    </button>
                  </div>
                  <textarea
                    value={
                      selectedAPlusText ||
                      (isAPlusTextModule(selectedAPlusPlan)
                        ? '该模块暂未生成标题/正文文案。'
                        : '当前模块通常不需要外部标题/正文文案。')
                    }
                    className="ui-input h-28 resize-none text-xs leading-relaxed"
                    spellCheck={false}
                    readOnly
                  />
                  <div className="mt-2 text-[11px] text-[var(--text-3)]">
                    外部 A+ 文案用于亚马逊模块文本区，不会写入图片生成 Prompt。
                  </div>
                </div>
              )}
              <details className="planner-disclosure mt-4">
                <summary>原始英文提示词与负面词</summary>
                <div data-selectable-text className="whitespace-pre-wrap break-words p-4 text-xs leading-relaxed">
                  {activeVisiblePrompt}
                </div>
              </details>
              {actionSlot && (
                <ProjectResults project={project} slotId={getProjectSlotId(actionSlot)} onFinalChange={onFinalChange} />
              )}
            </>
          ) : (
            <div className="planner-empty">
              <p>选择左侧图片位，在这里查看完整策划内容。</p>
            </div>
          )}
        </section>
        <section hidden={stage !== 'results'} aria-label="生成记录与导出" className="planner-results">
          <div className="planner-panel-heading">
            <div>
              <p>生成记录</p>
              <h3>筛选图片与批量导出</h3>
            </div>
          </div>
          <ProjectResults project={project} onFinalChange={onFinalChange} />
          <details className="mt-6">
            <summary className="cursor-pointer py-3 text-sm font-medium text-[var(--text-2)]">
              全部历史（含旧版及其他功能生成记录）
            </summary>
            {resultsPanel}
          </details>
        </section>
        <aside data-no-drag-select aria-label="生成操作与设置" className="planner-generation-settings">
          <div data-no-drag-select hidden={stage !== 'production'}>
            {showStickyActions && (
              <>
                <div
                  data-amazon-action-bar
                  className={`rounded-xl border p-3.5 transition ${getGuidePanelClass(actionBarGuideActive)}`}
                >
                  <div className="flex flex-col gap-3">
                    {actionBarGuideActive && <div className={GUIDE_HINT_CLASS}>{guideState.message}</div>}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-md bg-[var(--cta-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--cta-fg)]">
                            {actionSlot ?? (plannerMode === 'aplus' ? 'A+' : '当前')}
                          </span>
                          <span className="truncate text-sm font-bold text-[var(--text-1)]">
                            {actionLabel ?? (plannerMode === 'aplus' ? '请选择 A+ 模块' : '当前图片方案')}
                          </span>
                          <span className="rounded-md bg-[var(--surface-inset)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-3)]">
                            {actionPositionLabel}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--text-3)]">
                          {targetSize} / {generationParamLabel}
                          {plannerMode === 'aplus' && selectedAPlusPlan
                            ? ` · 上传建议 ${selectedAPlusPlan.uploadSize}`
                            : ''}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => stepVisiblePlan(-1)}
                          disabled={!canGoPrev}
                          className="ui-btn ui-btn-sm h-8 px-2"
                        >
                          <ChevronLeftIcon className="h-3.5 w-3.5" />
                          上一张
                        </button>
                        <button
                          type="button"
                          onClick={() => stepVisiblePlan(1)}
                          disabled={!canGoNext}
                          className={`ui-btn ui-btn-sm h-8 px-2 ${currentActionSubmitted && canGoNext ? 'ui-btn-accent' : ''}`}
                        >
                          下一张
                          <ChevronRightIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div
                      className={`ui-callout py-2 text-xs font-medium ${
                        currentActionSubmitted
                          ? 'ui-callout-success'
                          : currentActionFilled
                            ? 'ui-callout-accent'
                            : 'border-[var(--line)] bg-[var(--surface-inset)] text-[var(--text-2)]'
                      }`}
                    >
                      {actionGuidance}
                      {mainStyleGuidance && (
                        <span className="mt-1 block text-[11px] font-normal opacity-80">{mainStyleGuidance}</span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {actionProgressSteps.map((step) => (
                        <div
                          key={step.label}
                          className={`rounded-lg border px-2 py-1.5 ${getActionStepClass(step.status)}`}
                        >
                          <div className="truncate text-[10px] font-bold">{step.label}</div>
                          <div className="mt-0.5 truncate text-[10px] opacity-80">{step.detail}</div>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={openPromptEditor}
                        disabled={actionDisabled}
                        className="ui-btn ui-btn-sm h-9 px-2"
                      >
                        <EyeIcon className="h-3.5 w-3.5" />
                        提示词
                      </button>
                      <button
                        type="button"
                        onClick={copyPrompt}
                        disabled={actionDisabled}
                        className="ui-btn ui-btn-sm h-9 px-2"
                      >
                        <CopyIcon className="h-3.5 w-3.5" />
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPrompt()}
                        disabled={actionDisabled}
                        className={`ui-btn ui-btn-sm h-9 px-2 ${
                          currentActionFilled
                            ? '!border-transparent !bg-emerald-600 !text-white hover:!bg-emerald-500'
                            : 'ui-btn-soft'
                        }`}
                      >
                        {currentActionFilled ? (
                          <CheckIcon className="h-3.5 w-3.5" />
                        ) : (
                          <PhotoIcon className="h-3.5 w-3.5" />
                        )}
                        {currentActionFilled ? '已准备' : '准备'}
                      </button>
                      <button
                        type="button"
                        onClick={applyAndSubmit}
                        disabled={submitDisabled}
                        className="ui-btn ui-btn-primary col-span-3 h-10 text-sm"
                      >
                        <SparklesIcon className="h-4 w-4" />
                        {isSubmitting || currentSlotRunning
                          ? '生成中…'
                          : currentActionSubmitted
                            ? '生成新版本'
                            : '提交生成'}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
            {hasPlanOptions && (
              <button type="button" className="planner-secondary-link" onClick={() => setStage('style')}>
                {selectedStyleCandidate ? '当前风格：' + selectedStyleCandidate.label + ' · 更换' : '前往选择风格板'}
              </button>
            )}
            <details className="planner-disclosure mt-3">
              <summary>生成检查与规格</summary>
              <div className="grid grid-cols-2 gap-2">
                {checks.map((check) => (
                  <div
                    key={check.label}
                    className={`rounded-xl border px-3 py-2 ${check.status === 'ready' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200' : check.status === 'missing' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200'}`}
                  >
                    <div className="text-xs font-semibold">{check.label}</div>
                    <div className="mt-0.5 text-[11px] opacity-80">{check.detail}</div>
                  </div>
                ))}
              </div>
            </details>
          </div>
          <details className="planner-disclosure mt-3" open={stage === 'results' ? true : undefined}>
            <summary>
              通用生图输入栏 <span>提示词、模型与高级参数</span>
            </summary>
            {generationPanel}
          </details>
          {stage === 'production' && (
            <button type="button" className="planner-secondary-link" onClick={() => setStage('results')}>
              查看生成记录与导出 →
            </button>
          )}
        </aside>
      </div>
      {promptEditor && (
        <div
          data-no-drag-select
          className="fixed inset-0 z-[115] flex items-center justify-center p-4"
          onClick={() => setPromptEditor(null)}
        >
          <div className="ui-backdrop animate-overlay-in absolute inset-0" />
          <div
            className="ui-modal animate-modal-in relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
              <div className="min-w-0">
                <div className="truncate text-base font-bold text-[var(--text-1)]">{promptEditor.title}</div>
                <div className="mt-0.5 text-xs text-[var(--text-3)]">
                  保存后，“准备”和“提交生成”会优先使用这里的提示词。
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPromptEditor(null)}
                className="ui-icon-btn"
                aria-label="关闭提示词编辑"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 p-5">
              <textarea
                value={promptEditor.value}
                onChange={(event) =>
                  setPromptEditor((current) => (current ? { ...current, value: event.target.value } : current))
                }
                className="ui-input h-[60vh] resize-none font-mono text-xs leading-relaxed"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2.5 border-t border-[var(--line)] bg-[var(--surface-inset)] px-5 py-3.5">
              <button
                type="button"
                onClick={() => setPromptEditor((current) => (current ? { ...current, value: activePrompt } : current))}
                className="ui-btn h-10"
              >
                恢复 AI 提示词
              </button>
              <button type="button" onClick={() => setPromptEditor(null)} className="ui-btn h-10">
                取消
              </button>
              <button type="button" onClick={savePromptEditor} className="ui-btn ui-btn-primary h-10 px-5">
                保存提示词
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
