import { getPublicAssetUrl } from './publicAsset'

export const SITE_BACKGROUND_STORAGE_KEY = 'image-studio-site-background'
export const SITE_BACKGROUND_MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const SITE_BACKGROUND_MAX_DATA_URL_LENGTH = 1_600_000

const MAX_BACKGROUND_EDGE = 1920
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const SAFE_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,/i

export function isValidSiteBackgroundDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= SITE_BACKGROUND_MAX_DATA_URL_LENGTH && SAFE_DATA_URL.test(value)
}

export function getStoredSiteBackground(): string | null {
  try {
    const value = localStorage.getItem(SITE_BACKGROUND_STORAGE_KEY)
    return isValidSiteBackgroundDataUrl(value) ? value : null
  } catch {
    return null
  }
}

export function applySiteBackground(dataUrl: string | null = getStoredSiteBackground()) {
  const imageUrl = isValidSiteBackgroundDataUrl(dataUrl) ? dataUrl : getPublicAssetUrl('site-background.png')
  document.documentElement.style.setProperty('--site-background-image', `url(${JSON.stringify(imageUrl)})`)
}

export function saveSiteBackground(dataUrl: string) {
  if (!isValidSiteBackgroundDataUrl(dataUrl)) throw new Error('背景图片处理后仍然过大，请换一张尺寸更小的图片')
  try {
    localStorage.setItem(SITE_BACKGROUND_STORAGE_KEY, dataUrl)
  } catch {
    throw new Error('浏览器没有足够的本地空间保存背景图片')
  }
  applySiteBackground(dataUrl)
}

export function resetSiteBackground() {
  try {
    localStorage.removeItem(SITE_BACKGROUND_STORAGE_KEY)
  } finally {
    applySiteBackground(null)
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('无法读取这张图片，请换一张 JPG、PNG 或 WebP 图片'))
    }
    image.src = objectUrl
  })
}

export async function prepareSiteBackground(file: File): Promise<string> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error('背景图片仅支持 JPG、PNG 或 WebP 格式')
  if (file.size > SITE_BACKGROUND_MAX_UPLOAD_BYTES) throw new Error('背景图片不能超过 20 MB')

  const image = await loadImage(file)
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('背景图片尺寸无效')

  const initialScale = Math.min(1, MAX_BACKGROUND_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  let width = Math.max(1, Math.round(image.naturalWidth * initialScale))
  let height = Math.max(1, Math.round(image.naturalHeight * initialScale))
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法处理背景图片')

  for (let pass = 0; pass < 6; pass++) {
    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    for (const quality of [0.86, 0.72, 0.58]) {
      const dataUrl = canvas.toDataURL('image/webp', quality)
      if (isValidSiteBackgroundDataUrl(dataUrl)) return dataUrl
    }
    width = Math.max(1, Math.round(width * 0.82))
    height = Math.max(1, Math.round(height * 0.82))
  }

  throw new Error('背景图片处理后仍然过大，请换一张尺寸更小的图片')
}
