import { ensureImageCached } from '../store'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface DownloadImagesResult {
  successCount: number
  failCount: number
  canceled: boolean
}

export function formatExportFileTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export async function downloadImageIds(imageIds: string[], fileNameBase = 'images'): Promise<DownloadImagesResult> {
  if (imageIds.length === 0) return { successCount: 0, failCount: 0, canceled: false }

  let successCount = 0
  let failCount = 0
  const multiple = imageIds.length > 1
  const preparedFiles: Array<{ fileName: string; blob: Blob }> = []

  for (let index = 0; index < imageIds.length; index++) {
    try {
      const blob = await getImageBlob(imageIds[index])
      const order = String(index + 1).padStart(2, '0')
      const fileName = multiple
        ? `${fileNameBase}-${order}.${getBlobExtension(blob)}`
        : `${fileNameBase}.${getBlobExtension(blob)}`
      preparedFiles.push({ fileName, blob })
    } catch (err) {
      console.error(err)
      failCount++
    }
  }

  const desktop = multiple ? window.imageStudioDesktop : undefined
  if (
    desktop?.selectImageSaveDirectory &&
    desktop.saveImageFile &&
    desktop.finishImageSave &&
    preparedFiles.length > 0
  ) {
    const selected = await desktop.selectImageSaveDirectory()
    if (!selected) return { canceled: true, successCount: 0, failCount }

    try {
      for (const { fileName, blob } of preparedFiles) {
        try {
          const data = new Uint8Array(await blob.arrayBuffer())
          await desktop.saveImageFile({ fileName, data })
          successCount++
        } catch (err) {
          console.error(err)
          failCount++
        }
      }
    } finally {
      await desktop.finishImageSave()
    }
    return { canceled: false, successCount, failCount }
  }

  for (const { blob, fileName } of preparedFiles) {
    triggerDownload(blob, fileName)
    successCount++
    if (multiple) await delay(100)
  }

  return { successCount, failCount, canceled: false }
}

async function getImageBlob(imageIdOrUrl: string): Promise<Blob> {
  let src = imageIdOrUrl
  if (!imageIdOrUrl.startsWith('data:') && !imageIdOrUrl.startsWith('http://') && !imageIdOrUrl.startsWith('https://')) {
    src = await ensureImageCached(imageIdOrUrl) ?? imageIdOrUrl
  }

  const res = await fetch(src)
  if (!res.ok && !src.startsWith('data:')) throw new Error(`读取图片失败：${imageIdOrUrl}`)
  return await res.blob()
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function getBlobExtension(blob: Blob): string {
  return MIME_EXTENSIONS[blob.type.toLowerCase()] ?? blob.type.split('/')[1] ?? 'png'
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

