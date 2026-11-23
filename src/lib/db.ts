import type { AmazonPlannerSession, GenerationProject, TaskRecord, StoredImage, StoredImageThumbnail } from '../types'
import {
  broadcastTaskDataReset,
  runTaskDataResetHandlers,
  subscribeTaskDataReset as subscribeReset,
  type TaskDataResetHandler,
} from './taskDataReset'
import { createProjectId } from './generationProjects'

const DB_NAME = 'amazon-image-studio'
const DB_VERSION = 6
const STORE_TASK_DATA_METADATA = 'taskDataMetadata'
const TASK_DATA_EPOCH_KEY = 'taskDataEpoch'
const INITIAL_TASK_DATA_EPOCH = 'initial'
const STORE_GENERATION_PROJECTS = 'generationProjects'
const PLANNER_HISTORY_RESET_VERSION = 4
const STORE_TASKS = 'tasks'
const STORE_IMAGES = 'images'
const STORE_THUMBNAILS = 'thumbnails'
const STORE_AMAZON_PLANNER_SESSIONS = 'amazonPlannerSessions'
const THUMBNAIL_MAX_SIZE = 720
const THUMBNAIL_QUALITY = 0.9
const THUMBNAIL_VERSION = 2

export const CURRENT_THUMBNAIL_VERSION = THUMBNAIL_VERSION

const TASK_DATA_STORES = [
  STORE_TASKS,
  STORE_IMAGES,
  STORE_THUMBNAILS,
  STORE_AMAZON_PLANNER_SESSIONS,
  STORE_GENERATION_PROJECTS,
]
let taskDataGeneration = 0
let clearingTaskData = false
let acceptedTaskDataEpoch: string | undefined
let taskDataResetPending = false
let epochRefresh: Promise<void> | undefined

function taskDataAbortError() {
  return new DOMException('本地任务数据正在清空或已在其他页面清空，请等待页面重置', 'AbortError')
}

function assertCurrentTaskData(generation: number) {
  if (generation !== taskDataGeneration || clearingTaskData || taskDataResetPending) {
    throw taskDataAbortError()
  }
}

function invalidateTaskData() {
  if (!taskDataResetPending) {
    taskDataResetPending = true
    ++taskDataGeneration
  }
}

export function subscribeTaskDataReset(handler: TaskDataResetHandler): () => void {
  return subscribeReset(handler, refreshTaskDataEpoch)
}

async function readTaskDataEpoch(db: IDBDatabase): Promise<string> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASK_DATA_METADATA, 'readonly')
    const read = tx.objectStore(STORE_TASK_DATA_METADATA).get(TASK_DATA_EPOCH_KEY)
    tx.oncomplete = () => resolve(read.result?.epoch ?? INITIAL_TASK_DATA_EPOCH)
    tx.onabort = () => reject(tx.error ?? taskDataAbortError())
  })
}

/** Accept a shared epoch only after the application has cancelled work and discarded stale views. */
export function refreshTaskDataEpoch(): Promise<void> {
  if (epochRefresh) return epochRefresh
  epochRefresh = (async () => {
    const db = await openDB()
    try {
      for (;;) {
        const epoch = await readTaskDataEpoch(db)
        if (epoch === acceptedTaskDataEpoch && !taskDataResetPending) return
        invalidateTaskData()
        const afterAccept = await runTaskDataResetHandlers()
        if (!afterAccept) throw taskDataAbortError()
        // Another tab may clear again while the asynchronous reset handler is running.
        if ((await readTaskDataEpoch(db)) !== epoch) continue
        acceptedTaskDataEpoch = epoch
        taskDataResetPending = false
        for (const callback of afterAccept) callback()
        return
      }
    } finally {
      db.close()
    }
  })().finally(() => {
    epochRefresh = undefined
  })
  return epochRefresh
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      const oldVersion = (e as IDBVersionChangeEvent).oldVersion
      if (!db.objectStoreNames.contains(STORE_TASK_DATA_METADATA)) {
        db.createObjectStore(STORE_TASK_DATA_METADATA, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_GENERATION_PROJECTS)) {
        db.createObjectStore(STORE_GENERATION_PROJECTS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_THUMBNAILS)) {
        db.createObjectStore(STORE_THUMBNAILS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_AMAZON_PLANNER_SESSIONS)) {
        db.createObjectStore(STORE_AMAZON_PLANNER_SESSIONS, { keyPath: 'id' })
      }
      if (
        oldVersion > 0 &&
        oldVersion < PLANNER_HISTORY_RESET_VERSION &&
        db.objectStoreNames.contains(STORE_AMAZON_PLANNER_SESSIONS)
      ) {
        req.transaction?.objectStore(STORE_AMAZON_PLANNER_SESSIONS).clear()
      }
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      if (acceptedTaskDataEpoch !== undefined) resolve(db)
      else {
        void readTaskDataEpoch(db).then(
          (epoch) => {
            // Concurrent first opens must not overwrite an epoch already accepted by another open.
            acceptedTaskDataEpoch ??= epoch
            resolve(db)
          },
          (error) => {
            db.close()
            reject(error)
          },
        )
      }
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('本地数据库升级正在等待其他页面关闭，请关闭旧页面后重新加载。'))
  })
}

