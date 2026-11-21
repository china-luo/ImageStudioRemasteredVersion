import type { ApiProfile, AppSettings, InputImage, MaskDraft, TaskParams, TaskRecord } from '../types'
import {
  canApiProfileGenerateImages,
  createSettingsForApiProfile,
  getActiveApiProfile,
  getImageGenerationProfile,
  normalizeSettings,
  validateApiProfile,
} from './apiProfiles'
import { getInputImageLimitForSettings } from './paramCompatibility'
import { validateMaskMatchesImage } from './canvasImage'
import { orderInputImagesForMask } from './mask'
import { isAmazonListingMainSlot } from './listingPlanner'

export type PendingTaskCategory =
  | { mode: 'prompt-match'; prompt: string; apiPrompt?: string; category: NonNullable<TaskRecord['category']> }
  | { mode: 'next-submit'; category: NonNullable<TaskRecord['category']> }

type ConfirmDialog = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: 'warning' | 'danger'
  action: () => void
}

export type GallerySubmissionDependencies = {
  getState: () => {
    settings: AppSettings
    prompt: string
    inputImages: InputImage[]
    maskDraft: MaskDraft | null
    params: TaskParams
    reusedTaskApiProfileId: string | null
    reusedTaskApiProfileName: string | null
    reusedTaskApiProfileMissing: boolean
    pendingTaskCategory: PendingTaskCategory | null
  }
  setReusedTaskApiProfile: (id: string | null) => void
  setShowSettings: (show: boolean, tab?: 'api' | 'general' | 'data' | 'about') => void
  setConfirmDialog: (dialog: ConfirmDialog) => void
  clearMaskDraft: () => void
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
  ensureImageCached: (id: string) => Promise<string | null>
  storeImage: (dataUrl: string, source?: 'upload' | 'generated' | 'mask') => Promise<string>
  cacheImage: (id: string, dataUrl: string) => void
  submitPrepared: (options: {
    profile: ApiProfile
    requestSettings: AppSettings
    prompt: string
    inputImages: InputImage[]
    params: TaskParams
    category: NonNullable<TaskRecord['category']>
    maskTargetImageId: string | null
    maskImageId: string | null
    clearInputAfterSubmit: boolean
  }) => Promise<boolean>
}

function removeMainStyleReference(category: NonNullable<TaskRecord['category']>) {
  if (
    category.workflow !== 'amazon-listing' ||
    !isAmazonListingMainSlot(category.amazonSlot) ||
    !category.styleReferenceImageId
  )
    return category
  const nextCategory = { ...category }
  delete nextCategory.styleReferenceImageId
  return nextCategory
}

function resolvePendingTaskCategory(
  pending: PendingTaskCategory | null,
  prompt: string,
): NonNullable<TaskRecord['category']> {
  if (!pending) return { workflow: 'gallery' }
  if (pending.mode === 'next-submit') return removeMainStyleReference(pending.category)
  const category = pending.prompt.trim() === prompt ? pending.category : { workflow: 'gallery' as const }
  return removeMainStyleReference(category)
}

function resolvePendingTaskPrompt(pending: PendingTaskCategory | null, prompt: string) {
  if (pending?.mode !== 'prompt-match' || pending.prompt.trim() !== prompt) return prompt
  return pending.apiPrompt?.trim() || prompt
}

function getApiModeApiName(apiMode: AppSettings['apiMode']) {
  if (apiMode === 'responses') return 'Responses API'
  if (apiMode === 'chat') return 'Chat Completions API'
  return 'Image API'
}

