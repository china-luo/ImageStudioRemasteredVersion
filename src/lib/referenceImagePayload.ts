import { getDataUrlEncodedByteSize } from './imageApiShared'

export type PlannerReferenceImagePayloadPass = 'none' | 'primary' | 'fallback'

export interface PlannerReferenceImagePayload {
  dataUrls: string[]
  originalBytes: number
  payloadBytes: number
  compressedCount: number
  pass: PlannerReferenceImagePayloadPass
  notice: string
}

export interface PlannerReferenceImageCompressionRequest {
  maxEdge: number
  quality: number
}

export type PlannerReferenceImageCompressor = (
  dataUrl: string,
  request: PlannerReferenceImageCompressionRequest,
  signal?: AbortSignal,
) => Promise<string>

export type PlannerReferenceImageMaskCompressor = (
  imageDataUrl: string,
  maskDataUrl: string,
  request: PlannerReferenceImageCompressionRequest,
  signal?: AbortSignal,
) => Promise<{ imageDataUrl: string; maskDataUrl: string }>

export interface PreparePlannerReferenceImagePayloadOptions {
  signal?: AbortSignal
  maxPayloadBytes?: number
  compressor?: PlannerReferenceImageCompressor
  maskCompressor?: PlannerReferenceImageMaskCompressor
}

const PRIMARY_MAX_EDGE = 1024
const PRIMARY_QUALITY = 0.82
const FALLBACK_MAX_EDGE = 768
const FALLBACK_QUALITY = 0.72
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024

function canUseCanvasCompression() {
  return typeof document !== 'undefined' && typeof Image !== 'undefined' && typeof FileReader !== 'undefined'
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw new DOMException('操作已停止', 'AbortError')
}