/** Metadata participates in every transaction: delayed cross-tab messages can never allow stale writes. */
async function taskDataTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => () => T,
): Promise<T> {
  const generation = taskDataGeneration
  assertCurrentTaskData(generation)
  const db = await openDB()
  try {
    assertCurrentTaskData(generation)
    const epoch = acceptedTaskDataEpoch
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction([...stores, STORE_TASK_DATA_METADATA], mode)
      let result: (() => T) | undefined
      let failure: unknown
      const read = tx.objectStore(STORE_TASK_DATA_METADATA).get(TASK_DATA_EPOCH_KEY)
      read.onsuccess = () => {
        try {
          assertCurrentTaskData(generation)
          if ((read.result?.epoch ?? INITIAL_TASK_DATA_EPOCH) !== epoch) {
            invalidateTaskData()
            // Abort first; refresh must not wait behind this write transaction.
            throw taskDataAbortError()
          }
          result = action(tx)
        } catch (error) {
          failure = error
          tx.abort()
        }
      }
      tx.oncomplete = () => resolve(result!())
      tx.onabort = () => {
        reject(failure ?? tx.error ?? taskDataAbortError())
        if (taskDataResetPending) void refreshTaskDataEpoch().catch(() => {})
      }
    })
  } finally {
    db.close()
  }
}

function dbTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return taskDataTransaction([storeName], mode, (tx) => {
    const req = fn(tx.objectStore(storeName))
    return () => req.result
  })
}

export interface ImportedTaskData {
  images: StoredImage[]
  thumbnails: StoredImageThumbnail[]
  tasks: TaskRecord[]
  plannerSessions: AmazonPlannerSession[]
  projects: GenerationProject[]
}

/** 同一事务内只补充缺失的 ID，不覆盖本地记录。 */
export async function importTaskData(data: ImportedTaskData) {
  return taskDataTransaction(TASK_DATA_STORES, 'readwrite', (tx) => {
    const tasksStore = tx.objectStore(STORE_TASKS)
    const imagesStore = tx.objectStore(STORE_IMAGES)
    let importedTasks = 0
    let importedSessions = 0
    let importedProjects = 0
    let skipped = 0
    const imageIds: string[] = []
    const compatibleImageIds = new Set<string>()
    const tasks: TaskRecord[] = []

    const insert = <T extends { id: string }>(store: IDBObjectStore, row: T, inserted: () => void) => {
      const request = store.getKey(row.id)
      request.onsuccess = () => {
        if (request.result === undefined) {
          store.add(row)
          inserted()
        } else skipped++
      }
    }
    for (const image of data.images) {
      const request = imagesStore.get(image.id)
      request.onsuccess = () => {
        const current = request.result as StoredImage | undefined
        if (current === undefined) {
          imagesStore.add(image)
          imageIds.push(image.id)
        } else skipped++
        if (!current || current.dataUrl === image.dataUrl) compatibleImageIds.add(image.id)
      }
    }
    const thumbnailsStore = tx.objectStore(STORE_THUMBNAILS)
    for (const thumbnail of data.thumbnails) {
      const request = thumbnailsStore.getKey(thumbnail.id)
      request.onsuccess = () => {
        if (request.result === undefined && compatibleImageIds.has(thumbnail.id)) thumbnailsStore.add(thumbnail)
      }
    }
    for (const task of data.tasks)
      insert(tasksStore, task, () => {
        importedTasks++
        tasks.push(task)
      })
    for (const session of data.plannerSessions) {
      insert(tx.objectStore(STORE_AMAZON_PLANNER_SESSIONS), session, () => {
        importedSessions++
      })
    }
    for (const project of data.projects) {
      insert(tx.objectStore(STORE_GENERATION_PROJECTS), { ...project, revision: 1, writerId: undefined }, () => {
        importedProjects++
      })
    }
    return () => ({ tasks, importedTasks, importedSessions, importedProjects, skipped, imageIds })
  })
}

