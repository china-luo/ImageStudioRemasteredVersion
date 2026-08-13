import type { ApiProfile, ImageApiResponse, TaskParams } from '../types'
import { isVolcengineSeedreamProModel } from './apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
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
  normalizeBase64Image,
  pickActualParams,
} from './imageApiShared'

function createVolcengineImageProxy(url: string) {
  return {
    proxyUrl: '/image-proxy/',
    headers: {
      'X-Image-Url': url,
    },
  }
}

function getVolcengineOutputFormat(format: TaskParams['output_format']): 'png' | 'jpeg' {
  return format === 'png' ? 'png' : 'jpeg'
}

function supportsSequentialImageGeneration(profile: ApiProfile): boolean {
  return !isVolcengineSeedreamProModel(profile.model)
}

function getVolcengineSize(size: string, profile: ApiProfile): string {
  const normalizedSize = size === 'auto' ? '2048x2048' : size
  if (!isVolcengineSeedreamProModel(profile.model)) return normalizedSize

  const match = normalizedSize.match(/^(\d+)\s*[xX×]\s*(\d+)$/)
  if (!match) return normalizedSize === '4K' ? '4K' : '2K'

  const maxEdge = Math.max(Number(match[1]), Number(match[2]))
  return maxEdge > 2048 ? '4K' : '2K'
}

function createRequestHeaders(profile: ApiProfile): Record<string, string> {
  return {
    Authorization: `Bearer ${profile.apiKey}`,
    'Content-Type': 'application/json',
  }
}

function createRequestBody(opts: CallApiOptions, profile: ApiProfile): Record<string, unknown> {
  const n = Math.max(1, opts.params.n || 1)
  const outputFormat = getVolcengineOutputFormat(opts.params.output_format)
  const isSeedreamPro = isVolcengineSeedreamProModel(profile.model)
  const body: Record<string, unknown> = {
    model: profile.model,
    prompt: opts.prompt,
    size: getVolcengineSize(opts.params.size, profile),
    watermark: false,
    response_format: isSeedreamPro ? 'url' : profile.responseFormatB64Json ? 'b64_json' : 'url',
  }

  if (!isSeedreamPro) {
    body.output_format = outputFormat
  } else {
    body.stream = false
  }

  if (opts.inputImageDataUrls.length) {
    if (isSeedreamPro) {
      body.image = opts.inputImageDataUrls.length === 1 ? opts.inputImageDataUrls[0] : opts.inputImageDataUrls
    } else {
      body.image_urls = opts.inputImageDataUrls
    }
  }

  if (n > 1) {
    if (!supportsSequentialImageGeneration(profile)) {
      throw new Error('当前火山 Seedream Pro 模型不支持组图生成，请将数量设为 1 后重试。')
    }
    body.sequential_image_generation = 'auto'
    body.sequential_image_generation_options = { max_images: n }
  }

  return body
}

async function parseImagesApiResponse(
  payload: ImageApiResponse,
  requestedParams: TaskParams,
  fallbackMime: string,
  signal?: AbortSignal,
): Promise<CallApiResult> {
  const data = payload.data
  if (!Array.isArray(data) || !data.length) {
    const err = new Error('火山方舟 Seedream 没有返回图片数据')
    ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  const images: string[] = []
  const rawImageUrls = data.map((item) => item.url).filter(isHttpUrl)
  const revisedPrompts: Array<string | undefined> = []
  try {
    for (const item of data) {
      const b64 = item.b64_json
      if (b64) {
        images.push(normalizeBase64Image(b64, fallbackMime))
        revisedPrompts.push(typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined)
        continue
      }

      if (isHttpUrl(item.url) || isDataUrl(item.url)) {
        images.push(await fetchImageUrlAsDataUrl(
          item.url,
          fallbackMime,
          signal,
          isHttpUrl(item.url) ? createVolcengineImageProxy(item.url) : undefined,
        ))
        revisedPrompts.push(typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined)
      }
    }
  } catch (err) {
    if (rawImageUrls.length > 0 && err instanceof Error) {
      ;(err as any).rawImageUrls = rawImageUrls
    }
    throw err
  }

  if (!images.length) {
    const err = new Error('火山方舟 Seedream 没有返回可识别的图片数据')
    ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  const actualParams = mergeActualParams(
    {
      size: requestedParams.size,
      output_format: getVolcengineOutputFormat(requestedParams.output_format),
      n: images.length,
    },
    pickActualParams(payload),
  )
  return {
    images,
    actualParams,
    actualParamsList: images.map(() => actualParams),
    revisedPrompts,
    ...(rawImageUrls.length ? { rawImageUrls } : {}),
  }
}

export async function callVolcengineImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  if (opts.maskDataUrl) {
    throw new Error('当前火山 Seedream 接入暂不支持遮罩编辑。请移除遮罩后重试。')
  }

  assertImageInputPayloadSize(
    opts.inputImageDataUrls.reduce((sum, dataUrl) => sum + getDataUrlEncodedByteSize(dataUrl), 0),
  )

  const outputFormat = getVolcengineOutputFormat(opts.params.output_format)
  const mime = MIME_MAP[outputFormat] || 'image/jpeg'
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig, profile.baseUrl)
  const abortController = createLinkedAbortController(profile.timeout, opts.signal)
  const controller = abortController.controller

  try {
    const response = await fetch(buildApiUrl(profile.baseUrl, 'images/generations', proxyConfig, useApiProxy, { prefixV1: false }), {
      method: 'POST',
      headers: createRequestHeaders(profile),
      cache: 'no-store',
      body: JSON.stringify(createRequestBody(opts, profile)),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response))
    }

    return parseImagesApiResponse(await response.json() as ImageApiResponse, opts.params, mime, controller.signal)
  } finally {
    abortController.cleanup()
  }
}

