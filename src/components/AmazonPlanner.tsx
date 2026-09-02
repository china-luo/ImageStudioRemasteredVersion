import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { addImageFromFile, ensureImageCached, submitTask, useStore } from '../store'
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
import { DEFAULT_AMAZON_PROMPT_DRAFT, type AmazonPromptDraft } from '../lib/amazonPrompt'
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
import { deleteAmazonPlannerSession, getAllAmazonPlannerSessions } from '../lib/db'
import { normalizeParamsForSettings } from '../lib/paramCompatibility'
import { resolvePlannerStyleReference } from '../lib/plannerActionPolicy'
import { DEFAULT_PARAMS } from '../types'
import type { AmazonPlannerSession } from '../types'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  EyeIcon,
  PhotoIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from './icons'
import PlannerHistoryDrawer from './planner/PlannerHistoryDrawer'
import PlannerHeader from './planner/PlannerHeader'
import PlannerInputPanel from './planner/PlannerInputPanel'
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
  sortPlannerSessions,
  toSessionDraft,
  updateDraft,
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

const FIELD_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500'
const LABEL_CLASS = 'mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400'
const PLAN_LIST_CLASS =
  'grid max-h-[420px] gap-2 overflow-y-auto overscroll-contain pr-1 custom-scrollbar sm:max-h-[480px]'
const GUIDE_HINT_CLASS =
  'mb-3 rounded-lg border border-blue-200 bg-white/85 px-3 py-2 text-xs font-medium leading-relaxed text-blue-800 shadow-sm dark:border-blue-400/25 dark:bg-blue-400/10 dark:text-blue-100'
const API_MAX_IMAGES = 16

