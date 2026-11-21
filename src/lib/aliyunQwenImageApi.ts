import type { ApiProfile, TaskParams } from '../types'
import { getAliyunQwenImageModel } from './apiProfiles'
import {
  assertImageInputPayloadSize,
  createLinkedAbortController,
  type CallApiOptions,
  type CallApiResult,
  fetchImageUrlAsDataUrl,
  getApiErrorMessage,
  getDataUrlEncodedByteSize,
  isDataUrl,
  isHttpUrl,
  mergeActualParams,
  MIME_MAP,
} from './imageApiShared'

const NATIVE_GENERATION_PATH = '/services/aigc/multimodal-generation/generation'
const MAX_INPUT_IMAGES = 3
const MAX_OUTPUT_IMAGES = 6
const MIN_PIXELS = 512 * 512
const MAX_PIXELS = 2048 * 2048
const MAX_EDGE = 2048
const SIZE_MULTIPLE = 16

type AliyunQwenResponse = {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{ image?: unknown }>
      }
    }>
  }
  usage?: {
    output_width?: unknown
    output_height?: unknown
  }
}

function parseBaseUrl(value: string): URL | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    return new URL(input)
  } catch {
    return null
  }
}

/**
 * Converts any of the commonly pasted DashScope/MaaS base URLs to the native
 * Qwen-Image endpoint. The settings UI normalizes OpenAI URLs to /v1, so both
 * /v1 and /api/v1 need to be accepted here.
 */
export function createAliyunQwenImageEndpoint(baseUrl: string): string {
  const parsed = parseBaseUrl(baseUrl)
  if (!parsed) return `${baseUrl.trim().replace(/\/+$/, '')}/api/v1${NATIVE_GENERATION_PATH}`

  const pathname = parsed.pathname.replace(/\/+$/, '')
  const lowerPath = pathname.toLowerCase()
  const nativePathIndex = lowerPath.indexOf(NATIVE_GENERATION_PATH)
  if (nativePathIndex >= 0) {
    return `${parsed.origin}${pathname.slice(0, nativePathIndex + NATIVE_GENERATION_PATH.length)}`
  }

  if (/\/compatible-mode\/v1$/i.test(pathname)) {
    return `${parsed.origin}/api/v1${NATIVE_GENERATION_PATH}`
  }

  if (/\/api\/v1$/i.test(pathname)) {
    return `${parsed.origin}${pathname}${NATIVE_GENERATION_PATH}`
  }

  if (/\/v1$/i.test(pathname)) {
    return `${parsed.origin}${pathname.replace(/\/v1$/i, '/api/v1')}${NATIVE_GENERATION_PATH}`
  }

  const prefix = pathname && pathname !== '/' ? pathname : ''
  return `${parsed.origin}${prefix}/api/v1${NATIVE_GENERATION_PATH}`
}

function roundToMultiple(value: number, mode: 'floor' | 'ceil' = 'floor'): number {
  const rounded =
    mode === 'ceil'
      ? Math.ceil(value / SIZE_MULTIPLE) * SIZE_MULTIPLE
      : Math.floor(value / SIZE_MULTIPLE) * SIZE_MULTIPLE
  return Math.max(SIZE_MULTIPLE, rounded)
}

/** Qwen-Image accepts 512²–2048² pixels and uses width*height syntax. */
export function normalizeAliyunQwenImageSize(size: string): string {
  const trimmed = size.trim()
  if (!trimmed || trimmed === 'auto') return 'auto'

  const match = trimmed.match(/^(\d+)\s*[xX×*]\s*(\d+)$/)
  if (!match) return trimmed

  let width = Number(match[1])
  let height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'auto'

  const scaleDown = (scale: number) => {
    width = roundToMultiple(width * scale, 'floor')
    height = roundToMultiple(height * scale, 'floor')
  }
  const scaleUp = (scale: number) => {
    width = roundToMultiple(width * scale, 'ceil')
    height = roundToMultiple(height * scale, 'ceil')
  }

  for (let i = 0; i < 4; i++) {
    const maxEdge = Math.max(width, height)
    if (maxEdge > MAX_EDGE) scaleDown(MAX_EDGE / maxEdge)

    const pixels = width * height
    if (pixels > MAX_PIXELS) scaleDown(Math.sqrt(MAX_PIXELS / pixels))
    else if (pixels < MIN_PIXELS) scaleUp(Math.sqrt(MIN_PIXELS / pixels))
  }

  width = Math.min(MAX_EDGE, roundToMultiple(width))
  height = Math.min(MAX_EDGE, roundToMultiple(height))
  if (width * height > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / (width * height))
    width = Math.min(MAX_EDGE, roundToMultiple(width * scale))
    height = Math.min(MAX_EDGE, roundToMultiple(height * scale))
  }

  return `${width}*${height}`
}

