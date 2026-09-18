import { ensureImageCached } from './imageCache'
import { strToU8, zipSync } from 'fflate'

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

export interface DownloadZipResult extends DownloadImagesResult {
  archiveName: string | null
  failedImageIds: string[]
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

export async function downloadImageIdsAsZip(
  imageIds: string[],
  fileNameBase = 'images',
  onProgress?: (completed: number, total: number) => void,
): Promise<DownloadZipResult> {
  if (imageIds.length === 0) {
    return { archiveName: null, successCount: 0, failCount: 0, canceled: false, failedImageIds: [] }
  }

  const files: Record<string, Uint8Array> = {}
  const failedImageIds: string[] = []
  for (let index = 0; index < imageIds.length; index++) {
    const imageId = imageIds[index]
    try {
      const blob = await getImageBlob(imageId)
      const order = String(index + 1).padStart(3, '0')
      files[`${fileNameBase}-${order}.${getBlobExtension(blob)}`] = new Uint8Array(await blob.arrayBuffer())
    } catch (error) {
      console.error(error)
      failedImageIds.push(imageId)
    } finally {
      onProgress?.(index + 1, imageIds.length)
    }
  }

  if (Object.keys(files).length === 0) {
    return { archiveName: null, successCount: 0, failCount: failedImageIds.length, canceled: false, failedImageIds }
  }

  files['manifest.json'] = strToU8(
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        successCount: Object.keys(files).length,
        failedImageIds,
      },
      null,
      2,
    ),
  )
  const archiveName = `${fileNameBase}.zip`
  const zipBytes = zipSync(files)
  const zipBuffer = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer
  triggerDownload(new Blob([zipBuffer], { type: 'application/zip' }), archiveName)
  return {
    archiveName,
    successCount: Object.keys(files).length - 1,
    failCount: failedImageIds.length,
    canceled: false,
    failedImageIds,
  }
}

async function getImageBlob(imageIdOrUrl: string): Promise<Blob> {
  let src = imageIdOrUrl
  if (
    !imageIdOrUrl.startsWith('data:') &&
    !imageIdOrUrl.startsWith('http://') &&
    !imageIdOrUrl.startsWith('https://')
  ) {
    src = (await ensureImageCached(imageIdOrUrl)) ?? imageIdOrUrl
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
