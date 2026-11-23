import type { ApiProfile, AppSettings, TaskParams, TaskRecord } from '../types'
import { getCustomProviderDefinition } from './apiProfiles'
import { getFalErrorMessage, getFalQueuedImageResult } from './falAiImageApi'
import { getCustomQueuedImageResult } from './openaiCompatibleImageApi'
import {
  ASYNC_POLL_TIMEOUT_SECONDS,
  awaitTaskWork,
  createPollingTimeoutError,
  firstActualParams,
  mapActualParamsByImage,
  shouldRecoverCustomTask,
  shouldRecoverFalTask,
} from './taskRecovery'

const RECOVERY_POLL_MS = 10_000

type RecoveryState = {
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
  cacheImage?: (imageId: string, dataUrl: string) => void
}

type ProviderKind = 'fal' | 'custom'

/** Provider polling lives outside Zustand, with one cancellable scope per remote task. */
export function createTaskRecoveryManager(deps: TaskRecoveryManagerDependencies) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const active = new Map<string, AbortController>()
  const deadlines = new Map<string, number>()
  const blocked = new Map<string, ProviderKind>()
  const keyFor = (kind: ProviderKind, taskId: string) => `${kind}:${taskId}`
  const clearTimer = (key: string) => {
    const timer = timers.get(key)
    if (timer) clearTimeout(timer)
    timers.delete(key)
  }
  const clear = (kind: ProviderKind, taskId: string) => {
    const key = keyFor(kind, taskId)
    clearTimer(key)
    const controller = active.get(key)
    active.delete(key)
    deadlines.delete(key)
    blocked.delete(taskId)
    controller?.abort()
  }
  const cancel = (taskId: string) => {
    clear('fal', taskId)
    clear('custom', taskId)
  }

  const recover = async (kind: ProviderKind, taskId: string): Promise<void> => {
    const key = keyFor(kind, taskId)
    clearTimer(key)
    if (active.has(key)) return
    const { settings, tasks } = deps.getState()
    const task = tasks.find((item) => item.id === taskId)
    const eligible = kind === 'fal' ? shouldRecoverFalTask : shouldRecoverCustomTask
    if (!task || task.status === 'done' || !eligible(task)) return
    const recoverableKey = kind === 'fal' ? 'falRecoverable' : 'customRecoverable'
    const profile = kind === 'fal' ? deps.getFalProfile(settings, task) : deps.getCustomProfile(settings, task)
    const provider =
      kind === 'custom' && task.apiProvider ? getCustomProviderDefinition(settings, task.apiProvider) : null
    if (!profile || (kind === 'custom' && !provider?.poll)) {
      blocked.set(taskId, kind)
      deadlines.delete(key)
      const identity = task.apiProfileName || task.apiProfileId || '原 API 配置'
      deps.updateTask(taskId, {
        status: 'error',
        recoveryPausedReason: !profile ? 'missing-profile' : 'missing-poll',
        error: !profile
          ? `恢复已暂停：找不到任务原配置「${identity}」，请恢复同一配置后继续查询；不会切换到当前账号。`
          : `恢复已暂停：原服务商缺少 poll 配置，请补全后继续查询。`,
        [recoverableKey]: true,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      return
    }
    blocked.delete(taskId)
    if (task.recoveryPausedReason) deps.updateTask(taskId, { recoveryPausedReason: undefined, error: null })
    const controller = new AbortController()
    active.set(key, controller)
    const deadline = deadlines.get(key) ?? Date.now() + ASYNC_POLL_TIMEOUT_SECONDS * 1000
    deadlines.set(key, deadline)
    const timeout = setTimeout(() => controller.abort(createPollingTimeoutError()), Math.max(0, deadline - Date.now()))
    const isCurrent = () =>
      active.get(key) === controller &&
      !controller.signal.aborted &&
      deps.getState().tasks.some((item) => item.id === taskId && item.status !== 'done' && eligible(item))
    try {
      const result = await awaitTaskWork(
        kind === 'fal'
          ? getFalQueuedImageResult(profile, task.falEndpoint!, task.falRequestId!, task.params, controller.signal)
          : getCustomQueuedImageResult(profile, provider!, task.customTaskId!, task.params, controller.signal),
        controller.signal,
      )
      if (!isCurrent()) return
      const actualParamsList = await awaitTaskWork(
        kind === 'fal'
          ? deps.resolveImageSizeParamsList(result.images, result.actualParamsList)
          : deps.readImageSizeParamsList(result.images),
        controller.signal,
      )
      if (!isCurrent()) return
      const outputIds: string[] = []
      for (const dataUrl of result.images) {
        if (!isCurrent()) return
        const imageId = await awaitTaskWork(deps.storeGeneratedImage(dataUrl), controller.signal)
        if (!isCurrent()) return
        deps.cacheImage?.(imageId, dataUrl)
        outputIds.push(imageId)
      }
      if (!isCurrent()) return
      deadlines.delete(key)
      deps.updateTask(taskId, {
        outputImages: outputIds,
        actualParams: firstActualParams(actualParamsList),
        actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
        revisedPromptByImage: undefined,
        status: 'done',
        recoveryPausedReason: undefined,
        error: null,
        [recoverableKey]: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      deps
        .getState()
        .showToast(
          `${kind === 'fal' ? 'fal.ai 任务' : '自定义异步任务'}已恢复，共 ${outputIds.length} 张图片`,
          'success',
        )
    } catch (error) {
      if (active.get(key) !== controller || !deps.getState().tasks.some((item) => item.id === taskId && eligible(item)))
        return
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
      const recoverable = timedOut || deps.isFalConnectionRecoverableError(error)
      deps.updateTask(taskId, {
        status: 'error',
        recoveryPausedReason: timedOut ? 'timeout' : undefined,
        error:
          (kind === 'fal' ? getFalErrorMessage(error) : null) ??
          (error instanceof Error ? error.message : String(error)),
        ...deps.getRawErrorPayload(error),
        [recoverableKey]: recoverable,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      if (recoverable && !timedOut && Date.now() < deadline) schedule(kind, taskId)
      else deadlines.delete(key)
    } finally {
      clearTimeout(timeout)
      if (active.get(key) === controller) active.delete(key)
    }
  }

  const schedule = (kind: ProviderKind, taskId: string, delayMs = RECOVERY_POLL_MS) => {
    const key = keyFor(kind, taskId)
    if (timers.has(key)) return
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        void recover(kind, taskId)
      }, delayMs),
    )
  }

  return {
    clearCustom: (taskId: string) => clear('custom', taskId),
    clearFal: (taskId: string) => clear('fal', taskId),
    cancel,
    cancelAll() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      const controllers = [...active.values()]
      active.clear()
      deadlines.clear()
      blocked.clear()
      controllers.forEach((controller) => controller.abort())
    },
    resumeBlocked() {
      for (const [taskId, kind] of blocked) {
        const { settings, tasks } = deps.getState()
        const task = tasks.find((item) => item.id === taskId)
        if (!task) {
          blocked.delete(taskId)
          continue
        }
        const profile = kind === 'fal' ? deps.getFalProfile(settings, task) : deps.getCustomProfile(settings, task)
        const provider = task.apiProvider ? getCustomProviderDefinition(settings, task.apiProvider) : null
        if (profile && (kind === 'fal' || provider?.poll)) {
          blocked.delete(taskId)
          schedule(kind, taskId, 0)
        }
      }
    },
    recoverCustom: (taskId: string) => recover('custom', taskId),
    recoverFal: (taskId: string) => recover('fal', taskId),
    scheduleCustom: (taskId: string, delayMs?: number) => schedule('custom', taskId, delayMs),
    scheduleFal: (taskId: string, delayMs?: number) => schedule('fal', taskId, delayMs),
  }
}
