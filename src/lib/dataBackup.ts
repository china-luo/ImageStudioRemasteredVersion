import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { DEFAULT_PARAMS, type ExportData } from '../types'
import { DEFAULT_SETTINGS, mergeImportedSettings, normalizeSettings } from './apiProfiles'
import {
  isEmptyAgentConversation,
  mergeImportedAgentConversations,
  normalizeAgentConversations,
} from './agentConversationNormalize'
import { bytesToDataUrl, dataUrlToBytes } from './backupCodec'
import { cacheThumbnail, clearImageCaches, scheduleThumbnailBackfill } from './imageCache'
import { formatExportFileTime } from './downloadImages'
import { migrateLegacyTaskStreamFields } from './legacyTaskMigration'
import { stripSecretsFromSettings } from './secretStore'
import { collectAmazonPlannerSessionImageIds } from './workspaceDrafts'
import {
  getAllAmazonPlannerSessions,
  getAllImages,
  getAllTasks,
  getImageThumbnail,
  getAllGenerationProjects,
  clearTaskData,
  importTaskData,
  type ImportedTaskData,
} from './db'
import { cancelAllTaskWork, restoreInterruptedTaskWork, scheduleTaskRecordRecovery, useStore } from '../store'
import { markInterruptedOpenAIRunningTasks } from './taskBootstrap'
import {
  rememberActiveProject,
  PROJECT_DATA_EVENT,
  PROJECT_DATA_IMPORTED_EVENT,
  PROJECT_DATA_RESET_EVENT,
  PROJECT_JOURNAL_KEY,
} from './generationProjects'
import { PLANNER_WORKSPACE_KEY } from '../components/planner/plannerWorkspaceDraft'
import { resetSiteBackground } from './siteBackground'

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

const BACKUP_VERSION = 5
let dataMutation = Promise.resolve()

function serializeDataMutation<T>(action: () => Promise<T>): Promise<T> {
  const result = dataMutation.then(action)
  dataMutation = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function notifyProjectData(type: string) {
  if (typeof window !== 'undefined') window.dispatchEvent?.(new Event(type))
}

// 本页清空和其他标签页的清空共用同一套内存与草稿清理。
function resetLocalTaskView() {
  try {
    rememberActiveProject(null)
    sessionStorage.removeItem(PLANNER_WORKSPACE_KEY)
    sessionStorage.removeItem(PROJECT_JOURNAL_KEY)
  } catch {
    // 浏览器可能禁用会话存储；IndexedDB 已完成清空。
  }
  const state = useStore.getState()
  clearImageCaches()
  useStore.setState({
    tasks: [],
    agentConversations: [],
    activeAgentConversationId: null,
    supportPromptOpen: false,
    selectedTaskIds: [],
    detailTaskId: null,
    lightboxImageId: null,
    lightboxImageList: [],
    pendingTaskCategory: null,
  })
  state.clearInputImages()
  state.clearMaskDraft()
  state.resetSeedreamEditorDraft()
}

export function applyExternalTaskDataReset() {
  cancelAllTaskWork()
  notifyProjectData(PROJECT_DATA_RESET_EVENT)
  resetLocalTaskView()
  return () => notifyProjectData(PROJECT_DATA_EVENT)
}

export function clearData(options: ClearOptions = { clearConfig: true, clearTasks: true }): Promise<boolean> {
  return serializeDataMutation(async () => {
    const { setTasks, setSettings, setParams, showToast } = useStore.getState()
    try {
      if (options.clearTasks) {
        const previousTasks = useStore.getState().tasks
        // 先取消本地后台工作，再让任务脱离状态；旧回调不能重新写入已清空的记录。
        const generation = cancelAllTaskWork()
        notifyProjectData(PROJECT_DATA_RESET_EVENT)
        setTasks([])
        try {
          await clearTaskData()
        } catch (error) {
          try {
            await restoreInterruptedTaskWork(previousTasks, generation)
          } catch (restoreError) {
            console.warn('清空回滚后未能完整恢复任务状态:', restoreError)
          }
          notifyProjectData(PROJECT_DATA_EVENT)
          throw error
        }
        resetLocalTaskView()
        notifyProjectData(PROJECT_DATA_EVENT)
      }

      if (options.clearConfig) {
        useStore.setState({ dismissedCodexCliPrompts: [] })
        setSettings({ ...DEFAULT_SETTINGS })
        setParams({ ...DEFAULT_PARAMS })
        resetSiteBackground()
      }
      showToast('所选数据已清空', 'success')
      return true
    } catch (error) {
      showToast(`清空失败：${error instanceof Error ? error.message : String(error)}`, 'error')
      return false
    }
  })
}

export async function exportData(options: ExportOptions = { exportConfig: true, exportTasks: true }) {
  try {
    const tasks = options.exportTasks ? await getAllTasks() : []
    const amazonPlannerSessions = options.exportTasks ? await getAllAmazonPlannerSessions() : []
    const generationProjects = options.exportTasks ? await getAllGenerationProjects() : []
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
      version: BACKUP_VERSION,
      exportedAt: new Date(exportedAt).toISOString(),
    }

    if (options.exportConfig) manifest.settings = stripSecretsFromSettings(normalizeSettings(settings))
    if (options.exportTasks) {
      manifest.tasks = tasks
      manifest.agentConversations = agentConversations
      manifest.amazonPlannerSessions = amazonPlannerSessions
      manifest.generationProjects = generationProjects
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function checkRows<T extends { id: string }>(rows: T[] | undefined, label: string, isValid: (row: T) => boolean): T[] {
  if (rows === undefined) return []
  if (!Array.isArray(rows)) throw new Error(`${label}格式无效`)
  const ids = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) || !isValid(row)) {
      throw new Error(`${label}包含无效记录或重复 ID`)
    }
    ids.add(row.id)
  }
  return rows
}