export function createAliyunQwenImageRequestBody(opts: CallApiOptions, profile: ApiProfile): Record<string, unknown> {
  const n = Math.min(MAX_OUTPUT_IMAGES, Math.max(1, Math.trunc(opts.params.n || 1)))
  const content = [...opts.inputImageDataUrls.map((image) => ({ image })), { text: opts.prompt }]
  const parameters: Record<string, unknown> = {
    prompt_extend: true,
    n,
    watermark: false,
  }
  const size = normalizeAliyunQwenImageSize(opts.params.size)
  if (size !== 'auto') parameters.size = size

  return {
    model: getAliyunQwenImageModel(profile.model),
    input: {
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    },
    parameters,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getResultImageUrls(payload: AliyunQwenResponse): string[] {
  const choices = payload.output?.choices
  if (!Array.isArray(choices)) return []

  return choices.flatMap((choice) => {
    const content = choice.message?.content
    if (!Array.isArray(content)) return []
    return content
      .map((item) => item?.image)
      .filter((value): value is string => typeof value === 'string' && (isHttpUrl(value) || isDataUrl(value)))
  })
}

function isAliyunImageResultUrl(value: string): boolean {
  const parsed = parseBaseUrl(value)
  if (!parsed) return false
  const hostname = parsed.hostname.toLowerCase()
  return hostname.endsWith('.aliyuncs.com') || hostname.endsWith('.aliyun.com')
}

function createAliyunImageProxy(url: string) {
  return {
    proxyUrl: '/image-proxy/',
    headers: {
      'X-Image-Url': url,
    },
  }
}

function getActualOutputSize(payload: AliyunQwenResponse, requestedSize: string): string | undefined {
  const width = Number(payload.usage?.output_width)
  const height = Number(payload.usage?.output_height)
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return `${Math.round(width)}x${Math.round(height)}`
  }
  return requestedSize && requestedSize !== 'auto' ? requestedSize : undefined
}

export async function parseAliyunQwenImageResponse(
  payload: unknown,
  requestedParams: TaskParams,
  signal?: AbortSignal,
): Promise<CallApiResult> {
  const typedPayload = isRecord(payload) ? (payload as AliyunQwenResponse) : {}
  const imageUrls = getResultImageUrls(typedPayload)
  const rawImageUrls = imageUrls.filter(isHttpUrl)
  if (!imageUrls.length) {
    const err = new Error('阿里云 Qwen-Image 没有返回可识别的图片数据')
    ;(err as Error & { rawResponsePayload?: string }).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  const images: string[] = []
  try {
    for (const imageUrl of imageUrls) {
      images.push(
        await fetchImageUrlAsDataUrl(
          imageUrl,
          MIME_MAP.png,
          signal,
          isHttpUrl(imageUrl) && isAliyunImageResultUrl(imageUrl) ? createAliyunImageProxy(imageUrl) : undefined,
        ),
      )
    }
  } catch (err) {
    if (rawImageUrls.length > 0 && err instanceof Error) {
      ;(err as Error & { rawImageUrls?: string[] }).rawImageUrls = rawImageUrls
    }
    throw err
  }

  const actualParams = mergeActualParams({
    size: getActualOutputSize(typedPayload, requestedParams.size),
    output_format: 'png',
    n: images.length,
  })

  return {
    images,
    actualParams,
    actualParamsList: images.map(() => actualParams),
    ...(rawImageUrls.length ? { rawImageUrls } : {}),
  }
}

export async function callAliyunQwenImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  if (opts.maskDataUrl) {
    throw new Error('阿里云 Qwen-Image 原生接口暂不支持遮罩编辑，请移除遮罩后使用参考图编辑。')
  }
  if (opts.inputImageDataUrls.length > MAX_INPUT_IMAGES) {
    throw new Error(`阿里云 Qwen-Image 最多支持 ${MAX_INPUT_IMAGES} 张参考图，请删除多余图片后重试。`)
  }

  const requestedN = Math.max(1, Math.trunc(opts.params.n || 1))
  if (requestedN > MAX_OUTPUT_IMAGES) {
    throw new Error(`阿里云 Qwen-Image 最多支持 ${MAX_OUTPUT_IMAGES} 张输出图片，请减少数量后重试。`)
  }

  assertImageInputPayloadSize(
    opts.inputImageDataUrls.reduce((sum, dataUrl) => sum + getDataUrlEncodedByteSize(dataUrl), 0),
  )

  const abortController = createLinkedAbortController(profile.timeout, opts.signal)
  const controller = abortController.controller

  try {
    const response = await fetch(createAliyunQwenImageEndpoint(profile.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(createAliyunQwenImageRequestBody(opts, profile)),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(await getApiErrorMessage(response))

    return parseAliyunQwenImageResponse(await response.json(), opts.params, controller.signal)
  } finally {
    abortController.cleanup()
  }
}