/** 清空时让已经开始、尚未进入写入事务的工作失效。 */
export async function clearTaskData(): Promise<void> {
  if (clearingTaskData) throw taskDataAbortError()
  clearingTaskData = true
  ++taskDataGeneration
  try {
    const epoch = createProjectId()
    const db = await openDB()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([...TASK_DATA_STORES, STORE_TASK_DATA_METADATA], 'readwrite')
        tx.oncomplete = () => {
          acceptedTaskDataEpoch = epoch
          taskDataResetPending = false
          broadcastTaskDataReset(epoch)
          resolve()
        }
        tx.onabort = () => reject(tx.error ?? new Error('清空任务数据失败，已回滚'))
        try {
          for (const name of TASK_DATA_STORES) tx.objectStore(name).clear()
          tx.objectStore(STORE_TASK_DATA_METADATA).put({ id: TASK_DATA_EPOCH_KEY, epoch })
        } catch (error) {
          tx.abort()
          reject(error)
        }
      })
    } finally {
      db.close()
    }
  } finally {
    clearingTaskData = false
  }
}

// ===== Tasks =====

export function getAllGenerationProjects(): Promise<GenerationProject[]> {
  return dbTransaction(STORE_GENERATION_PROJECTS, 'readonly', (s) => s.getAll())
}

export function clearGenerationProjects(): Promise<undefined> {
  return dbTransaction(STORE_GENERATION_PROJECTS, 'readwrite', (s) => s.clear())
}

// Compare revisions in the same transaction so another tab cannot silently overwrite a project.
export async function putGenerationProject(project: GenerationProject, expectedRevision?: number): Promise<number> {
  let failure: Error | undefined
  try {
    return await taskDataTransaction([STORE_GENERATION_PROJECTS], 'readwrite', (tx) => {
      const store = tx.objectStore(STORE_GENERATION_PROJECTS)
      const read = store.get(project.id)
      let revision = 0
      read.onsuccess = () => {
        const current = read.result as GenerationProject | undefined
        if (expectedRevision != null && (current?.revision ?? 0) !== expectedRevision) {
          failure = new Error('该项目已在其他页面更新，请重新加载项目后继续。当前修改仍保留在本页。')
          tx.abort()
          return
        }
        revision = (current?.revision ?? 0) + 1
        store.put({ ...project, revision })
      }
      return () => revision
    })
  } catch (error) {
    throw failure ?? error
  }
}

export function getAllTasks(): Promise<TaskRecord[]> {
  return dbTransaction(STORE_TASKS, 'readonly', (s) => s.getAll())
}

export function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.put(task))
}

export function deleteTask(id: string): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.delete(id))
}

export function clearTasks(): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.clear())
}

// ===== Amazon planner sessions =====

export function getAllAmazonPlannerSessions(): Promise<AmazonPlannerSession[]> {
  return dbTransaction(STORE_AMAZON_PLANNER_SESSIONS, 'readonly', (s) => s.getAll())
}

export function putAmazonPlannerSession(session: AmazonPlannerSession): Promise<IDBValidKey> {
  return dbTransaction(STORE_AMAZON_PLANNER_SESSIONS, 'readwrite', (s) => s.put(session))
}

export function deleteAmazonPlannerSession(id: string): Promise<undefined> {
  return dbTransaction(STORE_AMAZON_PLANNER_SESSIONS, 'readwrite', (s) => s.delete(id))
}

export function clearAmazonPlannerSessions(): Promise<undefined> {
  return dbTransaction(STORE_AMAZON_PLANNER_SESSIONS, 'readwrite', (s) => s.clear())
}

// ===== Images =====

export function getImage(id: string): Promise<StoredImage | undefined> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.get(id))
}

export function getStoredImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  return dbTransaction(STORE_THUMBNAILS, 'readonly', (s) => s.get(id))
}

export async function getStoredFreshImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const thumbnail = await getStoredImageThumbnail(id)
  return thumbnail?.thumbnailVersion === THUMBNAIL_VERSION ? thumbnail : undefined
}

export function putImageThumbnail(thumbnail: StoredImageThumbnail): Promise<IDBValidKey> {
  return dbTransaction(STORE_THUMBNAILS, 'readwrite', (s) => s.put(thumbnail))
}

