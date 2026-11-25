import { callImageApi } from './api'
import {
  createSettingsForApiProfile,
  getActiveApiProfile,
  getCustomProviderDefinition,
  normalizeSettings,
} from './apiProfiles'
import { IMAGE_FETCH_CORS_HINT, matchesSubmittedPrompt } from './imageApiShared'
import { replaceImageMentionsForApi } from './promptImageMentions'
import { prepareReferenceImageAndMaskPayload } from './referenceImagePayload'
import {
  ASYNC_POLL_TIMEOUT_SECONDS,
  awaitTaskWork,
  createPollingTimeoutError,
  firstActualParams,
  mapActualParamsByImage,
} from './taskRecovery'
import type { ApiProfile, AppSettings, MaskDraft, TaskParams, TaskRecord } from '../types'

type ExecutionState = {
  settings: AppSettings
  tasks: TaskRecord[]
  maskDraft: MaskDraft | null
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
  clearMaskDraft: () => void
  setDetailTaskId: (taskId: string | null) => void
}

export type TaskExecutionDependencies = {
  getState: () => ExecutionState
  updateTask: (taskId: string, patch: Partial<TaskRecord>) => void
  ensureImageCached: (imageId: string) => Promise<string | null | undefined>
  storeGeneratedImage: (dataUrl: string) => Promise<string>
  cacheImage: (imageId: string, dataUrl: string) => void
  forgetCachedImage: (imageId: string) => void
  scheduleWatchdog: (taskId: string, timeoutSeconds: number) => void
  clearWatchdog: (taskId: string) => void
  releaseSubmissionSlot?: (taskId: string) => void
  scheduleFalRecovery: (taskId: string) => void
  scheduleCustomRecovery: (taskId: string) => void
  resolveImageSizeParamsList: (
    images: string[],
    actualParamsList?: Array<Partial<TaskParams> | undefined>,
  ) => Promise<Array<Partial<TaskParams> | undefined>>
  readImageSizeParamsList: (images: string[]) => Promise<Array<Partial<TaskParams> | undefined>>
  isRecoverableConnectionError: (error: unknown) => boolean
  getNetworkErrorHint: (
    error: unknown,
    createdAt: number,
    usesApiProxy: boolean,
    profile?: Pick<ApiProfile, 'provider' | 'apiMode'> | null,
  ) => string | null
  getRawErrorPayload: (error: unknown) => Pick<Partial<TaskRecord>, 'rawImageUrls' | 'rawResponsePayload'>
  showCodexCliPrompt: (force?: boolean, reason?: string) => void
  callImageApi?: typeof callImageApi
  preparePayload?: typeof prepareReferenceImageAndMaskPayload
  now?: () => number
}

export function getTaskApiProfile(settings: AppSettings, task: TaskRecord): ApiProfile | null {
  if (!task.apiProfileId) return null
  const profile = normalizeSettings(settings).profiles.find((item) => item.id === task.apiProfileId)
  return profile && (!task.apiProvider || profile.provider === task.apiProvider) ? profile : null
}

function isAsyncCustomProviderTask(settings: AppSettings, provider: string, hasInputImages: boolean) {
  const customProvider = getCustomProviderDefinition(settings, provider)
  if (!customProvider?.poll) return false
  const submitMapping = hasInputImages && customProvider.editSubmit ? customProvider.editSubmit : customProvider.submit
  return Boolean(submitMapping.taskIdPath)
}

