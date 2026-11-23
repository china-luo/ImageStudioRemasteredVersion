import type { TaskParams, TaskRecord } from '../types'

// Polling has its own budget; a provider's submit timeout is not a generation deadline.
export const ASYNC_POLL_TIMEOUT_SECONDS = 15 * 60
export const ASYNC_POLL_REQUEST_TIMEOUT_SECONDS = 60

export function createPollingTimeoutError() {
  return new DOMException('本地查询已超时（timeout），远端任务 ID 已保留，可恢复查询。', 'TimeoutError')
}

/** Also settles locally when an SDK ignores abort; callers must guard any late side effects. */
export function awaitTaskWork<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function hasActualParams(params: Partial<TaskParams> | undefined): params is Partial<TaskParams> {
  return Boolean(params && Object.keys(params).length > 0)
}

export function firstActualParams(
  paramsList: Array<Partial<TaskParams> | undefined> | undefined,
): Partial<TaskParams> | undefined {
  return paramsList?.find(hasActualParams)
}

export function mapActualParamsByImage(
  outputIds: string[],
  paramsList: Array<Partial<TaskParams> | undefined> | undefined,
): Record<string, Partial<TaskParams>> | undefined {
  const mapped = paramsList?.reduce<Record<string, Partial<TaskParams>>>((acc, params, index) => {
    const imgId = outputIds[index]
    if (imgId && hasActualParams(params)) acc[imgId] = params
    return acc
  }, {})
  return mapped && Object.keys(mapped).length > 0 ? mapped : undefined
}

type RecoverableTask = {
  apiProvider?: string
  falRequestId?: string
  falEndpoint?: string
  falRecoverable?: boolean
  customTaskId?: string
  customRecoverable?: boolean
  recoveryPausedReason?: TaskRecord['recoveryPausedReason']
  status: string
}

export function shouldRecoverFalTask(
  task: Pick<
    RecoverableTask,
    'apiProvider' | 'falRequestId' | 'falEndpoint' | 'status' | 'falRecoverable' | 'recoveryPausedReason'
  >,
): boolean {
  return (
    task.recoveryPausedReason !== 'timeout' &&
    task.apiProvider === 'fal' &&
    Boolean(task.falRequestId && task.falEndpoint) &&
    (task.status === 'running' || Boolean(task.falRecoverable))
  )
}

export function shouldRecoverCustomTask(
  task: Pick<RecoverableTask, 'customTaskId' | 'status' | 'customRecoverable' | 'recoveryPausedReason'>,
): boolean {
  return (
    task.recoveryPausedReason !== 'timeout' &&
    Boolean(task.customTaskId) &&
    (task.status === 'running' || Boolean(task.customRecoverable))
  )
}

export function isTaskReconnecting(
  task: Pick<TaskRecord, 'status' | 'falRecoverable' | 'customRecoverable' | 'recoveryPausedReason'>,
): boolean {
  return task.status === 'error' && !task.recoveryPausedReason && Boolean(task.falRecoverable || task.customRecoverable)
}

export function canResumeTaskRecovery(task: TaskRecord): boolean {
  return (
    task.status === 'error' &&
    Boolean(task.recoveryPausedReason) &&
    (Boolean(task.apiProvider === 'fal' && task.falRecoverable && task.falRequestId && task.falEndpoint) ||
      Boolean(task.customRecoverable && task.customTaskId))
  )
}
