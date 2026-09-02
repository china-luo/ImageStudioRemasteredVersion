import type { ApiProfile, AppSettings, InputImage, TaskImageEditContext, TaskParams, TaskRecord } from '../types'
import {
  canApiProfileGenerateImages,
  createSettingsForApiProfile,
  getActiveApiProfile,
  getImageGenerationProfile,
  getHomeApiProfile,
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
  now?: () => number
}

export type RetryTaskResult =
  { status: 'submitted'; taskId: string } | { status: 'unsupported-profile'; profile: ApiProfile }

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
        const dataUrl = image.dataUrl || (await deps.ensureImageCached(image.id))
        if (!dataUrl) throw new Error('输入图片已不存在')
        if (!(await deps.getImage(image.id))) {
          await deps.putImage({ id: image.id, dataUrl, source: 'upload', createdAt: now() })
        }
        deps.cacheImage(image.id, dataUrl)
        storedImages.push({ id: image.id, dataUrl })
      }
    } catch (error) {
      state.showToast(error instanceof Error ? error.message : String(error), 'error')
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
    state.setTasks([task, ...state.tasks])
    await deps.putTask(task)
    state.showToast('任务已提交', 'success')
    deps.executeTask(taskId)
    return taskId
  }

  const retry = async (task: TaskRecord): Promise<RetryTaskResult> => {
    const state = deps.getState()
    const settings = normalizeSettings(state.settings)
    const profile = getImageGenerationProfile(settings) ?? getActiveApiProfile(settings)
    if (!canApiProfileGenerateImages(profile)) return { status: 'unsupported-profile', profile }

    const taskId = deps.createId()
    const retryTask: TaskRecord = {
      id: taskId,
      prompt: task.prompt,
      params: normalizeParamsForSettings(task.params, createSettingsForApiProfile(settings, profile), {
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
    }
    state.setTasks([retryTask, ...state.tasks])
    await deps.putTask(retryTask)
    deps.executeTask(taskId)
    return { status: 'submitted', taskId }
  }

  const submitPrepared = async (options: PreparedTaskSubmissionOptions): Promise<boolean> => {
    const state = deps.getState()
    for (const image of options.inputImages) await deps.storeInputImage(image.dataUrl)
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
    state.setTasks([task, ...state.tasks])
    await deps.putTask(task)
    state.showToast('任务已提交', 'success')
    if (options.clearInputAfterSubmit) {
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