function prepareTaskData(data: ExportData, contents: Record<string, Uint8Array>): ImportedTaskData {
  const tasks = markInterruptedOpenAIRunningTasks(
    checkRows(
      data.tasks,
      '任务',
      (task) =>
        typeof task.prompt === 'string' &&
        isRecord(task.params) &&
        isStringList(task.inputImageIds) &&
        isStringList(task.outputImages) &&
        ['running', 'done', 'error'].includes(task.status) &&
        Number.isFinite(task.createdAt),
    ).map((task) => migrateLegacyTaskStreamFields(task).task),
  ).tasks
  const plannerSessions = checkRows(
    data.amazonPlannerSessions,
    '策划历史',
    (session) =>
      isRecord(session.draft) &&
      isRecord(session.seriesStyleGuides) &&
      isStringList(session.referenceImageIds) &&
      Array.isArray(session.styleCandidates) &&
      Array.isArray(session.styleImages) &&
      Array.isArray(session.imagePlans) &&
      Array.isArray(session.aPlusPlans),
  )
  const projects = checkRows(
    data.generationProjects,
    '项目',
    (project) =>
      typeof project.name === 'string' &&
      isRecord(project.workspace) &&
      isStringList(project.referenceImageIds) &&
      isRecord(project.finals),
  )
  const readFiles = <T extends { path: string }, R>(
    files: Record<string, T> | undefined,
    map: (id: string, info: T, dataUrl: string) => R,
  ): R[] => {
    if (files === undefined) return []
    if (!isRecord(files)) throw new Error('备份图片索引格式无效')
    return Object.entries(files).map(([id, info]) => {
      if (!id.trim() || !isRecord(info) || typeof info.path !== 'string' || !info.path) {
        throw new Error('备份图片记录格式无效')
      }
      const bytes = Object.hasOwn(contents, info.path) && contents[info.path]
      if (!bytes || bytes.length === 0) throw new Error(`ZIP 中缺少有效图片：${info.path}`)
      return map(id, info, bytesToDataUrl(bytes, info.path))
    })
  }
  const images = readFiles(data.imageFiles, (id, { path: _path, ...info }, dataUrl) => ({ ...info, id, dataUrl }))
  const thumbnails = readFiles(data.thumbnailFiles, (id, { path: _path, ...info }, thumbnailDataUrl) => ({
    ...info,
    id,
    thumbnailDataUrl,
  }))
  return { tasks, plannerSessions, projects, images, thumbnails }
}

export function importData(
  file: File,
  options: ImportOptions = { importConfig: true, importTasks: true },
): Promise<boolean> {
  return serializeDataMutation(async () => {
    let taskDataCommitted = false
    try {
      const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const manifestBytes = unzipped['manifest.json']
      if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')
      const data = JSON.parse(strFromU8(manifestBytes)) as ExportData
      if (!isRecord(data) || !Number.isInteger(data.version) || data.version < 1 || data.version > BACKUP_VERSION) {
        throw new Error('不支持此备份格式或版本')
      }
      const hasTaskData =
        options.importTasks &&
        [
          data.tasks,
          data.imageFiles,
          data.thumbnailFiles,
          data.amazonPlannerSessions,
          data.generationProjects,
          data.agentConversations,
        ].some((part) => part !== undefined)
      const taskData = hasTaskData ? prepareTaskData(data, unzipped) : null
      const importedAgentConversations = taskData
        ? normalizeAgentConversations(data.agentConversations).filter(
            (conversation) => !isEmptyAgentConversation(conversation),
          )
        : []
      const state = useStore.getState()
      const importedSettings =
        options.importConfig && data.settings !== undefined
          ? mergeImportedSettings(state.settings, data.settings)
          : null
      const saved = taskData ? await importTaskData(taskData) : null
      taskDataCommitted = saved !== null

      // 只有 IndexedDB 完整提交之后才更新 UI 和缓存。
      if (saved) {
        useStore.setState((current) => {
          const localTaskIds = new Set(current.tasks.map((task) => task.id))
          const agentConversations = mergeImportedAgentConversations(
            current.agentConversations,
            importedAgentConversations,
          )
          const activeAgentConversationId =
            current.activeAgentConversationId &&
            agentConversations.some((conversation) => conversation.id === current.activeAgentConversationId)
              ? current.activeAgentConversationId
              : (importedAgentConversations[0]?.id ?? agentConversations[0]?.id ?? null)
          return {
            tasks: [...saved.tasks.filter((task) => !localTaskIds.has(task.id)), ...current.tasks],
            agentConversations,
            activeAgentConversationId,
          }
        })
        scheduleThumbnailBackfill(saved.imageIds)
        notifyProjectData(PROJECT_DATA_IMPORTED_EVENT)
      }
      if (importedSettings) state.setSettings(importedSettings)
      if (saved) scheduleTaskRecordRecovery(saved.tasks)

      let message = saved
        ? `已导入 ${saved.importedTasks} 条记录`
        : importedSettings
          ? '配置已成功导入'
          : '备份中没有所选数据'
      if (saved?.importedSessions) message += `和 ${saved.importedSessions} 条策划历史`
      if (saved?.importedProjects) message += `，新增 ${saved.importedProjects} 个项目`
      if (saved?.skipped) message += `；已保留 ${saved.skipped} 条同 ID 的本地数据`
      state.showToast(message, 'success')
      return true
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      useStore
        .getState()
        .showToast(
          taskDataCommitted ? `任务数据已导入，但后续刷新或配置保存失败：${detail}` : `导入失败：${detail}`,
          'error',
        )
      return taskDataCommitted
    }
  })
}
