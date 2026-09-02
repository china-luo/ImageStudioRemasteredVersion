import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { DEFAULT_PARAMS, type ExportData } from '../types'
import { DEFAULT_SETTINGS, mergeImportedSettings, normalizeSettings } from './apiProfiles'
import {
  isEmptyAgentConversation,
  mergeImportedAgentConversations,
  normalizeAgentConversations,
} from './agentConversationNormalize'
import { bytesToDataUrl, dataUrlToBytes } from './backupCodec'
import { cacheImage, cacheThumbnail, clearImageCaches, scheduleThumbnailBackfill } from './imageCache'
import { formatExportFileTime } from './downloadImages'
import { migrateLegacyTaskStreamFields } from './legacyTaskMigration'
import { stripSecretsFromSettings } from './secretStore'
import { collectAmazonPlannerSessionImageIds } from './workspaceDrafts'
import {
  clearAmazonPlannerSessions as dbClearAmazonPlannerSessions,
  clearImages,
  clearTasks as dbClearTasks,
  getAllAmazonPlannerSessions,
  getAllImages,
  getAllTasks,
  getImageThumbnail,
  putAmazonPlannerSession,
  putImage,
  putImageThumbnail,
  putTask,
} from './db'
import { deleteUnreferencedImageIds, useStore } from '../store'

export interface ClearOptions {
  clearConfig?: boolean
  clearTasks?: boolean
}

export interface ExportOptions {
  exportConfig?: boolean
  exportTasks?: boolean
}

export interface ImportOptions {
  importConfig?: boolean
  importTasks?: boolean
}

export async function clearData(options: ClearOptions = { clearConfig: true, clearTasks: true }) {
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams, showToast } = useStore.getState()

  if (options.clearTasks) {
    await dbClearTasks()
    await dbClearAmazonPlannerSessions()
    await clearImages()
    clearImageCaches()
    setTasks([])
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      supportPromptOpen: false,
    })
    clearInputImages()
    clearMaskDraft()
  }

  if (options.clearConfig) {
    useStore.setState({ dismissedCodexCliPrompts: [] })
    setSettings({ ...DEFAULT_SETTINGS })
    setParams({ ...DEFAULT_PARAMS })
  }

  showToast('所选数据已清空', 'success')
}