export async function getImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const generation = taskDataGeneration
  const existingThumbnail = await getStoredImageThumbnail(id)
  assertCurrentTaskData(generation)
  if (existingThumbnail?.thumbnailVersion === THUMBNAIL_VERSION) {
    const image = await getImage(id)
    assertCurrentTaskData(generation)
    if (image && (!image.width || !image.height) && existingThumbnail.width && existingThumbnail.height) {
      await putImage({ ...image, width: existingThumbnail.width, height: existingThumbnail.height })
    }
    return existingThumbnail
  }

  const image = await getImage(id)
  assertCurrentTaskData(generation)
  if (!image) return undefined
  const legacyImage = image as StoredImage & Partial<StoredImageThumbnail>
  if (legacyImage.thumbnailDataUrl && legacyImage.thumbnailVersion === THUMBNAIL_VERSION) {
    const thumbnail: StoredImageThumbnail = {
      id,
      thumbnailDataUrl: legacyImage.thumbnailDataUrl,
      width: legacyImage.width,
      height: legacyImage.height,
      thumbnailVersion: THUMBNAIL_VERSION,
    }
    await putImageThumbnail(thumbnail)
    assertCurrentTaskData(generation)
    if ((!image.width || !image.height) && thumbnail.width && thumbnail.height) {
      await putImage({ ...image, width: thumbnail.width, height: thumbnail.height })
    }
    return thumbnail
  }

  const metadata = await safeCreateImageThumbnail(image.dataUrl)
  assertCurrentTaskData(generation)
  if (!metadata.thumbnailDataUrl) return undefined
  const thumbnail: StoredImageThumbnail = {
    id,
    thumbnailDataUrl: metadata.thumbnailDataUrl,
    width: metadata.width,
    height: metadata.height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
  await putImageThumbnail(thumbnail)
  assertCurrentTaskData(generation)
  if (metadata.width && metadata.height && (image.width !== metadata.width || image.height !== metadata.height)) {
    await putImage({ ...image, width: metadata.width, height: metadata.height })
  }
  return thumbnail
}

export function getAllImages(): Promise<StoredImage[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAll())
}

export function getAllImageIds(): Promise<string[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAllKeys()).then((keys) => keys.map(String))
}

export function putImage(image: StoredImage): Promise<IDBValidKey> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.put(image))
}

export function deleteImage(id: string): Promise<undefined> {
  return taskDataTransaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite', (tx) => {
    tx.objectStore(STORE_IMAGES).delete(id)
    tx.objectStore(STORE_THUMBNAILS).delete(id)
    return () => undefined
  })
}

export function clearImages(): Promise<undefined> {
  return taskDataTransaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite', (tx) => {
    tx.objectStore(STORE_IMAGES).clear()
    tx.objectStore(STORE_THUMBNAILS).clear()
    return () => undefined
  })
}

// ===== Image hashing & dedup =====

export async function hashDataUrl(dataUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return hashDataUrlFallback(dataUrl)
  }

  const data = new TextEncoder().encode(dataUrl)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hashDataUrlFallback(dataUrl: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193

  for (let i = 0; i < dataUrl.length; i++) {
    const code = dataUrl.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code
    h2 = Math.imul(h2, 0x27d4eb2d)
  }

  return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * 存储图片，若已存在（按 hash 去重）则跳过。
 * 返回 image id。
 */
export async function storeImage(
  dataUrl: string,
  source: NonNullable<StoredImage['source']> = 'upload',
): Promise<string> {
  const generation = taskDataGeneration
  assertCurrentTaskData(generation)
  const id = await hashDataUrl(dataUrl)
  const existing = await getImage(id)
  assertCurrentTaskData(generation)
  if (!existing) {
    const thumbnail = await safeCreateImageThumbnail(dataUrl)
    assertCurrentTaskData(generation)
    await putImage({
      id,
      dataUrl,
      createdAt: Date.now(),
      source,
      width: thumbnail.width,
      height: thumbnail.height,
    })
    assertCurrentTaskData(generation)
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
  } else if ((await getStoredImageThumbnail(id))?.thumbnailVersion !== THUMBNAIL_VERSION) {
    assertCurrentTaskData(generation)
    const thumbnail = await safeCreateImageThumbnail(existing.dataUrl)
    assertCurrentTaskData(generation)
    if (
      thumbnail.width &&
      thumbnail.height &&
      (existing.width !== thumbnail.width || existing.height !== thumbnail.height)
    ) {
      await putImage({ ...existing, width: thumbnail.width, height: thumbnail.height })
    }
    assertCurrentTaskData(generation)
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
  }
  return id
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}

async function createImageThumbnail(dataUrl: string): Promise<Omit<StoredImageThumbnail, 'id'>> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效')

  const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
    width,
    height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
}

async function safeCreateImageThumbnail(dataUrl: string): Promise<Partial<Omit<StoredImageThumbnail, 'id'>>> {
  try {
    return await createImageThumbnail(dataUrl)
  } catch {
    return {}
  }
}
