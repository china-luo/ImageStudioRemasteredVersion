import { strToU8, zipSync } from 'fflate'
import type { GenerationProject, TaskRecord } from '../types'
import { dataUrlToBytes } from './backupCodec'
import { ensureImageCached } from './imageCache'
import { projectFinalEntries } from './generationProjects'

export function exportName(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 80) || 'project'
  )
}

export async function buildProjectArchive(
  project: GenerationProject,
  tasks: TaskRecord[],
  readImage = ensureImageCached,
) {
  const entries = projectFinalEntries(project, tasks)
  if (!entries.length) throw new Error('请先为图片位选择定稿。')
  const files: Record<string, Uint8Array> = {}
  const manifest = []
  for (const [index, entry] of entries.entries()) {
    const dataUrl = await readImage(entry.imageId)
    if (!dataUrl)
      throw new Error(`图片位 ${entry.task.category?.amazonSlot ?? index + 1} 的定稿图片已丢失，请重新生成。`)
    const { ext, bytes } = dataUrlToBytes(dataUrl)
    const file = `${String(index + 1).padStart(2, '0')}_${exportName(entry.task.category?.workflow ?? 'image')}_${exportName(entry.task.category?.amazonSlot ?? 'image')}.${ext}`
    files[file] = bytes
    manifest.push({ file, slotId: entry.slotId, taskId: entry.task.id, imageId: entry.imageId })
  }
  files['manifest.json'] = strToU8(
    JSON.stringify(
      { projectId: project.id, projectName: project.name, exportedAt: new Date().toISOString(), images: manifest },
      null,
      2,
    ),
  )
  return { fileName: `${exportName(project.name)}_定稿.zip`, bytes: zipSync(files), count: entries.length }
}

export async function downloadProjectFinals(project: GenerationProject, tasks: TaskRecord[]) {
  const archive = await buildProjectArchive(project, tasks)
  const url = URL.createObjectURL(new Blob([archive.bytes as BlobPart], { type: 'application/zip' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = archive.fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return archive.count
}
