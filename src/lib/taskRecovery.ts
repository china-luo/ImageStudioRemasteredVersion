import type { TaskParams } from '../types'

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
  status: string
}

export function shouldRecoverFalTask(
  task: Pick<RecoverableTask, 'apiProvider' | 'falRequestId' | 'falEndpoint' | 'status' | 'falRecoverable'>,
): boolean {
  return (
    task.apiProvider === 'fal' &&
    Boolean(task.falRequestId && task.falEndpoint) &&
    (task.status === 'running' || Boolean(task.falRecoverable))
  )
}

export function shouldRecoverCustomTask(
  task: Pick<RecoverableTask, 'customTaskId' | 'status' | 'customRecoverable'>,
): boolean {
  return Boolean(task.customTaskId) && (task.status === 'running' || Boolean(task.customRecoverable))
}
