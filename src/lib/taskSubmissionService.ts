import type { ApiProfile, AppSettings, InputImage, TaskImageEditContext, TaskParams, TaskRecord } from '../types'
import {
  canApiProfileGenerateImages,
  createSettingsForApiProfile,
  getActiveApiProfile,
  getImageGenerationProfile,
  getHomeApiProfile,
  isAliyunQwenImageProfile,
  isVolcengineSeedreamProModel,
  normalizeSettings,
  validateApiProfile,
} from './apiProfiles'
import { getChangedParams, getInputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'

export interface SubmitTaskWithInputOptions {
  apiProfileId: string
  prompt: string
  inputImages: InputImage[]
  params: TaskParams
  category?: NonNullable<TaskRecord['category']>
  imageEditContext?: TaskImageEditContext
  maskTargetImageId?: string | null
  maskImageId?: string | null
}

interface SubmissionState {
  settings: AppSettings
  tasks: TaskRecord[]
  setTasks: (tasks: TaskRecord[]) => void
  setParams?: (params: Partial<TaskParams>) => void
  setPrompt?: (prompt: string) => void
  clearInputImages?: () => void
  setReusedTaskApiProfile?: (profileId: string | null) => void
  setPendingTaskCategory?: (category: null) => void
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
}

export interface TaskSubmissionServiceDependencies {
  getState: () => SubmissionState
  createId: () => string
  ensureImageCached: (imageId: string) => Promise<string | null>
  getImage: (imageId: string) => Promise<unknown>
  putImage: (image: { id: string; dataUrl: string; source: 'upload'; createdAt: number }) => Promise<unknown>
  storeInputImage: (dataUrl: string) => Promise<unknown>
  cacheImage: (imageId: string, dataUrl: string) => void
  putTask: (task: TaskRecord) => Promise<unknown>
  executeTask: (taskId: string) => void
  isCurrent?: () => boolean
  now?: () => number
}

export type RetryTaskResult =
  | { status: 'submitted'; taskId: string }
  | { status: 'cancelled' }
  | { status: 'unsupported-profile'; profile: ApiProfile }
  | { status: 'original-profile-error'; message: string }

export interface PreparedTaskSubmissionOptions {
  profile: ApiProfile
  requestSettings: AppSettings
  prompt: string
  inputImages: InputImage[]
  params: TaskParams
  category: NonNullable<TaskRecord['category']>
  maskTargetImageId: string | null
  maskImageId: string | null
  clearInputAfterSubmit: boolean
}

/** Creates editor-originated tasks without depending on Zustand, React, or the DOM. */
export function createTaskSubmissionService(deps: TaskSubmissionServiceDependencies) {
  const now = deps.now ?? Date.now
  const isCurrent = deps.isCurrent ?? (() => true)
  const persistTask = async (task: TaskRecord) => {
    if (!isCurrent()) return false
    try {
      await deps.putTask(task)
    } catch (error) {
      if (!isCurrent() || (error instanceof Error && error.name === 'AbortError')) return false
      deps.getState().showToast('任务未能保存到本地，未提交生成。', 'error')
      return false
    }
    if (!isCurrent()) return false
    const state = deps.getState()
    state.setTasks([task, ...state.tasks])
    return true
  }

  const submitWithInput = async (options: SubmitTaskWithInputOptions): Promise<string | null> => {
    const state = deps.getState()
    const settings = normalizeSettings(state.settings)
    const homeProfile = getHomeApiProfile(settings)
    const profile =
      homeProfile?.id === options.apiProfileId
        ? homeProfile
        : settings.profiles.find((item) => item.id === options.apiProfileId)
    if (!profile) {
      state.showToast('找不到指定的 API 配置', 'error')
      return null
    }
    if (!canApiProfileGenerateImages(profile)) {
      state.showToast(`配置「${profile.name}」不能生成图片`, 'error')
      return null
    }
    const profileError = validateApiProfile(profile)
    if (profileError) {
      state.showToast(`请先完善 API 配置：${profileError}`, 'error')
      return null
    }

    const prompt = options.prompt.trim()
    if (!prompt) {
      state.showToast('请输入编辑要求', 'error')
      return null
    }
    const requestSettings = createSettingsForApiProfile(settings, profile)
    const inputImageLimit = getInputImageLimitForSettings(requestSettings)
    if (options.inputImages.length > inputImageLimit) {
      state.showToast(`参考图数量不能超过 ${inputImageLimit} 张`, 'error')
      return null
    }

    const storedImages: InputImage[] = []
    try {
      for (const image of options.inputImages) {
        if (!isCurrent()) return null
        const dataUrl = image.dataUrl || (await deps.ensureImageCached(image.id))
        if (!isCurrent()) return null
        if (!dataUrl) throw new Error('输入图片已不存在')
        const storedImage = await deps.getImage(image.id)
        if (!isCurrent()) return null
        if (!storedImage) {
          await deps.putImage({ id: image.id, dataUrl, source: 'upload', createdAt: now() })
        }
        if (!isCurrent()) return null
        deps.cacheImage(image.id, dataUrl)
        storedImages.push({ id: image.id, dataUrl })
      }
    } catch (error) {
      if (isCurrent() && !(error instanceof Error && error.name === 'AbortError')) {
        state.showToast(error instanceof Error ? error.message : String(error), 'error')
      }
      return null
    }

    const taskId = deps.createId()
    const task: TaskRecord = {
      id: taskId,
      prompt,
      params: normalizeParamsForSettings(options.params, requestSettings, { hasInputImages: storedImages.length > 0 }),
      apiProvider: profile.provider,
      apiProfileId: profile.id,
      apiProfileName: profile.name,
      apiMode: profile.apiMode,
      apiModel: profile.model,
      inputImageIds: storedImages.map((image) => image.id),
      maskTargetImageId: options.maskTargetImageId ?? null,
      maskImageId: options.maskImageId ?? null,
      outputImages: [],
      status: 'running',
      error: null,
      createdAt: now(),
      finishedAt: null,
      elapsed: null,
      category: options.category ?? { workflow: 'seedream-edit' },
      imageEditContext: options.imageEditContext,
    }
    if (!(await persistTask(task)) || !isCurrent()) return null
    state.showToast('任务已提交', 'success')
    deps.executeTask(taskId)
    return taskId
  }

  const retry = async (task: TaskRecord): Promise<RetryTaskResult> => {
    const state = deps.getState()
    const settings = normalizeSettings(state.settings)
    const isEditorTask = task.category?.workflow === 'seedream-edit' || Boolean(task.imageEditContext)
    const profile = isEditorTask
      ? settings.profiles.find((item) => item.id === task.apiProfileId)
      : (getImageGenerationProfile(settings) ?? getActiveApiProfile(settings))
    if (!profile) {
      return {
        status: 'original-profile-error',
        message: '原编辑任务的 API 配置已不存在，请恢复原配置后重试，或在编辑器中重新提交。',
      }
    }
    if (isEditorTask) {
      const engine = task.imageEditContext?.engine ?? (task.apiProvider === 'volcengine' ? 'seedream' : 'home')
      if (
        !canApiProfileGenerateImages(profile) ||
        (task.apiProvider != null && profile.provider !== task.apiProvider) ||
        (engine === 'seedream' && (profile.provider !== 'volcengine' || !isVolcengineSeedreamProModel(profile.model)))
      ) {
        return {
          status: 'original-profile-error',
          message: `原编辑配置「${profile.name}」的类型或模型已不兼容，不能切换账号重试，请在编辑器中重新提交。`,
        }
      }
      const profileError = validateApiProfile(profile)
      if (profileError)
        return { status: 'original-profile-error', message: `原编辑配置「${profile.name}」不完整：${profileError}` }
    } else if (!canApiProfileGenerateImages(profile)) return { status: 'unsupported-profile', profile }

    const requestSettings = createSettingsForApiProfile(settings, profile)
    const styleImageId = task.category?.styleReferenceImageId?.trim()
    const extraStyle =
      !isAliyunQwenImageProfile(profile) && styleImageId && task.inputImageIds.includes(styleImageId) ? 1 : 0
    const inputImageLimit = getInputImageLimitForSettings(requestSettings) + extraStyle
    if (task.inputImageIds.length > inputImageLimit) {
      if (isCurrent()) {
        state.showToast(
          `无法重试：配置「${profile.name}」的当前模型「${profile.model}」最多支持 ${inputImageLimit} 张参考图，此任务有 ${task.inputImageIds.length} 张。请减少参考图后重新提交。`,
          'error',
        )
      }
      return { status: 'cancelled' }
    }

    const taskId = deps.createId()
    const retryTask: TaskRecord = {
      id: taskId,
      prompt: task.prompt,
      params: normalizeParamsForSettings(task.params, requestSettings, {
        hasInputImages: task.inputImageIds.length > 0,
      }),
      apiProvider: profile.provider,
      apiProfileId: profile.id,
      apiProfileName: profile.name,
      apiMode: profile.apiMode,
      apiModel: profile.model,
      inputImageIds: [...task.inputImageIds],
      maskTargetImageId: task.maskTargetImageId ?? null,
      maskImageId: task.maskImageId ?? null,
      outputImages: [],
      status: 'running',
      error: null,
      createdAt: now(),
      finishedAt: null,
      elapsed: null,
      category: task.category,
      imageEditContext: task.imageEditContext
        ? { ...task.imageEditContext, referenceImageIds: [...task.imageEditContext.referenceImageIds] }
        : undefined,
    }
    if (!(await persistTask(retryTask)) || !isCurrent()) return { status: 'cancelled' }
    if (task.apiProfileId !== profile.id || task.apiModel !== profile.model) {
      state.showToast(`重试将使用配置「${profile.name}」的当前模型「${profile.model}」。`, 'info')
    }
    deps.executeTask(taskId)
    return { status: 'submitted', taskId }
  }

  const submitPrepared = async (options: PreparedTaskSubmissionOptions): Promise<boolean> => {
    const state = deps.getState()
    try {
      for (const image of options.inputImages) {
        if (!isCurrent()) return false
        await deps.storeInputImage(image.dataUrl)
      }
    } catch (error) {
      if (isCurrent() && !(error instanceof Error && error.name === 'AbortError')) {
        state.showToast(error instanceof Error ? error.message : String(error), 'error')
      }
      return false
    }
    if (!isCurrent()) return false
    const normalizedParams = normalizeParamsForSettings(options.params, options.requestSettings, {
      hasInputImages: options.inputImages.length > 0,
    })
    const normalizedParamPatch = getChangedParams(options.params, normalizedParams)
    if (Object.keys(normalizedParamPatch).length) state.setParams?.(normalizedParamPatch)

    const taskId = deps.createId()
    const task: TaskRecord = {
      id: taskId,
      prompt: options.prompt,
      params: normalizedParams,
      apiProvider: options.profile.provider,
      apiProfileId: options.profile.id,
      apiProfileName: options.profile.name,
      apiMode: options.profile.apiMode,
      apiModel: options.profile.model,
      inputImageIds: options.inputImages.map((image) => image.id),
      maskTargetImageId: options.maskTargetImageId,
      maskImageId: options.maskImageId,
      outputImages: [],
      status: 'running',
      error: null,
      createdAt: now(),
      finishedAt: null,
      elapsed: null,
      category: options.category,
    }
    if (!(await persistTask(task)) || !isCurrent()) return false
    state.showToast('任务已提交', 'success')
    if (options.clearInputAfterSubmit && !options.category.projectId) {
      state.setPrompt?.('')
      state.clearInputImages?.()
    }
    state.setReusedTaskApiProfile?.(null)
    state.setPendingTaskCategory?.(null)
    deps.executeTask(taskId)
    return true
  }

  return { retry, submitPrepared, submitWithInput }
}
