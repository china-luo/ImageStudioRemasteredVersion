import type { ApiProfile, AppSettings, TaskParams, TaskRecord } from '../types'
import { getCustomProviderDefinition } from './apiProfiles'
import { getFalErrorMessage, getFalQueuedImageResult } from './falAiImageApi'
import { getCustomQueuedImageResult } from './openaiCompatibleImageApi'
import {
  firstActualParams,
  mapActualParamsByImage,
  shouldRecoverCustomTask,
  shouldRecoverFalTask,
} from './taskRecovery'

const FAL_RECOVERY_POLL_MS = 10_000
const CUSTOM_RECOVERY_POLL_MS = 10_000

type RecoveryState = Pick<AppSettings, never> & {
  settings: AppSettings
  tasks: TaskRecord[]
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
}

export interface TaskRecoveryManagerDependencies {
  getState: () => RecoveryState
  updateTask: (taskId: string, patch: Partial<TaskRecord>) => void
  getFalProfile: (settings: AppSettings, task: TaskRecord) => ApiProfile | null
  getCustomProfile: (settings: AppSettings, task: TaskRecord) => ApiProfile | null
  isFalConnectionRecoverableError: (error: unknown) => boolean
  getRawErrorPayload: (error: unknown) => Pick<Partial<TaskRecord>, 'rawImageUrls' | 'rawResponsePayload'>
  readImageSizeParamsList: (images: string[]) => Promise<Array<Partial<TaskParams> | undefined>>
  resolveImageSizeParamsList: (
    images: string[],
    preferred?: Array<Partial<TaskParams> | undefined>,
  ) => Promise<Array<Partial<TaskParams> | undefined>>
  storeGeneratedImage: (dataUrl: string) => Promise<string>
}

/**
 * Holds provider polling outside Zustand. State access and persistence are injected so this module
 * can be exercised without React, IndexedDB, or a browser document.
 */
export function createTaskRecoveryManager(deps: TaskRecoveryManagerDependencies) {
  const falTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const customTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const clearFal = (taskId: string) => {
    const timer = falTimers.get(taskId)
    if (timer) clearTimeout(timer)
    falTimers.delete(taskId)
  }
  const clearCustom = (taskId: string) => {
    const timer = customTimers.get(taskId)
    if (timer) clearTimeout(timer)
    customTimers.delete(taskId)
  }

  const completeCustom = async (task: TaskRecord, result: Awaited<ReturnType<typeof getCustomQueuedImageResult>>) => {
    const latest = deps.getState().tasks.find((item) => item.id === task.id)
    if (!latest || latest.status === 'done') return
    const actualParamsList = await deps.readImageSizeParamsList(result.images)
    const outputIds = await Promise.all(result.images.map((dataUrl) => deps.storeGeneratedImage(dataUrl)))
    deps.updateTask(task.id, {
      outputImages: outputIds,
      actualParams: firstActualParams(actualParamsList),
      actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
      revisedPromptByImage: undefined,
      status: 'done',
      error: null,
      customRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    deps.getState().showToast(`自定义异步任务已恢复，共 ${outputIds.length} 张图片`, 'success')
  }

  const recoverCustom = async (taskId: string): Promise<void> => {
    const { settings, tasks } = deps.getState()
    const task = tasks.find((item) => item.id === taskId)
    if (!task || !shouldRecoverCustomTask(task) || task.status === 'done') return
    const profile = deps.getCustomProfile(settings, task)
    const provider = task.apiProvider ? getCustomProviderDefinition(settings, task.apiProvider) : null
    if (!profile || !provider?.poll) {
      scheduleCustom(taskId)
      return
    }
    try {
      const result = await getCustomQueuedImageResult(profile, provider, task.customTaskId!, task.params)
      clearCustom(taskId)
      await completeCustom(task, result)
    } catch (error) {
      clearCustom(taskId)
      deps.updateTask(taskId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        ...deps.getRawErrorPayload(error),
        customRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
    }
  }

  const completeFal = async (task: TaskRecord, result: Awaited<ReturnType<typeof getFalQueuedImageResult>>) => {
    const latest = deps.getState().tasks.find((item) => item.id === task.id)
    if (!latest || latest.status === 'done') return
    const actualParamsList = await deps.resolveImageSizeParamsList(result.images, result.actualParamsList)
    const outputIds = await Promise.all(result.images.map((dataUrl) => deps.storeGeneratedImage(dataUrl)))
    deps.updateTask(task.id, {
      outputImages: outputIds,
      actualParams: firstActualParams(actualParamsList),
      actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
      revisedPromptByImage: undefined,
      status: 'done',
      error: null,
      falRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    deps.getState().showToast(`fal.ai 任务已恢复，共 ${outputIds.length} 张图片`, 'success')
  }

  const recoverFal = async (taskId: string): Promise<void> => {
    const { settings, tasks } = deps.getState()
    const task = tasks.find((item) => item.id === taskId)
    if (!task || !shouldRecoverFalTask(task) || task.status === 'done') return
    const profile = deps.getFalProfile(settings, task)
    if (!profile) {
      scheduleFal(taskId)
      return
    }
    try {
      const result = await getFalQueuedImageResult(profile, task.falEndpoint!, task.falRequestId!, task.params)
      clearFal(taskId)
      await completeFal(task, result)
    } catch (error) {
      if (deps.isFalConnectionRecoverableError(error)) {
        scheduleFal(taskId)
        return
      }
      clearFal(taskId)
      deps.updateTask(taskId, {
        status: 'error',
        error: getFalErrorMessage(error) ?? (error instanceof Error ? error.message : String(error)),
        ...deps.getRawErrorPayload(error),
        falRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
    }
  }

  const scheduleFal = (taskId: string, delayMs = FAL_RECOVERY_POLL_MS) => {
    if (falTimers.has(taskId)) return
    falTimers.set(
      taskId,
      setTimeout(() => {
        falTimers.delete(taskId)
        void recoverFal(taskId)
      }, delayMs),
    )
  }
  const scheduleCustom = (taskId: string, delayMs = CUSTOM_RECOVERY_POLL_MS) => {
    if (customTimers.has(taskId)) return
    customTimers.set(
      taskId,
      setTimeout(() => {
        customTimers.delete(taskId)
        void recoverCustom(taskId)
      }, delayMs),
    )
  }

  return { clearCustom, clearFal, recoverCustom, recoverFal, scheduleCustom, scheduleFal }
}