export function createTaskExecutionService(dependencies: TaskExecutionDependencies) {
  const requestImage = dependencies.callImageApi ?? callImageApi
  const preparePayload = dependencies.preparePayload ?? prepareReferenceImageAndMaskPayload
  const now = dependencies.now ?? Date.now
  const executions = new Map<string, AbortController>()
  const cancel = (taskId: string) => {
    const controller = executions.get(taskId)
    executions.delete(taskId)
    controller?.abort()
    dependencies.clearWatchdog(taskId)
  }

  return {
    cancel,
    isExecuting: (taskId: string) => executions.has(taskId),
    cancelAll() {
      for (const taskId of executions.keys()) cancel(taskId)
    },
    async execute(taskId: string): Promise<void> {
      const initialState = dependencies.getState()
      const task = initialState.tasks.find((item) => item.id === taskId)
      if (!task || task.status !== 'running' || executions.has(taskId)) return
      // A known remote identity is a query operation, never another paid submission.
      if (task.apiProvider === 'fal' && task.falRequestId && task.falEndpoint) {
        dependencies.scheduleFalRecovery(taskId)
        return
      }
      if (task.customTaskId) {
        dependencies.scheduleCustomRecovery(taskId)
        return
      }

      const taskProfile = getTaskApiProfile(initialState.settings, task)
      if (!taskProfile && task.apiProfileId) {
        dependencies.updateTask(taskId, {
          status: 'error',
          error: '找不到此任务所使用的 API 配置。',
          falRecoverable: false,
          customRecoverable: false,
          finishedAt: now(),
          elapsed: now() - task.createdAt,
        })
        return
      }

      const activeProfile = taskProfile ?? getActiveApiProfile(initialState.settings)
      const requestProfile = {
        ...activeProfile,
        model: task.apiModel?.trim() ? task.apiModel : activeProfile.model,
        apiMode: task.apiMode ?? activeProfile.apiMode,
      }
      const requestSettings = createSettingsForApiProfile(initialState.settings, requestProfile)
      const taskProvider = task.apiProvider ?? activeProfile.provider
      const controller = new AbortController()
      executions.set(taskId, controller)
      const isCurrent = () =>
        executions.get(taskId) === controller &&
        !controller.signal.aborted &&
        dependencies.getState().tasks.some((item) => item.id === taskId && item.status === 'running')
      let pollTimer: ReturnType<typeof setTimeout> | undefined
      const detachPolling = () => {
        if (!isCurrent()) return
        dependencies.clearWatchdog(taskId)
        dependencies.releaseSubmissionSlot?.(taskId)
        if (!pollTimer) {
          pollTimer = setTimeout(() => controller.abort(createPollingTimeoutError()), ASYNC_POLL_TIMEOUT_SECONDS * 1000)
        }
      }
      // Pin legacy tasks to the account actually used; never recover with the current account.
      dependencies.updateTask(taskId, {
        apiProfileId: task.apiProfileId ?? activeProfile.id,
        apiProvider: taskProvider,
      })
      let falRequestInfo =
        task.falRequestId && task.falEndpoint ? { requestId: task.falRequestId, endpoint: task.falEndpoint } : null
      let customTaskInfo = task.customTaskId ? { taskId: task.customTaskId } : null

      try {
        const inputDataUrls: string[] = []
        for (const imageId of task.inputImageIds) {
          const dataUrl = await awaitTaskWork(dependencies.ensureImageCached(imageId), controller.signal)
          if (!isCurrent()) return
          if (!dataUrl) throw new Error('输入图片已不存在')
          inputDataUrls.push(dataUrl)
        }
        let maskDataUrl: string | undefined
        if (task.maskImageId) {
          maskDataUrl =
            (await awaitTaskWork(dependencies.ensureImageCached(task.maskImageId), controller.signal)) ?? undefined
          if (!isCurrent()) return
          if (!maskDataUrl) throw new Error('遮罩图片已不存在')
        }
        const prepared = await awaitTaskWork(preparePayload(inputDataUrls, maskDataUrl), controller.signal)
        if (!isCurrent()) return
        if (
          taskProvider !== 'fal' &&
          !isAsyncCustomProviderTask(requestSettings, taskProvider, task.inputImageIds.length > 0)
        ) {
          dependencies.scheduleWatchdog(taskId, activeProfile.timeout)
        }
        const result = await awaitTaskWork(
          requestImage({
            signal: controller.signal,
            settings: requestSettings,
            prompt: replaceImageMentionsForApi(task.prompt, inputDataUrls.length),
            params: task.params,
            inputImageDataUrls: prepared.dataUrls,
            maskDataUrl: prepared.maskDataUrl,
            onFalRequestEnqueued: (request) => {
              if (!isCurrent()) return
              falRequestInfo = request
              dependencies.updateTask(taskId, {
                falRequestId: request.requestId,
                falEndpoint: request.endpoint,
                falRecoverable: false,
              })
              detachPolling()
            },
            onCustomTaskEnqueued: (request) => {
              if (!isCurrent()) return
              customTaskInfo = request
              dependencies.updateTask(taskId, { customTaskId: request.taskId, customRecoverable: false })
              detachPolling()
            },
          }),
          controller.signal,
        )

        if (!isCurrent()) return

        const outputIds: string[] = []
        for (const dataUrl of result.images) {
          if (!isCurrent()) return
          const imageId = await awaitTaskWork(dependencies.storeGeneratedImage(dataUrl), controller.signal)
          if (!isCurrent()) return
          dependencies.cacheImage(imageId, dataUrl)
          outputIds.push(imageId)
        }
        const isAsyncCustomTask = taskProvider !== 'fal' && taskProvider !== 'openai' && Boolean(customTaskInfo)
        const actualParamsList =
          taskProvider === 'fal'
            ? await awaitTaskWork(
                dependencies.resolveImageSizeParamsList(result.images, result.actualParamsList),
                controller.signal,
              )
            : isAsyncCustomTask
              ? await awaitTaskWork(dependencies.readImageSizeParamsList(result.images), controller.signal)
              : result.actualParamsList
        if (!isCurrent()) return
        const actualParams =
          taskProvider === 'fal' || isAsyncCustomTask
            ? firstActualParams(actualParamsList)
            : { ...result.actualParams, n: outputIds.length }
        const shouldStoreRevisedPrompts = taskProvider !== 'fal' && !isAsyncCustomTask
        const revisedPromptByImage = shouldStoreRevisedPrompts
          ? result.revisedPrompts?.reduce<Record<string, string>>((values, revisedPrompt, index) => {
              const imageId = outputIds[index]
              if (imageId && revisedPrompt?.trim()) values[imageId] = revisedPrompt
              return values
            }, {})
          : undefined
        if (taskProvider === 'openai' && requestProfile.apiMode === 'responses' && !requestProfile.codexCli) {
          const hasRevisedPrompt = result.revisedPrompts?.some((value) => value?.trim())
          const submittedPrompt = result.submittedPrompt
          const promptWasRevised =
            submittedPrompt !== undefined &&
            result.revisedPrompts?.some((value) => value?.trim() && !matchesSubmittedPrompt(value, submittedPrompt))
          if (promptWasRevised) dependencies.showCodexCliPrompt()
          else if (!hasRevisedPrompt) dependencies.showCodexCliPrompt(false, '接口没有返回官方 API 会返回的部分信息')
        }

        if (!isCurrent()) return
        dependencies.clearWatchdog(taskId)
        dependencies.updateTask(taskId, {
          outputImages: outputIds,
          rawImageUrls: result.rawImageUrls?.length ? result.rawImageUrls : undefined,
          actualParams,
          actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
          revisedPromptByImage:
            revisedPromptByImage && Object.keys(revisedPromptByImage).length ? revisedPromptByImage : undefined,
          status: 'done',
          recoveryPausedReason: undefined,
          finishedAt: now(),
          elapsed: now() - task.createdAt,
          falRecoverable: false,
          customRecoverable: false,
        })
        dependencies.getState().showToast(`生成完成，共 ${outputIds.length} 张图片`, 'success')
        const currentMask = dependencies.getState().maskDraft
        if (
          maskDataUrl &&
          currentMask &&
          currentMask.targetImageId === task.maskTargetImageId &&
          currentMask.maskDataUrl === maskDataUrl
        ) {
          dependencies.getState().clearMaskDraft()
        }
      } catch (error) {
        if (executions.get(taskId) !== controller) return
        dependencies.clearWatchdog(taskId)
        const latestTask = dependencies.getState().tasks.find((item) => item.id === taskId)
        if (!latestTask || latestTask.status !== 'running') return
        const pollingTimedOut = error instanceof DOMException && error.name === 'TimeoutError'
        const latestFalRequestInfo =
          falRequestInfo ??
          (latestTask.falRequestId && latestTask.falEndpoint
            ? { requestId: latestTask.falRequestId, endpoint: latestTask.falEndpoint }
            : null)
        const latestCustomTaskInfo =
          customTaskInfo ?? (latestTask.customTaskId ? { taskId: latestTask.customTaskId } : null)
        const missingCustomPoll = Boolean(
          latestCustomTaskInfo && !getCustomProviderDefinition(dependencies.getState().settings, taskProvider)?.poll,
        )
        if (
          latestTask.apiProvider === 'fal' &&
          latestFalRequestInfo &&
          (pollingTimedOut || dependencies.isRecoverableConnectionError(error))
        ) {
          dependencies.updateTask(taskId, {
            status: 'error',
            recoveryPausedReason: pollingTimedOut ? 'timeout' : undefined,
            error: pollingTimedOut
              ? String((error as Error).message)
              : '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
            falRequestId: latestFalRequestInfo.requestId,
            falEndpoint: latestFalRequestInfo.endpoint,
            falRecoverable: true,
            finishedAt: now(),
            elapsed: now() - task.createdAt,
          })
          if (!pollingTimedOut) dependencies.scheduleFalRecovery(taskId)
        } else if (
          latestCustomTaskInfo &&
          (pollingTimedOut || dependencies.isRecoverableConnectionError(error) || missingCustomPoll)
        ) {
          dependencies.updateTask(taskId, {
            status: 'error',
            recoveryPausedReason: pollingTimedOut ? 'timeout' : missingCustomPoll ? 'missing-poll' : undefined,
            error: pollingTimedOut
              ? String((error as Error).message)
              : missingCustomPoll
                ? '恢复已暂停：原服务商缺少 poll 配置，请补全后继续查询。'
                : '与自定义异步任务的连接已断开，之后会继续查询任务结果。',
            customTaskId: latestCustomTaskInfo.taskId,
            customRecoverable: true,
            finishedAt: now(),
            elapsed: now() - task.createdAt,
          })
          if (!pollingTimedOut) dependencies.scheduleCustomRecovery(taskId)
        } else {
          let message = error instanceof Error ? error.message : String(error)
          const currentSettings = dependencies.getState().settings
          const profile = getTaskApiProfile(currentSettings, latestTask)
          const usesApiProxy = profile?.apiProxy ?? currentSettings.apiProxy
          const fallbackProfile = getActiveApiProfile(currentSettings)
          const hint = dependencies.getNetworkErrorHint(
            error,
            latestTask.createdAt,
            usesApiProxy,
            profile ?? {
              provider: latestTask.apiProvider ?? fallbackProfile.provider,
              apiMode: currentSettings.apiMode,
            },
          )
          if (hint && !message.includes(IMAGE_FETCH_CORS_HINT)) message += `\n${hint}`
          dependencies.updateTask(taskId, {
            status: 'error',
            error: message,
            ...dependencies.getRawErrorPayload(error),
            falRecoverable: false,
            customRecoverable: false,
            finishedAt: now(),
            elapsed: now() - task.createdAt,
          })
          dependencies.getState().setDetailTaskId(taskId)
        }
      } finally {
        if (pollTimer) clearTimeout(pollTimer)
        if (executions.get(taskId) === controller) {
          executions.delete(taskId)
          task.inputImageIds.forEach(dependencies.forgetCachedImage)
        }
      }
    },
  }
}