export async function submitGalleryTask(
  deps: GallerySubmissionDependencies,
  options: { allowFullMask?: boolean; useCurrentApiProfileWhenReusedMissing?: boolean } = {},
): Promise<boolean> {
  const state = deps.getState()
  const normalizedSettings = normalizeSettings(state.settings)
  const currentProfile = getActiveApiProfile(state.settings)
  let activeProfile = getImageGenerationProfile(state.settings) ?? currentProfile
  let requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)

  if (
    normalizedSettings.reuseTaskApiProfileTemporarily &&
    (state.reusedTaskApiProfileId || state.reusedTaskApiProfileMissing)
  ) {
    const reusedProfile = state.reusedTaskApiProfileId
      ? normalizedSettings.profiles.find((profile) => profile.id === state.reusedTaskApiProfileId)
      : undefined
    if (!reusedProfile) {
      if (options.useCurrentApiProfileWhenReusedMissing) {
        deps.setReusedTaskApiProfile(null)
      } else {
        deps.setConfirmDialog({
          title: '找不到 API 配置',
          message: `找不到复用任务所使用的 API 配置「${state.reusedTaskApiProfileName || '未知配置'}」，要使用当前的 API 配置「${activeProfile.name}」提交任务吗？`,
          confirmText: '使用当前配置提交',
          cancelText: '放弃提交',
          action: () => void submitGalleryTask(deps, { ...options, useCurrentApiProfileWhenReusedMissing: true }),
        })
        return false
      }
    } else {
      activeProfile = canApiProfileGenerateImages(reusedProfile)
        ? reusedProfile
        : (getImageGenerationProfile(state.settings) ?? reusedProfile)
      requestSettings = createSettingsForApiProfile(normalizedSettings, reusedProfile)
    }
  }

  if (!canApiProfileGenerateImages(activeProfile)) {
    deps.setConfirmDialog({
      title: '当前配置不能生图',
      message: `当前配置「${activeProfile.name}」使用 ${getApiModeApiName(activeProfile.apiMode)}，普通生图只支持 Images API，OpenRouter 图片模型可使用 Chat Completions。生成图片前，请切换到生图配置。`,
      confirmText: '去切换配置',
      cancelText: '取消',
      action: () => deps.setShowSettings(true, 'api'),
    })
    return false
  }

  requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  if (activeProfile.id !== currentProfile.id) deps.showToast(`已自动使用生图 API 配置「${activeProfile.name}」`, 'info')

  const profileError = validateApiProfile(activeProfile)
  if (profileError) {
    deps.showToast(`请先完善请求 API 配置：${profileError}`, 'error')
    deps.setShowSettings(true, 'api')
    return false
  }

  const trimmedPrompt = state.prompt.trim()
  const taskPrompt = resolvePendingTaskPrompt(state.pendingTaskCategory, trimmedPrompt)
  if (!taskPrompt.trim()) {
    deps.showToast('请输入提示词', 'error')
    return false
  }
  const category = resolvePendingTaskCategory(state.pendingTaskCategory, trimmedPrompt)
  let orderedInputImages = state.inputImages
  const inputImageLimit = getInputImageLimitForSettings(requestSettings)
  if (orderedInputImages.length > inputImageLimit) {
    deps.showToast(`上传参考图不能超过 ${inputImageLimit} 张，请删除多余参考图后再提交。`, 'error')
    return false
  }

  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null
  if (state.maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(state.inputImages, state.maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(state.maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        deps.setConfirmDialog({
          title: '确认编辑整张图片？',
          message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
          confirmText: '继续提交',
          tone: 'warning',
          action: () => void submitGalleryTask(deps, { ...options, allowFullMask: true }),
        })
        return false
      }
      maskImageId = await deps.storeImage(state.maskDraft.maskDataUrl, 'mask')
      deps.cacheImage(maskImageId, state.maskDraft.maskDataUrl)
      maskTargetImageId = state.maskDraft.targetImageId
    } catch (error) {
      if (!state.inputImages.some((image) => image.id === state.maskDraft?.targetImageId)) deps.clearMaskDraft()
      deps.showToast(error instanceof Error ? error.message : String(error), 'error')
      return false
    }
  }

  const styleReferenceImageId = category.styleReferenceImageId?.trim()
  if (styleReferenceImageId && !orderedInputImages.some((image) => image.id === styleReferenceImageId)) {
    const dataUrl = await deps.ensureImageCached(styleReferenceImageId)
    if (!dataUrl) {
      deps.showToast('已选择的风格参考板不存在，请重新生成并选择风格板。', 'error')
      return false
    }
    orderedInputImages = [...orderedInputImages, { id: styleReferenceImageId, dataUrl }]
  }

  return deps.submitPrepared({
    profile: activeProfile,
    requestSettings,
    prompt: taskPrompt,
    inputImages: orderedInputImages,
    params: state.params,
    category,
    maskTargetImageId,
    maskImageId,
    clearInputAfterSubmit: state.settings.clearInputAfterSubmit,
  })
}