function formatMiB(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function sumDataUrlBytes(dataUrls: string[]) {
  return dataUrls.reduce((sum, dataUrl) => sum + getDataUrlEncodedByteSize(dataUrl), 0)
}

function createNotice(compressedCount: number, originalBytes: number, payloadBytes: number, pass: PlannerReferenceImagePayloadPass) {
  if (compressedCount <= 0 || pass === 'none') return ''
  const suffix = pass === 'fallback' ? '，已自动降级压缩' : ''
  return `本次已压缩 ${compressedCount} 张参考图：${formatMiB(originalBytes)} -> ${formatMiB(payloadBytes)}${suffix}`
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('图片编码失败'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(dataUrl: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const image = new Image()
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new DOMException('操作已停止', 'AbortError'))
    }
    image.onload = () => {
      cleanup()
      resolve(image)
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('参考图加载失败，请删除损坏图片后重试'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    image.src = dataUrl
  })
}

function canvasToTypedBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

async function encodeCanvas(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/jpeg', quality: number): Promise<Blob | null> {
  const blob = await canvasToTypedBlob(canvas, type, quality)
  if (!blob || blob.size <= 0) return null
  return blob.type === type ? blob : null
}

async function compressReferenceImageDataUrl(
  dataUrl: string,
  request: PlannerReferenceImageCompressionRequest,
  signal?: AbortSignal,
): Promise<string> {
  if (!canUseCanvasCompression()) return dataUrl

  const image = await loadImage(dataUrl, signal)
  throwIfAborted(signal)

  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('参考图尺寸无效，请删除损坏图片后重试')

  const scale = Math.min(1, request.maxEdge / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 图片压缩')
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

  const webpBlob = await encodeCanvas(canvas, 'image/webp', request.quality)
  if (webpBlob) return blobToDataUrl(webpBlob)

  const jpegCanvas = document.createElement('canvas')
  jpegCanvas.width = targetWidth
  jpegCanvas.height = targetHeight
  const jpegCtx = jpegCanvas.getContext('2d')
  if (!jpegCtx) throw new Error('当前浏览器不支持 Canvas 图片压缩')
  jpegCtx.fillStyle = '#fff'
  jpegCtx.fillRect(0, 0, targetWidth, targetHeight)
  jpegCtx.drawImage(image, 0, 0, targetWidth, targetHeight)

  const jpegBlob = await encodeCanvas(jpegCanvas, 'image/jpeg', request.quality)
  if (!jpegBlob) throw new Error('参考图压缩失败，请删除该图片后重试')
  return blobToDataUrl(jpegBlob)
}

async function encodePngCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await canvasToTypedBlob(canvas, 'image/png', 1)
  if (!blob || blob.size <= 0) throw new Error('遮罩压缩失败，请重新绘制遮罩后重试')
  return blob
}

async function compressReferenceImageAndMaskDataUrl(
  imageDataUrl: string,
  maskDataUrl: string,
  request: PlannerReferenceImageCompressionRequest,
  signal?: AbortSignal,
): Promise<{ imageDataUrl: string; maskDataUrl: string }> {
  if (!canUseCanvasCompression()) return { imageDataUrl, maskDataUrl }

  const [image, mask] = await Promise.all([loadImage(imageDataUrl, signal), loadImage(maskDataUrl, signal)])
  throwIfAborted(signal)

  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('参考图尺寸无效，请删除损坏图片后重试')
  if (mask.naturalWidth !== width || mask.naturalHeight !== height) {
    throw new Error('遮罩尺寸与遮罩主图不一致，请重新绘制遮罩')
  }

  const scale = Math.min(1, request.maxEdge / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  const imageCanvas = document.createElement('canvas')
  imageCanvas.width = targetWidth
  imageCanvas.height = targetHeight
  const imageCtx = imageCanvas.getContext('2d')
  if (!imageCtx) throw new Error('当前浏览器不支持 Canvas 图片压缩')
  imageCtx.drawImage(image, 0, 0, targetWidth, targetHeight)

  const webpBlob = await encodeCanvas(imageCanvas, 'image/webp', request.quality)
  let preparedImageDataUrl: string
  if (webpBlob) {
    preparedImageDataUrl = await blobToDataUrl(webpBlob)
  } else {
    const jpegCanvas = document.createElement('canvas')
    jpegCanvas.width = targetWidth
    jpegCanvas.height = targetHeight
    const jpegCtx = jpegCanvas.getContext('2d')
    if (!jpegCtx) throw new Error('当前浏览器不支持 Canvas 图片压缩')
    jpegCtx.fillStyle = '#fff'
    jpegCtx.fillRect(0, 0, targetWidth, targetHeight)
    jpegCtx.drawImage(image, 0, 0, targetWidth, targetHeight)
    const jpegBlob = await encodeCanvas(jpegCanvas, 'image/jpeg', request.quality)
    if (!jpegBlob) throw new Error('参考图压缩失败，请删除该图片后重试')
    preparedImageDataUrl = await blobToDataUrl(jpegBlob)
  }

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = targetWidth
  maskCanvas.height = targetHeight
  const maskCtx = maskCanvas.getContext('2d')
  if (!maskCtx) throw new Error('当前浏览器不支持 Canvas 图片压缩')
  maskCtx.drawImage(mask, 0, 0, targetWidth, targetHeight)
  const preparedMaskDataUrl = await blobToDataUrl(await encodePngCanvas(maskCanvas))

  return { imageDataUrl: preparedImageDataUrl, maskDataUrl: preparedMaskDataUrl }
}

async function compressAll(
  dataUrls: string[],
  request: PlannerReferenceImageCompressionRequest,
  compressor: PlannerReferenceImageCompressor,
  signal?: AbortSignal,
): Promise<string[]> {
  const result: string[] = []
  for (const dataUrl of dataUrls) {
    throwIfAborted(signal)
    result.push(await compressor(dataUrl, request, signal))
  }
  throwIfAborted(signal)
  return result
}

async function compressAllWithOptionalMask(
  dataUrls: string[],
  maskDataUrl: string | undefined,
  request: PlannerReferenceImageCompressionRequest,
  compressor: PlannerReferenceImageCompressor,
  maskCompressor: PlannerReferenceImageMaskCompressor,
  signal?: AbortSignal,
): Promise<{ dataUrls: string[]; maskDataUrl?: string }> {
  const result: string[] = []
  let nextMaskDataUrl: string | undefined

  if (maskDataUrl) {
    if (dataUrls[0]) {
      const compressed = await maskCompressor(dataUrls[0], maskDataUrl, request, signal)
      result.push(compressed.imageDataUrl)
      nextMaskDataUrl = compressed.maskDataUrl
    } else {
      nextMaskDataUrl = maskDataUrl
    }
  }

  for (let i = maskDataUrl ? 1 : 0; i < dataUrls.length; i++) {
    throwIfAborted(signal)
    result.push(await compressor(dataUrls[i], request, signal))
  }
  throwIfAborted(signal)
  return { dataUrls: result, maskDataUrl: nextMaskDataUrl }
}

function sumPayloadBytes(dataUrls: string[], maskDataUrl?: string) {
  return sumDataUrlBytes(dataUrls) + (maskDataUrl ? getDataUrlEncodedByteSize(maskDataUrl) : 0)
}

export async function prepareReferenceImagePayload(
  dataUrls: string[],
  options: PreparePlannerReferenceImagePayloadOptions = {},
): Promise<PlannerReferenceImagePayload> {
  throwIfAborted(options.signal)

  const originalBytes = sumDataUrlBytes(dataUrls)
  if (!dataUrls.length) {
    return {
      dataUrls: [],
      originalBytes,
      payloadBytes: 0,
      compressedCount: 0,
      pass: 'none',
      notice: '',
    }
  }

  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES
  const compressor = options.compressor ?? compressReferenceImageDataUrl

  const primaryDataUrls = await compressAll(
    dataUrls,
    { maxEdge: PRIMARY_MAX_EDGE, quality: PRIMARY_QUALITY },
    compressor,
    options.signal,
  )
  const primaryBytes = sumDataUrlBytes(primaryDataUrls)
  if (primaryBytes <= maxPayloadBytes) {
    return {
      dataUrls: primaryDataUrls,
      originalBytes,
      payloadBytes: primaryBytes,
      compressedCount: dataUrls.length,
      pass: 'primary',
      notice: createNotice(dataUrls.length, originalBytes, primaryBytes, 'primary'),
    }
  }

  const fallbackDataUrls = await compressAll(
    dataUrls,
    { maxEdge: FALLBACK_MAX_EDGE, quality: FALLBACK_QUALITY },
    compressor,
    options.signal,
  )
  const fallbackBytes = sumDataUrlBytes(fallbackDataUrls)
  if (fallbackBytes <= maxPayloadBytes) {
    return {
      dataUrls: fallbackDataUrls,
      originalBytes,
      payloadBytes: fallbackBytes,
      compressedCount: dataUrls.length,
      pass: 'fallback',
      notice: createNotice(dataUrls.length, originalBytes, fallbackBytes, 'fallback'),
    }
  }

  throw new Error(`参考图压缩后仍过大：${formatMiB(fallbackBytes)}，上限为 ${formatMiB(maxPayloadBytes)}。请删除部分参考图或换更小图片后重试。`)
}

export async function prepareReferenceImageAndMaskPayload(
  dataUrls: string[],
  maskDataUrl?: string,
  options: PreparePlannerReferenceImagePayloadOptions = {},
): Promise<PlannerReferenceImagePayload & { maskDataUrl?: string }> {
  throwIfAborted(options.signal)

  const originalBytes = sumPayloadBytes(dataUrls, maskDataUrl)
  if (!dataUrls.length && !maskDataUrl) {
    return {
      dataUrls: [],
      originalBytes,
      payloadBytes: 0,
      compressedCount: 0,
      pass: 'none',
      notice: '',
    }
  }

  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES
  const compressor = options.compressor ?? compressReferenceImageDataUrl
  const maskCompressor = options.maskCompressor ?? compressReferenceImageAndMaskDataUrl

  const primary = await compressAllWithOptionalMask(
    dataUrls,
    maskDataUrl,
    { maxEdge: PRIMARY_MAX_EDGE, quality: PRIMARY_QUALITY },
    compressor,
    maskCompressor,
    options.signal,
  )
  const primaryBytes = sumPayloadBytes(primary.dataUrls, primary.maskDataUrl)
  if (primaryBytes <= maxPayloadBytes) {
    return {
      dataUrls: primary.dataUrls,
      maskDataUrl: primary.maskDataUrl,
      originalBytes,
      payloadBytes: primaryBytes,
      compressedCount: dataUrls.length,
      pass: 'primary',
      notice: createNotice(dataUrls.length, originalBytes, primaryBytes, 'primary'),
    }
  }

  const fallback = await compressAllWithOptionalMask(
    dataUrls,
    maskDataUrl,
    { maxEdge: FALLBACK_MAX_EDGE, quality: FALLBACK_QUALITY },
    compressor,
    maskCompressor,
    options.signal,
  )
  const fallbackBytes = sumPayloadBytes(fallback.dataUrls, fallback.maskDataUrl)
  if (fallbackBytes <= maxPayloadBytes) {
    return {
      dataUrls: fallback.dataUrls,
      maskDataUrl: fallback.maskDataUrl,
      originalBytes,
      payloadBytes: fallbackBytes,
      compressedCount: dataUrls.length,
      pass: 'fallback',
      notice: createNotice(dataUrls.length, originalBytes, fallbackBytes, 'fallback'),
    }
  }

  throw new Error(`参考图压缩后仍过大：${formatMiB(fallbackBytes)}，上限为 ${formatMiB(maxPayloadBytes)}。请删除部分参考图或换更小图片后重试。`)
}

export const preparePlannerReferenceImagePayload = prepareReferenceImagePayload