export async function exportData(options: ExportOptions = { exportConfig: true, exportTasks: true }) {
  try {
    const tasks = options.exportTasks ? await getAllTasks() : []
    const amazonPlannerSessions = options.exportTasks ? await getAllAmazonPlannerSessions() : []
    const images = options.exportTasks ? await getAllImages() : []
    const { settings, agentConversations } = useStore.getState()
    const exportedAt = Date.now()
    const imageCreatedAtFallback = new Map<string, number>()

    if (options.exportTasks) {
      for (const task of tasks) {
        for (const id of [
          ...(task.inputImageIds || []),
          ...(task.maskImageId ? [task.maskImageId] : []),
          ...(task.outputImages || []),
        ]) {
          const prev = imageCreatedAtFallback.get(id)
          if (prev == null || task.createdAt < prev) {
            imageCreatedAtFallback.set(id, task.createdAt)
          }
        }
      }
      for (const session of amazonPlannerSessions) {
        for (const id of collectAmazonPlannerSessionImageIds(session)) {
          const prev = imageCreatedAtFallback.get(id)
          if (prev == null || session.createdAt < prev) {
            imageCreatedAtFallback.set(id, session.createdAt)
          }
        }
      }
    }

    const imageFiles: ExportData['imageFiles'] = {}
    const thumbnailFiles: NonNullable<ExportData['thumbnailFiles']> = {}
    const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}

    if (options.exportTasks) {
      for (const img of images) {
        const { ext, bytes } = dataUrlToBytes(img.dataUrl)
        const path = `images/${img.id}.${ext}`
        const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt
        imageFiles[img.id] = {
          path,
          createdAt,
          source: img.source,
          width: img.width,
          height: img.height,
        }
        zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]

        const thumbnail = await getImageThumbnail(img.id)
        if (thumbnail?.thumbnailDataUrl) {
          const { ext: thumbnailExt, bytes: thumbnailBytes } = dataUrlToBytes(thumbnail.thumbnailDataUrl)
          const thumbnailPath = `thumbnails/${img.id}.${thumbnailExt}`
          imageFiles[img.id].width = imageFiles[img.id].width ?? thumbnail.width
          imageFiles[img.id].height = imageFiles[img.id].height ?? thumbnail.height
          thumbnailFiles[img.id] = {
            path: thumbnailPath,
            width: thumbnail.width,
            height: thumbnail.height,
            thumbnailVersion: thumbnail.thumbnailVersion,
          }
          zipFiles[thumbnailPath] = [thumbnailBytes, { mtime: new Date(createdAt) }]
          cacheThumbnail(img.id, {
            dataUrl: thumbnail.thumbnailDataUrl,
            width: thumbnail.width,
            height: thumbnail.height,
            thumbnailVersion: thumbnail.thumbnailVersion,
          })
        }
      }
    }

    const manifest: ExportData = {
      version: 4,
      exportedAt: new Date(exportedAt).toISOString(),
    }

    if (options.exportConfig) manifest.settings = stripSecretsFromSettings(normalizeSettings(settings))
    if (options.exportTasks) {
      manifest.tasks = tasks
      manifest.agentConversations = agentConversations
      manifest.amazonPlannerSessions = amazonPlannerSessions
      manifest.imageFiles = imageFiles
      manifest.thumbnailFiles = thumbnailFiles
    }

    zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: new Date(exportedAt) }]

    const zipped = zipSync(zipFiles, { level: 6 })
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `amazon-image-studio-backup_${formatExportFileTime(new Date(exportedAt))}.zip`
    a.click()
    URL.revokeObjectURL(url)
    useStore.getState().showToast('数据已导出', 'success')
  } catch (e) {
    useStore.getState().showToast(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

export async function importData(
  file: File,
  options: ImportOptions = { importConfig: true, importTasks: true },
): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    const manifestBytes = unzipped['manifest.json']
    if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

    const data: ExportData = JSON.parse(strFromU8(manifestBytes))

    const importedImageIds: string[] = []
    if (options.importTasks && data.tasks && data.imageFiles) {
      for (const [id, info] of Object.entries(data.imageFiles)) {
        const bytes = unzipped[info.path]
        if (!bytes) continue
        const dataUrl = bytesToDataUrl(bytes, info.path)
        await putImage({
          id,
          dataUrl,
          createdAt: info.createdAt,
          source: info.source,
          width: info.width,
          height: info.height,
        })
        cacheImage(id, dataUrl)
        importedImageIds.push(id)
      }

      for (const [id, info] of Object.entries(data.thumbnailFiles ?? {})) {
        const bytes = unzipped[info.path]
        if (!bytes) continue
        const thumbnailDataUrl = bytesToDataUrl(bytes, info.path)
        await putImageThumbnail({
          id,
          thumbnailDataUrl,
          width: info.width,
          height: info.height,
          thumbnailVersion: info.thumbnailVersion,
        })
        cacheThumbnail(id, {
          dataUrl: thumbnailDataUrl,
          width: info.width,
          height: info.height,
          thumbnailVersion: info.thumbnailVersion,
        })
      }

      const legacyIntermediateImageIds = new Set<string>()
      for (const task of data.tasks) {
        const migration = migrateLegacyTaskStreamFields(task)
        migration.removedImageIds.forEach((id) => legacyIntermediateImageIds.add(id))
        await putTask(migration.task)
      }
      for (const session of data.amazonPlannerSessions ?? []) {
        await putAmazonPlannerSession(session)
      }

      const tasks = await getAllTasks()
      useStore.getState().setTasks(tasks)
      const importedAgentConversations = normalizeAgentConversations(data.agentConversations).filter(
        (conversation) => !isEmptyAgentConversation(conversation),
      )
      useStore.setState((state) => {
        const agentConversations = mergeImportedAgentConversations(state.agentConversations, importedAgentConversations)
        const activeAgentConversationId =
          state.activeAgentConversationId &&
          agentConversations.some((conversation) => conversation.id === state.activeAgentConversationId)
            ? state.activeAgentConversationId
            : (importedAgentConversations[0]?.id ?? agentConversations[0]?.id ?? null)
        return {
          agentConversations,
          activeAgentConversationId,
        }
      })
      await deleteUnreferencedImageIds(legacyIntermediateImageIds)
      scheduleThumbnailBackfill(importedImageIds)
    }

    if (options.importConfig && data.settings) {
      const state = useStore.getState()
      state.setSettings(mergeImportedSettings(state.settings, data.settings))
    }

    let msg = '数据已成功导入'
    if (options.importTasks && data.tasks) {
      const plannerSessionCount = data.amazonPlannerSessions?.length ?? 0
      msg = plannerSessionCount
        ? `已导入 ${data.tasks.length} 条记录和 ${plannerSessionCount} 条策划历史`
        : `已导入 ${data.tasks.length} 条记录`
    } else if (options.importConfig && data.settings) {
      msg = '配置已成功导入'
    }

    useStore.getState().showToast(msg, 'success')
    return true
  } catch (e) {
    useStore.getState().showToast(`导入失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    return false
  }
}
