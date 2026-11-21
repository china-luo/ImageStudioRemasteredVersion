import { DEFAULT_OUTPUT_COMPRESSION, DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { getActiveApiProfile, isAliyunQwenImageProfile, isVolcengineSeedreamProModel } from './apiProfiles'
import { normalizeAliyunQwenImageSize } from './aliyunQwenImageApi'
import { normalizeImageSize } from './size'

export const DEFAULT_FAL_IMAGE_SIZE = '1360x1024'
export const DEFAULT_VOLCENGINE_IMAGE_SIZE = '2048x2048'
export const MAX_FAL_OUTPUT_IMAGES = 4
export const MAX_VOLCENGINE_OUTPUT_IMAGES = 14
export const MAX_VOLCENGINE_PRO_OUTPUT_IMAGES = 1
export const MAX_OPENAI_OUTPUT_IMAGES = 10
export const MAX_ALIYUN_QWEN_OUTPUT_IMAGES = 6
export const MAX_DEFAULT_INPUT_IMAGES = 16
export const MAX_ALIYUN_QWEN_INPUT_IMAGES = 3

export function getOutputImageLimitForSettings(settings: AppSettings) {
  const activeProfile = getActiveApiProfile(settings)
  const provider = activeProfile.provider
  if (provider === 'fal') return MAX_FAL_OUTPUT_IMAGES
  if (provider === 'volcengine') {
    return isVolcengineSeedreamProModel(activeProfile.model)
      ? MAX_VOLCENGINE_PRO_OUTPUT_IMAGES
      : MAX_VOLCENGINE_OUTPUT_IMAGES
  }
  if (isAliyunQwenImageProfile(activeProfile)) return MAX_ALIYUN_QWEN_OUTPUT_IMAGES
  return MAX_OPENAI_OUTPUT_IMAGES
}

export function getInputImageLimitForSettings(settings: AppSettings) {
  return isAliyunQwenImageProfile(getActiveApiProfile(settings))
    ? MAX_ALIYUN_QWEN_INPUT_IMAGES
    : MAX_DEFAULT_INPUT_IMAGES
}

export function normalizeParamsForSettings(
  params: TaskParams,
  settings: AppSettings,
  options: { hasInputImages?: boolean } = {},
): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const nextParams: TaskParams = {
    ...params,
    size: normalizeImageSize(params.size) || DEFAULT_PARAMS.size,
    n: Math.min(outputImageLimit, Math.max(1, params.n || DEFAULT_PARAMS.n)),
  }

  if (activeProfile.provider === 'openai' && activeProfile.codexCli) {
    nextParams.quality = DEFAULT_PARAMS.quality
  }

  if (activeProfile.provider === 'fal') {
    if (!options.hasInputImages && nextParams.size === 'auto') nextParams.size = DEFAULT_FAL_IMAGE_SIZE
    if (nextParams.quality === 'auto') nextParams.quality = 'high'
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = null
  }

  if (activeProfile.provider === 'volcengine') {
    if (nextParams.size === 'auto') nextParams.size = DEFAULT_VOLCENGINE_IMAGE_SIZE
    nextParams.output_format = nextParams.output_format === 'png' ? 'png' : 'jpeg'
    nextParams.quality = DEFAULT_PARAMS.quality
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = null
  }

  if (isAliyunQwenImageProfile(activeProfile)) {
    const qwenSize = normalizeAliyunQwenImageSize(nextParams.size)
    nextParams.size = qwenSize === 'auto' ? 'auto' : qwenSize.replace('*', 'x')
    nextParams.output_format = 'png'
    nextParams.quality = DEFAULT_PARAMS.quality
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = null
  }

  if (nextParams.output_format === 'png') {
    nextParams.output_compression = null
  } else if (activeProfile.provider !== 'fal' && activeProfile.provider !== 'volcengine') {
    nextParams.output_compression = normalizeOutputCompression(nextParams.output_compression)
  }

  return nextParams
}

function normalizeOutputCompression(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_OUTPUT_COMPRESSION
  return Math.min(100, Math.max(0, Math.trunc(value)))
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