export default function AmazonPlanner() {
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
  const styleSectionRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState<AmazonPromptDraft>(DEFAULT_AMAZON_PROMPT_DRAFT)
  const [resolution, setResolution] = useState<'2k' | '4k'>('2k')
  const [plannerPlatform, setPlannerPlatform] = useState<CommercePlannerPlatform>('amazon')
  const [marketplaceId, setMarketplaceId] = useState<AmazonMarketplaceId>(DEFAULT_AMAZON_MARKETPLACE_ID)
  const [plannerMode, setPlannerMode] = useState<AmazonPlannerMode>('listing')
  const [tiktokDesignType, setTiktokDesignType] = useState<TiktokDesignType>('main')
  const [aPlusType, setAPlusType] = useState<APlusContentType>('standard-large')
  const [aPlusModuleSpecsByType, setAPlusModuleSpecsByType] = useState<APlusModuleSpecsByType>({})
  const [listingText, setListingText] = useState('')
  const [imagePlans, setImagePlans] = useState<AmazonImagePlan[]>([])
  const [aPlusPlans, setAPlusPlans] = useState<AmazonAPlusPlan[]>([])
  const [seriesStyleGuides, setSeriesStyleGuides] = useState<{
    listing: string
    aplus: string
    tiktokMain: string
    tiktokDetail: string
  }>({
    listing: '',
    aplus: '',
    tiktokMain: '',
    tiktokDetail: '',
  })
  const [styleCandidates, setStyleCandidates] = useState<AmazonStyleCandidate[]>([])
  const [styleImages, setStyleImages] = useState<StyleImageState[]>([])
  const styleImagesRef = useRef<StyleImageState[]>([])
  const [selectedStyleIndex, setSelectedStyleIndex] = useState<number | null>(null)
  const [styleDensityMode, setStyleDensityMode] = useState<AmazonStyleDensityMode>('rich')
  const [stylePreview, setStylePreview] = useState<StylePreviewState | null>(null)
  const [isGeneratingStyleImages, setIsGeneratingStyleImages] = useState(false)
  const [styleError, setStyleError] = useState('')
  const [selectedPlanIndex, setSelectedPlanIndex] = useState<number | null>(null)
  const [selectedAPlusPlanIndex, setSelectedAPlusPlanIndex] = useState<number | null>(null)
  const [plannerSessions, setPlannerSessions] = useState<AmazonPlannerSession[]>([])
  const [currentPlannerSessionId, setCurrentPlannerSessionId] = useState<string | null>(null)
  const [showPlannerHistory, setShowPlannerHistory] = useState(false)
  const [isPlanning, setIsPlanning] = useState(false)
  const [plannerError, setPlannerError] = useState('')
  const [isPreparingReferencePayload, setIsPreparingReferencePayload] = useState(false)
  const [referencePayloadNotice, setReferencePayloadNotice] = useState('')
  const [actionProgress, setActionProgress] = useState<PlannerActionProgressMap>({})
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>({})
  const [promptEditor, setPromptEditor] = useState<PromptEditorState | null>(null)
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
    ...(plannerProfile?.model &&
    !OPENAI_PLANNER_MODELS.includes(plannerProfile.model as (typeof OPENAI_PLANNER_MODELS)[number])
      ? [{ label: `${plannerProfile.model}（当前自定义）`, value: plannerProfile.model }]
      : []),
    ...OPENAI_PLANNER_MODELS.map((model) => ({
      label: model === DEFAULT_RESPONSES_MODEL ? `${model}（默认）` : model,
      value: model,
    })),
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
  const submitDisabled = actionDisabled
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

  const { savePlannerSession, updateCurrentPlannerSession } = useAmazonPlannerController(
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
    setCurrentPlannerSessionId,
    setPlannerSessions,
    showToast,
  )

  useEffect(() => {
    let cancelled = false
    getAllAmazonPlannerSessions()
      .then((sessions) => {
        if (!cancelled) setPlannerSessions(sortPlannerSessions(sessions))
      })
      .catch((err) => {
        if (!cancelled) showToast(`策划历史加载失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    return () => {
      cancelled = true
    }
  }, [showToast])

  useEffect(() => {
    return () => {
      plannerAbortControllerRef.current?.abort()
      plannerAbortControllerRef.current = null
      styleAbortControllerRef.current?.abort()
      styleAbortControllerRef.current = null
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

  const applyAndSubmit = () => {
    if (!applyPrompt({ requireStyle: true })) return
    const submittedActionKey = currentActionKey
    queueMicrotask(() => {
      void submitTask().then((submitted) => {
        if (submitted) markActionProgress(submittedActionKey, 'submitted')
      })
    })
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
      setIsPreparingReferencePayload(false)
      if (styleAbortControllerRef.current === controller) {
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
      setIsPreparingReferencePayload(false)
      if (styleAbortControllerRef.current === controller) {
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
    void savePlannerSession({
      id: createPlannerSessionId(),
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
      })
      if (controller.signal.aborted) return
      setReferencePayloadNotice(workflow.referencePayloadNotice)
      applyPlannerResult(workflow.result, plannerMode === 'aplus' ? 'A+ AI 策划' : 'AI 策划')
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return
      setPlannerError(getPlannerFailureDetail(err))
      showToast('AI 策划失败，请查看详情', 'error')
    } finally {
      setIsPreparingReferencePayload(false)
      if (plannerAbortControllerRef.current === controller) {
        plannerAbortControllerRef.current = null
        setIsPlanning(false)
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

  const restorePlannerSession = async (session: AmazonPlannerSession) => {
    const restoredReferences = []
    for (const imageId of session.referenceImageIds) {
      const dataUrl = await ensureImageCached(imageId)
      if (dataUrl) restoredReferences.push({ id: imageId, dataUrl })
    }

    const restoredStyleImages: StyleImageState[] = []
    for (const image of session.styleImages) {
      const dataUrl = await ensureImageCached(image.imageId)
      if (dataUrl) {
        restoredStyleImages.push({
          candidateIndex: image.candidateIndex,
          status: 'done',
          imageId: image.imageId,
          dataUrl,
        })
      }
    }

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
    showToast('策划历史已恢复', 'success')
  }

  const removePlannerSession = async (sessionId: string) => {
    try {
      await deleteAmazonPlannerSession(sessionId)
      setPlannerSessions((current) => current.filter((session) => session.id !== sessionId))
      if (currentPlannerSessionId === sessionId) setCurrentPlannerSessionId(null)
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
    }
  }

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleFiles(event.target.files || [])
    event.target.value = ''
  }

  return (
    <section
      data-no-drag-select
      className="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-gray-900"
    >
      <div className="border-b border-gray-200 px-4 py-4 dark:border-white/[0.08] sm:px-5">
        <PlannerHeader
          platform={plannerPlatform}
          mode={plannerMode}
          tiktokDesignType={tiktokDesignType}
          resolution={resolution}
          historyOpen={showPlannerHistory}
          historyCount={plannerSessions.length}
          onPlatformChange={changePlannerPlatform}
          onModeChange={changePlannerMode}
          onTiktokDesignTypeChange={changeTiktokDesignType}
          onResolutionChange={setResolution}
          onToggleHistory={() => setShowPlannerHistory((value) => !value)}
        />
        {showPlannerHistory && (
          <PlannerHistoryDrawer
            sessions={plannerSessions}
            currentSessionId={currentPlannerSessionId}
            onClose={() => setShowPlannerHistory(false)}
            onRestore={restorePlannerSession}
            onRemove={removePlannerSession}
            onError={(message) => showToast(message, 'error')}
          />
        )}
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="border-b border-gray-200 p-4 dark:border-white/[0.08] sm:p-5 lg:border-b-0 lg:border-r">
          <div className={`rounded-xl border p-3 shadow-sm transition ${getGuidePanelClass(plannerGuideActive)}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  {plannerMode === 'aplus' ? 'A+ 图片策划' : 'Listing 智能策划'}
                </div>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {plannerMode === 'aplus'
                    ? '粘贴标题、五点描述或品牌说明，生成普通A+ / 标准A+ / 高级A+ / 手机A+模块编排和英文提示词。'
                    : '粘贴标题、五点描述或产品说明，生成 Main + PT01-PT06 的逐张方案和英文提示词。'}
                </div>
              </div>
              <div className="rounded-lg bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                双配置
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

          <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/[0.08] dark:bg-gray-950">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">参考图</div>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
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
                  onClick={() => !atImageLimit && fileInputRef.current?.click()}
                  disabled={atImageLimit}
                  className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition ${atImageLimit ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-white/[0.04] dark:text-gray-500' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]'}`}
                >
                  <PlusIcon className="h-4 w-4" />
                  上传参考图
                </button>
                <button
                  type="button"
                  onClick={() => !atImageLimit && cameraInputRef.current?.click()}
                  disabled={atImageLimit}
                  className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition sm:hidden ${atImageLimit ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-white/[0.04] dark:text-gray-500' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]'}`}
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
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-400/20 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-400/10"
                  >
                    <TrashIcon className="h-4 w-4" />
                    清空
                  </button>
                )}
              </div>
            </div>

            {(isPreparingReferencePayload || referencePayloadNotice) && (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${isPreparingReferencePayload ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200'}`}
              >
                {isPreparingReferencePayload ? '正在压缩参考图...' : referencePayloadNotice}
              </div>
            )}

            {inputImages.length > 0 ? (
              <PlannerReferenceImageGrid
                images={inputImages}
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
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 flex min-h-[88px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white text-center transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-white/[0.12] dark:bg-gray-900 dark:hover:border-blue-400/50 dark:hover:bg-blue-400/10"
              >
                <PhotoIcon className="h-5 w-5 text-gray-400" />
                <span className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-200">上传产品参考图</span>
                <span className="mt-1 text-xs text-gray-400">支持多选、拖到底部输入栏或直接在这里选择文件</span>
              </button>
            )}

            {atImageLimit && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                参考图数量已达上限（{API_MAX_IMAGES} 张），请删除不需要的图片后再上传。
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label>
              <span className={LABEL_CLASS}>商品标题</span>
              <input
                value={draft.productTitle}
                onChange={(event) => setDraft((current) => updateDraft(current, 'productTitle', event.target.value))}
                className={FIELD_CLASS}
                placeholder="例：Stainless Steel Insulated Travel Mug"
              />
            </label>
            <label>
              <span className={LABEL_CLASS}>类目</span>
              <input
                value={draft.category}
                onChange={(event) => setDraft((current) => updateDraft(current, 'category', event.target.value))}
                className={FIELD_CLASS}
                placeholder="例：Kitchen / Sports / Home"
              />
            </label>
            <label>
              <span className={LABEL_CLASS}>品牌 / 型号</span>
              <input
                value={draft.brand}
                onChange={(event) => setDraft((current) => updateDraft(current, 'brand', event.target.value))}
                className={FIELD_CLASS}
                placeholder="只填商品真实品牌或型号"
              />
            </label>
            <label>
              <span className={LABEL_CLASS}>颜色</span>
              <input
                value={draft.color}
                onChange={(event) => setDraft((current) => updateDraft(current, 'color', event.target.value))}
                className={FIELD_CLASS}
                placeholder="例：matte black"
              />
            </label>
            <label>
              <span className={LABEL_CLASS}>材质 / 表面工艺</span>
              <input
                value={draft.material}
                onChange={(event) => setDraft((current) => updateDraft(current, 'material', event.target.value))}
                className={FIELD_CLASS}
                placeholder="例：304 stainless steel, silicone lid"
              />
            </label>
            <label>
              <span className={LABEL_CLASS}>目标人群</span>
              <input
                value={draft.audience}
                onChange={(event) => setDraft((current) => updateDraft(current, 'audience', event.target.value))}
                className={FIELD_CLASS}
                placeholder="例：commuters, office workers"
              />
            </label>
            <label className="md:col-span-2">
              <span className={LABEL_CLASS}>卖点</span>
              <textarea
                value={draft.sellingPoints}
                onChange={(event) => setDraft((current) => updateDraft(current, 'sellingPoints', event.target.value))}
                className={`${FIELD_CLASS} min-h-[86px] resize-y`}
                placeholder="一行一个卖点，或用分号分隔"
              />
            </label>
            <label>
              <span className={LABEL_CLASS}>包装清单</span>
              <textarea
                value={draft.packageIncludes}
                onChange={(event) => setDraft((current) => updateDraft(current, 'packageIncludes', event.target.value))}
                className={`${FIELD_CLASS} min-h-[76px] resize-y`}
                placeholder="例：1 mug, 1 lid, 1 straw"
              />
            </label>
            <label>
              <span className={LABEL_CLASS}>场景 / 构图</span>
              <textarea
                value={draft.scene}
                onChange={(event) => setDraft((current) => updateDraft(current, 'scene', event.target.value))}
                className={`${FIELD_CLASS} min-h-[76px] resize-y`}
                placeholder="例：白底产品构图 / 厨房台面场景 / 尺寸标注信息图"
              />
            </label>
            <label className="md:col-span-2">
              <span className={LABEL_CLASS}>禁用元素</span>
              <input
                value={draft.forbidden}
                onChange={(event) => setDraft((current) => updateDraft(current, 'forbidden', event.target.value))}
                className={FIELD_CLASS}
                placeholder="例：do not show phone, laptop, gift box"
              />
            </label>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {showStickyActions && (
            <>
              <div
                data-amazon-action-bar
                className={`fixed left-3 right-3 top-[7.25rem] z-30 rounded-xl border p-3 shadow-lg shadow-gray-900/5 backdrop-blur transition dark:shadow-black/20 sm:sticky sm:left-auto sm:right-auto sm:top-20 sm:mb-4 ${getGuidePanelClass(actionBarGuideActive)}`}
              >
                <div className="flex flex-col gap-3">
                  {actionBarGuideActive && <div className={GUIDE_HINT_CLASS}>{guideState.message}</div>}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">
                          {actionSlot ?? (plannerMode === 'aplus' ? 'A+' : '当前')}
                        </span>
                        <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {actionLabel ?? (plannerMode === 'aplus' ? '请选择 A+ 模块' : '当前图片方案')}
                        </span>
                        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-white/[0.08] dark:text-gray-300">
                          {actionPositionLabel}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                        {targetSize} / {generationParamLabel}
                        {plannerMode === 'aplus' && selectedAPlusPlan
                          ? ` · 上传建议 ${selectedAPlusPlan.uploadSize}`
                          : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => stepVisiblePlan(-1)}
                        disabled={!canGoPrev}
                        className={`inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition ${canGoPrev ? 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]' : 'cursor-not-allowed border-gray-100 bg-gray-100 text-gray-300 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-gray-600'}`}
                      >
                        <ChevronLeftIcon className="h-3.5 w-3.5" />
                        上一张
                      </button>
                      <button
                        type="button"
                        onClick={() => stepVisiblePlan(1)}
                        disabled={!canGoNext}
                        className={`inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition ${currentActionSubmitted && canGoNext ? 'border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-blue-500' : canGoNext ? 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]' : 'cursor-not-allowed border-gray-100 bg-gray-100 text-gray-300 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-gray-600'}`}
                      >
                        下一张
                        <ChevronRightIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div
                    className={`rounded-lg border px-3 py-2 text-xs font-medium ${currentActionSubmitted ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200' : currentActionFilled ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200' : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200'}`}
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

                  <div className="grid grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={openPromptEditor}
                      disabled={actionDisabled}
                      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition ${actionDisabled ? 'cursor-not-allowed border-gray-100 bg-gray-100 text-gray-300 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-gray-600' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]'}`}
                    >
                      <EyeIcon className="h-3.5 w-3.5" />
                      提示词
                    </button>
                    <button
                      type="button"
                      onClick={copyPrompt}
                      disabled={actionDisabled}
                      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition ${actionDisabled ? 'cursor-not-allowed border-gray-100 bg-gray-100 text-gray-300 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-gray-600' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]'}`}
                    >
                      <CopyIcon className="h-3.5 w-3.5" />
                      复制
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPrompt()}
                      disabled={actionDisabled}
                      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition ${actionDisabled ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-white/[0.06] dark:text-gray-600' : currentActionFilled ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200'}`}
                    >
                      {currentActionFilled ? (
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <PhotoIcon className="h-3.5 w-3.5" />
                      )}
                      {currentActionFilled ? '已准备' : '准备'}
                    </button>
                    <button
                      type="button"
                      onClick={applyAndSubmit}
                      disabled={submitDisabled || currentActionSubmitted}
                      className={`inline-flex h-9 items-center justify-center rounded-lg px-2 text-xs font-semibold transition ${currentActionSubmitted ? 'cursor-default bg-emerald-600 text-white' : submitDisabled ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-white/[0.06] dark:text-gray-600' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
                    >
                      {currentActionSubmitted ? '已提交' : '提交生成'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="h-[218px] sm:hidden" aria-hidden="true" />
            </>
          )}
          {hasPlanOptions && (
            <div
              ref={styleSectionRef}
              className={`mb-4 rounded-xl border p-3 transition ${getGuidePanelClass(styleGuideActive, 'muted')}`}
            >
              {styleGuideActive && <div className={GUIDE_HINT_CLASS}>{guideState.message}</div>}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">视觉风格选择</div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {imageGenerationProfile
                      ? `生成低清风格参考板时，将自动使用生图配置「${imageGenerationProfile.name}」${imageGenerationProfileValidation ? `（${imageGenerationProfileValidation}）` : ''}。`
                      : imageGenerationProfileValidation}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex h-9 rounded-lg border border-gray-200 bg-white p-0.5 text-xs font-semibold dark:border-white/[0.08] dark:bg-gray-900">
                    {STYLE_DENSITY_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => changeStyleDensityMode(option.value)}
                        className={`rounded-md px-2.5 transition ${styleDensityMode === option.value ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={confirmGenerateStyleImages}
                    disabled={isGeneratingStyleImages || activeStyleCandidates.length === 0}
                    className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition ${isGeneratingStyleImages || activeStyleCandidates.length === 0 ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-white/[0.06] dark:text-gray-600' : 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200'} ${guideState.target === 'style' ? 'ring-2 ring-blue-500/25 ring-offset-2 ring-offset-blue-50 dark:ring-offset-gray-950' : ''}`}
                  >
                    <PhotoIcon className="h-4 w-4" />
                    {isGeneratingStyleImages ? '生成中...' : '生成风格板'}
                  </button>
                  {isGeneratingStyleImages && (
                    <button
                      type="button"
                      onClick={stopGeneratingStyleImages}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white transition hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400"
                    >
                      <CloseIcon className="h-4 w-4" />
                      停止
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white/70 p-2.5 dark:border-white/[0.08] dark:bg-gray-950/40">
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">AI 策划风格候选</div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                        使用 AI 策划返回的风格候选动态生成风格板。
                      </div>
                    </div>
                    <span
                      className={`rounded px-2 py-1 text-[11px] font-semibold ${styleCandidates.length ? 'bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200' : 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-200'}`}
                    >
                      {styleCandidates.length ? `${styleCandidates.length} 个候选` : '暂无候选'}
                    </span>
                  </div>
                  {!styleCandidates.length && (
                    <div className="rounded-lg border border-dashed border-gray-300 bg-white/60 px-3 py-4 text-center text-xs leading-relaxed text-gray-500 dark:border-white/[0.12] dark:bg-gray-900/50 dark:text-gray-400">
                      当前策划结果没有风格候选。请重新执行 AI 策划后再生成风格板。
                    </div>
                  )}
                </div>
              </div>
              {styleError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">
                  {styleError}
                </div>
              )}
              {activeStyleCandidates.length > 0 && (
                <div
                  className={`mt-3 grid gap-2 rounded-xl transition sm:grid-cols-3 ${getGuideFocusClass(guideState.target === 'style-choice')}`}
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
                        className={`relative min-w-0 overflow-hidden rounded-xl border text-left transition ${isSelected ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-500/15 dark:border-violet-300/70 dark:bg-violet-500/10' : canSelect ? 'border-gray-200 bg-white hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.05]' : 'border-gray-200 bg-white opacity-80 dark:border-white/[0.08] dark:bg-gray-900'}`}
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
                            className="absolute right-2 top-2 z-10 inline-flex h-8 items-center gap-1 rounded-lg bg-white/95 px-2 text-[11px] font-semibold text-gray-700 shadow-sm ring-1 ring-black/5 transition hover:bg-white dark:bg-gray-950/90 dark:text-gray-100 dark:ring-white/10 dark:hover:bg-gray-900"
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
                          <div className="aspect-square bg-gray-100 dark:bg-white/[0.04]">
                            {imageState?.status === 'done' && imageState.dataUrl ? (
                              <img
                                src={imageState.dataUrl}
                                alt={candidate.label}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-gray-400">
                                <span>{getStyleImagePlaceholder(imageState?.status)}</span>
                                {canOpenFailureDetail && (
                                  <span className="rounded bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 dark:bg-red-400/10 dark:text-red-200">
                                    点击查看 / 重试
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                                {candidate.label}
                              </span>
                              {isSelected && (
                                <span className="shrink-0 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  已选
                                </span>
                              )}
                            </div>
                            <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
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
                  className="pointer-events-none fixed z-50 hidden w-[420px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl sm:block dark:border-white/[0.08] dark:bg-gray-950"
                  style={{ left: stylePreview.left, top: stylePreview.top }}
                >
                  <img
                    src={stylePreview.dataUrl}
                    alt=""
                    className="aspect-square w-full bg-gray-100 object-contain dark:bg-white/[0.04]"
                  />
                  <div className="border-t border-gray-100 p-3 dark:border-white/[0.08]">
                    <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {stylePreview.label}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      {stylePreview.description}
                    </div>
                  </div>
                </div>
              )}
              {selectedStyleCandidate && selectedStyleImage?.imageId && (
                <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-relaxed text-violet-800 dark:border-violet-300/20 dark:bg-violet-400/10 dark:text-violet-200">
                  {isMainListingPlan
                    ? `已选择「${selectedStyleCandidate.label}」，但当前 MAIN 主图不会附加这张风格板；切换到附图或 A+ 时才会作为隐藏参考。`
                    : `已选择「${selectedStyleCandidate.label}」。正式生成时会隐藏附加这张风格参考板作为最后一张参考图，用于统一字体感觉、色板、光影、材质和标注样式，不复制其中占位文字、固定版式或产品摆放；风格板不占上传参考图数量。`}
                </div>
              )}
              {uploadedReferenceLimitExceeded && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                  上传参考图不能超过 {API_MAX_IMAGES} 张；风格板单独使用，不计入这个数量。
                </div>
              )}
            </div>
          )}
          {plannerMode === 'listing' && imagePlans.length > 0 && (
            <div className={`mb-4 rounded-xl border p-3 transition ${getGuidePanelClass(planListGuideActive)}`}>
              {planListGuideActive && <div className={GUIDE_HINT_CLASS}>{guideState.message}</div>}
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">逐张策划</div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    选择图片位后，生成按钮会切换到对应提示词。
                  </div>
                </div>
                <span className="shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                  {imagePlans.length} 张
                </span>
              </div>
              <div className={PLAN_LIST_CLASS}>
                {imagePlans.map((plan, index) => {
                  const isSelected = selectedPlanIndex === index
                  const planActionProgress = actionProgress[getPlannerActionKey('listing', index, plan.slot)]
                  return (
                    <button
                      key={`${plan.slot}-${index}`}
                      type="button"
                      onClick={() => selectPlan(index)}
                      className={`rounded-xl border p-3 text-left transition ${isSelected ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-500/15 dark:border-blue-400/70 dark:bg-blue-500/10' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:hover:bg-white/[0.05]'}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-white/[0.08] dark:text-gray-300'}`}
                        >
                          {plan.slot}
                        </span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{plan.label}</span>
                        {isSelected && (
                          <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            当前
                          </span>
                        )}
                        {planActionProgress && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${planActionProgress === 'submitted' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200'}`}
                          >
                            {planActionProgress === 'submitted' ? '已提交' : '已准备'}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                        {getPlanSummary(plan.planMarkdown)}
                      </div>
                      <div className="mt-2 line-clamp-2 rounded-lg bg-white/70 px-2 py-1 text-[11px] leading-relaxed text-gray-500 dark:bg-white/[0.05] dark:text-gray-300">
                        Negative：{plan.negativePrompt || '未提供'}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {plannerMode === 'aplus' && aPlusPlansWithSizes.length > 0 && (
            <div className={`mb-4 rounded-xl border p-3 transition ${getGuidePanelClass(planListGuideActive)}`}>
              {planListGuideActive && <div className={GUIDE_HINT_CLASS}>{guideState.message}</div>}
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">A+ 模块编排</div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    选择模块后，生成按钮会切换到对应 A+ 提示词与尺寸。
                  </div>
                </div>
                <span className="shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                  {aPlusPlansWithSizes.length} 张
                </span>
              </div>
              <div className={PLAN_LIST_CLASS}>
                {aPlusPlansWithSizes.map((plan, index) => {
                  const isSelected = selectedAPlusPlanIndex === index
                  const externalText = formatAPlusModuleText(plan)
                  const planActionProgress = actionProgress[getPlannerActionKey('aplus', index, plan.slot)]
                  return (
                    <button
                      key={`${plan.slot}-${index}`}
                      type="button"
                      onClick={() => selectAPlusPlan(index)}
                      className={`rounded-xl border p-3 text-left transition ${isSelected ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-500/15 dark:border-blue-400/70 dark:bg-blue-500/10' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:hover:bg-white/[0.05]'}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-white/[0.08] dark:text-gray-300'}`}
                        >
                          {plan.slot}
                        </span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {getAPlusModuleDisplayName(plan)}
                        </span>
                        <span className="text-xs text-gray-400">{getAPlusModuleEnglishName(plan)}</span>
                        {isSelected && (
                          <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            当前
                          </span>
                        )}
                        {planActionProgress && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${planActionProgress === 'submitted' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200'}`}
                          >
                            {planActionProgress === 'submitted' ? '已提交' : '已准备'}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                        <span className="rounded-md bg-white/70 px-2 py-0.5 dark:bg-white/[0.05]">
                          上传 {plan.uploadSize}
                        </span>
                        <span className="rounded-md bg-white/70 px-2 py-0.5 dark:bg-white/[0.05]">
                          生成 {plan.generationSize}
                        </span>
                      </div>
                      <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                        {getPlanSummary(plan.planMarkdown)}
                      </div>
                      {(isAPlusTextModule(plan) || externalText) && externalText && (
                        <div className="mt-2 rounded-lg bg-white/70 px-2 py-1 text-xs leading-relaxed text-gray-700 dark:bg-white/[0.05] dark:text-gray-200">
                          {plan.textTitle && <div className="font-semibold">{plan.textTitle}</div>}
                          {plan.textBody && (
                            <div className="mt-0.5 line-clamp-2 text-gray-500 dark:text-gray-300">{plan.textBody}</div>
                          )}
                        </div>
                      )}
                      <div className="mt-2 line-clamp-2 rounded-lg bg-white/70 px-2 py-1 text-[11px] leading-relaxed text-gray-500 dark:bg-white/[0.05] dark:text-gray-300">
                        Negative：{plan.negativePrompt || '未提供'}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {plannerMode === 'aplus' && aPlusPlansWithSizes.length === 0 && (
            <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/[0.08] dark:bg-gray-950">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">A+ 模块编排</div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    当前选择 {getAPlusContentTypeLabel(aPlusType)}，可先调整模块数量，再点击 AI策划A+。
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={restoreDefaultAPlusModules}
                    disabled={isPlanning || aPlusSpecsAreDefault}
                    title="恢复当前 A+ 类型默认模块"
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition ${!isPlanning && !aPlusSpecsAreDefault ? 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.06] dark:hover:text-white' : 'cursor-not-allowed border-gray-100 bg-gray-100 text-gray-300 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-gray-600'}`}
                  >
                    <RefreshIcon className="h-3.5 w-3.5" />
                    恢复默认
                  </button>
                  <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                    {aPlusSpecs.length} 张
                  </span>
                </div>
              </div>
              <div className={PLAN_LIST_CLASS}>
                {aPlusSpecs.map((spec, index) => (
                  <div
                    key={spec.slot}
                    className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-gray-900"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600 dark:bg-white/[0.08] dark:text-gray-300">
                            {spec.slot}
                          </span>
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                            {getAPlusModuleDisplayName(spec)}
                          </span>
                          <span className="text-xs text-gray-400">{getAPlusModuleEnglishName(spec)}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
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
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${!isPlanning && aPlusSpecs.length < MAX_A_PLUS_MODULE_COUNT ? 'border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/20' : 'cursor-not-allowed border-gray-100 bg-gray-100 text-gray-300 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-gray-600'}`}
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
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${!isPlanning && aPlusSpecs.length > MIN_A_PLUS_MODULE_COUNT ? 'border-red-100 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200 dark:hover:bg-red-400/20' : 'cursor-not-allowed border-gray-100 bg-gray-100 text-gray-300 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-gray-600'}`}
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
          {plannerMode === 'aplus' && selectedAPlusPlan && (
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/[0.08] dark:bg-gray-950">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                  A+ 文案 · {selectedAPlusPlan.slot}
                </span>
                <button
                  type="button"
                  onClick={copyAPlusText}
                  disabled={!selectedAPlusText.trim()}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition ${selectedAPlusText.trim() ? 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]' : 'cursor-not-allowed border-gray-100 bg-gray-100 text-gray-300 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-gray-600'}`}
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
                className="h-28 w-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200"
                spellCheck={false}
                readOnly
              />
              <div className="mt-2 text-[11px] text-gray-400">
                外部 A+ 文案用于亚马逊模块文本区，不会写入图片生成 Prompt。
              </div>
            </div>
          )}
        </div>
      </div>
      {promptEditor && (
        <div
          data-no-drag-select
          className="fixed inset-0 z-[115] flex items-center justify-center p-4"
          onClick={() => setPromptEditor(null)}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-md dark:bg-black/50" />
          <div
            className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-950 dark:ring-white/10"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/[0.08]">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
                  {promptEditor.title}
                </div>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  保存后，“准备”和“提交生成”会优先使用这里的提示词。
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPromptEditor(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100"
                aria-label="关闭提示词编辑"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 p-4">
              <textarea
                value={promptEditor.value}
                onChange={(event) =>
                  setPromptEditor((current) => (current ? { ...current, value: event.target.value } : current))
                }
                className="h-[60vh] w-full resize-none rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs leading-relaxed text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-4 py-3 dark:border-white/[0.08]">
              <button
                type="button"
                onClick={() => setPromptEditor((current) => (current ? { ...current, value: activePrompt } : current))}
                className="inline-flex h-10 items-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                恢复 AI 提示词
              </button>
              <button
                type="button"
                onClick={() => setPromptEditor(null)}
                className="inline-flex h-10 items-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={savePromptEditor}
                className="inline-flex h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                保存提示词
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
